// ===== Utilitaires =====
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function api(path, method = 'GET', body) {
  const opt = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opt.body = JSON.stringify(body);
  const r = await fetch('/api' + path, opt);
  if (r.status === 401) {
    // Session expirée / non connecté → retour à la page de connexion
    window.location.href = '/login.html';
    return new Promise(() => {}); // stoppe la suite
  }
  return r.json();
}

let toastTimer;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = kind), 3200);
}

function setStatus(sel, msg, kind = '') {
  const el = $(sel);
  el.className = 'status ' + kind;
  el.innerHTML = msg;
}

// ===== Onglets =====
$$('#tabs button').forEach((b) =>
  b.addEventListener('click', () => {
    $$('#tabs button').forEach((x) => x.classList.remove('active'));
    $$('.tab').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    $('#tab-' + b.dataset.tab).classList.add('active');
    if (b.dataset.tab === 'contacts') loadContacts();
    if (b.dataset.tab === 'entonnoir') loadEntonnoir();
    if (b.dataset.tab === 'courriels') loadTemplates();
    if (b.dataset.tab === 'envoi') initSend();
    if (b.dataset.tab === 'stats') loadStats();
    if (b.dataset.tab === 'auto') loadAuto();
    if (b.dataset.tab === 'reglages') loadSettings();
  })
);

// ===== État global =====
async function refreshBadge() {
  const s = await api('/state');
  const badge = $('#smtp-badge');
  if (s.smtpConfigured) {
    badge.className = 'badge badge-ok';
    badge.textContent = 'SMTP prêt ✓';
  } else {
    badge.className = 'badge badge-warn';
    badge.textContent = 'SMTP non configuré';
  }
  const sync = $('#sync-badge');
  if (s.syncMode) sync.classList.remove('hidden');
  else sync.classList.add('hidden');

  // Bouton de déconnexion (seulement si l'app est hébergée avec mot de passe)
  try {
    const a = await api('/authstate');
    if (a.authEnabled) $('#btn-logout').classList.remove('hidden');
    else $('#btn-logout').classList.add('hidden');
  } catch (_) {}
}

$('#btn-logout').addEventListener('click', async () => {
  await api('/logout', 'POST');
  window.location.href = '/login.html';
});

// ================= RECHERCHE =================
let searchResults = [];

$('#btn-search').addEventListener('click', doSearch);
$('#zone').addEventListener('keydown', (e) => e.key === 'Enter' && doSearch());
$('#only-email').addEventListener('change', renderResults);

async function doSearch() {
  const zone = $('#zone').value.trim();
  if (!zone) return toast('Entre une zone', 'err');
  const radiusKm = $('#radius').value;
  const scrape = $('#scrape').checked;
  const smallOnly = $('#small-only').checked;
  $('#btn-search').disabled = true;
  setStatus('#search-status', '<span class="spinner"></span>Recherche en cours… (peut prendre 10–40 s)', 'working');
  $('#search-results').classList.add('hidden');
  try {
    const data = await api('/search', 'POST', { zone, radiusKm, scrape, smallOnly });
    if (data.error) throw new Error(data.error);
    searchResults = data.results;
    setStatus(
      '#search-status',
      (data.source === 'Google' ? '🔑 Google Maps · ' : '🗺️ OpenStreetMap (gratuit) · ') +
        `${data.total} garages trouvés · ${data.withEmail} avec courriel` +
        (scrape ? ` · ${data.scrapedFound} courriels trouvés sur les sites` : '') +
        (data.excludedBig ? ` · ${data.excludedBig} concessionnaires/chaînes exclus` : ''),
      'done'
    );
    $('#results-summary').textContent = `Résultats pour « ${data.zone} »`;
    $('#search-results').classList.remove('hidden');
    renderResults();
  } catch (e) {
    setStatus('#search-status', '⚠️ ' + e.message, 'error');
  } finally {
    $('#btn-search').disabled = false;
  }
}

function renderResults() {
  const onlyEmail = $('#only-email').checked;
  const rows = searchResults
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => (onlyEmail ? g.email : true));
  const tb = $('#results-table tbody');
  tb.innerHTML = rows
    .map(
      ({ g, i }) => `
    <tr>
      <td><input type="checkbox" class="rsel" data-i="${i}" ${g.email ? 'checked' : ''} ${g.email ? '' : 'disabled'}></td>
      <td>${esc(g.name)}</td>
      <td>${g.email ? esc(g.email) + (g.emailSource === 'site' ? ' <small style="color:var(--muted)">(site)</small>' : '') : '<span class="no-email">—</span>'}</td>
      <td>${esc(g.phone) || '—'}</td>
      <td>${esc(g.city) || '—'}</td>
      <td>${g.website ? `<a href="${esc(g.website)}" target="_blank" rel="noopener">lien</a>` : '—'}</td>
    </tr>`
    )
    .join('');
  if (!rows.length) tb.innerHTML = '<tr><td colspan="6" style="color:var(--muted)">Aucun garage avec courriel. Décoche le filtre pour voir tous les résultats.</td></tr>';
}

$('#btn-selall').addEventListener('click', () => {
  const boxes = $$('.rsel:not(:disabled)');
  const allChecked = boxes.every((b) => b.checked);
  boxes.forEach((b) => (b.checked = !allChecked));
});

$('#btn-import').addEventListener('click', async () => {
  const items = $$('.rsel:checked').map((b) => searchResults[+b.dataset.i]);
  if (!items.length) return toast('Coche au moins un garage', 'err');
  const r = await api('/contacts/import', 'POST', { items });
  toast(`${r.added} ajoutés · ${r.skipped} ignorés (doublons/sans courriel)`, 'ok');
  refreshBadge();
});

// ================= CONTACTS =================
let contacts = [];
let stageMeta = [];

function contactRegion(c) {
  return (c.zone || c.city || '—').trim() || '—';
}
function stageLabel(key) {
  const s = stageMeta.find((x) => x.key === key);
  return s ? s.label : key;
}

async function loadContacts() {
  const data = await api('/funnel');
  contacts = data.contacts;
  stageMeta = data.stages;
  $('#contacts-count').textContent = contacts.length;

  const regions = [...new Set(contacts.map(contactRegion))].sort();
  const rsel = $('#contacts-region');
  const curR = rsel.value;
  rsel.innerHTML =
    '<option value="">Toutes les régions</option>' +
    regions.map((r) => `<option ${curR === r ? 'selected' : ''}>${esc(r)}</option>`).join('');

  const ssel = $('#contacts-stage');
  const curS = ssel.value;
  ssel.innerHTML =
    '<option value="">Tous les stades</option>' +
    stageMeta.map((s) => `<option value="${s.key}" ${curS === s.key ? 'selected' : ''}>${esc(s.label)}</option>`).join('');

  renderContacts();
}

$('#contacts-filter').addEventListener('input', renderContacts);
$('#contacts-region').addEventListener('change', renderContacts);
$('#contacts-stage').addEventListener('change', renderContacts);

function renderContacts() {
  const f = $('#contacts-filter').value.toLowerCase();
  const region = $('#contacts-region').value;
  const stage = $('#contacts-stage').value;
  const list = contacts.filter((c) => {
    if (region && contactRegion(c) !== region) return false;
    if (stage && c.stage !== stage) return false;
    if (f && !(c.name + c.email + contactRegion(c) + c.status).toLowerCase().includes(f)) return false;
    return true;
  });
  const tb = $('#contacts-table tbody');
  tb.innerHTML = list
    .map(
      (c) => `
    <tr>
      <td><input type="checkbox" class="csel" data-id="${c.id}"></td>
      <td>${esc(c.name) || '—'}</td>
      <td>${esc(c.email)}</td>
      <td>${esc(contactRegion(c))}</td>
      <td style="text-align:center">${c.emailsSent || 0}</td>
      <td><span class="stage stage-${c.stage}">${esc(stageLabel(c.stage))}</span></td>
      <td><select class="cstatus" data-id="${c.id}">
        ${['nouveau', 'contacté', 'répondu', 'partenaire'].map((s) => `<option ${c.status === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select></td>
      <td><button class="ghost cdel" data-id="${c.id}">✕</button></td>
    </tr>`
    )
    .join('');
  if (!list.length) tb.innerHTML = '<tr><td colspan="8" style="color:var(--muted)">Aucun contact pour ce filtre.</td></tr>';

  $$('.cstatus').forEach((s) =>
    s.addEventListener('change', async () => {
      await api('/contacts/save', 'POST', { id: s.dataset.id, status: s.value });
      toast('Statut mis à jour', 'ok');
      loadContacts();
    })
  );
  $$('.cdel').forEach((b) =>
    b.addEventListener('click', async () => {
      await api('/contacts/delete', 'POST', { ids: [b.dataset.id] });
      loadContacts();
    })
  );
}

// ================= ENTONNOIR =================
const STAGE_COLORS = {
  nouveau: '#4f8cff',
  contacte1: '#ffb454',
  relance: '#ff9838',
  multi: '#ff5c72',
  repondu: '#3ecf8e',
  partenaire: '#2fae74',
};

async function loadEntonnoir() {
  const data = await api('/funnel');
  const maxN = Math.max(1, ...data.stages.map((s) => data.totals[s.key]));
  $('#funnel-bars').innerHTML = data.stages
    .map((s) => {
      const n = data.totals[s.key] || 0;
      const w = (n / maxN) * 100;
      return `<div class="funnel-row">
        <div class="fr-label">${esc(s.label)}<small>${esc(s.hint)}</small></div>
        <div class="fr-track"><div class="fr-fill" style="width:${w}%;background:${STAGE_COLORS[s.key]}">${n > 0 ? n : ''}</div></div>
        <div class="fr-n">${n}</div>
      </div>`;
    })
    .join('');

  const thead = $('#funnel-table thead');
  thead.innerHTML =
    '<tr><th>Région</th>' +
    data.stages.map((s) => `<th class="num" title="${esc(s.hint)}">${esc(s.label)}</th>`).join('') +
    '<th class="num">Total</th></tr>';
  const tb = $('#funnel-table tbody');
  tb.innerHTML =
    data.regions
      .map(
        (r) =>
          `<tr><td><b>${esc(r.region)}</b></td>` +
          data.stages
            .map((s) => {
              const n = r.byStage[s.key] || 0;
              return `<td class="num ${n ? '' : 'zero'}">${n || '·'}</td>`;
            })
            .join('') +
          `<td class="num"><b>${r.total}</b></td></tr>`
      )
      .join('') ||
    `<tr><td colspan="${data.stages.length + 2}" style="color:var(--muted)">Aucun lead. Va dans Recherche.</td></tr>`;
}

$('#btn-del-contacts').addEventListener('click', async () => {
  const ids = $$('.csel:checked').map((b) => b.dataset.id);
  if (!ids.length) return toast('Coche des contacts à supprimer', 'err');
  if (!confirm(`Supprimer ${ids.length} contact(s) ?`)) return;
  await api('/contacts/delete', 'POST', { ids });
  loadContacts();
});

$('#btn-add-contact').addEventListener('click', async () => {
  const email = prompt('Courriel du garage :');
  if (!email) return;
  const name = prompt('Nom du garage :') || '';
  const city = prompt('Ville :') || '';
  await api('/contacts/save', 'POST', { email, name, city });
  loadContacts();
});

// ================= COURRIELS (modèles) =================
let templates = [];
let currentTpl = null;

async function loadTemplates() {
  templates = await api('/templates');
  renderTemplateList();
  if (!currentTpl && templates.length) selectTemplate(templates[0]);
}

function renderTemplateList() {
  const ul = $('#template-list');
  ul.innerHTML = templates
    .map(
      (t) => `<li data-id="${t.id}" class="${currentTpl?.id === t.id ? 'active' : ''}">
        ${esc(t.name)}<small>${esc(t.subject).slice(0, 40)}</small></li>`
    )
    .join('');
  $$('#template-list li').forEach((li) =>
    li.addEventListener('click', () => selectTemplate(templates.find((t) => t.id === li.dataset.id)))
  );
}

function selectTemplate(t) {
  currentTpl = t;
  $('#tpl-name').value = t.name || '';
  $('#tpl-subject').value = t.subject || '';
  $('#tpl-body').value = t.body || '';
  $('#preview-box').classList.add('hidden');
  renderTemplateList();
}

$('#btn-new-template').addEventListener('click', () => {
  currentTpl = { id: '', name: '', subject: '', body: '' };
  $('#tpl-name').value = '';
  $('#tpl-subject').value = '';
  $('#tpl-body').value = '';
  renderTemplateList();
});

$('#btn-save-template').addEventListener('click', async () => {
  const body = {
    id: currentTpl?.id || '',
    name: $('#tpl-name').value.trim() || 'Sans titre',
    subject: $('#tpl-subject').value,
    body: $('#tpl-body').value,
  };
  await api('/templates/save', 'POST', body);
  currentTpl = null;
  await loadTemplates();
  toast('Modèle enregistré', 'ok');
});

$('#btn-del-template').addEventListener('click', async () => {
  if (!currentTpl?.id) return toast('Rien à supprimer', 'err');
  if (!confirm('Supprimer ce modèle ?')) return;
  await api('/templates/delete', 'POST', { id: currentTpl.id });
  currentTpl = null;
  loadTemplates();
});

$('#btn-preview').addEventListener('click', async () => {
  if (!currentTpl?.id) return toast('Enregistre le modèle d\'abord', 'err');
  const cid = contacts[0]?.id;
  const p = await api('/preview', 'POST', { templateId: currentTpl.id, contactId: cid });
  if (p.error) return toast(p.error, 'err');
  const box = $('#preview-box');
  box.classList.remove('hidden');
  box.innerHTML =
    `<div class="pv-to">À : ${esc(p.to || 'exemple@garage.com')}</div>` +
    `<div class="pv-sub">${esc(p.subject)}</div>` +
    esc(p.body);
});

$('#btn-ai').addEventListener('click', () => {
  toast('Astuce : demande-moi dans le chat « rédige un courriel de partenariat » et je remplirai le modèle.', '');
  alert(
    "Pour un texte sur mesure, retourne dans la conversation avec Claude et demande par exemple :\n\n" +
    "• « Rédige-moi un courriel court pour recruter des garages installateurs »\n" +
    "• « Rends le ton plus chaleureux / plus direct »\n" +
    "• « Ajoute une accroche sur la rémunération »\n\n" +
    "Colle ensuite le texte ici, avec les variables {{nom}} et {{ville}}."
  );
});

// ================= ENVOI =================
async function initSend() {
  if (!templates.length) templates = await api('/templates');
  contacts = await api('/contacts');
  const sel = $('#send-template');
  sel.innerHTML = templates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  renderSendList();
  renderWuBanner();
}

async function renderWuBanner() {
  const info = await api('/warmup');
  const b = $('#wu-banner');
  if (!info.enabled) {
    b.classList.add('hidden');
    return info;
  }
  b.classList.remove('hidden');
  const pct = info.cap ? Math.min(100, (info.usedToday / info.cap) * 100) : 0;
  const full = info.remaining <= 0;
  b.className = 'wu-banner' + (full ? ' full' : '');
  b.innerHTML =
    `<span>🌡️ Réchauffement · jour ${info.day + 1}</span>` +
    `<span class="wu-count">${info.usedToday} / ${info.cap}</span>` +
    `<div class="wu-bar"><i style="width:${pct}%"></i></div>` +
    `<span>${full ? '⚠️ Plafond du jour atteint — reviens demain' : info.remaining + ' envoi(s) restant(s) aujourd’hui'}</span>`;
  return info;
}

$('#send-filter').addEventListener('change', renderSendList);

function sendFiltered() {
  const f = $('#send-filter').value;
  return contacts.filter((c) => c.email && (f === 'all' || c.status === f));
}

function renderSendList() {
  const list = sendFiltered();
  const tb = $('#send-table tbody');
  tb.innerHTML = list
    .map(
      (c) => `<tr>
      <td><input type="checkbox" class="ssel" data-id="${c.id}" checked></td>
      <td>${esc(c.name) || '—'}</td>
      <td>${esc(c.email)}</td>
      <td>${esc(c.city) || '—'}</td>
      <td><span class="pill ${c.status}">${c.status}</span></td>
    </tr>`
    )
    .join('');
  if (!list.length) tb.innerHTML = '<tr><td colspan="5" style="color:var(--muted)">Aucun contact pour ce filtre.</td></tr>';
}

$('#btn-selall-send').addEventListener('click', () => {
  const boxes = $$('.ssel');
  const all = boxes.every((b) => b.checked);
  boxes.forEach((b) => (b.checked = !all));
});

$('#btn-send').addEventListener('click', async () => {
  const templateId = $('#send-template').value;
  if (!templateId) return toast('Choisis un modèle', 'err');
  const ids = $$('.ssel:checked').map((b) => b.dataset.id);
  if (!ids.length) return toast('Coche au moins un contact', 'err');
  const state = await api('/state');
  if (!state.smtpConfigured) {
    toast('Configure d\'abord le SMTP dans Réglages', 'err');
    return;
  }
  if (!confirm(`Envoyer le courriel à ${ids.length} garage(s) ?`)) return;
  $('#btn-send').disabled = true;
  setStatus('#send-status', `<span class="spinner"></span>Envoi de ${ids.length} courriel(s) en cours… garde la fenêtre ouverte.`, 'working');
  try {
    const r = await api('/send', 'POST', { templateId, contactIds: ids });
    if (r.error) throw new Error(r.error);
    if (r.capReached) {
      setStatus('#send-status', `⚠️ Plafond quotidien atteint (${r.cap}). Aucun courriel envoyé — reviens demain.`, 'error');
      toast('Plafond du jour atteint', 'err');
    } else {
      let msg = `✅ ${r.sent} envoyé(s)`;
      if (r.failed) msg += ` · ⚠️ ${r.failed} échec(s)`;
      if (r.held) msg += ` · ⏸️ ${r.held} gardé(s) pour demain (plafond ${r.cap})`;
      setStatus('#send-status', msg, r.failed ? 'error' : 'done');
      toast(`${r.sent} courriel(s) envoyé(s)`, 'ok');
    }
    contacts = await api('/contacts');
    renderSendList();
    renderWuBanner();
    refreshBadge();
  } catch (e) {
    setStatus('#send-status', '⚠️ ' + e.message, 'error');
  } finally {
    $('#btn-send').disabled = false;
  }
});

// ================= STATS =================
async function loadStats() {
  const s = await api('/stats');
  $('#stat-grid').innerHTML = `
    <div class="stat accent"><div class="n">${s.today}</div><div class="l">Envoyés aujourd'hui</div></div>
    <div class="stat"><div class="n">${s.week}</div><div class="l">7 derniers jours</div></div>
    <div class="stat"><div class="n">${s.totalSends}</div><div class="l">Total envoyés</div></div>
    <div class="stat ok"><div class="n">${s.ok}</div><div class="l">Réussis</div></div>
    <div class="stat err"><div class="n">${s.err}</div><div class="l">Échecs</div></div>
    <div class="stat"><div class="n">${s.contacts}</div><div class="l">Contacts</div></div>`;

  const max = Math.max(1, ...s.byZone.map((z) => z[1]));
  $('#zone-list').innerHTML =
    s.byZone.slice(0, 12).map(
      ([z, n]) => `<li><div class="bl-top"><span>${esc(z)}</span><b>${n}</b></div>
        <div class="bar"><i style="width:${(n / max) * 100}%"></i></div></li>`
    ).join('') || '<li style="color:var(--muted)">Aucun envoi encore.</li>';

  const log = await api('/sends');
  $('#log-table tbody').innerHTML =
    log.slice(0, 100).map(
      (e) => `<tr>
        <td>${new Date(e.at).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' })}</td>
        <td>${esc(e.name) || '—'}</td>
        <td>${esc(e.to)}</td>
        <td>${esc(e.zone) || '—'}</td>
        <td><span class="pill ${e.status}">${e.status}</span>${e.error ? ` <small style="color:var(--danger)">${esc(e.error).slice(0, 40)}</small>` : ''}</td>
      </tr>`
    ).join('') || '<tr><td colspan="5" style="color:var(--muted)">Aucun envoi encore.</td></tr>';
}

// ================= AUTOMATISATION =================
async function loadAuto() {
  if (!templates.length) templates = await api('/templates');
  const data = await api('/auto');
  const a = data.auto || {};
  $('#auto-template').innerHTML = templates
    .map((t) => `<option value="${t.id}" ${a.templateId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`)
    .join('');
  $('#auto-enabled').checked = !!a.enabled;
  $('#auto-zones').value = (a.zones || []).join('\n');
  $('#auto-radius').value = String(a.radiusKm || 15);
  $('#auto-limit').value = String(a.dailyLimit || 20);
  const hourSel = $('#auto-hour');
  const hr = a.sendHour ?? 8;
  hourSel.innerHTML = Array.from({ length: 24 }, (_, h) =>
    `<option value="${h}" ${h === hr ? 'selected' : ''}>${String(h).padStart(2, '0')}h00</option>`
  ).join('');
  $('#auto-small').checked = a.smallOnly !== false;
  $('#auto-weekdays').checked = a.weekdaysOnly !== false;
  renderAutoBanner(data);
  renderAutoLast(a.lastResult);
}

function renderAutoBanner(data) {
  const b = $('#auto-banner');
  const on = data.auto?.enabled;
  const full = data.ranToday;
  b.className = 'wu-banner' + (full ? ' full' : '');
  b.innerHTML =
    `<span>${on ? '🟢 Automatisation activée' : '⚪ Automatisation désactivée'}</span>` +
    `<span class="wu-count">${data.quotaToday}</span>` +
    `<span>${full ? '✅ Déjà exécutée aujourd’hui' : `courriels prévus aujourd’hui (quota ${data.warmupEnabled ? 'réchauffement' : 'fixe'})`}</span>`;
}

function renderAutoLast(last) {
  const box = $('#auto-last');
  if (!last) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  const when = last.at ? new Date(last.at).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' }) : '';
  box.innerHTML =
    `<div class="pv-sub">Dernière exécution — ${esc(when)}</div>` +
    `✉️ Envoyés : <b>${last.sent || 0}</b>` +
    (last.failed ? ` · ⚠️ échecs : ${last.failed}` : '') +
    (last.template ? `<br>Modèle : ${esc(last.template)}` : '') +
    (last.zonesSearched && last.zonesSearched.length ? `<br>Zones cherchées : ${esc(last.zonesSearched.join(', '))}` : '') +
    (last.note ? `<br><i>${esc(last.note)}</i>` : '');
}

async function saveAuto() {
  const zones = $('#auto-zones').value.split('\n').map((s) => s.trim()).filter(Boolean);
  await api('/auto', 'POST', {
    enabled: $('#auto-enabled').checked,
    templateId: $('#auto-template').value,
    zones,
    radiusKm: Number($('#auto-radius').value),
    dailyLimit: Number($('#auto-limit').value),
    sendHour: Number($('#auto-hour').value),
    smallOnly: $('#auto-small').checked,
    weekdaysOnly: $('#auto-weekdays').checked,
  });
}

$('#btn-save-auto').addEventListener('click', async () => {
  await saveAuto();
  await loadAuto();
  toast('Automatisation enregistrée', 'ok');
});

$('#btn-run-auto').addEventListener('click', async () => {
  const state = await api('/state');
  if (!state.smtpConfigured) return toast('Configure d\'abord le SMTP (Réglages)', 'err');
  if (!$('#auto-zones').value.trim()) return toast('Ajoute au moins une zone', 'err');
  await saveAuto();
  if (!confirm('Lancer l\'automatisation maintenant ? (recherche + envoi du quota du jour)')) return;
  $('#btn-run-auto').disabled = true;
  setStatus('#auto-status', '<span class="spinner"></span>En cours : recherche de garages puis envoi… (peut prendre 1-2 min)', 'working');
  try {
    const r = await api('/auto/run', 'POST');
    if (r.error) throw new Error(r.error);
    setStatus('#auto-status', `✅ Terminé — ${r.sent || 0} courriel(s) envoyé(s).`, 'done');
    contacts = await api('/contacts');
    loadAuto();
    refreshBadge();
  } catch (e) {
    setStatus('#auto-status', '⚠️ ' + e.message, 'error');
  } finally {
    $('#btn-run-auto').disabled = false;
  }
});

// ================= RÉGLAGES =================
async function loadSettings() {
  const s = await api('/settings');
  $('#smtp-host').value = s.smtp.host || '';
  $('#smtp-port').value = s.smtp.port || 587;
  $('#smtp-secure').checked = !!s.smtp.secure;
  $('#smtp-user').value = s.smtp.user || '';
  $('#smtp-pass').value = s.smtp.pass || '';
  $('#from-name').value = s.from.name || '';
  $('#from-email').value = s.from.email || '';
  $('#signature').value = s.signature || '';
  $('#company').value = s.company || '';
  $('#send-delay').value = s.sendDelayMs || 4000;
  $('#google-key').value = s.googleApiKey || '';
  const gs = $('#google-status');
  if (s.googleApiKey) {
    gs.className = 'status done';
    gs.textContent = '✅ Clé enregistrée — la recherche utilise Google Maps (résultats élargis).';
  } else {
    gs.className = 'status';
    gs.textContent = 'Aucune clé — recherche gratuite (OpenStreetMap).';
  }
  const w = s.warmup || {};
  $('#wu-enabled').checked = !!w.enabled;
  $('#wu-max').value = String(w.maxPerDay || 50);
  updateWuInfo();
}

async function updateWuInfo() {
  const info = await api('/warmup');
  const el = $('#wu-info');
  if (!info.enabled) {
    el.className = 'status';
    el.textContent = 'Désactivé — aucun plafond. À activer surtout pour une adresse neuve.';
    return;
  }
  el.className = 'status done';
  el.innerHTML =
    `Jour ${info.day + 1} · plafond aujourd'hui : <b>${info.cap}</b> courriels · ` +
    `déjà envoyés : ${info.usedToday} · reste : <b>${info.remaining}</b>`;
}

$('#smtp-secure').addEventListener('change', () => {
  $('#smtp-port').value = $('#smtp-secure').checked ? 465 : 587;
});

async function saveSettings() {
  const body = {
    smtp: {
      host: $('#smtp-host').value.trim(),
      port: Number($('#smtp-port').value) || 587,
      secure: $('#smtp-secure').checked,
      user: $('#smtp-user').value.trim(),
      pass: $('#smtp-pass').value,
    },
    from: { name: $('#from-name').value.trim(), email: $('#from-email').value.trim() },
    signature: $('#signature').value,
    company: $('#company').value.trim(),
    sendDelayMs: Number($('#send-delay').value),
    warmup: { enabled: $('#wu-enabled').checked, maxPerDay: Number($('#wu-max').value) },
    googleApiKey: $('#google-key').value.trim(),
  };
  await api('/settings', 'POST', body);
  refreshBadge();
}

$('#btn-save-settings').addEventListener('click', async () => {
  await saveSettings();
  updateWuInfo();
  toast('Réglages enregistrés', 'ok');
});

$('#btn-test-smtp').addEventListener('click', async () => {
  await saveSettings();
  setStatus('#settings-status', '<span class="spinner"></span>Test de connexion…', 'working');
  const r = await api('/settings/test', 'POST');
  setStatus('#settings-status', (r.ok ? '✅ ' : '⚠️ ') + r.message, r.ok ? 'done' : 'error');
});

$('#btn-test-mail').addEventListener('click', async () => {
  await saveSettings();
  setStatus('#settings-status', '<span class="spinner"></span>Envoi du courriel de test…', 'working');
  const r = await api('/settings/testmail', 'POST', {});
  setStatus('#settings-status', (r.ok ? '✅ ' : '⚠️ ') + r.message, r.ok ? 'done' : 'error');
  if (r.ok) toast('Courriel de test envoyé', 'ok');
});

// ===== Démarrage =====
refreshBadge();
