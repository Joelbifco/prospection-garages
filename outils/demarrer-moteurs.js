// ---------------------------------------------------------------------------
//  Outil unique : prépare la campagne « Moteurs » pour commencer à TROUVER
//  des courriels tout de suite, en copiant les réglages de recherche de la
//  campagne « Garages » (clé Google + zones). N'active PAS l'envoi : Moteurs
//  reste en « trouver seulement » (findOnly) tant que l'adresse n'est pas
//  réchauffée. Sans danger, on peut le relancer autant de fois qu'on veut.
//
//  Usage :  node outils/demarrer-moteurs.js
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

function lire(campagne) {
  const f = path.join(DATA_DIR, campagne, 'settings.json');
  if (!existsSync(f)) {
    console.error(`  ⛔  Introuvable : ${f}`);
    console.error('      (Le serveur a-t-il bien démarré au moins une fois ?)');
    process.exit(1);
  }
  return { f, s: JSON.parse(readFileSync(f, 'utf8')) };
}

const garages = lire('garages');
const moteurs = lire('moteurs');

const cle = garages.s.googleApiKey && String(garages.s.googleApiKey).trim();
const zones = Array.isArray(garages.s.auto?.zones) ? garages.s.auto.zones : [];

if (!cle) {
  console.error('  ⛔  Aucune clé Google trouvée dans Garages. Rien à copier.');
  process.exit(1);
}

moteurs.s.googleApiKey = garages.s.googleApiKey;
moteurs.s.auto = moteurs.s.auto || {};
moteurs.s.auto.zones = zones.slice();
moteurs.s.auto.enabled = true; // le planificateur ratisse Moteurs aux 15 min
moteurs.s.auto.findOnly = true; // TROUVER seulement — pas d'envoi (adresse neuve)

writeFileSync(moteurs.f, JSON.stringify(moteurs.s, null, 2));

console.log('  ✅  Campagne Moteurs prête à TROUVER des courriels.');
console.log(`      • Clé Google  : copiée depuis Garages`);
console.log(`      • Zones       : ${zones.length}`);
console.log(`      • Mode        : trouver seulement (aucun envoi)`);
console.log('');
console.log('  Redémarre le serveur pour lancer le ratissage :');
console.log('      pm2 restart prospection');
