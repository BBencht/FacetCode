/* FACET — JavaScript facet, bővítve
   Node.js-futtatás interaktív terminállal, magyar hibamagyarázat (Node és böngésző),
   tanácsok gyors javítással, npm-panel (szkriptek, csomagok), JSDoc-generátor. */
(function () {
  'use strict';
  const { h, esc, $ } = F;
  const JS = F.jsx = {};
  const web = F.web;

  // ───────────── magyar hibamagyarázat ─────────────
  const RULES = [
    [/ReferenceError: (\S+) is not defined/, (m) => (/^(document|window|alert|localStorage|navigator)$/.test(m[1])
      ? { t: `${m[1]} nem létezik Node.js-ben`, b: `A <code>${esc(m[1])}</code> csak a böngészőben van. Ez a fájl most Node.js-ben fut, ahol nincs weboldal. Hozz létre egy HTML-t, ami betölti ezt a szkriptet, és a FACET az előnézetben futtatja.` }
      : { t: `Ismeretlen név: ${m[1]}`, b: `Nincs <code>${esc(m[1])}</code> nevű változó vagy függvény. Elírtad (kis- és nagybetű is számít)? Lehet, hogy hiányzik a <code>let</code>/<code>const</code>, vagy később hoztad létre, mint ahol használod.` })],
    [/TypeError: Cannot read propert(?:y|ies) of (undefined|null) \(reading '([^']+)'\)/, (m) => ({ t: `${m[1]} értéknek nincs .${m[2]} tulajdonsága`, b: `Egy kifejezés értéke <code>${m[1]}</code>, és erről próbáltad olvasni ezt: <code>.${esc(m[2])}</code>. Gyakori ok: a <code>querySelector</code> nem talált elemet (rossz szelektor, vagy a szkript a HTML előtt fut), vagy egy objektum még nem kapott értéket.` })],
    [/TypeError: Cannot set propert(?:y|ies) of (undefined|null)/, (m) => ({ t: `Nem lehet ${m[1]} értéken tulajdonságot beállítani`, b: 'Valami, aminek objektumnak kellene lennie, még üres. Ellenőrizd, hogy a változó tényleg kapott-e értéket.' })],
    [/TypeError: (\S+) is not a function/, (m) => ({ t: `${m[1]} nem függvény`, b: `Függvényként hívtad meg (<code>()</code>), de nem az. Elírtad a nevét, vagy rossz objektumon hívod? Tömböknél: <code>.forEach</code>, <code>.map</code>; szövegnél: <code>.toUpperCase()</code>.` })],
    [/TypeError: Assignment to constant variable/, () => ({ t: 'const változónak új értéket adtál', b: 'A <code>const</code>-tal létrehozott változó értéke nem változhat. Ha később módosítod, használj <code>let</code>-et.' })],
    [/SyntaxError: Identifier '([^']+)' has already been declared/, (m) => ({ t: `Kétszer létrehozott név: ${m[1]}`, b: `A <code>${esc(m[1])}</code> már létezik ebben a hatókörben. Ha csak új értéket adnál neki, hagyd el a <code>let</code>/<code>const</code> szót.` })],
    [/SyntaxError: Unexpected end of input/, () => ({ t: 'Váratlanul véget ért a fájl', b: 'Valószínűleg hiányzik egy záró <code>}</code> vagy <code>)</code>. Nézd meg, minden nyitott zárójelnek van-e párja.' })],
    [/SyntaxError: missing \) after argument list/, () => ({ t: 'Hiányzik egy ) zárójel', b: 'Egy függvényhívás zárójele nincs lezárva, vagy két paraméter között hiányzik a vessző.' })],
    [/SyntaxError: Unexpected token '?([^'\s]+)'?/, (m) => ({ t: `Váratlan jel: ${m[1]}`, b: `Itt nem állhat <code>${esc(m[1])}</code>. Gyakori ok: hiányzó vessző vagy zárójel előtte, vagy elgépelt kulcsszó.` })],
    [/SyntaxError: Invalid or unexpected token/, () => ({ t: 'Érvénytelen karakter', b: 'Valószínűleg egy lezáratlan idézőjel (<code>"</code>, <code>\'</code>, <code>`</code>), vagy egy „okos” idézőjel került a kódba.' })],
    [/SyntaxError: Cannot use import statement outside a module/, () => ({ t: 'import csak modulban használható', b: 'Nevezd át a fájlt <code>.mjs</code>-re, vagy a <code>package.json</code>-ba írd be: <code>"type": "module"</code>. Másik lehetőség: <code>const x = require(\'x\')</code>.' })],
    [/ReferenceError: require is not defined in ES module scope/, () => ({ t: 'require modulban nem használható', b: 'Ez a fájl ES-modul, ezért <code>import x from \'x\'</code> formát használj a <code>require</code> helyett.' })],
    [/Cannot find module '([^']+)'|ERR_MODULE_NOT_FOUND.*?'([^']+)'/, (m) => ({ t: `Nincs ilyen csomag: ${m[1] || m[2]}`, b: (m[1] || m[2] || '').startsWith('.') ? 'A megadott fájl nem található. Ellenőrizd az útvonalat és a kiterjesztést.' : `Telepítsd a projekt mappájában: <code>npm install ${esc((m[1] || m[2]).split('/')[0])}</code> (az npm panelen egy gombnyomás).` })],
    [/RangeError: Maximum call stack size exceeded/, () => ({ t: 'Túl mély rekurzió', b: 'Egy függvény túl sokszor hívta önmagát. Hiányzik vagy sosem teljesül a leállási feltétel.' })],
    [/RangeError: Invalid array length/, () => ({ t: 'Érvénytelen tömbméret', b: 'Negatív vagy nem egész számú hosszal hoztál létre tömböt.' })],
    [/Unexpected token .* in JSON|JSON\.parse|is not valid JSON/, () => ({ t: 'Hibás JSON', b: 'A <code>JSON.parse</code> nem érvényes JSON szöveget kapott. Kulcsok és szövegek csak dupla idézőjelben lehetnek, és nem lehet felesleges vessző a végén.' })],
    [/fetch failed|Failed to fetch|NetworkError/, () => ({ t: 'Hálózati hiba', b: 'A kérés nem jutott el a szerverhez. Jó a cím? Van internet? Böngészőben a szerver CORS-beállítása is megakadályozhatja.' })],
    [/EADDRINUSE.*?:(\d+)/, (m) => ({ t: `A ${m[1]}-es port foglalt`, b: 'Már fut egy program ezen a porton (talán egy korábbi indítás). Állítsd le, vagy használj másik portot.' })],
    [/ENOENT.*?'([^']+)'/, (m) => ({ t: 'Nincs ilyen fájl', b: `Nem találom: <code>${esc(m[1])}</code>. Az útvonal a futtatott fájl mappájához képest értendő.` })]
  ];
  JS.explain = (text) => {
    for (const [re, fn] of RULES) { const m = re.exec(text); if (m) return fn(m); }
    return null;
  };

  // ───────────── Node.js-futtatás ─────────────
  JS.running = null;
  async function runNode(a) {
    F.bottom.show('terminal');
    F.term.clear();
    if (F.fs.mode !== 'local') { web.runJs(a); return; }
    const eng = F.state.engine || {};
    if (!eng.node) {
      F.term.row('node', 'A Node.js nincs telepítve, ezért a kód a beépített konzolban fut. Ha Node.js-ben futtatnád (npm csomagokkal, fájlkezeléssel), telepítsd: <b>nodejs.org</b> (LTS), majd indítsd újra a FACET-et.', '', 'var(--warn)');
      web.runJs(a);
      return;
    }
    if (/\.(ts|tsx|jsx)$/i.test(a.path)) {
      F.term.row('node', `A(z) .${esc(F.ext(a.path))} fájlt a Node közvetlenül nem futtatja. React/TypeScript projektet az npm panelen indíts (pl. <code>npm run dev</code>).`, 't-bad', 'var(--warn)');
      return;
    }
    F.term.row('futtatás', esc(a.path) + `  ·  Node ${esc(eng.node)}`, '', F.facets.js.accent);
    let r;
    try { r = await F.apiJson('POST', 'node/run', { path: a.path }); } catch (e) { F.term.row('hiba', esc(e.message), 't-bad', 'var(--err)'); return; }
    if (!r.ok) { web.runJs(a); return; }
    setRunning(true);
    F.term.input(true, F.procInput(r.id));
    let err = '';
    await F.streamProc(r.id, {
      out: (d) => F.term.stream(d, 't-out'),
      err: (d) => { err += d; F.term.stream(d.replace(/\n\s+at (?:node:|.*\(node:)[^\n]*/g, ''), 't-err'); },
      exit: (ev) => {
        const s = (ev.ms / 1000).toFixed(2).replace('.', ',');
        F.term.row('kilépés', `kód ${ev.code} · ${s} s`, ev.code === 0 ? '' : 't-bad', ev.code === 0 ? 'var(--muted-2)' : 'var(--err)');
        if (ev.code !== 0 && err) explainInTerminal(err, a.path);
      }
    });
    setRunning(false);
    F.term.input(false);
  }

  function explainInTerminal(err, path) {
    const ex = JS.explain(err);
    const root = ((F.state.engine && F.state.engine.workspace) || '').replace(/\\/g, '/');
    let loc = null;
    const re = /((?:[A-Za-z]:)?[\\/][^\s:()'"]+\.(?:m?js|cjs)):(\d+)(?::(\d+))?/g;
    let m;
    while ((m = re.exec(err))) {
      const f = m[1].replace(/\\/g, '/');
      if (root && f.startsWith(root + '/') && !f.includes('/node_modules/')) { loc = { path: f.slice(root.length + 1), line: +m[2], col: +(m[3] || 1) }; break; }
    }
    if (!ex && !loc) return;
    const where = loc ? ` A hiba helye: <span class="t-link" data-path="${esc(loc.path)}" data-line="${loc.line}" data-col="${loc.col}">${esc(loc.path.split('/').pop())}:${loc.line}</span>.` : '';
    F.term.html(`<div class="t-card"><b>Hibatolmács${ex ? ' · ' + esc(ex.t) : ''}</b><span>${ex ? ex.b : 'A program hibával leállt.'}${where}</span></div>`);
    if (loc) F.openAt(loc.path, loc.line, loc.col);
  }

  function setRunning(on) {
    JS.running = on;
    $('#runBtn').classList.toggle('running', on);
    if (F.state.facet === 'js') $('#runLabel').textContent = on ? 'Leállítás' : 'Futtatás';
  }

  async function run(a) {
    if (JS.running && F.proc) { F.proc.kill(); return; }
    const html = await web.htmlFor(a.path);
    if (html) web.showPreview();
    else runNode(a);
  }

  // böngészős hibák magyarázata a konzolban
  F.on('consoleError', (text) => {
    const ex = JS.explain(text);
    if (!ex) return;
    const out = $('#consoleOut');
    out.append(h('div', { class: 't-card', style: { margin: '6px 0' } }, h('b', { text: 'Hibatolmács · ' + ex.t }), h('span', { html: ex.b })));
    out.scrollTop = out.scrollHeight;
  });

  // ───────────── tanácsok (lint) gyors javítással ─────────────
  function blankJs(src) {
    let out = '', i = 0;
    const n = src.length;
    while (i < n) {
      const c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') { out += ' '; i++; } continue; }
      if (c === '/' && d === '*') { out += '  '; i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; } if (i < n) { out += '  '; i += 2; } continue; }
      if (c === '"' || c === "'" || c === '`') {
        out += c; i++;
        while (i < n && src[i] !== c) { if (src[i] === '\\') { out += ' '; i++; } out += src[i] === '\n' ? '\n' : ' '; i++; }
        if (i < n) { out += c; i++; }
        continue;
      }
      out += c; i++;
    }
    return out;
  }

  function lint(model) {
    const code = blankJs(model.getValue()).split('\n');
    const out = [];
    code.forEach((L, i) => {
      const line = i + 1;
      let m;
      const eq = /(^|[^=!<>])(==|!=)(?!=)/g;
      while ((m = eq.exec(L))) {
        const col = m.index + m[1].length + 1;
        out.push({ line, col, endCol: col + m[2].length, sev: 'warn', title: `${m[2]} helyett ${m[2]}=`, body: `A <code>${m[2]}</code> összehasonlítás előtt átalakítja a típusokat (pl. <code>"1" == 1</code> igaz). A <code>${m[2]}=</code> pontosan hasonlít, így kevesebb a meglepetés.`, fix: { label: `Csere: ${m[2]}=`, text: m[2] + '=' } });
      }
      const v = /(^|[^\w$.])var\s+/.exec(L);
      if (v) {
        const col = v.index + v[1].length + 1;
        out.push({ line, col, endCol: col + 3, sev: 'info', title: 'var helyett let vagy const', body: 'A <code>var</code> régi forma, és furcsán viselkedik blokkokban (pl. ciklusban). Ha az érték nem változik, használj <code>const</code>-ot, különben <code>let</code>-et.', fix: { label: 'Csere: let', text: 'let' } });
      }
      const asg = /\b(if|while)\s*\(([^()=!<>]*[^=!<>])=([^=][^)]*)\)/.exec(L);
      if (asg) {
        const col = L.indexOf('=', asg.index + asg[1].length) + 1;
        out.push({ line, col, endCol: col + 1, sev: 'warn', title: 'Értékadás a feltételben', body: 'Az <code>=</code> értéket ad, nem hasonlít. Összehasonlításhoz <code>===</code> kell.', fix: { label: 'Csere: ===', text: '===' } });
      }
      const dbg = /\bdebugger\b/.exec(L);
      if (dbg) out.push({ line, col: dbg.index + 1, endCol: dbg.index + 9, sev: 'info', title: 'debugger utasítás', body: 'A <code>debugger</code> megállítja a programot, ha nyitva vannak a fejlesztői eszközök. Kész kódból érdemes törölni.', fix: { label: 'Törlés', text: '' } });
    });
    return out;
  }
  JS.lint = lint;

  const tips = new Map();
  function applyLint(path, model) {
    if (!model || !/\.(m?js|cjs|jsx)$/i.test(path)) return;
    const list = lint(model);
    tips.set(path, list);
    monaco.editor.setModelMarkers(model, 'facet-js', list.map((d) => ({
      startLineNumber: d.line, startColumn: d.col, endLineNumber: d.line, endColumn: d.endCol,
      severity: d.sev === 'warn' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info,
      message: d.title + '\n' + d.body.replace(/<[^>]+>/g, ''), source: 'FACET tanács'
    })));
    F.problems.set('js:' + path, list.filter((d) => d.sev === 'warn').map((d) => ({ file: path, line: d.line, col: d.col, sev: 'warn', title: d.title, detail: 'FACET tanács' })));
    if (F.state.active === path && F.stageTab() === 'tips') F.refreshStage();
    F.renderStageTabs();
  }

  function fix(path, d) {
    const doc = F.state.docs.get(path);
    if (!doc || doc.custom) return;
    const model = doc.model;
    const lineText = model.getLineContent(d.line);
    let end = d.endCol;
    if (d.fix.text === '' && /^debugger;?/.test(lineText.slice(d.col - 1))) end = d.col + (lineText.slice(d.col - 1).startsWith('debugger;') ? 9 : 8);
    model.pushEditOperations([], [{ range: new monaco.Range(d.line, d.col, d.line, end), text: d.fix.text }], () => null);
    F.editor.focus();
  }

  function tipsPanel(body, a) {
    body.innerHTML = '';
    const list = tips.get(a.path) || [];
    if (!list.length) {
      body.append(h('div', { class: 'ok-card' }, h('span', { class: 'diamond' }), h('span', { text: 'Nincs tanács ehhez a fájlhoz. Tiszta kód!' })));
    }
    list.forEach((d) => {
      body.append(h('div', { class: 'expl warn', onclick: () => F.goto(d.line, d.col, d.endCol) },
        h('div', { class: 'eh' }, h('span', { class: 'et', text: d.title }), h('span', { class: 'el', text: a.path.split('/').pop() + ':' + d.line })),
        h('span', { class: 'eb', html: d.body }),
        h('div', { class: 'ea' }, h('button', { class: 'chip primary', onclick: (e) => { e.stopPropagation(); fix(a.path, d); } }, d.fix.label))));
    });
    if (list.length > 1) body.append(h('button', { class: 'chip', style: { alignSelf: 'flex-start' }, onclick: () => { [...list].sort((x, y) => y.line - x.line || y.col - x.col).forEach((d) => fix(a.path, d)); } }, `Mind a ${list.length} javítása`));
    body.append(h('div', { class: 'set-note', html: 'A szintaktikai hibákat a szerkesztő élőben, pirossal jelzi. Futtatás közbeni hibáknál a Hibatolmács magyarul elmagyarázza, mi történt.' }));
  }

  // ───────────── npm ─────────────
  function pkgDir(path) {
    const files = new Set(F.files());
    let d = path.split('/').slice(0, -1).join('/');
    for (;;) {
      if (files.has((d ? d + '/' : '') + 'package.json')) return d;
      if (!d) return null;
      d = d.split('/').slice(0, -1).join('/');
    }
  }

  async function npmPanel(body, a) {
    body.innerHTML = '';
    const eng = F.state.engine || {};
    if (F.fs.mode !== 'local') { body.append(h('div', { class: 'stage-empty', text: 'Az npm a helyi FACET motorral működik.' })); return; }
    if (!eng.npm) {
      body.append(h('div', { class: 'git-help' }, h('b', { text: 'Az npm nincs telepítve.' }), h('span', { html: 'Telepítsd a Node.js-t (benne van az npm): <b>nodejs.org</b> → LTS. Utána indítsd újra a FACET-et.' }),
        h('button', { class: 'btn', onclick: async () => { F.state.engine = await F.apiJson('GET', 'tools'); F.refreshStageNow(); } }, 'Újra ellenőrzöm')));
      return;
    }
    const dir = pkgDir(a.path);
    if (dir == null) {
      const here = a.path.split('/').slice(0, -1).join('/');
      body.append(h('div', { class: 'git-help' }, h('b', { text: 'Ez még nem npm-projekt.' }),
        h('span', { text: 'A package.json írja le a projekt nevét, a használt csomagokat és az indító parancsokat (pl. npm run dev).' }),
        h('button', { class: 'btn accent', onclick: async () => { await F.runCommand('npm init -y', here); await F.refreshTree(); F.refreshStageNow(); } }, 'package.json létrehozása'),
        h('span', { class: 'set-note', html: 'Ez ezt futtatja: <code>npm init -y</code>' })));
      return;
    }
    let pkg = {};
    try { pkg = JSON.parse(await F.textOf((dir ? dir + '/' : '') + 'package.json')); } catch (e) {
      body.append(h('div', { class: 'expl' }, h('span', { class: 'et', text: 'A package.json hibás' }), h('span', { class: 'eb', text: e.message })));
      return;
    }
    const hasModules = F.state.tree.some((n) => n.p === (dir ? dir + '/' : '') + 'node_modules') || F.files().some((p) => p.startsWith((dir ? dir + '/' : '') + 'node_modules/'));
    body.append(h('div', { class: 'card' },
      h('div', { class: 'card-title' }, pkg.name || 'npm-projekt', h('span', { class: 'sub', text: pkg.version ? 'v' + pkg.version : '' })),
      pkg.description ? h('div', { class: 'set-note', text: pkg.description }) : null,
      h('div', { class: 'set-note', text: (dir || 'a mappa gyökere') + (pkg.type === 'module' ? ' · ES-modul' : '') }),
      h('div', { class: 'grid2' },
        h('button', { class: 'chip' + (hasModules ? '' : ' primary'), onclick: () => F.runCommand('npm install', dir) }, 'npm install'),
        h('button', { class: 'chip', onclick: () => addPackage(dir, false) }, '+ Csomag'))));
    const scripts = Object.entries(pkg.scripts || {});
    const sc = h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Szkriptek', h('span', { class: 'sub', text: 'npm run' })));
    if (!scripts.length) sc.append(h('div', { class: 'set-note', html: 'Nincs szkript. A package.json „scripts” részébe írhatsz ilyet: <code>"start": "node index.js"</code>' }));
    scripts.forEach(([n, cmd]) => sc.append(h('div', { class: 'npm-row' },
      h('button', { class: 'icon-btn', title: `npm run ${n}`, onclick: () => F.runCommand(`npm run ${n}`, dir), html: '<svg width="11" height="11" viewBox="0 0 12 12"><path d="M3 1.5 L10.5 6 L3 10.5 Z" fill="currentColor"/></svg>' }),
      h('span', { class: 'nm', text: n }), h('code', { title: cmd, text: cmd }))));
    if (scripts.some(([n]) => /^(dev|start|serve)$/.test(n))) sc.append(h('div', { class: 'set-note', text: 'A fejlesztői szerver címét a terminál írja ki (pl. http://localhost:5173). A leállításhoz nyomd meg a ■ gombot az alsó panelen.' }));
    body.append(sc);
    const deps = Object.entries(pkg.dependencies || {}), dev = Object.entries(pkg.devDependencies || {});
    const dc = h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Csomagok', h('span', { class: 'sub', text: (deps.length + dev.length) + ' db' })));
    if (!deps.length && !dev.length) dc.append(h('div', { class: 'set-note', text: 'Még nincs telepített csomag.' }));
    const row = (n, v, isDev) => h('div', { class: 'npm-row' }, h('span', { class: 'nm', text: n }), isDev ? h('span', { class: 'kbd', text: 'dev' }) : null, h('code', { text: v }),
      h('button', { class: 'icon-btn', title: 'Eltávolítás', onclick: async () => { if (await F.confirm('Csomag eltávolítása', `Eltávolítod: <b>${esc(n)}</b>?`, 'Eltávolítás', true)) { await F.runCommand(`npm uninstall ${n}`, dir); F.refreshStageNow(); } }, html: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2 L8 8 M8 2 L2 8" stroke="currentColor" stroke-width="1.4"/></svg>' }));
    deps.forEach(([n, v]) => dc.append(row(n, v, false)));
    dev.forEach(([n, v]) => dc.append(row(n, v, true)));
    body.append(dc);
  }

  async function addPackage(dir) {
    const v = await F.dialog({ title: 'Csomag telepítése', text: 'Az npm-ről telepít egy csomagot ebbe a projektbe. Népszerűek: <code>express</code>, <code>axios</code>, <code>lodash</code>, <code>dayjs</code>.',
      fields: [{ id: 'n', label: 'Csomag neve', placeholder: 'pl. express' }, { id: 'dev', type: 'checkbox', label: 'Csak fejlesztéshez (devDependency)', value: false }],
      ok: 'Telepítés', validate: (x) => (/^(@[\w.-]+\/)?[\w.-]+(@[\w.^~-]+)?$/.test(x.n) ? null : 'Érvénytelen csomagnév.') });
    if (!v) return;
    await F.runCommand(`npm install ${v.dev ? '--save-dev ' : ''}${v.n}`, dir);
    await F.refreshTree();
    F.refreshStageNow();
  }

  // ───────────── JSDoc ─────────────
  function jsdoc() {
    if (!F.hasCode()) return;
    const model = F.editor.getModel();
    const pos = F.editor.getPosition();
    let line = pos.lineNumber, m = null;
    for (let l = line; l <= Math.min(model.getLineCount(), line + 3) && !m; l++) {
      const t = model.getLineContent(l);
      m = /^(\s*)(?:export\s+)?(?:async\s+)?function\s*\*?\s*([\w$]*)\s*\(([^)]*)\)/.exec(t)
        || /^(\s*)(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?\(?([^)=]*)\)?\s*=>/.exec(t)
        || /^(\s*)(?:async\s+)?([\w$]+)\s*\(([^)]*)\)\s*\{/.exec(t);
      if (m) line = l;
    }
    if (!m) { F.toast('Állj egy függvény sorára, és ahhoz írom a leírást.'); return; }
    const ind = m[1];
    const params = m[3].split(',').map((p) => p.trim().replace(/=.*$/, '').replace(/^\.\.\./, '').trim()).filter(Boolean);
    const returns = /\breturn\b/.test(blankJs(model.getValue().split('\n').slice(line - 1, line + 40).join('\n')));
    let snip = `${ind}/**\n${ind} * \${1:Mit csinál ez a függvény?}\n`;
    let k = 2;
    params.forEach((p) => { snip += `${ind} * @param {\${${k++}:*}} ${p.replace(/[{}\[\]]/g, '')} \${${k++}:leírás}\n`; });
    if (returns) snip += `${ind} * @returns {\${${k++}:*}} \${${k++}:mit ad vissza}\n`;
    snip += `${ind} */\n`;
    F.editor.setPosition({ lineNumber: line, column: 1 });
    F.insertSnippet(snip);
  }

  // ───────────── facet ─────────────
  const def = F.facets.js;
  F.extendFacet('js', {
    run,
    langFor: (p) => (/\.tsx?$/i.test(p) ? 'typescript' : 'javascript'),
    hint: 'Node.js vagy böngésző — a kimenet ide érkezik',
    tools: [
      { label: 'console.log', kbd: 'log', run: () => F.insertSnippet('console.log(${1});') },
      { label: 'Függvény', run: () => F.insertSnippet('function ${1:nev}(${2:param}) {\n\t${0}\n}') },
      { label: 'Esemény', run: () => F.insertSnippet("${1:elem}.addEventListener('click', (e) => {\n\t${0}\n});") },
      { label: 'fetch', run: () => F.insertSnippet("const valasz = await fetch('${1:https://api.example.com}');\nconst ${2:adat} = await valasz.json();") },
      { label: 'JSDoc', title: 'Leírás a függvényhez', run: jsdoc },
      { label: 'npm', when: () => F.fs.mode === 'local', run: () => F.showStage('npm') },
      { label: 'Formázás', kbd: '⇧⌥F', run: () => F.editor.getAction('editor.action.formatDocument').run() }
    ],
    stage: def.stage.filter((s) => s.id !== 'snippets').concat([
      { id: 'tips', label: () => { const a = F.active(); const n = a ? (tips.get(a.path) || []).length : 0; return 'Tanácsok' + (n ? ` <span class="count">${n}</span>` : ''); }, render: tipsPanel },
      { id: 'npm', label: 'npm', when: () => F.fs.mode === 'local', render: (b, a) => { npmPanel(b, a); } }
    ]).concat(def.stage.filter((s) => s.id === 'snippets')),
    onActivate: (path, model) => { applyLint(path, model); if (JS.running) $('#runLabel').textContent = 'Leállítás'; },
    onChange: (path, model) => applyLint(path, model),
    onClose: (path) => { tips.delete(path); F.problems.set('js:' + path, []); }
  });

  F.on('editor', () => {
    const ts = monaco.languages.typescript;
    if (!ts) return;
    const opts = { target: ts.ScriptTarget.ESNext, allowNonTsExtensions: true, allowJs: true, jsx: ts.JsxEmit.Preserve, moduleResolution: ts.ModuleResolutionKind.NodeJs, module: ts.ModuleKind.ESNext };
    ts.javascriptDefaults.setCompilerOptions(opts);
    ts.typescriptDefaults.setCompilerOptions(opts);
    ts.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
    ts.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
    monaco.languages.registerCodeActionProvider('javascript', {
      provideCodeActions(model, range) {
        const entry = [...F.state.docs].find(([, d]) => d.model === model);
        if (!entry) return { actions: [], dispose() {} };
        const list = (tips.get(entry[0]) || []).filter((d) => d.line === range.startLineNumber);
        return {
          actions: list.map((d) => ({ title: 'FACET: ' + d.fix.label, kind: 'quickfix', isPreferred: true, edit: { edits: [{ resource: model.uri, textEdit: { range: new monaco.Range(d.line, d.col, d.line, d.endCol), text: d.fix.text }, versionId: model.getVersionId() }] } })),
          dispose() {}
        };
      }
    });
  });

  const C = (label, keywords, runFn, icon) => F.command({ label, keywords, run: runFn, icon: icon || 'JS', facet: 'js' });
  C('Futtatás Node.js-ben', 'node run futtatas', () => { const a = F.active(); if (a) runNode(a); }, '▶');
  C('JSDoc leírás a függvényhez', 'jsdoc dokumentacio comment leiras', jsdoc, '/**');
  C('npm install', 'npm install telepites csomagok', () => { const a = F.active(); if (a) F.runCommand('npm install', pkgDir(a.path) || ''); }, 'n');
  C('npm csomag telepítése…', 'npm package csomag hozzaadas', () => { const a = F.active(); if (a) addPackage(pkgDir(a.path) || a.path.split('/').slice(0, -1).join('/')); }, '+');
  C('npm panel', 'npm scripts szkriptek', () => F.showStage('npm'), 'n');
  C('Tanácsok', 'lint tanacs hibak', () => F.showStage('tips'), '!');
})();
