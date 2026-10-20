'use strict';

/* ---------- Costanti ---------- */
// Nomi dei campi: SONO UN'ASSUNZIONE, adattali ai tuoi (lo schema contiene solo le sigle).
const CAMPI = {
  MS: 'Meccanica statistica', MC: 'Materia condensata', OT: 'Ottica', AS: 'Astrofisica',
  NU: 'Fisica nucleare', PA: 'Particelle', FL: 'Fluidi', PL: 'Plasmi', GE: 'Geofisica',
  BF: 'Biofisica', AM: 'Atomica e molecolare', RC: 'Relatività e cosmologia',
  NL: 'Sistemi non lineari', QI: 'Informazione quantistica', AC: 'Acustica'
};
const INTERVALLI = [1, 3, 7, 21]; // giorni per box 0..3
const SOGLIA_BUONA = 0.75, SOGLIA_SCARSA = 0.5;
const MESI_NOTA = 'it-IT';

/* ---------- Utilità ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const pad2 = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const today = () => ymd(new Date());
const toUTC = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const diffDays = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000);
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return ymd(new Date(y, m - 1, d + n)); };
const fmtData = s => new Date(toUTC(s)).toLocaleDateString(MESI_NOTA, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const el = (html) => { const t = document.createElement('div'); t.innerHTML = html; return t; };
function toast(msg) {
  const t = el(`<div class="toast" role="status">${esc(msg)}</div>`).firstChild;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}

/* ---------- IndexedDB (chiave-valore con cache in memoria) ---------- */
const DB = {
  db: null, cache: new Map(),
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('fisica365', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  loadAll() {
    return new Promise((res, rej) => {
      const rq = this.db.transaction('kv').objectStore('kv').openCursor();
      rq.onsuccess = () => { const c = rq.result; if (c) { this.cache.set(c.key, c.value); c.continue(); } else res(); };
      rq.onerror = () => rej(rq.error);
    });
  },
  get(k) { return this.cache.get(k); },
  set(k, v) {
    this.cache.set(k, v);
    return new Promise((res, rej) => {
      const tx = this.db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  },
  replaceAll(entries) {
    this.cache = new Map(entries);
    return new Promise((res, rej) => {
      const tx = this.db.transaction('kv', 'readwrite'); const st = tx.objectStore('kv');
      st.clear(); for (const [k, v] of entries) st.put(v, k);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  }
};

/* ---------- Dati ---------- */
let SCHEDE = [], BY = {};
const settings = () => DB.get('settings') || {};
const prog = n => DB.get('p:' + n);
const testo = n => (DB.get('t:' + n) || {}).text || '';

async function caricaArchivio() {
  const r = await fetch('archivio.json');
  if (!r.ok) throw new Error('archivio.json non disponibile (' + r.status + ')');
  const arr = await r.json();
  SCHEDE = arr.filter(s => Number.isInteger(s.giorno)).sort((a, b) => a.giorno - b.giorno);
  BY = {}; SCHEDE.forEach(s => {
    BY[s.giorno] = s;
    s._h = norm([s.titolo, s.prerequisiti, s.spiegazione_intuitiva, s.campo_origine, CAMPI[s.campo_origine]].join(' '));
  });
}

function stato(n) {
  const p = prog(n);
  if (!p) return 'nuova';
  return p.due <= today() ? 'da ripassare' : 'conosciuta';
}
const dueList = () => SCHEDE.filter(s => stato(s.giorno) === 'da ripassare')
  .sort((a, b) => prog(a.giorno).due.localeCompare(prog(b.giorno).due) || a.giorno - b.giorno);

/* ---------- Ripetizione spaziata ---------- */
function applicaPunteggio(n, checks) {
  const yes = checks.filter(Boolean).length, tot = checks.length, ratio = yes / tot;
  const p = prog(n) || { box: -1, views: 0, history: [] };
  let box;
  if (ratio >= SOGLIA_BUONA) box = Math.min(p.box + 1, INTERVALLI.length - 1);
  else if (ratio >= SOGLIA_SCARSA) box = Math.max(p.box, 0);
  else box = 0;
  const giorni = INTERVALLI[box];
  const nuovo = {
    box, due: addDays(today(), giorni), views: p.views + 1, yes, total: tot, checks,
    last: today(), history: [...(p.history || []), { d: today(), yes, tot }].slice(-30)
  };
  return DB.set('p:' + n, nuovo).then(() => ({ giorni, due: nuovo.due, ratio }));
}

/* ---------- Formule ---------- */
function tex(node, src) {
  const f = String(src || '').trim().replace(/^\$\$?|\$\$?$/g, '').replace(/^\\\[|\\\]$/g, '').trim();
  try {
    if (window.katex) katex.render(f, node, { displayMode: true, throwOnError: false });
    else node.textContent = f;
  } catch (e) { node.textContent = f; }
}

/* ---------- Componenti ---------- */
const chipCampo = c => `<span class="chip origin" title="${esc(CAMPI[c] || c)}">${esc(c)}</span>`;
const dots = d => `<span class="dots" title="Difficoltà ${d}/3">${'●'.repeat(d)}${'○'.repeat(3 - d)}</span>`;
function chipStato(n) {
  const s = stato(n);
  return `<span class="chip ${s === 'nuova' ? 'new' : s === 'conosciuta' ? 'ok' : 'due'}">${s}</span>`;
}
const rigaScheda = s => `<a class="row" href="#/scheda/${s.giorno}">
  <span class="num">${s.giorno}</span>
  <span class="main"><span class="t">${esc(s.titolo)}</span>
  <span class="small muted">${esc(CAMPI[s.campo_origine] || s.campo_origine)} · ${dots(s.difficolta)}</span></span>
  ${chipStato(s.giorno)}</a>`;

/* ---------- Vista scheda (prima l'utente spiega, poi il riferimento) ---------- */
function viewScheda(n) {
  const s = BY[n];
  const root = el('<div></div>').firstChild;
  if (!s) { root.innerHTML = '<div class="card">Scheda non trovata.</div>'; return root; }
  const p = prog(n);

  root.innerHTML = `
  <div class="card">
    <div class="chips">${chipCampo(s.campo_origine)}<span class="chip">${esc(CAMPI[s.campo_origine] || '')}</span>${dots(s.difficolta)}${chipStato(n)}</div>
    <h2>${esc(s.titolo)}</h2>
    <p class="sec-label">Prerequisiti</p>
    <p>${esc(s.prerequisiti)}</p>
    ${p ? `<p class="small muted">Ultima valutazione: ${p.yes}/${p.total} · prossimo ripasso ${fmtData(p.due)}</p>` : ''}
  </div>
  <div class="card">
    <label for="mia" style="margin-top:0">La tua spiegazione</label>
    <textarea id="mia" placeholder="Spiega con parole tue il meccanismo fisico, prima di guardare il riferimento."></textarea>
    <p class="small muted" style="margin:6px 0 0">Si salva da sola su questo dispositivo.</p>
  </div>
  <div id="rev"><button class="primary block" id="mostra">Mostra spiegazione di riferimento</button></div>`;

  const ta = $('#mia', root); ta.value = testo(n);
  let tm; ta.addEventListener('input', () => {
    clearTimeout(tm); tm = setTimeout(() => DB.set('t:' + n, { text: ta.value, ts: Date.now() }), 400);
  });
  window.addEventListener('hashchange', () => DB.set('t:' + n, { text: ta.value, ts: Date.now() }), { once: true });

  $('#mostra', root).addEventListener('click', () => {
    DB.set('t:' + n, { text: ta.value, ts: Date.now() });
    mostraRiferimento(s, $('#rev', root));
  });
  return root;
}

function mostraRiferimento(s, box) {
  const checks = new Array(s.checklist.length).fill(null);
  const campi = (s.campi_poco_noto || []).map(c => `<span class="chip" title="${esc(CAMPI[c] || c)}">${esc(c)}</span>`).join('');
  const nonVerif = s.verifica && !s.verifica.riferimenti;
  const coll = (s.collegamenti || []).filter(k => BY[k]);
  box.innerHTML = `
  <div class="card">
    <p class="sec-label">Spiegazione di riferimento</p>
    <p>${esc(s.spiegazione_intuitiva)}</p>
    <p class="sec-label">Formula chiave</p>
    <div class="formula" id="fx"></div>
    <p class="sec-label">Ordine di grandezza</p><p>${esc(s.ordine_di_grandezza)}</p>
    <p class="sec-label">Perché è importante</p><p>${esc(s.perche_importante)}</p>
    <p class="sec-label">Campi dove è poco noto</p><div class="chips">${campi}</div>
    ${s.confidenza !== 'alta' ? `<p class="small muted">Confidenza della scheda: ${esc(s.confidenza)}.</p>` : ''}
  </div>
  <div class="card">
    <h3>Autovalutazione</h3>
    <p class="small muted">Per ogni punto: la tua spiegazione lo conteneva?</p>
    <div id="cl">${s.checklist.map((t, i) => `<div class="check"><span class="txt">${esc(t)}</span>
      <span class="yn"><button class="y" data-i="${i}" aria-pressed="false">Sì</button><button class="n" data-i="${i}" aria-pressed="false">No</button></span></div>`).join('')}</div>
    <div style="margin-top:12px"><button class="primary block" id="salva" disabled>Salva valutazione</button></div>
    <div id="esito"></div>
  </div>
  <div class="card ${nonVerif ? 'warn' : ''}">
    <p class="sec-label">Riferimenti${nonVerif ? ' (non ancora verificati su una fonte)' : ''}</p>
    <ul class="refs">${s.riferimenti.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
  </div>
  ${coll.length ? `<div class="card"><p class="sec-label">Voci collegate</p>${coll.map(k => rigaScheda(BY[k])).join('')}</div>` : ''}`;
  tex($('#fx', box), s.formula_chiave);

  const salva = $('#salva', box);
  $('#cl', box).addEventListener('click', e => {
    const b = e.target.closest('button[data-i]'); if (!b) return;
    const i = +b.dataset.i, v = b.classList.contains('y');
    checks[i] = v;
    const row = b.parentElement;
    row.querySelector('.y').setAttribute('aria-pressed', v);
    row.querySelector('.n').setAttribute('aria-pressed', !v);
    salva.disabled = checks.some(c => c === null);
  });
  salva.addEventListener('click', async () => {
    salva.disabled = true;
    const r = await applicaPunteggio(s.giorno, checks);
    const yes = checks.filter(Boolean).length;
    $('#esito', box).innerHTML = `<p class="card soft" style="margin-top:12px">Punteggio ${yes}/${checks.length}. Tornerà ${r.giorni === 1 ? 'domani' : 'tra ' + r.giorni + ' giorni'} (${fmtData(r.due)}).</p>`;
    aggiornaBadge(); salva.textContent = 'Valutazione salvata'; toast('Salvato');
  });
}

/* ---------- Viste ---------- */
function numeroOggi() {
  const st = settings().start; if (!st) return null;
  const d = diffDays(st, today());
  if (d < 0) return { futuro: -d, st };
  return { n: (d % 365) + 1, giro: Math.floor(d / 365) + 1, st };
}

function viewOggi() {
  const root = el('<div></div>').firstChild;
  const info = numeroOggi();
  if (!info) {
    root.innerHTML = `<div class="card"><h2>Benvenuto</h2>
      <p>Scegli la data in cui parte il tuo percorso: il giorno 1 sarà quel giorno. Potrai cambiarla nelle impostazioni.</p>
      <label for="d0">Data di inizio</label><input id="d0" type="date" value="${today()}">
      <div style="margin-top:12px"><button class="primary block" id="via">Inizia</button></div></div>`;
    $('#via', root).addEventListener('click', async () => {
      const v = $('#d0', root).value; if (!v) return toast('Scegli una data');
      await DB.set('settings', { ...settings(), start: v });
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
      route();
    });
    return root;
  }
  if (info.futuro) {
    root.innerHTML = `<div class="card"><h2>Si parte il ${fmtData(info.st)}</h2><p>Mancano ${info.futuro} giorni. Nel frattempo puoi sfogliare l'archivio.</p></div>`;
    return root;
  }
  const due = dueList().filter(s => s.giorno !== info.n).length;
  root.innerHTML = `<p class="muted pad small">Giorno ${info.n} di 365${info.giro > 1 ? ' · giro ' + info.giro : ''} · ${fmtData(today())}</p>
    ${due ? `<a class="row" href="#/ripasso"><span class="main">Hai ${due} ${due === 1 ? 'scheda' : 'schede'} da ripassare</span><span class="chip due">Apri</span></a>` : ''}`;
  root.appendChild(viewScheda(info.n));
  return root;
}

function viewRipasso() {
  const l = dueList(), root = el('<div></div>').firstChild;
  root.innerHTML = l.length
    ? `<p class="muted pad small">${l.length} ${l.length === 1 ? 'scheda in scadenza' : 'schede in scadenza'}, le più vecchie per prime.</p>` +
      l.map(s => rigaScheda(s).replace('</a>', `<span class="small muted">${fmtData(prog(s.giorno).due)}</span></a>`)).join('')
    : `<div class="card"><h3>Niente da ripassare</h3><p class="muted">Quando una scheda arriva a scadenza compare qui.</p></div>`;
  return root;
}

let F = { q: '', campo: '', diff: '', stato: '' };
function viewArchivio() {
  const root = el('<div></div>').firstChild;
  const opt = (v, t, sel) => `<option value="${v}" ${sel === v ? 'selected' : ''}>${t}</option>`;
  root.innerHTML = `<div class="filters">
    <input id="q" type="search" placeholder="Cerca nelle schede" aria-label="Cerca" value="${esc(F.q)}">
    <select id="fc" aria-label="Campo d'origine">${opt('', 'Campo', F.campo)}${Object.keys(CAMPI).map(c => opt(c, c + ' · ' + CAMPI[c], F.campo)).join('')}</select>
    <select id="fd" aria-label="Difficoltà">${opt('', 'Difficoltà', F.diff)}${[1, 2, 3].map(d => opt(d, '●'.repeat(d), F.diff)).join('')}</select>
    <select id="fs" aria-label="Stato">${opt('', 'Stato', F.stato)}${['nuova', 'da ripassare', 'conosciuta'].map(x => opt(x, x, F.stato)).join('')}</select>
  </div><p class="small muted" id="cnt"></p><div id="lista"></div>`;
  const draw = () => {
    const q = norm(F.q.trim());
    const r = SCHEDE.filter(s => (!q || s._h.includes(q)) && (!F.campo || s.campo_origine === F.campo || (s.campi_poco_noto || []).includes(F.campo) && false) &&
      (!F.diff || s.difficolta === +F.diff) && (!F.stato || stato(s.giorno) === F.stato));
    $('#cnt', root).textContent = `${r.length} di ${SCHEDE.length} schede`;
    $('#lista', root).innerHTML = r.map(rigaScheda).join('') || '<div class="card muted">Nessuna scheda con questi filtri.</div>';
  };
  $('#q', root).addEventListener('input', e => { F.q = e.target.value; draw(); });
  $('#fc', root).addEventListener('change', e => { F.campo = e.target.value; draw(); });
  $('#fd', root).addEventListener('change', e => { F.diff = e.target.value; draw(); });
  $('#fs', root).addEventListener('change', e => { F.stato = e.target.value; draw(); });
  draw(); return root;
}

function viewStats() {
  const root = el('<div></div>').firstChild;
  let viste = 0, yes = 0, tot = 0;
  const per = {};
  Object.keys(CAMPI).forEach(c => per[c] = { n: 0, viste: 0, yes: 0, tot: 0 });
  SCHEDE.forEach(s => {
    const c = per[s.campo_origine] || (per[s.campo_origine] = { n: 0, viste: 0, yes: 0, tot: 0 });
    c.n++;
    const p = prog(s.giorno);
    if (p) { viste++; yes += p.yes; tot += p.tot; c.viste++; c.yes += p.yes; c.tot += p.tot; }
  });
  const pc = (a, b) => b ? Math.round(100 * a / b) : 0;
  root.innerHTML = `<div class="stat-grid">
    <div class="stat"><b>${viste}</b><span>schede viste su ${SCHEDE.length}</span></div>
    <div class="stat"><b>${tot ? pc(yes, tot) + '%' : '–'}</b><span>checklist</span></div>
    <div class="stat"><b>${dueList().length}</b><span>da ripassare</span></div></div>
    <div class="card"><h3>Per campo</h3>${Object.entries(per).filter(([, c]) => c.n).map(([k, c]) => `
      <div class="camp-row"><div class="h"><span>${esc(k)} · ${esc(CAMPI[k] || '')}</span>
      <span class="muted">${c.viste}/${c.n} · ${c.tot ? pc(c.yes, c.tot) + '%' : '–'}</span></div>
      <div class="bar" title="Checklist"><i style="width:${pc(c.yes, c.tot)}%"></i></div></div>`).join('')}</div>`;
  return root;
}

function viewImpostazioni() {
  const root = el('<div></div>').firstChild, st = settings().start || today();
  root.innerHTML = `<div class="card"><h3>Data di inizio</h3>
    <p class="small muted">Il giorno 1 corrisponde a questa data. Cambiandola cambia la scheda di oggi, non il progresso.</p>
    <input id="d0" type="date" value="${st}" aria-label="Data di inizio">
    <div style="margin-top:10px"><button class="primary" id="ok">Salva data</button></div></div>
  <div class="card"><h3>Backup</h3>
    <p class="small muted">Esporta progresso e testi in un file JSON; importandolo, i dati attuali vengono sostituiti.</p>
    <div class="actions"><button id="exp">Esporta</button><button id="imp">Importa</button></div>
    <input id="file" type="file" accept="application/json,.json" hidden></div>
  <div class="card"><h3>Azzera</h3>
    <p class="small muted">Cancella progresso, testi e data di inizio da questo dispositivo.</p>
    <button class="danger" id="rst">Cancella tutti i dati</button></div>
  <p class="muted small pad">Schede caricate: ${SCHEDE.length}. Funziona offline dopo il primo caricamento.</p>`;
  $('#ok', root).addEventListener('click', async () => {
    const v = $('#d0', root).value; if (!v) return toast('Scegli una data');
    await DB.set('settings', { ...settings(), start: v }); toast('Data salvata'); aggiornaBadge();
  });
  $('#exp', root).addEventListener('click', () => {
    const data = { app: 'fisica365', versione: 1, esportato: new Date().toISOString(), voci: [...DB.cache.entries()] };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = `fisica365-backup-${today()}.json`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
  $('#imp', root).addEventListener('click', () => $('#file', root).click());
  $('#file', root).addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.app !== 'fisica365' || !Array.isArray(d.voci)) throw new Error('File non valido');
      if (!confirm(`Importare ${d.voci.length} voci? I dati attuali verranno sostituiti.`)) return;
      await DB.replaceAll(d.voci); toast('Importato'); aggiornaBadge(); route();
    } catch (err) { toast('Importazione fallita: ' + err.message); }
    e.target.value = '';
  });
  $('#rst', root).addEventListener('click', async () => {
    if (!confirm('Cancellare tutto? Esporta prima un backup se ti serve.')) return;
    await DB.replaceAll([]); aggiornaBadge(); toast('Dati cancellati'); location.hash = '#/oggi'; route();
  });
  return root;
}

/* ---------- Router ---------- */
const TITOLI = { oggi: 'Oggi', ripasso: 'Da ripassare', archivio: 'Archivio', stats: 'Statistiche', impostazioni: 'Impostazioni', scheda: 'Scheda' };
function route() {
  const [, r = 'oggi', arg] = (location.hash || '#/oggi').split('/');
  const app = $('#app'); app.replaceChildren();
  let v;
  if (r === 'scheda') {
    v = el('<div></div>').firstChild;
    v.innerHTML = '<button class="link" id="back">← Indietro</button>';
    $('#back', v).addEventListener('click', () => history.length > 1 ? history.back() : (location.hash = '#/archivio'));
    v.appendChild(viewScheda(+arg));
  } else {
    v = ({ oggi: viewOggi, ripasso: viewRipasso, archivio: viewArchivio, stats: viewStats, impostazioni: viewImpostazioni }[r] || viewOggi)();
  }
  app.appendChild(v);
  $('#page-title').textContent = r === 'scheda' && BY[+arg] ? 'Giorno ' + arg : (TITOLI[r] || 'Fisica 365');
  document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === (r === 'scheda' ? 'archivio' : r)));
  if (r !== 'archivio') window.scrollTo(0, 0);
}
function aggiornaBadge() {
  const n = dueList().length, b = $('#badge');
  b.hidden = !n; b.textContent = n;
}

/* ---------- Avvio ---------- */
(async function init() {
  try {
    await DB.open(); await DB.loadAll(); await caricaArchivio();
  } catch (e) {
    $('#app').innerHTML = `<div class="card"><h3>Impossibile avviare</h3><p>${esc(e.message)}</p></div>`; return;
  }
  aggiornaBadge();
  window.addEventListener('hashchange', route);
  route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
