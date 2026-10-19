/* FACET — Git
   Oldalsó panel (változások, előkészítés, commit, ágak, szinkron), Git-térkép
   (a négy terület diagramja + commit-gráf + kisokos), magyar hibamagyarázat,
   és a változott sorok jelölése a szerkesztő szélén. */
(function () {
  'use strict';
  const { h, esc, $, $$ } = F;
  const G = F.git = { repos: null, repo: null, status: null, log: null, cmdLog: F.store.get('gitCmdLog', []), head: new Map() };

  const local = () => F.fs.mode === 'local' && F.state.engine && F.state.engine.workspace;
  const api = (method, path, params, body) => F.apiJson(method, 'git/' + path, Object.assign({ repo: G.repo || '' }, params || {}), body);

  // ───────────── adatok ─────────────
  G.refresh = F.debounce(async (full) => {
    if (!local()) { G.status = null; render(); return; }
    try {
      if (full || !G.repos) {
        G.repos = await F.apiJson('GET', 'git/repos');
        pickRepo();
      }
      if (G.repo == null) { G.status = { repo: false }; }
      else G.status = await api('GET', 'status');
      if (!$('#gitView').hidden) await loadLog();
    } catch (e) {
      G.status = { error: e.message };
    }
    render();
    badge();
    gutter();
    if (!$('#gitView').hidden) renderMap();
  }, 120);

  function pickRepo() {
    const r = G.repos;
    if (!r || !r.git) { G.repo = null; return; }
    if (r.root != null) { G.repo = ''; return; }
    if (!r.repos.length) { G.repo = null; return; }
    const a = F.state.active;
    const hit = a && r.repos.filter((x) => a.startsWith(x + '/')).sort((x, y) => y.length - x.length)[0];
    const saved = F.store.get('gitRepo:' + F.wsKey(), null);
    G.repo = hit || (r.repos.includes(saved) ? saved : r.repos[0]);
  }

  async function loadLog() {
    if (G.repo == null || !G.status || !G.status.repo) { G.log = null; return; }
    try { G.log = await api('GET', 'log'); } catch (e) { G.log = null; }
  }

  function badge() {
    const b = $('#gitBadge');
    const n = G.status && G.status.files ? G.status.files.length : 0;
    b.hidden = !n;
    b.textContent = n > 99 ? '99+' : String(n);
  }

  // ───────────── műveletek ─────────────
  const ERRORS = [
    [/Please tell me who you are|empty ident name|unable to auto-detect email/i, 'Még nem adtad meg a neved és az e-mail címed. A Git minden commithoz eltárolja, ki készítette.', 'identity'],
    [/'origin' does not appear to be a git repository|No configured push destination|no such remote/i, 'Még nincs távoli tároló (pl. GitHub) beállítva. Add meg a tároló címét, és utána már feltölthetsz.', 'remote'],
    [/rejected.*(fetch first|non-fast-forward)|Updates were rejected/is, 'A távoli tárolóban olyan változások vannak, amik nálad még nincsenek meg. Előbb töltsd le őket (Pull), utána fel tudsz tölteni.', 'pull'],
    [/Authentication failed|could not read Username|Permission denied \(publickey\)|terminal prompts disabled|403/i, 'A géped nincs bejelentkezve a GitHubra. Jelentkezz be egyszer a Terminálban (pl. a „gh auth login” paranccsal, vagy egy git push-sal, ami bekéri az adatokat), utána a FACET is tud feltölteni.', null],
    [/Could not resolve host|unable to access|Failed to connect/i, 'Nem érem el a távoli tárolót. Van internet? Jó a tároló címe?', null],
    [/CONFLICT|Automatic merge failed|unmerged files|you need to resolve your current index first/i, 'Ütközés: ugyanazt a részt itt is, ott is módosították. Nyisd meg a pirossal jelölt fájlokat, döntsd el, melyik változat maradjon (a <<<<<<< és >>>>>>> jelek közötti részek), töröld a jeleket, majd commitolj.', null],
    [/Your local changes to the following files would be overwritten/i, 'Mentetlen (nem commitolt) változásaid felülíródnának. Commitold őket, vagy tedd félre (Félretesz), és próbáld újra.', 'stash'],
    [/nothing to commit|no changes added to commit/i, 'Nincs mit commitolni: minden változás már el van mentve a tárolóba.', null],
    [/not a git repository/i, 'Ez a mappa nem git-tároló. Hozz létre egyet a Git panelen.', null],
    [/already exists/i, 'Ilyen nevű ág már létezik. Válassz másik nevet.', null],
    [/not fully merged/i, 'Ez az ág olyan munkát tartalmaz, ami még nincs beolvasztva. Előbb olvaszd be (merge), vagy hagyd meg.', null],
    [/There is no tracking information|no upstream/i, 'Ennek az ágnak még nincs párja a távoli tárolóban. Nyomd meg a Feltöltés (Push) gombot, az létrehozza.', null],
    [/does not have any commits yet|bad default revision|unknown revision/i, 'Még nincs egyetlen commit sem. Készítsd el az elsőt.', null]
  ];
  function explainGit(text) {
    for (const [re, msg, fix] of ERRORS) if (re.test(text)) return { msg, fix };
    return { msg: 'A Git hibát jelzett: <code>' + esc(text.trim().split('\n').filter((l) => !/^hint:/.test(l)).slice(0, 3).join(' ')) + '</code>', fix: null };
  }

  function logCmds(cmds) {
    if (!cmds || !cmds.length) return;
    G.cmdLog = cmds.map((c) => ({ c, t: Date.now() })).concat(G.cmdLog).slice(0, 12);
    F.store.set('gitCmdLog', G.cmdLog);
  }

  /** Git-művelet: a lefuttatott parancsot mindig megmutatja (így tanulható). */
  G.run = async (action, opts = {}) => {
    if (G.busy) return null;
    G.busy = action;
    render();
    let r;
    try {
      const params = { action };
      if (opts.paths) params.p = opts.paths;
      r = await api('POST', 'do', params, opts.body || '');
    } catch (e) {
      r = { ok: false, err: e.message, cmds: [] };
    }
    G.busy = null;
    logCmds(r.cmds);
    if (r.ok) {
      if (!opts.quiet) F.toast((opts.done || 'Kész') + (r.cmds && r.cmds.length ? ` · <code style="font-family:var(--font-code)">${esc(r.cmds.join(' && '))}</code>` : ''), 'ok');
      G.head.clear();
    } else {
      const ex = explainGit((r.err || '') + '\n' + (r.out || ''));
      showError(ex, r);
    }
    if (action === 'init') G.repos = null;
    G.refresh(action === 'init');
    if (['switch', 'branch', 'pull', 'merge', 'stashPop', 'stash', 'discard', 'clean'].includes(action)) reloadOpenFiles();
    return r;
  };

  async function showError(ex, r) {
    const actions = { identity: 'Név és e-mail megadása', remote: 'Távoli tároló beállítása', pull: 'Letöltés most (Pull)', stash: 'Félretesz (stash)' };
    const v = await F.dialog({
      title: 'Ez nem sikerült', icon: true, iconColor: 'var(--err)',
      text: ex.msg + (r.cmds && r.cmds.length ? `<br><br><span style="color:var(--muted)">Parancs: <code style="font-family:var(--font-code)">${esc(r.cmds.join(' && '))}</code></span>` : ''),
      ok: ex.fix ? actions[ex.fix] : 'Rendben', cancel: 'Bezárás'
    });
    if (!v || !ex.fix) return;
    if (ex.fix === 'identity') askIdentity();
    if (ex.fix === 'remote') askRemote();
    if (ex.fix === 'pull') G.run('pull', { done: 'Letöltve' });
    if (ex.fix === 'stash') G.run('stash', { done: 'Félretéve' });
  }

  async function askIdentity() {
    const v = await F.dialog({
      title: 'Ki vagy?', icon: true,
      text: 'A Git minden commithoz eltárolja a készítő nevét és e-mail címét. Ezt csak egyszer kell megadni ezen a gépen. Ha GitHubot használsz, a GitHub-fiókod e-mail címét add meg.',
      fields: [{ id: 'name', label: 'Név', placeholder: 'pl. Bodori Bence' }, { id: 'mail', label: 'E-mail', placeholder: 'pl. nev@example.com' }],
      ok: 'Mentés', validate: (x) => (!x.name ? 'Add meg a neved.' : !/@/.test(x.mail) ? 'Adj meg egy érvényes e-mail címet.' : null)
    });
    if (!v) return false;
    try { await F.apiJson('POST', 'git/identity', {}, v.name + '\n' + v.mail); } catch (e) { F.toast(esc(e.message), 'err'); return false; }
    logCmds([`git config --global user.name "${v.name}"`, `git config --global user.email ${v.mail}`]);
    G.repos = null;
    G.refresh(true);
    F.toast('Elmentve. Mostantól ezzel a névvel commitolsz.', 'ok');
    return true;
  }

  async function askRemote() {
    const v = await F.dialog({
      title: 'Távoli tároló (GitHub)', icon: true,
      text: 'Másold be a tároló címét. GitHubon a tároló oldalán a zöld <b>Code</b> gomb alatt találod (HTTPS).',
      fields: [{ id: 'url', label: 'Cím', placeholder: 'https://github.com/felhasznalo/projekt.git' }],
      ok: 'Beállítás', validate: (x) => (/^(https?:\/\/|git@)\S+$/.test(x.url) ? null : 'Adj meg egy https://… vagy git@… kezdetű címet.')
    });
    if (!v) return;
    await G.run('remote', { body: v.url, done: 'Távoli tároló beállítva' });
  }

  async function newBranch() {
    const v = await F.dialog({
      title: 'Új ág', icon: true,
      text: 'Az ág egy külön „munkavonal”: kipróbálhatsz rajta valamit anélkül, hogy a fő ágat (main) elrontanád. A mostani állapotból indul, és rögtön át is váltasz rá.',
      fields: [{ id: 'n', label: 'Az ág neve', placeholder: 'pl. uj-menu vagy task-08' }],
      ok: 'Létrehozás', validate: (x) => (/^[A-Za-z0-9._\/-]+$/.test(x.n) && !x.n.startsWith('-') ? null : 'Csak ékezet nélküli betű, szám, valamint - _ / . jel lehet benne, szóköz nélkül.')
    });
    if (v) G.run('branch', { body: v.n, done: `Új ág: ${esc(v.n)}` });
  }

  async function mergeBranch() {
    const cur = G.status && G.status.branch;
    await loadLog();
    const list = (G.log && G.log.branches || []).filter((b) => !b.cur).map((b) => ({ value: b.n, label: b.n }));
    if (!list.length) return F.toast('Nincs másik ág, amit be lehetne olvasztani.');
    const v = await F.dialog({
      title: 'Ág beolvasztása (merge)', icon: true,
      text: `A kiválasztott ág változásai bekerülnek ide: <b>${esc(cur)}</b>.`,
      fields: [{ id: 'b', label: 'Melyik ágat?', type: 'select', value: list[0].value, options: list }],
      ok: 'Beolvasztás'
    });
    if (v) G.run('merge', { body: v.b, done: `${esc(v.b)} beolvasztva ide: ${esc(cur)}` });
  }

  async function reloadOpenFiles() {
    for (const p of [...F.state.open]) {
      const d = F.state.docs.get(p);
      if (!d || d.custom || F.dirty(p)) continue;
      try {
        const t = await F.fs.read(p);
        if (t !== d.model.getValue()) { d.model.setValue(t); F.markClean(p); }
      } catch (e) {
        F.markClean(p);
        await F.closeFile(p);
      }
    }
    F.refreshTree();
  }

  // ───────────── panel ─────────────
  const STAT = {
    M: { t: 'M', c: '#7FB4FF', l: 'módosult' }, A: { t: 'A', c: '#4ADE80', l: 'új (hozzáadva)' }, D: { t: 'D', c: '#FF7A85', l: 'törölve' },
    R: { t: 'R', c: '#C792EA', l: 'átnevezve' }, C: { t: 'C', c: '#C792EA', l: 'másolva' }, '?': { t: 'U', c: '#4ADE80', l: 'új, még nem követett' },
    U: { t: '!', c: '#FF7A85', l: 'ütközés' }
  };

  function split(files) {
    const staged = [], changes = [], conflicts = [];
    (files || []).forEach((f) => {
      if (f.x === 'U' || f.y === 'U' || (f.x === 'A' && f.y === 'A') || (f.x === 'D' && f.y === 'D')) { conflicts.push(f); return; }
      if (f.x !== ' ' && f.x !== '?') staged.push({ p: f.p, s: f.x, from: f.from });
      if (f.y !== ' ') changes.push({ p: f.p, s: f.y === '?' ? '?' : f.y });
    });
    return { staged, changes, conflicts };
  }

  /** „Hol tartok?” — a következő lépés egy mondatban. */
  function nextStep(st) {
    if (!st || !st.repo) return null;
    const { staged, changes, conflicts } = split(st.files);
    if (conflicts.length) return { t: `${conflicts.length} fájlban ütközés van. Nyisd meg, válaszd ki a megtartandó változatot, majd commitolj.`, area: 1 };
    if (st.noCommits && !staged.length && !changes.length) return { t: 'Üres tároló. Hozz létre vagy módosíts egy fájlt, és készítsd el az első commitot.', area: 0 };
    if (staged.length) return { t: `${staged.length} fájl előkészítve. Írj egy rövid üzenetet arról, mit csináltál, és nyomd meg a Commit gombot.`, area: 1 };
    if (changes.length) return { t: `${changes.length} fájl változott. Add hozzá őket a commithoz (+), vagy írj üzenetet, és a „Mindent commitolok” egy lépésben elintézi.`, area: 0 };
    if (st.behind) return { t: `A távoli tárolóban ${st.behind} újabb commit van. Töltsd le őket (Pull).`, area: 3 };
    if (st.ahead) return { t: `${st.ahead} commit vár feltöltésre. Nyomd meg a Feltöltés (Push) gombot.`, area: 2 };
    if (!st.remotes.length && !st.noCommits) return { t: 'Minden el van mentve helyben. Ha GitHubra is feltöltenéd, állíts be egy távoli tárolót.', area: 2, remote: true };
    if (!st.upstream && st.remotes.length && !st.noCommits) return { t: 'Ez az ág még nincs feltöltve. Nyomd meg a Feltöltés (Push) gombot.', area: 2 };
    return { t: 'Minden mentve és szinkronban. Szép munka!', area: -1 };
  }
  G.nextStep = nextStep;

  const svgI = {
    up: '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 10 V2 M2.5 5.5 L6 2 L9.5 5.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
    down: '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 2 V10 M2.5 6.5 L6 10 L9.5 6.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
    sync: '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M10 5 A4 4 0 0 0 2.6 3.4 M2 7 A4 4 0 0 0 9.4 8.6 M2.4 1.5 V3.6 H4.5 M9.6 10.5 V8.4 H7.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
    plus: '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 2 V10 M2 6 H10" stroke="currentColor" stroke-width="1.4"/></svg>',
    minus: '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6 H10" stroke="currentColor" stroke-width="1.4"/></svg>',
    undo: '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 5 H8 A2.5 2.5 0 0 1 8 10 H5 M5 2.5 L2.5 5 L5 7.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
    branch: '<svg width="13" height="13" viewBox="0 0 18 18"><circle cx="5" cy="4" r="1.8" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="5" cy="14" r="1.8" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="13" cy="7" r="1.8" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5 5.8 V12.2 M13 8.8 C13 11 9 11 6.4 12.6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'
  };

  function render() {
    const box = $('#gitPanel');
    if (!box || $('#view-git').hidden) return;
    box.innerHTML = '';
    const eng = F.state.engine;
    if (F.fs.mode !== 'local') { box.append(h('div', { class: 'hp-empty', text: 'A Git a helyi FACET motorral működik.' })); return; }
    if (!eng || !eng.workspace) { box.append(h('div', { class: 'hp-empty', text: 'Nyiss meg egy mappát, és itt látod a Git-állapotát.' })); return; }
    if (G.repos && !G.repos.git) {
      const os = (eng.os || '').toLowerCase();
      box.append(h('div', { class: 'git-help' },
        h('b', { text: 'A Git nincs telepítve ezen a gépen.' }),
        h('span', { html: os.includes('mac') ? 'Nyisd meg a Terminált, és futtasd: <code>xcode-select --install</code> — ez feltelepíti a Gitet. Utána indítsd újra a FACET-et.'
          : os.includes('win') ? 'Töltsd le innen: <b>git-scm.com</b> (Git for Windows), telepítsd, majd indítsd újra a FACET-et.'
          : 'Telepítsd a csomagkezelővel, pl.: <code>sudo apt install git</code>, majd indítsd újra a FACET-et.' }),
        h('button', { class: 'btn', onclick: async () => { await F.apiJson('GET', 'tools'); G.refresh(true); } }, 'Újra ellenőrzöm')));
      return;
    }
    const st = G.status;
    if (!st || !G.repos) { box.append(h('div', { class: 'hp-empty', text: 'Betöltés…' })); return; }

    // tárolóválasztó
    if (G.repos.root == null && G.repos.repos.length > 1) {
      const sel = h('select', { class: 'field', id: 'gitRepoSel', 'aria-label': 'Tároló' }, G.repos.repos.map((r) => h('option', { value: r, selected: r === G.repo }, r)));
      sel.onchange = () => { G.repo = sel.value; F.store.set('gitRepo:' + F.wsKey(), G.repo); G.head.clear(); G.refresh(); };
      box.append(h('label', { class: 'set-row', for: 'gitRepoSel' }, h('span', { class: 'set-note', text: 'Tároló ebben a mappában' }), sel));
    }

    if (!st.repo) {
      box.append(h('div', { class: 'git-help' },
        h('b', { text: 'Ez a mappa még nincs verziókezelés alatt.' }),
        h('span', { text: 'A Git minden „commit” pillanatában elmenti a projekted állapotát. Bármikor visszaléphetsz, ágakon kísérletezhetsz, és feltöltheted GitHubra.' }),
        h('button', { class: 'btn accent', onclick: () => G.run('init', { done: 'Git-tároló létrehozva' }) }, 'Git-tároló létrehozása'),
        h('span', { class: 'set-note', html: 'Ez ezt futtatja: <code>git init</code>' })));
      box.append(cheatsheetButton());
      return;
    }
    if (st.error) { box.append(h('div', { class: 'hp-empty', text: st.error })); return; }

    const { staged, changes, conflicts } = split(st.files);
    // ág + szinkron
    const brBtn = h('button', { class: 'git-branch', title: 'Ág váltása vagy új ág', onclick: (e) => branchMenu(e) }, h('span', { html: svgI.branch }), h('span', { class: 'nm', text: st.detached ? 'leválasztott HEAD' : st.branch || '—' }), h('span', { html: '<svg width="9" height="9" viewBox="0 0 10 10"><path d="M2 3.5 L5 6.5 L8 3.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>' }));
    const sync = h('span', { class: 'git-sync' });
    if (st.remotes.length) {
      sync.append(
        h('button', { class: 'icon-btn', title: 'Frissítés a távoli tárolóból (fetch)', disabled: !!G.busy, onclick: () => G.run('fetch', { done: 'Lekérve' }), html: svgI.sync }),
        h('button', { class: 'git-pill' + (st.behind ? ' on' : ''), title: 'Letöltés (pull)', disabled: !!G.busy, onclick: () => G.run('pull', { done: 'Letöltve' }) }, h('span', { html: svgI.down }), String(st.behind || 0)),
        h('button', { class: 'git-pill' + (st.ahead || (!st.upstream && !st.noCommits) ? ' on' : ''), title: 'Feltöltés (push)', disabled: !!G.busy, onclick: () => G.run('push', { done: 'Feltöltve' }) }, h('span', { html: svgI.up }), String(st.ahead || 0)));
    } else {
      sync.append(h('button', { class: 'btn', style: { padding: '4px 8px', fontSize: '11.5px' }, onclick: askRemote }, '+ GitHub'));
    }
    box.append(h('div', { class: 'git-top' }, brBtn, sync));

    // következő lépés
    const ns = nextStep(st);
    if (ns) {
      const dots = h('span', { class: 'git-dots', title: 'Munkamappa → Előkészítve → Helyi tároló → Távoli tároló' });
      ['Munkamappa', 'Előkészítve', 'Helyi', 'Távoli'].forEach((n, i) => dots.append(h('span', { class: i === ns.area ? 'on' : '', title: n })));
      box.append(h('div', { class: 'git-next' + (ns.area < 0 ? ' done' : '') }, h('div', { class: 'git-next-h' }, h('b', { text: 'Hol tartok?' }), dots), h('span', { text: ns.t }),
        ns.remote ? h('button', { class: 'btn', style: { alignSelf: 'flex-start' }, onclick: askRemote }, 'Távoli tároló beállítása') : null));
    }

    // commit
    if (staged.length || changes.length || st.noCommits) {
      const ta = h('textarea', { class: 'field git-msg', id: 'gitMsg', rows: 2, placeholder: staged.length ? 'Mit csináltál? pl. „Diák osztály getterei”' : 'Üzenet, pl. „Első verzió”', spellcheck: 'false', 'aria-label': 'Commit-üzenet' });
      ta.value = G.draft || '';
      ta.oninput = () => { G.draft = ta.value; };
      const doCommit = async () => {
        const msg = ta.value.trim();
        if (!msg) { ta.focus(); F.toast('Írj egy rövid üzenetet arról, mit változtattál.', 'warn'); return; }
        if (!G.repos.identity && !(await askIdentity())) return;
        const r = await G.run(staged.length ? 'commit' : 'commitAll', { body: msg, done: 'Commit kész' });
        if (r && r.ok) G.draft = '';
      };
      ta.onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); doCommit(); } };
      const btn = h('button', { class: 'btn accent git-commit', disabled: !!G.busy || (!staged.length && !changes.length), onclick: doCommit },
        G.busy === 'commit' || G.busy === 'commitAll' ? 'Mentés…' : staged.length ? `Commit (${staged.length} fájl)` : 'Mindent commitolok');
      box.append(h('div', { class: 'git-commitbox' }, ta, btn, h('span', { class: 'set-note', text: (F.isMac ? '⌘' : 'Ctrl+') + 'Enter is commitol' })));
    }

    if (conflicts.length) box.append(section('Ütközések', conflicts.map((f) => ({ p: f.p, s: 'U' })), 'conflict'));
    if (staged.length) box.append(section('Előkészítve', staged, 'staged'));
    if (changes.length) box.append(section('Változások', changes, 'changes'));
    if (!staged.length && !changes.length && !conflicts.length) box.append(h('div', { class: 'git-clean', text: 'Nincs mentetlen változás.' }));

    // eszközök
    box.append(h('div', { class: 'git-tools' },
      h('button', { class: 'btn', onclick: () => G.openMap() }, 'Git-térkép megnyitása'),
      h('button', { class: 'icon-btn', title: 'További műveletek', onclick: (e) => moreMenu(e), html: '<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="3" cy="7" r="1.2" fill="currentColor"/><circle cx="7" cy="7" r="1.2" fill="currentColor"/><circle cx="11" cy="7" r="1.2" fill="currentColor"/></svg>' })));

    if (G.cmdLog.length) {
      box.append(h('div', { class: 'git-log' }, h('span', { class: 'eyebrow', text: 'Lefuttatott parancsok' }),
        G.cmdLog.slice(0, 5).map((c) => h('code', { title: new Date(c.t).toLocaleTimeString('hu-HU'), text: c.c }))));
    }
  }
  G.render = render;

  function section(title, list, kind) {
    const wrap = h('div', { class: 'git-sec' });
    const head = h('div', { class: 'git-sec-h' }, h('span', { class: 'eyebrow', text: `${title} · ${list.length}` }));
    if (kind === 'staged') head.append(h('button', { class: 'icon-btn', title: 'Mindet vissza a változások közé (git restore --staged)', onclick: () => G.run('unstageAll', { quiet: true }), html: svgI.minus }));
    if (kind === 'changes') head.append(h('button', { class: 'icon-btn', title: 'Mindet előkészít (git add -A)', onclick: () => G.run('stageAll', { quiet: true }), html: svgI.plus }));
    wrap.append(head);
    list.slice(0, 300).forEach((f) => {
      const s = STAT[f.s] || STAT.M;
      const name = f.p.split('/').pop(), dir = f.p.split('/').slice(0, -1).join('/');
      const acts = h('span', { class: 'git-acts' });
      if (kind === 'staged') acts.append(h('button', { class: 'icon-btn', title: 'Vissza (unstage)', onclick: (e) => { e.stopPropagation(); G.run('unstage', { paths: [f.p], quiet: true }); }, html: svgI.minus }));
      if (kind === 'changes' || kind === 'conflict') {
        if (kind === 'changes') acts.append(h('button', { class: 'icon-btn', title: f.s === '?' ? 'Új fájl törlése' : 'Változás elvetése', onclick: (e) => { e.stopPropagation(); discard(f); }, html: svgI.undo }));
        acts.append(h('button', { class: 'icon-btn', title: 'Előkészít (git add)', onclick: (e) => { e.stopPropagation(); G.run('stage', { paths: [f.p], quiet: true }); }, html: svgI.plus }));
      }
      wrap.append(h('div', { class: 'git-file', title: `${f.p} — ${s.l}`, onclick: () => showDiff(f) },
        h('span', { class: 'git-st', style: { color: s.c }, text: s.t }),
        h('span', { class: 'nm', style: f.s === 'D' ? { textDecoration: 'line-through', color: 'var(--muted)' } : null, text: name }),
        dir ? h('span', { class: 'dir', text: dir }) : null, acts));
    });
    if (list.length > 300) wrap.append(h('div', { class: 'set-note', text: `+${list.length - 300} további fájl` }));
    return wrap;
  }

  async function discard(f) {
    const isNew = f.s === '?';
    const ok = await F.confirm(isNew ? 'Új fájl törlése' : 'Változás elvetése',
      isNew ? `A(z) <b>${esc(f.p)}</b> még nincs a Gitben. Végleg törlöd?` : `A(z) <b>${esc(f.p)}</b> visszaáll az utolsó commit állapotára. Az azóta írt változások elvesznek.<br><span style="color:var(--muted)">Ha nem vagy biztos benne, az Időgépben a FACET pillanatképei még megvannak.</span>`,
      isNew ? 'Törlés' : 'Elvetés', true);
    if (!ok) return;
    const d = F.state.docs.get(f.p);
    if (d) F.markClean(f.p);
    await G.run(isNew ? 'clean' : 'discard', { paths: [f.p], done: isNew ? 'Törölve' : 'Visszaállítva' });
  }

  async function headText(p) {
    if (G.head.has(p)) return G.head.get(p);
    const r = await F.api('GET', 'git/show', { repo: G.repo || '', path: p, ref: 'HEAD' });
    const t = r.status === 200 ? await r.text() : null;
    G.head.set(p, t);
    return t;
  }

  async function showDiff(f) {
    const orig = await headText(f.p);
    if (f.s === 'D') {
      F.openCompare({ original: orig || '', modified: '', noOpen: true, lang: langOf(f.p), title: `<b>Git</b> · ${esc(f.p)} · törölve (bal: utolsó commit)` });
      return;
    }
    if (F.isImage(f.p) || /\.(docx|pdf|zip|jar|class|png|jpg)$/i.test(f.p)) { F.open(f.p); return; }
    await F.openCompare({
      path: f.p, original: orig || '',
      title: `<b>Git</b> · ${esc(f.p.split('/').pop())} · bal oldalt: utolsó commit${orig == null ? ' (a fájl új)' : ''}, jobb oldalt: jelenlegi`,
      actions: [
        { label: '+ Előkészít', run: () => { G.run('stage', { paths: [f.p], quiet: true }); F.closeDiff(); } },
        { label: 'Bezárás', run: () => F.closeDiff() }
      ]
    });
  }
  const langOf = (p) => { const d = F.facets[F.facetFor(p)]; return d.langFor ? d.langFor(p) : d.lang; };

  async function branchMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    await loadLog();
    const br = (G.log && G.log.branches) || [];
    const remotes = (G.status && G.status.remotes) || [];
    const isRemote = (n) => remotes.some((rm) => n.startsWith(rm + '/'));
    const local = br.filter((b) => !isRemote(b.n));
    const localNames = new Set(local.map((b) => b.n));
    const remoteOnly = br.filter((b) => isRemote(b.n) && !localNames.has(b.n.split('/').slice(1).join('/')));
    const items = local.map((b) => ({ label: (b.cur ? '● ' : '    ') + b.n, run: () => { if (!b.cur) G.run('switch', { body: b.n, done: 'Átváltva: ' + esc(b.n) }); } }));
    if (remoteOnly.length) { items.push('-'); remoteOnly.slice(0, 10).forEach((b) => items.push({ label: '↓ ' + b.n, run: () => G.run('switch', { body: b.n, done: 'Átváltva: ' + esc(b.n) }) })); }
    items.push('-', { label: 'Új ág…', run: newBranch }, { label: 'Ág beolvasztása ide…', run: mergeBranch });
    F.menu(r.left, r.bottom + 4, items);
  }

  function moreMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const st = G.status || {};
    F.menu(r.left - 120, r.bottom + 4, [
      { label: 'Új ág…', run: newBranch },
      { label: 'Ág beolvasztása ide…', run: mergeBranch },
      '-',
      { label: 'Munka félretétele (stash)', run: () => G.run('stash', { done: 'Félretéve' }) },
      { label: `Félretett munka vissza${st.stash ? ` (${st.stash})` : ''}`, run: () => G.run('stashPop', { done: 'Visszavéve' }) },
      { label: 'Utolsó commit kiegészítése', run: () => G.run('amend', { done: 'Kiegészítve' }) },
      '-',
      { label: st.remotes && st.remotes.length ? 'Távoli tároló módosítása…' : 'Távoli tároló (GitHub) beállítása…', run: askRemote },
      { label: 'Név és e-mail…', run: askIdentity },
      '-',
      { label: 'Git kisokos', run: () => G.openMap('kisokos') }
    ]);
  }

  function cheatsheetButton() {
    return h('button', { class: 'btn', style: { marginTop: '12px' }, onclick: () => G.openMap('kisokos') }, 'Git kisokos — mi micsoda?');
  }

  // ───────────── Git-térkép (középső nézet) ─────────────
  G.openMap = async (focus) => {
    const v = $('#gitView');
    v.hidden = false;
    v.innerHTML = '<div class="pv-empty">Betöltés…</div>';
    if (G.status && G.status.repo) await loadLog();
    renderMap();
    if (focus === 'kisokos') { const k = $('#gitKisokos'); if (k) k.scrollIntoView({ block: 'start' }); }
  };
  G.closeMap = () => { $('#gitView').hidden = true; if (F.editor && F.hasCode()) F.editor.focus(); };

  function renderMap() {
    const v = $('#gitView');
    if (v.hidden) return;
    const st = G.status || {};
    v.innerHTML = '';
    const head = h('div', { class: 'gv-head' },
      h('span', { class: 'gv-title', html: `${svgI.branch} <b>Git-térkép</b>` }),
      st.repo ? h('span', { class: 'gv-sub', text: (G.repo ? G.repo + ' · ' : '') + (st.branch || '') }) : null,
      h('span', { style: { flex: 1 } }),
      h('button', { class: 'btn', onclick: () => G.closeMap() }, 'Bezárás ', h('span', { class: 'kbd', text: 'Esc' })));
    v.append(head);
    const body = h('div', { class: 'gv-body' });
    v.append(body);
    if (!st.repo) {
      body.append(h('div', { class: 'git-help', style: { maxWidth: '520px' } }, h('b', { text: 'Ez a mappa még nem git-tároló.' }), h('span', { text: 'Hozd létre a Git panelen, és itt látod majd a projekted történetét.' })));
      body.append(kisokos());
      return;
    }
    body.append(areas(st));
    const grid = h('div', { class: 'gv-grid' });
    grid.append(graph());
    grid.append(branchList());
    body.append(grid);
    body.append(kisokos());
  }

  /** A négy terület: hol van most a munkád, és melyik parancs viszi tovább. */
  function areas(st) {
    const { staged, changes } = split(st.files);
    const ns = nextStep(st) || { area: -1 };
    const commits = G.log ? G.log.commits.length : 0;
    const box = (i, title, big, sub, cls) => h('div', { class: 'ga-box' + (ns.area === i ? ' on' : '') + (cls ? ' ' + cls : '') },
      h('span', { class: 'ga-k', text: title }), h('b', { text: big }), h('span', { class: 'ga-s', text: sub }));
    const arrow = (cmd, label, run, back) => h('button', { class: 'ga-arrow' + (back ? ' back' : ''), title: label, onclick: run },
      h('code', { text: cmd }), h('span', { html: back ? '<svg width="46" height="10" viewBox="0 0 46 10"><path d="M45 5 H2 M6 1 L2 5 L6 9" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>' : '<svg width="46" height="10" viewBox="0 0 46 10"><path d="M1 5 H44 M40 1 L44 5 L40 9" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>' }));
    const remoteName = st.upstream ? st.upstream.split('/')[0] : (st.remotes[0] || 'nincs beállítva');
    const row = h('div', { class: 'ga-row' },
      box(0, 'Munkamappa', String(changes.length), changes.length ? 'változott fájl' : 'nincs változás'),
      arrow('git add', 'Előkészítés: mindent hozzáad', () => G.run('stageAll', { quiet: true })),
      box(1, 'Előkészítve', String(staged.length), 'a következő commitba kerül'),
      arrow('git commit', 'Commit: a Git panelen írd meg az üzenetet', () => { G.closeMap(); F.setView('git'); setTimeout(() => { const t = $('#gitMsg'); if (t) t.focus(); }, 50); }),
      box(2, 'Helyi tároló', st.noCommits ? '0' : String(commits) + (commits >= 300 ? '+' : ''), st.noCommits ? 'még nincs commit' : `commit · ${st.branch}`),
      h('div', { class: 'ga-pair' },
        arrow('git push', 'Feltöltés', () => G.run('push', { done: 'Feltöltve' })),
        arrow('git pull', 'Letöltés', () => G.run('pull', { done: 'Letöltve' }), true)),
      box(3, 'Távoli tároló', st.remotes.length ? (st.ahead || st.behind ? `↑${st.ahead} ↓${st.behind}` : st.upstream ? '✓' : '—') : '—', remoteName, st.remotes.length ? '' : 'off'));
    return h('section', { class: 'ga' }, h('div', { class: 'ga-h' }, h('b', { text: 'Hol tartok?' }), h('span', { text: ns.t || '' })), row,
      h('div', { class: 'ga-foot', text: 'A munkád balról jobbra halad: a módosított fájlokat előkészíted (add), elmented egy pillanatképbe (commit), majd feltöltöd (push). A nyilakra kattintva le is futtathatod a lépést.' }));
  }

  // commit-gráf
  const LANE = ['#FF8A3D', '#4DA3FF', '#4ADE80', '#C792EA', '#F5C451', '#FF5C7A', '#5CD6E8', '#E6D3B3'];
  function layout(commits) {
    const lanes = [];
    const rows = [];
    const fresh = new Set();
    let maxLane = 0;
    commits.forEach((c, r) => {
      const parents = c.p ? c.p.split(' ').filter(Boolean) : [];
      const incoming = [];
      let L = lanes.indexOf(c.h);
      const conv = [];
      lanes.forEach((hsh, i) => { if (hsh === c.h) conv.push(i); });
      if (L < 0) { L = lanes.indexOf(null); if (L < 0) { L = lanes.length; lanes.push(null); } }
      lanes.forEach((hsh, i) => {
        if (hsh == null || fresh.has(i)) return;
        if (hsh === c.h) incoming.push([i, L]);
        else incoming.push([i, i]);
      });
      fresh.clear();
      conv.forEach((i) => { if (i !== L) lanes[i] = null; });
      lanes[L] = parents[0] || null;
      const outgoing = [];
      parents.slice(1).forEach((p) => {
        let k = lanes.indexOf(p);
        if (k < 0) { k = lanes.indexOf(null); if (k < 0) { k = lanes.length; lanes.push(null); } lanes[k] = p; fresh.add(k); }
        outgoing.push([L, k]);
      });
      while (lanes.length && lanes[lanes.length - 1] == null) lanes.pop();
      maxLane = Math.max(maxLane, L, ...incoming.map((e) => Math.max(e[0], e[1])), ...outgoing.map((e) => e[1]));
      rows.push({ c, L, incoming, outgoing, merge: parents.length > 1 });
    });
    return { rows, maxLane };
  }

  const ago = (t) => {
    const s = Math.floor(Date.now() / 1000 - t);
    if (s < 60) return 'most';
    if (s < 3600) return Math.floor(s / 60) + ' perce';
    if (s < 86400) return Math.floor(s / 3600) + ' órája';
    if (s < 172800) return 'tegnap';
    if (s < 30 * 86400) return Math.floor(s / 86400) + ' napja';
    return new Date(t * 1000).toLocaleDateString('hu-HU', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  function graph() {
    const wrap = h('section', { class: 'gg' }, h('div', { class: 'gg-h' }, h('b', { text: 'Történet' }), h('span', { class: 'set-note', text: 'Minden pont egy commit (pillanatkép). Az elágazó vonalak az ágak.' })));
    const commits = (G.log && G.log.commits) || [];
    if (!commits.length) { wrap.append(h('div', { class: 'hp-empty', text: 'Még nincs commit. Készítsd el az elsőt a Git panelen.' })); return wrap; }
    const { rows, maxLane } = layout(commits);
    const RH = 30, LW = 16, PAD = 12;
    const gw = PAD * 2 + maxLane * LW + 4;
    const list = h('div', { class: 'gg-list', style: { '--gw': gw + 'px' } });
    const X = (l) => PAD + l * LW, Y = (r) => r * RH + RH / 2;
    let paths = '';
    rows.forEach((row, r) => {
      row.incoming.forEach(([a, b]) => {
        const col = LANE[b % LANE.length];
        if (a === b) paths += `<path d="M${X(a)} ${Y(r - 1)} L${X(b)} ${Y(r)}" stroke="${col}"/>`;
        else paths += `<path d="M${X(a)} ${Y(r - 1)} C${X(a)} ${Y(r) - 8}, ${X(b)} ${Y(r - 1) + 8}, ${X(b)} ${Y(r)}" stroke="${LANE[a % LANE.length]}"/>`;
      });
      row.outgoing.forEach(([a, b]) => { paths += `<path d="M${X(a)} ${Y(r)} C${X(a)} ${Y(r) + 14}, ${X(b)} ${Y(r + 1) - 14}, ${X(b)} ${Y(r + 1)}" stroke="${LANE[b % LANE.length]}"/>`; });
    });
    let dots = '';
    rows.forEach((row, r) => {
      const col = LANE[row.L % LANE.length];
      const isHead = /HEAD/.test(row.c.d);
      dots += isHead ? `<circle cx="${X(row.L)}" cy="${Y(r)}" r="6" fill="#0C0F14" stroke="${col}" stroke-width="2.5"/><circle cx="${X(row.L)}" cy="${Y(r)}" r="2.5" fill="${col}"/>`
        : `<circle cx="${X(row.L)}" cy="${Y(r)}" r="${row.merge ? 3.5 : 4.5}" fill="${row.merge ? '#0C0F14' : col}" stroke="${col}" stroke-width="2"/>`;
    });
    const svg = `<svg class="gg-svg" width="${gw}" height="${rows.length * RH}" viewBox="0 0 ${gw} ${rows.length * RH}" aria-hidden="true"><g fill="none" stroke-width="2" stroke-linecap="round">${paths}</g>${dots}</svg>`;
    list.innerHTML = svg;
    rows.forEach((row) => {
      const refs = h('span', { class: 'gg-refs' });
      (row.c.d || '').split(',').map((x) => x.trim()).filter(Boolean).forEach((ref) => {
        if (ref === 'HEAD') return;
        let cls = 'ref', t = ref;
        if (ref.startsWith('HEAD -> ')) { cls = 'ref head'; t = ref.slice(8); }
        else if (ref.startsWith('tag: ')) { cls = 'ref tag'; t = ref.slice(5); }
        else if ((G.status.remotes || []).some((rm) => ref.startsWith(rm + '/'))) cls = 'ref remote';
        refs.append(h('span', { class: cls, text: t }));
      });
      list.append(h('div', { class: 'gg-row', title: row.c.h + '\nKattints: a hash a vágólapra kerül', onclick: () => { if (navigator.clipboard) navigator.clipboard.writeText(row.c.h).then(() => F.toast('Commit azonosító a vágólapon: ' + row.c.h.slice(0, 8))).catch(() => {}); } },
        refs, h('span', { class: 'gg-msg', text: row.c.s }), h('span', { class: 'gg-meta', text: row.c.a + ' · ' + ago(row.c.t) }), h('code', { class: 'gg-hash', text: row.c.h.slice(0, 7) })));
    });
    wrap.append(list);
    if (commits.length >= 300) wrap.append(h('div', { class: 'set-note', text: 'Az utolsó 300 commit látszik.' }));
    return wrap;
  }

  function branchList() {
    const br = (G.log && G.log.branches) || [];
    const wrap = h('section', { class: 'gb' }, h('div', { class: 'gg-h' }, h('b', { text: 'Ágak' })));
    br.forEach((b) => wrap.append(h('button', { class: 'gb-row' + (b.cur ? ' cur' : ''), title: b.cur ? 'Ezen az ágon dolgozol' : 'Átváltás erre az ágra', onclick: () => { if (!b.cur) G.run('switch', { body: b.n, done: 'Átváltva: ' + esc(b.n) }); } },
      h('span', { html: svgI.branch }), h('span', { class: 'nm', text: b.n }), b.cur ? h('span', { class: 'gb-cur', text: 'jelenlegi' }) : null)));
    wrap.append(h('div', { class: 'gb-acts' }, h('button', { class: 'btn', onclick: newBranch }, '+ Új ág'), h('button', { class: 'btn', onclick: mergeBranch }, 'Beolvasztás…')));
    return wrap;
  }

  const KISOKOS = [
    ['Commit', 'Egy elmentett pillanatkép a projektedről, rövid üzenettel. Bármikor visszanézheted vagy visszaállíthatod.', 'git commit -m "üzenet"'],
    ['Előkészítés (stage)', 'Kiválasztod, mely változások kerüljenek a következő commitba. Így egy commitba csak az összetartozó változások kerülnek.', 'git add Fajl.java'],
    ['Ág (branch)', 'Egy külön munkavonal. Kipróbálhatsz rajta egy ötletet, és ha jó, beolvasztod a fő ágba (main).', 'git switch -c uj-ag'],
    ['Beolvasztás (merge)', 'Egy másik ág változásait átveszed a jelenlegi ágadba.', 'git merge masik-ag'],
    ['Feltöltés (push)', 'A helyi commitjaidat feltölti a távoli tárolóba (pl. GitHubra), hogy mások is lássák, és ne vesszenek el.', 'git push'],
    ['Letöltés (pull)', 'Letölti és beépíti a távoli tároló újdonságait. Csapatmunkánál munka előtt mindig érdemes.', 'git pull'],
    ['Félretétel (stash)', 'A még nem commitolt változásokat ideiglenesen félreteszi, hogy tiszta lappal válthass ágat.', 'git stash'],
    ['.gitignore', 'Egy fájl, amiben felsorolod, mit ne kövessen a Git (pl. out/, .class, node_modules/).', 'out/\n*.class'],
    ['Ütközés (conflict)', 'Ugyanazt a sort két helyen is módosították. A <<<<<<< és >>>>>>> jelek között választod ki, melyik maradjon.', '<<<<<<< HEAD … >>>>>>>']
  ];
  function kisokos() {
    return h('section', { class: 'gk', id: 'gitKisokos' }, h('div', { class: 'gg-h' }, h('b', { text: 'Git kisokos' }), h('span', { class: 'set-note', text: 'A legfontosabb fogalmak, egyszerűen' })),
      h('div', { class: 'gk-grid' }, KISOKOS.map(([t, d, c]) => h('div', { class: 'gk-card' }, h('b', { text: t }), h('span', { text: d }), h('code', { text: c })))));
  }

  // ───────────── változott sorok a szerkesztő szélén ─────────────
  /** Soronkénti különbség (Myers). Eredmény: hozzáadott / módosított / törölt sorok a jelenlegi szövegben. */
  function lineMarks(a, b) {
    const N = a.length, M = b.length;
    if (N + M > 20000) return null;
    const max = N + M, V = new Int32Array(2 * max + 2), trace = [];
    let D = -1;
    outer: for (let d = 0; d <= max; d++) {
      trace.push(V.slice());
      if (d > 2000) return null;
      for (let k = -d; k <= d; k += 2) {
        let x = (k === -d || (k !== d && V[max + k - 1] < V[max + k + 1])) ? V[max + k + 1] : V[max + k - 1] + 1;
        let y = x - k;
        while (x < N && y < M && a[x] === b[y]) { x++; y++; }
        V[max + k] = x;
        if (x >= N && y >= M) { D = d; break outer; }
      }
    }
    const ins = [], del = [];
    let x = N, y = M;
    for (let d = D; d > 0; d--) {
      const Vd = trace[d], k = x - y;
      const pk = (k === -d || (k !== d && Vd[max + k - 1] < Vd[max + k + 1])) ? k + 1 : k - 1;
      const px = Vd[max + pk], py = px - pk;
      while (x > px && y > py) { x--; y--; }
      if (x === px) ins.push(y - 1); else del.push(y);
      x = px; y = py;
    }
    ins.sort((p, q) => p - q);
    const out = [], usedDel = new Set();
    for (let i = 0; i < ins.length;) {
      let j = i;
      while (j + 1 < ins.length && ins[j + 1] === ins[j] + 1) j++;
      const s = ins[i], e = ins[j];
      const hit = del.filter((dy) => dy >= s && dy <= e + 1);
      hit.forEach((dy) => usedDel.add(dy));
      for (let l = s; l <= e; l++) out.push({ line: l + 1, t: hit.length ? 'mod' : 'add' });
      i = j + 1;
    }
    [...new Set(del.filter((dy) => !usedDel.has(dy)))].forEach((dy) => out.push({ line: Math.max(1, dy), t: 'del' }));
    return out;
  }
  G.lineMarks = lineMarks;

  let decos = null;
  const gutter = F.debounce(async () => {
    if (decos) { decos.clear(); decos = null; }
    if (!F.hasCode() || !G.status || !G.status.repo) return;
    const p = F.state.active;
    const model = F.editor.getModel();
    const f = (G.status.files || []).find((x) => x.p === p);
    const tracked = !f || f.x !== '?';
    if (!tracked) {
      decos = F.editor.createDecorationsCollection([{ range: new monaco.Range(1, 1, model.getLineCount(), 1), options: { isWholeLine: true, linesDecorationsClassName: 'git-add' } }]);
      return;
    }
    const orig = await headText(p);
    if (orig == null || F.state.active !== p || F.editor.getModel() !== model) return;
    const marks = lineMarks(orig.replace(/\r\n/g, '\n').split('\n'), model.getValue().replace(/\r\n/g, '\n').split('\n'));
    if (!marks) return;
    decos = F.editor.createDecorationsCollection(marks.filter((m) => m.line <= model.getLineCount()).map((m) => ({
      range: new monaco.Range(m.line, 1, m.line, 1),
      options: { isWholeLine: false, linesDecorationsClassName: 'git-' + m.t, overviewRuler: { color: m.t === 'add' ? '#4ADE8088' : m.t === 'mod' ? '#7FB4FF88' : '#FF7A8588', position: 1 } }
    })));
  }, 250);

  // ───────────── kötések ─────────────
  F.on('workspace', () => { G.repos = null; G.repo = null; G.status = null; G.log = null; G.head.clear(); G.refresh(true); });
  F.on('save', () => G.refresh());
  F.on('change', () => gutter());
  F.on('open', (p) => {
    if (!$('#gitView').hidden) G.closeMap();
    if (G.repos && G.repos.root == null && G.repos.repos.length > 1) {
      const hit = G.repos.repos.filter((x) => p.startsWith(x + '/')).sort((x, y) => y.length - x.length)[0];
      if (hit && hit !== G.repo) { G.repo = hit; G.head.clear(); G.refresh(); return; }
    }
    gutter();
  });
  F.on('commandDone', (cmd) => { if (/^\s*git\b/.test(cmd)) { G.head.clear(); G.refresh(/\binit\b/.test(cmd)); } });
  F.on('tree', () => { if (!$('#view-git').hidden) G.refresh(); });
  window.addEventListener('focus', () => { if (local()) G.refresh(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#gitView').hidden && $('#overlay').hidden) { e.preventDefault(); G.closeMap(); } });
  $('#gitRefresh').onclick = () => { G.head.clear(); G.refresh(true); };
  F.on('view', (v) => { if (v === 'git') { render(); G.refresh(); } });

  const C = (label, keywords, run, icon) => F.command({ label, keywords, run, icon: icon || 'G', when: () => !!local() });
  C('Git: panel', 'git verziokezeles source control', () => F.setView('git'), 'G');
  C('Git: térkép (történet, ágak)', 'git graph tortenet log diagram terkep', () => G.openMap(), '◇');
  C('Git: commit', 'git commit mentes', () => { F.setView('git'); setTimeout(() => { const t = $('#gitMsg'); if (t) t.focus(); }, 50); }, '✓');
  C('Git: feltöltés (push)', 'git push feltoltes github', () => G.run('push', { done: 'Feltöltve' }), '↑');
  C('Git: letöltés (pull)', 'git pull letoltes', () => G.run('pull', { done: 'Letöltve' }), '↓');
  C('Git: új ág', 'git branch ag', newBranch, '⑂');
  C('Git: ág beolvasztása (merge)', 'git merge beolvasztas', mergeBranch, '⑂');
  C('Git: tároló létrehozása (init)', 'git init letrehozas', () => G.run('init', { done: 'Git-tároló létrehozva' }), '+');
  C('Git: távoli tároló (GitHub)', 'git remote github origin', askRemote, '☁');
  C('Git: kisokos', 'git help sugo kisokos fogalmak', () => G.openMap('kisokos'), '?');
})();
