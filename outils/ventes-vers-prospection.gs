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
  const feuille = SpreadsheetApp.getActive().getSheetByName(ONGLET);
  if (!feuille) throw new Error('Onglet « ' + ONGLET + ' » introuvable.');
  const valeurs = feuille.getDataRange().getValues();
  const titres = valeurs[0].map((t) => String(t).toLowerCase());
  const col = (debut) => titres.findIndex((t) => t.indexOf(debut) === 0);
  const C = {
    date: col('date'),
    facture: col('numero de facture'),
    montant: col('prix de vente'),
    cout: col('prix payé'),
    client: col('nom, numéro, courriel'),
    source: col('sources de vente'),
    statut: col('statuts de suivi'),
  };
  if (C.date < 0 || C.montant < 0 || C.client < 0) {
    throw new Error('Colonnes introuvables : vérifier les titres DATE / Prix de vente / Nom, Numéro, Courriel.');
  }
  const limite = Date.now() - JOURS * 86400000;
  const ventes = [];
  for (let i = 1; i < valeurs.length; i++) {
    const l = valeurs[i];
    const date = lireDate(l[C.date]);
    if (!date || date.getTime() < limite) continue;
    const courriels = String(l[C.client] || '').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || [];
    ventes.push({
      facture: C.facture >= 0 ? String(l[C.facture] || '') : '',
      date: date.toISOString(),
      montant: l[C.montant],
      cout: C.cout >= 0 ? l[C.cout] : '',
      courriels: courriels,
      sourceVente: C.source >= 0 ? String(l[C.source] || '') : '',
      statut: C.statut >= 0 ? String(l[C.statut] || '') : '',
    });
  }
  const rep = UrlFetchApp.fetch(URL_APP, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Ventes-Jeton': jeton },
    payload: JSON.stringify({ ventes: ventes }),
    muteHttpExceptions: true,
  });
  Logger.log('Réponse de l\'application (' + rep.getResponseCode() + ') : ' + rep.getContentText());
  if (rep.getResponseCode() !== 200) throw new Error('Envoi refusé : ' + rep.getContentText());
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
