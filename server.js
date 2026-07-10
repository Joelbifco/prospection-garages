// ============================================================================
//  App Courriels Garages — serveur local
//  Trouver des garages par zone (OpenStreetMap) et leur envoyer des courriels
//  de partenariat depuis ta propre adresse (ventes@bifco.shop).
//  Aucune clé API requise. Données stockées localement dans le dossier /data.
// ============================================================================

import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import nodemailer from 'nodemailer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;
const APP_UA = 'AppCourrielsGarages/1.0 (prospection B2B; contact via bifco.shop)';

// ---------------------------------------------------------------------------
//  Authentification — activée UNIQUEMENT si la variable APP_PASSWORD est définie
//  (donc jamais en usage local ; obligatoire quand l'app est hébergée en ligne).
// ---------------------------------------------------------------------------
const AUTH_PASSWORD = process.env.APP_PASSWORD || '';
const AUTH_ENABLED = !!AUTH_PASSWORD;
const AUTH_SECRET = process.env.APP_SECRET || AUTH_PASSWORD || 'local-dev-secret';
const AUTH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

function signToken(exp) {
  const h = createHmac('sha256', AUTH_SECRET).update('pg|' + exp).digest('hex');
  return exp + '.' + h;
}
function verifyToken(tok) {
  if (!tok) return false;
  const i = tok.indexOf('.');
  if (i < 0) return false;
  const exp = tok.slice(0, i);
  const h = tok.slice(i + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const expected = createHmac('sha256', AUTH_SECRET).update('pg|' + exp).digest('hex');
  try {
    return h.length === expected.length && timingSafeEqual(Buffer.from(h), Buffer.from(expected));
  } catch {
    return false;
  }
}
function parseCookies(req) {
  const out = {};
  const c = req.headers.cookie;
  if (!c) return out;
  for (const part of c.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}
function isAuthed(req) {
  if (!AUTH_ENABLED) return true;
  return verifyToken(parseCookies(req)['pg_auth']);
}

// ---------------------------------------------------------------------------
//  Emplacement des données — synchronisation OneDrive optionnelle
//  Si le fichier « SYNC-ONEDRIVE.txt » est présent à côté du serveur ET que
//  OneDrive est disponible, les données vivent dans un dossier OneDrive
//  partagé par tous tes ordinateurs (synchronisation automatique).
// ---------------------------------------------------------------------------
const LOCAL_DATA = path.join(__dirname, 'data');
function resolveDataDir() {
  const marker = path.join(__dirname, 'SYNC-ONEDRIVE.txt');
  const oneDrive =
    process.env.OneDrive || process.env.OneDriveConsumer || process.env.OneDriveCommercial;
  if (existsSync(marker) && oneDrive) {
    return path.join(oneDrive, 'Prospection-Garages-Data');
  }
  return LOCAL_DATA;
}
const DATA_DIR = resolveDataDir();
const SYNC_MODE = DATA_DIR !== LOCAL_DATA;

// Migration unique : la première fois qu'on active OneDrive, on copie les
// données locales existantes vers le dossier synchronisé (pour ne rien perdre).
function migrateToSyncIfNeeded() {
  if (!SYNC_MODE) return;
  if (existsSync(DATA_DIR)) return; // dossier synchronisé déjà présent
  if (!existsSync(LOCAL_DATA)) return; // rien à migrer
  mkdirSync(DATA_DIR, { recursive: true });
  for (const f of readdirSync(LOCAL_DATA)) {
    try {
      copyFileSync(path.join(LOCAL_DATA, f), path.join(DATA_DIR, f));
    } catch {
      /* ignore */
    }
  }
  console.log('  🔄  Données copiées vers OneDrive : ' + DATA_DIR);
}
migrateToSyncIfNeeded();

// ---------------------------------------------------------------------------
//  Couche de données : simples fichiers JSON (aucune base de données requise)
// ---------------------------------------------------------------------------
const FILES = {
  settings: path.join(DATA_DIR, 'settings.json'),
  contacts: path.join(DATA_DIR, 'contacts.json'),
  templates: path.join(DATA_DIR, 'templates.json'),
  sends: path.join(DATA_DIR, 'sends.json'),
};

const DEFAULTS = {
  settings: {
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true, user: 'partenaires@bifcoshop.com', pass: '' },
    from: { name: 'Bifco — Partenariats', email: 'partenaires@bifcoshop.com' },
    sendDelayMs: 4000,
    signature: '',
    company: '', // adresse postale (recommandé pour la conformité anti-pourriel)
    warmup: { enabled: false, startDate: null, maxPerDay: 50 },
    auto: {
      enabled: false,
      templateId: null,
      zones: [],
      zoneIndex: 0,
      radiusKm: 15,
      smallOnly: true,
      scrape: true,
      dailyLimit: 20,
      lastRunDate: null,
      lastResult: null,
    },
  },
  contacts: [],
  templates: [],
  sends: [],
};

async function ensureData() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  for (const [key, file] of Object.entries(FILES)) {
    if (!existsSync(file)) {
      await writeFile(file, JSON.stringify(DEFAULTS[key], null, 2), 'utf8');
    }
  }
  // Crée un modèle de courriel par défaut au premier lancement
  const tpls = await load('templates');
  if (tpls.length === 0) {
    tpls.push({
      id: randomUUID(),
      name: 'Invitation partenariat (défaut)',
      subject: 'Partenariat installation moteurs — {{ville}}',
      body:
        'Bonjour,\n\n' +
        "Je m'appelle [Ton nom] de Bifco. Nous cherchons des garages fiables dans la région de {{ville}} " +
        'pour installer nos moteurs auprès de nos clients.\n\n' +
        'Nous fournissons les moteurs et les clients — vous réalisez l\'installation, rémunérée à chaque pose. ' +
        'Aucun engagement, aucun frais pour rejoindre le réseau.\n\n' +
        'Est-ce que ça pourrait vous intéresser ? Je peux vous appeler pour en discuter 5 minutes.\n\n' +
        'Au plaisir,',
      updatedAt: new Date().toISOString(),
    });
    await save('templates', tpls);
  }
}

async function load(key) {
  try {
    return JSON.parse(await readFile(FILES[key], 'utf8'));
  } catch {
    return structuredClone(DEFAULTS[key]);
  }
}
async function save(key, value) {
  await writeFile(FILES[key], JSON.stringify(value, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
//  Utilitaires HTTP
// ---------------------------------------------------------------------------
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 5_000_000) reject(new Error('Corps de requête trop volumineux'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('JSON invalide'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!full.startsWith(PUBLIC_DIR) || !existsSync(full)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Introuvable');
  }
  const ext = path.extname(full).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(readFileSync(full));
}

// ---------------------------------------------------------------------------
//  Recherche de garages : Nominatim (géocodage) + Overpass (annuaire OSM)
// ---------------------------------------------------------------------------
async function fetchWithTimeout(url, opts = {}, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: { 'User-Agent': APP_UA, ...(opts.headers || {}) },
    });
  } finally {
    clearTimeout(t);
  }
}

async function geocode(zone) {
  const url =
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
    encodeURIComponent(zone);
  const r = await fetchWithTimeout(url, {}, 15000);
  if (!r.ok) throw new Error('Géocodage indisponible (Nominatim ' + r.status + ')');
  const arr = await r.json();
  if (!arr.length) throw new Error('Zone introuvable : « ' + zone + ' »');
  return {
    lat: parseFloat(arr[0].lat),
    lon: parseFloat(arr[0].lon),
    label: arr[0].display_name,
  };
}

async function overpassGarages(lat, lon, radiusKm, includeDealers = false) {
  const R = Math.round(Math.max(1, Math.min(60, radiusKm)) * 1000);
  // Concessionnaires (shop=car) inclus seulement si demandé.
  const dealerLine = includeDealers
    ? `  nwr["shop"="car"](around:${R},${lat},${lon});\n`
    : '';
  const q = `[out:json][timeout:90];
(
  nwr["shop"="car_repair"](around:${R},${lat},${lon});
  nwr["craft"="car_repair"](around:${R},${lat},${lon});
  nwr["shop"="tyres"](around:${R},${lat},${lon});
  nwr["shop"="motorcycle_repair"](around:${R},${lat},${lon});
  nwr["shop"="car_parts"](around:${R},${lat},${lon});
  nwr["service:vehicle:repairs"~"."](around:${R},${lat},${lon});
  nwr["service:vehicle:car_repair"~"."](around:${R},${lat},${lon});
  nwr["service:vehicle:tyres"~"."](around:${R},${lat},${lon});
  nwr["craft"="agricultural_engines"](around:${R},${lat},${lon});
${dealerLine});
out center tags;`;
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];
  let lastErr;
  for (const ep of endpoints) {
    try {
      const r = await fetchWithTimeout(
        ep,
        { method: 'POST', body: 'data=' + encodeURIComponent(q) },
        70000
      );
      if (!r.ok) throw new Error('Overpass ' + r.status);
      const j = await r.json();
      return j.elements || [];
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error('Annuaire indisponible : ' + (lastErr?.message || 'inconnu'));
}

function tagEmail(t) {
  return t['email'] || t['contact:email'] || '';
}
function tagWebsite(t) {
  let w = t['website'] || t['contact:website'] || t['url'] || '';
  if (w && !/^https?:\/\//i.test(w)) w = 'http://' + w;
  return w;
}
function tagPhone(t) {
  return t['phone'] || t['contact:phone'] || t['contact:mobile'] || '';
}
function tagAddress(t) {
  const parts = [
    [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '),
    t['addr:city'],
    t['addr:postcode'],
  ].filter(Boolean);
  return parts.join(', ');
}

// Marques de concessionnaires + grandes chaînes (pour ne garder que les petits garages)
const DEALER_BRANDS = new RegExp(
  '\\b(' +
    // constructeurs automobiles
    'ford|chevrolet|chevy|gmc|buick|cadillac|chrysler|dodge|jeep|ram|toyota|honda|' +
    'hyundai|kia|nissan|infiniti|mazda|subaru|volkswagen|vw|audi|bmw|mercedes|' +
    'lexus|acura|volvo|mitsubishi|porsche|tesla|genesis|lincoln|fiat|alfa|jaguar|' +
    'land ?rover|mini cooper|maserati|bentley|' +
    // mots-clés concessionnaire
    'concessionnaire|dealer|automobiles? (inc|ltée|ltee)|groupe auto|auto ?group|' +
    // grandes chaînes (pas des garages de quartier indépendants)
    'canadian tire|point s|napa|midas|monsieur muffler|monsieur silencieux|speedy|' +
    'mr ?lube|jiffy ?lube|kal ?tire|uniroyal|fountain tire|docteur du pare|' +
    'fix ?auto|carstar|maaco|lebeau|vitroplus|vitro ?plus|ziebart|novus|belron|globocam|' +
    'costco|walmart|petro-?canada|ultramar|esso' +
  ')\\b',
  'i'
);

function isDealerOrChain(name) {
  return DEALER_BRANDS.test(name || '');
}

function normalizeGarage(el) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  return {
    name: t.name || t.operator || 'Garage sans nom',
    email: tagEmail(t).split(';')[0].trim().toLowerCase(),
    website: tagWebsite(t),
    phone: tagPhone(t),
    city: t['addr:city'] || '',
    address: tagAddress(t),
    lat,
    lon,
  };
}

// --- Extraction de courriels depuis les sites web -------------------------
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const JUNK_EMAIL = /(sentry|wixpress|example\.|@example|exemple\.|@domaine|votredomaine|votre-domaine|yourdomain|domain\.com|email\.com|no-?reply|\.png|\.jpg|\.jpeg|\.gif|\.webp|\.svg|@2x|@3x|@sentry)/i;

function extractEmails(html, siteHost) {
  const found = new Set();
  const matches = html.match(EMAIL_RE) || [];
  for (let m of matches) {
    m = m.toLowerCase().replace(/\.$/, '');
    if (JUNK_EMAIL.test(m)) continue;
    if (m.length > 60) continue;
    found.add(m);
  }
  const arr = [...found];
  // Priorise une adresse du même domaine que le site
  if (siteHost) {
    const dom = siteHost.replace(/^www\./, '');
    arr.sort((a, b) => (b.endsWith(dom) ? 1 : 0) - (a.endsWith(dom) ? 1 : 0));
  }
  return arr;
}

async function fetchHtml(url, ms = 8000) {
  const r = await fetchWithTimeout(url, {}, ms);
  if (!r.ok) return '';
  const ct = r.headers.get('content-type') || '';
  if (!/text|html/i.test(ct)) return '';
  return (await r.text()).slice(0, 500000);
}

// Trouve les vrais liens « contact / nous-joindre / à propos » dans une page
function findContactLinks(html, base) {
  const links = new Set();
  const re = /href\s*=\s*["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null && links.size < 6) {
    const href = m[1];
    if (/contact|joindre|coordonn|about|a-?propos|rejoi|nous/i.test(href)) {
      try {
        links.add(new URL(href, base).href);
      } catch {
        /* href invalide */
      }
    }
  }
  return [...links];
}

async function scrapeEmailFromSite(website) {
  let base, host;
  try {
    base = new URL(website);
    host = base.host;
  } catch {
    return '';
  }
  const found = new Set();
  const tried = new Set();

  async function scan(url) {
    if (!url || tried.has(url) || tried.size >= 7) return '';
    tried.add(url);
    try {
      const html = await fetchHtml(url);
      if (!html) return '';
      for (const e of extractEmails(html, host)) found.add(e);
      return html;
    } catch {
      return '';
    }
  }

  // 1) Page d'accueil (souvent le courriel est dans le pied de page)
  const home = await scan(website);

  // 2) Si rien, suivre les vrais liens « contact » + quelques chemins classiques
  if (!found.size) {
    const guessed = ['/contact', '/contactez-nous', '/nous-joindre', '/coordonnees', '/a-propos', '/contact-us']
      .map((p) => {
        try {
          return new URL(p, base).href;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const real = home ? findContactLinks(home, base) : [];
    for (const url of [...real, ...guessed]) {
      await scan(url);
      if (found.size) break;
    }
  }

  if (!found.size) return '';
  const dom = host.replace(/^www\./, '');
  const arr = [...found].sort((a, b) => (b.endsWith(dom) ? 1 : 0) - (a.endsWith(dom) ? 1 : 0));
  return arr[0];
}

async function pool(items, worker, concurrency = 5) {
  const results = new Array(items.length);
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await worker(items[idx], idx);
      } catch {
        results[idx] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

// ---------------------------------------------------------------------------
//  Rendu des modèles de courriel
// ---------------------------------------------------------------------------
function renderTemplate(str, contact) {
  const map = {
    nom: contact.name || 'Madame, Monsieur',
    ville: contact.city || 'votre région',
    courriel: contact.email || '',
    telephone: contact.phone || '',
    adresse: contact.address || '',
  };
  return String(str || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) =>
    k in map ? map[k] : m
  );
}

function buildEmailBody(bodyText, settings) {
  const sig = settings.signature ? '\n\n' + settings.signature : '';
  const addr = settings.company ? '\n' + settings.company : '';
  const unsub =
    '\n\n—\nVous recevez ce courriel car votre garage figure dans un annuaire public. ' +
    'Pour ne plus être contacté, répondez avec « DÉSABONNEMENT ».' +
    addr;
  return bodyText + sig + unsub;
}

// ---------------------------------------------------------------------------
//  Envoi SMTP
// ---------------------------------------------------------------------------
function makeTransport(settings) {
  const s = settings.smtp;
  if (!s.host || !s.user) throw new Error('SMTP non configuré (voir Réglages)');
  return nodemailer.createTransport({
    host: s.host,
    port: Number(s.port) || 587,
    secure: !!s.secure, // true = 465, false = 587 (STARTTLS)
    auth: { user: s.user, pass: s.pass },
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
//  Réchauffement : plafond quotidien qui monte progressivement
// ---------------------------------------------------------------------------
function startOfTodayMs() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}
function rampCap(day) {
  if (day < 7) return 10; // semaine 1
  if (day < 14) return 20; // semaine 2
  if (day < 21) return 30; // semaine 3
  if (day < 28) return 40; // semaine 4
  return 50; // ensuite
}
function countSentToday(sends) {
  const start = startOfTodayMs();
  let n = 0;
  for (const s of sends) {
    if (s.status === 'ok' && new Date(s.at).getTime() >= start) n++;
  }
  return n;
}
function warmupInfo(settings, sends) {
  const w = settings.warmup || {};
  const usedToday = countSentToday(sends);
  if (!w.enabled) {
    return { enabled: false, cap: Infinity, usedToday, remaining: Infinity, day: 0 };
  }
  const start = w.startDate ? new Date(w.startDate + 'T00:00:00') : new Date();
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const day = Math.max(0, Math.round((startOfTodayMs() - startDay) / 86400000));
  const cap = Math.min(rampCap(day), Number(w.maxPerDay) || 50);
  return { enabled: true, cap, usedToday, remaining: Math.max(0, cap - usedToday), day };
}

// ---------------------------------------------------------------------------
//  Fonctions réutilisables : recherche, import, envoi
// ---------------------------------------------------------------------------
async function searchGarages(
  zone,
  { radiusKm = 15, smallOnly = true, scrape = true, maxScrape = 200 } = {}
) {
  const geo = await geocode(zone.trim());
  const raw = await overpassGarages(geo.lat, geo.lon, Number(radiusKm) || 15, !smallOnly);
  let list = raw.map(normalizeGarage);
  let excludedBig = 0;
  if (smallOnly) {
    const before = list.length;
    list = list.filter((g) => !isDealerOrChain(g.name));
    excludedBig = before - list.length;
  }
  const seen = new Set();
  list = list.filter((g) => {
    const k = (g.name + '|' + g.address + '|' + g.phone).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  list.forEach((g) => (g.zone = zone.trim()));
  let scraped = 0;
  if (scrape) {
    const targets = list.filter((g) => !g.email && g.website).slice(0, maxScrape);
    await pool(
      targets,
      async (g) => {
        const em = await scrapeEmailFromSite(g.website);
        if (em) {
          g.email = em;
          g.emailSource = 'site';
          scraped++;
        }
      },
      8
    );
  }
  return { zone: zone.trim(), center: geo, list, excludedBig, scraped };
}

// Ajoute des garages à la liste de contacts (dédoublonnage par courriel). Mute `contacts`.
function importItems(items, contacts) {
  const byEmail = new Map(contacts.filter((c) => c.email).map((c) => [c.email, c]));
  let added = 0,
    skipped = 0;
  for (const it of items) {
    const email = (it.email || '').trim().toLowerCase();
    if (!email || byEmail.has(email)) {
      skipped++;
      continue;
    }
    const c = {
      id: randomUUID(),
      name: it.name || '',
      email,
      phone: it.phone || '',
      website: it.website || '',
      city: it.city || '',
      zone: it.zone || '',
      address: it.address || '',
      source: it.emailSource === 'site' ? 'site web' : 'annuaire',
      status: 'nouveau',
      notes: '',
      addedAt: new Date().toISOString(),
    };
    contacts.push(c);
    byEmail.set(email, c);
    added++;
  }
  return { added, skipped };
}

// Envoie le courriel à une liste de contacts déjà plafonnée. Mute `sends` et `contacts`.
async function deliverToContacts(settings, tpl, targets, sends, contacts) {
  const transport = makeTransport(settings);
  const fromLine = settings.from.name
    ? `"${settings.from.name}" <${settings.from.email}>`
    : settings.from.email;
  const results = [];
  for (let i = 0; i < targets.length; i++) {
    const c = targets[i];
    const subject = renderTemplate(tpl.subject, c);
    const text = buildEmailBody(renderTemplate(tpl.body, c), settings);
    const rec = {
      id: randomUUID(),
      contactId: c.id,
      to: c.email,
      name: c.name,
      zone: c.zone || c.city || '',
      subject,
      status: 'ok',
      error: '',
      at: new Date().toISOString(),
    };
    try {
      const info = await transport.sendMail({ from: fromLine, to: c.email, subject, text });
      rec.messageId = info.messageId || '';
      const idx = contacts.findIndex((x) => x.id === c.id);
      if (idx >= 0 && contacts[idx].status === 'nouveau') contacts[idx].status = 'contacté';
    } catch (e) {
      rec.status = 'erreur';
      rec.error = e.message;
    }
    results.push(rec);
    sends.push(rec);
    if (i < targets.length - 1 && settings.sendDelayMs > 0) {
      await sleep(Number(settings.sendDelayMs) || 0);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
//  Automatisation quotidienne : trouver de nouveaux garages puis envoyer le quota
// ---------------------------------------------------------------------------
let autoBusy = false;
async function runAutoOnce(force = false) {
  if (autoBusy) return { skipped: 'busy' };
  const settings = await load('settings');
  const auto = settings.auto || {};
  if (!force && !auto.enabled) return { skipped: 'disabled' };
  if (!force && auto.lastRunDate === todayStr()) return { skipped: 'already-today' };

  const templates = await load('templates');
  const tpl = templates.find((t) => t.id === auto.templateId) || templates[0];
  if (!tpl) return { skipped: 'no-template' };

  autoBusy = true;
  try {
    let contacts = await load('contacts');
    const sends = await load('sends');
    const wu = warmupInfo(settings, sends);
    const remaining = wu.enabled
      ? wu.remaining
      : Math.max(0, (Number(auto.dailyLimit) || 20) - countSentToday(sends));

    // Trouve de nouveaux garages si pas assez de « nouveaux » contacts pour remplir le quota
    const searched = [];
    const isNew = (c) => c.email && c.status === 'nouveau';
    const zones = Array.isArray(auto.zones) ? auto.zones.filter((z) => z && z.trim()) : [];
    if (remaining > 0 && zones.length) {
      let zi = auto.zoneIndex || 0;
      let loops = 0;
      while (contacts.filter(isNew).length < remaining && loops < zones.length) {
        const zone = zones[zi % zones.length];
        zi++;
        loops++;
        try {
          const { list } = await searchGarages(zone, {
            radiusKm: auto.radiusKm || 15,
            smallOnly: auto.smallOnly !== false,
            scrape: auto.scrape !== false,
          });
          const r = importItems(list.filter((g) => g.email), contacts);
          searched.push(`${zone} (+${r.added})`);
        } catch (e) {
          searched.push(`${zone} (erreur)`);
        }
      }
      settings.auto.zoneIndex = zi % zones.length;
    }

    const targets = contacts.filter(isNew).slice(0, Math.max(0, remaining));
    let results = [];
    if (targets.length) {
      results = await deliverToContacts(settings, tpl, targets, sends, contacts);
    }
    const ok = results.filter((r) => r.status === 'ok').length;

    settings.auto = settings.auto || {};
    settings.auto.lastRunDate = todayStr();
    settings.auto.lastResult = {
      at: new Date().toISOString(),
      sent: ok,
      failed: results.length - ok,
      zonesSearched: searched,
      template: tpl.name,
      note:
        remaining <= 0
          ? 'Quota du jour déjà atteint'
          : targets.length
          ? ''
          : 'Aucun nouveau contact à joindre (ajoute des zones)',
    };
    await save('sends', sends);
    await save('contacts', contacts);
    await save('settings', settings);
    return settings.auto.lastResult;
  } catch (e) {
    return { error: e.message };
  } finally {
    autoBusy = false;
  }
}

// ---------------------------------------------------------------------------
//  Entonnoir (funnel) : classe les leads par région et par stade
// ---------------------------------------------------------------------------
const FUNNEL_STAGES = [
  { key: 'nouveau', label: 'Nouveau', hint: '0 courriel' },
  { key: 'contacte1', label: '1er courriel', hint: '1 courriel envoyé' },
  { key: 'relance', label: 'Relancé', hint: '2 courriels' },
  { key: 'multi', label: 'Multi-relance', hint: '3 courriels ou +' },
  { key: 'repondu', label: 'A répondu', hint: 'réponse reçue' },
  { key: 'partenaire', label: 'Partenaire', hint: 'converti' },
];

function contactStage(contact, emailsSent) {
  if (contact.status === 'partenaire') return 'partenaire';
  if (contact.status === 'répondu') return 'repondu';
  if (emailsSent >= 3) return 'multi';
  if (emailsSent === 2) return 'relance';
  if (emailsSent === 1) return 'contacte1';
  return 'nouveau';
}

function buildFunnel(contacts, sends) {
  const sentByContact = {};
  for (const s of sends) {
    if (s.status === 'ok' && s.contactId)
      sentByContact[s.contactId] = (sentByContact[s.contactId] || 0) + 1;
  }
  const enriched = contacts.map((c) => {
    const emailsSent = sentByContact[c.id] || 0;
    return { ...c, emailsSent, stage: contactStage(c, emailsSent) };
  });
  const totals = {};
  for (const st of FUNNEL_STAGES) totals[st.key] = 0;
  const regionMap = {};
  for (const c of enriched) {
    const region = (c.zone || c.city || '—').trim() || '—';
    if (!regionMap[region]) {
      regionMap[region] = { region, total: 0, byStage: {} };
      for (const st of FUNNEL_STAGES) regionMap[region].byStage[st.key] = 0;
    }
    regionMap[region].byStage[c.stage]++;
    regionMap[region].total++;
    totals[c.stage]++;
  }
  return {
    stages: FUNNEL_STAGES,
    totals,
    regions: Object.values(regionMap).sort((a, b) => b.total - a.total),
    contacts: enriched,
  };
}

// ---------------------------------------------------------------------------
//  Routes API
// ---------------------------------------------------------------------------
async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method;

  // --- Authentification ---
  if (p === '/api/authstate' && method === 'GET') {
    return sendJSON(res, 200, { authEnabled: AUTH_ENABLED, authed: isAuthed(req) });
  }
  if (p === '/api/login' && method === 'POST') {
    const body = await readBody(req);
    if (AUTH_ENABLED && typeof body.password === 'string') {
      const a = Buffer.from(body.password);
      const b = Buffer.from(AUTH_PASSWORD);
      const ok = a.length === b.length && timingSafeEqual(a, b);
      if (ok) {
        const exp = Date.now() + AUTH_TTL_MS;
        res.setHeader(
          'Set-Cookie',
          `pg_auth=${signToken(exp)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${AUTH_TTL_MS / 1000}`
        );
        return sendJSON(res, 200, { ok: true });
      }
    }
    return sendJSON(res, 200, { ok: false, error: 'Mot de passe incorrect' });
  }
  if (p === '/api/logout' && method === 'POST') {
    res.setHeader('Set-Cookie', 'pg_auth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return sendJSON(res, 200, { ok: true });
  }
  // Toutes les autres routes API exigent d'être connecté (si l'auth est activée)
  if (AUTH_ENABLED && !isAuthed(req)) {
    return sendJSON(res, 401, { error: 'Non authentifié' });
  }

  // --- État général ---
  if (p === '/api/state' && method === 'GET') {
    const [settings, contacts, sends] = await Promise.all([
      load('settings'),
      load('contacts'),
      load('sends'),
    ]);
    return sendJSON(res, 200, {
      smtpConfigured: !!(settings.smtp.host && settings.smtp.user),
      contacts: contacts.length,
      sends: sends.length,
      syncMode: SYNC_MODE,
      dataDir: DATA_DIR,
    });
  }

  // --- Réglages ---
  if (p === '/api/settings' && method === 'GET') {
    const s = await load('settings');
    const masked = structuredClone(s);
    masked.smtp.pass = s.smtp.pass ? '********' : '';
    return sendJSON(res, 200, masked);
  }
  if (p === '/api/settings' && method === 'POST') {
    const body = await readBody(req);
    const cur = await load('settings');
    const next = {
      ...cur,
      ...body,
      smtp: { ...cur.smtp, ...(body.smtp || {}) },
      from: { ...cur.from, ...(body.from || {}) },
      warmup: { ...(cur.warmup || {}), ...(body.warmup || {}) },
      auto: { ...(cur.auto || {}), ...(body.auto || {}) },
    };
    // Ne pas écraser le mot de passe si l'utilisateur laisse le masque
    if (body.smtp && (body.smtp.pass === '********' || body.smtp.pass === undefined)) {
      next.smtp.pass = cur.smtp.pass;
    }
    // Au moment où l'on active le réchauffement, on fixe le jour de départ
    if (next.warmup.enabled && !next.warmup.startDate) {
      next.warmup.startDate = todayStr();
    }
    await save('settings', next);
    return sendJSON(res, 200, { ok: true });
  }
  if (p === '/api/warmup' && method === 'GET') {
    const [settings, sends] = await Promise.all([load('settings'), load('sends')]);
    const info = warmupInfo(settings, sends);
    return sendJSON(res, 200, info);
  }

  // --- Automatisation quotidienne ---
  if (p === '/api/auto' && method === 'GET') {
    const [settings, sends] = await Promise.all([load('settings'), load('sends')]);
    const auto = settings.auto || {};
    const wu = warmupInfo(settings, sends);
    const quota = wu.enabled
      ? wu.remaining
      : Math.max(0, (Number(auto.dailyLimit) || 20) - countSentToday(sends));
    return sendJSON(res, 200, {
      auto,
      ranToday: auto.lastRunDate === todayStr(),
      quotaToday: quota,
      warmupEnabled: wu.enabled,
      busy: autoBusy,
    });
  }
  if (p === '/api/auto' && method === 'POST') {
    const body = await readBody(req);
    const settings = await load('settings');
    const cur = settings.auto || {};
    settings.auto = {
      ...cur,
      enabled: body.enabled ?? cur.enabled,
      templateId: body.templateId ?? cur.templateId,
      zones: Array.isArray(body.zones) ? body.zones : cur.zones || [],
      radiusKm: body.radiusKm ?? cur.radiusKm ?? 15,
      smallOnly: body.smallOnly ?? cur.smallOnly ?? true,
      scrape: body.scrape ?? cur.scrape ?? true,
      dailyLimit: body.dailyLimit ?? cur.dailyLimit ?? 20,
    };
    await save('settings', settings);
    return sendJSON(res, 200, { ok: true });
  }
  if (p === '/api/auto/run' && method === 'POST') {
    const result = await runAutoOnce(true);
    return sendJSON(res, 200, result);
  }
  if (p === '/api/settings/test' && method === 'POST') {
    try {
      const s = await load('settings');
      const t = makeTransport(s);
      await t.verify();
      return sendJSON(res, 200, { ok: true, message: 'Connexion SMTP réussie ✓' });
    } catch (e) {
      return sendJSON(res, 200, { ok: false, message: 'Échec : ' + e.message });
    }
  }
  // Courriel de test : un seul envoi vers soi-même. Ne compte PAS dans le
  // réchauffement et n'est PAS enregistré dans le journal des envois.
  if (p === '/api/settings/testmail' && method === 'POST') {
    try {
      const body = await readBody(req);
      const s = await load('settings');
      const to = (body.to || s.from.email || s.smtp.user || '').trim();
      if (!to) throw new Error('Aucune adresse de destination');
      const t = makeTransport(s);
      const fromLine = s.from.name ? `"${s.from.name}" <${s.from.email}>` : s.from.email;
      const info = await t.sendMail({
        from: fromLine,
        to,
        subject: 'Test ✓ — App Prospection Garages',
        text:
          'Bravo ! Si tu lis ce courriel, ta configuration d\'envoi fonctionne.\n\n' +
          'Vérifie deux choses :\n' +
          '1) Ce message est-il arrivé dans la boîte de réception (et non dans les pourriels) ?\n' +
          '2) Le nom d\'expéditeur et l\'adresse sont-ils corrects ?\n\n' +
          'Tu peux maintenant lancer tes vraies campagnes.\n\n' +
          '— App Prospection Garages',
      });
      return sendJSON(res, 200, {
        ok: true,
        message: 'Courriel de test envoyé à ' + to + ' ✓ — vérifie ta boîte (et les pourriels).',
        messageId: info.messageId || '',
      });
    } catch (e) {
      return sendJSON(res, 200, { ok: false, message: 'Échec : ' + e.message });
    }
  }

  // --- Recherche de garages ---
  if (p === '/api/search' && method === 'POST') {
    const { zone, radiusKm = 15, scrape = true, maxScrape = 200, smallOnly = true } =
      await readBody(req);
    if (!zone || !zone.trim()) return sendJSON(res, 400, { error: 'Zone requise' });
    try {
      const { center, list, excludedBig, scraped } = await searchGarages(zone, {
        radiusKm: Number(radiusKm) || 15,
        smallOnly,
        scrape,
        maxScrape,
      });
      return sendJSON(res, 200, {
        zone: zone.trim(),
        center,
        total: list.length,
        withEmail: list.filter((g) => g.email).length,
        scrapedFound: scraped,
        excludedBig,
        results: list,
      });
    } catch (e) {
      return sendJSON(res, 200, { error: e.message });
    }
  }

  // --- Contacts ---
  if (p === '/api/contacts' && method === 'GET') {
    return sendJSON(res, 200, await load('contacts'));
  }
  if (p === '/api/funnel' && method === 'GET') {
    const [contacts, sends] = await Promise.all([load('contacts'), load('sends')]);
    return sendJSON(res, 200, buildFunnel(contacts, sends));
  }
  if (p === '/api/contacts/import' && method === 'POST') {
    const { items = [] } = await readBody(req);
    const contacts = await load('contacts');
    const { added, skipped } = importItems(items, contacts);
    await save('contacts', contacts);
    return sendJSON(res, 200, { added, skipped, total: contacts.length });
  }
  if (p === '/api/contacts/save' && method === 'POST') {
    const body = await readBody(req);
    const contacts = await load('contacts');
    if (body.id) {
      const idx = contacts.findIndex((c) => c.id === body.id);
      if (idx >= 0) contacts[idx] = { ...contacts[idx], ...body };
    } else {
      contacts.push({
        id: randomUUID(),
        status: 'nouveau',
        addedAt: new Date().toISOString(),
        source: 'manuel',
        ...body,
        email: (body.email || '').trim().toLowerCase(),
      });
    }
    await save('contacts', contacts);
    return sendJSON(res, 200, { ok: true });
  }
  if (p === '/api/contacts/delete' && method === 'POST') {
    const { ids = [] } = await readBody(req);
    let contacts = await load('contacts');
    contacts = contacts.filter((c) => !ids.includes(c.id));
    await save('contacts', contacts);
    return sendJSON(res, 200, { ok: true, total: contacts.length });
  }

  // --- Modèles de courriel ---
  if (p === '/api/templates' && method === 'GET') {
    return sendJSON(res, 200, await load('templates'));
  }
  if (p === '/api/templates/save' && method === 'POST') {
    const body = await readBody(req);
    const templates = await load('templates');
    if (body.id) {
      const idx = templates.findIndex((t) => t.id === body.id);
      if (idx >= 0)
        templates[idx] = { ...templates[idx], ...body, updatedAt: new Date().toISOString() };
    } else {
      templates.push({
        id: randomUUID(),
        name: body.name || 'Sans titre',
        subject: body.subject || '',
        body: body.body || '',
        updatedAt: new Date().toISOString(),
      });
    }
    await save('templates', templates);
    return sendJSON(res, 200, { ok: true });
  }
  if (p === '/api/templates/delete' && method === 'POST') {
    const { id } = await readBody(req);
    let templates = await load('templates');
    templates = templates.filter((t) => t.id !== id);
    await save('templates', templates);
    return sendJSON(res, 200, { ok: true });
  }

  // --- Aperçu ---
  if (p === '/api/preview' && method === 'POST') {
    const { templateId, contactId } = await readBody(req);
    const [templates, contacts, settings] = await Promise.all([
      load('templates'),
      load('contacts'),
      load('settings'),
    ]);
    const tpl = templates.find((t) => t.id === templateId);
    const contact =
      contacts.find((c) => c.id === contactId) ||
      { name: 'Garage Exemple', city: 'Montréal', email: 'exemple@garage.com' };
    if (!tpl) return sendJSON(res, 400, { error: 'Modèle introuvable' });
    return sendJSON(res, 200, {
      to: contact.email,
      subject: renderTemplate(tpl.subject, contact),
      body: buildEmailBody(renderTemplate(tpl.body, contact), settings),
    });
  }

  // --- Envoi ---
  if (p === '/api/send' && method === 'POST') {
    const { templateId, contactIds = [] } = await readBody(req);
    const [templates, contacts, settings, sends] = await Promise.all([
      load('templates'),
      load('contacts'),
      load('settings'),
      load('sends'),
    ]);
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return sendJSON(res, 400, { error: 'Modèle introuvable' });
    let transport;
    try {
      transport = makeTransport(settings);
    } catch (e) {
      return sendJSON(res, 400, { error: e.message });
    }
    let targets = contacts.filter((c) => contactIds.includes(c.id) && c.email);

    // Réchauffement : ne pas dépasser le plafond quotidien
    let held = 0;
    const wu = warmupInfo(settings, sends);
    if (wu.enabled) {
      if (wu.remaining <= 0) {
        return sendJSON(res, 200, {
          sent: 0,
          failed: 0,
          held: targets.length,
          capReached: true,
          cap: wu.cap,
          usedToday: wu.usedToday,
          results: [],
        });
      }
      if (targets.length > wu.remaining) {
        held = targets.length - wu.remaining;
        targets = targets.slice(0, wu.remaining);
      }
    }

    const results = await deliverToContacts(settings, tpl, targets, sends, contacts);
    await Promise.all([save('sends', sends), save('contacts', contacts)]);
    const ok = results.filter((r) => r.status === 'ok').length;
    return sendJSON(res, 200, {
      sent: ok,
      failed: results.length - ok,
      held,
      cap: wu.enabled ? wu.cap : null,
      usedToday: wu.usedToday + ok,
      results,
    });
  }

  // --- Journal des envois ---
  if (p === '/api/sends' && method === 'GET') {
    const sends = await load('sends');
    return sendJSON(res, 200, sends.slice(-500).reverse());
  }

  // --- Statistiques ---
  if (p === '/api/stats' && method === 'GET') {
    const [sends, contacts] = await Promise.all([load('sends'), load('contacts')]);
    const now = new Date();
    const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startWeek = startDay - 6 * 86400000;
    let today = 0,
      week = 0,
      ok = 0,
      err = 0;
    const byZone = {};
    for (const s of sends) {
      const t = new Date(s.at).getTime();
      if (t >= startDay) today++;
      if (t >= startWeek) week++;
      if (s.status === 'ok') ok++;
      else err++;
      const z = s.zone || '—';
      byZone[z] = (byZone[z] || 0) + 1;
    }
    const byStatus = {};
    for (const c of contacts) byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    return sendJSON(res, 200, {
      totalSends: sends.length,
      today,
      week,
      ok,
      err,
      contacts: contacts.length,
      byZone: Object.entries(byZone).sort((a, b) => b[1] - a[1]),
      byStatus,
    });
  }

  return sendJSON(res, 404, { error: 'Route inconnue' });
}

// ---------------------------------------------------------------------------
//  Serveur
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url);
    }
    // Si l'auth est active et qu'on n'est pas connecté, on sert la page de connexion
    // (elle est autonome : styles et script inclus, aucun autre fichier requis).
    if (AUTH_ENABLED && !isAuthed(req) && url.pathname !== '/login.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(readFileSync(path.join(PUBLIC_DIR, 'login.html')));
    }
    return serveStatic(req, res);
  } catch (e) {
    sendJSON(res, 500, { error: e.message || 'Erreur serveur' });
  }
});

await ensureData();
server.listen(PORT, () => {
  console.log('');
  console.log('  ✅  App Courriels Garages démarrée');
  console.log(
    SYNC_MODE
      ? '  🔄  Synchronisation OneDrive ACTIVE (données partagées entre tes PC)'
      : '  💾  Données locales (pas de synchronisation)'
  );
  console.log('  👉  Ouvre ton navigateur à : http://localhost:' + PORT);
  console.log('');
  console.log('  (Laisse cette fenêtre ouverte pendant que tu utilises l\'app.)');
});

// Automatisation : vérifie au démarrage (après 10 s) puis toutes les 15 minutes.
// runAutoOnce() ne s'exécute réellement qu'une fois par jour si l'auto est activée.
setTimeout(() => {
  runAutoOnce().then((r) => {
    if (r && !r.skipped) console.log('  🤖  Automatisation :', JSON.stringify(r));
  }).catch(() => {});
}, 10000);
setInterval(() => {
  runAutoOnce().catch(() => {});
}, 15 * 60 * 1000);
