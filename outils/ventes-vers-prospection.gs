/**
 * ===========================================================================
 *  Ventes Internes → application de prospection Bifco
 * ---------------------------------------------------------------------------
 *  À installer dans le tableur « Bifco » (Extensions > Apps Script).
 *  Chaque nuit, envoie à l'application les ventes des 400 derniers jours pour
 *  qu'elle repère celles qui viennent de la prospection par courriel.
 *
 *  CE QUI EST ENVOYÉ, par vente : numéro de facture, date, prix de vente,
 *  prix payé, source de vente, statut, et les ADRESSES COURRIEL trouvées dans
 *  la colonne client. Jamais le nom, le téléphone ni l'adresse de livraison.
 *
 *  Installation (une seule fois) :
 *   1. Coller ce fichier dans un nouveau projet Apps Script du tableur.
 *   2. Paramètres du projet (roue dentée) > Propriétés du script > Ajouter :
 *        JETON_PROSPECTION = <le jeton affiché dans l'app, onglet Résultats>
 *   3. Exécuter « installer » une fois et accepter les autorisations Google.
 *      → envoie tout de suite, puis chaque nuit vers 2 h.
 * ===========================================================================
 */
const URL_APP = 'http://137.184.167.254:3000/api/ventes/import';
// Tableur « Bifco » : ouvert par son identifiant, le script fonctionne donc aussi
// bien attaché au tableur (Extensions > Apps Script) qu'en projet indépendant.
const ID_TABLEUR = '1yIjFddmma16SRt4cRvDZRw1Sgrt3slkaLXJ_HVAZ6vs';
const ONGLET = 'Ventes Internes';
const JOURS = 400;

function installer() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'envoyerVentes')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('envoyerVentes').timeBased().everyDays(1).atHour(2).create();
  envoyerVentes();
}

function envoyerVentes() {
  const jeton = PropertiesService.getScriptProperties().getProperty('JETON_PROSPECTION');
  if (!jeton) throw new Error('Propriété JETON_PROSPECTION manquante (voir les instructions en haut du fichier).');
  const feuille = SpreadsheetApp.openById(ID_TABLEUR).getSheetByName(ONGLET);
  if (!feuille) throw new Error('Onglet « ' + ONGLET + ' » introuvable.');
  const valeurs = feuille.getDataRange().getValues();
  // Titres comparés sans accents, sans majuscules ni retours à la ligne.
  const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  // La ligne de titres n'est pas forcément la 1re : on cherche celle qui contient « Prix de vente ».
  let h = -1;
  for (let r = 0; r < Math.min(10, valeurs.length); r++) {
    if (valeurs[r].some((t) => norm(t).indexOf('prix de vente') >= 0)) { h = r; break; }
  }
  if (h < 0) throw new Error('Ligne de titres introuvable : aucune colonne « Prix de vente » dans les 10 premières lignes.');
  const titres = valeurs[h].map(norm);
  const col = (mot) => titres.findIndex((t) => t.indexOf(mot) >= 0);
  const C = {
    date: titres.findIndex((t) => t.indexOf('date') === 0),
    facture: col('facture'),
    montant: col('prix de vente'),
    cout: col('prix paye'),
    client: col('courriel'),
    source: col('source'),
    statut: col('statut'),
  };
  if (C.date < 0 || C.montant < 0 || C.client < 0) {
    throw new Error('Colonnes introuvables (date ' + C.date + ', prix ' + C.montant + ', courriel ' + C.client +
      '). Titres lus en ligne ' + (h + 1) + ' : ' + titres.filter(String).join(' | '));
  }
  const limite = Date.now() - JOURS * 86400000;
  const ventes = [];
  for (let i = h + 1; i < valeurs.length; i++) {
    const l = valeurs[i];
    const date = lireDate(l[C.date]);
    if (!date || date.getTime() < limite) continue;
    const courriels = String(l[C.client] || '').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || [];
    ventes.push({
      facture: C.facture >= 0 ? String(l[C.facture] || '') : '',
      date: date.toISOString(),
      montant: premierMontant(l[C.montant]),
      cout: C.cout >= 0 ? premierMontant(l[C.cout]) : 0,
      courriels: courriels,
      sourceVente: C.source >= 0 ? String(l[C.source] || '') : '',
      statut: C.statut >= 0 ? String(l[C.statut] || '') : '',
    });
  }
  const rep = UrlFetchApp.fetch(URL_APP, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Ventes-Jeton': jeton },
    // remplacer : l'app remplace toutes les ventes du tableur par cet instantané.
    payload: JSON.stringify({ ventes: ventes, remplacer: true }),
    muteHttpExceptions: true,
  });
  Logger.log('Réponse de l\'application (' + rep.getResponseCode() + ') : ' + rep.getContentText());
  if (rep.getResponseCode() !== 200) throw new Error('Envoi refusé : ' + rep.getContentText());
}

// Les montants sont souvent écrits en texte libre (« 2000$ cash », « 2500 plus
// livraison », « 2800$ x5 ») : on garde le PREMIER montant de la case.
// Au-delà de 100 000 $, c'est une erreur de lecture : ignoré (0).
function premierMontant(v) {
  if (typeof v === 'number') return v > 0 && v < 100000 ? v : 0;
  const m = String(v || '').match(/\d{1,3}(?:[ \u00a0]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/);
  if (!m) return 0;
  const n = parseFloat(m[0].replace(/[ \u00a0]/g, '').replace(',', '.'));
  return n > 0 && n < 100000 ? n : 0;
}

// Accepte une vraie date, « 2026/10/08 », « 2026-10-08 » ou « 08/10/2026 ».
function lireDate(v) {
  if (v instanceof Date && !isNaN(v)) return v;
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12);
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], 12);
  return null;
}
