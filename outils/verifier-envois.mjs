// ===========================================================================
//  Vérification quotidienne des envois  —  tourne sur SIMA (indépendant du cloud)
// ---------------------------------------------------------------------------
//  But : chaque jour de semaine, s'assurer que le serveur cloud a bien envoyé
//  ses courriels. Si RIEN n'est parti (panne SMTP, app plantée, tunnel coupé…),
//  ALERTER Joel sur 3 canaux : notification SIMA + courriel + texto (SMS).
//
//  Pourquoi sur SIMA et pas sur le cloud : si le cloud est en panne, il ne peut
//  pas s'alerter lui-même. SIMA le surveille de l'extérieur — et SIMA peut
//  envoyer des courriels (Hostinger direct), même quand le cloud, lui, ne peut
//  pas. C'est CE trou qui a laissé passer la panne de 4 jours.
//
//  Appelé par le gardien (aux 15 min) ; le script ne fait la vérification
//  qu'UNE fois par jour, après l'heure choisie, et n'alerte qu'une fois.
//
//  Config (mots de passe) : C:\Users\joeld\CLAUDE\SIMA\alertes.json
//  État (anti-répétition)  : C:\Users\joeld\CLAUDE\SIMA\dernier-check.json
// ===========================================================================
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import nodemailer from 'nodemailer';

const SIMA = 'C:\\Users\\joeld\\CLAUDE\\SIMA';
const CONF = SIMA + '\\alertes.json';
const ETAT = SIMA + '\\dernier-check.json';
const JOURNAL = SIMA + '\\gardien.log';

function log(msg) {
  const t = new Date().toISOString().replace('T', ' ').slice(0, 19);
  try { writeFileSync(JOURNAL, `${t}  [verif-envois] ${msg}\n`, { flag: 'a' }); } catch {}
}

if (!existsSync(CONF)) {
  log('alertes.json introuvable — vérification ignorée (remplir la config).');
  process.exit(0);
}
// .replace(/^﻿/, '') : enlève le BOM que PowerShell peut ajouter en tête.
const conf = JSON.parse(readFileSync(CONF, 'utf8').replace(/^﻿/, ''));

// --- Anti-répétition : une seule vérif + alerte par jour ------------------
const aujourdhui = new Date().toLocaleDateString('fr-CA'); // AAAA-MM-JJ (heure locale)
let etat = { date: '', verifFaite: false, alerteEnvoyee: false };
try { if (existsSync(ETAT)) etat = JSON.parse(readFileSync(ETAT, 'utf8').replace(/^﻿/, '')); } catch {}
if (etat.date !== aujourdhui) etat = { date: aujourdhui, verifFaite: false, alerteEnvoyee: false };
function sauverEtat() { try { writeFileSync(ETAT, JSON.stringify(etat, null, 2)); } catch {} }

const maintenant = new Date();
const jour = maintenant.getDay(); // 0=dim, 6=sam
const heure = maintenant.getHours();
const finDeSemaine = jour === 0 || jour === 6;
const heureVerif = Number(conf.heureVerif ?? 10);

// Fin de semaine : pas d'envoi prévu, donc rien à vérifier.
if (finDeSemaine) process.exit(0);
// Trop tôt : on laisse le temps à la fenêtre d'envoi de 8h de s'exécuter.
if (heure < heureVerif) process.exit(0);
// Déjà vérifié aujourd'hui : on ne refait rien.
if (etat.verifFaite) process.exit(0);

// --- Interroge le cloud : combien de courriels envoyés aujourd'hui ? -------
const BASE = conf.cloudUrl || 'http://137.184.167.254:3000';
const CAMPS = ['garages', 'moteurs', 'mtl_construction', 'mtl_transport', 'mtl_commerce',
  'quebec', 'qc_construction', 'qc_transport', 'qc_commerce',
  'gat_auto', 'gat_construction', 'gat_transport', 'gat_commerce'];

async function ftimeout(url, opts, ms) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ac.signal }); } finally { clearTimeout(to); }
}

let probleme = null;   // texte du problème, ou null si tout va bien
let envoyesTotal = 0;
try {
  const login = await ftimeout(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: conf.cloudPass }),
  }, 15000);
  if (!login.ok) throw new Error('login HTTP ' + login.status);
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  for (const id of CAMPS) {
    const r = await ftimeout(BASE + '/api/warmup', { headers: { Cookie: cookie, 'X-Campaign': id } }, 15000);
    const wu = await r.json();
    envoyesTotal += Number(wu.usedToday) || 0;
  }
  if (envoyesTotal === 0) probleme = `Aucun courriel envoyé aujourd'hui (${aujourdhui}). La prospection est ARRÊTÉE.`;
} catch (e) {
  probleme = `Le serveur cloud est INJOIGNABLE (${e.message}). Les envois sont probablement arrêtés.`;
}

etat.verifFaite = true;
sauverEtat();

// ==================== RAPPORT QUOTIDIEN (positif OU alerte) =================
// On envoie un courriel TOUS les jours de semaine : « tout fonctionne » quand
// ça va, ou une ALERTE quand rien n'est parti. Ainsi Joel a la confirmation
// quotidienne que la prospection tourne (et il sait tout de suite si ça arrête).
const estAlerte = Boolean(probleme);
let sujet, corps;
if (estAlerte) {
  log('PROBLÈME — ' + probleme);
  sujet = '⚠️ Prospection Bifco — AUCUN courriel envoyé aujourd\'hui';
  corps =
    `Alerte automatique de SIMA (${new Date().toLocaleString('fr-CA')}) :\n\n` +
    probleme + '\n\n' +
    'À vérifier : le serveur cloud tourne-t-il ? Le tunnel SMTP (SIMA) est-il actif ? ' +
    'Les mots de passe Hostinger sont-ils bons ?\n\n' +
    '— SIMA veille sur ta prospection.';
} else {
  log(`OK — ${envoyesTotal} courriels envoyés aujourd'hui.`);
  sujet = `✅ Prospection Bifco — tout fonctionne (${envoyesTotal} courriels envoyés)`;
  corps =
    `Rapport quotidien de SIMA (${new Date().toLocaleString('fr-CA')}) :\n\n` +
    `✅ ${envoyesTotal} courriels ont été envoyés aujourd'hui par tes campagnes. ` +
    'Tout fonctionne normalement — envois, relais et surveillance sont OK.\n\n' +
    '— SIMA veille sur ta prospection.';
}

// 1) Notification sur SIMA (bulle Windows) — seulement en cas de PROBLÈME.
if (estAlerte) try {
  const ps =
    'Add-Type -AssemblyName System.Windows.Forms;' +
    "$n=New-Object System.Windows.Forms.NotifyIcon;" +
    "$n.Icon=[System.Drawing.SystemIcons]::Warning;$n.Visible=$true;" +
    "$n.ShowBalloonTip(20000,'Prospection Bifco','AUCUN courriel envoye aujourdhui !',[System.Windows.Forms.ToolTipIcon]::Warning);" +
    'Start-Sleep -Seconds 6;$n.Dispose()';
  execFile('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], () => {});
  log('notification SIMA affichée.');
} catch (e) { log('notification SIMA échouée : ' + e.message); }

// 2) Notification PUSH sur le téléphone via ntfy.sh (gratuit, aucun compte).
//    Joel installe l'app « ntfy » et s'abonne au sujet (conf.ntfyTopic).
if (conf.ntfyTopic) {
  try {
    await ftimeout('https://ntfy.sh/' + conf.ntfyTopic, {
      method: 'POST',
      headers: { Title: 'Prospection Bifco - ALERTE', Priority: 'urgent', Tags: 'warning,email' },
      body: probleme,
    }, 15000);
    log('push ntfy envoyé (sujet ' + conf.ntfyTopic + ').');
  } catch (e) { log('push ntfy échoué : ' + e.message); }
}

// 3) Courriel (optionnel — seulement si un mot de passe d'envoi est fourni)
const exp = conf.expediteur || {};
const destinataires = [conf.alerteCourriel, conf.cellulaireSms].filter((x) => x && x.trim());
if (exp.user && exp.pass && destinataires.length) {
  try {
    const t = nodemailer.createTransport({
      host: exp.host || 'smtp.hostinger.com',
      port: Number(exp.port) || 465,
      secure: (Number(exp.port) || 465) === 465,
      auth: { user: exp.user, pass: exp.pass },
      family: 4,
    });
    await t.sendMail({
      from: exp.user,
      to: destinataires.join(', '),
      subject: sujet,
      text: corps,
    });
    etat.alerteEnvoyee = true;
    sauverEtat();
    log('alerte courriel/SMS envoyée à : ' + destinataires.join(', '));
  } catch (e) {
    log('alerte courriel/SMS ÉCHOUÉE : ' + e.message);
  }
} else {
  log('alerte courriel/SMS non configurée (voir alertes.json : expediteur.pass + alerteCourriel).');
}

process.exit(0);
