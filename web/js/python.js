/* FACET — Python facet
   Futtatás interaktív terminállal (input()), magyar Traceback-magyarázat, élő szintaxis-ellenőrzés,
   tanácsok gyors javítással, pip-panel (venv, requirements.txt), vázlat, kódsablonok, formázás (black). */
(function () {
  'use strict';
  const { h, esc, $ } = F;
  const PY = F.py = {};
  const ACC = () => F.facets.py.accent;
  const dirOf = (p) => p.split('/').slice(0, -1).join('/');

  // ───────────── magyar hibamagyarázat ─────────────
  const PIP_NAMES = { cv2: 'opencv-python', PIL: 'pillow', sklearn: 'scikit-learn', bs4: 'beautifulsoup4', yaml: 'pyyaml', dotenv: 'python-dotenv', serial: 'pyserial', Crypto: 'pycryptodome', dateutil: 'python-dateutil', attr: 'attrs', jwt: 'pyjwt', docx: 'python-docx', pptx: 'python-pptx', telegram: 'python-telegram-bot', discord: 'discord.py', usb: 'pyusb', OpenGL: 'PyOpenGL', win32api: 'pywin32', magic: 'python-magic' };
  const did = (txt) => { const m = /Did you mean:? '?([^'?]+)'?\??/.exec(txt); return m ? ` Erre gondoltál: <code>${esc(m[1])}</code>?` : ''; };
  const RULES = [
    [/IndentationError: expected an indented block(?: after '?([\w ]+?)'? (?:statement|definition) on line (\d+))?/, (m) => ({ t: 'Hiányzik a behúzás', b: `${m[1] ? `A(z) <code>${esc(m[1])}</code> sor (${m[2]}.) után` : 'A kettősponttal végződő sor után'} beljebb kezdett sor(ok)nak kell jönnie (általában 4 szóköz). Ha még nincs mit írni oda, írd be: <code>pass</code>.` })],
    [/IndentationError: unexpected indent/, () => ({ t: 'Váratlan behúzás', b: 'Ez a sor beljebb kezdődik, mint kellene. Pythonban a behúzás jelenti a blokkot: csak <code>if</code>, <code>for</code>, <code>def</code>… (kettőspont) után lehet beljebb kezdeni.' })],
    [/IndentationError: unindent does not match any outer indentation level/, () => ({ t: 'A behúzás nem illeszkedik', b: 'A sor behúzása egyik korábbi szinthez sem igazodik. Valószínűleg 3 vagy 5 szóköz került 4 helyett, vagy tabulátor és szóköz keveredik.' })],
    [/TabError: inconsistent use of tabs and spaces/, () => ({ t: 'Tabulátor és szóköz keveredik', b: 'A behúzásban tabulátor és szóköz is van. A FACET-tanácsok között egy kattintással szóközre cserélheted az összeset.' })],
    [/SyntaxError: expected ':'/, () => ({ t: 'Hiányzik a kettőspont', b: 'Az <code>if</code>, <code>elif</code>, <code>else</code>, <code>for</code>, <code>while</code>, <code>def</code> és <code>class</code> sorának végére kettőspont kell: <code>if x &gt; 3:</code>' })],
    [/SyntaxError: '(.)' was never closed/, (m) => ({ t: `Nincs lezárva: ${m[1]}`, b: `Egy <code>${esc(m[1])}</code> zárójelnek hiányzik a párja. Számold meg a nyitó és záró zárójeleket ebben a sorban.` })],
    [/SyntaxError: unmatched '(.)'/, (m) => ({ t: `Fölösleges ${m[1]}`, b: `Ehhez a <code>${esc(m[1])}</code> zárójelhez nincs nyitó pár.` })],
    [/SyntaxError: (?:unterminated string literal|EOL while scanning string literal)/, () => ({ t: 'Lezáratlan szöveg', b: 'Egy idézőjel (<code>"</code> vagy <code>\'</code>) nincs lezárva a sor végéig. Ha a szövegben is van idézőjel, használd a másik fajtát kívül: <code>"Ez \'jó\'"</code>.' })],
    [/SyntaxError: unexpected EOF while parsing|SyntaxError: incomplete input/, () => ({ t: 'Váratlanul véget ért a fájl', b: 'Valószínűleg hiányzik egy záró zárójel, vagy egy blokk teste (pl. <code>def</code> után).' })],
    [/SyntaxError: Missing parentheses in call to 'print'/, () => ({ t: 'A print függvény: zárójel kell', b: 'Python 3-ban a <code>print</code> függvény: <code>print("Szia")</code>. A zárójel nélküli forma a régi Python 2-é.' })],
    [/SyntaxError: invalid syntax\. Perhaps you forgot a comma\?/, () => ({ t: 'Hiányzik egy vessző', b: 'Két érték áll egymás mellett vessző nélkül, pl. egy listában vagy egy függvényhívás paraméterei között.' })],
    [/SyntaxError: invalid syntax\. Maybe you meant '==' or ':=' instead of '='\?|SyntaxError: cannot assign to .* here\. Maybe you meant '=='/, () => ({ t: '= helyett ==', b: 'Az <code>=</code> értéket ad, nem hasonlít. Feltételben összehasonlításhoz <code>==</code> kell: <code>if x == 5:</code>' })],
    [/SyntaxError: invalid character '(.)'/, (m) => ({ t: `Érvénytelen karakter: ${m[1]}`, b: 'Ez a jel nem lehet Python-kódban. Gyakori ok: „okos” idézőjel (<code>„ ”</code>) vagy gondolatjel egy weboldalról vagy Wordből másolt kódban.' })],
    [/SyntaxError: (?:f-string|invalid decimal literal|leading zeros)/, () => ({ t: 'Hibás szám vagy f-string', b: 'Nézd meg a sort: egy szám nem kezdődhet 0-val, a változónév nem kezdődhet számmal, és az f-stringben a kapcsos zárójeleknek párban kell lenniük.' })],
    [/SyntaxError: invalid syntax/, () => ({ t: 'Szintaktikai hiba', b: 'A Python nem érti ezt a sort. Gyakori okok: hiányzó kettőspont vagy zárójel, elgépelt kulcsszó, vagy egy <code>=</code> ott, ahol <code>==</code> kellene. A hiba gyakran az előző sorban van.' })],
    [/NameError: name '([^']+)' is not defined/, (m, all) => ({ t: `Ismeretlen név: ${m[1]}`, b: (/^(true|false|null|none)$/.test(m[1]) ? `Pythonban ezek nagybetűvel kezdődnek: <code>True</code>, <code>False</code>, <code>None</code>.` : `Nincs <code>${esc(m[1])}</code> nevű változó vagy függvény. Elírtad (a kis- és nagybetű is számít), vagy később hozod létre, mint ahol használod? Ha egy modulból jön, kell egy <code>import</code>.`) + did(all) })],
    [/UnboundLocalError: (?:local variable '([^']+)' referenced before assignment|cannot access local variable '([^']+)')/, (m) => ({ t: `${m[1] || m[2]}: értékadás előtt használtad`, b: `A függvényen belül értéket adsz a <code>${esc(m[1] || m[2])}</code> változónak, ezért a Python helyi változónak tekinti, de előbb olvasod. Ha a függvényen kívüli változót módosítanád, írd a függvény elejére: <code>global ${esc(m[1] || m[2])}</code>.` })],
    [/TypeError: can only concatenate str \(not "([^"]+)"\) to str/, (m) => ({ t: `Szöveghez nem adható ${m[1]}`, b: `A <code>+</code> két szöveget fűz össze, számot nem. Alakítsd szöveggé: <code>"Pont: " + str(x)</code>, vagy használj f-stringet: <code>f"Pont: {x}"</code>.` })],
    [/TypeError: unsupported operand type\(s\) for ([^:]+): '(\w+)' and '(\w+)'/, (m) => ({ t: `${m[2]} ${m[1].trim()} ${m[3]} nem megy`, b: (m[2] === 'str' || m[3] === 'str') ? 'Az egyik érték szöveg. Az <code>input()</code> mindig szöveget ad vissza; számmá így alakíthatod: <code>int(input("Szám: "))</code> vagy <code>float(...)</code>.' : `Ez a művelet ezekkel a típusokkal nem végezhető el: <code>${esc(m[2])}</code> és <code>${esc(m[3])}</code>.` })],
    [/TypeError: '([<>]=?)' not supported between instances of '(\w+)' and '(\w+)'/, (m) => ({ t: `${m[2]} és ${m[3]} nem hasonlítható`, b: 'Szöveget és számot nem lehet nagyság szerint összehasonlítani. Valószínűleg az <code>input()</code> eredményét elfelejtetted számmá alakítani: <code>int(...)</code>.' })],
    [/TypeError: (\S+)\(\) missing (\d+) required positional arguments?: (.+)/, (m) => ({ t: `${m[1]}() — hiányzó paraméter`, b: `A <code>${esc(m[1])}</code> hívásakor kevesebb értéket adtál meg, mint ahány paramétere van. Hiányzik: <code>${esc(m[3])}</code>.` })],
    [/TypeError: (\S+)\(\) takes (\d+) positional arguments? but (\d+) (?:was|were) given/, (m) => ({ t: `${m[1]}() — túl sok paraméter`, b: `${esc(m[2])} paramétert vár, de ${esc(m[3])}-t kapott. Ha ez egy osztály metódusa, nem hiányzik az első <code>self</code> paraméter a <code>def</code> sorából?` })],
    [/TypeError: '(\w+)' object is not subscriptable/, (m) => ({ t: `${m[1]} nem indexelhető`, b: `A <code>[ ]</code> csak listán, szövegen, szótáron… működik, a(z) <code>${esc(m[1])}</code> típuson nem. Lehet, hogy egy függvényt nem hívtál meg (hiányzik a <code>()</code>)?` })],
    [/TypeError: '(\w+)' object is not iterable/, (m) => ({ t: `${m[1]} nem bejárható`, b: (m[1] === 'int' ? 'Egy számon nem lehet <code>for</code>-ral végigmenni. Ha N-szer ismételnél: <code>for i in range(n):</code>' : `A <code>for</code> ezen a típuson nem tud végigmenni: <code>${esc(m[1])}</code>.`) })],
    [/TypeError: '(\w+)' object is not callable/, (m) => ({ t: `${m[1]} nem hívható meg`, b: `Függvényként hívtál meg (<code>()</code>) valamit, ami <code>${esc(m[1])}</code>. Gyakori ok: egy változót úgy neveztél el, mint egy beépített függvényt (pl. <code>list</code>, <code>str</code>, <code>input</code>, <code>sum</code>), és így felülírtad.` })],
    [/ValueError: invalid literal for int\(\) with base \d+: '(.*)'/, (m) => ({ t: 'Ez nem egész szám', b: `Az <code>int()</code> ezt kapta: <code>'${esc(m[1])}'</code>, ami nem egész szám.${/[.,]/.test(m[1]) ? ' Tizedes törthez <code>float()</code> kell (és tizedespont, nem vessző).' : ''} Ha a felhasználó írja be, érdemes <code>try</code>/<code>except ValueError</code>-ral kezelni.` })],
    [/ValueError: could not convert string to float: '(.*)'/, (m) => ({ t: 'Ez nem szám', b: `A <code>float()</code> ezt kapta: <code>'${esc(m[1])}'</code>.${m[1].includes(',') ? ' Pythonban tizedespont kell: <code>.replace(",", ".")</code>' : ''}` })],
    [/ValueError: (?:too many values to unpack|not enough values to unpack)/, () => ({ t: 'Nem stimmel a darabszám', b: 'Több változónak adtál értéket egyszerre (pl. <code>a, b = ...</code>), de a jobb oldalon más számú érték van.' })],
    [/ZeroDivisionError/, () => ({ t: 'Osztás nullával', b: 'Nullával nem lehet osztani. Osztás előtt ellenőrizd: <code>if oszto != 0:</code>' })],
    [/IndexError: (?:list|string|tuple) index out of range/, () => ({ t: 'Túlindexelés', b: 'Nincs ennyi elem. Az indexek 0-tól <code>len(lista) - 1</code>-ig mennek; az utolsó elem: <code>lista[-1]</code>.' })],
    [/IndexError: pop from empty list/, () => ({ t: 'Üres listából vettél ki', b: 'A <code>pop()</code> előtt nézd meg, van-e elem: <code>if lista:</code>' })],
    [/KeyError: (.+)/, (m) => ({ t: `Nincs ilyen kulcs: ${m[1]}`, b: `A szótárban nincs <code>${esc(m[1])}</code> kulcs. Biztonságosan így olvashatod: <code>szotar.get(${esc(m[1])})</code>, vagy előtte: <code>if ${esc(m[1])} in szotar:</code>` })],
    [/AttributeError: '(\w+)' object has no attribute '([^']+)'/, (m, all) => ({ t: `${m[1]}: nincs .${m[2]}`, b: (m[1] === 'NoneType' ? 'Az érték <code>None</code>. Gyakori ok: egy függvény nem ad vissza semmit (hiányzik a <code>return</code>), vagy egy lista-metódus (pl. <code>.sort()</code>) eredményét tetted változóba.' : `A(z) <code>${esc(m[1])}</code> típusnak nincs <code>${esc(m[2])}</code> nevű tulajdonsága vagy metódusa.`) + did(all) })],
    [/AttributeError: module '([^']+)' has no attribute '([^']+)'/, (m) => ({ t: `${m[1]}.${m[2]} nem létezik`, b: `A <code>${esc(m[1])}</code> modulban nincs ilyen. Ha a saját fájlodat ugyanígy nevezted el (pl. <code>${esc(m[1])}.py</code>), nevezd át, mert eltakarja az igazi modult.` })],
    [/ModuleNotFoundError: No module named '([^']+)'/, (m) => { const mod = m[1].split('.')[0]; const pip = PIP_NAMES[mod] || mod; return { t: `Nincs telepítve: ${mod}`, b: `Telepítsd: <code>pip install ${esc(pip)}</code> — a pip-panelen egy gombnyomás. Ha saját fájl, ellenőrizd, hogy a <code>${esc(mod)}.py</code> ugyanabban a mappában van-e.`, pip }; }],
    [/ImportError: cannot import name '([^']+)' from '([^']+)'/, (m) => ({ t: `${m[2]}: nincs benne ${m[1]}`, b: `A <code>${esc(m[2])}</code> modulban nincs <code>${esc(m[1])}</code>. Elírás, vagy a két fájl kölcsönösen importálja egymást (körkörös import).` })],
    [/RecursionError: maximum recursion depth exceeded/, () => ({ t: 'Túl mély rekurzió', b: 'Egy függvény túl sokszor hívta önmagát. Hiányzik vagy sosem teljesül a leállási feltétel.' })],
    [/FileNotFoundError: \[Errno 2\] No such file or directory: '([^']+)'/, (m) => ({ t: 'Nincs ilyen fájl', b: `Nem találom: <code>${esc(m[1])}</code>. A relatív útvonal a futtatott .py fájl mappájához képest értendő (a FACET onnan indítja).` })],
    [/EOFError: EOF when reading a line/, () => ({ t: 'Az input() nem kapott bemenetet', b: 'A program bemenetet várt, de a bemenet lezárult. Futtatáskor a terminál alján írhatsz neki.' })],
    [/UnicodeDecodeError/, () => ({ t: 'Karakterkódolási hiba', b: 'Fájl olvasásakor add meg a kódolást: <code>open("fajl.txt", encoding="utf-8")</code>' })],
    [/AssertionError/, () => ({ t: 'Nem teljesült egy assert', b: 'Egy <code>assert</code> feltétele hamis lett. Ez a teszt szándékosan állította meg a programot.' })]
  ];
  PY.explain = (text) => {
    // Az utolsó hibasor számít (a Traceback végén).
    for (const [re, fn] of RULES) { const m = re.exec(text); if (m) return fn(m, text); }
    return null;
  };

  /** A Traceback utolsó, a munkamappában lévő helye. */
  function locate(err) {
    const root = ((F.state.engine && F.state.engine.workspace) || '').replace(/\\/g, '/');
    const re = /File "([^"]+)", line (\d+)/g;
    let m, loc = null;
    while ((m = re.exec(err))) {
      const f = m[1].replace(/\\/g, '/');
      let rel = null;
      if (root && f.startsWith(root + '/')) rel = f.slice(root.length + 1);
      if (rel && !/(^|\/)(\.?venv|site-packages)\//.test(rel)) loc = { path: rel, line: +m[2], col: 1 };
    }
    return loc;
  }

  // ───────────── futtatás ─────────────
  PY.running = false;
  function setRunning(on) {
    PY.running = on;
    $('#runBtn').classList.toggle('running', on);
    if (F.state.facet === 'py') $('#runLabel').textContent = on ? 'Leállítás' : 'Futtatás';
  }

  async function run(a) {
    if (PY.running && F.proc) { F.proc.kill(); return; }
    F.bottom.show('terminal');
    F.term.clear();
    if (F.fs.mode !== 'local') { F.term.row('python', 'A Python futtatásához a FACET alkalmazás (helyi motor) kell.', 't-bad', 'var(--warn)'); return; }
    let r;
    try { r = await F.apiJson('POST', 'py/run', { path: a.path }); } catch (e) { F.term.row('hiba', esc(e.message), 't-bad', 'var(--err)'); return; }
    if (!r.ok) { noPython(); return; }
    F.term.row('futtatás', esc(a.path) + (PY.info && PY.info.version ? `  ·  Python ${esc(PY.info.version)}${PY.info.venv ? ' · venv' : ''}` : ''), '', ACC());
    setRunning(true);
    F.term.input(true, F.procInput(r.id));
    let err = '';
    await F.streamProc(r.id, {
      out: (d) => F.term.stream(d, 't-out'),
      err: (d) => { err += d; F.term.stream(d, 't-err'); },
      exit: (ev) => {
        const s = (ev.ms / 1000).toFixed(2).replace('.', ',');
        F.term.row('kilépés', `kód ${ev.code} · ${s} s`, ev.code === 0 ? '' : 't-bad', ev.code === 0 ? 'var(--muted-2)' : 'var(--err)');
        if (ev.code !== 0 && err) explainInTerminal(err, a.path);
      }
    });
    setRunning(false);
    F.term.input(false);
  }

  function noPython() {
    const mac = /Mac/.test(navigator.platform);
    F.term.html(`<div class="t-card"><b>Nincs Python a gépen</b><span>Telepítsd a Python 3-at: <b>python.org/downloads</b>${mac ? ' (vagy Terminálban: <code>brew install python</code>)' : ' — Windowson a telepítő elején pipáld be: <b>Add python.exe to PATH</b>'}. Utána a Beállítások → Rendszer oldalon nyomd meg az „Eszközök keresése újra” gombot.</span></div>`);
  }

  function explainInTerminal(err, path) {
    const lines = err.trim().split('\n');
    const last = lines.reverse().find((l) => /^\w+(Error|Exception|Warning|Interrupt)\b|^\w+Error:/.test(l.trim())) || '';
    const ex = PY.explain(last || err) || PY.explain(err);
    const loc = locate(err);
    if (!ex && !loc) return;
    const where = loc ? ` A hiba helye: <span class="t-link" data-path="${esc(loc.path)}" data-line="${loc.line}" data-col="1">${esc(loc.path.split('/').pop())}:${loc.line}</span>.` : '';
    const card = F.term.html(`<div class="t-card"><b>Hibatolmács${ex ? ' · ' + esc(ex.t) : ''}</b><span>${ex ? ex.b : 'A program hibával leállt.'}${where}</span></div>`);
    if (ex && ex.pip) {
      const btn = h('button', { class: 'chip primary', style: { marginTop: '8px' }, onclick: () => pipInstall(ex.pip, path) }, 'pip install ' + ex.pip);
      card.querySelector('.t-card').append(btn);
    }
    if (loc) F.openAt(loc.path, loc.line, 1);
  }

  // ───────────── élő szintaxis-ellenőrzés ─────────────
  const syntax = new Map();
  async function check(path) {
    if (F.fs.mode !== 'local' || !F.settings.pyCheck) return;
    let r;
    try { r = await F.apiJson('GET', 'py/check', { path }); } catch (e) { return; }
    const doc = F.state.docs.get(path);
    if (!doc || !doc.model) return;
    const list = [];
    if (r.ok && r.out) {
      const [kind, line, col, ...msg] = r.out.split('|');
      const text = msg.join('|');
      const ex = PY.explain(kind + ': ' + text);
      list.push({ line: Math.max(1, +line || 1), col: Math.max(1, +col || 1), title: ex ? ex.t : text, body: ex ? ex.b : esc(text), raw: kind + ': ' + text });
    }
    syntax.set(path, list);
    monaco.editor.setModelMarkers(doc.model, 'facet-py', list.map((d) => ({
      startLineNumber: d.line, startColumn: d.col, endLineNumber: d.line, endColumn: Math.max(d.col + 1, d.line <= doc.model.getLineCount() ? doc.model.getLineMaxColumn(d.line) : d.col + 1),
      severity: monaco.MarkerSeverity.Error, message: d.title + '\n' + d.body.replace(/<[^>]+>/g, ''), source: 'Python'
    })));
    F.problems.set('pysyn:' + path, list.map((d) => ({ file: path, line: d.line, col: d.col, sev: 'error', title: d.title, detail: d.raw })));
    if (F.state.active === path) { F.renderStageTabs(); if (F.stageTab() === 'tips') F.refreshStage(); }
  }

  // ───────────── tanácsok (lint) gyors javítással ─────────────
  /** Megjegyzések és szövegek kitakarása (a sorok és oszlopok megmaradnak). */
  function blank(src) {
    let out = '', i = 0;
    const n = src.length;
    while (i < n) {
      const c = src[i];
      if (c === '#') { while (i < n && src[i] !== '\n') { out += ' '; i++; } continue; }
      if (c === '"' || c === "'") {
        const triple = src.substr(i, 3) === c + c + c;
        const q = triple ? c + c + c : c;
        let pre = '';
        // f/r/b előtag már kiírva — maradhat
        out += q; i += q.length;
        while (i < n && src.substr(i, q.length) !== q) {
          if (src[i] === '\\') { out += '  '; i += 2; continue; }
          if (!triple && src[i] === '\n') break;
          out += src[i] === '\n' ? '\n' : ' '; i++;
        }
        if (i < n && src.substr(i, q.length) === q) { out += q; i += q.length; }
        void pre;
        continue;
      }
      out += c; i++;
    }
    return out;
  }
  const BUILTINS = ['list', 'dict', 'str', 'int', 'float', 'input', 'sum', 'max', 'min', 'len', 'type', 'id', 'set', 'tuple', 'print', 'range', 'sorted', 'map', 'filter', 'open'];

  function lint(model) {
    const src = model.getValue();
    const code = blank(src).split('\n');
    const raw = src.split('\n');
    const out = [];
    const usesSpaces = raw.some((l) => /^ {2,}\S/.test(l));
    code.forEach((L, i) => {
      const line = i + 1;
      let m;
      const none = /(==|!=)\s*None\b/.exec(L);
      if (none) out.push({ line, col: none.index + 1, endCol: none.index + none[1].length + 1, sev: 'warn', title: `${none[1]} None helyett ${none[1] === '==' ? 'is' : 'is not'} None`, body: 'A <code>None</code>-nal mindig <code>is</code>-zel hasonlíts: <code>if x is None:</code>. Ez pontosabb és gyorsabb.', fix: { label: 'Csere: ' + (none[1] === '==' ? 'is' : 'is not'), text: none[1] === '==' ? 'is' : 'is not' } });
      const tf = /(==|!=)\s*(True|False)\b/.exec(L);
      if (tf) out.push({ line, col: tf.index + 1, endCol: tf.index + tf[0].length + 1, sev: 'info', title: `${tf[0].replace(/\s+/g, ' ')} fölösleges`, body: 'Logikai értéket nem kell <code>True</code>/<code>False</code>-hoz hasonlítani: <code>if kesz:</code> vagy <code>if not kesz:</code>.', fix: null });
      const mut = /\bdef\s+\w+\s*\([^)]*?\b(\w+)\s*(?::\s*[^=,)]+)?=\s*(\[\]|\{\}|list\(\)|dict\(\)|set\(\))/.exec(L);
      if (mut) {
        const col = L.indexOf(mut[2], mut.index + mut[0].length - mut[2].length) + 1;
        out.push({ line, col, endCol: col + mut[2].length, sev: 'warn', title: 'Módosítható alapérték', body: `A <code>${esc(mut[2])}</code> alapérték egyszer jön létre, és minden hívás ugyanazt használja — a hívások „összeszemetelik”. Helyette: <code>${esc(mut[1])}=None</code>, a függvény elején pedig <code>if ${esc(mut[1])} is None: ${esc(mut[1])} = ${esc(mut[2])}</code>.`, fix: { label: 'Csere: None', text: 'None' } });
      }
      const bare = /^\s*except\s*:/.exec(L);
      if (bare) { const col = L.indexOf('except') + 1; out.push({ line, col, endCol: col + 6, sev: 'warn', title: 'Csupasz except:', body: 'Az <code>except:</code> minden hibát elnyel, még a Ctrl+C-t is, és így a valódi hibák rejtve maradnak. Írd ki, mit vársz: <code>except ValueError:</code>, vagy legalább <code>except Exception:</code>.', fix: { label: 'Csere: except Exception', text: 'except Exception' } }); }
      const p2 = /^(\s*)print\s+(?=[^\s(=.])/.exec(L);
      if (p2) { const col = p2[1].length + 1; out.push({ line, col, endCol: raw[i].length + 1, sev: 'warn', title: 'print zárójel nélkül (Python 2)', body: 'Python 3-ban a print függvény: <code>print("Szia")</code>.', fix: { label: 'Zárójelezés', text: 'print(' + raw[i].slice(col - 1).replace(/^print\s+/, '').replace(/\s+$/, '') + ')' } }); }
      if (/^\t+/.test(raw[i]) && usesSpaces) out.push({ line, col: 1, endCol: raw[i].match(/^\t+/)[0].length + 1, sev: 'warn', title: 'Tabulátor a behúzásban', body: 'A fájlban máshol szóközzel húzol be. A kettő keveredése <code>TabError</code>-t okoz.', fix: { label: 'Csere: szóközök', text: '    '.repeat(raw[i].match(/^\t+/)[0].length) } });
      const shadow = new RegExp('^\\s*(' + BUILTINS.join('|') + ')\\s*=(?!=)').exec(L);
      if (shadow) { const col = L.indexOf(shadow[1]) + 1; out.push({ line, col, endCol: col + shadow[1].length, sev: 'warn', title: `A beépített ${shadow[1]} felülírása`, body: `Ha egy változót <code>${shadow[1]}</code>-nak nevezel, utána a beépített <code>${shadow[1]}()</code> függvény nem lesz elérhető („object is not callable” hibát okoz). Válassz más nevet, pl. <code>${shadow[1]}_</code> vagy beszédesebbet.`, fix: null }); }
      const rl = /\bfor\s+(\w+)\s+in\s+range\s*\(\s*len\s*\(\s*(\w+)\s*\)\s*\)/.exec(L);
      if (rl) out.push({ line, col: rl.index + 1, endCol: rl.index + rl[0].length + 1, sev: 'info', title: 'range(len(…)) helyett enumerate', body: `Ha az elem és az index is kell: <code>for ${esc(rl[1])}, elem in enumerate(${esc(rl[2])}):</code>. Ha csak az elem: <code>for elem in ${esc(rl[2])}:</code>`, fix: null });
      const star = /^\s*from\s+[\w.]+\s+import\s+\*/.exec(L);
      if (star) out.push({ line, col: 1, endCol: L.length + 1, sev: 'info', title: 'import *', body: 'A <code>*</code> mindent behoz, így nem látszik, mi honnan jön, és nevek ütközhetnek. Írd ki, mi kell: <code>from math import sqrt, pi</code>', fix: null });
      if ((m = /^\s*except\b.*:\s*$/.exec(L)) && /^\s*pass\s*$/.test(code[i + 1] || '')) out.push({ line: line + 1, col: (code[i + 1].indexOf('pass') + 1), endCol: code[i + 1].indexOf('pass') + 5, sev: 'info', title: 'A hiba csendben eltűnik', body: 'Az <code>except</code> ág nem csinál semmit, így nem fogod tudni, ha hiba történt. Legalább írd ki: <code>print("Hiba:", e)</code> (<code>except Exception as e:</code>).', fix: null });
    });
    // f-string: "Szia " + nev + "!" → f"Szia {nev}!"
    const STR = `(?:"(?:[^"\\\\\\n{}]|\\\\.)*"|'(?:[^'\\\\\\n{}]|\\\\.)*')`;
    const OPER = `(?:str\\([^()"'\\n]*\\)|[A-Za-z_][\\w.]*(?:\\([^()"'\\n]*\\))?(?:\\[[^\\]"'\\n]*\\])?)`;
    const CHAIN = new RegExp(`(?:${STR}|${OPER})(?:\\s*\\+\\s*(?:${STR}|${OPER}))+`, 'g');
    raw.forEach((R0, i) => {
      if (code[i].indexOf('+') < 0 || !/["']/.test(R0)) return;
      let m;
      CHAIN.lastIndex = 0;
      while ((m = CHAIN.exec(R0))) {
        const start = m.index, text = m[0];
        if (code[i][start] === ' ' && R0[start] !== ' ') continue; // megjegyzésben
        if (/\+\s*$/.test(R0.slice(0, start)) || /^\s*\+/.test(R0.slice(start + text.length))) continue;
        if (/[\w.)\]]$/.test(R0.slice(0, start)) || /[fFrRbBuU]$/.test(R0.slice(0, start))) continue;
        const parts = text.split(/\s*\+\s*(?=(?:["']|[A-Za-z_]))/);
        const strs = parts.filter((p) => /^["']/.test(p)), ops = parts.filter((p) => !/^["']/.test(p));
        if (!strs.length || !ops.length) continue;
        const qch = strs[0][0];
        if (strs.some((p) => p.slice(1, -1).includes(qch === '"' ? '"' : "'"))) continue;
        let body = '';
        parts.forEach((p) => {
          if (/^["']/.test(p)) body += p.slice(1, -1).replace(qch === '"' ? /\\'/g : /\\"/g, (x) => x.slice(1));
          else { const sm = /^str\((.*)\)$/.exec(p); body += '{' + (sm ? sm[1].trim() : p) + '}'; }
        });
        if (ops.some((p) => !/^str\(/.test(p) && /\(/.test(p) && !/\)$/.test(p))) continue;
        out.push({ line: i + 1, col: start + 1, endCol: start + text.length + 1, sev: 'info', title: 'Szöveg összefűzése → f-string', body: `Olvashatóbb, és a számokat sem kell <code>str()</code>-be tenni: <code>f${esc(qch + body + qch)}</code>`, fix: { label: 'Átalakítás f-stringgé', text: 'f' + qch + body + qch } });
      }
    });
    // fel nem használt import
    const allCode = code.join('\n');
    if (!/(^|\/)__init__\.py$/.test(model.uri ? model.uri.path || '' : '') && !/__all__/.test(allCode)) {
      code.forEach((L, i) => {
        let m, names = [];
        if ((m = /^import\s+(.+?)\s*$/.exec(L))) names = splitParams(m[1]).map((x) => { const p = x.split(/\s+as\s+/); return { full: x.trim(), name: (p[1] || p[0].split('.')[0]).trim() }; });
        else if ((m = /^from\s+([\w.]+)\s+import\s+([^(*]+?)\s*$/.exec(L)) && m[1] !== '__future__') names = splitParams(m[2]).map((x) => { const p = x.split(/\s+as\s+/); return { full: x.trim(), name: (p[1] || p[0]).trim() }; });
        else return;
        const rest = code.slice(0, i).concat(code.slice(i + 1)).join('\n');
        const unused = names.filter((n) => !new RegExp('(^|[^\\w.])' + n.name.replace(/[.$]/g, '\\$&') + '\\b').test(rest));
        if (!unused.length) return;
        const keep = names.filter((n) => !unused.includes(n));
        const fixText = keep.length ? (m[0].startsWith('from') ? `from ${m[1]} import ${keep.map((k) => k.full).join(', ')}` : `import ${keep.map((k) => k.full).join(', ')}`) : '';
        out.push({ line: i + 1, col: 1, endCol: raw[i].length + 1, endLine: keep.length ? i + 1 : i + 2, endLineCol: keep.length ? raw[i].length + 1 : 1, sev: 'info', title: `Nem használt import: ${unused.map((u) => u.name).join(', ')}`, body: 'Ezt behozod, de sehol nem használod. Törölheted — így tisztább, és gyorsabban indul a program.', fix: { label: keep.length ? 'Fölösleges rész törlése' : 'Sor törlése', text: fixText } });
      });
    }
    // open() with nélkül
    code.forEach((L, i) => {
      const m = /^(\s*)\w+\s*=\s*open\s*\(/.exec(L);
      if (m) out.push({ line: i + 1, col: L.indexOf('open') + 1, endCol: L.indexOf('open') + 5, sev: 'info', title: 'open() with nélkül', body: 'Ha a fájlt <code>with open(...) as f:</code> formában nyitod meg, magától bezárul akkor is, ha közben hiba történik.', fix: null });
    });
    return out;
  }
  PY.lint = lint;

  const tips = new Map();
  function applyLint(path, model) {
    if (!model || !/\.pyw?$/i.test(path)) return;
    const list = lint(model);
    tips.set(path, list);
    monaco.editor.setModelMarkers(model, 'facet-pytips', list.map((d) => ({
      startLineNumber: d.line, startColumn: d.col, endLineNumber: d.line, endColumn: d.endCol,
      severity: d.sev === 'warn' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info,
      message: d.title + '\n' + d.body.replace(/<[^>]+>/g, ''), source: 'FACET tanács'
    })));
    F.problems.set('py:' + path, list.filter((d) => d.sev === 'warn').map((d) => ({ file: path, line: d.line, col: d.col, sev: 'warn', title: d.title, detail: 'FACET tanács' })));
    if (F.state.active === path && F.stageTab() === 'tips') F.refreshStage();
    F.renderStageTabs();
  }

  function fix(path, d) {
    const doc = F.state.docs.get(path);
    if (!doc || doc.custom || !d.fix) return;
    doc.model.pushEditOperations([], [{ range: new monaco.Range(d.line, d.col, d.endLine || d.line, d.endLine ? d.endLineCol : d.endCol), text: d.fix.text }], () => null);
    F.editor.focus();
  }

  function tipsPanel(body, a) {
    body.innerHTML = '';
    const syn = syntax.get(a.path) || [];
    const list = tips.get(a.path) || [];
    syn.forEach((d) => body.append(h('div', { class: 'expl', onclick: () => F.goto(d.line, d.col) },
      h('div', { class: 'eh' }, h('span', { class: 'et', text: d.title }), h('span', { class: 'el', text: a.path.split('/').pop() + ':' + d.line })),
      h('span', { class: 'eb', html: d.body }))));
    if (!list.length && !syn.length) body.append(h('div', { class: 'ok-card' }, h('span', { class: 'diamond' }), h('span', { text: 'Nincs tanács ehhez a fájlhoz. Tiszta kód!' })));
    list.forEach((d) => {
      body.append(h('div', { class: 'expl ' + (d.sev === 'warn' ? 'warn' : 'info'), onclick: () => F.goto(d.line, d.col, d.endCol) },
        h('div', { class: 'eh' }, h('span', { class: 'et', text: d.title }), h('span', { class: 'el', text: a.path.split('/').pop() + ':' + d.line })),
        h('span', { class: 'eb', html: d.body }),
        d.fix ? h('div', { class: 'ea' }, h('button', { class: 'chip primary', onclick: (e) => { e.stopPropagation(); fix(a.path, d); } }, d.fix.label)) : null));
    });
    const fixable = list.filter((d) => d.fix);
    if (fixable.length > 1) body.append(h('button', { class: 'chip', style: { alignSelf: 'flex-start' }, onclick: () => { [...fixable].sort((x, y) => y.line - x.line || y.col - x.col).forEach((d) => fix(a.path, d)); } }, `Mind a ${fixable.length} javítása`));
    body.append(h('div', { class: 'set-note', html: 'Mentéskor a FACET a háttérben ellenőrzi a szintaxist. Futtatás közbeni hibáknál a Hibatolmács magyarul elmagyarázza a Traceback-et, és a hibás sorra ugrik.' }));
  }

  // ───────────── pip, venv ─────────────
  PY.info = null;
  async function loadInfo(path) {
    if (F.fs.mode !== 'local') return null;
    try { PY.info = await F.apiJson('GET', 'py/info', { path: path || '' }); } catch (e) { PY.info = null; }
    return PY.info;
  }
  /** A Python-projekt mappája: requirements.txt, pyproject.toml vagy venv a fájltól felfelé; különben a fájl mappája. */
  function projDir(path) {
    const files = new Set(F.files());
    const idx = F.state.treeIdx || new Map();
    let d = dirOf(path);
    for (;;) {
      const j = (n) => (d ? d + '/' : '') + n;
      if (files.has(j('requirements.txt')) || files.has(j('pyproject.toml')) || idx.has(j('.venv')) || idx.has(j('venv'))) return d;
      if (!d) break;
      d = dirOf(d);
    }
    return dirOf(path);
  }
  const pyCmd = () => (PY.info && PY.info.python) || (F.isMac ? 'python3' : 'python');

  async function pipInstall(name, path) {
    const p = path || (F.active() && F.active().path) || '';
    await loadInfo(p);
    if (!PY.info || !PY.info.python) { noPython(); return; }
    await F.runCommand(`${pyCmd()} -m pip install ${name}`, projDir(p));
    const req = F.joinPath(projDir(p), 'requirements.txt');
    if (F.files().includes(req)) {
      const text = await F.textOf(req);
      const base = name.split(/[=<>~!\[]/)[0].toLowerCase();
      if (!text.split('\n').some((l) => l.trim().toLowerCase().split(/[=<>~!\[ ]/)[0] === base)) {
        if (await F.confirm('requirements.txt', `Hozzáírjam a <b>${esc(name)}</b> csomagot a <code>requirements.txt</code>-hez? Így mások is egy paranccsal telepíthetik.`, 'Hozzáírás')) {
          const doc = F.state.docs.get(req);
          const next = text.replace(/\s*$/, '\n') + name + '\n';
          if (doc && doc.model) { F.replaceAll(doc.model, next); await F.save(req); } else await F.fs.write(req, next);
        }
      }
    }
    F.refreshStageNow();
  }

  async function addPackage(path) {
    const v = await F.dialog({ title: 'Csomag telepítése (pip)', text: 'A PyPI-ról telepít egy csomagot. Népszerűek: <code>requests</code>, <code>numpy</code>, <code>pandas</code>, <code>matplotlib</code>, <code>flask</code>, <code>pygame</code>.',
      fields: [{ id: 'n', label: 'Csomag neve', placeholder: 'pl. requests' }], ok: 'Telepítés', validate: (x) => (/^[A-Za-z0-9][\w.\-\[\],]*([=<>~!]=?[\w.*]+)?$/.test(x.n.trim()) ? null : 'Érvénytelen csomagnév.') });
    if (v) await pipInstall(v.n.trim(), path);
  }

  async function pipPanel(body, a) {
    body.innerHTML = '';
    if (F.fs.mode !== 'local') { body.append(h('div', { class: 'stage-empty', text: 'A pip a helyi FACET motorral működik.' })); return; }
    body.append(h('div', { class: 'set-note', text: 'Python keresése…' }));
    const info = await loadInfo(a.path);
    body.innerHTML = '';
    if (!info || !info.python) {
      body.append(h('div', { class: 'git-help' }, h('b', { text: 'Nincs Python 3 a gépen.' }),
        h('span', { html: 'Telepítsd: <b>python.org/downloads</b>. Windowson a telepítő elején pipáld be: <b>Add python.exe to PATH</b>.' }),
        h('button', { class: 'btn', onclick: () => F.openUrl('https://www.python.org/downloads/') }, 'python.org megnyitása'),
        h('button', { class: 'btn', onclick: async () => { await F.api('GET', 'tools'); F.state.engine = await F.apiJson('GET', 'ping'); F.refreshStageNow(); } }, 'Újra ellenőrzöm')));
      return;
    }
    const dir = projDir(a.path);
    const req = F.joinPath(dir, 'requirements.txt');
    const hasReq = F.files().includes(req);
    body.append(h('div', { class: 'card' },
      h('div', { class: 'card-title' }, 'Python ' + (info.version || ''), h('span', { class: 'sub', text: info.venv ? 'venv' : 'rendszer' })),
      h('div', { class: 'set-note', html: info.venv ? `Virtuális környezet: <code>${esc(info.venv.replace(/\/(bin|Scripts)\/python(\.exe)?$/, ''))}</code> — a csomagok ebbe kerülnek.` : 'A rendszer Pythonját használod. Projektenként ajánlott egy saját virtuális környezet (.venv), hogy a csomagok ne keveredjenek.' }),
      h('div', { class: 'grid2' },
        h('button', { class: 'chip primary', onclick: () => addPackage(a.path) }, '+ Csomag'),
        h('button', { class: 'chip', onclick: () => F.runCommand(`${pyCmd()} -m pip list`, dir) }, 'pip list'),
        hasReq ? h('button', { class: 'chip', onclick: () => F.runCommand(`${pyCmd()} -m pip install -r requirements.txt`, dir) }, 'requirements telepítése') : null,
        !info.venv ? h('button', { class: 'chip', onclick: async () => { await F.runCommand(`${pyCmd()} -m venv .venv`, dir); await F.refreshTree(); await loadInfo(a.path); F.refreshStageNow(); F.toast('Kész a .venv — mostantól a FACET ezzel futtat.', 'ok'); } }, '.venv létrehozása') : null)));
    const rc = h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'requirements.txt', h('span', { class: 'sub', text: dir || 'gyökér' })));
    if (!hasReq) {
      rc.append(h('div', { class: 'set-note', text: 'Ebben a fájlban soronként a projekt csomagjai vannak; mások ebből egy paranccsal telepíthetik őket.' }),
        h('button', { class: 'chip', style: { alignSelf: 'flex-start' }, onclick: async () => { await F.createFile(req, '# soronként egy csomag, pl.\n# requests\n'); F.refreshStageNow(); } }, 'requirements.txt létrehozása'));
    } else {
      const lines = (await F.textOf(req)).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
      if (!lines.length) rc.append(h('div', { class: 'set-note', text: 'Még üres.' }));
      lines.forEach((l) => rc.append(h('div', { class: 'npm-row' }, h('span', { class: 'nm', text: l.split(/[=<>~!\[ ]/)[0] }), h('code', { text: l.replace(/^[\w.\-]+/, '') || 'bármely verzió' }),
        h('button', { class: 'icon-btn', title: 'Eltávolítás (pip uninstall)', onclick: async () => { const n = l.split(/[=<>~!\[ ]/)[0]; if (await F.confirm('Csomag eltávolítása', `Eltávolítod: <b>${esc(n)}</b>?`, 'Eltávolítás', true)) { await F.runCommand(`${pyCmd()} -m pip uninstall -y ${n}`, dir); F.refreshStageNow(); } }, html: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2 L8 8 M8 2 L2 8" stroke="currentColor" stroke-width="1.4"/></svg>' }))));
      rc.append(h('button', { class: 'chip', style: { alignSelf: 'flex-start' }, onclick: () => F.open(req) }, 'Megnyitás'));
    }
    body.append(rc);
  }

  // ───────────── vázlat ─────────────
  function outline(model) {
    if (!model) return [];
    const items = [];
    blank(model.getValue()).split('\n').forEach((L, i) => {
      let m;
      if ((m = /^(\s*)class\s+(\w+)/.exec(L))) items.push({ k: 'C', c: ACC(), t: m[2], line: i + 1, col: m[1].length + 1, depth: Math.floor(m[1].length / 4) });
      else if ((m = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(([^)]*)/.exec(L))) items.push({ k: m[2].startsWith('__') ? 'ƒ' : 'm', c: m[1] ? '#7FB4FF' : '#E6C07B', t: m[2] + '(' + m[3].split(',').map((x) => x.trim().split(/[:=]/)[0]).filter((x) => x && x !== 'self' && x !== 'cls').join(', ') + ')', line: i + 1, col: m[1].length + 1, depth: Math.floor(m[1].length / 4) });
      else if ((m = /^([A-Z][A-Z0-9_]+)\s*=/.exec(L))) items.push({ k: 'K', c: '#F2928A', t: m[1], line: i + 1, col: 1, depth: 0 });
      else if (/^if\s+__name__\s*==/.test(L)) items.push({ k: '▶', c: ACC(), t: 'főprogram', line: i + 1, col: 1, depth: 0 });
    });
    return items;
  }

  // ───────────── sablonok ─────────────
  const SNIPS = [
    { k: 'main', l: 'if __name__ == "__main__"', t: 'def main() -> None:\n\t${1:pass}\n\n\nif __name__ == "__main__":\n\tmain()\n' },
    { k: 'def', l: 'Függvény', t: 'def ${1:nev}(${2:param}):\n\t"""${3:Mit csinál?}"""\n\t${0:pass}' },
    { k: 'class', l: 'Osztály', t: 'class ${1:Nev}:\n\tdef __init__(self, ${2:ertek}):\n\t\tself.${2:ertek} = ${2:ertek}\n\n\tdef __repr__(self):\n\t\treturn f"${1:Nev}(${2:ertek}={self.${2:ertek}!r})"\n' },
    { k: 'inputint', l: 'Szám bekérése biztonságosan', t: 'while True:\n\ttry:\n\t\t${1:szam} = int(input("${2:Adj meg egy számot}: "))\n\t\tbreak\n\texcept ValueError:\n\t\tprint("Ez nem egész szám, próbáld újra.")\n' },
    { k: 'for', l: 'for ciklus (enumerate)', t: 'for ${1:i}, ${2:elem} in enumerate(${3:lista}):\n\t${0:print(${1:i}, ${2:elem})}' },
    { k: 'with', l: 'Fájl olvasása', t: 'with open("${1:adat.txt}", encoding="utf-8") as f:\n\tfor sor in f:\n\t\t${0:print(sor.strip())}' },
    { k: 'try', l: 'try / except', t: 'try:\n\t${1:pass}\nexcept ${2:ValueError} as e:\n\tprint("Hiba:", e)' },
    { k: 'listcomp', l: 'Lista-értelmezés', t: '[${1:x} for ${1:x} in ${2:lista} if ${3:feltetel}]' },
    { k: 'dataclass', l: 'Dataclass', t: 'from dataclasses import dataclass\n\n\n@dataclass\nclass ${1:Pont}:\n\t${2:x}: ${3:float}\n\t${4:y}: ${5:float}\n' }
  ];

  async function format() {
    const a = F.active();
    if (!a || !a.model) return;
    if (F.fs.mode !== 'local') { F.toast('A formázáshoz a FACET alkalmazás kell.'); return; }
    let r;
    try { r = await F.apiJson('POST', 'py/format', { path: a.path }, a.model.getValue()); } catch (e) { F.toast(esc(e.message), 'err'); return; }
    if (!r.ok) {
      if (r.error === 'noblack') {
        if (await F.confirm('Formázás black-kel', 'A Python-kód formázásához a <b>black</b> csomag kell. Telepítsem most (<code>pip install black</code>)?', 'Telepítés')) await pipInstall('black', a.path);
      } else F.toast(r.error === 'nopython' ? 'Nincs Python a gépen.' : 'A formázás nem sikerült: ' + esc(r.error).slice(0, 300), 'err');
      return;
    }
    if (r.text !== a.model.getValue()) F.replaceAll(a.model, r.text, 'Formázás');
    F.toast('Formázva (black)', 'ok');
  }

  // ───────────── Python-forrás elemzése (térkép, generátorok) ─────────────
  const indentOf = (l) => (/^\s*/.exec(l)[0].replace(/\t/g, '    ').length);
  /** Egy blokk vége: az első nem üres sor, amely legfeljebb `ind` behúzású. */
  function blockEnd(code, start, ind) {
    let end = start;
    for (let i = start + 1; i < code.length; i++) {
      if (!code[i].trim()) continue;
      if (indentOf(code[i]) <= ind) break;
      end = i;
    }
    return end;
  }
  function defHead(code, i) {
    let head = code[i], k = i;
    while (!/\)\s*(->[^:]*)?:\s*$/.test(head.replace(/#.*$/, '')) && k < code.length - 1 && k < i + 12) { k++; head += ' ' + code[k].trim(); }
    return { head, last: k };
  }
  const splitParams = (p) => { const out = []; let depth = 0, cur = ''; for (const ch of p) { if ('([{'.includes(ch)) depth++; if (')]}'.includes(ch)) depth--; if (ch === ',' && !depth) { out.push(cur); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur); return out.map((x) => x.trim()).filter(Boolean); };
  const pyVis = (n) => (/^__\w+__$/.test(n) ? '+' : n.startsWith('__') ? '-' : n.startsWith('_') ? '#' : '+');

  function parsePy(src) {
    const code = blank(src).split('\n');
    const raw = src.split('\n');
    const res = { classes: [], funcs: [], imports: [], main: false, consts: [] };
    for (let i = 0; i < code.length; i++) {
      const L = code[i];
      let m;
      if (/^if\s+__name__\s*==/.test(L)) res.main = true;
      if ((m = /^import\s+(.+)$/.exec(L))) splitParams(m[1]).forEach((x) => res.imports.push(x.split(/\s+as\s+/)[0].trim()));
      if ((m = /^from\s+(\.*[\w.]*)\s+import\b/.exec(L))) res.imports.push(m[1]);
      if ((m = /^def\s+(\w+)\s*\(/.exec(L)) || (m = /^async\s+def\s+(\w+)\s*\(/.exec(L))) {
        const { head } = defHead(code, i);
        const pm = /\(([\s\S]*)\)\s*(?:->\s*([^:]+))?:/.exec(head);
        res.funcs.push({ name: m[1], params: pm ? splitParams(pm[1]) : [], ret: pm && pm[2] ? pm[2].trim() : '', line: i + 1 });
      }
      if ((m = /^([A-Z][A-Z0-9_]+)\s*(?::[^=]+)?=/.exec(L))) res.consts.push({ name: m[1], line: i + 1 });
      if ((m = /^(\s*)class\s+(\w+)\s*(?:\(([^)]*)\))?\s*:/.exec(L))) {
        const ind = indentOf(L);
        const decos = [];
        for (let k = i - 1; k >= 0 && /^\s*@/.test(raw[k]); k--) decos.push(raw[k].trim());
        const bases = m[3] ? splitParams(m[3]).map((b) => b.replace(/\[.*$/, '').split('.').pop()).filter((b) => b && !/=/.test(b)) : [];
        const end = blockEnd(code, i, ind);
        const c = { name: m[2], line: i + 1, end: end + 1, ind, bases, decos, fields: [], methods: [], uses: new Set(), abstract: false };
        let body = -1;
        for (let k = i + 1; k <= end; k++) if (code[k].trim()) { body = indentOf(code[k]); break; }
        const seen = new Set();
        const addField = (name, type, line, cls) => { if (seen.has(name)) return; seen.add(name); c.fields.push({ name, type: (type || '').trim(), line, cls: !!cls }); };
        for (let k = i + 1; k <= end; k++) {
          const B = code[k];
          if (!B.trim()) continue;
          const bi = indentOf(B);
          let x;
          if (bi === body && (x = /^\s*(?:async\s+)?def\s+(\w+)\s*\(/.exec(B))) {
            const md = [];
            for (let q = k - 1; q > i && /^\s*@/.test(raw[q]); q--) md.push(raw[q].trim());
            const { head } = defHead(code, k);
            const pm = /\(([\s\S]*)\)\s*(?:->\s*([^:]+))?:/.exec(head);
            const params = pm ? splitParams(pm[1]) : [];
            const meth = { name: x[1], params, ret: pm && pm[2] ? pm[2].trim() : '', line: k + 1, decos: md, ind: bi, end: blockEnd(code, k, bi) + 1 };
            if (md.some((d) => /abstractmethod/.test(d))) c.abstract = true;
            c.methods.push(meth);
            if (x[1] === '__init__') params.forEach((p) => { const pp = /^(\w+)\s*:\s*([^=]+)/.exec(p); if (pp) meth['t_' + pp[1]] = pp[2].trim(); });
          } else if (bi === body && (x = /^\s*(\w+)\s*(?::\s*([^=]+?))?\s*(=|$)/.exec(B)) && !/^\s*(return|pass|if|for|while|with|try|raise|import|from|print|del|assert|elif|else)\b/.test(B) && (x[2] || x[3] === '=')) {
            addField(x[1], x[2], k + 1, true);
          }
          const re = /self\.(\w+)\s*(?::\s*([^=]+?))?\s*=(?!=)/g;
          let y;
          while ((y = re.exec(B))) {
            const init = c.methods.find((mm) => mm.name === '__init__');
            addField(y[1], y[2] || (init && init['t_' + y[1]]) || '', k + 1, false);
          }
          const ure = /\b([A-Z]\w+)\s*\(/g;
          while ((y = ure.exec(B))) c.uses.add(y[1]);
          const are = /:\s*(?:list\[|List\[|Optional\[)?([A-Z]\w+)/g;
          while ((y = are.exec(B))) c.uses.add(y[1]);
        }
        if (bases.some((b) => /^(ABC|ABCMeta)$/.test(b))) c.abstract = true;
        c.kind = bases.some((b) => /^(Enum|IntEnum|StrEnum|Flag)$/.test(b)) ? 'enum' : bases.some((b) => b === 'Protocol') ? 'protocol' : c.abstract ? 'abstract' : decos.some((d) => /dataclass/.test(d)) ? 'dataclass' : bases.some((b) => /(Error|Exception)$/.test(b)) ? 'exception' : 'class';
        res.classes.push(c);
      }
    }
    // modulszintű használat (pl. a főprogram példányosít egy osztályt)
    res.modUses = new Set();
    code.forEach((L) => { if (indentOf(L) === 0 || res.funcs.length) { let y; const ure = /\b([A-Z]\w+)\s*\(/g; while ((y = ure.exec(L))) res.modUses.add(y[1]); } });
    return res;
  }
  PY.parse = parsePy;

  /** A projekt .py fájljai (a venv és a tesztek nélkül). */
  function projectFiles(path) {
    const d = projDir(path);
    return F.files().filter((p) => /\.pyw?$/.test(p) && (!d || p.startsWith(d + '/')) && !/(^|\/)(\.?venv|env|site-packages|__pycache__)\//.test(p));
  }

  // ───────────── Python-térkép + UML ─────────────
  const KIND = { class: 'osztály', abstract: 'absztrakt', enum: 'enum', dataclass: 'adatosztály', protocol: 'protokoll', exception: 'kivétel', module: 'modul' };
  const shortP = (params) => params.filter((p) => !/^(self|cls)\b/.test(p) && !/^\*$/.test(p)).map((p) => p.split('=')[0].trim()).join(', ');
  function umlLines(c) {
    const st = { abstract: null, enum: '&lt;&lt;enum&gt;&gt;', dataclass: '&lt;&lt;dataclass&gt;&gt;', protocol: '&lt;&lt;protocol&gt;&gt;', exception: '&lt;&lt;exception&gt;&gt;', module: '&lt;&lt;module&gt;&gt;' }[c.kind];
    const x = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lines = [];
    if (st) lines.push(st);
    lines.push(c.kind === 'abstract' ? '/' + c.name + '/' : c.name);
    lines.push('--');
    c.fields.forEach((f) => { const t = `${pyVis(f.name)}${f.name}${f.type ? ': ' + x(f.type) : ''}`; lines.push(f.cls && c.kind !== 'dataclass' && c.kind !== 'enum' ? '_' + t + '_' : t); });
    lines.push('--');
    c.methods.forEach((m) => {
      const ps = m.params.filter((p) => !/^(self|cls)\b/.test(p)).map((p) => { const pp = /^(\*{0,2}\w+)\s*(?::\s*([^=]+))?/.exec(p); return pp ? pp[1] + (pp[2] ? ': ' + x(pp[2].trim()) : '') : x(p); }).join(', ');
      let t = `${pyVis(m.name)}${m.name}(${ps})${m.ret && m.ret !== 'None' ? ': ' + x(m.ret) : ''}`;
      if (m.decos && m.decos.some((d) => /staticmethod|classmethod/.test(d))) t = '_' + t + '_';
      if (m.decos && m.decos.some((d) => /abstractmethod/.test(d))) t = '/' + t + '/';
      lines.push(t);
    });
    return lines;
  }

  let mapObs = null;
  async function mapPanel(body, a) {
    body.innerHTML = '';
    const files = projectFiles(a.path).filter((p) => !/(^|\/)test_[^/]*\.py$|_test\.py$/.test(p));
    const parsed = [];
    for (const p of files.slice(0, 120)) { try { parsed.push({ path: p, r: parsePy(await F.textOf(p)) }); } catch (e) { /* olvashatatlan */ } }
    const items = [];
    parsed.forEach(({ path, r }) => {
      const mod = path.split('/').pop().replace(/\.pyw?$/, '');
      if (r.funcs.length || r.main) items.push({ name: mod + '.py', mod, kind: 'module', path, line: 1, fields: r.consts.map((k) => ({ name: k.name, type: '', line: k.line, cls: false })), methods: r.funcs, main: r.main, bases: [], uses: r.modUses, imports: r.imports });
      r.classes.forEach((c) => items.push(Object.assign({ path, mod }, c)));
    });
    if (!items.length) { body.append(h('div', { class: 'stage-empty', text: 'Ebben a projektben még nincs függvény vagy osztály.' })); return; }
    const byName = new Map(items.filter((c) => c.kind !== 'module').map((c) => [c.name, c]));
    const mods = new Map(items.filter((c) => c.kind === 'module').map((c) => [c.mod, c]));
    const level = {};
    const lv = (c, seen = new Set()) => {
      if (level[c.name] != null) return level[c.name];
      if (seen.has(c.name)) return 0;
      seen.add(c.name);
      const parents = c.bases.filter((b) => byName.has(b));
      const l = parents.length ? 1 + Math.max(...parents.map((b) => lv(byName.get(b), seen))) : 0;
      level[c.name] = l;
      return l;
    };
    items.forEach((c) => { level[c.name] = c.kind === 'module' ? 0 : null; });
    items.filter((c) => c.kind !== 'module').forEach((c) => { level[c.name] = null; });
    items.forEach((c) => { if (c.kind !== 'module') lv(c); });
    // a modulok legfelül, az osztályok alattuk
    const hasMods = items.some((c) => c.kind === 'module');
    items.forEach((c) => { if (c.kind !== 'module' && hasMods) level[c.name] += 1; });
    const links = [];
    items.forEach((c) => {
      c.bases.forEach((b) => { if (byName.has(b) && b !== c.name) links.push({ from: c.name, to: b, type: 'ext' }); });
      (c.uses || new Set()).forEach((u) => { if (byName.has(u) && u !== c.name && !c.bases.includes(u) && !links.some((l) => l.from === c.name && l.to === u)) links.push({ from: c.name, to: u, type: 'use' }); });
      if (c.kind === 'module') (c.imports || []).forEach((im) => { const t = mods.get(im.replace(/^\.+/, '').split('.').pop()); if (t && t !== c && !links.some((l) => l.from === c.name && l.to === t.name)) links.push({ from: c.name, to: t.name, type: 'use' }); });
    });
    const rows = [];
    items.forEach((c) => { (rows[level[c.name]] = rows[level[c.name]] || []).push(c); });
    const wrap = h('div', { class: 'cmap' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'links');
    const grid = h('div', { class: 'cmap-grid' });
    const cards = {};
    rows.forEach((row) => {
      if (!row) return;
      const r = h('div', { class: 'cmap-row' });
      row.sort((x, y) => (y.main ? 1 : 0) - (x.main ? 1 : 0) || x.name.localeCompare(y.name)).forEach((c) => {
        const card = h('div', { class: 'ccard' + (c.main ? ' main' : '') + (c.path === a.path && c.kind === 'module' ? ' cur' : ''), title: c.path });
        card.append(h('div', { class: 'ch' }, h('span', { class: 'cn', text: c.name }), h('span', { class: 'ck', text: c.main ? 'fut · főprogram' : KIND[c.kind] })));
        const fl = c.fields.slice(0, 6), ml = c.methods.slice(0, 8);
        if (fl.length) card.append(h('div', { class: 'cs' }, fl.map((f) => h('div', { text: `${pyVis(f.name)} ${f.name}${f.type ? ': ' + f.type : ''}`, onclick: (e) => { e.stopPropagation(); F.openAt(c.path, f.line); } })), c.fields.length > 6 ? h('div', { style: { color: 'var(--muted-2)' }, text: `+${c.fields.length - 6} további` }) : null));
        if (ml.length) card.append(h('div', { class: 'cs' }, ml.map((m) => h('div', { text: `${pyVis(m.name)} ${m.name}(${shortP(m.params)})${m.ret && m.ret !== 'None' ? ': ' + m.ret : ''}`, onclick: (e) => { e.stopPropagation(); F.openAt(c.path, m.line); } })), c.methods.length > 8 ? h('div', { style: { color: 'var(--muted-2)' }, text: `+${c.methods.length - 8} további` }) : null));
        card.onclick = () => F.openAt(c.path, c.line);
        cards[c.name] = card;
        r.append(card);
      });
      grid.append(r);
    });
    wrap.append(svg, grid);
    body.append(wrap);
    body.append(h('div', { class: 'cmap-legend' }, h('span', null, h('i', { class: 'acc' }), 'öröklés'), h('span', null, h('i', { class: 'dash' }), 'használja / importálja')));
    body.append(h('div', { class: 'set-note', text: `${items.filter((c) => c.kind !== 'module').length} osztály · ${parsed.length} fájl · kattints egy tagra, és odaugrik a kódban.` }));
    body.append(h('div', { class: 'cmap-export' },
      h('button', { class: 'chip primary', onclick: () => exportUml(a, items, links, level) }, 'Exportálás UML-be (.uxf)'),
      h('span', { class: 'set-note', text: 'UMLet / UMLetino formátum' })));
    const draw = () => {
      const box = wrap.getBoundingClientRect();
      if (!box.width) return;
      svg.setAttribute('width', box.width); svg.setAttribute('height', box.height);
      const acc = ACC();
      let s = `<defs><marker id="ptri" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#0B0E13" stroke="${acc}" stroke-width="1.2"/></marker><marker id="parr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9" fill="none" stroke="#5A667A" stroke-width="1.4"/></marker></defs>`;
      links.forEach((l) => {
        if (!cards[l.from] || !cards[l.to]) return;
        const A = cards[l.from].getBoundingClientRect(), B = cards[l.to].getBoundingClientRect();
        let x1 = A.left + A.width / 2 - box.left, y1 = A.top - box.top, x2 = B.left + B.width / 2 - box.left, y2 = B.bottom - box.top;
        if (Math.abs(A.top - B.top) < 4) { y1 = A.top + A.height / 2 - box.top; y2 = B.top + B.height / 2 - box.top; x1 = A.left < B.left ? A.right - box.left : A.left - box.left; x2 = A.left < B.left ? B.left - box.left : B.right - box.left; }
        else if (A.top < B.top) { y1 = A.bottom - box.top; y2 = B.top - box.top; }
        const my = (y1 + y2) / 2;
        const d = Math.abs(A.top - B.top) < 4 ? `M${x1} ${y1} L${x2} ${y2}` : `M${x1} ${y1} C${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
        s += l.type === 'use' ? `<path d="${d}" fill="none" stroke="#5A667A" stroke-width="1.3" stroke-dasharray="3 4" marker-end="url(#parr)"/>` : `<path d="${d}" fill="none" stroke="${acc}" stroke-width="1.5" marker-end="url(#ptri)" opacity="0.85"/>`;
      });
      svg.innerHTML = s;
    };
    requestAnimationFrame(draw);
    if (mapObs) mapObs.disconnect();
    mapObs = new ResizeObserver(() => draw());
    mapObs.observe(wrap);
  }

  async function exportUml(a, items, links, level) {
    if (!F.java || !F.java.buildUxf) { F.toast('Az UML-export most nem érhető el.', 'err'); return; }
    const dir = projDir(a.path);
    const name = (dir ? dir.split('/').pop() : (F.state.engine && F.state.engine.name) || 'projekt').replace(/[^\w.-]+/g, '_');
    const v = await F.dialog({ title: 'UML-diagram exportálása', icon: true, iconColor: ACC(),
      text: `${items.length} elem és ${links.length} kapcsolat kerül a diagramba. A .uxf fájlt az <b>UMLet</b> vagy a böngészős <b>UMLetino</b> nyitja meg.`,
      fields: [{ id: 'p', label: 'Mentés ide', value: F.joinPath(dir, name + '.uxf') }], ok: 'Exportálás', validate: (x) => (/\.uxf$/i.test(x.p) ? null : 'A fájlnév végződése legyen .uxf') });
    if (!v) return;
    const shaped = items.map((c) => ({ name: c.name, umlLines: umlLines(c) }));
    const xml = F.java.buildUxf(shaped, links, level);
    await F.fs.write(v.p, xml);
    await F.refreshTree();
    F.toast(`UML-diagram mentve: <b>${esc(v.p)}</b>`, 'ok');
  }

  // ───────────── lépésenkénti futtatás ─────────────
  const T = PY.trace = { path: null, data: null, idx: 0, deco: null, timer: null };
  function clearDeco() { if (T.deco) { try { T.deco.clear(); } catch (e) { /* már nincs */ } T.deco = null; } }
  function stopPlay() { clearInterval(T.timer); T.timer = null; }
  async function showStep(i) {
    if (!T.data) return;
    const steps = T.data.steps;
    T.idx = Math.max(0, Math.min(steps.length - 1, i));
    const st = steps[T.idx];
    if (st && F.state.active !== st.file) { F.nav.lock = true; try { await F.open(st.file); } finally { setTimeout(() => { F.nav.lock = false; }, 60); } }
    clearDeco();
    if (st && F.editor && F.hasCode()) {
      T.deco = F.editor.createDecorationsCollection([{ range: new monaco.Range(st.line, 1, st.line, 1), options: { isWholeLine: true, className: 'py-step-line' + (st.e === 'exception' ? ' err' : st.e === 'return' ? ' ret' : ''), glyphMarginClassName: 'py-step-glyph' } }]);
      F.editor.revealLineInCenterIfOutsideViewport ? F.editor.revealLineInCenterIfOutsideViewport(st.line) : F.editor.revealLineInCenter(st.line);
    }
    if (F.stageTab() === 'trace') F.refreshStageNow();
  }
  async function startTrace(a, inputs) {
    stopPlay();
    if (F.fs.mode !== 'local') { F.toast('A lépésenkénti futtatáshoz a FACET alkalmazás kell.'); return; }
    await F.saveAll();
    F.store.set('pyInputs:' + a.path, inputs);
    T.path = a.path; T.data = null; T.busy = true;
    F.refreshStageNow();
    let r;
    try { r = await F.apiJson('POST', 'py/trace', { path: a.path }, inputs.replace(/\r/g, '') + (inputs.endsWith('\n') || !inputs ? '' : '\n')); } catch (e) { r = { ok: false, error: e.message }; }
    T.busy = false;
    if (!r || !r.steps) {
      T.data = null;
      F.toast(r && r.error === 'nopython' ? 'Nincs Python a gépen.' : r && r.error === 'timeout' ? 'A program 20 másodperc alatt sem ért véget (végtelen ciklus?).' : 'Nem sikerült: ' + esc(String(r && r.error || '')).slice(0, 300), 'err');
      F.refreshStageNow();
      return;
    }
    T.data = r;
    if (!r.steps.length) { F.toast('Nincs mit lépésenként mutatni.'); F.refreshStageNow(); return; }
    showStep(0);
  }
  function endTrace() { stopPlay(); clearDeco(); T.data = null; T.path = null; F.refreshStageNow(); }

  function tracePanel(body, a) {
    body.innerHTML = '';
    const d = T.data;
    if (T.busy) { body.append(h('div', { class: 'set-note', text: 'A program fut, közben minden lépést feljegyzek…' })); return; }
    if (!d) {
      const src = a.model ? a.model.getValue() : '';
      const needsInput = /\binput\s*\(/.test(blank(src));
      const ta = h('textarea', { class: 'field py-inputs', rows: 4, placeholder: 'pl.\nBence\n4,8', spellcheck: 'false' });
      ta.value = F.store.get('pyInputs:' + a.path, '');
      body.append(h('div', { class: 'card' },
        h('div', { class: 'card-title' }, 'Lépésenkénti futtatás', h('span', { class: 'sub', text: 'vizualizáló' })),
        h('div', { class: 'set-note', html: 'A FACET lefuttatja a programot, és minden lépésnél feljegyzi, <b>melyik sor fut</b> és <b>mi van a változókban</b>. Utána csúszkával előre-hátra lépkedhetsz benne.' }),
        needsInput ? h('div', { class: 'set-note', html: 'A program <code>input()</code>-tal kér adatot. Írd ide előre a válaszokat, <b>soronként egyet</b>:' }) : null,
        needsInput ? ta : null,
        h('button', { class: 'chip primary', style: { alignSelf: 'flex-start' }, onclick: () => startTrace(a, needsInput ? ta.value : '') }, '▶  Lépésenkénti futtatás')));
      body.append(h('div', { class: 'set-note', text: 'Legfeljebb 800 lépést jegyez fel, és 20 másodperc után leállítja a programot. A saját fájljaidba lép be, a beépített modulokba nem.' }));
      return;
    }
    const steps = d.steps, st = steps[T.idx], prev = steps[T.idx - 1];
    const ctl = h('div', { class: 'py-tctl' });
    const btn = (label, title, fn) => h('button', { class: 'icon-btn py-tbtn', title, onclick: fn }, label);
    const range = h('input', { type: 'range', min: 0, max: steps.length - 1, value: T.idx, class: 'py-trange', 'aria-label': 'Lépés' });
    range.oninput = () => { stopPlay(); showStep(+range.value); };
    ctl.append(btn('⏮', 'Elejére', () => { stopPlay(); showStep(0); }), btn('◀', 'Vissza egy lépést', () => { stopPlay(); showStep(T.idx - 1); }),
      btn(T.timer ? '⏸' : '⏵', T.timer ? 'Megállítás' : 'Lejátszás', () => { if (T.timer) { stopPlay(); F.refreshStageNow(); return; } if (T.idx >= steps.length - 1) showStep(0); T.timer = setInterval(() => { if (T.idx >= steps.length - 1) { stopPlay(); F.refreshStageNow(); return; } showStep(T.idx + 1); }, 650); F.refreshStageNow(); }),
      btn('▶', 'Következő lépés', () => { stopPlay(); showStep(T.idx + 1); }), btn('⏭', 'Végére', () => { stopPlay(); showStep(steps.length - 1); }));
    const what = st.e === 'return' ? `visszatér${st.ret != null ? ': ' + st.ret : ''}` : st.e === 'exception' ? 'kivétel: ' + (st.exc || '') : 'ez a sor következik';
    body.append(h('div', { class: 'card py-tcard' },
      h('div', { class: 'card-title' }, `Lépés ${T.idx + 1} / ${steps.length}${d.truncated ? '+' : ''}`, h('span', { class: 'sub', text: st.file.split('/').pop() + ':' + st.line })),
      range, ctl,
      h('div', { class: 'py-twhat ' + st.e, text: what })));
    // keretek (függvényhívások), a legutolsó a mostani
    const frames = st.stack || [];
    const prevFrames = prev ? prev.stack || [] : [];
    frames.slice().reverse().forEach((fr, ri) => {
      const i = frames.length - 1 - ri;
      const pf = prevFrames[i] && prevFrames[i].fn === fr.fn ? prevFrames[i].vars : {};
      const names = Object.keys(fr.vars).filter((k) => !(fr.fn === '(modul)' && (fr.vars[k][0] === 'fn' || fr.vars[k][0] === 'cls')));
      const fnNames = Object.keys(fr.vars).filter((k) => fr.fn === '(modul)' && (fr.vars[k][0] === 'fn' || fr.vars[k][0] === 'cls'));
      body.append(h('div', { class: 'py-frame' + (ri === 0 ? ' cur' : '') },
        h('div', { class: 'py-fh' }, h('b', { text: fr.fn === '(modul)' ? 'Globális (' + fr.file.split('/').pop() + ')' : fr.fn + '()' }), h('span', { text: 'sor ' + fr.line })),
        names.length ? h('div', { class: 'py-vars' }, names.map((k) => {
          const [t, v] = fr.vars[k];
          const changed = !pf[k] || pf[k][1] !== v;
          return h('div', { class: 'py-var' + (changed && T.idx > 0 ? ' changed' : '') }, h('span', { class: 'py-vn', text: k }), h('span', { class: 'py-vt', text: t }), h('span', { class: 'py-vv', text: v }));
        })) : h('div', { class: 'set-note', style: { padding: '2px 10px 8px' }, text: 'Még nincs változó.' }),
        fnNames.length ? h('div', { class: 'py-fns', text: fnNames.map((k) => fr.vars[k][1]).join(' · ') }) : null));
    });
    const outNow = d.out.slice(0, st.o), outPrev = prev ? d.out.slice(0, prev.o) : '';
    body.append(h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Kimenet', h('span', { class: 'sub', text: 'print()' })),
      outNow ? h('pre', { class: 'py-out' }, outPrev, h('mark', { text: outNow.slice(outPrev.length) })) : h('div', { class: 'set-note', text: 'Még nincs kimenet.' })));
    if (T.idx === steps.length - 1) {
      if (d.error) {
        const ex = PY.explain(d.error.split('\n').pop()) || PY.explain(d.error);
        body.append(h('div', { class: 'expl' }, h('div', { class: 'eh' }, h('span', { class: 'et', text: ex ? ex.t : 'A program hibával állt le' })), h('span', { class: 'eb', html: ex ? ex.b : esc(d.error.split('\n').pop()) })));
      } else body.append(h('div', { class: 'ok-card' }, h('span', { class: 'diamond' }), h('span', { text: d.truncated ? `Az első ${d.max} lépést mutatom.` : 'A program véget ért.' })));
    }
    body.append(h('div', { class: 'grid2' }, h('button', { class: 'chip', onclick: () => startTrace(a, F.store.get('pyInputs:' + a.path, '')) }, 'Újrafuttatás'), h('button', { class: 'chip', onclick: endTrace }, 'Bezárás')));
  }

  // ───────────── tesztek ─────────────
  const TEST_RE = /(^|\/)test_[^/]*\.py$|_test\.py$/;
  PY.tests = null;
  function parseTests(r) {
    const text = r.out + '\n' + r.err;
    const list = [];
    if (r.tool === 'pytest') {
      const re = /^(PASSED|FAILED|ERROR|SKIPPED|XFAIL|XPASS)\s+(\S+?\.py)(?:::(\S+?))?(?:::(\S+?))?(?:\s+-\s+(.*))?$/gm;
      let m;
      while ((m = re.exec(text))) {
        const name = m[4] || m[3] || m[2];
        list.push({ status: m[1] === 'PASSED' || m[1] === 'XFAIL' ? 'ok' : m[1] === 'SKIPPED' ? 'skip' : 'fail', file: m[2], cls: m[4] ? m[3] : '', name, msg: m[5] || '', id: m[0].split(/\s+/)[1] });
      }
    } else {
      const re = /^(\w+) \(([\w.]+)\)(?:\n[^\n]*?)?\s*\.\.\.\s*(ok|FAIL|ERROR|skipped.*|expected failure|unexpected success)$/gm;
      let m;
      while ((m = re.exec(text))) {
        const parts = m[2].split('.');
        if (parts[parts.length - 1] === m[1]) parts.pop();
        const cls = parts.pop() || '';
        const mod = parts.join('/');
        list.push({ status: m[3] === 'ok' || m[3] === 'expected failure' ? 'ok' : /^skipped/.test(m[3]) ? 'skip' : 'fail', file: mod + '.py', cls, name: m[1], msg: '' });
      }
      const blocks = text.split(/^={50,}$/m);
      blocks.forEach((b) => {
        const hm = /^(FAIL|ERROR): (\w+) \(([\w.]+)\)/m.exec(b);
        if (!hm) return;
        const t = list.find((x) => x.name === hm[2]);
        if (!t) return;
        const lines = b.trim().split('\n').filter((l) => l.trim() && !/^-{20,}$/.test(l));
        const errLine = lines.find((l) => /^\w+(Error|Exception)\b/.test(l)) || lines[lines.length - 1];
        t.msg = errLine ? errLine.trim() : '';
        const lm = /File "[^"]*?([^"/\\]+\.py)", line (\d+), in (\w+)/.exec(b);
        if (lm) t.line = +lm[2];
      });
    }
    return list;
  }
  function assertHu(msg) {
    let m;
    if ((m = /AssertionError: (.+?) != (.+)$/.exec(msg))) return `A kód ezt adta: <code>${esc(m[1])}</code>, a teszt ezt várta: <code>${esc(m[2])}</code>.`;
    if ((m = /assert (.+?) == (.+)$/.exec(msg))) return `A kód ezt adta: <code>${esc(m[1])}</code>, a teszt ezt várta: <code>${esc(m[2])}</code>.`;
    if ((m = /AssertionError: (.+?) not found in (.+)$/.exec(msg))) return `Nincs benne: <code>${esc(m[1])}</code> → <code>${esc(m[2])}</code>.`;
    if ((m = /AssertionError: (False|True) is not (true|false)/.exec(msg))) return `A feltétel értéke <code>${m[1]}</code> lett.`;
    const ex = PY.explain(msg);
    return ex ? ex.b : esc(msg);
  }
  async function runTests(a, only) {
    if (F.fs.mode !== 'local') { F.toast('A tesztekhez a FACET alkalmazás kell.'); return; }
    await F.saveAll();
    const dir = projDir(a.path);
    PY.tests = { busy: true };
    F.showStage('tests');
    let r;
    try { r = await F.apiJson('GET', 'py/test', { path: dir, only }); } catch (e) { r = { ok: false, error: e.message }; }
    if (!r.ok) { PY.tests = null; F.toast(r.error === 'nopython' ? 'Nincs Python a gépen.' : esc(r.error || 'Hiba'), 'err'); F.refreshStageNow(); return; }
    const list = parseTests(r);
    for (const t of list) {
      const rel = F.joinPath(r.dir, t.file);
      t.path = F.files().includes(rel) ? rel : F.files().find((p) => p.endsWith('/' + t.file)) || rel;
      if (!t.line) { try { const src = await F.textOf(t.path); const i = src.split('\n').findIndex((l) => new RegExp('def\\s+' + t.name + '\\b').test(l)); if (i >= 0) t.line = i + 1; } catch (e) { /* nincs */ } }
    }
    PY.tests = { r, list, at: Date.now() };
    F.bottom.show('terminal');
    F.term.row('tesztek', `${esc(r.tool)} · ${esc(r.cmd)}`, '', ACC());
    F.term.stream((r.out + (r.err ? '\n' + r.err : '')).trim() + '\n', r.code === 0 ? 't-out' : 't-err');
    F.problems.set('pytest', list.filter((t) => t.status === 'fail').map((t) => ({ file: t.path, line: t.line || 1, col: 1, sev: 'error', title: 'Hibás teszt: ' + t.name, detail: t.msg })));
    F.refreshStageNow();
    F.renderStageTabs();
  }
  async function newTestFile(a) {
    const src = a.model ? a.model.getValue() : await F.textOf(a.path);
    const r = parsePy(src);
    const mod = a.path.split('/').pop().replace(/\.py$/, '');
    const val = (p) => { const t = (/:\s*([^=]+)/.exec(p) || [])[1] || ''; return /str/.test(t) ? '"példa"' : /float/.test(t) ? '1.0' : /int/.test(t) ? '1' : /bool/.test(t) ? 'True' : /list|List/.test(t) ? '[]' : /dict|Dict/.test(t) ? '{}' : 'None'; };
    const args = (ps) => ps.filter((p) => !/^(self|cls|\*)/.test(p) && !/=/.test(p)).map(val).join(', ');
    const names = r.funcs.filter((f) => !f.name.startsWith('_') && f.name !== 'main').map((f) => f.name).concat(r.classes.map((c) => c.name));
    let out = 'import unittest\n\n';
    if (names.length) out += `from ${mod} import ${names.join(', ')}\n\n`;
    out += `\nclass Test${mod.replace(/(^|_)(\w)/g, (x, y, z) => z.toUpperCase())}(unittest.TestCase):\n`;
    const body = [];
    r.funcs.filter((f) => !f.name.startsWith('_') && f.name !== 'main').forEach((f) => body.push(`    def test_${f.name}(self):\n        eredmeny = ${f.name}(${args(f.params)})\n        self.assertIsNotNone(eredmeny)\n`));
    r.classes.forEach((c) => { const init = c.methods.find((m) => m.name === '__init__'); body.push(`    def test_${c.name.toLowerCase()}_letrehozasa(self):\n        obj = ${c.name}(${init ? args(init.params) : ''})\n        self.assertIsInstance(obj, ${c.name})\n`); });
    if (!body.length) body.push('    def test_pelda(self):\n        self.assertEqual(1 + 1, 2)\n');
    out += body.join('\n') + '\n\nif __name__ == "__main__":\n    unittest.main()\n';
    const path = F.joinPath(dirOf(a.path), 'test_' + mod + '.py');
    if (F.files().includes(path)) { F.open(path); return; }
    await F.createFile(path, out);
    F.toast(`Teszt létrehozva: <b>${esc(path.split('/').pop())}</b>. Írd át a várt értékeket, és futtasd!`, 'ok');
  }
  function testsPanel(body, a) {
    body.innerHTML = '';
    const tfiles = F.files().filter((p) => TEST_RE.test(p) && p.startsWith(projDir(a.path) ? projDir(a.path) + '/' : ''));
    const T2 = PY.tests;
    const top = h('div', { class: 'card' },
      h('div', { class: 'card-title' }, 'Tesztek', h('span', { class: 'sub', text: T2 && T2.r ? T2.r.tool : 'pytest / unittest' })),
      h('div', { class: 'set-note', html: tfiles.length ? `${tfiles.length} tesztfájl: ${tfiles.slice(0, 4).map((p) => '<code>' + esc(p.split('/').pop()) + '</code>').join(', ')}${tfiles.length > 4 ? '…' : ''}` : 'Még nincs teszt. A <code>test_</code> kezdetű fájlok tesztek: egy-egy függvényt hívnak meg, és ellenőrzik az eredményt.' }),
      h('div', { class: 'grid2' },
        h('button', { class: 'chip primary', disabled: !tfiles.length || (T2 && T2.busy), onclick: () => runTests(a) }, T2 && T2.busy ? 'Fut…' : '▶  Összes futtatása'),
        TEST_RE.test(a.path) ? null : h('button', { class: 'chip', onclick: () => newTestFile(a) }, 'Teszt ehhez a fájlhoz')));
    body.append(top);
    if (T2 && T2.list) {
      const fail = T2.list.filter((t) => t.status === 'fail').length, ok = T2.list.filter((t) => t.status === 'ok').length;
      body.append(h('div', { class: 'py-tsum ' + (fail || T2.r.code ? 'bad' : 'good') }, T2.list.length ? (fail ? `${fail} hibás · ${ok} sikeres` : `Mind a ${ok} teszt sikeres`) : (T2.r.code === 5 ? 'Nem találtam tesztet.' : 'A tesztek nem futottak le — a részletek a terminálban.'), h('span', { text: (T2.r.ms / 1000).toFixed(1).replace('.', ',') + ' s' })));
      T2.list.sort((x, y) => (x.status === 'fail' ? 0 : 1) - (y.status === 'fail' ? 0 : 1)).forEach((t) => {
        body.append(h('div', { class: 'py-test ' + t.status, onclick: () => t.path && F.openAt(t.path, t.line || 1, 1) },
          h('span', { class: 'py-tico', text: t.status === 'ok' ? '✓' : t.status === 'skip' ? '–' : '✗' }),
          h('div', { class: 'py-tbody' }, h('div', { class: 'py-tname' }, h('b', { text: t.name }), t.cls ? h('span', { text: t.cls }) : null),
            t.status === 'fail' && t.msg ? h('div', { class: 'py-tmsg', html: assertHu(t.msg) }) : null),
          T2.r.tool === 'pytest' && t.id ? h('button', { class: 'icon-btn', title: 'Csak ez a teszt', onclick: (e) => { e.stopPropagation(); runTests(a, t.id); }, html: '<svg width="10" height="10" viewBox="0 0 12 12"><path d="M3 1.5 L10.5 6 L3 10.5 Z" fill="currentColor"/></svg>' }) : null));
      });
    }
    if (!(T2 && T2.r && T2.r.tool === 'pytest')) body.append(h('div', { class: 'set-note', html: 'Ha telepíted a <b>pytest</b>-et (pip-panel → <code>pytest</code>), azzal fut, és egyenként is indíthatod a teszteket.' }));
  }

  // ───────────── generátorok ─────────────
  function cursorClass(model, line) {
    const r = parsePy(model.getValue());
    return r.classes.filter((c) => line >= c.line && line <= c.end).sort((x, y) => y.ind - x.ind)[0] || null;
  }
  function insertAt(line, text) {
    const model = F.editor.getModel();
    model.pushEditOperations([], [{ range: new monaco.Range(line, 1, line, 1), text }], () => null);
  }
  function genDocstring() {
    if (!F.hasCode()) return;
    const model = F.editor.getModel();
    const code = blank(model.getValue()).split('\n');
    let i = F.editor.getPosition().lineNumber - 1;
    while (i >= 0 && !/^\s*(async\s+)?def\s+\w+\s*\(/.test(code[i])) i--;
    if (i < 0) { F.toast('Állj egy függvénybe, és ahhoz írom a leírást.'); return; }
    const { head, last } = defHead(code, i);
    const pm = /\(([\s\S]*)\)\s*(?:->\s*([^:]+))?:/.exec(head);
    const params = pm ? splitParams(pm[1]).filter((p) => !/^(self|cls)\b/.test(p) && p !== '*' && p !== '/') : [];
    const end = blockEnd(code, i, indentOf(code[i]));
    const returns = (pm && pm[2] && pm[2].trim() !== 'None') || code.slice(i + 1, end + 1).some((l) => /\breturn\s+\S/.test(l));
    const next = model.getLineContent(last + 2) || '';
    if (/^\s*("""|''')/.test(next)) { F.toast('Ennek a függvénynek már van leírása.'); return; }
    const ind = ' '.repeat(indentOf(code[i]) + 4);
    let k = 2;
    let s = `${ind}"""\${1:Mit csinál ez a függvény?}\n`;
    if (params.length) { s += `\n${ind}Args:\n`; params.forEach((p) => { s += `${ind}    ${p.split(/[:=]/)[0].replace(/^\*+/, '').trim()}: \${${k++}:leírás}\n`; }); }
    if (returns) s += `\n${ind}Returns:\n${ind}    \${${k++}:mit ad vissza}\n`;
    s += `${ind}"""\n`;
    F.editor.setPosition({ lineNumber: last + 2, column: 1 });
    F.insertSnippet(s);
  }
  async function genInit() {
    if (!F.hasCode()) return;
    const model = F.editor.getModel();
    const c = cursorClass(model, F.editor.getPosition().lineNumber);
    if (!c) { F.toast('Állj egy osztályba (class), és ahhoz készítem.'); return; }
    if (c.methods.some((m) => m.name === '__init__')) { F.toast('Ennek az osztálynak már van __init__ metódusa.'); return; }
    const pre = c.fields.filter((f) => f.cls).map((f) => f.name + (f.type ? ': ' + f.type : '')).join(', ');
    const v = await F.dialog({ title: `__init__ — ${esc(c.name)}`, text: 'Add meg a mezőket vesszővel elválasztva, típussal vagy anélkül.', fields: [{ id: 'f', label: 'Mezők', value: pre, placeholder: 'pl. nev: str, kor: int, pontok: list' }], ok: 'Létrehozás', validate: (x) => (splitParams(x.f).every((p) => /^\w+\s*(:\s*[\w\[\], .|]+)?$/.test(p)) ? null : 'Formátum: nev: str, kor: int') });
    if (!v) return;
    const fs2 = splitParams(v.f);
    const ind = ' '.repeat(c.ind + 4), ind2 = ind + '    ';
    let s = `${ind}def __init__(self${fs2.length ? ', ' + fs2.join(', ') : ''}) -> None:\n`;
    s += fs2.length ? fs2.map((p) => { const n = p.split(':')[0].trim(); return `${ind2}self.${n} = ${n}\n`; }).join('') : `${ind2}pass\n`;
    const firstMethod = c.methods[0];
    const at = firstMethod ? firstMethod.line - (firstMethod.decos ? firstMethod.decos.length : 0) : c.end + 1;
    insertAt(at, s + (firstMethod ? '\n' : ''));
    F.toast('__init__ kész', 'ok');
  }
  function genRepr() {
    if (!F.hasCode()) return;
    const model = F.editor.getModel();
    const c = cursorClass(model, F.editor.getPosition().lineNumber);
    if (!c) { F.toast('Állj egy osztályba (class), és ahhoz készítem.'); return; }
    if (c.methods.some((m) => m.name === '__repr__')) { F.toast('Már van __repr__.'); return; }
    const attrs = c.fields.filter((f) => !f.cls || c.kind === 'dataclass').map((f) => f.name);
    const ind = ' '.repeat(c.ind + 4);
    const s = `\n${ind}def __repr__(self) -> str:\n${ind}    return f"${c.name}(${attrs.map((a) => `${a.replace(/^_+/, '')}={self.${a}!r}`).join(', ')})"\n`;
    insertAt(c.end + 1, s);
    F.toast('__repr__ kész', 'ok');
  }
  async function genProperty() {
    if (!F.hasCode()) return;
    const model = F.editor.getModel();
    const c = cursorClass(model, F.editor.getPosition().lineNumber);
    if (!c) { F.toast('Állj egy osztályba (class), és ahhoz készítem.'); return; }
    const attrs = c.fields.filter((f) => !f.cls);
    if (!attrs.length) { F.toast('Nincs self.mező ebben az osztályban.'); return; }
    const v = await F.dialog({ title: 'Getter és setter (@property)', text: 'Melyik mezőhöz? Ha a mező neve nem _-sal kezdődik, a FACET átnevezi (pl. <code>self.nev</code> → <code>self._nev</code>), így kívülről ugyanúgy <code>obj.nev</code> marad, de a beállítás a setteren megy át.', fields: [{ id: 'a', label: 'Mező', type: 'select', options: attrs.map((f) => ({ value: f.name, label: f.name + (f.type ? ': ' + f.type : '') })), value: attrs[0].name }, { id: 'set', type: 'checkbox', label: 'Setter is (beállításkor ellenőrizhető)', value: true }], ok: 'Létrehozás' });
    if (!v) return;
    const f = attrs.find((x) => x.name === v.a) || attrs[0];
    const pub = f.name.replace(/^_+/, '');
    const priv = '_' + pub;
    if (c.methods.some((m) => m.name === pub)) { F.toast(`Már van ${esc(pub)} nevű metódus.`); return; }
    const lines = model.getValue().split('\n');
    if (f.name !== priv) for (let k = c.line; k < c.end; k++) lines[k] = lines[k].replace(new RegExp('self\\.' + f.name + '\\b', 'g'), 'self.' + priv);
    const ind = ' '.repeat(c.ind + 4), i2 = ind + '    ';
    const t = f.type ? ` -> ${f.type}` : '';
    let s = `\n${ind}@property\n${ind}def ${pub}(self)${t}:\n${i2}return self.${priv}\n`;
    if (v.set) s += `\n${ind}@${pub}.setter\n${ind}def ${pub}(self, ertek${f.type ? ': ' + f.type : ''}) -> None:\n${i2}self.${priv} = ertek\n`;
    lines.splice(c.end, 0, ...s.replace(/\n$/, '').split('\n'));
    F.replaceAll(model, lines.join('\n'), 'property');
    F.toast(`@property kész: <b>${esc(pub)}</b>`, 'ok');
  }
  function genDataclass() {
    if (!F.hasCode()) return;
    const model = F.editor.getModel();
    const c = cursorClass(model, F.editor.getPosition().lineNumber);
    if (!c) { F.toast('Állj egy osztályba (class), és azt alakítom át.'); return; }
    if (c.kind === 'dataclass') { F.toast('Ez már dataclass.'); return; }
    const init = c.methods.find((m) => m.name === '__init__');
    if (!init) { F.toast('Ehhez kell egy __init__, amely a mezőket beállítja.'); return; }
    const lines = model.getValue().split('\n');
    const bodyLines = lines.slice(defHead(blank(model.getValue()).split('\n'), init.line - 1).last + 1, init.end).filter((l) => l.trim() && !/^\s*("""|''')/.test(l));
    const params = init.params.filter((p) => !/^self\b/.test(p));
    const ok = bodyLines.every((l) => { const m = /^\s*self\.(\w+)\s*(?::[^=]+)?=\s*(\w+)\s*$/.exec(l); return m && m[1] === m[2] && params.some((p) => p.split(/[:=]/)[0].trim() === m[1]); });
    if (!ok) { F.toast('Az __init__ mást is csinál, mint a mezők beállítása — ezt kézzel érdemes átírni.', 'warn'); return; }
    const ind = ' '.repeat(c.ind + 4);
    const fields = params.map((p) => { const m = /^(\w+)\s*(?::\s*([^=]+?))?\s*(?:=\s*(.+))?$/.exec(p.trim()); return `${ind}${m[1]}: ${m[2] ? m[2].trim() : 'object'}${m[3] ? ' = ' + m[3].trim() : ''}`; });
    const start = init.line - 1 - (init.decos ? init.decos.length : 0);
    lines.splice(start, init.end - start, ...fields);
    lines.splice(c.line - 1, 0, ' '.repeat(c.ind) + '@dataclass');
    if (!/^\s*from\s+dataclasses\s+import\b.*\bdataclass\b/m.test(lines.join('\n'))) {
      let at = 0;
      while (at < lines.length && (/^\s*("""|#|$)/.test(lines[at]) || /^(from __future__)/.test(lines[at]))) { if (/^\s*"""/.test(lines[at]) && !/""".*"""/.test(lines[at])) { at++; while (at < lines.length && !/"""/.test(lines[at])) at++; } at++; }
      lines.splice(at, 0, 'from dataclasses import dataclass', '', ''); if (lines[at + 3] === '') lines.splice(at + 3, 1);
    }
    F.replaceAll(model, lines.join('\n'), 'dataclass');
    F.toast(`<b>${esc(c.name)}</b> mostantól @dataclass`, 'ok');
  }

  // ───────────── konzol (REPL) ─────────────
  const q = (p) => (/[\s"']/.test(p) ? '"' + p.replace(/"/g, '\\"') + '"' : p);
  async function repl(a, withFile) {
    if (F.fs.mode !== 'local') { F.toast('A Python-konzolhoz a FACET alkalmazás kell.'); return; }
    await loadInfo(a ? a.path : '');
    if (!PY.info || !PY.info.python) { noPython(); return; }
    if (withFile && a) await F.saveAll();
    F.toast(withFile ? 'A program lefut, utána a változói elérhetők a konzolban. Kilépés: <code>exit()</code>' : 'Python-konzol: írj egy kifejezést, és Enter. Kilépés: <code>exit()</code>');
    await F.runCommand(`${pyCmd()} -u -i -q${withFile && a ? ' ' + q(a.path.split('/').pop()) : ''}`, a ? dirOf(a.path) : '');
  }

  // ───────────── facet ─────────────
  F.extendFacet('py', {
    run, runLabel: 'Futtatás', bottom: 'terminal', hint: 'Interaktív: az input() itt kér bemenetet', outline,
    tools: [
      { label: 'print', kbd: 'pr', run: () => F.insertSnippet('print(${1})') },
      { label: 'input → szám', run: () => F.insertSnippet('${1:szam} = int(input("${2:Szám}: "))') },
      { label: 'Függvény', kbd: 'def', run: () => F.insertSnippet(SNIPS[1].t) },
      { label: 'Osztály', run: () => F.insertSnippet(SNIPS[2].t) },
      { label: 'main', run: () => F.insertSnippet(SNIPS[0].t) },
      { label: 'Lépésenként', title: 'Lépésenkénti futtatás változókkal', when: () => F.fs.mode === 'local', run: () => F.showStage('trace') },
      { label: 'Konzol', title: 'Python-konzol (REPL)', when: () => F.fs.mode === 'local', run: () => repl(F.active(), false) },
      { label: 'Generálás', title: 'docstring, __init__, __repr__, @property, @dataclass', run: (e) => genMenu(e) },
      { label: 'Tesztek', when: () => F.fs.mode === 'local', run: () => F.showStage('tests') },
      { label: 'pip', when: () => F.fs.mode === 'local', run: () => F.showStage('pip') },
      { label: 'Formázás', title: 'black', run: format }
    ],
    stage: [
      { id: 'tips', label: () => { const a = F.active(); const n = a ? (tips.get(a.path) || []).length + (syntax.get(a.path) || []).length : 0; return 'Tanácsok' + (n ? ` <span class="count">${n}</span>` : ''); }, render: tipsPanel },
      { id: 'trace', label: 'Lépésenként', when: () => F.fs.mode === 'local', render: tracePanel },
      { id: 'map', label: 'Térkép', render: (b, a) => { mapPanel(b, a); } },
      { id: 'tests', label: () => { const t = PY.tests && PY.tests.list; const n = t ? t.filter((x) => x.status === 'fail').length : 0; return 'Tesztek' + (n ? ` <span class="count">${n}</span>` : ''); }, when: () => F.fs.mode === 'local', render: testsPanel },
      { id: 'pip', label: 'pip', when: () => F.fs.mode === 'local', render: (b, a) => { pipPanel(b, a); } },
      { id: 'snippets', label: 'Sablonok', render: (body) => {
        body.innerHTML = '';
        const list = h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Sablonok', h('span', { class: 'sub', text: 'gépeld + Tab' })));
        SNIPS.forEach((x) => list.append(h('button', { class: 'npm-row py-snip', title: 'Beszúrás a kurzorhoz', onclick: () => F.insertSnippet(x.t) }, h('code', { text: x.k }), h('span', { class: 'nm', text: x.l }))));
        body.append(list);
      } }
    ],
    onActivate: (path, model) => { applyLint(path, model); loadInfo(path); if (PY.running) $('#runLabel').textContent = 'Leállítás'; },
    onChange: (path, model) => applyLint(path, model),
    onSave: (path) => check(path),
    onClose: (path) => { tips.delete(path); syntax.delete(path); F.problems.set('py:' + path, []); F.problems.set('pysyn:' + path, []); }
  });

  F.on('editor', () => {
    monaco.languages.registerCompletionItemProvider('python', {
      provideCompletionItems(model, position) {
        const w = model.getWordUntilPosition(position);
        const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: w.startColumn, endColumn: w.endColumn };
        return { suggestions: SNIPS.map((s) => ({ label: s.k, kind: monaco.languages.CompletionItemKind.Snippet, detail: s.l, insertText: s.t.replace(/\t/g, '    '), insertTextRules: 4, range })) };
      }
    });
    monaco.languages.registerCodeActionProvider('python', {
      provideCodeActions(model, range) {
        const entry = [...F.state.docs].find(([, d]) => d.model === model);
        if (!entry) return { actions: [], dispose() {} };
        const list = (tips.get(entry[0]) || []).filter((d) => d.fix && d.line === range.startLineNumber);
        return {
          actions: list.map((d) => ({ title: 'FACET: ' + d.fix.label, kind: 'quickfix', isPreferred: true, edit: { edits: [{ resource: model.uri, textEdit: { range: new monaco.Range(d.line, d.col, d.endLine || d.line, d.endLine ? d.endLineCol : d.endCol), text: d.fix.text }, versionId: model.getVersionId() }] } })),
          dispose() {}
        };
      }
    });
  });

  F.settingsPage.addCategory({ id: 'python', label: 'Python', icon: 'Py' }, 'keys');
  F.settingsPage.add({ cat: 'python', id: 'pyCheck', type: 'toggle', label: 'Élő szintaxis-ellenőrzés', desc: 'Mentéskor a FACET a háttérben ellenőrzi a Python-fájlt, és azonnal jelzi a hibát.' });
  if (F.settings.pyCheck == null) F.settings.pyCheck = true;
  F.DEFAULTS.pyCheck = true;

  function genMenu(e) {
    const r = (e && e.currentTarget ? e.currentTarget : document.querySelector('#toolbar')).getBoundingClientRect();
    F.menu(r.left, r.bottom + 6, [
      { label: 'Docstring a függvényhez', run: genDocstring },
      { label: '__init__ a mezőkből', run: genInit },
      { label: '__repr__', run: genRepr },
      { label: 'Getter/setter (@property)', run: genProperty },
      { label: 'Átalakítás @dataclass-szá', run: genDataclass },
      '-',
      { label: 'Teszt ehhez a fájlhoz', run: () => { const a = F.active(); if (a) newTestFile(a); } }
    ]);
  }

  const C = (label, keywords, runFn, icon) => F.command({ label, keywords, run: runFn, icon: icon || 'Py', facet: 'py' });
  C('Python: lépésenkénti futtatás', 'debug vizualizalo lepesenkent valtozok trace step', () => F.showStage('trace'), '⏯');
  C('Python: konzol (REPL)', 'repl konzol interaktiv shell', () => repl(F.active(), false), '>>>');
  C('Python: futtatás, utána konzol (python -i)', 'repl interaktiv utana', () => repl(F.active(), true), '>>>');
  C('Python: térkép (osztályok, modulok)', 'uml diagram osztaly terkep', () => F.showStage('map'), '◇');
  C('Python: UML exportálása (.uxf)', 'uml uxf umlet export', () => F.showStage('map'), '◇');
  C('Python: tesztek futtatása', 'test pytest unittest teszt', () => { const a = F.active(); if (a) runTests(a); }, '✓');
  C('Python: teszt ehhez a fájlhoz', 'test teszt letrehozas unittest', () => { const a = F.active(); if (a) newTestFile(a); }, '✓');
  C('Python: docstring a függvényhez', 'docstring dokumentacio leiras', genDocstring, '"""');
  C('Python: __init__ a mezőkből', 'init konstruktor generalas', genInit, 'ƒ');
  C('Python: __repr__', 'repr tostring generalas', genRepr, 'ƒ');
  C('Python: getter/setter (@property)', 'property getter setter', genProperty, 'ƒ');
  C('Python: átalakítás @dataclass-szá', 'dataclass adatosztaly', genDataclass, 'ƒ');
  C('Python: csomag telepítése (pip)…', 'pip install csomag package', () => addPackage(F.active() ? F.active().path : ''), '+');
  C('Python: pip panel', 'pip venv requirements', () => F.showStage('pip'), 'p');
  C('Python: formázás (black)', 'format black formazd', format, '≡');
  C('Python: tanácsok', 'lint tanacs hibak', () => F.showStage('tips'), '!');
})();
