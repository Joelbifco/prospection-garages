// ---------------------------------------------------------------------------
//  Outil : prépare la campagne « Moteurs » pour commencer à TROUVER des
//  courriels d'entreprises tout de suite. Copie la clé Google de Garages,
//  fixe les ZONES d'une région, active la recherche auto et garde Moteurs
//  en « trouver seulement » (findOnly) — aucun envoi tant que l'adresse
//  neuve n'est pas réchauffée. Sans danger, relançable autant qu'on veut.
//
//  Usage :
//     node outils/demarrer-moteurs.js            (Montréal + région, par défaut)
//     node outils/demarrer-moteurs.js quebec     (copie les zones de Garages)
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

// Grande région de Montréal (noms sans accents pour le géocodage).
const ZONES_MONTREAL = [
  'Montreal', 'Laval', 'Longueuil', 'Brossard', 'Saint-Laurent', 'LaSalle',
  'Verdun', 'Lachine', 'Anjou', 'Montreal-Nord', 'Saint-Leonard',
  'Pointe-aux-Trembles', 'Dollard-des-Ormeaux', 'Pointe-Claire', 'Dorval',
  'Repentigny', 'Terrebonne', 'Mascouche', 'Boucherville', 'Saint-Hubert',
  'Chateauguay', 'Vaudreuil-Dorion', 'Blainville', 'Saint-Eustache',
];

function lire(campagne) {
  const f = path.join(DATA_DIR, campagne, 'settings.json');
  if (!existsSync(f)) {
    console.error(`  ⛔  Introuvable : ${f}`);
    console.error('      (Le serveur a-t-il bien démarré au moins une fois ?)');
    process.exit(1);
  }
  return { f, s: JSON.parse(readFileSync(f, 'utf8')) };
}

const region = (process.argv[2] || 'montreal').toLowerCase();
const garages = lire('garages');
const moteurs = lire('moteurs');

const cle = garages.s.googleApiKey && String(garages.s.googleApiKey).trim();
if (!cle) {
  console.error('  ⛔  Aucune clé Google trouvée dans Garages. Rien à copier.');
  process.exit(1);
}

let zones;
let etiquette;
if (region === 'quebec' || region === 'québec' || region === 'garages') {
  zones = Array.isArray(garages.s.auto?.zones) ? garages.s.auto.zones.slice() : [];
  etiquette = 'région de Québec (copiées de Garages)';
} else {
  zones = ZONES_MONTREAL.slice();
  etiquette = 'grande région de Montréal';
}

moteurs.s.googleApiKey = garages.s.googleApiKey;
moteurs.s.auto = moteurs.s.auto || {};
moteurs.s.auto.zones = zones;
moteurs.s.auto.enabled = true; // le planificateur ratisse Moteurs aux 15 min
moteurs.s.auto.findOnly = true; // TROUVER seulement — pas d'envoi (adresse neuve)

writeFileSync(moteurs.f, JSON.stringify(moteurs.s, null, 2));

console.log('  ✅  Campagne Moteurs prête à TROUVER des courriels.');
console.log(`      • Clé Google  : copiée depuis Garages`);
console.log(`      • Zones       : ${zones.length} — ${etiquette}`);
console.log(`      • Mode        : trouver seulement (aucun envoi)`);
console.log('');
console.log('  Redémarre le serveur pour lancer le ratissage :');
console.log('      pm2 restart prospection');
