/* FACET — Beállítások oldal: kategóriák, keresés, és átírható billentyűparancsok. */
(function () {
  'use strict';
  const F = window.F;
  const { $, $$, h, esc, isMac } = F;

  const FONTS = ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Source Code Pro', 'IBM Plex Mono', isMac ? 'SF Mono' : 'Consolas', isMac ? 'Menlo' : 'Courier New'];
  const opts = (list) => list.map((x) => (Array.isArray(x) ? { v: x[0], t: x[1] } : { v: x, t: String(x) }));

  /** A beállítások leírása. type: toggle | select | range. */
  const SCHEMA = [
    // Megjelenés
    { cat: 'look', id: 'zoom', type: 'range', label: 'Ablak nagyítása', desc: 'Az egész felület mérete. Billentyűvel: ' + (isMac ? '⌘ +, ⌘ −, ⌘ 0' : 'Ctrl + +, Ctrl + −, Ctrl + 0') + '.', min: 0.5, max: 2, step: 0.05, fmt: (v) => Math.round(v * 100) + '%', set: (v) => F.zoom.set(v, true), app: true },
    { cat: 'look', id: 'pulse', type: 'toggle', label: 'Pulzusvonal', desc: 'A szerkesztő feletti vonal a gépelés ritmusára világít.' },
    { cat: 'look', id: 'flowFullscreen', type: 'toggle', label: 'Flow mód teljes képernyőn', desc: 'A Flow mód (' + (isMac ? '⇧⌘M' : 'Shift+Ctrl+M') + ') az egész képernyőt kitölti. Kilépés: Esc.' },
    { cat: 'look', id: 'flowWidth', type: 'select', label: 'Kódoszlop szélessége Flow módban', options: opts([['narrow', 'Keskeny (900 px)'], ['wide', 'Széles (1280 px)'], ['full', 'Teljes szélesség']]) },
    { cat: 'look', id: 'termFontSize', type: 'select', label: 'Terminál betűmérete', options: opts([11, 12, 13, 14, 15, 16].map((n) => [n, n + ' px'])) },
    // Szerkesztő
    { cat: 'editor', id: 'fontSize', type: 'select', label: 'Betűméret', desc: 'A Ctrl + görgő ideiglenesen is nagyít a szerkesztőben.', options: opts([11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24].map((n) => [n, n + ' px'])) },
    { cat: 'editor', id: 'fontFamily', type: 'select', label: 'Betűtípus', desc: 'Ha a választott betűtípus nincs a gépen, a JetBrains Mono marad.', options: opts(FONTS) },
    { cat: 'editor', id: 'lineHeight', type: 'select', label: 'Sormagasság', options: opts([[1.3, 'Sűrű (1,3)'], [1.45, 'Kicsit sűrű (1,45)'], [1.6, 'Normál (1,6)'], [1.8, 'Levegős (1,8)'], [2, 'Tágas (2,0)']]) },
    { cat: 'editor', id: 'ligatures', type: 'toggle', label: 'Ligatúrák', desc: 'Pl. a => és a != egy jelként jelenik meg.' },
    { cat: 'editor', id: 'tabSize', type: 'select', label: 'Behúzás mérete', desc: 'Automatikus: Java 4, web 2 szóköz.', options: opts([['auto', 'Automatikus (fájltípus szerint)'], ['2', '2 szóköz'], ['4', '4 szóköz'], ['8', '8 szóköz']]) },
    { cat: 'editor', id: 'wrap', type: 'toggle', label: 'Sortörés', desc: 'A hosszú sorok a képernyő szélén új sorban folytatódnak. Gyorsan: ' + (isMac ? '⌥Z' : 'Alt+Z') + '.' },
    { cat: 'editor', id: 'minimap', type: 'toggle', label: 'Kódtérkép (minimap)', desc: 'Kicsinyített áttekintő a szerkesztő jobb szélén.' },
    { cat: 'editor', id: 'lineNumbers', type: 'select', label: 'Sorszámok', options: opts([['on', 'Bekapcsolva'], ['relative', 'Relatív (a kurzortól)'], ['off', 'Kikapcsolva']]) },
    { cat: 'editor', id: 'cursorStyle', type: 'select', label: 'Kurzor alakja', options: opts([['line', 'Vonal'], ['block', 'Blokk'], ['underline', 'Aláhúzás'], ['line-thin', 'Vékony vonal']]) },
    { cat: 'editor', id: 'cursorBlinking', type: 'select', label: 'Kurzor villogása', options: opts([['smooth', 'Lágy'], ['blink', 'Villogó'], ['phase', 'Halványuló'], ['expand', 'Táguló'], ['solid', 'Nem villog']]) },
    { cat: 'editor', id: 'smoothScroll', type: 'toggle', label: 'Lágy görgetés és kurzormozgás' },
    { cat: 'editor', id: 'renderWhitespace', type: 'select', label: 'Szóközök megjelenítése', options: opts([['selection', 'Csak kijelölésben'], ['boundary', 'Szavak között nem'], ['trailing', 'Csak a sorok végén'], ['all', 'Mindig'], ['none', 'Soha']]) },
    { cat: 'editor', id: 'bracketColors', type: 'toggle', label: 'Színes zárójelpárok', desc: 'Az egymásba ágyazott zárójelek más-más színűek.' },
    { cat: 'editor', id: 'guides', type: 'toggle', label: 'Behúzási segédvonalak' },
    { cat: 'editor', id: 'stickyScroll', type: 'toggle', label: 'Ragadós fejléc', desc: 'Görgetéskor fent marad, melyik osztályban/metódusban vagy.' },
    { cat: 'editor', id: 'quickSuggest', type: 'toggle', label: 'Javaslatok gépelés közben', desc: 'Kikapcsolva csak ' + (isMac ? '⌃Szóköz' : 'Ctrl+Szóköz') + ' nyitja meg.' },
    { cat: 'editor', id: 'autoClose', type: 'toggle', label: 'Zárójelek és idézőjelek automatikus lezárása' },
    // Fájlok és mentés
    { cat: 'files', id: 'autosave', type: 'toggle', label: 'Automatikus mentés', desc: 'Gépelés után magától ment. Az Időgép így sem veszít semmit.' },
    { cat: 'files', id: 'autosaveDelay', type: 'select', label: 'Automatikus mentés késleltetése', options: opts([[400, 'Azonnal (0,4 mp)'], [900, 'Normál (0,9 mp)'], [2000, '2 másodperc'], [5000, '5 másodperc']]), when: () => F.settings.autosave },
    { cat: 'files', id: 'saveOnBlur', type: 'toggle', label: 'Mentés, ha másik ablakra váltasz' },
    { cat: 'files', id: 'formatOnSave', type: 'toggle', label: 'Formázás kézi mentéskor', desc: (isMac ? '⌘S' : 'Ctrl+S') + ' előtt rendbe teszi a behúzásokat.' },
    { cat: 'files', id: 'trimTrailing', type: 'toggle', label: 'Sorvégi szóközök törlése mentéskor' },
    { cat: 'files', id: 'finalNewline', type: 'toggle', label: 'Üres sor a fájl végére mentéskor' },
    { cat: 'files', id: 'confirmDelete', type: 'toggle', label: 'Törlés előtt kérdezzen', desc: 'A törölt elemek így is a FACET kukájába kerülnek (~/.facet).' },
    { cat: 'files', id: 'confirmMove', type: 'toggle', label: 'Áthelyezés előtt kérdezzen (húzásnál)' },
    // Java
    { cat: 'java', id: 'liveCheck', type: 'toggle', label: 'Élő Java-ellenőrzés', desc: 'Mentéskor a háttérben lefordítja a projektet, és azonnal jelzi a hibákat.' },
    { cat: 'java', id: 'lens', type: 'toggle', label: 'Hibatolmács a hibás sor alatt', desc: 'A magyar magyarázat közvetlenül a kódban jelenik meg, javítás gombbal.' }
  ];
  const CATS = [
    { id: 'look', label: 'Megjelenés', icon: '◐' },
    { id: 'editor', label: 'Szerkesztő', icon: '✎' },
    { id: 'files', label: 'Fájlok és mentés', icon: '⌂' },
    { id: 'java', label: 'Java', icon: '☕' },
    { id: 'keys', label: 'Billentyűparancsok', icon: '⌘' },
    { id: 'about', label: 'Rendszer és névjegy', icon: '◆' }
  ];
  // A facet-modulok is felvehetnek beállításokat: F.settingsPage.add({...})
  const extra = [];

  let root = null, cat = 'look', query = '', recording = null;

  function build() {
    root = h('div', { id: 'settingsView', class: 'sv', hidden: true });
    root.addEventListener('mousedown', (e) => { if (e.target === root) page.close(); });
    document.body.append(root);
  }

  const isDefault = (s) => JSON.stringify(F.settings[s.id]) === JSON.stringify(F.DEFAULTS[s.id]);
  function setVal(s, v) {
    F.settings[s.id] = v;
    F.saveSettings();
    if (s.set) s.set(v); else F.applySettings();
    render(true);
  }

  function control(s) {
    const v = F.settings[s.id];
    if (s.type === 'toggle') {
      const inp = h('input', { type: 'checkbox', 'aria-label': s.label });
      inp.checked = !!v;
      inp.onchange = () => setVal(s, inp.checked);
      return h('label', { class: 'toggle' }, inp, h('span'));
    }
    if (s.type === 'select') {
      const sel = h('select', { class: 'field sv-select', 'aria-label': s.label }, s.options.map((o) => h('option', { value: String(o.v), selected: String(o.v) === String(v) }, o.t)));
      sel.onchange = () => { const o = s.options.find((x) => String(x.v) === sel.value); setVal(s, o ? o.v : sel.value); };
      return sel;
    }
    if (s.type === 'range') {
      const out = h('span', { class: 'sv-range-val', text: s.fmt ? s.fmt(v) : v });
      const r = h('input', { type: 'range', min: s.min, max: s.max, step: s.step, value: v, class: 'sv-range', 'aria-label': s.label });
      r.oninput = () => { out.textContent = s.fmt ? s.fmt(+r.value) : r.value; };
      r.onchange = () => setVal(s, +r.value);
      return h('span', { class: 'sv-range-wrap' }, r, out);
    }
    return null;
  }

  function row(s) {
    const changed = !isDefault(s);
    const reset = h('button', { class: 'sv-reset', title: 'Alapértelmezés visszaállítása', 'aria-label': 'Alapértelmezés', onclick: () => setVal(s, JSON.parse(JSON.stringify(F.DEFAULTS[s.id]))) }, '↺');
    reset.style.visibility = changed ? 'visible' : 'hidden';
    return h('div', { class: 'sv-row' + (changed ? ' changed' : ''), 'data-id': s.id },
      h('div', { class: 'sv-text' }, h('div', { class: 'sv-label' }, s.label), s.desc ? h('div', { class: 'sv-desc', text: s.desc }) : null),
      h('div', { class: 'sv-ctl' }, reset, control(s)));
  }

  const fold = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const match = (text) => !query || fold(text).includes(fold(query));

  function render(keepScroll) {
    if (!root) build();
    const body = $('.sv-body', root);
    const st = body ? body.scrollTop : 0;
    root.innerHTML = '';
    const search = h('input', { class: 'field sv-search', placeholder: 'Beállítás vagy billentyűparancs keresése…', value: query, spellcheck: 'false' });
    search.oninput = () => { query = search.value; render(); const s2 = $('.sv-search', root); s2.focus(); s2.setSelectionRange(query.length, query.length); };
    const all = SCHEMA.concat(extra).filter((s) => !(s.app && !F.zoom.native));
    const nav = h('nav', { class: 'sv-nav' }, CATS.map((c) => {
      const n = query ? (c.id === 'keys' ? keyRows().length : c.id === 'about' ? 0 : all.filter((s) => s.cat === c.id && match(s.label + ' ' + (s.desc || ''))).length) : null;
      return h('button', { class: 'sv-cat' + (c.id === cat && !query ? ' active' : '') + (query && !n ? ' dim' : ''), onclick: () => { cat = c.id; query = ''; render(); } },
        h('span', { class: 'sv-cat-ic', text: c.icon }), h('span', { text: c.label }), n ? h('span', { class: 'sv-count', text: n }) : null);
    }));
    const content = h('div', { class: 'sv-body' });
    const cats = query ? CATS.map((c) => c.id) : [cat];
    let any = false;
    cats.forEach((cid) => {
      const c = CATS.find((x) => x.id === cid);
      if (cid === 'keys') { const k = keysSection(); if (k) { any = true; content.append(k); } return; }
      if (cid === 'about') { if (!query) { any = true; content.append(aboutSection()); } return; }
      const list = all.filter((s) => s.cat === cid && match(s.label + ' ' + (s.desc || '')) && (!s.when || s.when()));
      if (!list.length) return;
      any = true;
      content.append(h('section', { class: 'sv-sec' }, h('h3', { text: c.label }), h('div', { class: 'sv-card' }, list.map(row))));
    });
    if (!any) content.append(h('div', { class: 'sv-empty', text: 'Nincs ilyen beállítás.' }));
    const panel = h('div', { class: 'sv-panel', role: 'dialog', 'aria-label': 'Beállítások' },
      h('header', { class: 'sv-head' },
        h('h2', null, h('span', { class: 'diamond' }), 'Beállítások'),
        search,
        h('button', { class: 'icon-btn sv-close', title: 'Bezárás (Esc)', 'aria-label': 'Bezárás', onclick: () => page.close(), html: '<svg width="12" height="12" viewBox="0 0 10 10"><path d="M2 2 L8 8 M8 2 L2 8" stroke="currentColor" stroke-width="1.4"/></svg>' })),
      h('div', { class: 'sv-main' }, nav, content));
    root.append(panel);
    if (keepScroll) $('.sv-body', root).scrollTop = st;
  }

  // ───────────── billentyűparancsok ─────────────
  function keyRows() {
    return F.keys.actions.filter((a) => {
      if (a.app && !F.zoom.native) return false;
      const ch = F.keys.chordsOf(a.id).map(F.keys.pretty).join(' ');
      return match(a.label + ' ' + a.group + ' ' + ch);
    });
  }
  function keysSection() {
    const rows = keyRows();
    if (!rows.length) return null;
    const groups = [];
    rows.forEach((a) => { let g = groups.find((x) => x.name === a.group); if (!g) groups.push(g = { name: a.group, list: [] }); g.list.push(a); });
    const changedCount = F.keys.actions.filter((a) => F.keys.isCustom(a.id)).length;
    return h('section', { class: 'sv-sec' },
      h('h3', null, 'Billentyűparancsok', changedCount ? h('button', { class: 'btn sv-mini', onclick: async () => { if (await F.confirm('Billentyűk visszaállítása', 'Minden billentyűparancs visszakapja az alapértelmezést.', 'Visszaállítás')) { F.settings.keys = {}; F.saveSettings(); F.emit('keys'); F.applySettings(); render(true); } } }, 'Mind alapértelmezett (' + changedCount + ' átírva)') : null),
      h('p', { class: 'sv-hint', html: 'Kattints egy kombinációra, és nyomd le az újat. <b>Backspace</b>: nincs kombináció, <b>Esc</b>: mégse. Egy parancsnak több kombinációja is lehet: <b>+</b>.' }),
      groups.map((g) => h('div', { class: 'sv-card sv-keys' }, h('div', { class: 'sv-kgroup', text: g.name }), g.list.map(keyRow))));
  }
  function keyRow(a) {
    const chords = F.keys.chordsOf(a.id);
    const custom = F.keys.isCustom(a.id);
    const isRec = recording && recording.id === a.id;
    const chips = chords.map((c, i) => {
      const rec = isRec && recording.index === i;
      return h('button', { class: 'sv-chord' + (rec ? ' rec' : ''), title: 'Kattints az átíráshoz', onclick: () => startRec(a.id, i) }, rec ? 'Nyomd le…' : F.keys.pretty(c));
    });
    if (isRec && recording.index === chords.length) chips.push(h('button', { class: 'sv-chord rec' }, 'Nyomd le…'));
    if (!chords.length && !isRec) chips.push(h('button', { class: 'sv-chord none', onclick: () => startRec(a.id, 0) }, 'nincs — beállítás'));
    return h('div', { class: 'sv-krow' + (custom ? ' changed' : ''), 'data-id': a.id },
      h('span', { class: 'sv-klabel' }, a.label, a.monaco ? h('span', { class: 'sv-tag', text: 'szerkesztő' }) : null),
      h('span', { class: 'sv-kchips' }, chips,
        chords.length && !isRec ? h('button', { class: 'sv-kadd', title: 'Még egy kombináció', onclick: () => startRec(a.id, chords.length) }, '+') : null,
        h('button', { class: 'sv-reset', title: 'Alapértelmezés', style: { visibility: custom ? 'visible' : 'hidden' }, onclick: () => { F.keys.set(a.id, null); render(true); } }, '↺')),
      isRec && recording.msg ? h('div', { class: 'sv-kmsg', html: recording.msg }) : null);
  }

  function startRec(id, index) {
    recording = { id, index, msg: null };
    F.keys.suspend(true);
    render(true);
  }
  function stopRec() { recording = null; F.keys.suspend(false); render(true); }

  window.addEventListener('keydown', async (e) => {
    if (!recording || recording.wait || !root || root.hidden) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const { id, index } = recording;
    const list = F.keys.chordsOf(id).slice();
    if (e.key === 'Escape') { stopRec(); return; }
    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (index < list.length) list.splice(index, 1);
      F.keys.set(id, list);
      stopRec();
      return;
    }
    const chord = F.keys.chordOf(e);
    if (!chord) return; // csak módosító: várunk
    if (!/(^|\+)(Mod|Ctrl|Alt)(\+|$)/.test(chord) && !/^(Shift\+)?F\d{1,2}$/.test(chord)) {
      recording.msg = 'Adj hozzá egy módosítót is (' + (isMac ? '⌘, ⌥ vagy ⌃' : 'Ctrl vagy Alt') + '), különben gépelés közben is lefutna.';
      render(true);
      return;
    }
    const res = F.keys.reserved(chord);
    if (res) { recording.msg = `<b>${esc(F.keys.pretty(chord))}</b> a rendszeré (${esc(res)}). Válassz másikat.`; render(true); return; }
    const users = F.keys.users(chord, id);
    if (users.length) {
      recording.wait = true;
      const ok = await F.confirm('Ez a kombináció már foglalt', `<b>${esc(F.keys.pretty(chord))}</b> most ehhez tartozik: <b>${users.map((u) => esc(u.label)).join(', ')}</b>.<br>Átteszem ide, és onnan levesszük?`, 'Átteszem');
      if (!recording) return;
      recording.wait = false;
      if (!ok) { recording.msg = null; render(true); return; }
      users.forEach((u) => F.keys.set(u.id, F.keys.chordsOf(u.id).filter((c) => c !== chord)));
    }
    if (index < list.length) list[index] = chord; else list.push(chord);
    F.keys.set(id, Array.from(new Set(list)));
    F.toast(`${esc(F.keys.actions.find((a) => a.id === id).label)}: <b>${esc(F.keys.pretty(chord))}</b>`, 'ok');
    stopRec();
  }, true);

  // ───────────── rendszer és névjegy ─────────────
  function aboutSection() {
    const e = F.state.engine;
    const line = (k, v, ok) => h('div', { class: 'sv-sys' }, h('span', { text: k }), h('span', { class: ok === false ? 'bad' : '', html: v }));
    const imp = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    imp.onchange = async () => {
      const f = imp.files[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!data || typeof data !== 'object' || !data.facetSettings) throw new Error('Ez nem FACET-beállításfájl.');
        Object.assign(F.settings, data.facetSettings);
        F.saveSettings(); F.applySettings(); F.emit('keys');
        if (F.settings.zoom) F.zoom.set(F.settings.zoom, true);
        F.toast('Beállítások betöltve', 'ok');
        render(true);
      } catch (err) { F.toast(esc(err.message), 'err'); }
    };
    return h('div', { class: 'sv-stack' },
      h('section', { class: 'sv-sec' }, h('h3', { text: 'Rendszer' }),
        h('div', { class: 'sv-card sv-pad' },
          e ? [
            line('FACET', esc(e.version || '')),
            line('Java', esc(e.java) + (e.jdk ? ' · JDK' : ' · <b>nincs javac — JDK kell</b>'), e.jdk),
            line('Python', e.python ? esc(e.python) : 'nincs telepítve — <a href="#" data-url="https://www.python.org/downloads/">python.org</a>', !!e.python),
            line('Node.js', e.node ? esc(e.node) + (e.npm ? ' · npm ' + esc(e.npm) : '') : 'nincs telepítve — <a href="#" data-url="https://nodejs.org">nodejs.org</a>', !!e.node),
            line('Git', e.git ? esc(e.git) : 'nincs telepítve — <a href="#" data-url="https://git-scm.com">git-scm.com</a>', !!e.git),
            line('Rendszer', esc(e.os || '')),
            line('Megnyitott mappa', e.workspace ? '<code>' + esc(F.shortPath(e.workspace)) + '</code>' : 'nincs')
          ] : h('div', { class: 'sv-desc', html: 'Demó mód: a fájlok a böngészőben vannak, és nincs futtatás. Indítsd el a FACET alkalmazást.' }),
          e ? h('button', { class: 'btn sv-mini', style: { marginTop: '8px', alignSelf: 'flex-start' }, onclick: async () => { await F.api('GET', 'tools'); F.state.engine = await F.apiJson('GET', 'ping'); render(true); F.toast('Eszközök újra felderítve'); } }, 'Eszközök keresése újra') : null)),
      h('section', { class: 'sv-sec' }, h('h3', { text: 'Beállítások mentése' }),
        h('div', { class: 'sv-card sv-pad' },
          h('div', { class: 'sv-desc', text: 'A beállításaidat (billentyűkkel együtt) fájlba mentheted, és egy másik gépen betöltheted.' }),
          h('div', { class: 'sv-btns' },
            h('button', { class: 'btn', onclick: () => {
              const blob = new Blob([JSON.stringify({ facetSettings: F.settings, version: e && e.version }, null, 2)], { type: 'application/json' });
              const a = h('a', { href: URL.createObjectURL(blob), download: 'facet-beallitasok.json' });
              document.body.append(a); a.click(); a.remove();
            } }, 'Exportálás…'),
            h('button', { class: 'btn', onclick: () => imp.click() }, 'Importálás…'), imp,
            h('button', { class: 'btn', onclick: async () => {
              if (!(await F.confirm('Minden beállítás alaphelyzetbe', 'A billentyűparancsok és a nagyítás is visszaáll.', 'Alaphelyzet', true))) return;
              const keep = {};
              Object.keys(F.DEFAULTS).forEach((k) => { keep[k] = JSON.parse(JSON.stringify(F.DEFAULTS[k])); });
              Object.assign(F.settings, keep);
              F.saveSettings(); F.applySettings(); F.zoom.set(1, true); F.emit('keys'); render(true);
            } }, 'Minden alaphelyzetbe')))),
      h('section', { class: 'sv-sec' }, h('h3', { text: 'Névjegy' }),
        h('div', { class: 'sv-card sv-pad sv-about' },
          h('div', { class: 'sv-brand', html: '<svg width="34" height="34" viewBox="0 0 26 26"><path d="M13 1 L24 8 L24 18 L13 25 L2 18 L2 8 Z" fill="#161C27" stroke="#2C3646"/><path d="M13 1 L24 8 L13 13 Z" fill="#FF8A3D"/><path d="M2 8 L13 1 L13 13 Z" fill="#FF5C7A"/><path d="M2 8 L13 13 L13 25 L2 18 Z" fill="#4DA3FF"/><path d="M13 13 L24 8 L24 18 L13 25 Z" fill="#273142"/></svg><div><b>FACET</b><span>Minden fájlnak saját arca · MIT-licenc</span></div>' }),
          h('div', { class: 'sv-btns' },
            h('button', { class: 'btn', onclick: () => F.openUrl('https://github.com/BBencht/FacetCode') }, 'GitHub'),
            h('button', { class: 'btn', onclick: () => F.openUrl('https://github.com/BBencht/FacetCode/releases/latest') }, 'Legújabb verzió'),
            h('button', { class: 'btn', onclick: () => F.openUrl('https://github.com/BBencht/FacetCode/issues/new') }, 'Hiba bejelentése')))));
  }

  const page = F.settingsPage = {
    isOpen: () => !!root && !root.hidden,
    open(c) {
      if (!root) build();
      if (c) cat = c;
      query = '';
      render();
      root.hidden = false;
      $('#settingsBtn') && $('#settingsBtn').classList.add('active');
      setTimeout(() => { const s = $('.sv-search', root); if (s) s.focus(); }, 30);
    },
    close() {
      if (!root || root.hidden) return;
      if (recording) stopRec();
      root.hidden = true;
      $('#settingsBtn') && $('#settingsBtn').classList.remove('active');
      if (F.editor && F.hasCode()) F.editor.focus();
    },
    toggle() { if (page.isOpen()) page.close(); else page.open(); },
    add(s) { extra.push(s); },
    addCategory(c, before) { const i = CATS.findIndex((x) => x.id === before); CATS.splice(i < 0 ? CATS.length - 2 : i, 0, c); }
  };

  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('#settingsView a[data-url]');
    if (a) { e.preventDefault(); F.openUrl(a.dataset.url); }
  });
})();
