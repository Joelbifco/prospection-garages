// ---------------------------------------------------------------------------
//  Outil : copie la clé Google (Places API) de la campagne « Garages » vers
//  TOUTES les campagnes. Sert à activer la recherche Google partout d'un coup
//  sans avoir à recoller la clé 13 fois dans l'interface.
//
//  La clé n'apparaît jamais à l'écran : le script la lit dans le fichier de
//  Garages et l'écrit dans les autres, sans l'afficher.
//
//  Usage (sur le serveur) :
//     node outils/propager-cle-google.js
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, existsSync, readdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'data');

// Écriture ATOMIQUE : on écrit dans un fichier temporaire puis on le renomme.
// Le renommage est instantané, donc le serveur qui lit settings.json ne peut
// jamais tomber sur un fichier à demi-écrit (ce qui, autrement, réinitialisait
// les réglages aux valeurs par défaut et effaçait le mot de passe SMTP).
function writeAtomic(f, content) {
  const tmp = f + '.tmp';
  writeFileSync(tmp, content);
  renameSync(tmp, f);
}

const src = path.join(DATA, 'garages', 'settings.json');
if (!existsSync(src)) {
  console.error('  ⛔  Introuvable : ' + src);
  process.exit(1);
}
const key = JSON.parse(readFileSync(src, 'utf8')).googleApiKey;
if (!key) {
  console.error('  ⛔  Aucune clé Google enregistrée sur Garages.');
  console.error('      Colle-la d\'abord dans Réglages > Clé Google (campagne Garages).');
  process.exit(1);
}

let n = 0;
for (const camp of readdirSync(DATA)) {
  const f = path.join(DATA, camp, 'settings.json');
  if (!existsSync(f)) continue;
  const s = JSON.parse(readFileSync(f, 'utf8'));
  s.googleApiKey = key;
  writeAtomic(f, JSON.stringify(s, null, 2));
  console.log('  ✅  clé Google appliquée à ' + camp);
  n++;
}

console.log('');
console.log('  Clé Google propagée à ' + n + ' campagnes.');
console.log('  Redémarre le serveur pour l\'appliquer :  pm2 restart prospection');
