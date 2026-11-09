// prospection-garages — mise à jour automatique depuis GitHub
//
// Même principe que SIMA (demande de Joel, 9 nov 2026) : chaque instance regarde
// GitHub toutes les heures et, s'il y a du neuf, se met à jour et redémarre —
// avec la même prudence :
//   - fast-forward SEULEMENT : du code modifié ici et pas enregistré, ou des
//     commits que GitHub n'a pas → on ne touche à rien ;
//   - les DONNÉES (data/, hors dépôt) : jamais touchées ;
//   - npm install seulement si package-lock.json a changé ; s'il échoue, on ne
//     redémarre PAS (le code neuf pourrait manquer d'un module).
//
// GARDE SPÉCIFIQUE À L'ENVOI : on ne redémarre JAMAIS pendant un lot d'envoi ou
// de ratissage (verrou tickBusy, passé par server.js via `envoiEnCours`). Un
// redémarrage ENTRE deux passages est sans danger : runSendOnce garantit un seul
// envoi par jour à partir des données sauvegardées (aucun double-envoi possible) —
// c'est justement pour ça que l'auto-relance était interdite AVANT runSendOnce
// (incident Hostinger du 11 sept.). Ici on ne relance pas sur un plantage : on se
// met à jour sur un NOUVEAU commit, hors fenêtre d'envoi.
//
// Couper : variable d'environnement PROSPECTION_MAJ_AUTO=0.

import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const executer = promisify(execFile);
const DIR = path.dirname(fileURLToPath(import.meta.url)); // racine du dépôt (server.js est ici)
const INTERVALLE_MS = 60 * 60 * 1000;
const PREMIER_TOUR_MS = 5 * 60 * 1000;

const git = async (...args) =>
  (await executer('git', args, { cwd: DIR, windowsHide: true, timeout: 120000 })).stdout.trim();

const actif = () => process.env.PROSPECTION_MAJ_AUTO !== '0';

// Empreinte du verrou de dépendances : si elle change, il faut npm install.
const empreinteLock = async () => {
  try { return await git('rev-parse', 'HEAD:package-lock.json'); } catch { return null; }
};

// Relancer sur la nouvelle version.
function redemarrer() {
  // Cloud : pm2 relance tout de suite un processus qui s'arrête.
  if (process.env.pm_id !== undefined) {
    setTimeout(() => process.exit(0), 500);
    return;
  }
  // Ailleurs (Windows local) : un petit Node détaché relance server.js une fois
  // le port libéré, puis s'efface. Pas de PowerShell : aucun guillemet à échapper.
  const relais =
    "setTimeout(()=>{require('child_process').spawn(process.execPath,['server.js']," +
    "{cwd:process.env.PROSPECTION_DIR,detached:true,stdio:'ignore',windowsHide:true}).unref();" +
    'setTimeout(()=>process.exit(0),500)},4000)';
  spawn(process.execPath, ['-e', relais], {
    cwd: DIR,
    env: { ...process.env, PROSPECTION_DIR: DIR },
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
  setTimeout(() => process.exit(0), 500);
}

let enCours = false;
export async function tourMiseAJour({ envoiEnCours } = {}) {
  if (enCours) return { fait: false, raison: 'déjà en cours' };
  if (!actif()) return { fait: false, raison: 'désactivée' };
  enCours = true;
  try {
    if ((await git('rev-parse', '--abbrev-ref', 'HEAD')) !== 'main') return { fait: false, raison: 'pas sur la branche main' };
    // Du code modifié ici et pas enregistré : c'est une instance où l'on travaille.
    if (await git('status', '--porcelain', '--untracked-files=no')) return { fait: false, raison: 'code modifié ici, pas enregistré' };

    await git('fetch', 'origin', '--quiet');
    const local = await git('rev-parse', 'HEAD');
    const distant = await git('rev-parse', 'origin/main');
    if (local === distant) return { fait: false, raison: 'déjà à jour' };

    const base = await git('merge-base', 'HEAD', 'origin/main');
    if (base !== local) {
      // Cette instance a des commits que GitHub n'a pas → on ne fusionne pas à l'aveugle.
      return { fait: false, raison: base === distant ? 'commits locaux pas encore poussés' : 'versions divergentes' };
    }

    // JAMAIS pendant un lot d'envoi/ratissage : on attend le prochain tour.
    if (typeof envoiEnCours === 'function' && envoiEnCours()) {
      return { fait: false, raison: 'envoi en cours : au prochain tour' };
    }

    const avant = await empreinteLock();
    await git('merge', '--ff-only', 'origin/main', '--quiet');
    const titre = await git('log', '--oneline', '-1');
    const apres = await empreinteLock();

    if (avant !== apres) {
      try {
        await executer('npm', ['install', '--no-audit', '--no-fund', '--silent'], {
          cwd: DIR, shell: true, windowsHide: true, timeout: 600000,
        });
      } catch (e) {
        console.error('  ⚠  MAJ auto : npm install a échoué, PAS de redémarrage :', String(e.message).slice(0, 200));
        return { fait: false, raison: 'npm install a échoué' };
      }
    }

    console.log('  ◆  Mise à jour automatique :', titre, '— redémarrage');
    redemarrer();
    return { fait: true, version: titre };
  } catch (e) {
    console.error('  ⚠  Mise à jour automatique :', e.message);
    return { fait: false, raison: e.message };
  } finally {
    enCours = false;
  }
}

export function demarrerMiseAJourAuto(options = {}) {
  setTimeout(() => tourMiseAJour(options).catch(() => {}), PREMIER_TOUR_MS);
  setInterval(() => tourMiseAJour(options).catch(() => {}), INTERVALLE_MS);
}
