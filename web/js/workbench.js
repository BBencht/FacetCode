/* FACET — munkafelület: billentyűparancsok (átírhatók), ablak-nagyítás,
   navigációs előzmények (egér vissza/előre gomb) és fájlok húzása. */
(function () {
  'use strict';
  const F = window.F;
  const { $, $$, h, esc, isMac } = F;
  const S = F.state;

  // ═════════════════════════════ billentyűparancsok ═════════════════════════════
  // Egy kombináció szövegként: módosítók rögzített sorrendben, majd a billentyű.
  // „Mod” = ⌘ macOS-en, Ctrl máshol. „Ctrl” csak macOS-en külön (a ⌃ billentyű).
  const CODE_KEYS = {
    Enter: 'Enter', NumpadEnter: 'Enter', Space: 'Space', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Escape: 'Escape',
    ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert',
    NumpadAdd: 'Num+', NumpadSubtract: 'Num-', NumpadMultiply: 'Num*', NumpadDivide: 'Num/', NumpadDecimal: 'Num.',
    Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`', IntlBackslash: '<'
  };
  const MOD_KEYS = ['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS'];

  /** Billentyű-esemény → kombináció (pl. „Shift+Mod+F”). Módosító önmagában: null. */
  function chordOf(e) {
    if (!e.key || MOD_KEYS.includes(e.key)) return null;
    const code = e.code || '';
    let key = null, symbol = false;
    if (/^F\d{1,2}$/.test(code)) key = code;
    else if (/^Numpad\d$/.test(code)) key = 'Num' + code.slice(6);
    else if (CODE_KEYS[code] && /^(Enter|Space|Tab|Backspace|Delete|Escape|Left|Right|Up|Down|Home|End|PageUp|PageDown|Insert|Num.)$/.test(CODE_KEYS[code])) key = CODE_KEYS[code];
    else if (!e.altKey && e.key.length === 1 && /[!-~]/.test(e.key)) {
      // A kiírt karakter számít (magyar billentyűzeten a + a Shift+3, a 0 bal felül van).
      key = /[a-z]/i.test(e.key) ? e.key.toUpperCase() : e.key;
      symbol = !/[a-z0-9]/i.test(e.key);
    } else if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
    else if (/^Digit\d$/.test(code)) key = code.slice(5);
    else if (CODE_KEYS[code]) key = CODE_KEYS[code];
    else return null;
    const parts = [];
    if (isMac && e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey && !symbol) parts.push('Shift');
    if (isMac ? e.metaKey : e.ctrlKey) parts.push('Mod');
    parts.push(key);
    return parts.join('+');
  }

  const SYM_MAC = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Mod: '⌘' };
  const KEY_LABEL = { Enter: '↵', Left: '←', Right: '→', Up: '↑', Down: '↓', Backspace: '⌫', Delete: 'Del', Escape: 'Esc', Space: 'Szóköz', PageUp: 'PgUp', PageDown: 'PgDn' };
  /** Kombináció olvasható alakban: macOS-en ⇧⌘F, máshol Shift+Ctrl+F. */
  function pretty(chord) {
    if (!chord) return '';
    const parts = chord.split('+');
    let key = parts.pop();
    if (key === '' && chord.endsWith('++')) { parts.pop(); key = '+'; }
    if (chord === '+') { parts.length = 0; key = '+'; }
    if (key.startsWith('Num') && key.length > 3) key = 'Num ' + key.slice(3);
    key = KEY_LABEL[key] || key;
    if (isMac) return parts.map((p) => SYM_MAC[p] || p).join('') + key;
    const order = ['Mod', 'Alt', 'Shift'];
    return parts.sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((p) => (p === 'Mod' ? 'Ctrl' : p)).concat(key).join('+');
  }

  const inCode = () => F.hasCode();
  const monacoAct = (id) => () => { const a = F.editor && F.editor.getAction(id); if (a) { F.editor.focus(); a.run(); } };
  const P = (mac, other) => (isMac ? mac : other);

  /** Minden átírható parancs. def: alapértelmezett kombinációk. monaco: a szerkesztő saját parancsa. */
  const ACTIONS = [
    // Általános
    { id: 'palette', group: 'Általános', label: 'Parancspaletta', def: ['Mod+K'], run: () => F.palette('all'), overlay: true },
    { id: 'quickOpen', group: 'Általános', label: 'Fájl keresése név alapján', def: ['Mod+P'], run: () => F.palette('files'), overlay: true },
    { id: 'settings', group: 'Általános', label: 'Beállítások', def: ['Mod+,'], run: () => F.settingsPage.open() },
    { id: 'run', group: 'Általános', label: 'Futtatás / előnézet', def: ['Mod+Enter'], run: () => F.run() },
    { id: 'flow', group: 'Általános', label: 'Flow mód', def: ['Shift+Mod+M'], run: () => F.toggleFlow() },
    // Fájlok
    { id: 'save', group: 'Fájlok', label: 'Mentés', def: ['Mod+S'], run: () => S.active && F.save(S.active, { manual: true }) },
    { id: 'saveAll', group: 'Fájlok', label: 'Összes mentése', def: ['Alt+Mod+S'], run: () => F.saveAll() },
    { id: 'newFile', group: 'Fájlok', label: 'Új fájl', def: ['Mod+N'], run: () => F.newFile() },
    { id: 'newFolder', group: 'Fájlok', label: 'Új mappa', def: [], run: () => F.newFolder(F.active() ? F.active().path.split('/').slice(0, -1).join('/') : '') },
    { id: 'newProject', group: 'Fájlok', label: 'Új projekt', def: ['Alt+Mod+N'], run: () => F.newProject() },
    { id: 'openFolder', group: 'Fájlok', label: 'Mappa megnyitása', def: ['Mod+O'], run: () => F.fs.mode === 'local' && F.openFolderDialog() },
    { id: 'closeTab', group: 'Fájlok', label: 'Aktív fül bezárása', def: P([], ['Mod+W']), run: () => S.active && F.closeFile(S.active) },
    { id: 'nextTab', group: 'Fájlok', label: 'Következő fül', def: P(['Ctrl+Tab', 'Alt+Mod+Right'], ['Mod+Tab']), run: () => cycleTab(1) },
    { id: 'prevTab', group: 'Fájlok', label: 'Előző fül', def: P(['Ctrl+Shift+Tab', 'Alt+Mod+Left'], ['Shift+Mod+Tab']), run: () => cycleTab(-1) },
    { id: 'revealFile', group: 'Fájlok', label: 'Aktív fájl mutatása a fában', def: [], run: () => S.active && F.revealInTree(S.active) },
    // Navigáció
    { id: 'navBack', group: 'Navigáció', label: 'Vissza az előző helyre (egér vissza gomb)', def: P(['Ctrl+-'], ['Alt+Left']), run: () => nav.back() },
    { id: 'navForward', group: 'Navigáció', label: 'Előre (egér előre gomb)', def: P(['Ctrl+_'], ['Alt+Right']), run: () => nav.forward() },
    { id: 'search', group: 'Navigáció', label: 'Keresés a projektben', def: ['Shift+Mod+F'], run: () => F.setView('search') },
    { id: 'explorer', group: 'Navigáció', label: 'Fájlok panel', def: ['Shift+Mod+E'], run: () => F.setView('files') },
    { id: 'gitView', group: 'Navigáció', label: 'Git panel', def: P(['Ctrl+Shift+G'], ['Shift+Mod+G']), run: () => F.setView('git') },
    { id: 'historyView', group: 'Navigáció', label: 'Időgép', def: [], run: () => F.setView('history') },
    // Nézet
    { id: 'toggleSide', group: 'Nézet', label: 'Oldalsáv ki/be', def: ['Mod+B'], run: () => F.setPanel('side') },
    { id: 'toggleStage', group: 'Nézet', label: 'Facet-panel (jobb oldal) ki/be', def: ['Alt+Mod+B'], run: () => F.setPanel('stage') },
    { id: 'toggleBottom', group: 'Nézet', label: 'Alsó panel ki/be', def: ['Mod+J'], run: () => F.bottom.toggle() },
    { id: 'zoomIn', group: 'Nézet', label: 'Ablak nagyítása', def: ['Mod+=', 'Mod++', 'Mod+Num+'], run: () => zoom.step(1), app: true },
    { id: 'zoomOut', group: 'Nézet', label: 'Ablak kicsinyítése', def: ['Mod+-', 'Mod+Num-'], run: () => zoom.step(-1), app: true },
    { id: 'zoomReset', group: 'Nézet', label: 'Nagyítás visszaállítása (100%)', def: ['Mod+0', 'Mod+Num0'], run: () => zoom.set(1), app: true },
    { id: 'toggleWrap', group: 'Nézet', label: 'Sortörés ki/be', def: ['Alt+Z'], run: () => { F.settings.wrap = !F.settings.wrap; F.saveSettings(); F.applySettings(); }, code: true },
    // Szerkesztés (a kódszerkesztő parancsai)
    { id: 'format', group: 'Szerkesztés', label: 'Formázás', def: ['Shift+Alt+F'], monaco: 'editor.action.formatDocument' },
    { id: 'comment', group: 'Szerkesztés', label: 'Megjegyzés ki/be', def: ['Mod+/'], monaco: 'editor.action.commentLine' },
    { id: 'find', group: 'Szerkesztés', label: 'Keresés a fájlban', def: ['Mod+F'], monaco: 'actions.find' },
    { id: 'replace', group: 'Szerkesztés', label: 'Csere a fájlban', def: P(['Alt+Mod+F'], ['Mod+H']), monaco: 'editor.action.startFindReplaceAction' },
    { id: 'gotoLine', group: 'Szerkesztés', label: 'Ugrás sorra', def: P(['Ctrl+G'], ['Mod+G']), monaco: 'editor.action.gotoLine' },
    { id: 'rename', group: 'Szerkesztés', label: 'Átnevezés mindenhol (szimbólum)', def: ['F2'], monaco: 'editor.action.rename' },
    { id: 'duplicateLine', group: 'Szerkesztés', label: 'Sor duplikálása lefelé', def: ['Shift+Alt+Down'], monaco: 'editor.action.copyLinesDownAction' },
    { id: 'moveLineUp', group: 'Szerkesztés', label: 'Sor mozgatása felfelé', def: ['Alt+Up'], monaco: 'editor.action.moveLinesUpAction' },
    { id: 'moveLineDown', group: 'Szerkesztés', label: 'Sor mozgatása lefelé', def: ['Alt+Down'], monaco: 'editor.action.moveLinesDownAction' },
    { id: 'deleteLine', group: 'Szerkesztés', label: 'Sor törlése', def: ['Shift+Mod+K'], monaco: 'editor.action.deleteLines' },
    { id: 'selectNext', group: 'Szerkesztés', label: 'Következő előfordulás kijelölése', def: ['Mod+D'], monaco: 'editor.action.addSelectionToNextFindMatch' },
    { id: 'cursorBelow', group: 'Szerkesztés', label: 'Kurzor hozzáadása alá', def: ['Alt+Mod+Down'], monaco: 'editor.action.insertCursorBelow' },
    { id: 'suggest', group: 'Szerkesztés', label: 'Kódkiegészítés megnyitása', def: P(['Ctrl+Space'], ['Mod+Space']), monaco: 'editor.action.triggerSuggest' },
    { id: 'fontUp', group: 'Szerkesztés', label: 'Betűméret növelése', def: [], run: () => { F.settings.fontSize = Math.min(28, F.settings.fontSize + 1); F.saveSettings(); F.applySettings(); } },
    { id: 'fontDown', group: 'Szerkesztés', label: 'Betűméret csökkentése', def: [], run: () => { F.settings.fontSize = Math.max(10, F.settings.fontSize - 1); F.saveSettings(); F.applySettings(); } }
  ];
  /** Kombináció egységes alakra: módosítók rögzített sorrendben (Ctrl, Alt, Shift, Mod). */
  const ORDER = ['Ctrl', 'Alt', 'Shift', 'Mod'];
  function norm(c) {
    if (!c) return c;
    let key;
    let rest = c;
    if (c.endsWith('++')) { key = '+'; rest = c.slice(0, -2); } else if (c === '+') return c; else { const i = c.lastIndexOf('+'); key = i < 0 ? c : c.slice(i + 1); rest = i < 0 ? '' : c.slice(0, i); }
    const mods = rest ? rest.split('+').filter(Boolean) : [];
    return mods.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).concat(key).join('+');
  }
  ACTIONS.forEach((a) => { a.def = a.def.map(norm); });
  const byId = new Map(ACTIONS.map((a) => [a.id, a]));

  /** Egy parancs érvényes kombinációi (a felhasználó beállítása, különben az alapértelmezés). */
  const chordsOf = (id) => {
    const a = byId.get(id);
    const custom = F.settings.keys && F.settings.keys[id];
    return Array.isArray(custom) ? custom : (a ? a.def : []);
  };
  const isCustom = (id) => Array.isArray(F.settings.keys && F.settings.keys[id]);
  /** kombináció → parancs, a felhasználó beállításaival. */
  let table = null;
  const buildTable = () => {
    table = new Map();
    ACTIONS.forEach((a) => chordsOf(a.id).forEach((c) => { if (!table.has(c)) table.set(c, a); }));
  };
  F.on('settings', () => { table = null; });

  // Billentyűk, amelyeket a dokumentumszerkesztő formázásra használ.
  const DOC_KEYS = new Set(['Mod+B', 'Mod+I', 'Mod+U', 'Mod+Z', 'Mod+Y', 'Shift+Mod+Z', 'Mod+A']);
  let suspended = false;

  function handle(e, overlayOpen) {
    if (suspended) return false;
    // Windowson/Linuxon az AltGr (Ctrl+Alt) karaktereket ír — magyar billentyűzeten pl. { } [ ] @ — ez nem parancs.
    if (!isMac && e.getModifierState && e.getModifierState('AltGraph')) return false;
    const chord = chordOf(e);
    if (!chord) return false;
    if (!table) buildTable();
    const t = e.target;
    const inMonaco = !!(t && t.closest && t.closest('.monaco-editor'));
    const typing = !inMonaco && t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    const hasMod = /(^|\+)(Mod|Ctrl)(\+|$)/.test(chord);
    if (typing && !hasMod && !/^F\d/.test(chord)) return false;
    if (t && t.closest && t.closest('#customView') && DOC_KEYS.has(chord)) return false;
    const a = table.get(chord);
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (a) {
      if (overlayOpen && !a.overlay) return false;
      if (a.app && !zoom.native) return false; // böngészőben a böngésző saját nagyítása dolgozik
      if (a.monaco) {
        if (!inCode()) return false;
        // Átírt kombináció: mi futtatjuk. Az alapértelmezést a szerkesztő maga kezeli.
        if (!isCustom(a.id) && inMonaco) return false;
        stop(); monacoAct(a.monaco)(); return true;
      }
      if (overlayOpen && a.overlay) { stop(); F.closeOverlay(); return true; }
      if (a.code && !inCode()) return false;
      stop();
      try { a.run(); } catch (err) { console.error(err); }
      return true;
    }
    // Ha egy szerkesztő-parancs alapértelmezését máshová tették, a régit elnyeljük.
    if (inMonaco) {
      const moved = ACTIONS.find((x) => x.monaco && isCustom(x.id) && x.def.includes(chord));
      if (moved) { stop(); return true; }
    }
    return false;
  }

  function cycleTab(d) {
    if (!S.open.length) return;
    const i = S.open.indexOf(S.active);
    F.open(S.open[(i + d + S.open.length) % S.open.length]);
  }

  F.keys = {
    actions: ACTIONS, chordOf, pretty, chordsOf, isCustom, norm,
    label: (id) => pretty(chordsOf(id)[0] || ''),
    handle,
    suspend(v) { suspended = !!v; },
    /** Kombináció beállítása: list = [] → nincs; null → alapértelmezés. */
    set(id, list) {
      const keys = Object.assign({}, F.settings.keys || {});
      const a = byId.get(id);
      if (list) list = list.map(norm);
      if (list == null || (a && JSON.stringify(list) === JSON.stringify(a.def))) delete keys[id]; else keys[id] = list;
      F.settings.keys = keys;
      F.saveSettings();
      table = null;
      F.emit('keys');
    },
    /** Kik használják már ezt a kombinációt (az adott parancson kívül). */
    users(chord, except) { return ACTIONS.filter((a) => a.id !== except && chordsOf(a.id).includes(chord)); },
    reserved(chord) {
      const r = isMac ? { 'Mod+Q': 'Kilépés', 'Mod+W': 'Ablak bezárása', 'Mod+H': 'Elrejtés', 'Mod+M': 'Kis méret', 'Mod+C': 'Másolás', 'Mod+V': 'Beillesztés', 'Mod+X': 'Kivágás', 'Mod+Z': 'Visszavonás', 'Mod+A': 'Mindent kijelöl' }
        : { 'Mod+C': 'Másolás', 'Mod+V': 'Beillesztés', 'Mod+X': 'Kivágás', 'Mod+Z': 'Visszavonás', 'Mod+Y': 'Újra', 'Mod+A': 'Mindent kijelöl', 'Alt+F4': 'Ablak bezárása' };
      return r[chord] || null;
    }
  };

  // ═════════════════════════════ ablak-nagyítás ═════════════════════════════
  const LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
  const tauri = window.__TAURI_INTERNALS__;
  const zoom = F.zoom = {
    /** Az asztali alkalmazásban a webnézet saját nagyítása; böngészőben a böngészőé. */
    native: !!(tauri && tauri.invoke),
    level: 1,
    async set(z, quiet) {
      z = Math.max(0.5, Math.min(2, Math.round(z * 100) / 100));
      zoom.level = z;
      let ok = false;
      if (zoom.native) {
        try { await tauri.invoke('plugin:webview|set_webview_zoom', { label: 'main', value: z }); ok = true; } catch (e) { console.warn('zoom', e); }
      }
      if (!ok) document.documentElement.style.zoom = z === 1 ? '' : String(z);
      if (F.settings.zoom !== z) { F.settings.zoom = z; F.saveSettings(); }
      const st = $('#stZoom');
      if (st) { st.hidden = z === 1; st.textContent = Math.round(z * 100) + '%'; }
      if (!quiet) zoomToast(z);
      setTimeout(() => F.emit('resize'), 60);
    },
    step(d) {
      const cur = zoom.level;
      let i = LEVELS.findIndex((x) => x >= cur - 0.001);
      if (i < 0) i = LEVELS.length - 1;
      if (d > 0) i = LEVELS[i] > cur + 0.001 ? i : i + 1; else i = i - 1;
      zoom.set(LEVELS[Math.max(0, Math.min(LEVELS.length - 1, i))]);
    }
  };
  let zt = null;
  function zoomToast(z) {
    let el = $('#zoomHud');
    if (!el) { el = h('div', { id: 'zoomHud', class: 'zoom-hud' }); document.body.append(el); }
    el.textContent = 'Nagyítás: ' + Math.round(z * 100) + '%';
    el.classList.add('show');
    clearTimeout(zt);
    zt = setTimeout(() => el.classList.remove('show'), 1100);
  }

  // ═════════════════════════════ Flow mód: teljes képernyő ═════════════════════════════
  let flowFull = false;
  async function setFullscreen(on) {
    if (zoom.native) {
      try { await tauri.invoke('plugin:window|set_fullscreen', { label: 'main', value: on }); return true; } catch (e) { console.warn('fullscreen', e); }
    }
    try {
      if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
      if (!on && document.fullscreenElement) await document.exitFullscreen();
      return true;
    } catch (e) { return false; }
  }
  F.on('flow', async (on) => {
    if (on && F.settings.flowFullscreen) flowFull = await setFullscreen(true);
    else if (!on && flowFull) { flowFull = false; await setFullscreen(false); }
    setTimeout(() => F.emit('resize'), 250);
  });
  // ha a böngésző teljes képernyőjéből Esc-kel lépnek ki, a Flow mód is véget ér
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && flowFull && document.body.classList.contains('flow')) { flowFull = false; F.toggleFlow(false); } });

  // ═════════════════════════════ navigációs előzmények ═════════════════════════════
  // Mint a VS Code-ban: a fájlváltások és a nagyobb ugrások a kódban helyek,
  // amelyek között az egér vissza/előre gombjával (vagy billentyűvel) lehet lépkedni.
  const nav = F.nav = {
    list: [], idx: -1, lock: false,
    here() {
      if (!S.active) return null;
      const d = S.docs.get(S.active);
      if (d && !d.custom && F.editor && F.editor.getModel() === d.model) {
        const p = F.editor.getPosition();
        return { path: S.active, line: p ? p.lineNumber : 1, col: p ? p.column : 1 };
      }
      return { path: S.active, line: 0, col: 0 };
    },
    record(loc) {
      if (nav.lock || !loc) return;
      const cur = nav.list[nav.idx];
      if (cur && cur.path === loc.path && (Math.abs(cur.line - loc.line) < 12 || !loc.line)) { cur.line = loc.line; cur.col = loc.col; return; }
      nav.list = nav.list.slice(0, nav.idx + 1);
      nav.list.push(loc);
      if (nav.list.length > 80) nav.list.shift();
      nav.idx = nav.list.length - 1;
      nav.ui();
    },
    async go(d) {
      const here = nav.here();
      const cur = nav.list[nav.idx];
      if (here && cur && cur.path === here.path) { cur.line = here.line; cur.col = here.col; }
      let i = nav.idx + d;
      // a közben bezárt/törölt fájlok helyét átugorjuk
      while (i >= 0 && i < nav.list.length && !exists(nav.list[i].path)) { nav.list.splice(i, 1); if (d < 0) i--; }
      if (i < 0 || i >= nav.list.length) { nav.ui(); return; }
      nav.idx = i;
      const t = nav.list[i];
      nav.lock = true;
      try { await F.open(t.path, t.line ? { line: t.line, col: t.col } : null); } finally { setTimeout(() => { nav.lock = false; }, 60); }
      nav.ui();
    },
    back() { return nav.go(-1); },
    forward() { return nav.go(1); },
    ui() {
      const b = $('#navBack'), f = $('#navFwd');
      if (b) { b.disabled = nav.idx <= 0; b.title = 'Vissza (' + F.keys.label('navBack') + ' · egér vissza gomb)'; }
      if (f) { f.disabled = nav.idx >= nav.list.length - 1; f.title = 'Előre (' + F.keys.label('navForward') + ')'; }
    }
  };
  const exists = (p) => S.open.includes(p) || F.files().includes(p);
  F.on('open', () => nav.record(nav.here()));
  F.on('cursor', F.debounce(() => nav.record(nav.here()), 250));
  F.on('moved', (from, to) => nav.list.forEach((x) => { if (x.path === from || x.path.startsWith(from + '/')) x.path = to + x.path.slice(from.length); }));

  // Az egér vissza/előre gombja: ne lépjen ki a FACET-ből, hanem a kódban lépjen.
  let lastMouseNav = 0;
  const mouseNav = (e) => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type !== 'mouseup') return;
    lastMouseNav = Date.now();
    if (e.button === 3) nav.back(); else nav.forward();
  };
  ['mousedown', 'mouseup', 'auxclick', 'pointerdown', 'pointerup'].forEach((t) => window.addEventListener(t, (e) => { if (e.type.startsWith('pointer')) { if (e.button === 3 || e.button === 4) e.preventDefault(); return; } mouseNav(e); }, true));
  // Védőbejegyzés a böngésző előzményeiben: a „vissza” sosem hagyja el a felületet.
  try {
    history.replaceState({ facet: 'base' }, '');
    history.pushState({ facet: 'guard' }, '');
    window.addEventListener('popstate', () => {
      history.pushState({ facet: 'guard' }, '');
      if (Date.now() - lastMouseNav > 400) nav.back();
    });
  } catch (e) { /* előzmény nélkül is megy */ }

  // ═════════════════════════════ fájlok húzása ═════════════════════════════
  const MIME = 'application/x-facet-path';
  let dragPath = null;
  const isFiles = (dt) => dt && Array.from(dt.types || []).includes('Files');
  const isOurs = (dt) => dt && Array.from(dt.types || []).includes(MIME);
  const dirOf = (p) => p.split('/').slice(0, -1).join('/');
  const hasFolder = () => F.fs.mode === 'memory' || !!(S.engine && S.engine.workspace);

  /** A fa melyik mappájába esik a húzás (fájl fölött: a fájl mappája; üres helyen: a gyökér). */
  function dropDir(e) {
    const row = e.target.closest && e.target.closest('#tree .node[data-path]');
    if (!row) return '';
    return row.dataset.dir ? row.dataset.path : dirOf(row.dataset.path);
  }
  let hoverTimer = null, hoverRow = null;
  function markTarget(dir) {
    $$('#tree .drop-target').forEach((n) => n.classList.remove('drop-target'));
    $('#tree').classList.toggle('drop-root', dir === '');
    if (dir) { const r = $(`#tree .node[data-path="${CSS.escape(dir)}"]`); if (r) r.classList.add('drop-target'); }
  }
  function clearMarks() { markTarget(null); $('#tree').classList.remove('drop-root'); clearTimeout(hoverTimer); hoverRow = null; document.body.classList.remove('dropping'); }

  function initDnD() {
    const tree = $('#tree');
    tree.addEventListener('dragstart', (e) => {
      const row = e.target.closest('.node[data-path]');
      if (!row) return;
      dragPath = row.dataset.path;
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData(MIME, dragPath);
      e.dataTransfer.setData('text/plain', dragPath);
      row.classList.add('dragging');
    });
    tree.addEventListener('dragend', (e) => { const row = e.target.closest && e.target.closest('.node'); if (row) row.classList.remove('dragging'); dragPath = null; clearMarks(); });
    tree.addEventListener('dragover', (e) => {
      const dt = e.dataTransfer;
      if (!isOurs(dt) && !isFiles(dt)) return;
      if (isFiles(dt) && !hasFolder()) return;
      e.preventDefault();
      const dir = dropDir(e);
      const bad = isOurs(dt) && dragPath && (dir === dragPath || dir.startsWith(dragPath + '/') || dir === dirOf(dragPath));
      dt.dropEffect = bad ? 'none' : (isFiles(dt) || e.altKey || (isMac ? e.altKey : e.ctrlKey)) ? 'copy' : 'move';
      markTarget(bad ? null : dir);
      // csukott mappa fölött kicsit várva kinyílik
      const row = e.target.closest('.node.folder:not(.open)');
      if (row !== hoverRow) {
        clearTimeout(hoverTimer); hoverRow = row;
        if (row) hoverTimer = setTimeout(() => { S.expanded.add(row.dataset.path); F.saveExpanded(); F.renderTree(); }, 650);
      }
    });
    tree.addEventListener('dragleave', (e) => { if (!tree.contains(e.relatedTarget)) clearMarks(); });
    tree.addEventListener('drop', async (e) => {
      const dt = e.dataTransfer;
      if (!isOurs(dt) && !isFiles(dt)) return;
      e.preventDefault();
      e.stopPropagation();
      const dir = dropDir(e);
      clearMarks();
      if (isOurs(dt)) {
        const from = dt.getData(MIME);
        const copy = isMac ? e.altKey : e.ctrlKey;
        await moveInto(from, dir, copy);
      } else await importFiles(dt, dir);
    });

    // Szerkesztőre húzva: a fából → megnyitja; a gépről → bemásolja és megnyitja.
    const center = $('#editorWrap');
    center.addEventListener('dragover', (e) => {
      const dt = e.dataTransfer;
      if (!isOurs(dt) && !(isFiles(dt) && hasFolder())) return;
      e.preventDefault();
      e.stopPropagation();
      dt.dropEffect = 'copy';
      document.body.classList.add('dropping');
    }, true);
    center.addEventListener('dragleave', (e) => { if (!center.contains(e.relatedTarget)) document.body.classList.remove('dropping'); }, true);
    center.addEventListener('drop', async (e) => {
      const dt = e.dataTransfer;
      if (!isOurs(dt) && !isFiles(dt)) return;
      e.preventDefault();
      e.stopPropagation();
      document.body.classList.remove('dropping');
      if (isOurs(dt)) {
        const p = dt.getData(MIME);
        if (F.files().includes(p)) F.open(p); else F.revealInTree(p);
        return;
      }
      if (!hasFolder()) { F.toast('Előbb nyiss meg egy mappát, és abba másolom a fájlokat.'); return; }
      const dir = S.active ? dirOf(S.active) : '';
      const made = await importFiles(dt, dir);
      if (made[0]) F.open(made[0]);
    }, true);

    // A felület többi részén a ledobott fájl ne nyissa meg a webnézetben (az kilépne a FACET-ből).
    window.addEventListener('dragover', (e) => { if (isFiles(e.dataTransfer)) e.preventDefault(); });
    window.addEventListener('drop', (e) => { if (isFiles(e.dataTransfer)) { e.preventDefault(); F.toast('A fájlokat a fájlfára vagy a szerkesztőre húzd.'); } });

    // Fülek átrendezése húzással.
    const tabs = $('#tabs');
    tabs.addEventListener('dragstart', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      e.dataTransfer.setData('application/x-facet-tab', tab.title);
      e.dataTransfer.setData(MIME, tab.title);
      e.dataTransfer.effectAllowed = 'move';
    });
    tabs.addEventListener('dragover', (e) => { if (Array.from(e.dataTransfer.types).includes('application/x-facet-tab')) { e.preventDefault(); } });
    tabs.addEventListener('drop', (e) => {
      const p = e.dataTransfer.getData('application/x-facet-tab');
      if (!p) return;
      e.preventDefault();
      const over = e.target.closest('.tab');
      const from = S.open.indexOf(p);
      if (from < 0) return;
      S.open.splice(from, 1);
      let to = over ? S.open.indexOf(over.title) : S.open.length;
      if (over) { const r = over.getBoundingClientRect(); if (e.clientX > r.left + r.width / 2) to++; }
      S.open.splice(Math.max(0, to), 0, p);
      F.renderTabs();
    });
    new MutationObserver(() => $$('#tabs .tab').forEach((t) => { t.draggable = true; })).observe(tabs, { childList: true });
  }

  async function uniqueName(dir, name) {
    const files = new Set(F.state.tree.map((n) => n.p));
    let p = F.joinPath(dir, name);
    if (!files.has(p)) return p;
    const m = name.match(/^(.*?)(\.[^.]+)?$/);
    for (let n = 2; n < 999; n++) { p = F.joinPath(dir, `${m[1]} (${n})${m[2] || ''}`); if (!files.has(p)) return p; }
    return p;
  }

  async function moveInto(from, dir, copy) {
    if (!from) return;
    const name = from.split('/').pop();
    if (dir === from || dir.startsWith(from + '/')) { F.toast('Egy mappát nem lehet saját magába tenni.', 'warn'); return; }
    if (dirOf(from) === dir && !copy) return;
    const isDir = F.state.treeIdx && F.state.treeIdx.get(from) === true;
    if (copy && F.fs.mode === 'local') {
      if (isDir) { F.toast('Mappát húzással csak áthelyezni lehet.', 'warn'); return; }
      const to = await uniqueName(dir, name);
      const r = await F.api('GET', 'file', { path: from });
      await F.api('PUT', 'file', { path: to }, await r.arrayBuffer());
      F.expandTo(to);
      await F.refreshTree();
      F.toast('Másolat: <b>' + esc(to) + '</b>', 'ok');
      return;
    }
    let to = F.joinPath(dir, name);
    if (F.state.treeIdx && F.state.treeIdx.has(to)) { F.toast(`Itt már van <b>${esc(name)}</b> nevű elem.`, 'warn'); return; }
    if (F.settings.confirmMove) {
      const r = await F.dialog({ title: 'Áthelyezés', text: `<b>${esc(name)}</b> → <code style="font-family:var(--font-code)">${esc(dir || 'a mappa gyökere')}</code>`, ok: 'Áthelyezés', extra: [{ label: 'Áthelyezés, és ne kérdezd többet', value: 'always' }] });
      if (r === null) return;
      if (r === 'always') { F.settings.confirmMove = false; F.saveSettings(); }
    }
    if (await F.moveItem(from, to, true)) {
      F.toast(`Áthelyezve: <b>${esc(to)}</b>`, 'ok');
      if (from.endsWith('.java')) javaPackageHint(to);
    }
  }

  /** Java-fájl áthelyezése után: a package sor igazítása az új mappához. */
  async function javaPackageHint(path) {
    const proj = F.projectOf(path);
    if (!proj || proj.startsWith('loose:')) return;
    const root = proj === '.' ? '' : proj;
    const src = F.state.treeIdx && F.state.treeIdx.get(F.joinPath(root, 'src')) === true ? F.joinPath(root, 'src') : root;
    let rel = dirOf(path);
    if (src && !(rel === src || rel.startsWith(src + '/'))) return;
    rel = src ? rel.slice(src.length).replace(/^\//, '') : rel;
    const pkg = rel.split('/').filter(Boolean).join('.');
    const text = await F.textOf(path);
    const m = text.match(/^\s*package\s+([\w.]+)\s*;/m);
    const cur = m ? m[1] : '';
    if (cur === pkg) return;
    const ok = await F.confirm('A package sor frissítése', `A fájl új helye alapján a csomag: <code>${esc(pkg || '(alapértelmezett)')}</code>, a fájlban most: <code>${esc(cur || '(nincs)')}</code>. Frissítsem?`, 'Frissítés');
    if (!ok) return;
    let next;
    if (m) next = pkg ? text.replace(m[0], m[0].replace(m[1], pkg)) : text.replace(m[0] + '\n', '').replace(m[0], '');
    else next = 'package ' + pkg + ';\n\n' + text;
    const d = S.docs.get(path);
    if (d && d.model) { F.replaceAll(d.model, next, 'package'); await F.save(path); } else await F.fs.write(path, next);
    F.toast('package frissítve: <code>' + esc(pkg) + '</code>', 'ok');
  }

  /** A gépről behúzott fájlok (és mappák) bemásolása. Visszaadja a létrehozott fájlokat. */
  async function importFiles(dt, dir) {
    if (!hasFolder()) { F.toast('Előbb nyiss meg egy mappát.'); return []; }
    const entries = [];
    const items = Array.from(dt.items || []);
    const walk = (entry, prefix) => new Promise((resolve) => {
      if (entry.isFile) entry.file((f) => { entries.push({ rel: prefix + f.name, file: f }); resolve(); }, () => resolve());
      else if (entry.isDirectory) {
        const reader = entry.createReader();
        const all = [];
        const more = () => reader.readEntries(async (batch) => {
          if (!batch.length) { for (const x of all) await walk(x, prefix + entry.name + '/'); resolve(); return; }
          all.push(...batch); more();
        }, () => resolve());
        more();
      } else resolve();
    });
    const roots = items.map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
    if (roots.length) { for (const r of roots) await walk(r, ''); }
    else Array.from(dt.files || []).forEach((f) => entries.push({ rel: f.name, file: f }));
    const skip = /(^|\/)(\.git|node_modules|\.DS_Store|__pycache__|\.idea|out|target)(\/|$)/;
    const list = entries.filter((x) => !skip.test(x.rel));
    if (!list.length) return [];
    if (list.length > 300) { F.toast('Egyszerre legfeljebb 300 fájlt másolok be.', 'warn'); return []; }
    const existing = new Set(F.state.tree.map((n) => n.p));
    const clashes = list.filter((x) => existing.has(F.joinPath(dir, x.rel)));
    let mode = 'keep';
    if (clashes.length) {
      const r = await F.dialog({ title: clashes.length === 1 ? 'Már létezik ilyen fájl' : clashes.length + ' fájl már létezik', text: clashes.slice(0, 4).map((c) => '<code>' + esc(F.joinPath(dir, c.rel)) + '</code>').join('<br>') + (clashes.length > 4 ? '<br>…' : ''), ok: 'Megtartom mindkettőt', extra: [{ label: 'Felülírás', value: 'over' }] });
      if (r === null) return [];
      mode = r === 'over' ? 'over' : 'keep';
    }
    const made = [];
    F.setSave('Másolás…');
    for (const x of list) {
      let to = F.joinPath(dir, x.rel);
      if (existing.has(to) && mode === 'keep') to = await uniqueName(dirOf(to), to.split('/').pop());
      const buf = await x.file.arrayBuffer();
      if (F.fs.mode === 'local') await F.api('PUT', 'file', { path: to }, buf);
      else await F.fs.write(to, new TextDecoder().decode(buf));
      // ha meg van nyitva, frissítjük a tartalmát
      const d = S.docs.get(to);
      if (d && d.model) { d.model.setValue(new TextDecoder().decode(buf)); F.markClean(to); }
      existing.add(to);
      made.push(to);
    }
    made.forEach((p) => F.expandTo(p));
    if (dir) { S.expanded.add(dir); F.saveExpanded(); }
    await F.refreshTree();
    F.setSave('');
    F.toast(made.length === 1 ? `Bemásolva: <b>${esc(made[0])}</b>` : `${made.length} fájl bemásolva ide: <b>${esc(dir || 'gyökér')}</b>`, 'ok');
    return made;
  }
  F.importFiles = importFiles;

  // ═════════════════════════════ indulás ═════════════════════════════
  F.on('editor', () => {
    initDnD();
    $('#navBack').onclick = () => nav.back();
    $('#navFwd').onclick = () => nav.forward();
    $('#stZoom').onclick = () => zoom.set(1);
    $('#settingsBtn').onclick = () => F.settingsPage.toggle();
    nav.ui();
    F.applySettings();
    if (F.settings.zoom && F.settings.zoom !== 1) zoom.set(F.settings.zoom, true);
    // Mentés, amikor a FACET elveszti a fókuszt (ha be van kapcsolva).
    window.addEventListener('blur', () => { if (F.settings.saveOnBlur) F.saveAll(); });
  });
  F.on('keys', () => nav.ui());
})();
