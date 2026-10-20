/* FACET — a felület magja
   Fájlrendszer, szerkesztő, fülek, fájlfa, facet-váltás, parancspaletta,
   Időgép, keresés, beállítások, alsó panel, Flow mód. */
(function () {
  'use strict';
  const F = window.F = {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const modKey = (e) => (isMac ? e.metaKey : e.ctrlKey);
  F.$ = $; F.$$ = $$; F.esc = esc; F.isMac = isMac;

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') { for (const sk in v) { if (sk.startsWith('--')) el.style.setProperty(sk, v[sk]); else el.style[sk] = v[sk]; } }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }
  F.h = h;

  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  F.debounce = debounce;

  // ───────────── eseménybusz ─────────────
  const bus = {};
  F.on = (ev, fn) => { (bus[ev] = bus[ev] || []).push(fn); };
  F.emit = (ev, ...a) => { (bus[ev] || []).forEach((fn) => { try { fn(...a); } catch (e) { console.error(e); } }); };

  // ───────────── tárolás ─────────────
  // Az asztali alkalmazás minden indításkor más porton fut, így a böngésző tárolója (localStorage)
  // nem maradna meg. Ezért a beállítások a motorhoz kerülnek (~/.facet/prefs.json); ha nincs motor,
  // marad a localStorage.
  const PREFS = (() => {
    try {
      const x = new XMLHttpRequest();
      x.open('GET', '/api/prefs', false);
      x.setRequestHeader('X-Facet', '1');
      x.send();
      if (x.status === 200) return JSON.parse(x.responseText || '{}');
    } catch (e) { /* demó mód */ }
    return null;
  })();
  if (PREFS && !Object.keys(PREFS).length) {
    // első indítás az új tárolóval: átvesszük, ami a böngészőben volt
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('facet.') && k !== 'facet.demofs') PREFS[k.slice(6)] = JSON.parse(localStorage.getItem(k)); } } catch (e) { /* nincs */ }
  }
  const pushPrefs = (() => {
    let t = null;
    const send = () => { t = null; try { fetch('/api/prefs', { method: 'PUT', headers: { 'X-Facet': '1' }, body: JSON.stringify(PREFS), keepalive: true }); } catch (e) { /* később újra */ } };
    window.addEventListener('beforeunload', () => { if (t) { clearTimeout(t); send(); } });
    return () => { if (!t) t = setTimeout(send, 400); };
  })();
  const store = {
    get(k, d) {
      if (PREFS && k !== 'demofs') return Object.prototype.hasOwnProperty.call(PREFS, k) ? JSON.parse(JSON.stringify(PREFS[k])) : d;
      try { const v = localStorage.getItem('facet.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set(k, v) {
      if (PREFS && k !== 'demofs') { PREFS[k] = JSON.parse(JSON.stringify(v)); pushPrefs(); return; }
      try { localStorage.setItem('facet.' + k, JSON.stringify(v)); } catch (e) { /* tele vagy tiltott */ }
    }
  };
  F.store = store;

  const DEFAULTS = {
    fontSize: 14, autosave: true, minimap: false, wrap: false, pulse: true, lens: true, liveCheck: true, ligatures: true,
    zoom: 1, fontFamily: 'JetBrains Mono', lineHeight: 1.6, tabSize: 'auto', renderWhitespace: 'selection',
    cursorStyle: 'line', cursorBlinking: 'smooth', lineNumbers: 'on', bracketColors: true, stickyScroll: true, guides: true,
    quickSuggest: true, smoothScroll: true, autoClose: true, autosaveDelay: 900, saveOnBlur: false, trimTrailing: false,
    finalNewline: false, formatOnSave: false, confirmDelete: true, confirmMove: true, termFontSize: 13, flowFullscreen: true, flowWidth: 'wide', keys: {}
  };
  F.DEFAULTS = DEFAULTS;
  F.settings = Object.assign({}, DEFAULTS, store.get('settings', {}));
  F.saveSettings = () => store.set('settings', F.settings);

  // ───────────── színek ─────────────
  function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  F.rgba = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };

  // ───────────── facetek ─────────────
  F.facets = {};
  const BASE_FACETS = {
    java: { label: 'Java', accent: '#FF8A3D', exts: ['java'], lang: 'java', icon: 'J', tab: 4 },
    html: { label: 'HTML', accent: '#FF5C7A', exts: ['html', 'htm'], lang: 'html', icon: '<>', tab: 2 },
    css: { label: 'CSS', accent: '#4DA3FF', exts: ['css'], lang: 'css', icon: '#', tab: 2 },
    js: { label: 'JavaScript', accent: '#F5C451', exts: ['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx'], lang: 'javascript', icon: 'JS', tab: 2 },
    doc: { label: 'Dokumentum', accent: '#E6D3B3', exts: ['txt', 'docx', 'doc', 'rtf', 'odt'], lang: 'plaintext', icon: 'W', tab: 4 },
    py: { label: 'Python', accent: '#2EC4B6', exts: ['py', 'pyw'], lang: 'python', icon: 'Py', tab: 4 },
    json: { label: 'JSON', accent: '#A78BFA', exts: ['json'], lang: 'json', icon: '{}', tab: 2 },
    md: { label: 'Markdown', accent: '#8FD3A8', exts: ['md', 'markdown'], lang: 'markdown', icon: 'M', tab: 2 },
    text: { label: 'Szöveg', accent: '#9AA6B8', exts: [], lang: 'plaintext', icon: 'T', tab: 4 }
  };
  for (const k in BASE_FACETS) F.facets[k] = Object.assign({ key: k, tools: [], stage: [], commands: [] }, BASE_FACETS[k]);
  F.extendFacet = (k, def) => Object.assign(F.facets[k], def);
  const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'];
  F.ext = (p) => { const n = p.split('/').pop(); const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i + 1).toLowerCase() : ''; };
  F.facetFor = (p) => { const e = F.ext(p); for (const k in F.facets) if (F.facets[k].exts.includes(e)) return k; return 'text'; };
  F.isImage = (p) => IMAGE_EXT.includes(F.ext(p));
  F.iconFor = (p) => {
    if (F.isImage(p)) return { t: 'IMG', c: '#8FD3A8' };
    const f = F.facets[F.facetFor(p)];
    return { t: f.icon, c: f.accent };
  };

  // ───────────── fájlrendszer ─────────────
  const api = async (method, path, params, body) => {
    const qs = new URLSearchParams();
    if (params) for (const k in params) {
      const v = params[k];
      if (Array.isArray(v)) v.forEach((x) => qs.append(k, x)); else if (v != null) qs.append(k, v);
    }
    const url = '/api/' + path + (qs.toString() ? '?' + qs.toString().replace(/\+/g, '%20') : '');
    const res = await fetch(url, { method, body, headers: { 'X-Facet': '1' } });
    return res;
  };
  const apiJson = async (...a) => {
    const r = await api(...a);
    let j;
    try { j = await r.json(); } catch (e) { j = {}; }
    if (!r.ok) throw new Error(j.error || ('Hiba: ' + r.status));
    return j;
  };
  F.api = api; F.apiJson = apiJson;
  /** Külső cím megnyitása: az asztali alkalmazásban a rendszer böngészőjében. */
  F.openUrl = (url) => {
    if (fs.mode === 'local') api('POST', 'openurl', { u: url }).catch(() => window.open(url, '_blank'));
    else window.open(url, '_blank');
  };

  const memFs = {
    files: new Map(), dirs: new Set(),
    seed() {
      const saved = store.get('demofs', null);
      if (saved) { saved.f.forEach(([p, c]) => this.files.set(p, c)); saved.d.forEach((d) => this.dirs.add(d)); }
    },
    persist: debounce(function () { store.set('demofs', { f: [...memFs.files], d: [...memFs.dirs] }); }, 600)
  };

  const fs = F.fs = {
    mode: 'local',
    async list() {
      if (fs.mode === 'local') return apiJson('GET', 'tree');
      const out = [], dirs = new Set(memFs.dirs);
      for (const p of memFs.files.keys()) {
        if (p.startsWith('.facet/')) continue;
        const parts = p.split('/');
        for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
        out.push({ p, d: false });
      }
      for (const d of dirs) if (!d.startsWith('.facet')) out.push({ p: d, d: true });
      return out;
    },
    async read(p) {
      if (fs.mode === 'local') {
        const r = await api('GET', 'file', { path: p });
        if (!r.ok) throw new Error('Nem sikerült megnyitni: ' + p);
        return r.text();
      }
      if (!memFs.files.has(p)) throw new Error('Nincs ilyen fájl: ' + p);
      return memFs.files.get(p);
    },
    async exists(p) {
      if (fs.mode === 'local') { const r = await api('GET', 'file', { path: p, opt: 1 }); return r.status === 200; }
      return memFs.files.has(p);
    },
    async write(p, text) {
      if (fs.mode === 'local') return apiJson('PUT', 'file', { path: p }, text);
      memFs.files.set(p, text); memFs.persist(); return { ok: true };
    },
    async mkdir(p) {
      if (fs.mode === 'local') return apiJson('POST', 'mkdir', { path: p });
      memFs.dirs.add(p); memFs.persist(); return { ok: true };
    },
    async rename(a, b) {
      if (fs.mode === 'local') return apiJson('POST', 'rename', { from: a, to: b });
      for (const [p, c] of [...memFs.files]) {
        if (p === a || p.startsWith(a + '/')) { memFs.files.delete(p); memFs.files.set(b + p.slice(a.length), c); }
      }
      for (const d of [...memFs.dirs]) if (d === a || d.startsWith(a + '/')) { memFs.dirs.delete(d); memFs.dirs.add(b + d.slice(a.length)); }
      memFs.persist(); return { ok: true };
    },
    async remove(p) {
      if (fs.mode === 'local') return apiJson('DELETE', 'file', { path: p });
      for (const k of [...memFs.files.keys()]) if (k === p || k.startsWith(p + '/')) memFs.files.delete(k);
      for (const d of [...memFs.dirs]) if (d === p || d.startsWith(p + '/')) memFs.dirs.delete(d);
      memFs.persist(); return { ok: true };
    },
    url(p) { return fs.mode === 'local' ? '/ws/' + p.split('/').map(encodeURIComponent).join('/') : null; }
  };

  // ───────────── állapot ─────────────
  const S = F.state = {
    tree: [], expanded: new Set(), open: [], active: null,
    docs: new Map(), // path → { model, saved, view, facet }
    facet: null, engine: null, sessionStart: Date.now(), stageTab: store.get('stageTab', {}),
    bottomPane: 'terminal', recent: []
  };
  F.active = () => {
    if (!S.active) return null;
    const d = S.docs.get(S.active);
    return d ? { path: S.active, model: d.model, custom: d.custom || null, facet: d.facet, def: F.facets[d.facet] } : null;
  };
  const verOf = (d) => (d.custom ? d.custom.version() : d.model.getAlternativeVersionId());
  F.dirty = (p) => { const d = S.docs.get(p); return !!d && verOf(d) !== d.saved; };
  F.textOf = async (p) => { const d = S.docs.get(p); return d ? (d.custom ? d.custom.text() : d.model.getValue()) : fs.read(p); };
  /** Kódszerkesztő (Monaco) aktív-e — a dokumentumszerkesztőnél nem. */
  F.hasCode = () => { const d = S.active && S.docs.get(S.active); return !!(d && !d.custom); };
  F.files = () => S.tree.filter((n) => !n.d).map((n) => n.p);
  /** A Java projekt kulcsa egy fájlhoz, ahogy a motor is látja: a legközelebbi projektgyökér
      (src/, .iml, pom.xml, Gradle) — '.' ha ez maga a megnyitott mappa —, különben 'loose:<mappa>'. */
  const dirOf = (p) => p.split('/').slice(0, -1).join('/');
  const join2 = (d, n) => (d ? d + '/' + n : n);
  F.projectOf = (p) => {
    if (!p) return '';
    const idx = S.treeIdx || new Map();
    const isMarker = (d) => idx.has(join2(d, 'pom.xml')) || idx.has(join2(d, 'build.gradle')) || idx.has(join2(d, 'build.gradle.kts'))
      || (idx.get(join2(d, 'src')) === true && p.startsWith(join2(d, 'src') + '/'))
      || S.tree.some((n) => !n.d && dirOf(n.p) === d && n.p.endsWith('.iml'));
    for (let d = dirOf(p); ; d = dirOf(d)) {
      if (isMarker(d)) return d || '.';
      if (!d) break;
    }
    return 'loose:' + dirOf(p);
  };
  /** A projekthez tartozó .java fájlok (ugyanaz a kör, amit a motor lefordít). */
  F.javaFilesOf = (proj) => {
    const all = F.files().filter((x) => x.endsWith('.java'));
    if (!proj) return [];
    if (proj.startsWith('loose:')) { const d = proj.slice(6); return all.filter((x) => dirOf(x) === d); }
    const root = proj === '.' ? '' : proj;
    const base = (S.treeIdx || new Map()).get(join2(root, 'src')) === true ? join2(root, 'src') : root;
    return all.filter((x) => !base || x.startsWith(base + '/'));
  };
  const wsKey = () => (S.engine && S.engine.workspace) || (fs.mode === 'memory' ? 'demo' : '');
  F.wsKey = wsKey;
  const saveExpanded = () => store.set('expanded:' + wsKey(), [...S.expanded]);
  F.saveExpanded = saveExpanded;

  // ───────────── értesítés ─────────────
  F.toast = (msg, kind) => {
    const colors = { ok: '#4ADE80', err: '#FF7A85', warn: '#F5C451' };
    const el = h('div', { class: 'toast', style: kind && colors[kind] ? { '--tc': colors[kind] } : null }, h('span', { class: 'diamond' }), h('span', { html: msg }));
    $('#toasts').append(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, kind === 'err' ? 5200 : 3200);
  };

  // ───────────── párbeszédablakok ─────────────
  let overlayClose = null;
  function showOverlay(node, onClose) {
    const ov = $('#overlay');
    ov.innerHTML = '';
    ov.append(node);
    ov.hidden = false;
    overlayClose = onClose;
    ov.onmousedown = (e) => { if (e.target === ov) closeOverlay(); };
  }
  function closeOverlay() {
    const ov = $('#overlay');
    if (ov.hidden) return;
    ov.hidden = true;
    ov.innerHTML = '';
    const c = overlayClose; overlayClose = null;
    if (c) c();
    if (F.editor && S.active) setTimeout(() => F.editor.focus(), 0);
  }
  F.closeOverlay = closeOverlay;

  /** Általános párbeszéd. fields: [{id,label,value,placeholder,hint,type,options}], choice: {id,value,items:[{value,label,desc,color}]} */
  F.dialog = (o) => new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); closeOverlay(); };
    const vals = {};
    const err = h('div', { class: 'dlg-err', hidden: true });
    const box = h('form', { class: 'dialog', role: 'dialog', 'aria-label': o.title });
    box.append(h('h2', null, o.icon ? h('span', { class: 'diamond', style: { background: o.iconColor || 'var(--accent)' } }) : null, o.title));
    if (o.text) box.append(h('p', { html: o.text }));
    if (o.choice) {
      vals[o.choice.id] = o.choice.value;
      const grid = h('div', { class: 'opt-grid' });
      o.choice.items.forEach((it) => {
        const b = h('button', { type: 'button', class: 'opt' + (it.value === o.choice.value ? ' sel' : ''), style: it.color ? { '--c': it.color } : null },
          h('b', null, h('span', { class: 'diamond' }), it.label), it.desc ? h('small', { text: it.desc }) : null);
        b.onclick = () => { vals[o.choice.id] = it.value; $$('.opt', grid).forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); if (o.onChoice) o.onChoice(it.value, box); };
        grid.append(b);
      });
      box.append(grid);
    }
    (o.fields || []).forEach((f) => {
      const id = 'dlg_' + f.id;
      let input;
      if (f.type === 'checkbox') {
        input = h('input', { type: 'checkbox', id });
        input.checked = !!f.value;
        box.append(h('label', { class: 'check', for: id }, input, f.label));
      } else if (f.type === 'select') {
        input = h('select', { class: 'field', id }, f.options.map((op) => h('option', { value: op.value, selected: op.value === f.value }, op.label)));
        box.append(h('label', { class: 'dlg-field', for: id }, h('span', { text: f.label }), input, f.hint ? h('span', { class: 'dlg-hint', text: f.hint }) : null));
      } else {
        input = h('input', { class: 'field', id, value: f.value || '', placeholder: f.placeholder || '', autocomplete: 'off', spellcheck: 'false' });
        box.append(h('label', { class: 'dlg-field', for: id }, h('span', { text: f.label }), input, f.hint ? h('span', { class: 'dlg-hint', text: f.hint }) : null));
      }
      f._el = input;
    });
    box.append(err);
    const actions = h('div', { class: 'dlg-actions' });
    (o.extra || []).forEach((x) => actions.append(h('button', { type: 'button', class: 'btn', style: x.left ? { marginRight: 'auto' } : null, onclick: () => {
      if (!x.collect) return finish(x.value);
      (o.fields || []).forEach((f) => { vals[f.id] = f.type === 'checkbox' ? f._el.checked : f._el.value.trim(); });
      finish(Object.assign({ __action: x.value }, vals));
    } }, x.label)));
    actions.append(h('button', { type: 'button', class: 'btn', onclick: () => finish(null) }, o.cancel || 'Mégse'));
    actions.append(h('button', { type: 'submit', class: 'btn ' + (o.danger ? 'danger' : 'accent') }, o.ok || 'Rendben'));
    box.append(actions);
    box.onsubmit = (e) => {
      e.preventDefault();
      (o.fields || []).forEach((f) => { vals[f.id] = f.type === 'checkbox' ? f._el.checked : f._el.value.trim(); });
      if (o.validate) {
        const m = o.validate(vals);
        if (m) { err.textContent = m; err.hidden = false; return; }
      }
      finish(o.fields || o.choice ? vals : true);
    };
    showOverlay(box, () => { if (!done) { done = true; resolve(null); } });
    const first = (o.fields || []).find((f) => f.type !== 'checkbox' && f.type !== 'select');
    setTimeout(() => {
      if (first) { first._el.focus(); const v = first._el.value; const dot = v.lastIndexOf('.'); first._el.setSelectionRange(o.selectStem && dot > 0 ? v.lastIndexOf('/') + 1 : v.length, o.selectStem && dot > 0 ? dot : v.length); }
      else $('button[type=submit]', box).focus();
    }, 20);
  });
  F.confirm = (title, text, ok, danger) => F.dialog({ title, text, ok: ok || 'Rendben', danger }).then((v) => !!v);

  // ───────────── helyi menü ─────────────
  F.hideMenu = () => hideMenu();
  F.menu = (x, y, items) => {
    const m = $('#menu');
    m.innerHTML = '';
    items.forEach((it) => {
      if (it === '-') { m.append(h('hr')); return; }
      m.append(h('button', { class: it.danger ? 'danger' : '', onclick: () => { hideMenu(); it.run(); } }, h('span', { text: it.label }), it.kbd ? h('span', { class: 'kbd', text: it.kbd }) : null));
    });
    m.hidden = false;
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
    m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  };
  const hideMenu = () => { $('#menu').hidden = true; };
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('#menu')) hideMenu(); });

  // ───────────── Monaco ─────────────
  function loadMonaco() {
    return new Promise((resolve, reject) => {
      if (!window.require) { reject(new Error('A szerkesztő nem töltődött be (nincs internet?)')); return; }
      const base = window.__monacoBase || 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/';
      window.MonacoEnvironment = {
        getWorkerUrl() {
          return 'data:text/javascript;charset=utf-8,' + encodeURIComponent(`self.MonacoEnvironment={baseUrl:'${base}'};importScripts('${base}vs/base/worker/workerMain.js');`);
        }
      };
      window.require.config({ paths: { vs: base + 'vs' }, 'vs/nls': { availableLanguages: {} } });
      window.require(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
    });
  }

  function defineTheme(key) {
    const acc = F.facets[key].accent.slice(1);
    const name = 'facet-' + key;
    monaco.editor.defineTheme(name, {
      base: 'vs-dark', inherit: true,
      rules: [
        { token: '', foreground: 'D3DCEB' },
        { token: 'comment', foreground: '5C6A7E', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'B9A6F7' },
        { token: 'type', foreground: '6FD3C1' },
        { token: 'type.identifier', foreground: '6FD3C1' },
        { token: 'identifier', foreground: 'D3DCEB' },
        { token: 'string', foreground: 'E6C07B' },
        { token: 'string.escape', foreground: 'F2928A' },
        { token: 'number', foreground: 'F2928A' },
        { token: 'regexp', foreground: 'F2928A' },
        { token: 'annotation', foreground: 'F5C451' },
        { token: 'delimiter', foreground: '8A97AB' },
        { token: 'operator', foreground: '8A97AB' },
        { token: 'tag', foreground: 'FF8FA3' },
        { token: 'metatag', foreground: 'FF8FA3' },
        { token: 'attribute.name', foreground: 'E6C07B' },
        { token: 'attribute.value', foreground: '9ED39B' },
        { token: 'tag.css', foreground: 'FFB86B' },
        { token: 'attribute.name.css', foreground: '7FB4FF' },
        { token: 'attribute.value.css', foreground: 'D3DCEB' },
        { token: 'attribute.value.number.css', foreground: 'F2928A' },
        { token: 'attribute.value.unit.css', foreground: 'F2928A' },
        { token: 'attribute.value.hex.css', foreground: 'F2928A' },
        { token: 'variable', foreground: '6FD3C1' },
        { token: 'key.json', foreground: '7FB4FF' },
        { token: 'string.key.json', foreground: '7FB4FF' },
        { token: 'string.value.json', foreground: 'E6C07B' }
      ],
      colors: {
        'editor.background': '#0C0F14',
        'editor.foreground': '#D3DCEB',
        'editorGutter.background': '#0C0F14',
        'editor.lineHighlightBackground': '#11161F',
        'editor.lineHighlightBorder': '#00000000',
        'editorLineNumber.foreground': '#3E4859',
        'editorLineNumber.activeForeground': '#' + acc,
        'editorCursor.foreground': '#' + acc,
        'editor.selectionBackground': '#' + acc + '33',
        'editor.inactiveSelectionBackground': '#' + acc + '1F',
        'editor.selectionHighlightBackground': '#' + acc + '1A',
        'editor.wordHighlightBackground': '#ffffff10',
        'editor.findMatchBackground': '#' + acc + '55',
        'editor.findMatchHighlightBackground': '#' + acc + '26',
        'editorBracketMatch.background': '#' + acc + '22',
        'editorBracketMatch.border': '#' + acc + '88',
        'editorIndentGuide.background1': '#1A202A',
        'editorIndentGuide.activeBackground1': '#2E3848',
        'editorWhitespace.foreground': '#222A36',
        'editorWidget.background': '#121721',
        'editorWidget.border': '#2A3341',
        'editorSuggestWidget.background': '#121721',
        'editorSuggestWidget.border': '#2A3341',
        'editorSuggestWidget.selectedBackground': '#' + acc + '26',
        'editorSuggestWidget.highlightForeground': '#' + acc,
        'editorSuggestWidget.focusHighlightForeground': '#' + acc,
        'editorHoverWidget.background': '#121721',
        'editorHoverWidget.border': '#2A3341',
        'editorError.foreground': '#FF6B6B',
        'editorWarning.foreground': '#F5C451',
        'editorOverviewRuler.border': '#00000000',
        'scrollbarSlider.background': '#232B3888',
        'scrollbarSlider.hoverBackground': '#33405Aaa',
        'scrollbarSlider.activeBackground': '#' + acc + '66',
        'minimap.background': '#0C0F14',
        'editorStickyScroll.background': '#0E1219',
        'editorStickyScrollHover.background': '#121721',
        'diffEditor.insertedTextBackground': '#4ADE8022',
        'diffEditor.removedTextBackground': '#FF6B6B22',
        'diffEditor.insertedLineBackground': '#4ADE8014',
        'diffEditor.removedLineBackground': '#FF6B6B14',
        'input.background': '#0C0F14',
        'input.border': '#2A3341',
        'focusBorder': '#' + acc + '88',
        'list.hoverBackground': '#1B2230',
        'list.activeSelectionBackground': '#' + acc + '26',
        'peekViewEditor.background': '#0E1219',
        'peekViewResult.background': '#121721'
      }
    });
    return name;
  }

  function editorOptions() {
    const s = F.settings;
    return {
      fontFamily: '"' + (s.fontFamily || 'JetBrains Mono') + '", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: s.fontSize, lineHeight: Math.round(s.fontSize * (s.lineHeight || 1.6)), fontLigatures: s.ligatures,
      minimap: { enabled: s.minimap, renderCharacters: false, scale: 1 }, wordWrap: s.wrap ? 'on' : 'off',
      smoothScrolling: s.smoothScroll, cursorBlinking: s.cursorBlinking, cursorSmoothCaretAnimation: s.smoothScroll ? 'on' : 'off', cursorStyle: s.cursorStyle,
      padding: { top: 14, bottom: 14 }, renderLineHighlight: 'all', scrollBeyondLastLine: false, lineNumbers: s.lineNumbers,
      bracketPairColorization: { enabled: s.bracketColors }, guides: { bracketPairs: s.guides ? 'active' : false, indentation: s.guides },
      stickyScroll: { enabled: s.stickyScroll }, glyphMargin: true, folding: true, lineNumbersMinChars: 4,
      fixedOverflowWidgets: true, automaticLayout: true, insertSpaces: true,
      suggest: { preview: true, showStatusBar: false }, quickSuggestions: s.quickSuggest ? { other: true, comments: false, strings: false } : false,
      autoClosingBrackets: s.autoClose ? 'languageDefined' : 'never', autoClosingQuotes: s.autoClose ? 'languageDefined' : 'never',
      parameterHints: { enabled: true }, formatOnPaste: false, linkedEditing: true, renderWhitespace: s.renderWhitespace,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }, overviewRulerBorder: false, dropIntoEditor: { enabled: false },
      contextmenu: true, mouseWheelZoom: true, colorDecorators: true, unicodeHighlight: { ambiguousCharacters: false }
    };
  }

  // ───────────── facet alkalmazása ─────────────
  function applyFacet(key, force) {
    const def = F.facets[key];
    const changed = S.facet !== key;
    S.facet = key;
    const root = document.documentElement.style;
    root.setProperty('--accent', def.accent);
    root.setProperty('--accent-soft', F.rgba(def.accent, 0.12));
    root.setProperty('--accent-line', F.rgba(def.accent, 0.35));
    root.setProperty('--accent-glow', F.rgba(def.accent, 0.32));
    document.body.dataset.facet = key;
    $('#facetChipText').textContent = def.label + ' facet';
    $('#stFacet').textContent = def.label;
    if (window.monaco) monaco.editor.setTheme(defineTheme(key));
    const runBtn = $('#runBtn');
    runBtn.disabled = !def.run || !S.active;
    $('#runLabel').textContent = def.runLabel || 'Futtatás';
    $('#bottomHint').textContent = def.hint || '';
    if (changed || force) {
      renderToolbar();
      renderStageTabs();
      if (def.bottom && changed) F.bottom.show(def.bottom);
    }
    renderStage();
    F.emit('facet', key);
  }
  F.applyFacet = applyFacet;
  F.editorOptions = editorOptions;
  F.tabSizeFor = (def) => (F.settings.tabSize === 'auto' ? def.tab : +F.settings.tabSize);

  function renderToolbar(quiet) {
    const tb = $('#toolbar');
    const def = F.facets[S.facet];
    const sx = tb.scrollLeft;
    tb.innerHTML = '';
    if (!quiet) {
      tb.classList.remove('morph');
      void tb.offsetWidth;
      tb.classList.add('morph');
    }
    if (!S.active) {
      tb.append(h('span', { class: 'tb-label', text: 'FACET' }), h('span', { style: { color: 'var(--muted)' }, text: 'Nyiss meg egy fájlt: az eszköztár a típusához igazodik.' }));
      return;
    }
    tb.append(h('span', { class: 'tb-label', text: def.label + ' eszközök' }));
    if (!def.tools.length) tb.append(h('span', { style: { color: 'var(--muted)' }, text: 'Ehhez a fájltípushoz nincsenek külön eszközök.' }));
    def.tools.forEach((t) => {
      if (t.when && !t.when()) return;
      if (t.el) { tb.append(t.el()); return; }
      tb.append(h('button', { class: 'chip' + (t.primary ? ' primary' : ''), title: t.title || t.label, onclick: (ev) => { try { t.run(ev); } catch (e) { F.toast(esc(e.message), 'err'); } } },
        t.primary ? null : h('span', { class: 'bullet' }), t.label, t.kbd ? h('span', { class: 'kbd', text: t.kbd }) : null));
    });
    if (quiet) tb.scrollLeft = sx;
  }
  F.renderToolbar = renderToolbar;

  // ───────────── jobb panel (színpad) ─────────────
  function stageDefs() {
    const def = F.facets[S.facet];
    if (!S.active || !def.stage.length) return [];
    return def.stage.filter((s) => !s.when || s.when());
  }
  function renderStageTabs() {
    const wrap = $('#stageTabs');
    const tabs = stageDefs();
    wrap.innerHTML = '';
    wrap.hidden = tabs.length < 2;
    let cur = S.stageTab[S.facet];
    if (!tabs.find((t) => t.id === cur)) cur = tabs[0] && tabs[0].id;
    S.stageTab[S.facet] = cur;
    tabs.forEach((t) => wrap.append(h('button', { class: 'seg' + (t.id === cur ? ' active' : ''), onclick: () => F.showStage(t.id), html: typeof t.label === 'function' ? t.label() : esc(t.label) })));
  }
  F.renderStageTabs = renderStageTabs;
  F.showStage = (id) => {
    S.stageTab[S.facet] = id;
    store.set('stageTab', S.stageTab);
    renderStageTabs();
    renderStage();
  };
  F.stageTab = () => S.stageTab[S.facet];
  function renderStage() {
    const body = $('#stageBody');
    const tabs = stageDefs();
    const cur = tabs.find((t) => t.id === S.stageTab[S.facet]) || tabs[0];
    body.className = 'stage-body' + (cur && cur.fill ? ' fill' : '');
    if (!cur) {
      body.innerHTML = '';
      body.append(stageIntro());
      return;
    }
    if (body.dataset.stage !== S.facet + ':' + cur.id) { body.innerHTML = ''; body.dataset.stage = S.facet + ':' + cur.id; }
    try { cur.render(body, F.active()); } catch (e) { console.error(e); body.textContent = 'Hiba a panelben: ' + e.message; }
  }
  F.refreshStage = debounce(() => renderStage(), 60);
  F.refreshStageNow = renderStage;
  function stageIntro() {
    const a = F.active();
    const box = h('div', { class: 'stage-empty' });
    if (!a) {
      box.innerHTML = '<b>A facet-panel</b> mindig ahhoz a fájlhoz igazodik, amit éppen szerkesztesz.<br><br>Java fájlnál osztálytérképet és kódgenerátort, HTML-nél élő előnézetet, CSS-nél vizuális eszközöket mutat.';
    } else {
      box.innerHTML = `<b>${esc(F.facets[a.facet].label)}</b> fájlhoz nincs külön panel. Nyiss meg egy <b>.java</b>, <b>.html</b>, <b>.css</b> vagy <b>.js</b> fájlt.`;
    }
    return box;
  }

  // ───────────── fülek ─────────────
  function renderTabs() {
    const wrap = $('#tabs');
    wrap.innerHTML = '';
    S.open.forEach((p) => {
      const ic = F.iconFor(p);
      const dirty = F.dirty(p);
      const name = p.split('/').pop();
      const dup = S.open.filter((q) => q.split('/').pop() === name).length > 1;
      const x = h('span', { class: 'x' + (dirty ? '' : ' clean'), title: 'Bezárás' },
        dirty ? h('span', { class: 'dot' }) : null,
        h('span', { html: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2 L8 8 M8 2 L2 8" stroke="currentColor" stroke-width="1.4"/></svg>' }));
      x.onclick = (e) => { e.stopPropagation(); F.closeFile(p); };
      const tab = h('button', { class: 'tab' + (p === S.active ? ' active' : ''), role: 'tab', title: p, style: { '--tab-accent': ic.c } },
        h('span', { class: 'ti', style: { color: ic.c }, text: ic.t }), h('span', { text: name }),
        dup ? h('span', { style: { color: 'var(--muted-2)', fontSize: '11px' }, text: p.split('/').slice(-2, -1)[0] || '' }) : null, x);
      tab.onclick = () => F.open(p);
      tab.onauxclick = (e) => { if (e.button === 1) F.closeFile(p); };
      tab.oncontextmenu = (e) => {
        e.preventDefault();
        F.menu(e.clientX, e.clientY, [
          { label: 'Bezárás', run: () => F.closeFile(p) },
          { label: 'A többi bezárása', run: async () => { for (const q of [...S.open]) if (q !== p) await F.closeFile(q); } },
          '-',
          { label: 'Mutasd a fájlfában', run: () => revealInTree(p) }
        ]);
      };
      wrap.append(tab);
    });
    if (S.open.length && S.open.length < 4) wrap.append(h('span', { class: 'tabs-hint', text: 'A felület a megnyitott fájl típusához igazodik' }));
    const act = $('.tab.active', wrap);
    if (act) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  F.renderTabs = renderTabs;
  const renderTabsSoon = debounce(renderTabs, 80);

  // ───────────── megnyitás, mentés, bezárás ─────────────
  F.open = async (path, pos) => {
    if (!path) return;
    if (F.isImage(path)) return showImage(path);
    hideImage();
    let doc = S.docs.get(path);
    if (!doc) {
      const facet = F.facetFor(path);
      const def = F.facets[facet];
      if (def.custom) {
        let ed;
        try { ed = await def.custom.create(path); } catch (e) { F.toast(esc(e.message), 'err'); return; }
        if (!ed) return;
        doc = { custom: ed, saved: ed.version(), view: null, facet };
        S.docs.set(path, doc);
        ed.onChange(() => onContent(path));
        if (ed.history) F.history.ensureInitial(path, ed.text());
      } else {
        let text;
        try { text = await fs.read(path); } catch (e) { F.toast(esc(e.message), 'err'); return; }
        if (!window.monaco) return;
        const uri = monaco.Uri.parse('file:///' + path.split('/').map(encodeURIComponent).join('/'));
        let model = monaco.editor.getModel(uri);
        const lang = def.langFor ? def.langFor(path) : def.lang;
        if (model) model.setValue(text); else model = monaco.editor.createModel(text, lang, uri);
        model.updateOptions({ tabSize: F.tabSizeFor(def), insertSpaces: true });
        doc = { model, saved: model.getAlternativeVersionId(), view: null, facet };
        S.docs.set(path, doc);
        model.onDidChangeContent(() => onContent(path));
        F.history.ensureInitial(path, text);
      }
    }
    if (S.active && S.active !== path) {
      const prev = S.docs.get(S.active);
      if (prev && !prev.custom) prev.view = F.editor.saveViewState();
    }
    if (!S.open.includes(path)) {
      const i = S.open.indexOf(S.active);
      S.open.splice(i >= 0 ? i + 1 : S.open.length, 0, path);
    }
    S.active = path;
    const host = $('#customView');
    if (doc.custom) {
      F.editor.setModel(null);
      if (host.firstChild !== doc.custom.el) { host.innerHTML = ''; host.append(doc.custom.el); }
      host.hidden = false;
    } else {
      if (!host.hidden) { host.hidden = true; host.innerHTML = ''; }
      F.editor.setModel(doc.model);
      if (doc.view) F.editor.restoreViewState(doc.view);
    }
    $('#welcome').hidden = true;
    document.body.classList.remove('no-file');
    closeDiff();
    applyFacet(doc.facet);
    if (pos && pos.line && !doc.custom) {
      const col = pos.col || 1;
      F.editor.revealLineInCenter(pos.line);
      if (pos.endCol) F.editor.setSelection(new monaco.Range(pos.line, col, pos.endLine || pos.line, pos.endCol));
      else F.editor.setPosition({ lineNumber: pos.line, column: col });
    }
    if (doc.custom) doc.custom.focus(); else F.editor.focus();
    renderTabs();
    renderTree();
    refreshOutline();
    updateStatus();
    pushRecent(path);
    F.history.renderPanel();
    F.emit('open', path);
    if (F.term.cmdMode) F.term.input(false);
    const def = F.facets[doc.facet];
    if (def.onActivate) def.onActivate(path, doc.model || null);
  };

  function pushRecent(p) {
    S.recent = [{ p, t: Date.now() }].concat(S.recent.filter((r) => r.p !== p)).slice(0, 8);
    store.set('recent:' + wsKey(), S.recent);
  }

  F.save = async (path, opts) => {
    path = path || S.active;
    const doc = S.docs.get(path);
    if (!doc) return false;
    let ver = verOf(doc);
    let text = null;
    try {
      if (doc.custom) { await doc.custom.save(); if (doc.custom.history) text = doc.custom.text(); }
      else {
        if (opts && opts.manual && F.settings.formatOnSave && path === S.active && F.editor.getModel() === doc.model) {
          try { await F.editor.getAction('editor.action.formatDocument').run(); } catch (e) { /* nincs formázó */ }
          ver = verOf(doc);
        }
        text = doc.model.getValue();
        let fixed = text;
        if (F.settings.trimTrailing) fixed = fixed.replace(/[ \t]+$/gm, '');
        if (F.settings.finalNewline && fixed.length && !fixed.endsWith('\n')) fixed += '\n';
        if (fixed !== text) {
          const keep = path === S.active && F.editor.getModel() === doc.model ? F.editor.saveViewState() : null;
          doc.model.pushEditOperations([], [{ range: doc.model.getFullModelRange(), text: fixed }], () => null);
          if (keep) F.editor.restoreViewState(keep);
          text = fixed;
          ver = verOf(doc);
        }
        await fs.write(path, text);
      }
    } catch (e) {
      F.toast('Mentés nem sikerült: ' + esc(e.message), 'err');
      setSave('Mentés sikertelen');
      return false;
    }
    doc.saved = ver;
    if (text != null) F.history.snapshot(path, text, opts && opts.manual ? 'Mentés' : 'Automatikus mentés', opts && opts.manual);
    renderTabsSoon();
    renderTree();
    setSave('Mentve ' + new Date().toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' }));
    const def = F.facets[doc.facet];
    if (def.onSave) def.onSave(path, doc.model || null);
    F.emit('save', path);
    return true;
  };
  F.saveAll = async () => { for (const p of S.open) if (F.dirty(p)) await F.save(p); };

  F.closeFile = async (path) => {
    if (F.dirty(path)) {
      const r = await F.dialog({ title: 'Mented a változásokat?', text: `A(z) <b>${esc(path.split('/').pop())}</b> mentetlen módosításokat tartalmaz.`, ok: 'Mentés', extra: [{ label: 'Elvetés', value: 'discard' }] });
      if (r === null) return false;
      if (r !== 'discard') { if (!(await F.save(path))) return false; }
    }
    const i = S.open.indexOf(path);
    if (i < 0) return true;
    S.open.splice(i, 1);
    const doc = S.docs.get(path);
    if (doc) {
      const def = F.facets[doc.facet];
      if (def.onClose) def.onClose(path);
      S.docs.delete(path);
      disposeDoc(doc);
    }
    if (S.active === path) {
      S.active = null;
      const next = S.open[Math.min(i, S.open.length - 1)];
      if (next) await F.open(next);
      else showWelcome();
    } else renderTabs();
    return true;
  };

  function disposeDoc(doc) {
    if (doc.custom) { try { doc.custom.dispose(); } catch (e) { /* már nincs */ } const host = $('#customView'); if (host.firstChild === doc.custom.el) { host.innerHTML = ''; host.hidden = true; } }
    else doc.model.dispose();
  }
  F.markClean = (p) => { const d = S.docs.get(p); if (d) d.saved = verOf(d); };

  function showWelcome() {
    S.active = null;
    $('#customView').hidden = true;
    $('#customView').innerHTML = '';
    if (F.editor) F.editor.setModel(null);
    hideImage();
    closeDiff();
    renderTabs();
    renderTree();
    applyFacet('text', true);
    $('#facetChipText').textContent = 'FACET';
    $('#stFacet').textContent = 'FACET';
    renderWelcome();
    $('#welcome').hidden = false;
    document.body.classList.add('no-file');
    refreshOutline();
    updateStatus();
    F.history.renderPanel();
  }
  F.showWelcome = showWelcome;

  function showImage(path) {
    const v = $('#imageView');
    const url = fs.url(path);
    v.innerHTML = '';
    v.append(url ? h('img', { src: url + '?t=' + Date.now(), alt: path }) : h('span', { class: 'stage-empty', text: 'Képek megjelenítése csak a helyi motorral működik.' }));
    v.hidden = false;
    $('#welcome').hidden = true;
  }
  function hideImage() { $('#imageView').hidden = true; }

  // ───────────── tartalomváltozás ─────────────
  let pulseEnergy = 0, pulseRaf = 0;
  function pulse() {
    if (!F.settings.pulse) return;
    pulseEnergy = Math.min(1, pulseEnergy + 0.14);
    if (!pulseRaf) {
      const tick = () => {
        pulseEnergy *= 0.965;
        document.documentElement.style.setProperty('--pulse', pulseEnergy.toFixed(3));
        if (pulseEnergy > 0.01) pulseRaf = requestAnimationFrame(tick); else { pulseRaf = 0; document.documentElement.style.setProperty('--pulse', '0'); }
      };
      pulseRaf = requestAnimationFrame(tick);
    }
  }
  const autosaveTimers = {};
  const changeTimers = {};
  function onContent(path) {
    renderTabsSoon();
    pulse();
    setSave('Szerkesztés…');
    if (F.settings.autosave) {
      clearTimeout(autosaveTimers[path]);
      const dd = S.docs.get(path);
      autosaveTimers[path] = setTimeout(() => { if (F.dirty(path)) F.save(path); }, (dd && dd.custom && dd.custom.autosaveDelay) || F.settings.autosaveDelay || 900);
    }
    clearTimeout(changeTimers[path]);
    changeTimers[path] = setTimeout(() => {
      const doc = S.docs.get(path);
      if (!doc) return;
      const def = F.facets[doc.facet];
      if (path === S.active) refreshOutline();
      if (def.onChange) def.onChange(path, doc.model || null);
      F.emit('change', path);
    }, 350);
  }

  // ───────────── vázlat (outline) ─────────────
  function refreshOutline() {
    const box = $('#outline');
    const a = F.active();
    box.innerHTML = '';
    if (!a) { $('#outlineTitle').textContent = 'Vázlat'; box.append(h('div', { class: 'ol-empty', text: 'Nincs megnyitott fájl.' })); return; }
    $('#outlineTitle').textContent = 'Vázlat · ' + a.path.split('/').pop();
    const items = a.def.outline ? a.def.outline(a.model, a.custom) : [];
    if (!items.length) { box.append(h('div', { class: 'ol-empty', text: 'Nincs mit mutatni ebben a fájlban.' })); return; }
    items.slice(0, 200).forEach((it) => {
      box.append(h('div', { class: 'ol-item', style: { paddingLeft: (4 + (it.depth || 0) * 14) + 'px' }, title: it.run ? 'Ugrás' : 'Ugrás: ' + it.line + '. sor', onclick: () => (it.run ? it.run() : F.goto(it.line, it.col)) },
        h('span', { class: 'ol-k', style: { color: it.c }, text: it.k }), h('span', { text: it.t })));
    });
  }
  F.refreshOutline = refreshOutline;

  F.goto = (line, col, endCol) => {
    if (!F.editor.getModel()) return;
    F.editor.revealLineInCenter(line);
    if (endCol) F.editor.setSelection(new monaco.Range(line, col || 1, line, endCol));
    else F.editor.setPosition({ lineNumber: line, column: col || 1 });
    F.editor.focus();
  };
  F.openAt = (path, line, col, endCol) => F.open(path, { line, col, endCol });

  /** Szöveg beszúrása a kurzorhoz Monaco-szinttel (${1:...} helyőrzőkkel). */
  F.insertSnippet = (text) => {
    if (!F.editor.getModel()) { F.toast('Előbb nyiss meg egy fájlt.'); return; }
    F.editor.focus();
    const c = F.editor.getContribution('snippetController2');
    if (c) c.insert(text); else F.editor.trigger('facet', 'type', { text });
  };
  F.replaceAll = (model, text, label) => {
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
    if (label) F.toast(label, 'ok');
  };

  // ───────────── fájlfa ─────────────
  F.refreshTree = async () => {
    try {
      if (fs.mode === 'local') {
        S.engine = await apiJson('GET', 'ping');
        if (!S.engine.workspace) { S.tree = []; renderTree(); return; }
      }
      S.tree = await fs.list();
      S.treeIdx = new Map(S.tree.map((n) => [n.p, n.d]));
    } catch (e) {
      F.toast('A fájllista nem érhető el: ' + esc(e.message), 'err');
      return;
    }
    renderTree();
    F.emit('tree');
  };

  function buildTree() {
    const root = { name: '', path: '', dir: true, kids: new Map() };
    const ensure = (path) => {
      let node = root;
      if (!path) return root;
      path.split('/').forEach((seg, i, arr) => {
        const p = arr.slice(0, i + 1).join('/');
        if (!node.kids.has(seg)) node.kids.set(seg, { name: seg, path: p, dir: true, kids: new Map() });
        node = node.kids.get(seg);
      });
      return node;
    };
    S.tree.forEach((n) => {
      const parent = ensure(n.p.split('/').slice(0, -1).join('/'));
      const name = n.p.split('/').pop();
      if (!parent.kids.has(name)) parent.kids.set(name, { name, path: n.p, dir: n.d, kids: new Map() });
      else parent.kids.get(name).dir = n.d;
    });
    return root;
  }

  function renderTree() {
    const wrap = $('#tree');
    const root = buildTree();
    wrap.innerHTML = '';
    $('#projectName').textContent = S.engine ? (S.engine.name || 'Nincs megnyitott mappa') : 'Demó';
    $('#sideTitle').textContent = S.engine && S.engine.name ? S.engine.name : (fs.mode === 'memory' ? 'Demó' : 'Fájlok');
    const hasFolder = fs.mode === 'memory' || (S.engine && S.engine.workspace);
    $$('#newFileBtn, #newFolderBtn, #refreshBtn').forEach((b) => { b.hidden = !hasFolder; });
    if (!hasFolder) {
      wrap.append(h('div', { class: 'tree-empty' },
        h('p', { text: 'Nincs megnyitott mappa.' }),
        h('button', { class: 'btn accent', style: { width: '100%', justifyContent: 'center' }, onclick: () => F.openFolderDialog() }, 'Mappa megnyitása'),
        h('button', { class: 'btn', style: { width: '100%', justifyContent: 'center', marginTop: '8px' }, onclick: () => F.newProject() }, 'Új projekt'),
        recentFolders().length ? h('div', { class: 'tree-recent' }, h('span', { class: 'eyebrow', text: 'Legutóbbi mappák' }),
          recentFolders().slice(0, 5).map((r) => h('button', { class: 'node', title: r.path, onclick: () => F.openFolder(r.path) }, h('span', { class: 'fi', style: { background: 'transparent', color: 'var(--muted)' }, html: '<svg width="13" height="13" viewBox="0 0 14 14"><path d="M1.5 3.5 h4 l1 1 h6 v7 h-11 Z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>' }), h('span', { class: 'nm', text: r.name })))) : null));
      return;
    }
    if (!root.kids.size) {
      wrap.append(h('div', { class: 'tree-empty', html: 'A mappa üres.<br>Hozz létre egy fájlt a fenti <b>Új fájl</b> gombbal.' }));
      return;
    }
    const sorter = (a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, 'hu', { numeric: true }) : a.dir ? -1 : 1);
    const walk = (node, depth) => {
      [...node.kids.values()].sort(sorter).forEach((k) => {
        const open = S.expanded.has(k.path);
        const ic = k.dir ? null : F.iconFor(k.path);
        const row = h('div', { class: 'node' + (k.dir ? ' folder' : '') + (open ? ' open' : '') + (k.path === S.active ? ' active' : ''), style: { paddingLeft: (8 + depth * 14) + 'px' }, 'data-path': k.path, 'data-dir': k.dir ? '1' : null, draggable: 'true', title: k.path },
          k.dir ? h('span', { class: 'chev', html: '<svg width="8" height="8" viewBox="0 0 8 8"><path d="M2 1 L6 4 L2 7" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>' }) : h('span', { class: 'chev' }),
          k.dir ? h('span', { class: 'fi', style: { background: 'transparent', color: depth === 0 ? 'var(--accent)' : '#5A667A' }, html: depth === 0 ? '<svg width="12" height="12" viewBox="0 0 14 14"><path d="M7 1.5 L12.5 4.5 V9.5 L7 12.5 L1.5 9.5 V4.5 Z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>' : '<svg width="13" height="13" viewBox="0 0 14 14"><path d="M1.5 3.5 h4 l1 1 h6 v7 h-11 Z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>' })
            : h('span', { class: 'fi', style: { color: ic.c }, text: ic.t }),
          h('span', { class: 'nm', text: k.name }),
          !k.dir && F.dirty(k.path) ? h('span', { class: 'dirty' }) : null);
        row.onclick = () => {
          if (k.dir) { if (open) S.expanded.delete(k.path); else S.expanded.add(k.path); saveExpanded(); renderTree(); }
          else F.open(k.path);
        };
        row.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); treeMenu(e, k); };
        wrap.append(row);
        if (k.dir && open) walk(k, depth + 1);
      });
    };
    walk(root, 0);
  }
  F.renderTree = renderTree;

  function revealInTree(p) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) S.expanded.add(parts.slice(0, i).join('/'));
    saveExpanded();
    setView('files');
    renderTree();
    const row = $(`.node[data-path="${CSS.escape(p)}"]`);
    if (row) row.scrollIntoView({ block: 'center' });
  }
  F.revealInTree = revealInTree;

  function treeMenu(e, k) {
    const items = [];
    const dir = k.dir ? k.path : k.path.split('/').slice(0, -1).join('/');
    if (!k.dir) items.push({ label: 'Megnyitás', run: () => F.open(k.path) });
    items.push({ label: 'Új fájl itt…', kbd: '⌘N', run: () => F.newFile(dir) });
    items.push({ label: 'Új mappa itt…', run: () => F.newFolder(dir) });
    if (F.facets.java.newClass) items.push({ label: 'Új Java osztály itt…', run: () => F.facets.java.newClass(dir) });
    items.push('-');
    items.push({ label: 'Átnevezés…', run: () => F.renameItem(k.path) });
    if (!k.dir) items.push({ label: 'Másolat készítése', run: () => duplicate(k.path) });
    items.push({ label: 'Útvonal másolása', run: () => { navigator.clipboard && navigator.clipboard.writeText(k.path).then(() => F.toast('Útvonal a vágólapon')).catch(() => {}); } });
    items.push('-');
    items.push({ label: 'Törlés (kukába)', danger: true, run: () => F.deleteItem(k.path, k.dir) });
    F.menu(e.clientX, e.clientY, items);
  }

  const validName = (v) => {
    if (!v) return 'Adj meg egy nevet.';
    if (/[\\:*?"<>|]/.test(v)) return 'A név nem tartalmazhat ilyen jelet: \\ : * ? " < > |';
    if (v.split('/').some((s) => s === '..' || s === '.')) return 'A név nem tartalmazhat „..” részt.';
    return null;
  };
  const joinPath = (dir, name) => (dir ? dir.replace(/\/$/, '') + '/' : '') + name.replace(/^\/+/, '');

  const needFolder = () => {
    if (fs.mode === 'local' && !(S.engine && S.engine.workspace)) { F.toast('Előbb nyiss meg egy mappát.'); F.openFolderDialog(); return true; }
    return false;
  };
  F.newFile = async (dir, suggested) => {
    if (needFolder()) return;
    if (dir == null) {
      const a = F.active();
      dir = a ? a.path.split('/').slice(0, -1).join('/') : '';
    }
    const v = await F.dialog({
      title: 'Új fájl', icon: true,
      text: `Hely: <code style="font-family:var(--font-code)">${esc(dir || 'munkaterület gyökere')}</code><br>A kiterjesztés dönti el a fájl facetjét: <b>.java</b>, <b>.html</b>, <b>.css</b>, <b>.js</b>…`,
      fields: [{ id: 'name', label: 'Fájlnév', value: suggested || '', placeholder: 'pl. Jatekos.java vagy rolunk.html' }],
      ok: 'Létrehozás', validate: (x) => validName(x.name) || (!/\.[a-z0-9]+$/i.test(x.name) ? 'Adj meg kiterjesztést is, pl. .java vagy .html' : null)
    });
    if (!v) return;
    const path = joinPath(dir, v.name);
    if (await fs.exists(path)) { F.toast('Már létezik: ' + esc(path), 'warn'); return F.open(path); }
    await fs.write(path, window.FacetSamples.blank(path));
    expandTo(path);
    await F.refreshTree();
    await F.open(path);
    F.toast(`<b>${esc(v.name)}</b> létrehozva`, 'ok');
  };
  F.createFile = async (path, content, open = true) => {
    await fs.write(path, content);
    expandTo(path);
    await F.refreshTree();
    if (open) await F.open(path);
  };
  F.newFolder = async (dir) => {
    if (needFolder()) return;
    const v = await F.dialog({ title: 'Új mappa', fields: [{ id: 'name', label: 'Mappanév', placeholder: 'pl. img vagy src/hu/app' }], ok: 'Létrehozás', validate: (x) => validName(x.name) });
    if (!v) return;
    const path = joinPath(dir || '', v.name);
    await fs.mkdir(path);
    expandTo(path + '/x');
    S.expanded.add(path);
    await F.refreshTree();
  };
  function expandTo(path) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) S.expanded.add(parts.slice(0, i).join('/'));
    saveExpanded();
  }
  F.expandTo = expandTo;

  /** Elem áthelyezése/átnevezése: a megnyitott fülek az új helyen nyílnak meg újra. */
  F.moveItem = async (path, to, quiet) => {
    if (!to || to === path) return false;
    if (to.startsWith(path + '/')) { F.toast('Egy mappát nem lehet saját magába tenni.', 'warn'); return false; }
    const affected = S.open.filter((p) => p === path || p.startsWith(path + '/'));
    for (const p of affected) if (F.dirty(p)) await F.save(p);
    try { await fs.rename(path, to); } catch (e) { F.toast(esc(e.message), 'err'); return false; }
    const wasActive = S.active;
    const views = {};
    for (const p of affected) {
      const doc = S.docs.get(p);
      if (doc && !doc.custom) views[p] = p === wasActive ? F.editor.saveViewState() : doc.view;
      S.open.splice(S.open.indexOf(p), 1);
      if (doc) { S.docs.delete(p); disposeDoc(doc); }
    }
    if (affected.includes(wasActive)) S.active = null;
    if (S.expanded.has(path)) { S.expanded.delete(path); S.expanded.add(to); }
    expandTo(to);
    await F.refreshTree();
    const reopen = affected.filter((p) => p !== wasActive).concat(affected.includes(wasActive) ? [wasActive] : []);
    for (const p of reopen) {
      const np = to + p.slice(path.length);
      await F.open(np);
      const d = S.docs.get(np);
      if (d && views[p] && np === S.active && !d.custom) F.editor.restoreViewState(views[p]);
    }
    if (wasActive && !affected.includes(wasActive) && S.open.includes(wasActive)) await F.open(wasActive);
    if (!S.active) showWelcome();
    F.emit('moved', path, to);
    if (!quiet) F.toast('Áthelyezve: <b>' + esc(to) + '</b>', 'ok');
    return true;
  };

  F.renameItem = async (path) => {
    const v = await F.dialog({ title: 'Átnevezés', fields: [{ id: 'name', label: 'Új név vagy útvonal', value: path }], selectStem: true, ok: 'Átnevezés', validate: (x) => validName(x.name) });
    if (!v || v.name === path) return;
    if (await F.moveItem(path, v.name, true)) F.toast('Átnevezve: <b>' + esc(v.name.split('/').pop()) + '</b>', 'ok');
  };
  F.validName = validName;
  F.joinPath = joinPath;

  async function duplicate(path) {
    const text = await F.textOf(path);
    const m = path.match(/^(.*?)(\.[^./]+)?$/);
    let n = 2, np;
    do { np = m[1] + '-' + n + (m[2] || ''); n++; } while (S.tree.find((t) => t.p === np));
    await F.createFile(np, text);
  }

  F.deleteItem = async (path, isDir) => {
    const ok = !F.settings.confirmDelete || await F.confirm('Törlés', `Biztosan törlöd: <b>${esc(path)}</b>${isDir ? ' (a teljes mappát)' : ''}?<br><span style="color:var(--muted)">A FACET nem véglegesen töröl: a FACET kukájába kerül (<code>~/.facet</code>).</span>`, 'Törlés', true);
    if (!ok) return;
    for (const p of S.open.filter((q) => q === path || q.startsWith(path + '/'))) {
      const doc = S.docs.get(p);
      if (doc) doc.saved = verOf(doc);
      await F.closeFile(p);
    }
    try { await fs.remove(path); } catch (e) { F.toast(esc(e.message), 'err'); return; }
    await F.refreshTree();
    F.toast('Kukába helyezve: ' + esc(path.split('/').pop()));
  };

  // ───────────── mappák (mint a VS Code-ban) ─────────────
  const recentFolders = () => store.get('recentFolders', []);
  function pushRecentFolder(path, name) {
    store.set('recentFolders', [{ path, name, t: Date.now() }].concat(recentFolders().filter((r) => r.path !== path)).slice(0, 8));
  }
  F.recentFolders = recentFolders;
  const shortPath = (p) => (S.engine && S.engine.home && p.startsWith(S.engine.home) ? '~' + p.slice(S.engine.home.length) : p);
  F.shortPath = shortPath;

  function loadWorkspaceState() {
    S.expanded = new Set(store.get('expanded:' + wsKey(), []));
    S.recent = store.get('recent:' + wsKey(), []);
    H.cache = {};
    F.problems.set('java', []);
    F.problems.set('html', []);
  }

  async function closeAllFiles() {
    for (const p of [...S.open]) if (!(await F.closeFile(p))) return false;
    return true;
  }

  /** Mappa megnyitása a gépről; minden fül bezárul, a fájlfa összecsukva indul. */
  F.openFolder = async (path, opts) => {
    if (!(await closeAllFiles())) return false;
    let r;
    try { r = await apiJson('POST', 'open', { path, create: opts && opts.create ? 1 : null }); } catch (e) { F.toast(esc(e.message), 'err'); return false; }
    S.engine = r;
    pushRecentFolder(r.workspace, r.name);
    loadWorkspaceState();
    F.emit('workspace');
    await F.refreshTree();
    setView('files');
    showWelcome();
    if (!(opts && opts.quiet)) F.toast(`Megnyitva: <b>${esc(r.name)}</b>`, 'ok');
    return true;
  };

  F.closeFolder = async () => {
    if (!(await closeAllFiles())) return;
    try { S.engine = await apiJson('POST', 'close'); } catch (e) { return; }
    S.tree = [];
    loadWorkspaceState();
    F.emit('workspace');
    renderTree();
    showWelcome();
  };

  F.openFolderDialog = async () => {
    const p = await F.pickFolder({ title: 'Mappa megnyitása', ok: 'Mappa megnyitása' });
    if (p) await F.openFolder(p);
  };

  /** Mappaválasztó ablak: a gép mappáinak böngészése. Eredmény: abszolút útvonal vagy null. */
  F.pickFolder = (o) => new Promise((resolve) => {
    let done = false, cur = store.get('lastBrowse', '') || '';
    const finish = (v) => { if (done) return; done = true; if (v) store.set('lastBrowse', v); resolve(v); closeOverlay(); };
    const box = h('div', { class: 'dialog picker', role: 'dialog', 'aria-label': o.title });
    const crumbs = h('div', { class: 'pk-crumbs' });
    const list = h('div', { class: 'pk-list', tabindex: '0' });
    const shortcuts = h('div', { class: 'pk-short' });
    const hint = h('div', { class: 'pk-hint' });
    const err = h('div', { class: 'dlg-err', hidden: true });
    const okBtn = h('button', { type: 'button', class: 'btn accent' }, o.ok || 'Kiválasztás');
    const newBtn = h('button', { type: 'button', class: 'btn', style: { marginRight: 'auto' } }, '+ Új mappa itt');
    box.append(h('h2', null, h('span', { class: 'diamond' }), o.title), shortcuts, crumbs, list, hint, err,
      h('div', { class: 'dlg-actions' }, newBtn, h('button', { type: 'button', class: 'btn', onclick: () => finish(null) }, 'Mégse'), okBtn));
    const KIND = { java: { t: 'J', c: F.facets.java.accent, l: 'Java projekt' }, web: { t: '<>', c: F.facets.html.accent, l: 'weboldal' }, git: { t: 'git', c: '#8FD3A8', l: 'git tároló' } };
    async function go(path) {
      err.hidden = true;
      let r;
      try { r = await apiJson('GET', 'browse', { path }); } catch (e) { err.textContent = e.message; err.hidden = false; if (!cur) go(''); return; }
      cur = r.path;
      shortcuts.innerHTML = '';
      r.shortcuts.forEach((s) => shortcuts.append(h('button', { type: 'button', class: 'chip' + (s.path === r.path ? ' on' : ''), onclick: () => go(s.path) }, s.name)));
      crumbs.innerHTML = '';
      const parts = r.path.split(/[\\/]/).filter(Boolean);
      const isWin = /^[A-Za-z]:/.test(r.path);
      let acc = isWin ? '' : '';
      crumbs.append(h('button', { type: 'button', class: 'pk-crumb', disabled: !r.parent || null, title: 'Egy szinttel feljebb', onclick: () => r.parent && go(r.parent) }, '↑'));
      parts.forEach((seg, i) => {
        acc = isWin && i === 0 ? seg + '\\' : (isWin ? acc + (acc.endsWith('\\') ? '' : '\\') + seg : acc + '/' + seg);
        const target = acc;
        if (i) crumbs.append(h('span', { class: 'pk-sep', text: '/' }));
        crumbs.append(h('button', { type: 'button', class: 'pk-crumb' + (i === parts.length - 1 ? ' cur' : ''), onclick: () => go(target) }, target === r.home ? '~ ' + seg : seg));
      });
      list.innerHTML = '';
      if (!r.dirs.length) list.append(h('div', { class: 'pk-empty', text: 'Ebben a mappában nincs almappa.' }));
      r.dirs.forEach((d) => {
        const k = KIND[d.kind];
        list.append(h('button', { type: 'button', class: 'pk-row', title: d.path, onclick: () => go(d.path) },
          h('span', { class: 'pk-ic', html: k ? `<b style="color:${k.c}">${esc(k.t)}</b>` : '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M1.5 3.5 h4 l1 1 h6 v7 h-11 Z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>' }),
          h('span', { class: 'pk-name', text: d.name }), k ? h('span', { class: 'pk-kind', text: k.l }) : null));
      });
      const k = KIND[r.kind];
      hint.innerHTML = `Ezt nyitod meg: <b>${esc(shortPath(r.path))}</b>${k ? ` <span style="color:${k.c}">· ${k.l}nak tűnik</span>` : ''}`;
      okBtn.disabled = r.path === r.home || !r.parent ? true : null;
      if (okBtn.disabled) hint.innerHTML = 'Lépj be abba a mappába, amit meg szeretnél nyitni, vagy hozz létre újat.';
    }
    okBtn.onclick = () => finish(cur);
    newBtn.onclick = async () => {
      const name = await inlineName(box);
      if (!name) return;
      try { const r = await apiJson('POST', 'browse/mkdir', { path: cur.replace(/[\\/]$/, '') + '/' + name }); go(r.path); } catch (e) { err.textContent = e.message; err.hidden = false; }
    };
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName !== 'INPUT' && !okBtn.disabled) { e.preventDefault(); finish(cur); } });
    showOverlay(box, () => { if (!done) { done = true; resolve(null); } });
    go(o.start || cur);
  });

  function inlineName(box) {
    return new Promise((resolve) => {
      const old = $('.pk-new', box);
      if (old) old.remove();
      const inp = h('input', { class: 'field', placeholder: 'Az új mappa neve, majd Enter', spellcheck: 'false', 'aria-label': 'Új mappa neve' });
      const row = h('div', { class: 'pk-new' }, inp);
      $('.pk-list', box).before(row);
      inp.focus();
      inp.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); const v = inp.value.trim(); row.remove(); resolve(validName(v) ? null : v); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); row.remove(); resolve(null); }
      };
    });
  }

  // ───────────── új projekt ─────────────
  F.newProject = async (tplId) => {
    const tpls = window.FacetSamples.templates;
    if (fs.mode !== 'local') return newProjectDemo(tplId);
    let state = { tpl: tplId || 'java-konzol', name: '', loc: store.get('projectLoc', S.engine ? S.engine.projects : '') };
    for (;;) {
      const v = await F.dialog({
        title: 'Új projekt', icon: true,
        text: 'A projekt egy új mappa lesz a gépeden, és a FACET rögtön meg is nyitja.',
        choice: { id: 'tpl', value: state.tpl, items: tpls.map((t) => ({ value: t.id, label: t.name, desc: t.desc, color: F.facets[t.facet].accent })) },
        fields: [
          { id: 'name', label: 'Projekt neve', value: state.name, placeholder: 'pl. nix-task-08', hint: 'Ez lesz a mappa neve.' },
          { id: 'loc', label: 'Hely', value: state.loc, hint: 'Ebbe a mappába kerül az új projekt.' }
        ],
        extra: [{ label: 'Hely tallózása…', value: 'browse', collect: true, left: true }],
        ok: 'Projekt létrehozása',
        validate: (x) => validName(x.name) || (x.name.includes('/') ? 'A projekt neve ne tartalmazzon / jelet.' : null) || (!x.loc ? 'Add meg, hova kerüljön a projekt.' : null)
      });
      if (!v) return;
      state = { tpl: v.tpl, name: v.name, loc: v.loc };
      if (v.__action === 'browse') {
        const p = await F.pickFolder({ title: 'Hova kerüljön a projekt?', ok: 'Ide', start: state.loc });
        if (p) state.loc = p;
        continue;
      }
      break;
    }
    const tpl = tpls.find((t) => t.id === state.tpl);
    const target = state.loc.replace(/[\\/]$/, '') + '/' + state.name;
    const parent = await apiJson('GET', 'browse', { path: state.loc }).catch(() => null);
    if (parent && parent.dirs.some((d) => d.name === state.name)) { F.toast('Ez a mappa már létezik: ' + esc(shortPath(target)), 'warn'); return; }
    store.set('projectLoc', state.loc);
    if (!(await F.openFolder(target, { create: true, quiet: true }))) return;
    for (const rel in tpl.files) await fs.write(rel, tpl.files[rel]);
    S.engine = await apiJson('GET', 'ping');
    if (tpl.open) expandTo(tpl.open);
    await F.refreshTree();
    if (tpl.open) await F.open(tpl.open);
    F.toast(`<b>${esc(state.name)}</b> kész · ${esc(tpl.name)}`, 'ok');
    if (!tpl.open) F.newFile('');
  };

  async function newProjectDemo(tplId) {
    const tpls = window.FacetSamples.templates;
    const v = await F.dialog({
      title: 'Új projekt', icon: true,
      choice: { id: 'tpl', value: tplId || 'java-konzol', items: tpls.map((t) => ({ value: t.id, label: t.name, desc: t.desc, color: F.facets[t.facet].accent })) },
      fields: [{ id: 'name', label: 'Projekt neve', placeholder: 'pl. nix-task-08' }],
      ok: 'Projekt létrehozása',
      validate: (x) => validName(x.name) || (S.tree.find((n) => n.p === x.name) ? 'Már van ilyen nevű projekt.' : null)
    });
    if (!v) return;
    const tpl = tpls.find((t) => t.id === v.tpl);
    await fs.mkdir(v.name);
    for (const rel in tpl.files) await fs.write(v.name + '/' + rel, tpl.files[rel]);
    if (tpl.open) expandTo(v.name + '/' + tpl.open);
    await F.refreshTree();
    if (tpl.open) await F.open(v.name + '/' + tpl.open);
  }

  // ───────────── üdvözlő képernyő ─────────────
  function renderWelcome() {
    const w = $('#welcome');
    const tpls = window.FacetSamples.templates;
    const recent = S.recent.filter((r) => S.tree.find((n) => n.p === r.p)).slice(0, 5);
    const when = (t) => {
      const d = new Date(t), now = new Date();
      if (d.toDateString() === now.toDateString()) return 'ma, ' + d.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
      return d.toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' });
    };
    w.innerHTML = '';
    const left = h('section', { class: 'wl-left' },
      h('span', { html: '<svg width="60" height="60" viewBox="0 0 26 26" aria-hidden="true"><path d="M13 1 L24 8 L24 18 L13 25 L2 18 L2 8 Z" fill="#161C27" stroke="#2C3646" stroke-width="0.6"/><path d="M13 1 L24 8 L13 13 Z" fill="#FF8A3D"/><path d="M2 8 L13 1 L13 13 Z" fill="#FF5C7A"/><path d="M2 8 L13 13 L13 25 L2 18 Z" fill="#4DA3FF"/><path d="M13 13 L24 8 L24 18 L13 25 Z" fill="#273142"/></svg>' }),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, h('h1', { text: 'FACET' }), h('p', { class: 'wl-tag', text: 'Minden fájlnak saját arca. A szerkesztő átalakul ahhoz, amin épp dolgozol.' })),
      (() => {
        const K = isMac ? '⌘' : 'Ctrl+';
        const hasFolder = fs.mode === 'memory' || (S.engine && S.engine.workspace);
        const acts = h('div', { class: 'wl-actions' });
        if (fs.mode === 'local') acts.append(h('button', { class: 'wl-btn' + (hasFolder ? '' : ' primary'), onclick: () => F.openFolderDialog() }, 'Mappa megnyitása ', h('span', { class: 'kbd', text: K + 'O' })));
        acts.append(h('button', { class: 'wl-btn' + (hasFolder || fs.mode !== 'local' ? ' primary' : ''), onclick: () => F.newProject() }, 'Új projekt ', h('span', { class: 'kbd', text: '⌥' + K + 'N' })));
        if (hasFolder) acts.append(h('button', { class: 'wl-btn', onclick: () => F.newFile() }, 'Új fájl ', h('span', { class: 'kbd', text: K + 'N' })));
        return acts;
      })(),
      S.engine && S.engine.workspace ? h('div', { class: 'wl-folder' },
        h('span', { class: 'eyebrow', text: 'Megnyitott mappa' }),
        h('div', { class: 'wl-row', style: { cursor: 'default' } }, h('span', { class: 'diamond' }), h('span', { style: { fontWeight: 600, color: 'var(--fg-bright)', flex: 'none' }, text: S.engine.name }), h('span', { class: 'p', text: shortPath(S.engine.workspace) }),
          h('button', { class: 'btn', style: { marginLeft: 'auto', padding: '4px 10px' }, onclick: () => F.closeFolder() }, 'Bezárás'))) : null,
      recent.length ? h('div', { class: 'wl-recent' }, h('span', { class: 'eyebrow', style: { marginBottom: '6px' }, text: 'Legutóbbi fájlok' }),
        recent.map((r) => h('button', { class: 'wl-row', onclick: () => F.open(r.p) },
          h('span', { class: 'diamond', style: { background: F.iconFor(r.p).c } }),
          h('span', { style: { fontWeight: 500, flex: 'none' }, text: r.p.split('/').pop() }),
          h('span', { class: 'p', text: r.p.split('/').slice(0, -1).join('/') }),
          h('span', { style: { marginLeft: 'auto', fontSize: '12px', color: 'var(--muted-2)', flex: 'none' }, text: when(r.t) })))) : null,
      fs.mode === 'local' && recentFolders().filter((r) => !S.engine || r.path !== S.engine.workspace).length ? h('div', { class: 'wl-recent' }, h('span', { class: 'eyebrow', style: { marginBottom: '6px' }, text: 'Legutóbbi mappák' }),
        recentFolders().filter((r) => !S.engine || r.path !== S.engine.workspace).slice(0, 5).map((r) => h('button', { class: 'wl-row', onclick: () => F.openFolder(r.path) },
          h('span', { html: '<svg width="14" height="14" viewBox="0 0 14 14" style="color:var(--muted);flex:none"><path d="M1.5 3.5 h4 l1 1 h6 v7 h-11 Z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>' }),
          h('span', { style: { fontWeight: 500, flex: 'none' }, text: r.name }),
          h('span', { class: 'p', text: shortPath(r.path) }),
          h('span', { style: { marginLeft: 'auto', fontSize: '12px', color: 'var(--muted-2)', flex: 'none' }, text: when(r.t) })))) : null);
    const right = h('section', { class: 'wl-right' },
      h('span', { class: 'eyebrow', text: 'Kezdj egy sablonból' }),
      h('div', { class: 'wl-cards' }, tpls.map((t) => h('button', { class: 'wl-card', onclick: () => F.newProject(t.id) },
        h('div', { class: 'thumb', style: t.light ? { background: '#F6EFE6', border: '0' } : null, html: t.thumb }),
        h('div', { class: 'name' }, h('span', { class: 'diamond', style: { background: F.facets[t.facet].accent } }), t.name),
        h('span', { class: 'desc', text: t.desc })))),
      h('div', { class: 'wl-feats' },
        feat('Facet-váltás', 'Java fájlnál csak Java eszközök, HTML-nél csak HTML eszközök. Az eszköztár, a jobb panel és a színek is váltanak.'),
        feat('Hibatolmács', 'A fordító angol hibáit magyarul magyarázza el, közvetlenül a hibás sor alatt, egy kattintásos javítással.'),
        feat('Időgép', 'Minden mentésről pillanatkép. Csúszkával visszatekerhető, összehasonlítható és visszaállítható, git nélkül is.'),
        feat('Kijelölés az oldalon', 'Kattints egy elemre az előnézetben, és a kurzor a forráskód pontos sorára ugrik.')));
    w.append(h('div', { class: 'wl' }, left, right));
    const k = isMac ? '⌘' : 'Ctrl+';
    w.append(h('div', { class: 'wl-keys' },
      h('span', null, h('span', { class: 'kbd', text: k + 'K' }), ' parancsok'),
      h('span', null, h('span', { class: 'kbd', text: k + 'P' }), ' fájl keresése'),
      h('span', null, h('span', { class: 'kbd', text: k + '↵' }), ' futtatás'),
      h('span', null, h('span', { class: 'kbd', text: k + 'S' }), ' mentés'),
      h('span', null, h('span', { class: 'kbd', text: '⇧' + k + 'M' }), ' Flow mód'),
      h('span', { style: { marginLeft: 'auto' }, text: S.engine ? `Helyi motor · Java ${S.engine.java}` : 'Demó mód · böngészőben tárolt fájlok' })));
  }
  function feat(t, d) { return h('div', { class: 'wl-feat' }, h('b', { text: t }), h('span', { text: d })); }

  // ───────────── parancspaletta ─────────────
  const commands = [];
  F.command = (c) => { commands.push(c); };
  const norm1 = (c) => c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function fuzzy(q, text) {
    if (!q) return { s: 0, idx: [] };
    const chars = Array.from(text);
    const t = chars.map((c) => norm1(c)[0] || c).join('');
    const nq = Array.from(q).map((c) => norm1(c)[0] || c).join('');
    const at = t.indexOf(nq);
    if (at >= 0) {
      const idx = []; for (let i = at; i < at + nq.length; i++) idx.push(i);
      const wordStart = at === 0 || /[\s/._-]/.test(t[at - 1]);
      return { s: 200 - at + (wordStart ? 60 : 0), idx };
    }
    let ti = 0, s = 0, prev = -2; const idx = [];
    for (const ch of nq) {
      if (ch === ' ') continue;
      ti = t.indexOf(ch, ti);
      if (ti < 0) return null;
      idx.push(ti); s += ti === prev + 1 ? 6 : 1; prev = ti; ti++;
    }
    return { s, idx };
  }
  function markIdx(text, idx) {
    const set = new Set(idx);
    return Array.from(text).map((c, i) => (set.has(i) ? '<mark>' + esc(c) + '</mark>' : esc(c))).join('');
  }

  F.palette = (mode = 'all', initial = '') => {
    const box = h('div', { class: 'palette', role: 'dialog', 'aria-label': 'Parancspaletta' });
    const input = h('input', { value: initial, placeholder: mode === 'files' ? 'Fájl neve…' : 'Parancs, fájl vagy kérdés… pl. „getter”, „új osztály”, „futtasd”', autocomplete: 'off', spellcheck: 'false' });
    const def = F.facets[S.facet];
    const chip = S.active ? h('span', { class: 'facet-chip', style: { padding: '3px 9px' } }, h('span', { class: 'diamond', style: { width: '6px', height: '6px' } }), def.label) : null;
    const list = h('div', { class: 'pal-list' });
    box.append(h('div', { class: 'pal-in' }, h('span', { html: '<svg width="16" height="16" viewBox="0 0 14 14"><circle cx="6" cy="6" r="4.5" fill="none" stroke="#8794A8" stroke-width="1.4"/><path d="M9.5 9.5 L13 13" stroke="#8794A8" stroke-width="1.4"/></svg>' }), input, chip), list,
      h('div', { class: 'pal-foot' }, h('span', null, h('span', { class: 'kbd', text: '↑↓' }), ' léptetés'), h('span', null, h('span', { class: 'kbd', text: '↵' }), ' végrehajtás'), h('span', null, h('span', { class: 'kbd', text: 'Esc' }), ' bezárás'), h('span', { class: 'r', text: 'Magyarul is érti: „új osztály”, „futtasd”, „formázd”' })));
    let items = [], sel = 0;
    const build = () => {
      const q = input.value.trim();
      const groups = [];
      if (mode !== 'files') {
        const avail = commands.filter((c) => (!c.facet || c.facet === S.facet && S.active) && (!c.when || c.when()));
        const scored = avail.map((c) => {
          const hay = c.label + ' ' + (c.keywords || '');
          const m = fuzzy(q, hay);
          const ml = fuzzy(q, c.label);
          return m ? { kind: 'cmd', c, s: m.s + (c.facet ? 30 : 0), idx: ml ? ml.idx : [] } : null;
        }).filter(Boolean).sort((a, b) => b.s - a.s);
        const fc = scored.filter((x) => x.c.facet), gc = scored.filter((x) => !x.c.facet);
        if (fc.length) groups.push({ title: 'Parancsok ebben a facetben', items: fc.slice(0, q ? 8 : 10) });
        if (gc.length) groups.push({ title: 'Általános', items: gc.slice(0, q ? 6 : 8) });
      }
      const files = F.files();
      let fItems;
      if (!q) {
        fItems = S.recent.filter((r) => files.includes(r.p)).map((r) => ({ kind: 'file', p: r.p, idx: [] }));
      } else {
        fItems = files.map((p) => {
          const name = p.split('/').pop();
          const m = fuzzy(q, name);
          const mp = m ? null : fuzzy(q, p);
          return m ? { kind: 'file', p, s: m.s + 50, idx: m.idx } : mp ? { kind: 'file', p, s: mp.s, idx: [] } : null;
        }).filter(Boolean).sort((a, b) => b.s - a.s);
      }
      if (fItems.length) groups.push({ title: q ? 'Fájlok' : 'Legutóbbi fájlok', items: fItems.slice(0, mode === 'files' ? 30 : 6) });
      if (mode !== 'files' && q && S.active) {
        const hist = (F.history.cache[S.active] || []).map((sn, i) => ({ sn, i })).filter((x) => fuzzy(q, x.sn.l || '')).slice(-3).reverse();
        if (hist.length) groups.push({ title: 'Időgép', items: hist.map((x) => ({ kind: 'hist', sn: x.sn, i: x.i, idx: [] })) });
      }
      list.innerHTML = '';
      items = [];
      groups.forEach((g) => {
        list.append(h('div', { class: 'pal-group eyebrow', text: g.title }));
        g.items.forEach((it) => {
          const i = items.length;
          items.push(it);
          let row;
          if (it.kind === 'cmd') {
            row = h('div', { class: 'pal-item' }, h('span', { class: 'pal-ic', text: it.c.icon || it.c.label[0] }), h('span', { class: 'pal-label', html: markIdx(it.c.label, it.idx) }), it.c.detail ? h('span', { class: 'pal-detail', text: it.c.detail }) : null, (it.c.key && F.keys ? F.keys.label(it.c.key) : it.c.kbd) ? h('span', { class: 'kbd', text: it.c.key && F.keys ? F.keys.label(it.c.key) : it.c.kbd }) : null);
          } else if (it.kind === 'file') {
            const ic = F.iconFor(it.p);
            row = h('div', { class: 'pal-item' }, h('span', { class: 'pal-ic', style: { color: ic.c, background: 'transparent' }, text: ic.t }), h('span', { class: 'pal-label', html: markIdx(it.p.split('/').pop(), it.idx) }), h('span', { class: 'pal-detail', text: it.p.split('/').slice(0, -1).join('/') }));
          } else {
            row = h('div', { class: 'pal-item' }, h('span', { class: 'pal-ic', html: '<svg width="13" height="13" viewBox="0 0 18 18"><circle cx="9" cy="9" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 5 V9 L12 10.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>' }), h('span', { class: 'pal-label', text: '„' + it.sn.l + '”' }), h('span', { class: 'pal-detail', text: new Date(it.sn.t).toLocaleString('hu-HU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }));
          }
          row.onmousemove = () => { if (sel !== i) { sel = i; paint(); } };
          row.onclick = () => run(i);
          list.append(row);
        });
      });
      if (!items.length) list.append(h('div', { class: 'pal-none', text: 'Nincs találat. Próbáld így: „új fájl”, „mentés”, vagy egy fájl nevét.' }));
      sel = 0; paint();
    };
    const paint = () => {
      $$('.pal-item', list).forEach((el, i) => el.classList.toggle('sel', i === sel));
      const el = $$('.pal-item', list)[sel];
      if (el) el.scrollIntoView({ block: 'nearest' });
    };
    const run = (i) => {
      const it = items[i];
      if (!it) return;
      closeOverlay();
      setTimeout(() => {
        if (it.kind === 'cmd') { try { it.c.run(); } catch (e) { F.toast(esc(e.message), 'err'); } }
        else if (it.kind === 'file') F.open(it.p);
        else F.history.openDiff(S.active, it.i);
      }, 10);
    };
    input.oninput = build;
    input.onkeydown = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); paint(); }
      else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
      else if (e.key === 'Escape') { e.preventDefault(); closeOverlay(); }
    };
    showOverlay(box);
    build();
    setTimeout(() => { input.focus(); input.select(); }, 10);
  };

  // ───────────── Időgép ─────────────
  const H = F.history = {
    cache: {},
    file: (p) => '.facet/history/' + p + '.json',
    async load(p) {
      if (H.cache[p]) return H.cache[p];
      let list = [];
      if (fs.mode === 'local') {
        try { const r = await api('GET', 'file', { path: H.file(p), opt: 1 }); if (r.status === 200) list = (JSON.parse(await r.text()).snaps || []); } catch (e) { list = []; }
      } else list = store.get('hist:' + p, []);
      H.cache[p] = list;
      return list;
    },
    persist: {},
    save(p) {
      clearTimeout(H.persist[p]);
      H.persist[p] = setTimeout(() => {
        const list = H.cache[p] || [];
        if (fs.mode === 'local') api('PUT', 'file', { path: H.file(p) }, JSON.stringify({ v: 1, snaps: list })).catch(() => {});
        else store.set('hist:' + p, list.slice(-15));
      }, 400);
    },
    async ensureInitial(p, text) {
      const list = await H.load(p);
      if (!list.length) { list.push({ t: Date.now(), c: text, l: 'Megnyitáskor' }); H.save(p); }
      if (p === S.active) H.renderPanel();
    },
    async snapshot(p, text, label, force) {
      const list = await H.load(p);
      const last = list[list.length - 1];
      if (last && last.c === text) return;
      if (!force && last && Date.now() - last.t < 90 * 1000) { last.c = text; last.t = Date.now(); last.l = last.l === 'Megnyitáskor' ? label : last.l; }
      else list.push({ t: Date.now(), c: text, l: label });
      while (list.length > 60) list.shift();
      H.save(p);
      if (p === S.active) H.renderPanel();
    },
    sel: null,
    async renderPanel() {
      const box = $('#historyPanel');
      if (!box || $('#view-history').hidden) return;
      box.innerHTML = '';
      const a = F.active();
      if (!a) { box.append(h('div', { class: 'hp-empty', html: 'Nyiss meg egy fájlt: az Időgép minden mentésről pillanatképet őriz, amit itt visszatekerhetsz.' })); return; }
      const list = await H.load(a.path);
      box.append(h('div', { class: 'hp-file', text: a.path }));
      if (!list.length) { box.append(h('div', { class: 'hp-empty', text: 'Még nincs pillanatkép. Mentéskor készül.' })); return; }
      const selIdx = H.sel != null && H.sel < list.length ? H.sel : list.length - 1;
      const pct = list.length > 1 ? (selIdx / (list.length - 1)) * 100 : 100;
      const track = h('div', { class: 'hp-track' }, h('div', { class: 'hp-line' }), h('div', { class: 'hp-fill', style: { width: `calc(${pct}% - 12px)` } }));
      const ticks = h('div', { class: 'hp-ticks' });
      const shown = list.length > 30 ? list.map((_, i) => i).filter((i) => i % Math.ceil(list.length / 30) === 0 || i === list.length - 1) : list.map((_, i) => i);
      shown.forEach((i) => ticks.append(h('button', { class: 'hp-tick' + (i === selIdx ? ' sel' : ''), title: new Date(list[i].t).toLocaleTimeString('hu-HU'), onclick: () => H.openDiff(a.path, i) })));
      track.append(ticks);
      box.append(track);
      const range = h('input', { type: 'range', class: 'hp-range', min: 0, max: list.length - 1, value: selIdx, 'aria-label': 'Időgép csúszka' });
      range.oninput = () => H.openDiff(a.path, +range.value, true);
      box.append(range);
      const ul = h('div', { class: 'hp-list' });
      for (let i = list.length - 1; i >= 0; i--) {
        const sn = list[i], prev = list[i - 1];
        const d = prev ? lineDelta(prev.c, sn.c) : { a: sn.c.split('\n').length, d: 0 };
        const t = new Date(sn.t);
        const today = t.toDateString() === new Date().toDateString();
        ul.append(h('div', { class: 'hp-item' + (i === H.sel ? ' sel' : ''), onclick: () => H.openDiff(a.path, i) },
          h('span', { class: 't', text: (today ? '' : t.toLocaleDateString('hu-HU', { month: '2-digit', day: '2-digit' }) + ' ') + t.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' }) }),
          h('span', { class: 'l', text: sn.l }),
          h('span', { class: 'd', html: `<span class="add">+${d.a}</span> <span class="del">−${d.d}</span>` })));
      }
      box.append(ul);
      box.append(h('div', { class: 'set-note', text: 'Kattints egy pillanatképre: a szerkesztő megmutatja a különbséget, és egy gombbal visszaállíthatod.' }));
    },
    async openDiff(p, i, fromSlider) {
      const list = await H.load(p);
      const sn = list[i];
      if (!sn) return;
      if (p !== S.active) await F.open(p);
      H.sel = i;
      const doc = S.docs.get(p);
      const view = $('#diffView');
      view.hidden = false;
      $('#diffRestore').hidden = false;
      $('#diffExtra').innerHTML = '';
      const modified = doc.custom ? monaco.editor.createModel(doc.custom.text(), 'plaintext') : doc.model;
      setDiffModels(monaco.editor.createModel(sn.c, doc.custom ? 'plaintext' : (F.facets[doc.facet].langFor ? F.facets[doc.facet].langFor(p) : F.facets[doc.facet].lang)), modified, !!doc.custom);
      const t = new Date(sn.t);
      $('#diffTitle').innerHTML = `<b>Időgép</b> · ${esc(p.split('/').pop())} · bal oldalt: ${t.toLocaleString('hu-HU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })} („${esc(sn.l)}”), jobb oldalt: jelenlegi`;
      $('#diffRestore').onclick = async () => {
        await H.snapshot(p, await F.textOf(p), 'Visszaállítás előtt', true);
        if (doc.custom) doc.custom.setText(sn.c); else F.replaceAll(doc.model, sn.c);
        await F.save(p);
        closeDiff();
        F.toast('Visszaállítva erre: ' + t.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' }), 'ok');
      };
      if (!fromSlider) H.renderPanel(); else $$('.hp-item').forEach((el) => el.classList.remove('sel'));
    }
  };
  function lineDelta(a, b) {
    const A = a.split('\n'), B = b.split('\n');
    const count = new Map();
    A.forEach((l) => count.set(l, (count.get(l) || 0) + 1));
    let added = 0;
    B.forEach((l) => { const c = count.get(l); if (c) count.set(l, c - 1); else added++; });
    let removed = 0;
    count.forEach((c) => { removed += c; });
    return { a: added, d: removed };
  }
  /** Az összehasonlító nézet modelljei. A „saját” (ideiglenes) modelleket bezáráskor eldobjuk. */
  let diffOwned = [];
  function setDiffModels(original, modified, ownModified) {
    if (!F.diffEditor) {
      F.diffEditor = monaco.editor.createDiffEditor($('#diffEditor'), Object.assign(editorOptions(), { readOnly: false, originalEditable: false, renderSideBySide: true, enableSplitViewResizing: true, ignoreTrimWhitespace: false, renderOverviewRuler: false, glyphMargin: false }));
    }
    const old = diffOwned;
    F.diffEditor.setModel({ original, modified });
    diffOwned = [original].concat(ownModified ? [modified] : []);
    old.forEach((m) => { try { m.dispose(); } catch (e) { /* már eldobva */ } });
  }
  /** Két szöveg összehasonlítása (pl. Git: utolsó commit ↔ jelenlegi). actions: [{label, run, accent}] */
  F.openCompare = async (o) => {
    if (o.path && o.path !== S.active && !o.noOpen) await F.open(o.path);
    const doc = o.path ? S.docs.get(o.path) : null;
    const lang = o.lang || (doc && !doc.custom ? doc.model.getLanguageId() : 'plaintext');
    const modified = o.modified != null ? monaco.editor.createModel(o.modified, lang) : doc && !doc.custom ? doc.model : monaco.editor.createModel(doc ? doc.custom.text() : '', lang);
    const own = o.modified != null || !doc || !!doc.custom;
    $('#diffView').hidden = false;
    $('#diffRestore').hidden = true;
    setDiffModels(monaco.editor.createModel(o.original || '', lang), modified, own);
    $('#diffTitle').innerHTML = o.title || '';
    const ex = $('#diffExtra');
    ex.innerHTML = '';
    (o.actions || []).forEach((a) => ex.append(h('button', { class: 'btn' + (a.accent ? ' accent' : ''), onclick: a.run }, a.label)));
  };
  function closeDiff() {
    const v = $('#diffView');
    if (!v || v.hidden) return;
    v.hidden = true;
    H.sel = null;
    if (F.diffEditor) {
      F.diffEditor.setModel(null);
      diffOwned.forEach((m) => { try { m.dispose(); } catch (e) { /* már eldobva */ } });
      diffOwned = [];
    }
    H.renderPanel();
    if (F.editor) F.editor.focus();
  }
  F.closeDiff = closeDiff;

  // ───────────── keresés a projektben ─────────────
  const TEXT_EXT = ['java', 'html', 'htm', 'css', 'js', 'mjs', 'json', 'md', 'txt', 'xml', 'csv', 'properties', 'yml', 'yaml', 'svg', 'ts'];
  const doSearch = debounce(async () => {
    const q = $('#searchInput').value;
    const cs = $('#searchCase').checked;
    const out = $('#searchResults');
    out.innerHTML = '';
    if (q.length < 2) { out.append(h('div', { class: 'hp-empty', text: 'Írj be legalább két karaktert.' })); return; }
    const needle = cs ? q : q.toLowerCase();
    const files = F.files().filter((p) => TEXT_EXT.includes(F.ext(p))).slice(0, 500);
    let total = 0;
    for (const p of files) {
      let text;
      try { text = await F.textOf(p); } catch (e) { continue; }
      const lines = text.split('\n');
      const hits = [];
      lines.forEach((l, i) => {
        const hay = cs ? l : l.toLowerCase();
        const at = hay.indexOf(needle);
        if (at >= 0) hits.push({ i, at, l });
      });
      if (!hits.length) continue;
      total += hits.length;
      const ic = F.iconFor(p);
      out.append(h('div', { class: 'sr-file' }, h('span', { style: { color: ic.c, font: '600 9px var(--font-code)' }, text: ic.t }), p.split('/').pop(), h('span', { class: 'muted', text: hits.length + ' · ' + p.split('/').slice(0, -1).join('/') })));
      hits.slice(0, 50).forEach((x) => {
        const start = Math.max(0, x.at - 30);
        const pre = x.l.slice(start, x.at).trimStart(), mid = x.l.slice(x.at, x.at + q.length), post = x.l.slice(x.at + q.length, x.at + q.length + 80);
        out.append(h('div', { class: 'sr-hit', onclick: () => F.openAt(p, x.i + 1, x.at + 1, x.at + 1 + q.length) }, h('span', { class: 'ln', text: x.i + 1 }), h('span', { html: esc(pre) + '<mark>' + esc(mid) + '</mark>' + esc(post) })));
      });
      if (total > 800) break;
    }
    if (!total) out.append(h('div', { class: 'hp-empty', text: 'Nincs találat.' }));
  }, 250);

  // ───────────── beállítások ─────────────
  function applySettings() {
    if (F.editor) F.editor.updateOptions(editorOptions());
    if (F.diffEditor) F.diffEditor.updateOptions({ fontSize: F.settings.fontSize, lineHeight: Math.round(F.settings.fontSize * (F.settings.lineHeight || 1.6)) });
    for (const [, d] of S.docs) if (d.model) d.model.updateOptions({ tabSize: F.tabSizeFor(F.facets[d.facet]) });
    document.body.classList.toggle('no-pulse', !F.settings.pulse);
    document.documentElement.style.setProperty('--term-size', (F.settings.termFontSize || 13) + 'px');
    document.documentElement.style.setProperty('--flow-w', ({ narrow: '900px', wide: '1280px', full: '100%' })[F.settings.flowWidth] || '1280px');
    F.emit('settings');
  }
  F.applySettings = applySettings;

  // ───────────── oldalsáv nézetek ─────────────
  // ───────────── panelek ki/be ─────────────
  const layout = Object.assign({ side: true, stage: true }, store.get('layout', {}));
  /** Oldalsó panel ('side') vagy facet-panel ('stage') megjelenítése/elrejtése. */
  F.setPanel = (which, show) => {
    const el = $(which === 'side' ? '#side' : '#stage');
    const vis = show == null ? el.hidden : !!show;
    el.hidden = !vis;
    $(`.gutter[data-gutter="${which}"]`).hidden = !vis;
    layout[which] = vis;
    store.set('layout', layout);
    const btn = $(which === 'side' ? '#toggleSide' : '#toggleStage');
    if (btn) { btn.classList.toggle('on', vis); btn.setAttribute('aria-pressed', String(vis)); }
    if (which === 'side') $$('.rail-btn[data-view]').forEach((b) => b.classList.toggle('active', vis && !$('#view-' + b.dataset.view).hidden));
    if (which === 'stage' && vis) renderStage();
    F.emit('resize');
  };
  F.panelOpen = (which) => !$(which === 'side' ? '#side' : '#stage').hidden;

  function setView(v, toggle) {
    const side = $('#side');
    const already = !side.hidden && !$('#view-' + v).hidden;
    if (toggle && already) { F.setPanel('side', false); return; }
    $$('.side-view').forEach((s) => { s.hidden = s.id !== 'view-' + v; });
    F.setPanel('side', true);
    if (v === 'search') setTimeout(() => $('#searchInput').focus(), 10);
    if (v === 'history') H.renderPanel();
    F.emit('view', v);
  }
  F.setView = setView;
  function toggleSide() { F.setPanel('side'); }

  // ───────────── alsó panel ─────────────
  F.bottom = {
    show(pane) {
      S.bottomPane = pane;
      $$('#bottomTabs .seg').forEach((b) => b.classList.toggle('active', b.dataset.pane === pane));
      $$('#bottom .pane').forEach((p) => { p.hidden = p.id !== 'pane-' + pane; });
      $('#bottom').classList.remove('collapsed');
    },
    toggle() { $('#bottom').classList.toggle('collapsed'); }
  };

  const nearBottom = (el) => el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  const scrollDown = (el, force) => { if (force || nearBottom(el)) el.scrollTop = el.scrollHeight; };

  /** Terminál: sorok, élő folyam, magyarázó kártyák, bemenet. */
  F.term = {
    blocks: [],
    clear() { $('#termOut').innerHTML = ''; this.cur = null; },
    row(tag, msg, cls, tagColor) {
      const out = $('#termOut');
      const stick = nearBottom(out);
      out.append(h('div', { class: 't-row' }, h('span', { class: 't-tag', style: tagColor ? { color: tagColor } : null, text: tag }), h('span', { class: 't-msg ' + (cls || ''), html: msg })));
      this.cur = null;
      scrollDown(out, stick);
    },
    html(htmlStr) {
      const out = $('#termOut');
      const stick = nearBottom(out);
      const d = h('div', { html: htmlStr });
      out.append(d);
      this.cur = null;
      scrollDown(out, stick);
      return d;
    },
    stream(text, cls) {
      const out = $('#termOut');
      const stick = nearBottom(out);
      if (!this.cur || this.cur.cls !== cls) {
        this.cur = { cls, text: '', el: h('span', { class: cls }) };
        out.append(this.cur.el);
      }
      this.cur.text += text;
      const c = this.cur;
      if (!c.raf) c.raf = requestAnimationFrame(() => { c.raf = 0; c.el.innerHTML = F.term.linkify(c.text); scrollDown(out, stick); });
    },
    linkify(text) {
      text = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
      const root = (S.engine && S.engine.workspace || '').replace(/\\/g, '/');
      return esc(text)
        .replace(/\(([\w$]+\.java):(\d+)\)/g, (m, file, line) => `(<span class="t-link" data-jfile="${file}" data-line="${line}">${file}:${line}</span>)`)
        .replace(/((?:[A-Za-z]:)?[\/\\][^\s:()'"]+\.(?:m?js|cjs|jsx|ts|tsx)):(\d+)(?::(\d+))?/g, (m, file, line, col) => {
          const f = file.replace(/\\/g, '/');
          if (!root || !f.startsWith(root + '/') || f.includes('/node_modules/')) return m;
          return `<span class="t-link" data-path="${esc(f.slice(root.length + 1))}" data-line="${line}" data-col="${col || 1}">${m}</span>`;
        })
        .replace(/File &quot;([^&]+?\.pyw?)&quot;, line (\d+)/g, (m, file, line) => {
          const f = file.replace(/\\/g, '/');
          let rel = null;
          if (root && f.startsWith(root + '/')) rel = f.slice(root.length + 1);
          else if (!/^([A-Za-z]:)?\//.test(f) && F.files().some((x) => x.endsWith('/' + f) || x === f)) rel = F.files().find((x) => x.endsWith('/' + f) || x === f);
          if (!rel || /(^|\/)(\.?venv|site-packages)\//.test(rel)) return m;
          return `File &quot;<span class="t-link" data-path="${esc(rel)}" data-line="${line}" data-col="1">${esc(rel)}</span>&quot;, line ${line}`;
        });
    },
    /** enabled: a futó program bemenete; különben parancsmód (ha a helyi motor elérhető). */
    input(enabled, handler) {
      const inp = $('#termIn');
      const cmdMode = !enabled && fs.mode === 'local' && S.engine && S.engine.workspace;
      inp.disabled = !enabled && !cmdMode;
      $('#termInWrap').classList.toggle('live', !!enabled);
      $('#termInWrap').classList.toggle('cmd', !!cmdMode);
      $('#termInWrap .prompt').textContent = cmdMode ? '$' : '›';
      this.onInput = enabled ? handler : null;
      this.cmdMode = !!cmdMode;
      inp.placeholder = enabled ? 'A program bemenete — Enter küldi, Ctrl+D lezárja'
        : cmdMode ? 'Parancs, pl. npm install vagy git log — Enter futtatja (' + (F.cwd() || 'a mappa gyökere') + ')'
        : 'A program bemenete — futtatáskor itt írhatsz neki';
    }
  };

  /** A terminál munkamappája: a megnyitott fájl projektje, különben a mappa gyökere. */
  F.cwd = () => {
    const a = F.active();
    if (!a) return '';
    const proj = F.projectOf(a.path);
    if (proj && proj !== '.' && !proj.startsWith('loose:')) return proj;
    if (proj && proj.startsWith('loose:')) return proj.slice(6);
    return a.path.split('/').slice(0, -1).join('/');
  };

  /** Egy motorban futó folyamat kimenetének élő követése. */
  F.streamProc = async (id, h2) => {
    F.proc = { id, kill: () => F.api('POST', 'proc/kill', { id }) };
    $('#stopBtn').hidden = false;
    try {
      const resp = await fetch('/api/proc/stream?id=' + encodeURIComponent(id), { headers: { 'X-Facet': '1' } });
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const ev = JSON.parse(line.slice(6));
          if (ev.t === 'out') h2.out && h2.out(ev.d);
          else if (ev.t === 'err') h2.err && h2.err(ev.d);
          else if (ev.t === 'exit') { h2.exit && h2.exit(ev); }
        }
      }
    } catch (e) {
      F.term.row('kapcsolat', 'Megszakadt a kapcsolat a futó programmal.', 't-bad', 'var(--err)');
    }
    if (F.proc && F.proc.id === id) { F.proc = null; $('#stopBtn').hidden = true; }
  };

  /** Bemenet küldése a futó folyamatnak. */
  F.procInput = (id) => (text) => {
    if (text === null) F.api('POST', 'proc/input', { id, eof: 1 }, '');
    else F.api('POST', 'proc/input', { id }, text).then((r) => { if (!r.ok) F.term.row('bemenet', 'A program már nem fogad bemenetet.', 't-bad', 'var(--muted-2)'); });
  };

  const cmdHistory = store.get('cmdHistory', []);
  let cmdIdx = -1;
  /** Parancs futtatása a terminálban (shell). */
  F.runCommand = async (command, cwd) => {
    if (cwd == null) cwd = F.cwd();
    F.bottom.show('terminal');
    F.term.row('$', esc(command) + (cwd ? `  <span style="color:var(--muted-2)">· ${esc(cwd)}</span>` : ''), 't-in', 'var(--accent)');
    let r;
    try { r = await apiJson('POST', 'run', { cwd }, command); } catch (e) { F.term.row('hiba', esc(e.message), 't-bad', 'var(--err)'); return; }
    F.term.input(true, F.procInput(r.id));
    const t0 = Date.now();
    await F.streamProc(r.id, {
      out: (d) => F.term.stream(d, 't-out'),
      err: (d) => F.term.stream(d, 't-err'),
      exit: (ev) => {
        F.term.row('kilépés', `kód ${ev.code} · ${((Date.now() - t0) / 1000).toFixed(1).replace('.', ',')} s`, ev.code === 0 ? '' : 't-bad', ev.code === 0 ? 'var(--muted-2)' : 'var(--err)');
        if (ev.code === 127 || /not recognized as an internal/.test($('#termOut').textContent.slice(-400))) F.term.row('tipp', 'Ez a program nincs telepítve, vagy nincs benne a PATH-ban. Node.js: nodejs.org · Git: git-scm.com', '', 'var(--warn)');
      }
    });
    F.term.input(false);
    F.emit('commandDone', command);
  };

  $('#termIn').addEventListener('keydown', (e) => {
    const inp = e.target;
    if (e.key === 'Enter' && F.term.onInput) {
      e.preventDefault();
      const v = inp.value;
      inp.value = '';
      F.term.stream(v + '\n', 't-in');
      F.term.onInput(v + '\n');
    } else if (e.key === 'Enter' && F.term.cmdMode) {
      e.preventDefault();
      const v = inp.value.trim();
      if (!v) return;
      inp.value = '';
      if (v === 'clear' || v === 'cls') { F.term.clear(); return; }
      cmdHistory.unshift(v);
      while (cmdHistory.length > 50) cmdHistory.pop();
      store.set('cmdHistory', cmdHistory);
      cmdIdx = -1;
      F.runCommand(v);
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && F.term.cmdMode) {
      e.preventDefault();
      cmdIdx = Math.max(-1, Math.min(cmdHistory.length - 1, cmdIdx + (e.key === 'ArrowUp' ? 1 : -1)));
      inp.value = cmdIdx < 0 ? '' : cmdHistory[cmdIdx];
    } else if (e.key === 'd' && e.ctrlKey && F.term.onInput) {
      e.preventDefault();
      F.term.onInput(null);
    } else if (e.key === 'c' && e.ctrlKey && F.proc) {
      e.preventDefault();
      F.proc.kill();
    }
  });
  $('#stopBtn').addEventListener('click', () => { if (F.proc) F.proc.kill(); });
  F.on('workspace', () => F.term.input(false));
  $('#termOut').addEventListener('click', (e) => {
    const l = e.target.closest('.t-link');
    if (!l) return;
    if (l.dataset.path) return F.openAt(l.dataset.path, +l.dataset.line, +l.dataset.col || 1);
    F.emit('javaLink', l.dataset.jfile, +l.dataset.line);
  });

  F.console = {
    n: 0,
    clear() { $('#consoleOut').innerHTML = ''; this.n = 0; $('#consoleCount').textContent = ''; },
    log(level, text, src) {
      const out = $('#consoleOut');
      const stick = nearBottom(out);
      const row = h('div', { class: 'c-row ' + level }, h('span', { class: 't-tag', text: level === 'error' ? 'hiba' : level === 'warn' ? 'warn' : level === 'info' ? 'info' : 'log' }), h('span', { class: 't-msg t-out', text }));
      if (src && src.path) row.append(h('span', { class: 'c-src', text: src.path.split('/').pop() + (src.line ? ':' + src.line : ''), onclick: () => F.openAt(src.path, src.line || 1) }));
      out.append(row);
      this.n++;
      $('#consoleCount').textContent = this.n > 99 ? '99+' : String(this.n);
      while (out.childElementCount > 500) out.firstChild.remove();
      scrollDown(out, stick);
    },
    note(text) {
      const out = $('#consoleOut');
      out.append(h('div', { class: 'c-row' }, h('span', { class: 't-tag', style: { color: 'var(--accent)' }, text: 'előnézet' }), h('span', { class: 't-msg', text })));
      scrollDown(out, true);
    }
  };

  const problemSets = {};
  F.problems = {
    set(source, list) {
      problemSets[source] = list || [];
      this.render();
    },
    all() { return Object.values(problemSets).flat(); },
    render() {
      const all = this.all();
      const out = $('#problemsOut');
      out.innerHTML = '';
      const errs = all.filter((p) => p.sev !== 'warn').length;
      const cnt = $('#problemCount');
      cnt.textContent = all.length ? String(all.length) : '';
      cnt.classList.toggle('err', errs > 0);
      if (!all.length) { out.append(h('div', { class: 'empty-note', text: 'Nincs probléma. Szép munka!' })); return; }
      all.sort((a, b) => (a.file || '').localeCompare(b.file || '') || a.line - b.line).forEach((p) => {
        out.append(h('div', { class: 'pr-item', onclick: () => p.file && F.openAt(p.file, p.line, p.col) },
          h('span', { class: 'pr-sev' + (p.sev === 'warn' ? ' warn' : '') }),
          h('span', { class: 'pr-msg' }, p.title || p.msg, p.detail ? h('small', { text: p.detail }) : null),
          h('span', { class: 'pr-loc', text: (p.file || '').split('/').pop() + (p.line ? ':' + p.line : '') })));
      });
    }
  };

  // ───────────── állapotsor ─────────────
  function setSave(t) { $('#stSave').textContent = t; }
  F.setSave = setSave;
  F.updateStatus = () => updateStatus();
  function updateStatus() {
    const a = F.active();
    if (a && a.custom) { $('#stCursor').textContent = a.custom.status ? a.custom.status() : ''; $('#stIndent').textContent = ''; $('#stLang').textContent = a.path.split('.').pop().toUpperCase(); return; }
    if (!a || !F.editor.getModel()) { $('#stCursor').textContent = ''; $('#stIndent').textContent = ''; $('#stLang').textContent = ''; return; }
    const p = F.editor.getPosition();
    const sel = F.editor.getSelection();
    const selLen = sel && !sel.isEmpty() ? a.model.getValueInRange(sel).length : 0;
    $('#stCursor').textContent = p ? `Ln ${p.lineNumber}, Col ${p.column}` + (selLen ? ` (${selLen} kijelölve)` : '') : '';
    $('#stIndent').textContent = 'Szóköz: ' + a.model.getOptions().tabSize;
    $('#stLang').textContent = 'UTF-8 · ' + a.path.split('.').pop().toUpperCase();
  }
  function tickClock() {
    const s = Math.floor((Date.now() - S.sessionStart) / 1000);
    const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    $('#stFlow').textContent = 'Munkamenet ' + (hh ? hh + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(ss).padStart(2, '0');
    if (document.body.classList.contains('flow')) {
      const f = Math.floor((Date.now() - S.flowStart) / 1000);
      $('#flowTime').textContent = Math.floor(f / 60) + ':' + String(f % 60).padStart(2, '0');
    }
  }

  // ───────────── Flow mód ─────────────
  function toggleFlow(force) {
    const on = force != null ? force : !document.body.classList.contains('flow');
    document.body.classList.toggle('flow', on);
    $('#flowPill').hidden = !on;
    if (on) { S.flowStart = Date.now(); F.toast('Flow mód: csak te és a kód. Kilépés: Esc'); }
    F.emit('flow', on);
    setTimeout(() => F.editor && F.editor.layout(), 30);
  }
  F.toggleFlow = toggleFlow;

  // ───────────── méretezhető panelek ─────────────
  function initGutters() {
    const sizes = store.get('sizes', {});
    const root = document.documentElement.style;
    if (sizes.side) root.setProperty('--side-w', sizes.side + 'px');
    if (sizes.stage) root.setProperty('--stage-w', sizes.stage + 'px');
    if (sizes.bottom) root.setProperty('--bottom-h', sizes.bottom + 'px');
    $$('.gutter').forEach((g) => {
      g.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        g.setPointerCapture(e.pointerId);
        g.classList.add('drag');
        const kind = g.dataset.gutter;
        const startX = e.clientX, startY = e.clientY;
        const side = $('#side').offsetWidth, stage = $('#stage').offsetWidth, bottom = $('#bottom').offsetHeight;
        $$('iframe').forEach((f) => { f.style.pointerEvents = 'none'; });
        const move = (ev) => {
          if (kind === 'side') { sizes.side = Math.max(180, Math.min(520, side + ev.clientX - startX)); root.setProperty('--side-w', sizes.side + 'px'); }
          if (kind === 'stage') { sizes.stage = Math.max(260, Math.min(760, stage - (ev.clientX - startX))); root.setProperty('--stage-w', sizes.stage + 'px'); }
          if (kind === 'bottom') { sizes.bottom = Math.max(90, Math.min(innerHeight - 200, bottom - (ev.clientY - startY))); root.setProperty('--bottom-h', sizes.bottom + 'px'); $('#bottom').classList.remove('collapsed'); }
          F.emit('resize');
        };
        const up = () => {
          g.classList.remove('drag');
          g.removeEventListener('pointermove', move);
          g.removeEventListener('pointerup', up);
          $$('iframe').forEach((f) => { f.style.pointerEvents = ''; });
          store.set('sizes', sizes);
          F.emit('resize');
        };
        g.addEventListener('pointermove', move);
        g.addEventListener('pointerup', up);
      });
    });
  }

  // ───────────── billentyűk ─────────────
  function onKey(e) {
    const overlayOpen = !$('#overlay').hidden;
    if (e.key === 'Escape') {
      if (overlayOpen) { closeOverlay(); e.preventDefault(); return; }
      if (!$('#menu').hidden) { hideMenu(); return; }
      if (F.settingsPage && F.settingsPage.isOpen()) { F.settingsPage.close(); e.preventDefault(); return; }
      if (!$('#diffView').hidden) { closeDiff(); e.preventDefault(); return; }
      if (document.body.classList.contains('flow')) { toggleFlow(false); e.preventDefault(); return; }
      return;
    }
    // A billentyűparancsok (átírhatók a Beállításokban): workbench.js
    if (F.keys) F.keys.handle(e, overlayOpen);
  }

  // ───────────── futtatás ─────────────
  F.run = async () => {
    const a = F.active();
    if (!a) { F.toast('Nyiss meg egy fájlt a futtatáshoz.'); return; }
    if (!a.def.run) { F.toast(`A(z) ${esc(a.def.label)} fájlokat nem lehet futtatni.`); return; }
    await F.saveAll();
    try { await a.def.run(a); } catch (e) { console.error(e); F.toast(esc(e.message), 'err'); }
  };

  // ───────────── általános parancsok ─────────────
  function registerCommands() {
    const K = isMac ? '⌘' : 'Ctrl+';
    F.command({ label: 'Új fájl', keywords: 'letrehozas file create', key: 'newFile', icon: '+', run: () => F.newFile() });
    F.command({ label: 'Új projekt', keywords: 'sablon template project', key: 'newProject', icon: '◇', run: () => F.newProject() });
    F.command({ label: 'Mappa megnyitása…', keywords: 'open folder megnyitas projekt', key: 'openFolder', icon: '⌂', when: () => fs.mode === 'local', run: () => F.openFolderDialog() });
    F.command({ label: 'Mappa bezárása', keywords: 'close folder bezaras', icon: '×', when: () => !!(S.engine && S.engine.workspace), run: () => F.closeFolder() });
    F.command({ label: 'Új mappa', keywords: 'folder directory konyvtar', icon: '+', run: () => F.newFolder((F.active() ? F.active().path.split('/').slice(0, -1).join('/') : '')) });
    F.command({ label: 'Mentés', keywords: 'save mentsd', key: 'save', icon: 'S', when: () => !!S.active, run: () => F.save(S.active, { manual: true }) });
    F.command({ label: 'Összes mentése', keywords: 'save all', key: 'saveAll', icon: 'S', run: () => F.saveAll() });
    F.command({ label: 'Futtatás', keywords: 'run futtasd inditas start', key: 'run', icon: '▶', when: () => !!(F.active() && F.active().def.run), run: () => F.run() });
    F.command({ label: 'Formázás', keywords: 'format formazd rendezd behuzas', key: 'format', icon: '≡', when: () => F.hasCode(), run: () => F.editor.getAction('editor.action.formatDocument').run() });
    F.command({ label: 'Fájl bezárása', keywords: 'close tab', icon: '×', when: () => !!S.active, run: () => F.closeFile(S.active) });
    F.command({ label: 'Keresés a projektben', keywords: 'search find kereses', key: 'search', icon: '⌕', run: () => setView('search') });
    F.command({ label: 'Csere a fájlban', keywords: 'replace csere', key: 'replace', icon: '⇄', when: () => F.hasCode(), run: () => F.editor.getAction('editor.action.startFindReplaceAction').run() });
    F.command({ label: 'Ugrás sorra…', keywords: 'goto line sor', key: 'gotoLine', icon: '#', when: () => F.hasCode(), run: () => F.editor.getAction('editor.action.gotoLine').run() });
    F.command({ label: 'Időgép megnyitása', keywords: 'history elozmenyek visszaallitas undo verzio', icon: '◷', run: () => setView('history') });
    F.command({ label: 'Flow mód', keywords: 'fokusz zen focus', key: 'flow', icon: '~', run: () => toggleFlow() });
    F.command({ label: 'Oldalsáv ki/be', keywords: 'sidebar', key: 'toggleSide', icon: '▏', run: () => toggleSide() });
    F.command({ label: 'Alsó panel ki/be', keywords: 'terminal panel', key: 'toggleBottom', icon: '▁', run: () => F.bottom.toggle() });
    F.command({ label: 'Facet-panel ki/be', keywords: 'stage jobb panel elonezet', icon: '▕', key: 'toggleStage', run: () => F.setPanel('stage') });
    F.command({ label: 'Beállítások', keywords: 'settings betumeret font billentyu shortcut', key: 'settings', icon: '⚙', run: () => F.settingsPage.open() });
    F.command({ label: 'Kezdőképernyő', keywords: 'welcome home sablonok', icon: '◆', run: async () => { for (const p of [...S.open]) if (!(await F.closeFile(p))) return; showWelcome(); } });
    F.command({ label: 'Betűméret növelése', keywords: 'zoom nagyobb', icon: 'A', run: () => { F.settings.fontSize = Math.min(24, F.settings.fontSize + 1); F.saveSettings(); applySettings(); } });
    F.command({ label: 'Betűméret csökkentése', keywords: 'zoom kisebb', icon: 'a', run: () => { F.settings.fontSize = Math.max(11, F.settings.fontSize - 1); F.saveSettings(); applySettings(); } });
    F.command({ label: 'Megjegyzés ki/be', keywords: 'comment komment', key: 'comment', icon: '//', when: () => F.hasCode(), run: () => F.editor.getAction('editor.action.commentLine').run() });
    F.command({ label: 'Fájlfa frissítése', keywords: 'refresh reload', icon: '↻', run: () => F.refreshTree() });
  }

  // ───────────── motor ─────────────
  async function connect() {
    try {
      const r = await fetch('/api/ping', { headers: { 'X-Facet': '1' } });
      if (!r.ok) throw new Error();
      S.engine = await r.json();
      fs.mode = 'local';
      $('#stEngine').className = 'ok';
      $('#stEngineText').textContent = 'Helyi motor · Java ' + S.engine.java;
      if (!S.engine.jdk) F.toast('A Java futtatáshoz JDK kell (nem elég a JRE). Telepítsd pl. a Temurin 21-et.', 'warn');
    } catch (e) {
      S.engine = null;
      fs.mode = 'memory';
      memFs.seed();
      $('#stEngine').className = 'off';
      $('#stEngineText').textContent = 'Demó mód';
    }
  }
  let lostShown = false;
  async function heartbeat() {
    if (fs.mode !== 'local') return;
    try {
      const r = await fetch('/api/ping', { headers: { 'X-Facet': '1' } });
      if (!r.ok) throw new Error();
      const info = await r.json();
      if (S.engine && S.engine.workspace && !info.workspace) {
        // a motor újraindult: ugyanazt a mappát csendben újra megnyitjuk
        try { S.engine = await apiJson('POST', 'open', { path: S.engine.workspace }); } catch (e) { S.engine = info; }
      }
      $('#stEngine').className = 'ok';
      $('#stEngineText').textContent = 'Helyi motor · Java ' + info.java;
      lostShown = false;
    } catch (e) {
      $('#stEngine').className = 'off';
      $('#stEngineText').textContent = 'A motor nem fut';
      if (!lostShown) { lostShown = true; F.toast('Megszakadt a kapcsolat a FACET motorral. Indítsd újra a start.command fájllal.', 'err'); }
    }
  }

  async function firstRun() {
    if (S.tree.length) return;
    const js = window.FacetSamples;
    for (const rel in js.javaStart) await fs.write('java-start/' + rel, js.javaStart[rel]);
    for (const rel in js.web) await fs.write('pek-es-kave/' + rel, js.web[rel]);
    ['java-start', 'java-start/src', 'pek-es-kave'].forEach((p) => S.expanded.add(p));
    saveExpanded();
    S.tree = await fs.list();
    F.toast('Két mintaprojekttel indulsz: <b>java-start</b> és <b>pek-es-kave</b>', 'ok');
  }

  // ───────────── indulás ─────────────
  F.boot = async () => {
    initGutters();
    document.body.classList.toggle('no-pulse', !F.settings.pulse);
    window.addEventListener('keydown', onKey, true);
    $$('.rail-btn[data-view]').forEach((b) => { b.onclick = () => setView(b.dataset.view, true); });
    $('#flowBtn').onclick = () => toggleFlow();
    $('#cmdBar').onclick = () => F.palette('all');
    $('#runBtn').onclick = () => F.run();
    $('#newFileBtn').onclick = () => F.newFile();
    $('#newFolderBtn').onclick = () => F.newFolder(F.active() ? F.active().path.split('/').slice(0, -1).join('/') : '');
    $('#newProjectBtn').onclick = () => F.newProject();
    $('#refreshBtn').onclick = () => F.refreshTree();
    $('#projectBtn').onclick = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      if (fs.mode !== 'local') { F.menu(r.left, r.bottom + 6, [{ label: 'Új projekt…', run: () => F.newProject() }]); return; }
      const K = isMac ? '⌘' : 'Ctrl+';
      const rec = recentFolders().filter((x) => !S.engine || x.path !== S.engine.workspace).slice(0, 6);
      F.menu(r.left, r.bottom + 6, [{ label: 'Mappa megnyitása…', kbd: K + 'O', run: () => F.openFolderDialog() }, { label: 'Új projekt…', kbd: '⌥' + K + 'N', run: () => F.newProject() }]
        .concat(rec.length ? ['-'] : [], rec.map((x) => ({ label: x.name + '  ·  ' + shortPath(x.path), run: () => F.openFolder(x.path) })))
        .concat(S.engine && S.engine.workspace ? ['-', { label: 'Mappa bezárása', run: () => F.closeFolder() }] : []));
    };
    $('#toggleSide').onclick = () => F.setPanel('side');
    $('#toggleStage').onclick = () => F.setPanel('stage');
    $('#sideClose').onclick = () => F.setPanel('side', false);
    $('#stageClose').onclick = () => F.setPanel('stage', false);
    $('#tree').oncontextmenu = (e) => { if (e.target.closest('.node')) return; e.preventDefault(); F.menu(e.clientX, e.clientY, [{ label: 'Új fájl…', run: () => F.newFile('') }, { label: 'Új mappa…', run: () => F.newFolder('') }, { label: 'Új projekt…', run: () => F.newProject() }]); };
    $$('#bottomTabs .seg').forEach((b) => { b.onclick = () => F.bottom.show(b.dataset.pane); });
    $('#collapseBtn').onclick = () => F.bottom.toggle();
    $('#clearBtn').onclick = () => { if (S.bottomPane === 'terminal') F.term.clear(); else if (S.bottomPane === 'console') F.console.clear(); };
    $('#diffClose').onclick = () => closeDiff();
    $('#searchInput').oninput = doSearch;
    $('#searchCase').onchange = doSearch;
    F.problems.render();
    registerCommands();
    setInterval(tickClock, 1000);
    tickClock();

    await connect();
    try {
      await loadMonaco();
    } catch (e) {
      $('#loading').innerHTML = '<div class="pv-empty"><b style="color:var(--fg-bright)">A szerkesztő nem töltődött be.</b><br>A FACET a kódszerkesztőt az internetről tölti le az első indításkor. Ellenőrizd a kapcsolatot, majd töltsd újra az oldalt.</div>';
      return;
    }
    if (window.emmetMonaco) {
      try { window.emmetMonaco.emmetHTML(monaco, ['html']); window.emmetMonaco.emmetCSS(monaco, ['css']); } catch (e) { /* Emmet nélkül is megy */ }
    }
    monaco.editor.setTheme(defineTheme('text'));
    F.editor = monaco.editor.create($('#editor'), Object.assign(editorOptions(), { model: null }));
    F.editor.onDidChangeCursorPosition(() => { updateStatus(); F.emit('cursor'); });
    F.editor.onDidChangeCursorSelection(updateStatus);
    F.emit('editor', F.editor);
    for (const k in F.facets) if (F.facets[k].setup) { try { F.facets[k].setup(); } catch (e) { console.error(e); } }

    F.setPanel('side', layout.side);
    F.setPanel('stage', layout.stage);
    F.term.input(false);
    loadWorkspaceState();
    if (fs.mode === 'memory') {
      await F.refreshTree();
      await firstRun();
    } else if (S.engine.workspace) {
      await F.refreshTree();
    }
    renderTree();
    showWelcome();
    $('#loading').hidden = true;
    if (fs.mode === 'memory') F.toast('Demó mód: a fájlok a böngészőben vannak. A Java futtatáshoz indítsd el a FACET motort (start.command).', 'warn');
    setInterval(heartbeat, 8000);
    window.addEventListener('beforeunload', (e) => {
      if (S.open.some((p) => F.dirty(p))) { e.preventDefault(); e.returnValue = ''; }
    });
  };
})();
