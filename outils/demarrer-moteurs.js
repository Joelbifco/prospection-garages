// ---------------------------------------------------------------------------
//  Outil : prépare la campagne « Entreprises » (moteurs@bifcobifco.com) pour
//  commencer à TROUVER des courriels d'entreprises tout de suite, avec la
//  RECHERCHE GRATUITE (OpenStreetMap) — aucune clé Google, aucune limite.
//  Fixe les zones (Montréal par défaut), active la recherche auto et garde
//  la campagne en « trouver seulement » (findOnly) : aucun envoi tant que
//  l'adresse neuve n'est pas réchauffée. Sans danger, relançable à volonté.
//
//  Usage :
//     node outils/demarrer-moteurs.js            (Montréal + région)
//     node outils/demarrer-moteurs.js quebec     (région de Québec)
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

// Grande région de Québec.
const ZONES_QUEBEC = [
  'Quebec', 'Levis', 'Beauport', 'Charlesbourg', 'Sainte-Foy', 'Loretteville',
  'Val-Belair', 'Cap-Rouge', 'Sillery', 'Vanier', 'Ancienne-Lorette',
  'Saint-Augustin-de-Desmaures', 'Boischatel', 'Sainte-Brigitte-de-Laval',
  'Stoneham', 'Shannon', 'Pont-Rouge', 'Donnacona',
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
const moteurs = lire('moteurs');

let zones, etiquette;
if (region === 'quebec' || region === 'québec') {
  zones = ZONES_QUEBEC.slice();
  etiquette = 'grande région de Québec';
} else {
  zones = ZONES_MONTREAL.slice();
  etiquette = 'grande région de Montréal';
}

moteurs.s.auto = moteurs.s.auto || {};
moteurs.s.auto.zones = zones;
moteurs.s.auto.enabled = true; // le planificateur ratisse aux 15 min
moteurs.s.auto.findOnly = true; // TROUVER seulement — pas d'envoi (adresse neuve)
// Recherche GRATUITE (OpenStreetMap) : pas de clé Google => aucune limite.
moteurs.s.googleApiKey = '';

writeFileSync(moteurs.f, JSON.stringify(moteurs.s, null, 2));

console.log('  ✅  Campagne Entreprises prête à TROUVER des courriels.');
console.log(`      • Recherche   : GRATUITE (OpenStreetMap) — aucune limite`);
console.log(`      • Zones       : ${zones.length} — ${etiquette}`);
console.log(`      • Mode        : trouver seulement (aucun envoi)`);
console.log('');
console.log('  Redémarre le serveur pour lancer le ratissage :');
console.log('      pm2 restart prospection');
