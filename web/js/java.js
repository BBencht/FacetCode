/* FACET — Java facet
   Elemző, vázlat, osztálytérkép, generátorok, Hibatolmács, kódkiegészítés,
   formázó és interaktív futtatás a helyi motorral. */
(function () {
  'use strict';
  const { h, esc, $, $$ } = F;
  const J = {};

  // ───────────── elemző ─────────────
  /** Kommentek és szövegek kitakarása (a hossz és a sorok megmaradnak). */
  function blank(src) {
    let out = '', i = 0;
    const n = src.length;
    while (i < n) {
      const c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') { out += ' '; i++; } continue; }
      if (c === '/' && d === '*') { out += '  '; i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; } if (i < n) { out += '  '; i += 2; } continue; }
      if (c === '"' && src.slice(i, i + 3) === '"""') {
        out += '"""'; i += 3;
        while (i < n && src.slice(i, i + 3) !== '"""') { out += src[i] === '\n' ? '\n' : ' '; i++; }
        if (i < n) { out += '"""'; i += 3; }
        continue;
      }
      if (c === '"' || c === "'") {
        out += c; i++;
        while (i < n && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') { out += ' '; i++; } out += ' '; i++; }
        if (i < n && src[i] === c) { out += c; i++; }
        continue;
      }
      out += c; i++;
    }
    return out;
  }
  J.blank = blank;

  const KW = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'else', 'do', 'try', 'throw', 'synchronized', 'case', 'assert', 'super', 'this']);
  const MODS = '(?:public|private|protected|static|final|abstract|synchronized|native|default|strictfp|transient|volatile|sealed|non-sealed)';

  function parse(src) {
    const code = blank(src);
    const lines = code.split('\n');
    const raw = src.split('\n');
    const res = { pkg: '', imports: [], classes: [], hasMain: false };
    const pm = code.match(/^\s*package\s+([\w.]+)\s*;/m);
    if (pm) res.pkg = pm[1];
    code.replace(/^\s*import\s+(static\s+)?([\w.*]+)\s*;/gm, (m, s, imp) => { res.imports.push(imp); return m; });
    const stack = [];
    let depth = 0;
    for (let li = 0; li < lines.length; li++) {
      const L = lines[li];
      const top = stack[stack.length - 1];
      const t = L.trim();
      if (t) {
        const cm = /(^|[^.\w])(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/.exec(L);
        if (cm && !/^\s*(return|new)\b/.test(L) && !/=\s*new\b/.test(L.slice(0, cm.index + 1))) {
          let decl = L, k = li;
          while (!decl.includes('{') && k < lines.length - 1 && k < li + 6) { k++; decl += ' ' + lines[k]; }
          const head = decl.slice(0, decl.indexOf('{') >= 0 ? decl.indexOf('{') : decl.length);
          const ext = (/\bextends\s+([\w$.<>, ]+?)(?=\s+implements\b|\s*$|\s*\{)/.exec(head) || [])[1];
          const imp = (/\bimplements\s+([\w$.<>, ]+?)\s*$/.exec(head) || [])[1];
          const kind = cm[2];
          const abs = /\babstract\b/.test(head) && kind === 'class';
          const cls = {
            name: cm[3], kind: abs ? 'abstract' : kind, line: li + 1, endLine: lines.length, openDepth: depth,
            ext: ext && kind !== 'interface' ? ext.replace(/<.*$/, '').trim() : null,
            impls: ((kind === 'interface' ? ext : imp) || '').split(',').map((s) => s.replace(/<.*$/, '').trim()).filter(Boolean),
            fields: [], methods: [], ctors: [], uses: new Set(), main: false, indent: (raw[li].match(/^\s*/) || [''])[0],
            vis: (/\b(public|private|protected)\b/.exec(head) || [, ''])[1]
          };
          if (kind === 'interface' && ext) cls.impls = ext.split(',').map((s) => s.replace(/<.*$/, '').trim()).filter(Boolean);
          res.classes.push(cls);
          cls.pending = true;
        } else if (top && depth === top.openDepth + 1) {
          member(top, L, li + 1);
        }
        if (top) {
          const re = /\bnew\s+([A-Z][\w$]*)\s*[(<[]/g; let m;
          while ((m = re.exec(L))) top.uses.add(m[1]);
        }
      }
      for (const ch of L) {
        if (ch === '{') {
          const pend = res.classes.find((c) => c.pending);
          if (pend) { pend.pending = false; pend.openDepth = depth; stack.push(pend); }
          depth++;
        } else if (ch === '}') {
          depth--;
          const tp = stack[stack.length - 1];
          if (tp && depth === tp.openDepth) { tp.endLine = li + 1; stack.pop(); }
        }
      }
    }
    res.classes.forEach((c) => { delete c.pending; c.main = c.methods.some((m) => m.name === 'main' && m.mods.includes('static')); });
    res.hasMain = res.classes.some((c) => c.main);
    return res;
  }

  function member(cls, L, line) {
    if (/^\s*@/.test(L) && !/\)\s*\w/.test(L)) return;
    const s = L.replace(/@\w+(\([^)]*\))?\s*/g, '');
    const ctor = new RegExp('^\\s*(?:(?:public|private|protected)\\s+)?' + cls.name + '\\s*\\(([^)]*)').exec(s);
    if (ctor) { cls.ctors.push({ name: cls.name, params: ctor[1].trim(), line, mods: (/\b(public|private|protected)\b/.exec(s) || [, ''])[1] }); return; }
    const meth = new RegExp('^\\s*((?:' + MODS + '\\s+)*)(<[^>]+>\\s+)?([\\w$.<>\\[\\],? ]+?)\\s+([a-zA-Z_$][\\w$]*)\\s*\\(([^)]*)').exec(s);
    if (meth && !KW.has(meth[4]) && !KW.has(meth[3].trim()) && !s.slice(0, s.indexOf('(')).includes('=')) {
      cls.methods.push({ name: meth[4], ret: meth[3].trim(), params: meth[5].trim(), mods: meth[1].trim(), line });
      return;
    }
    if (cls.kind === 'enum' && /^\s*[A-Z_][A-Z0-9_]*\s*(\(|,|;|$)/.test(s)) return;
    const fld = new RegExp('^\\s*((?:' + MODS + '\\s+)*)([\\w$.<>\\[\\],? ]+?)\\s+([a-zA-Z_$][\\w$]*)\\s*(=|;|,)').exec(s);
    if (fld && !KW.has(fld[2].trim().split(/\s/)[0]) && !/^(return|throw|package|import)$/.test(fld[2].trim())) {
      cls.fields.push({ name: fld[3], type: fld[2].trim(), mods: fld[1].trim(), line });
    }
  }
  J.parse = parse;

  const visSym = (mods) => (/private/.test(mods) ? '−' : /protected/.test(mods) ? '#' : /public/.test(mods) ? '+' : '~');
  const KIND_HU = { class: 'osztály', abstract: 'absztrakt', interface: 'interfész', enum: 'enum', record: 'record' };
  const KIND_K = { class: 'C', abstract: 'A', interface: 'I', enum: 'E', record: 'R' };

  // ───────────── vázlat ─────────────
  function outline(model) {
    const p = parse(model.getValue());
    const out = [];
    p.classes.forEach((c) => {
      const depth = p.classes.filter((o) => o !== c && o.line < c.line && o.endLine > c.endLine).length;
      out.push({ k: KIND_K[c.kind], c: '#6FD3C1', t: c.name + (c.ext ? ' : ' + c.ext : ''), line: c.line, depth });
      c.fields.forEach((f) => out.push({ k: 'f', c: '#B9A6F7', t: f.name + ': ' + f.type, line: f.line, depth: depth + 1 }));
      c.ctors.forEach((m) => out.push({ k: 'c', c: '#F5C451', t: m.name + '(' + shortParams(m.params) + ')', line: m.line, depth: depth + 1 }));
      c.methods.forEach((m) => out.push({ k: 'm', c: '#7FB4FF', t: m.name + '(' + shortParams(m.params) + ')', line: m.line, depth: depth + 1 }));
    });
    return out;
  }
  const shortParams = (p) => p.split(',').map((x) => x.trim().split(/\s+/).slice(0, -1).join(' ')).filter(Boolean).join(', ');

  // ───────────── projekt ─────────────
  const project = (p) => F.projectOf(p);
  const javaFiles = (proj) => F.javaFilesOf(proj);
  async function parseProject(proj) {
    const out = [];
    for (const p of javaFiles(proj)) {
      try { out.push({ path: p, parsed: parse(await F.textOf(p)) }); } catch (e) { /* olvasási hiba */ }
    }
    return out;
  }

  // ───────────── diagnosztika ─────────────
  J.diags = {};   // projekt → lista
  J.checkedAt = {};
  J.lint = {};    // útvonal → lista

  const IMPORTS = {
    Scanner: 'java.util.Scanner', ArrayList: 'java.util.ArrayList', List: 'java.util.List', HashMap: 'java.util.HashMap', Map: 'java.util.Map',
    HashSet: 'java.util.HashSet', Set: 'java.util.Set', LinkedList: 'java.util.LinkedList', Random: 'java.util.Random', Arrays: 'java.util.Arrays',
    Collections: 'java.util.Collections', Objects: 'java.util.Objects', Optional: 'java.util.Optional', Iterator: 'java.util.Iterator',
    TreeMap: 'java.util.TreeMap', TreeSet: 'java.util.TreeSet', Queue: 'java.util.Queue', Deque: 'java.util.Deque', ArrayDeque: 'java.util.ArrayDeque',
    Stack: 'java.util.Stack', Comparator: 'java.util.Comparator', LinkedHashMap: 'java.util.LinkedHashMap', StringJoiner: 'java.util.StringJoiner',
    LocalDate: 'java.time.LocalDate', LocalDateTime: 'java.time.LocalDateTime', LocalTime: 'java.time.LocalTime', Duration: 'java.time.Duration',
    DateTimeFormatter: 'java.time.format.DateTimeFormatter', File: 'java.io.File', FileReader: 'java.io.FileReader', FileWriter: 'java.io.FileWriter',
    BufferedReader: 'java.io.BufferedReader', BufferedWriter: 'java.io.BufferedWriter', IOException: 'java.io.IOException', PrintWriter: 'java.io.PrintWriter',
    InputStreamReader: 'java.io.InputStreamReader', FileNotFoundException: 'java.io.FileNotFoundException', Files: 'java.nio.file.Files', Path: 'java.nio.file.Path',
    Paths: 'java.nio.file.Paths', Collectors: 'java.util.stream.Collectors', Stream: 'java.util.stream.Stream', IntStream: 'java.util.stream.IntStream',
    Function: 'java.util.function.Function', Predicate: 'java.util.function.Predicate', Consumer: 'java.util.function.Consumer', Supplier: 'java.util.function.Supplier',
    BigDecimal: 'java.math.BigDecimal', BigInteger: 'java.math.BigInteger', InputMismatchException: 'java.util.InputMismatchException',
    NoSuchElementException: 'java.util.NoSuchElementException', ThreadLocalRandom: 'java.util.concurrent.ThreadLocalRandom'
  };
  J.IMPORTS = IMPORTS;

  function lev(a, b) {
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 3) return 9;
    const d = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1));
    return d[m][n];
  }
  function similar(name, text) {
    const words = new Set(blank(text).match(/[A-Za-z_$][\w$]*/g) || []);
    let best = null, bd = 3;
    words.forEach((w) => { if (w !== name) { const d = lev(name, w); if (d < bd || (d === bd && best && w.length === name.length)) { bd = d; best = w; } } });
    return bd <= 2 ? best : null;
  }

  /** A javac-hiba magyar magyarázata és lehetséges javítása. */
  function explain(d, text) {
    const msg = d.message || '';
    const first = msg.split('\n')[0];
    const code = (d.code || '').replace(/^compiler\.(err|warn|note)\./, '');
    const sym = (/symbol:\s+(\w+)\s+([^\n(]+)(\([^)]*\))?/.exec(msg) || []);
    const r = { title: 'Fordítási hiba', body: esc(first), hint: '', fixes: [] };
    switch (code) {
      case 'expected': case 'expected2': case 'expected3': case 'expected4': {
        const toks = (first.match(/'([^']+)'/g) || []).map((t) => t.slice(1, -1));
        const tok = toks[0] || '';
        if (tok === ';') {
          r.title = 'Hiányzik a pontosvessző';
          r.body = 'A Java minden utasítást <code>;</code> jellel zár le. Ennek a sornak a végéről valószínűleg lemaradt.';
          r.hint = 'Gyakori ennél a hibánál: a következő sor is pirosra vált, pedig az jó.';
          r.fixes.push({ label: 'Javítás · ; beszúrása', insert: ';' });
        } else if (tok === ')' || tok === ']' || tok === '}') {
          r.title = `Hiányzik egy ${tok} zárójel`;
          r.body = `A fordító itt egy <code>${esc(tok)}</code> jelet várt. Számold össze a nyitó és záró zárójeleket ebben a sorban.`;
          r.fixes.push({ label: `Javítás · ${tok} beszúrása`, insert: tok });
        } else if (tok === '<identifier>') {
          r.title = 'Itt egy névnek kellene állnia';
          r.body = 'A fordító ezen a helyen egy változó-, metódus- vagy osztálynevet várt. Gyakori ok: utasítás az osztály törzsében, metóduson kívül, vagy hiányzó típus egy paraméter előtt.';
        } else {
          r.title = 'Szintaktikai hiba';
          r.body = `A fordító itt ezt várta: ${toks.map((t) => '<code>' + esc(t) + '</code>').join(' vagy ')}.`;
        }
        break;
      }
      case 'cant.resolve': case 'cant.resolve.location': case 'cant.resolve.location.args': case 'cant.resolve.args': case 'cant.resolve.location.args.params': {
        const kind = sym[1], name = (sym[2] || '').trim();
        if (kind === 'class') {
          r.title = 'Ismeretlen osztály: ' + name;
          if (IMPORTS[name]) {
            r.body = `A(z) <code>${esc(name)}</code> a Java könyvtárában van, de nincs importálva. Kell a fájl elejére: <code>import ${IMPORTS[name]};</code>`;
            r.fixes.push({ label: 'Import hozzáadása', importName: IMPORTS[name] });
          } else {
            r.body = `A fordító nem ismeri a(z) <code>${esc(name)}</code> osztályt. Elírtad, vagy még nem hoztad létre ebben a projektben?`;
            const s = similar(name, text); if (s) r.fixes.push({ label: `Erre gondoltál: ${s}?`, replace: s, from: name });
            r.fixes.push({ label: `${name} osztály létrehozása`, createClass: name });
          }
        } else if (kind === 'variable') {
          r.title = 'Ismeretlen változó: ' + name;
          r.body = `A(z) <code>${esc(name)}</code> változó itt nem létezik. Elírtad, vagy egy másik blokkban (pl. cikluson vagy if-en belül) hoztad létre, és onnan nem látszik.`;
          const s = similar(name, text); if (s) r.fixes.push({ label: `Erre gondoltál: ${s}?`, replace: s, from: name });
        } else if (kind === 'method') {
          r.title = 'Ismeretlen metódus: ' + name + '()';
          r.body = `Nincs <code>${esc(name)}</code> nevű metódus ilyen paraméterekkel. Ellenőrizd a nevét (kis- és nagybetű!) és a paraméterek számát és típusát.`;
          const s = similar(name, text); if (s) r.fixes.push({ label: `Erre gondoltál: ${s}?`, replace: s, from: name });
        } else {
          r.title = 'Ismeretlen név: ' + (name || '?');
          r.body = 'A fordító nem találja ezt a nevet. Elírás vagy hiányzó deklaráció valószínű.';
        }
        break;
      }
      case 'prob.found.req': {
        const lossy = /lossy conversion from (\S+) to (\S+)/.exec(msg);
        const conv = /(\S+) cannot be converted to (\S+)/.exec(msg);
        r.title = 'Nem illő típusok';
        if (lossy) {
          r.body = `Adatvesztéssel járna: <code>${lossy[1]}</code> → <code>${lossy[2]}</code>. Ha szándékos, írj elé kasztolást: <code>(${lossy[2]}) érték</code>, különben változtasd a változó típusát <code>${lossy[1]}</code>-ra.`;
        } else if (conv) {
          r.body = `Egy <code>${esc(conv[1])}</code> értéket nem lehet <code>${esc(conv[2])}</code> helyére tenni.`;
          if (conv[1] === 'String' && /int|double|long|float/.test(conv[2])) r.body += ` Szövegből számot így kapsz: <code>${conv[2] === 'int' ? 'Integer.parseInt' : conv[2] === 'double' ? 'Double.parseDouble' : 'Long.parseLong'}(szoveg)</code>.`;
          if (/int|double|long|float|boolean|char/.test(conv[1]) && conv[2] === 'String') r.body += ' Számból szöveget így kapsz: <code>String.valueOf(szam)</code>.';
        }
        break;
      }
      case 'missing.ret.stmt':
        r.title = 'Hiányzik a return';
        r.body = 'A metódusnak minden lehetséges ágon vissza kell adnia egy értéket. Nézd meg az if/else ágakat: van olyan út, ahol nincs <code>return</code>.';
        break;
      case 'var.might.not.have.been.initialized':
        r.title = 'Érték nélküli változó';
        r.body = `A(z) <code>${esc((/variable (\w+)/.exec(first) || [])[1] || '')}</code> változó lehet, hogy még nem kapott értéket, mire használod. Adj neki kezdőértéket a deklarációnál.`;
        break;
      case 'already.defined': {
        const nm = (/(variable|method|class) (\w+)/.exec(first) || [])[2] || '';
        r.title = 'Kétszer deklarált név';
        r.body = `A(z) <code>${esc(nm)}</code> már létezik ebben a hatókörben. Ha csak új értéket akarsz adni, hagyd el a típust a sor elejéről.`;
        break;
      }
      case 'duplicate.class': {
        const nm = (/duplicate class: ([\w.$]+)/.exec(first) || [])[1] || '';
        r.title = 'Kétszer létező osztály: ' + nm;
        r.body = `Ugyanebben a projektben két fájl is <code>${esc(nm)}</code> nevű osztályt tartalmaz. Egy projektben minden osztálynév csak egyszer szerepelhet: nevezd át az egyiket, vagy tedd külön projektbe (külön mappába saját <code>src</code>-vel).`;
        break;
      }
      case 'class.public.should.be.in.file': {
        const nm = (/class (\w+) is public/.exec(first) || [])[1] || '';
        r.title = 'Az osztály és a fájl neve eltér';
        r.body = `A publikus <code>${esc(nm)}</code> osztálynak <code>${esc(nm)}.java</code> nevű fájlban kell lennie.`;
        if (nm) r.fixes.push({ label: `Fájl átnevezése: ${nm}.java`, renameTo: nm + '.java' });
        break;
      }
      case 'premature.eof':
        r.title = 'Hiányzik egy záró }';
        r.body = 'A fájl véget ért, mielőtt minden kapcsos zárójel bezáródott volna. Valószínűleg egy metódus vagy az osztály végéről hiányzik egy <code>}</code>.';
        r.fixes.push({ label: '} hozzáadása a végére', appendEnd: '}\n' });
        break;
      case 'not.stmt':
        r.title = 'Ez nem utasítás';
        r.body = 'Ez a kifejezés önmagában nem csinál semmit. Lehet, hogy <code>=</code> helyett <code>==</code>-t írtál, vagy kimaradt egy metódushívás.';
        break;
      case 'illegal.start.of.expr': case 'illegal.start.of.type':
        r.title = 'Szabálytalan kezdet';
        r.body = 'Ezen a ponton nem kezdődhet kifejezés. Gyakori ok: hiányzó vagy felesleges zárójel, vagy egy metódust egy másik metóduson belül írtál meg.';
        break;
      case 'cant.apply.symbol': case 'cant.apply.symbols': {
        const req = (/required:\s*(.+)/.exec(msg) || [])[1], fnd = (/found:\s*(.+)/.exec(msg) || [])[1];
        r.title = 'Rossz paraméterek';
        r.body = 'A metódust vagy konstruktort más paraméterekkel kell hívni.' + (req ? ` Ezt várja: <code>${esc(req.trim())}</code>` : '') + (fnd ? `, ezt kapta: <code>${esc(fnd.trim())}</code>.` : '');
        break;
      }
      case 'non-static.cant.be.ref': {
        const nm = (/non-static (?:method|variable) ([\w(),\s]+?) cannot/.exec(first) || [])[1] || '';
        r.title = 'Statikus környezetből nem elérhető';
        r.body = `A <code>static</code> metódusból (pl. main) nem éred el közvetlenül a nem statikus <code>${esc(nm)}</code>-t. Hozz létre egy objektumot (<code>new Osztaly()</code>), vagy tedd a tagot is <code>static</code>-ká.`;
        break;
      }
      case 'unreachable.stmt':
        r.title = 'Elérhetetlen kód';
        r.body = 'Ide sosem jut el a program, mert előtte egy <code>return</code>, <code>break</code> vagy végtelen ciklus áll.';
        break;
      case 'else.without.if':
        r.title = 'else if nélkül';
        r.body = 'Ennek az <code>else</code>-nek nincs párja. Gyakran egy pontosvessző áll az <code>if (...)</code> után, vagy hiányzik egy kapcsos zárójel.';
        break;
      case 'does.not.override.abstract': {
        const m = /(\w+) is not abstract and does not override abstract method (\S+) in (\w+)/.exec(first);
        r.title = 'Hiányzó metódus-megvalósítás';
        r.body = m ? `A(z) <code>${esc(m[1])}</code> osztálynak meg kell valósítania ezt: <code>${esc(m[2])}</code> (a(z) ${esc(m[3])} miatt).` : esc(first);
        break;
      }
      case 'unreported.exception.need.to.catch.or.throw': {
        const ex = (/exception (\S+)/.exec(first) || [])[1] || 'Exception';
        r.title = 'Kezeletlen kivétel';
        r.body = `A(z) <code>${esc(ex)}</code> kivételt kezelni kell: tedd a hívást <code>try { … } catch (${esc(ex.split('.').pop())} e) { … }</code> blokkba, vagy írd a metódus fejlécébe: <code>throws ${esc(ex.split('.').pop())}</code>.`;
        break;
      }
      case 'report.access': {
        const m = /(\w+) has (private|protected) access/.exec(first);
        r.title = 'Nem elérhető tag';
        r.body = m ? `A(z) <code>${esc(m[1])}</code> ${m[2] === 'private' ? 'privát' : 'védett'}, ebből az osztályból nem érhető el. Használj gettert vagy settert.` : esc(first);
        break;
      }
      case 'unclosed.str.lit':
        r.title = 'Lezáratlan szöveg';
        r.body = 'Hiányzik a záró idézőjel <code>"</code> a szöveg végéről.';
        r.fixes.push({ label: '" beszúrása a sor végére', appendLine: '"' });
        break;
      case 'missing.meth.body.or.decl.abstract':
        r.title = 'Hiányzik a metódus törzse';
        r.body = 'A metódus fejléce után <code>{ … }</code> törzs kell. Ha a fejléc végén <code>;</code> van, töröld.';
        break;
      case 'invalid.meth.decl.ret.type.req':
        r.title = 'Hiányzik a visszatérési típus';
        r.body = 'Írd a metódus neve elé, mit ad vissza (pl. <code>void</code>, <code>int</code>). Ha konstruktornak szántad, a nevének pontosan egyeznie kell az osztály nevével.';
        break;
      case 'operator.cant.be.applied': case 'operator.cant.be.applied.1': case 'incomparable.types':
        r.title = 'Nem alkalmazható művelet';
        r.body = 'Ez a műveleti jel nem használható ezekkel a típusokkal. ' + esc(first);
        break;
      case 'ref.ambiguous':
        r.title = 'Kétértelmű hivatkozás';
        r.body = 'Több azonos nevű elem is illik ide. Adj meg pontosabb típust vagy teljes nevet.';
        break;
      case 'facet.no.jdk':
        r.title = 'Nincs Java fordító';
        r.body = 'A FACET motorja JRE-vel fut, de a fordításhoz JDK kell. Telepíts JDK-t (pl. Eclipse Temurin 21), majd indítsd újra a FACET-et.';
        break;
      default:
        if (/^warn/.test(d.code || '') || d.kind === 'WARNING' || d.kind === 'MANDATORY_WARNING') r.title = 'Figyelmeztetés';
    }
    return r;
  }
  J.explain = explain;

  // ───────────── FACET saját tanácsai (lint) ─────────────
  function lint(model) {
    const text = model.getValue();
    const code = blank(text);
    const lines = text.split('\n');
    const out = [];
    code.split('\n').forEach((L, i) => {
      const raw = lines[i];
      let m;
      const re = /(\b[a-z_]\w*\b|"[^"]*"|\))\s*(==|!=)\s*(\b[a-z_]\w*\b|"[^"]*")/g;
      while ((m = re.exec(raw))) {
        const hasStr = m[1].startsWith('"') || m[3].startsWith('"');
        if (!hasStr) continue;
        out.push({ line: i + 1, col: m.index + 1, endCol: m.index + m[0].length + 1, sev: 'warn', title: 'Szöveget .equals()-szal hasonlíts', body: `A <code>${esc(m[2])}</code> szövegeknél azt nézi, ugyanaz-e az objektum, nem azt, hogy egyezik-e a tartalom. Használd így: <code>${m[2] === '!=' ? '!' : ''}a.equals(b)</code>.`, code: 'facet.string.eq' });
      }
    });
    const nextNum = [], nextLine = [];
    code.split('\n').forEach((L, i) => {
      if (/\.(nextInt|nextDouble|nextLong|nextFloat|nextBoolean|next)\s*\(\s*\)/.test(L)) nextNum.push(i + 1);
      if (/\.nextLine\s*\(\s*\)/.test(L)) nextLine.push(i + 1);
    });
    if (nextNum.length && nextLine.length) {
      const after = nextLine.find((l) => nextNum.some((n) => n < l));
      if (after) {
        const col = lines[after - 1].indexOf('nextLine') + 1;
        out.push({ line: after, col, endCol: col + 8, sev: 'warn', code: 'facet.scanner.mix', title: 'Scanner csapda: nextLine() szám beolvasása után', body: 'A <code>nextInt()</code> (vagy nextDouble) nem olvassa be a sor végi Entert, ezért az utána jövő <code>nextLine()</code> üres szöveget kap. Megoldás: olvass mindent <code>nextLine()</code>-nal, és alakítsd át: <code>Integer.parseInt(be.nextLine())</code>.' });
      }
    }
    return out;
  }

  // ───────────── jelölők és Hibatolmács-lencsék ─────────────
  function diagsForFile(path) {
    const list = (J.diags[project(path)] || []).filter((d) => d.file === path);
    return list.concat(J.lint[path] || []);
  }

  function applyMarkers() {
    for (const [path, doc] of F.state.docs) {
      if (doc.facet !== 'java') continue;
      const list = diagsForFile(path);
      monaco.editor.setModelMarkers(doc.model, 'facet-java', list.map((d) => {
        const lineLen = doc.model.getLineCount() >= d.line ? doc.model.getLineMaxColumn(d.line) : 1;
        const col = Math.max(1, Math.min(d.col || 1, lineLen));
        return {
          startLineNumber: d.line, startColumn: col, endLineNumber: d.line, endColumn: Math.max(col + 1, Math.min(d.endCol || col + 1, lineLen)),
          severity: d.sev === 'warn' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error,
          message: (d.title || '') + '\n' + stripTags(d.body || d.message || ''), source: d.sev === 'warn' && d.code && d.code.startsWith('facet') ? 'FACET tanács' : 'javac',
          code: d.code
        };
      }));
    }
    refreshLens();
    renderProblems();
    F.renderStageTabs();
    if (F.stageTab() === 'errors' && F.state.facet === 'java') F.refreshStage();
  }
  const stripTags = (s) => String(s).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

  function enrich(d, text) {
    if (d.title) return d;
    const e = explain(d, text);
    return Object.assign({}, d, { title: e.title, body: e.body, hint: e.hint, fixes: e.fixes, sev: d.kind === 'ERROR' ? 'err' : 'warn' });
  }

  function renderProblems() {
    const all = [];
    Object.values(J.diags).forEach((list) => list.forEach((d) => all.push({ file: d.file, line: d.line, col: d.col, sev: d.sev, title: d.title, detail: (d.code || '').startsWith('facet') ? 'FACET tanács' : d.message.split('\n')[0] })));
    Object.entries(J.lint).forEach(([p, list]) => list.forEach((d) => all.push({ file: p, line: d.line, col: d.col, sev: 'warn', title: d.title, detail: 'FACET tanács' })));
    F.problems.set('java', all);
  }

  let zoneIds = [], lensDecos = null;
  function refreshLens() {
    const ed = F.editor;
    if (!ed) return;
    ed.changeViewZones((acc) => { zoneIds.forEach((id) => acc.removeZone(id)); zoneIds = []; });
    if (lensDecos) lensDecos.clear();
    const a = F.active();
    if (!a || a.facet !== 'java') return;
    const list = diagsForFile(a.path).filter((d) => d.line <= a.model.getLineCount());
    const errLines = list.filter((d) => d.sev !== 'warn').map((d) => d.line);
    lensDecos = ed.createDecorationsCollection(errLines.map((l) => ({ range: new monaco.Range(l, 1, l, 1), options: { isWholeLine: true, className: 'facet-err-line', glyphMarginClassName: 'facet-err-glyph' } })));
    if (!F.settings.lens) return;
    const shown = [];
    list.sort((x, y) => (x.sev === 'warn') - (y.sev === 'warn') || x.line - y.line).forEach((d) => { if (shown.length < 3 && !shown.find((s) => s.line === d.line)) shown.push(d); });
    const layout = ed.getLayoutInfo();
    ed.changeViewZones((acc) => {
      shown.forEach((d) => {
        const node = lensNode(d, a);
        node.style.width = Math.max(240, layout.contentWidth - 40) + 'px';
        const meas = h('div', { style: { position: 'absolute', visibility: 'hidden', left: '-9999px', top: '0' } }, node);
        document.body.append(meas);
        const hgt = node.offsetHeight;
        meas.remove();
        const wrap = h('div', { style: { paddingLeft: '4px' } }, node);
        zoneIds.push(acc.addZone({ afterLineNumber: d.line, heightInPx: hgt + 8, domNode: wrap, suppressMouseDown: false }));
      });
    });
  }
  J.refreshLens = refreshLens;

  function lensNode(d, a) {
    const node = h('div', { class: 'lens' + (d.sev === 'warn' ? ' warn' : '') },
      h('span', { class: 'lt', text: d.sev === 'warn' ? 'Tanács' : 'Hibatolmács' }),
      h('span', { class: 'lm', html: '<b style="font-weight:600">' + esc(d.title) + '.</b> ' + (d.body || '') }));
    const acts = h('span', { class: 'la' });
    (d.fixes || []).slice(0, 2).forEach((fx, i) => {
      const b = h('button', { class: i === 0 ? 'fix' : '', text: fx.label });
      b.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); });
      b.addEventListener('click', (e) => { e.stopPropagation(); applyFix(d, fx, a.path); });
      acts.append(b);
    });
    const why = h('button', { text: 'Részletek' });
    why.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); });
    why.addEventListener('click', (e) => { e.stopPropagation(); F.showStage('errors'); });
    acts.append(why);
    node.append(acts);
    return node;
  }

  async function applyFix(d, fx, path) {
    if (F.state.active !== path) await F.open(path);
    const model = F.editor.getModel();
    const line = Math.min(d.line, model.getLineCount());
    const edits = [];
    if (fx.insert) {
      const col = Math.min(d.col || model.getLineMaxColumn(line), model.getLineMaxColumn(line));
      edits.push({ range: new monaco.Range(line, col, line, col), text: fx.insert });
    } else if (fx.appendLine) {
      const c = model.getLineMaxColumn(line);
      edits.push({ range: new monaco.Range(line, c, line, c), text: fx.appendLine });
    } else if (fx.appendEnd) {
      const last = model.getLineCount(), c = model.getLineMaxColumn(last);
      edits.push({ range: new monaco.Range(last, c, last, c), text: (model.getLineContent(last).trim() ? '\n' : '') + fx.appendEnd });
    } else if (fx.replace) {
      const lt = model.getLineContent(line);
      const re = new RegExp('\\b' + fx.from.replace(/\$/g, '\\$') + '\\b', 'g');
      let best = null, m;
      while ((m = re.exec(lt))) { if (!best || Math.abs(m.index + 1 - d.col) < Math.abs(best.index + 1 - d.col)) best = m; }
      if (best) edits.push({ range: new monaco.Range(line, best.index + 1, line, best.index + 1 + fx.from.length), text: fx.replace });
    } else if (fx.importName) {
      addImport(model, fx.importName);
    } else if (fx.createClass) {
      const dir = path.split('/').slice(0, -1).join('/');
      const p = dir + '/' + fx.createClass + '.java';
      await F.createFile(p, window.FacetSamples.javaClass(p, fx.createClass, 'class', false), false);
      F.toast(`<b>${esc(fx.createClass)}.java</b> létrehozva`, 'ok');
      check(path);
      return;
    } else if (fx.renameTo) {
      const np = path.split('/').slice(0, -1).concat(fx.renameTo).join('/');
      await F.save(path);
      F.renameItemDirect(path, np);
      return;
    }
    if (edits.length) model.pushEditOperations([], edits, () => null);
    J.diags[project(path)] = (J.diags[project(path)] || []).filter((x) => x !== d);
    applyMarkers();
    F.editor.focus();
    await F.save(path);
  }

  function addImport(model, imp) {
    const text = model.getValue();
    if (new RegExp('^\\s*import\\s+' + imp.replace(/\./g, '\\.') + '\\s*;', 'm').test(text)) return false;
    const lines = text.split('\n');
    let at = 0;
    lines.forEach((l, i) => { if (/^\s*(package|import)\s/.test(l)) at = i + 1; });
    const pkgOnly = at > 0 && !lines.slice(0, at).some((l) => /^\s*import\s/.test(l));
    const ins = (pkgOnly ? '\n' : '') + 'import ' + imp + ';\n' + (at === 0 ? '\n' : '');
    model.pushEditOperations([], [{ range: new monaco.Range(at + 1, 1, at + 1, 1), text: ins }], () => null);
    return true;
  }
  J.addImport = addImport;

  F.renameItemDirect = async (from, to) => {
    try { await F.fs.rename(from, to); } catch (e) { F.toast(esc(e.message), 'err'); return; }
    const doc = F.state.docs.get(from);
    if (doc) { doc.saved = doc.model.getAlternativeVersionId(); await F.closeFile(from); }
    await F.refreshTree();
    await F.open(to);
    F.toast('Átnevezve: <b>' + esc(to.split('/').pop()) + '</b>', 'ok');
  };

  // ───────────── fordítás (élő ellenőrzés) ─────────────
  let checking = null;
  async function check(path) {
    if (F.fs.mode !== 'local' || !path) return;
    const proj = project(path);
    if (checking) return;
    checking = proj;
    try {
      const r = await F.apiJson('POST', 'java/compile', { path });
      setDiags(proj, r.diagnostics || []);
    } catch (e) { /* a motor nem érhető el */ }
    checking = null;
  }
  J.check = check;
  async function setDiags(proj, list) {
    const out = [];
    let all = '';
    if (list.length) for (const p of javaFiles(proj)) { try { all += '\n' + (await F.textOf(p)); } catch (e) { /* nincs */ } }
    for (const d of list) out.push(enrich(d, all));
    J.diags[proj] = out;
    J.checkedAt[proj] = Date.now();
    applyMarkers();
  }
  const checkSoon = F.debounce((p) => { if (F.settings.liveCheck && !J.running) check(p); }, 500);

  // ───────────── futtatás ─────────────
  J.running = null;
  async function run(a) {
    if (J.running) { stop(); return; }
    F.bottom.show('terminal');
    F.term.clear();
    if (F.fs.mode !== 'local') {
      F.term.row('demó', 'A Java futtatásához a helyi FACET motor kell. Indítsd el a <b>start.command</b> fájllal, majd nyisd meg a <b>http://localhost:7777</b> címet.', 't-bad', 'var(--warn)');
      return;
    }
    const proj = project(a.path);
    const args = F.store.get('args:' + proj, '');
    const argList = args ? (args.match(/"[^"]*"|\S+/g) || []).map((x) => x.replace(/^"|"$/g, '')) : [];
    F.term.row('futtatás', esc(a.path) + (argList.length ? '  ·  argumentumok: ' + esc(args) : ''), '', F.facets.java.accent);
    setRunning(true);
    let res;
    try {
      res = await F.apiJson('POST', 'java/run', { path: a.path, arg: argList });
    } catch (e) {
      F.term.row('hiba', 'A motor nem válaszol: ' + esc(e.message), 't-bad', 'var(--err)');
      setRunning(false);
      return;
    }
    await setDiags(proj, res.diagnostics || []);
    if (!res.ok) {
      setRunning(false);
      if (res.phase === 'compile') {
        const errs = J.diags[proj].filter((d) => d.sev !== 'warn');
        F.term.row('fordítás', `${errs.length} hiba · ${res.ms} ms — a Hibatolmács elmagyarázza`, 't-bad', 'var(--err)');
        errs.slice(0, 8).forEach((d) => {
          F.term.html(`<div class="t-row"><span class="t-tag"></span><span class="t-msg"><span class="t-link" data-path="${esc(d.file)}" data-line="${d.line}" data-col="${d.col}">${esc(d.file.split('/').pop())}:${d.line}</span> · <span style="color:#F1D9DC">${esc(d.title)}</span></span></div>`);
        });
        F.showStage('errors');
        const first = errs[0];
        if (first) F.openAt(first.file, first.line, first.col);
      } else {
        F.term.row('main', esc(res.error || 'Nem indítható.'), 't-bad', 'var(--err)');
      }
      return;
    }
    F.term.row('fordítás', `kész · ${res.ms} ms`, 't-ok', 'var(--ok)');
    F.term.row('indítás', esc(res.main), '', 'var(--muted-2)');
    const id = res.id;
    J.running = { id, err: '' };
    F.term.input(true, (text) => {
      if (text === null) F.api('POST', 'proc/input', { id, eof: 1 }, '');
      else F.api('POST', 'proc/input', { id }, text).then(async (r) => { if (!r.ok) F.term.row('bemenet', 'A program már nem fogad bemenetet.', 't-bad', 'var(--muted-2)'); });
    });
    setTimeout(() => { if (J.running && J.running.id === id) $('#termIn').focus(); }, 50);
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
          if (ev.t === 'out') F.term.stream(ev.d, 't-out');
          else if (ev.t === 'err') { F.term.stream(ev.d, 't-err'); if (J.running) J.running.err += ev.d; }
          else if (ev.t === 'exit') onExit(ev, proj);
        }
      }
    } catch (e) {
      F.term.row('kapcsolat', 'Megszakadt a kapcsolat a futó programmal.', 't-bad', 'var(--err)');
    }
    if (J.running && J.running.id === id) { J.running = null; setRunning(false); }
  }

  function onExit(ev, proj) {
    const err = J.running ? J.running.err : '';
    J.running = null;
    setRunning(false);
    const s = (ev.ms / 1000).toFixed(2).replace('.', ',');
    if (ev.code === 0) F.term.row('kilépés', `kód 0 · ${s} s`, '', 'var(--muted-2)');
    else F.term.row('kilépés', `kód ${ev.code} · ${s} s`, ev.code === 137 || ev.code === 143 ? '' : 't-bad', ev.code === 137 || ev.code === 143 ? 'var(--muted-2)' : 'var(--err)');
    const m = /Exception in thread "main" ([\w.$]+)(?::\s*([^\n]*))?/.exec(err) || /^([\w.$]+(?:Exception|Error))(?::\s*([^\n]*))?/m.exec(err);
    if (m) {
      const ex = m[1].split('.').pop();
      const projFiles = javaFiles(proj).map((p) => p.split('/').pop());
      const frames = [...err.matchAll(/\(([\w$]+\.java):(\d+)\)/g)];
      const at = frames.find((f) => projFiles.includes(f[1])) || null;
      const info = EXC[ex] || { t: ex, b: 'A program futás közben hibával leállt. A piros sorok mutatják, hol.' };
      const where = at ? ` A hiba helye: <span class="t-link" data-jfile="${esc(at[1])}" data-line="${at[2]}">${esc(at[1])}:${at[2]}</span>.` : '';
      F.term.html(`<div class="t-card"><b>Hibatolmács · ${esc(info.t)}</b><span>${info.b}${m[2] ? ` <span style="color:#A88D92">(${esc(m[2])})</span>` : ''}${where}</span></div>`);
      if (at) jumpToJava(at[1], +at[2], proj, true);
    }
  }

  const EXC = {
    ArrayIndexOutOfBoundsException: { t: 'Túlindexelés', b: 'Olyan indexet kértél a tömbből, ami nem létezik. Egy <code>n</code> elemű tömb indexei 0-tól <code>n−1</code>-ig mennek, a ciklusfeltétel legyen <code>i &lt; tomb.length</code>.' },
    StringIndexOutOfBoundsException: { t: 'Túlindexelés a szövegben', b: 'Nincs ilyen pozíció a szövegben. A <code>charAt</code> és <code>substring</code> indexei 0-tól <code>length()−1</code>-ig érvényesek.' },
    IndexOutOfBoundsException: { t: 'Túlindexelés a listában', b: 'A lista nem tartalmaz ennyi elemet. Az érvényes indexek: 0 … <code>lista.size()−1</code>.' },
    NullPointerException: { t: 'null értéken hívott metódus', b: 'Egy változó értéke <code>null</code> (még nem hoztál létre benne objektumot), és mégis metódust hívtál rajta vagy mezőt olvastál.' },
    ArithmeticException: { t: 'Osztás nullával', b: 'Egész számok között nullával osztottál. Ellenőrizd az osztót az osztás előtt.' },
    NumberFormatException: { t: 'Nem szám a szöveg', b: 'A szöveget nem lehetett számmá alakítani. Lehet benne szóköz, betű, vagy tizedesvessző pont helyett.' },
    InputMismatchException: { t: 'Nem várt bemenet', b: 'A Scanner mást kapott, mint amit vártál, például számot kértél <code>nextInt()</code>-tel, de szöveg érkezett.' },
    NoSuchElementException: { t: 'Elfogyott a bemenet', b: 'A Scanner több bemenetet várt, de a bemenet lezárult. A terminálban írj be valamit és nyomj Entert.' },
    ClassCastException: { t: 'Hibás típuskényszerítés', b: 'Egy objektumot olyan típusra kasztoltál, ami valójában nem az. Használj <code>instanceof</code> ellenőrzést előtte.' },
    ConcurrentModificationException: { t: 'Módosítás bejárás közben', b: 'Egy listát módosítottál, miközben for-each ciklussal bejártad. Használj <code>Iterator</code>-t vagy <code>removeIf</code>-et.' },
    StackOverflowError: { t: 'Túl mély rekurzió', b: 'Egy metódus túl sokszor hívta önmagát. Valószínűleg hiányzik vagy sosem teljesül a rekurzió leállási feltétele.' },
    OutOfMemoryError: { t: 'Elfogyott a memória', b: 'A program túl sok objektumot hozott létre, például egy végtelen ciklus folyamatosan bővít egy listát.' },
    IllegalArgumentException: { t: 'Érvénytelen paraméter', b: 'Egy metódus olyan paramétert kapott, amit nem fogad el.' },
    IllegalStateException: { t: 'Rossz állapot', b: 'Egy objektumon olyan műveletet hívtál, ami a jelenlegi állapotában nem megengedett (pl. lezárt Scanner).' },
    UnsupportedOperationException: { t: 'Nem támogatott művelet', b: 'Ez a gyűjtemény nem módosítható (pl. <code>List.of(...)</code> eredménye). Másold egy <code>new ArrayList&lt;&gt;(...)</code>-ba.' },
    FileNotFoundException: { t: 'Nincs ilyen fájl', b: 'A megadott fájl nem található. Az útvonal a projekt mappájához képest értendő.' }
  };

  function jumpToJava(file, line, proj, quiet) {
    const cands = javaFiles(proj).filter((p) => p === file || p.endsWith('/' + file));
    const p = cands[0] || F.files().find((x) => x.endsWith('/' + file));
    if (p) F.openAt(p, line, 1);
    else if (!quiet) F.toast('Ez a fájl nem a projekt része: ' + esc(file));
  }
  F.on('javaLink', (file, line) => jumpToJava(file, line, project(F.state.active)));

  function stop() {
    if (!J.running) return;
    F.api('POST', 'proc/kill', { id: J.running.id });
    F.term.row('leállítva', 'A programot leállítottad.', '', 'var(--muted-2)');
  }
  J.stop = stop;
  function setRunning(on) {
    const b = $('#runBtn');
    b.classList.toggle('running', on);
    if (F.state.facet === 'java') $('#runLabel').textContent = on ? 'Leállítás' : 'Futtatás';
    $('#stopBtn').hidden = !on;
    if (!on) F.term.input(false);
  }
  $('#stopBtn').addEventListener('click', () => stop());

  // ───────────── generátorok ─────────────
  function classAtCursor(model) {
    const p = parse(model.getValue());
    const pos = F.editor.getPosition();
    const line = pos ? pos.lineNumber : 1;
    const inside = p.classes.filter((c) => c.line <= line && c.endLine >= line).sort((a, b) => b.line - a.line);
    return { parsed: p, cls: inside[0] || p.classes.find((c) => c.kind !== 'interface') || p.classes[0] };
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const instFields = (c) => c.fields.filter((f) => !/\bstatic\b/.test(f.mods));

  function insertInClass(model, cls, text, label) {
    F.history.snapshot(F.state.active, model.getValue(), label + ' előtt', true);
    const line = cls.endLine;
    const ind = cls.indent + '    ';
    const body = text.split('\n').map((l) => (l ? ind + l : l)).join('\n');
    const prev = model.getLineContent(Math.max(1, line - 1)).trim();
    const ins = (prev === '' || prev.endsWith('{') ? '' : '\n') + body.replace(/^\n+/, '') + '\n';
    model.pushEditOperations([], [{ range: new monaco.Range(line, 1, line, 1), text: ins }], () => null);
    const insLines = ins.split('\n').length;
    F.editor.revealLineInCenter(line + 1);
    const deco = F.editor.createDecorationsCollection([{ range: new monaco.Range(line, 1, line + insLines - 2, 1), options: { isWholeLine: true, className: 'facet-pick-line' } }]);
    setTimeout(() => deco.clear(), 1600);
    F.toast(label, 'ok');
  }

  const GEN = {
    accessors(onlyGet) {
      const a = F.active(); if (!a || a.facet !== 'java') return;
      const { cls } = classAtCursor(a.model);
      if (!cls) return F.toast('Nincs osztály ebben a fájlban.', 'warn');
      const names = new Set(cls.methods.map((m) => m.name));
      let out = [];
      instFields(cls).forEach((f) => {
        const g = (f.type === 'boolean' ? 'is' : 'get') + cap(f.name);
        if (!names.has(g)) out.push(`public ${f.type} ${g}() {\n    return ${f.name};\n}`);
        const s = 'set' + cap(f.name);
        if (!onlyGet && !/\bfinal\b/.test(f.mods) && !names.has(s)) out.push(`public void ${s}(${f.type} ${f.name}) {\n    this.${f.name} = ${f.name};\n}`);
      });
      if (!out.length) return F.toast('Minden mezőhöz van már ' + (onlyGet ? 'getter.' : 'getter és setter.'));
      insertInClass(a.model, cls, '\n' + out.join('\n\n'), `${out.length} metódus generálva a(z) ${cls.name} osztályba`);
    },
    ctor(empty) {
      const a = F.active(); if (!a || a.facet !== 'java') return;
      const { cls } = classAtCursor(a.model);
      if (!cls) return;
      const fs = empty ? [] : instFields(cls).filter((f) => !/=/.test(a.model.getLineContent(f.line)) || !/\bfinal\b/.test(f.mods));
      const sig = fs.map((f) => f.type + ' ' + f.name).join(', ');
      if (cls.ctors.some((c) => shortParams(c.params) === fs.map((f) => f.type).join(', '))) return F.toast('Ilyen konstruktor már van.');
      const vis = cls.kind === 'abstract' ? 'protected' : 'public';
      insertInClass(a.model, cls, `\n${vis} ${cls.name}(${sig}) {\n${fs.map((f) => `    this.${f.name} = ${f.name};`).join('\n')}${fs.length ? '\n' : ''}}`, empty ? 'Üres konstruktor generálva' : 'Konstruktor generálva ' + fs.length + ' mezővel');
    },
    toString() {
      const a = F.active(); if (!a || a.facet !== 'java') return;
      const { cls } = classAtCursor(a.model);
      if (!cls) return;
      if (cls.methods.some((m) => m.name === 'toString')) return F.toast('Már van toString() metódus.');
      const fs = instFields(cls);
      const parts = fs.map((f, i) => `"${i ? ', ' : ''}${f.name}=" + ${f.name}`).join(' + ');
      insertInClass(a.model, cls, `\n@Override\npublic String toString() {\n    return "${cls.name}{" + ${parts || '""'} + "}";\n}`, 'toString() generálva');
    },
    equals() {
      const a = F.active(); if (!a || a.facet !== 'java') return;
      const { cls } = classAtCursor(a.model);
      if (!cls) return;
      if (cls.methods.some((m) => m.name === 'equals')) return F.toast('Már van equals() metódus.');
      const fs = instFields(cls);
      const prim = (t) => /^(int|long|short|byte|char|boolean)$/.test(t);
      const cmp = fs.map((f) => (prim(f.type) ? `${f.name} == other.${f.name}` : /^(double|float)$/.test(f.type) ? `${cap(f.type)}.compare(${f.name}, other.${f.name}) == 0` : `Objects.equals(${f.name}, other.${f.name})`)).join('\n        && ');
      addImport(a.model, 'java.util.Objects');
      const c2 = parse(a.model.getValue()).classes.find((c) => c.name === cls.name) || cls;
      insertInClass(a.model, c2, `\n@Override\npublic boolean equals(Object o) {\n    if (this == o) return true;\n    if (!(o instanceof ${cls.name})) return false;\n    ${cls.name} other = (${cls.name}) o;\n    return ${cmp || 'true'};\n}\n\n@Override\npublic int hashCode() {\n    return Objects.hash(${fs.map((f) => f.name).join(', ')});\n}`, 'equals() és hashCode() generálva');
    },
    main() {
      const a = F.active(); if (!a || a.facet !== 'java') return;
      const { cls, parsed } = classAtCursor(a.model);
      if (!cls) return;
      if (parsed.hasMain) { const m = parsed.classes.flatMap((c) => c.methods).find((x) => x.name === 'main'); if (m) F.goto(m.line); return F.toast('Már van main metódus ebben a fájlban.'); }
      insertInClass(a.model, cls, '\npublic static void main(String[] args) {\n    \n}', 'main metódus beszúrva');
    }
  };
  J.gen = GEN;

  async function newClass(dir) {
    const a = F.active();
    if (dir == null) dir = a ? a.path.split('/').slice(0, -1).join('/') : '';
    if (dir && !dir.includes('/') && F.files().some((p) => p.startsWith(dir + '/src/'))) dir = dir + '/src';
    const kinds = [
      { value: 'class', label: 'Osztály', desc: 'Mezők, metódusok, konstruktor' },
      { value: 'abstract', label: 'Absztrakt osztály', desc: 'Közös ős, nem példányosítható' },
      { value: 'interface', label: 'Interfész', desc: 'Szerződés, amit osztályok megvalósítanak' },
      { value: 'enum', label: 'Enum', desc: 'Rögzített értékek listája' },
      { value: 'record', label: 'Record', desc: 'Adathordozó egy sorban (Java 16+)' }
    ].map((k) => Object.assign(k, { color: F.facets.java.accent }));
    const pkg = window.FacetSamples.packageFor((dir || '') + '/X.java');
    const v = await F.dialog({
      title: 'Új Java osztály', icon: true, iconColor: F.facets.java.accent,
      text: `Hely: <code style="font-family:var(--font-code)">${esc(dir || 'munkaterület gyökere')}</code>${pkg ? ` · csomag: <code style="font-family:var(--font-code)">${esc(pkg)}</code>` : ''}`,
      choice: { id: 'kind', value: 'class', items: kinds },
      fields: [{ id: 'name', label: 'Név', placeholder: 'pl. Jatekos', hint: 'Nagybetűvel kezdődjön, ékezet és szóköz nélkül.' }, { id: 'main', type: 'checkbox', label: 'Legyen benne main metódus', value: false }],
      ok: 'Létrehozás',
      validate: (x) => {
        if (!/^[A-Z][A-Za-z0-9_]*$/.test(x.name)) return 'A név nagybetűvel kezdődjön, és csak betűt, számot vagy _ jelet tartalmazzon (ékezet nélkül).';
        if (F.files().includes((dir ? dir + '/' : '') + x.name + '.java')) return 'Már van ilyen nevű osztály ebben a mappában.';
        return null;
      }
    });
    if (!v) return;
    const path = (dir ? dir + '/' : '') + v.name + '.java';
    await F.createFile(path, window.FacetSamples.javaClass(path, v.name, v.kind, v.main));
    F.toast(`<b>${esc(v.name)}</b> ${KIND_HU[v.kind]} létrehozva`, 'ok');
  }

  // ───────────── formázó ─────────────
  function formatJava(text, tab) {
    const code = blank(text).split('\n');
    const raw = text.split('\n');
    const out = [];
    let depth = 0, paren = 0, blankRun = 0;
    for (let i = 0; i < raw.length; i++) {
      const t = raw[i].trim();
      const c = code[i].trim();
      if (!t) { blankRun++; if (blankRun <= 1 && out.length && !/\{$/.test(out[out.length - 1].trim())) out.push(''); continue; }
      blankRun = 0;
      let lead = 0;
      for (const ch of c) { if (ch === '}' || ch === ')') lead++; else break; }
      let d = Math.max(0, depth - Math.min(lead, depth));
      const cont = paren > 0 || /^[.+\-*/?:&|]/.test(c) && !/^(\+\+|--)/.test(c);
      const inBlockComment = code[i].trim() === '' && t.startsWith('*');
      const ind = ' '.repeat(tab * d + (cont && !lead ? tab * 2 : 0) + (inBlockComment ? 1 : 0));
      if (out.length && out[out.length - 1] === '' && /^\}/.test(c)) out.pop();
      out.push(ind + t.replace(/\s+$/, ''));
      for (const ch of c) {
        if (ch === '{') depth++;
        else if (ch === '}') depth = Math.max(0, depth - 1);
        else if (ch === '(') paren++;
        else if (ch === ')') paren = Math.max(0, paren - 1);
      }
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    return out.join('\n') + '\n';
  }
  J.format = formatJava;

  // ───────────── kódkiegészítés ─────────────
  const SNIPS = [
    ['sout', 'System.out.println(${1});', 'Kiírás új sorral'],
    ['souf', 'System.out.printf("${1:%s}%n", ${2});', 'Formázott kiírás'],
    ['serr', 'System.err.println(${1});', 'Hibaüzenet kiírása'],
    ['psvm', 'public static void main(String[] args) {\n\t${0}\n}', 'main metódus'],
    ['main', 'public static void main(String[] args) {\n\t${0}\n}', 'main metódus'],
    ['fori', 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t${0}\n}', 'for ciklus indexszel'],
    ['forr', 'for (int ${1:i} = ${2:n} - 1; ${1:i} >= 0; ${1:i}--) {\n\t${0}\n}', 'for ciklus visszafelé'],
    ['foreach', 'for (${1:var} ${2:elem} : ${3:lista}) {\n\t${0}\n}', 'for-each ciklus'],
    ['if', 'if (${1:feltetel}) {\n\t${0}\n}', 'elágazás'],
    ['ifelse', 'if (${1:feltetel}) {\n\t${2}\n} else {\n\t${0}\n}', 'elágazás else ággal'],
    ['while', 'while (${1:feltetel}) {\n\t${0}\n}', 'while ciklus'],
    ['dowhile', 'do {\n\t${0}\n} while (${1:feltetel});', 'hátultesztelő ciklus'],
    ['switch', 'switch (${1:valtozo}) {\n\tcase ${2:1} -> ${3};\n\tdefault -> ${0};\n}', 'switch (új forma)'],
    ['try', 'try {\n\t${1}\n} catch (${2:Exception} e) {\n\t${0:e.printStackTrace();}\n}', 'try-catch blokk'],
    ['scanner', 'Scanner ${1:be} = new Scanner(System.in);', 'Scanner a billentyűzethez', 'java.util.Scanner'],
    ['readline', 'System.out.print("${1:Kérdés}: ");\nString ${2:valasz} = ${3:be}.nextLine();', 'Kérdés és válasz beolvasása'],
    ['readint', 'System.out.print("${1:Szám}: ");\nint ${2:szam} = Integer.parseInt(${3:be}.nextLine().trim());', 'Szám biztonságos beolvasása'],
    ['list', 'List<${1:String}> ${2:lista} = new ArrayList<>();', 'Új lista', 'java.util.List;java.util.ArrayList'],
    ['map', 'Map<${1:String}, ${2:Integer}> ${3:terkep} = new HashMap<>();', 'Új map', 'java.util.Map;java.util.HashMap'],
    ['random', 'int ${1:szam} = new Random().nextInt(${2:10});', 'Véletlenszám 0..n-1', 'java.util.Random'],
    ['class', 'public class ${1:Nev} {\n\t${0}\n}', 'Osztály'],
    ['getter', 'public ${1:String} get${2:Nev}() {\n\treturn ${3:nev};\n}', 'Getter metódus'],
    ['setter', 'public void set${1:Nev}(${2:String} ${3:nev}) {\n\tthis.${3:nev} = ${3:nev};\n}', 'Setter metódus'],
    ['tostring', '@Override\npublic String toString() {\n\treturn "${1}";\n}', 'toString felülírása'],
    ['sleep', 'try {\n\tThread.sleep(${1:500});\n} catch (InterruptedException e) {\n\tThread.currentThread().interrupt();\n}', 'Várakozás ezredmásodpercig']
  ];
  const M = (list) => list.map((x) => (typeof x === 'string' ? { n: x } : x));
  const MEMBERS = {
    'System.out': M(['println', 'print', 'printf', 'flush']),
    Math: M(['max', 'min', 'abs', 'pow', 'sqrt', 'random', 'round', 'floor', 'ceil', 'PI']),
    Arrays: M(['toString', 'sort', 'fill', 'asList', 'copyOf', 'equals', 'stream', 'binarySearch']),
    Collections: M(['sort', 'reverse', 'shuffle', 'max', 'min', 'unmodifiableList', 'emptyList', 'frequency']),
    Integer: M(['parseInt', 'valueOf', 'MAX_VALUE', 'MIN_VALUE', 'toString', 'compare', 'sum']),
    Double: M(['parseDouble', 'valueOf', 'MAX_VALUE', 'compare', 'isNaN']),
    String: M(['valueOf', 'format', 'join']),
    Character: M(['isDigit', 'isLetter', 'isUpperCase', 'isLowerCase', 'toUpperCase', 'toLowerCase', 'isWhitespace']),
    Objects: M(['equals', 'hash', 'requireNonNull', 'isNull', 'toString']),
    List: M(['of', 'copyOf']),
    Thread: M(['sleep', 'currentThread'])
  };
  const TYPE_MEMBERS = {
    String: M(['length', 'charAt', 'substring', 'indexOf', 'contains', 'equals', 'equalsIgnoreCase', 'toUpperCase', 'toLowerCase', 'trim', 'strip', 'split', 'replace', 'startsWith', 'endsWith', 'isEmpty', 'isBlank', 'compareTo', 'toCharArray', 'repeat', 'chars', 'lastIndexOf', 'matches']),
    List: M(['add', 'get', 'set', 'remove', 'size', 'isEmpty', 'contains', 'indexOf', 'clear', 'forEach', 'sort', 'stream', 'addAll', 'removeIf', 'subList', 'toArray']),
    Map: M(['put', 'get', 'getOrDefault', 'containsKey', 'containsValue', 'remove', 'size', 'isEmpty', 'keySet', 'values', 'entrySet', 'merge', 'putIfAbsent', 'forEach', 'clear']),
    Set: M(['add', 'remove', 'contains', 'size', 'isEmpty', 'clear', 'stream', 'forEach']),
    Scanner: M(['nextLine', 'nextInt', 'nextDouble', 'next', 'hasNextLine', 'hasNextInt', 'hasNext', 'close']),
    StringBuilder: M(['append', 'insert', 'reverse', 'toString', 'length', 'charAt', 'deleteCharAt', 'setLength', 'delete']),
    Random: M(['nextInt', 'nextDouble', 'nextBoolean', 'ints']),
    array: M([{ n: 'length', field: true }, 'clone'])
  };
  const typeAlias = (t) => {
    const b = t.replace(/<.*$/, '').trim();
    if (/\[\]$/.test(t)) return 'array';
    if (/^(ArrayList|LinkedList|List)$/.test(b)) return 'List';
    if (/^(HashMap|TreeMap|LinkedHashMap|Map)$/.test(b)) return 'Map';
    if (/^(HashSet|TreeSet|Set)$/.test(b)) return 'Set';
    return b;
  };

  function setupCompletion() {
    monaco.languages.registerCompletionItemProvider('java', {
      triggerCharacters: ['.'],
      async provideCompletionItems(model, pos) {
        const K = monaco.languages.CompletionItemKind;
        const word = model.getWordUntilPosition(pos);
        const range = new monaco.Range(pos.lineNumber, word.startColumn, pos.lineNumber, word.endColumn);
        const before = model.getLineContent(pos.lineNumber).slice(0, word.startColumn - 1);
        const text = model.getValue();
        const sugg = [];
        const dot = /([\w$.]+(?:\(\))?(?:\[\])?)\.\s*$/.exec(before);
        if (dot) {
          const recv = dot[1];
          let list = MEMBERS[recv];
          let proj = null;
          if (!list) {
            const vm = new RegExp('([\\w$.<>\\[\\],? ]+?)\\s+' + recv.replace(/[$]/g, '\\$') + '\\s*[=;,):]').exec(blank(text));
            const type = vm ? vm[1].trim().split(/\s+/).pop() : null;
            if (type) {
              list = TYPE_MEMBERS[typeAlias(type)];
              if (!list) {
                const projFiles = await parseProject(project(F.state.active));
                const cls = projFiles.flatMap((f) => f.parsed.classes).find((c) => c.name === type.replace(/<.*$/, ''));
                if (cls) proj = cls;
              }
            } else if (recv === 'this') {
              const p = parse(text);
              proj = p.classes.find((c) => c.line <= pos.lineNumber && c.endLine >= pos.lineNumber);
            }
          }
          if (proj) {
            proj.methods.forEach((m) => sugg.push({ label: m.name, kind: K.Method, detail: `${m.ret} ${m.name}(${m.params})`, insertText: m.params ? m.name + '(${1})' : m.name + '()', insertTextRules: 4, range }));
            proj.fields.forEach((f) => sugg.push({ label: f.name, kind: K.Field, detail: f.type, insertText: f.name, range }));
          } else if (list) {
            list.forEach((m) => sugg.push({ label: m.n, kind: m.field || /^[A-Z_]+$/.test(m.n) ? K.Field : K.Method, insertText: m.field || /^[A-Z_]+$/.test(m.n) ? m.n : m.n + '(${1})', insertTextRules: 4, range, detail: recv }));
          }
          return { suggestions: sugg };
        }
        SNIPS.forEach(([lbl, body, doc, imp]) => {
          const extra = [];
          if (imp) imp.split(';').forEach((i) => { const e = importEdit(model, i); if (e) extra.push(e); });
          sugg.push({ label: lbl, kind: K.Snippet, insertText: body, insertTextRules: 4, documentation: doc, detail: 'FACET sablon', range, additionalTextEdits: extra, sortText: '0' + lbl });
        });
        Object.keys(IMPORTS).forEach((cls) => {
          const e = importEdit(model, IMPORTS[cls]);
          sugg.push({ label: cls, kind: K.Class, detail: IMPORTS[cls], insertText: cls, range, additionalTextEdits: e ? [e] : [], sortText: '2' + cls });
        });
        ['String', 'Integer', 'Double', 'Boolean', 'Character', 'Math', 'System', 'Object', 'StringBuilder', 'Long', 'Thread', 'Override', 'Exception', 'RuntimeException'].forEach((cls) => sugg.push({ label: cls, kind: K.Class, insertText: cls, range, sortText: '2' + cls }));
        ['public', 'private', 'protected', 'static', 'final', 'void', 'int', 'double', 'boolean', 'char', 'long', 'return', 'new', 'class', 'interface', 'extends', 'implements', 'this', 'super', 'null', 'true', 'false', 'break', 'continue', 'abstract', 'enum', 'record', 'throws', 'throw', 'instanceof', 'import', 'package', 'var', 'else', 'case', 'default'].forEach((k) => sugg.push({ label: k, kind: K.Keyword, insertText: k, range, sortText: '3' + k }));
        const seen = new Set();
        (blank(text).match(/[A-Za-z_$][\w$]{2,}/g) || []).forEach((w) => { if (!seen.has(w) && w !== word.word) { seen.add(w); sugg.push({ label: w, kind: K.Text, insertText: w, range, sortText: '1' + w }); } });
        return { suggestions: sugg };
      }
    });
    function importEdit(model, imp) {
      const text = model.getValue();
      const simple = imp.split('.').pop();
      if (new RegExp('^\\s*import\\s+(' + imp.replace(/\./g, '\\.') + '|' + imp.split('.').slice(0, -1).join('\\.') + '\\.\\*)\\s*;', 'm').test(text)) return null;
      if (new RegExp('\\bclass\\s+' + simple + '\\b').test(text)) return null;
      const lines = text.split('\n');
      let at = 0;
      lines.forEach((l, i) => { if (/^\s*(package|import)\s/.test(l)) at = i + 1; });
      const pkgOnly = at > 0 && !lines.slice(0, at).some((l) => /^\s*import\s/.test(l));
      return { range: new monaco.Range(at + 1, 1, at + 1, 1), text: (pkgOnly ? '\n' : '') + 'import ' + imp + ';\n' + (at === 0 ? '\n' : '') };
    }

    monaco.languages.registerDocumentFormattingEditProvider('java', {
      provideDocumentFormattingEdits(model, options) {
        return [{ range: model.getFullModelRange(), text: formatJava(model.getValue(), options.tabSize || 4) }];
      }
    });

    monaco.languages.registerCodeActionProvider('java', {
      provideCodeActions(model, range, ctx) {
        const path = [...F.state.docs].find(([, d]) => d.model === model);
        if (!path) return { actions: [], dispose() {} };
        const actions = [];
        diagsForFile(path[0]).filter((d) => d.line === range.startLineNumber && d.fixes && d.fixes.length).forEach((d) => {
          d.fixes.forEach((fx) => {
            actions.push({ title: 'FACET: ' + fx.label, kind: 'quickfix', isPreferred: true, command: { id: fixCmd, title: fx.label, arguments: [d, fx, path[0]] } });
          });
        });
        return { actions, dispose() {} };
      }
    });
  }
  let fixCmd = null;

  // ───────────── osztálytérkép ─────────────
  async function renderMap(body, a) {
    const proj = project(a.path);
    const files = await parseProject(proj);
    const classes = [];
    files.forEach((f) => f.parsed.classes.forEach((c) => classes.push(Object.assign({ path: f.path }, c))));
    body.innerHTML = '';
    if (!classes.length) { body.append(h('div', { class: 'stage-empty', text: 'Ebben a projektben még nincs Java osztály.' })); return; }
    const names = new Set(classes.map((c) => c.name));
    const level = {};
    const lv = (c, seen = new Set()) => {
      if (level[c.name] != null) return level[c.name];
      if (seen.has(c.name)) return 0;
      seen.add(c.name);
      const parents = [c.ext].concat(c.impls).filter((p) => p && names.has(p));
      const l = parents.length ? 1 + Math.max(...parents.map((p) => lv(classes.find((x) => x.name === p), seen))) : 0;
      level[c.name] = l;
      return l;
    };
    classes.forEach((c) => lv(c));
    const rows = [];
    classes.forEach((c) => { (rows[level[c.name]] = rows[level[c.name]] || []).push(c); });
    const wrap = h('div', { class: 'cmap' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'links');
    const grid = h('div', { class: 'cmap-grid' });
    const cards = {};
    const cur = classAtCursorSafe(a);
    rows.forEach((row) => {
      if (!row) return;
      const r = h('div', { class: 'cmap-row' });
      row.sort((x, y) => (y.main - x.main) || x.name.localeCompare(y.name)).forEach((c) => {
        const card = h('div', { class: 'ccard' + (c.main ? ' main' : '') + (cur && cur === c.name && c.path === a.path ? ' cur' : ''), title: c.path });
        card.append(h('div', { class: 'ch' }, h('span', { class: 'cn', text: c.name }), h('span', { class: 'ck', text: c.main ? 'fut · main()' : KIND_HU[c.kind] })));
        const fl = c.fields.slice(0, 6), ml = c.ctors.concat(c.methods).slice(0, 7);
        if (fl.length) card.append(h('div', { class: 'cs' }, fl.map((f) => h('div', { text: `${visSym(f.mods)} ${f.name}: ${f.type}`, onclick: (e) => { e.stopPropagation(); F.openAt(c.path, f.line); } })), c.fields.length > 6 ? h('div', { style: { color: 'var(--muted-2)' }, text: `+${c.fields.length - 6} további` }) : null));
        if (ml.length) card.append(h('div', { class: 'cs' }, ml.map((m) => h('div', { text: `${visSym(m.mods)} ${m.name}(${shortParams(m.params)})${m.ret ? ': ' + m.ret : ''}`, onclick: (e) => { e.stopPropagation(); F.openAt(c.path, m.line); } })), c.ctors.length + c.methods.length > 7 ? h('div', { style: { color: 'var(--muted-2)' }, text: `+${c.ctors.length + c.methods.length - 7} további` }) : null));
        card.onclick = () => F.openAt(c.path, c.line);
        cards[c.name] = card;
        r.append(card);
      });
      grid.append(r);
    });
    wrap.append(svg, grid);
    body.append(wrap);
    body.append(h('div', { class: 'cmap-legend' }, h('span', null, h('i', { class: 'acc' }), 'öröklés'), h('span', null, h('i', { class: 'dash acc' }), 'megvalósítás'), h('span', null, h('i', { class: 'dash' }), 'használja (new / mező)')));
    body.append(h('div', { class: 'set-note', text: `${classes.length} típus · ${files.length} fájl · kattints egy tagra, és odaugrik a kódban.` }));
    const links = [];
    classes.forEach((c) => {
      if (c.ext && cards[c.ext]) links.push({ from: c.name, to: c.ext, type: 'ext' });
      c.impls.forEach((i) => { if (cards[i]) links.push({ from: c.name, to: i, type: 'impl' }); });
      const uses = new Set(c.uses);
      c.fields.forEach((f) => { const t = f.type.replace(/<.*$/, '').replace(/\[\]/g, ''); if (names.has(t)) uses.add(t); const g = /<\s*([A-Z]\w*)/.exec(f.type); if (g && names.has(g[1])) uses.add(g[1]); });
      uses.forEach((u) => { if (u !== c.name && cards[u] && !links.find((l) => l.from === c.name && l.to === u)) links.push({ from: c.name, to: u, type: 'use' }); });
    });
    const exp = h('div', { class: 'cmap-export' },
      h('button', { class: 'chip primary', onclick: () => exportUxf(a, classes, links, level) }, 'Exportálás UML-be (.uxf)'),
      h('span', { class: 'set-note', text: 'UMLet / UMLetino formátum' }));
    body.append(exp);
    const draw = () => {
      const box = wrap.getBoundingClientRect();
      if (!box.width) return;
      svg.setAttribute('width', box.width); svg.setAttribute('height', box.height);
      const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      let s = `<defs><marker id="tri" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#0B0E13" stroke="${acc}" stroke-width="1.2"/></marker><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9" fill="none" stroke="#5A667A" stroke-width="1.4"/></marker></defs>`;
      links.forEach((l) => {
        const A = cards[l.from].getBoundingClientRect(), B = cards[l.to].getBoundingClientRect();
        let x1 = A.left + A.width / 2 - box.left, y1 = A.top - box.top, x2 = B.left + B.width / 2 - box.left, y2 = B.bottom - box.top;
        if (Math.abs(A.top - B.top) < 4) { y1 = A.top + A.height / 2 - box.top; y2 = B.top + B.height / 2 - box.top; x1 = A.left < B.left ? A.right - box.left : A.left - box.left; x2 = A.left < B.left ? B.left - box.left : B.right - box.left; }
        else if (A.top < B.top) { y1 = A.bottom - box.top; y2 = B.top - box.top; }
        const my = (y1 + y2) / 2;
        const d = Math.abs(A.top - B.top) < 4 ? `M${x1} ${y1} L${x2} ${y2}` : `M${x1} ${y1} C${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
        if (l.type === 'use') s += `<path d="${d}" fill="none" stroke="#5A667A" stroke-width="1.3" stroke-dasharray="3 4" marker-end="url(#arr)"/>`;
        else s += `<path d="${d}" fill="none" stroke="${acc}" stroke-width="1.5" ${l.type === 'impl' ? 'stroke-dasharray="6 4"' : ''} marker-end="url(#tri)" opacity="0.85"/>`;
      });
      svg.innerHTML = s;
    };
    requestAnimationFrame(draw);
    if (J.mapObs) J.mapObs.disconnect();
    J.mapObs = new ResizeObserver(() => draw());
    J.mapObs.observe(wrap);
  }
  // ───────────── UML export (.uxf — UMLet) ─────────────
  const xmlEsc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const umlVis = (mods) => (/private/.test(mods) ? '-' : /protected/.test(mods) ? '#' : /public/.test(mods) ? '+' : '~');
  const umlParams = (p) => p.split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
    const parts = x.replace(/\bfinal\s+/, '').split(/\s+/);
    const n = parts.pop();
    return `${n}: ${parts.join(' ')}`;
  }).join(', ');

  /** Egy osztály UMLet-szövege: név, mezők, metódusok (statikus tag aláhúzva, absztrakt dőlt). */
  function umlText(c) {
    const lines = [];
    if (c.kind === 'interface') lines.push('&lt;&lt;interface&gt;&gt;', c.name);
    else if (c.kind === 'enum') lines.push('&lt;&lt;enumeration&gt;&gt;', c.name);
    else if (c.kind === 'record') lines.push('&lt;&lt;record&gt;&gt;', c.name);
    else if (c.kind === 'abstract') lines.push('/' + c.name + '/');
    else lines.push(c.name);
    lines.push('--');
    c.fields.forEach((f) => {
      const t = `${umlVis(f.mods)}${f.name}: ${xmlEsc(f.type)}`;
      lines.push(/\bstatic\b/.test(f.mods) ? '_' + t + '_' : t);
    });
    lines.push('--');
    c.ctors.forEach((m) => lines.push(`${umlVis(m.mods)}${m.name}(${xmlEsc(umlParams(m.params))})`));
    c.methods.forEach((m) => {
      let t = `${umlVis(m.mods)}${m.name}(${xmlEsc(umlParams(m.params))}): ${xmlEsc(m.ret)}`;
      if (/\bstatic\b/.test(m.mods)) t = '_' + t + '_';
      if (/\babstract\b/.test(m.mods) || (c.kind === 'interface' && !/\b(default|static)\b/.test(m.mods))) t = '/' + t + '/';
      lines.push(t);
    });
    return lines;
  }

  function buildUxf(classes, links, level) {
    const GAPX = 60, GAPY = 90, ROWH = 16;
    const boxes = {};
    const rows = [];
    classes.forEach((c) => { const l = level[c.name] || 0; (rows[l] = rows[l] || []).push(c); });
    let y = 20;
    const rowWidths = rows.map((row) => (row || []).reduce((sum, c) => {
      const lines = umlText(c);
      const w = Math.max(160, Math.min(420, Math.max(...lines.map((t) => t.replace(/&lt;|&gt;|&amp;/g, '<').length)) * 8 + 30));
      boxes[c.name] = { w: Math.round(w / 10) * 10, h: Math.round((lines.length * ROWH + 24) / 10) * 10, lines };
      return sum + boxes[c.name].w + GAPX;
    }, -GAPX));
    const totalW = Math.max(...rowWidths, 0);
    rows.forEach((row, ri) => {
      if (!row) return;
      let x = 20 + Math.max(0, (totalW - rowWidths[ri]) / 2);
      let rowH = 0;
      row.forEach((c) => { const b = boxes[c.name]; b.x = Math.round(x / 10) * 10; b.y = y; x += b.w + GAPX; rowH = Math.max(rowH, b.h); });
      y += rowH + GAPY;
    });
    let xml = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<diagram program="umlet" version="15.1">\n  <zoom_level>10</zoom_level>\n';
    Object.values(boxes).forEach((b) => {
      xml += `  <element>\n    <id>UMLClass</id>\n    <coordinates>\n      <x>${b.x}</x>\n      <y>${b.y}</y>\n      <w>${b.w}</w>\n      <h>${b.h}</h>\n    </coordinates>\n    <panel_attributes>${b.lines.join('\n')}</panel_attributes>\n    <additional_attributes/>\n  </element>\n`;
    });
    links.forEach((l) => {
      const A = boxes[l.from], B = boxes[l.to];
      if (!A || !B) return;
      // A nyíl a célnál (ős / interfész / használt osztály) van: az első pont a cél.
      let p1, p2;
      if (B.y + B.h <= A.y) { p1 = [B.x + B.w / 2, B.y + B.h]; p2 = [A.x + A.w / 2, A.y]; }
      else if (A.y + A.h <= B.y) { p1 = [B.x + B.w / 2, B.y]; p2 = [A.x + A.w / 2, A.y + A.h]; }
      else if (B.x > A.x) { p1 = [B.x, B.y + B.h / 2]; p2 = [A.x + A.w, A.y + A.h / 2]; }
      else { p1 = [B.x + B.w, B.y + B.h / 2]; p2 = [A.x, A.y + A.h / 2]; }
      const ox = Math.min(p1[0], p2[0]) - 10, oy = Math.min(p1[1], p2[1]) - 10;
      const w = Math.abs(p1[0] - p2[0]) + 20, hh = Math.abs(p1[1] - p2[1]) + 20;
      const lt = l.type === 'ext' ? 'lt=&lt;&lt;-' : l.type === 'impl' ? 'lt=&lt;&lt;.' : 'lt=&lt;.';
      xml += `  <element>\n    <id>Relation</id>\n    <coordinates>\n      <x>${Math.round(ox)}</x>\n      <y>${Math.round(oy)}</y>\n      <w>${Math.round(w)}</w>\n      <h>${Math.round(hh)}</h>\n    </coordinates>\n    <panel_attributes>${lt}</panel_attributes>\n    <additional_attributes>${(p1[0] - ox).toFixed(1)};${(p1[1] - oy).toFixed(1)};${(p2[0] - ox).toFixed(1)};${(p2[1] - oy).toFixed(1)}</additional_attributes>\n  </element>\n`;
    });
    return xml + '</diagram>\n';
  }
  J.buildUxf = buildUxf;

  async function exportUxf(a, classes, links, level) {
    const proj = project(a.path);
    const base = proj === '.' ? '' : proj.startsWith('loose:') ? proj.slice(6) : proj;
    const name = (base ? base.split('/').pop() : (F.state.engine && F.state.engine.name) || 'projekt').replace(/[^\w.-]+/g, '_');
    const v = await F.dialog({
      title: 'UML-diagram exportálása', icon: true, iconColor: F.facets.java.accent,
      text: `${classes.length} osztály és ${links.length} kapcsolat kerül a diagramba. A .uxf fájlt az <b>UMLet</b> vagy a böngészős <b>UMLetino</b> nyitja meg, ahol tovább szerkesztheted.`,
      fields: [{ id: 'p', label: 'Mentés ide', value: (base ? base + '/' : '') + name + '.uxf', hint: 'A megnyitott mappán belüli útvonal.' }],
      ok: 'Exportálás', validate: (x) => (/\.uxf$/i.test(x.p) ? null : 'A fájlnév végződése legyen .uxf')
    });
    if (!v) return;
    const xml = buildUxf(classes, links, level);
    try { await F.fs.write(v.p, xml); } catch (e) { F.toast('Nem sikerült menteni: ' + esc(e.message), 'err'); return; }
    await F.refreshTree();
    F.toast(`UML-diagram mentve: <b>${esc(v.p)}</b>`, 'ok');
    if (F.fs.mode === 'local') {
      const r = await F.dialog({ title: 'Kész az UML-diagram', text: `<code style="font-family:var(--font-code)">${esc(v.p)}</code>`, ok: 'Megnyitás UMLet-ben', cancel: 'Bezárás', extra: [{ label: F.isMac ? 'Mutasd a Finderben' : 'Mutasd a mappában', value: 'reveal' }] });
      if (r === 'reveal') F.api('POST', 'reveal', { path: v.p });
      else if (r) F.api('POST', 'openext', { path: v.p });
    }
  }

  function classAtCursorSafe(a) {
    try { const { cls } = classAtCursor(a.model); return cls && cls.name; } catch (e) { return null; }
  }

  // ───────────── generátor panel ─────────────
  function renderGen(body, a) {
    body.innerHTML = '';
    const { cls, parsed } = classAtCursor(a.model);
    if (!cls) { body.append(h('div', { class: 'stage-empty', text: 'Ebben a fájlban nincs osztály.' })); return; }
    const fs = instFields(cls);
    const names = new Set(cls.methods.map((m) => m.name));
    const missG = fs.filter((f) => !names.has((f.type === 'boolean' ? 'is' : 'get') + cap(f.name))).length;
    const missS = fs.filter((f) => !/\bfinal\b/.test(f.mods) && !names.has('set' + cap(f.name))).length;
    const btn = (label, sub, fn, dis) => h('button', { class: 'chip', style: { justifyContent: 'space-between' }, disabled: dis || null, onclick: () => { fn(); setTimeout(() => F.refreshStageNow(), 60); } }, label, sub ? h('span', { class: 'kbd', text: sub }) : null);
    body.append(h('div', { class: 'card' },
      h('div', { class: 'card-title' }, 'Generálás ide: ' + cls.name, h('span', { class: 'sub', text: KIND_HU[cls.kind] })),
      h('div', { class: 'grid2' },
        btn('Getter + setter', missG + missS ? String(missG + missS) : '✓', () => GEN.accessors(false)),
        btn('Csak getterek', missG ? String(missG) : '✓', () => GEN.accessors(true)),
        btn('Konstruktor', fs.length + ' mező', () => GEN.ctor(false)),
        btn('Üres konstruktor', '', () => GEN.ctor(true)),
        btn('toString()', names.has('toString') ? '✓' : '', () => GEN.toString()),
        btn('equals / hashCode', names.has('equals') ? '✓' : '', () => GEN.equals()),
        btn('main metódus', parsed.hasMain ? '✓' : 'psvm', () => GEN.main()),
        btn('Új osztály…', '', () => newClass()))));
    const fl = h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Mezők', h('span', { class: 'sub', text: fs.length + ' db' })));
    if (!fs.length) fl.append(h('div', { class: 'set-note', html: 'Még nincs mező. Írj be egyet, pl. <code style="font-family:var(--font-code)">private String nev;</code>, és a generátorok rögtön használják.' }));
    fs.forEach((f) => fl.append(h('div', { class: 'ol-item', onclick: () => F.goto(f.line) }, h('span', { class: 'ol-k', style: { color: '#B9A6F7' }, text: visSym(f.mods) }), h('span', { text: f.name + ': ' + f.type }))));
    body.append(fl);
    body.append(h('div', { class: 'card' },
      h('div', { class: 'card-title' }, 'Gyors sablonok', h('span', { class: 'sub', text: 'gépeld + Tab' })),
      h('div', { class: 'set-note', html: SNIPS.slice(0, 18).map(([k, , d]) => `<code style="font-family:var(--font-code);color:var(--accent)">${k}</code> ${esc(d)}`).join('<br>') })));
    const proj = project(a.path);
    const argIn = h('input', { class: 'field', id: 'javaArgs', value: F.store.get('args:' + proj, ''), placeholder: 'pl. 10 "két szó"', spellcheck: 'false' });
    argIn.onchange = () => F.store.set('args:' + proj, argIn.value.trim());
    body.append(h('label', { class: 'card', for: 'javaArgs' }, h('div', { class: 'card-title' }, 'Parancssori argumentumok', h('span', { class: 'sub', text: 'args[]' })), argIn, h('span', { class: 'set-note', text: 'A main(String[] args) ezeket kapja futtatáskor. Szóközzel válaszd el őket.' })));
  }

  // ───────────── Hibák panel ─────────────
  function renderErrors(body, a) {
    body.innerHTML = '';
    const proj = project(a.path);
    const list = (J.diags[proj] || []).slice();
    Object.entries(J.lint).forEach(([p, l]) => { if (project(p) === proj) l.forEach((d) => list.push(Object.assign({ file: p }, d))); });
    if (F.fs.mode !== 'local') body.append(h('div', { class: 'stage-empty', html: 'A fordítási hibák ellenőrzéséhez a <b>helyi motor</b> kell. A FACET tanácsai így is működnek.' }));
    const at = J.checkedAt[proj];
    if (!list.length) {
      body.append(h('div', { class: 'ok-card' }, h('span', { class: 'diamond' }), h('span', { text: at ? 'Nincs fordítási hiba. Utolsó ellenőrzés: ' + new Date(at).toLocaleTimeString('hu-HU') : 'Még nem volt ellenőrzés. Ments, vagy futtasd a programot.' })));
    }
    list.sort((x, y) => (x.sev === 'warn') - (y.sev === 'warn') || x.file.localeCompare(y.file) || x.line - y.line).forEach((d) => {
      const card = h('div', { class: 'expl' + (d.sev === 'warn' ? ' warn' : ''), onclick: () => F.openAt(d.file, d.line, d.col) },
        h('div', { class: 'eh' }, h('span', { class: 'et', text: d.title }), h('span', { class: 'el', text: d.file.split('/').pop() + ':' + d.line })),
        d.message ? h('span', { class: 'er', text: 'javac: ' + d.message.split('\n')[0] }) : h('span', { class: 'er', text: 'FACET tanács' }),
        h('span', { class: 'eb', html: d.body || '' }),
        d.hint ? h('span', { class: 'eh2', text: d.hint }) : null);
      if (d.fixes && d.fixes.length) {
        const acts = h('div', { class: 'ea' });
        d.fixes.forEach((fx, i) => acts.append(h('button', { class: 'chip' + (i === 0 ? ' primary' : ''), onclick: (e) => { e.stopPropagation(); applyFix(d, fx, d.file); } }, fx.label)));
        card.append(acts);
      }
      body.append(card);
    });
    body.append(h('button', { class: 'chip', style: { alignSelf: 'flex-start' }, onclick: () => check(a.path).then(() => F.refreshStageNow()) }, 'Ellenőrzés most'));
  }

  // ───────────── facet regisztráció ─────────────
  F.extendFacet('java', {
    runLabel: 'Futtatás', run, bottom: 'terminal', hint: 'Interaktív: a Scanner itt kér bemenetet', outline, newClass,
    tools: [
      { label: 'Új osztály', run: () => newClass() },
      { label: 'main()', kbd: 'psvm', run: () => GEN.main() },
      { label: 'Getter / Setter', run: () => GEN.accessors(false) },
      { label: 'Konstruktor', run: () => GEN.ctor(false) },
      { label: 'toString()', run: () => GEN.toString() },
      { label: 'Formázás', kbd: '⇧⌥F', run: () => F.editor.getAction('editor.action.formatDocument').run() }
    ],
    stage: [
      { id: 'map', label: 'Osztálytérkép', render: (b, a) => { renderMap(b, a); } },
      { id: 'gen', label: 'Generátor', render: renderGen },
      { id: 'errors', label: () => { const a = F.active(); const n = a ? (J.diags[project(a.path)] || []).filter((d) => d.sev !== 'warn').length : 0; return 'Hibák' + (n ? ` <span class="count err">${n}</span>` : ''); }, render: renderErrors }
    ],
    setup() {
      setupCompletion();
      fixCmd = F.editor.addCommand(0, (acc, d, fx, p) => applyFix(d, fx, p));
      F.on('open', () => refreshLens());
      F.on('workspace', () => { J.diags = {}; J.checkedAt = {}; J.lint = {}; renderProblems(); });
      F.on('settings', () => refreshLens());
      F.on('resize', F.debounce(() => refreshLens(), 200));
      F.on('cursor', F.debounce(() => { if (F.state.facet === 'java' && F.stageTab() === 'gen') F.refreshStageNow(); }, 300));
    },
    onActivate(path, model) {
      J.lint[path] = lint(model).map((d) => Object.assign({ file: path }, d));
      applyMarkers();
      const proj = project(path);
      if (F.settings.liveCheck && !J.checkedAt[proj]) check(path);
      if (J.running) $('#runLabel').textContent = 'Leállítás';
    },
    onChange(path, model) {
      J.lint[path] = lint(model).map((d) => Object.assign({ file: path }, d));
      applyMarkers();
      if (F.state.active === path && F.stageTab() !== 'errors') F.refreshStage();
    },
    onSave(path) { checkSoon(path); },
    onClose(path) { delete J.lint[path]; renderProblems(); }
  });

  const C = (label, keywords, run, icon, detail) => F.command({ label, keywords, run, icon: icon || 'J', facet: 'java', detail });
  C('Getter és setter generálása', 'getter setter accessor generalas', () => GEN.accessors(false), 'G');
  C('Csak getterek generálása', 'getter', () => GEN.accessors(true), 'G');
  C('Konstruktor generálása', 'constructor konstruktor', () => GEN.ctor(false), 'K');
  C('Üres konstruktor', 'constructor ures', () => GEN.ctor(true), 'K');
  C('toString() generálása', 'tostring kiiras', () => GEN.toString(), 'T');
  C('equals() és hashCode() generálása', 'equals hashcode osszehasonlitas', () => GEN.equals(), '=');
  C('main metódus beszúrása', 'main psvm inditas', () => GEN.main(), 'M');
  C('Új Java osztály', 'uj osztaly class letrehozas interface enum record', () => newClass(), '+');
  C('Projekt ellenőrzése (fordítás)', 'compile check forditas hibak ellenorzes', () => check(F.state.active).then(() => F.showStage('errors')), '✓');
  C('Osztálytérkép', 'map uml diagram terkep', () => F.showStage('map'), '▦');
  C('UML exportálása (.uxf)', 'uml uxf umlet export diagram', async () => { F.showStage('map'); setTimeout(() => { const b = document.querySelector('.cmap-export .chip'); if (b) b.click(); }, 400); }, 'U');
  C('Hibatolmács: hibák listája', 'hibak errors problems', () => F.showStage('errors'), '!');
  C('Program leállítása', 'stop kill leallitas', () => stop(), '■');
  C('Parancssori argumentumok…', 'args argumentum parameter', async () => {
    const proj = project(F.state.active);
    const v = await F.dialog({ title: 'Parancssori argumentumok', fields: [{ id: 'a', label: 'Argumentumok (szóközzel elválasztva)', value: F.store.get('args:' + proj, ''), placeholder: 'pl. 10 "két szó"' }], ok: 'Mentés' });
    if (v) F.store.set('args:' + proj, v.a);
  }, '…');
  C('Importok rendezése', 'import organize rendezes', () => {
    const a = F.active(); if (!a) return;
    const lines = a.model.getValue().split('\n');
    const imps = lines.filter((l) => /^\s*import\s/.test(l));
    if (!imps.length) return F.toast('Nincs import ebben a fájlban.');
    const used = blank(a.model.getValue().split('\n').filter((l) => !/^\s*import\s/.test(l)).join('\n'));
    const keep = [...new Set(imps.map((l) => l.trim()))].filter((l) => { const n = l.replace(/;$/, '').split('.').pop(); return n === '*' || new RegExp('\\b' + n + '\\b').test(used); }).sort();
    const first = lines.findIndex((l) => /^\s*import\s/.test(l));
    const rest = lines.filter((l, i) => !(/^\s*import\s/.test(l)) || i === first);
    rest[rest.indexOf(lines[first])] = keep.join('\n');
    F.replaceAll(a.model, rest.join('\n'), `Importok rendezve (${imps.length - keep.length} felesleges törölve)`);
  }, 'I');

  F.java = J;
})();
