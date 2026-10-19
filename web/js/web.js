/* FACET — webes facetek (HTML, CSS, JavaScript)
   Élő előnézet készülékkeretben, kijelölés az oldalon → forráskód sora,
   elempaletta, szerkezet, ellenőrzés, színek, Flexbox/Grid építő, árnyéktervező. */
(function () {
  'use strict';
  const { h, esc, $, $$ } = F;
  const W = F.web = {};

  const DEVICES = {
    phone: { w: 390, h: 844, label: 'Telefon' },
    tablet: { w: 820, h: 1180, label: 'Tablet' },
    desktop: { w: 1440, h: 900, label: 'Asztali' }
  };
  W.mode = F.store.get('pvMode', 'phone');
  W.inspect = false;
  W.scroll = 0;
  W.frames = [];
  const dirOf = (p) => p.split('/').slice(0, -1).join('/');
  const join = (dir, rel) => {
    const parts = (dir ? dir.split('/') : []).concat(rel.split('/'));
    const out = [];
    parts.forEach((s) => { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); });
    return out.join('/');
  };
  const isLocalRef = (u) => u && !/^([a-z]+:|\/\/|#|data:|mailto:|tel:)/i.test(u);
  const cleanRef = (u) => decodeURIComponent(u.split(/[?#]/)[0]);

  // ───────────── melyik HTML-t mutassuk? ─────────────
  async function htmlFor(path) {
    if (!path) return null;
    const ext = F.ext(path);
    if (ext === 'html' || ext === 'htm') return path;
    const files = F.files();
    const name = path.split('/').pop();
    const dirs = [dirOf(path), dirOf(dirOf(path))];
    for (const d of dirs) {
      const cands = files.filter((p) => dirOf(p) === d && /\.html?$/i.test(p));
      if (!cands.length) continue;
      for (const c of cands) {
        try { if ((await F.textOf(c)).includes(name)) return c; } catch (e) { /* tovább */ }
      }
      if (d === dirOf(path)) return cands.find((c) => /index\.html?$/i.test(c)) || cands[0];
    }
    return null;
  }
  W.htmlFor = htmlFor;

  // ───────────── dokumentum összeállítása ─────────────
  /** Minden nyitó címke kap egy data-nxl="sor" attribútumot. */
  function annotate(src) {
    const re = /<!--[\s\S]*?-->|<(script|style|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>|<([a-zA-Z][\w-]*)(?=[\s/>])/g;
    let out = '', last = 0, line = 1, m;
    const SKIP = new Set(['html', 'head', 'meta', 'link', 'title', 'base', 'br', 'wbr']);
    while ((m = re.exec(src))) {
      const chunk = src.slice(last, m.index);
      for (let i = 0; i < chunk.length; i++) if (chunk.charCodeAt(i) === 10) line++;
      out += chunk;
      if (m[2] && !SKIP.has(m[2].toLowerCase())) out += m[0] + ` data-nxl="${line}"`;
      else out += m[0];
      for (let i = 0; i < m[0].length; i++) if (m[0].charCodeAt(i) === 10) line++;
      last = m.index + m[0].length;
    }
    return out + src.slice(last);
  }
  W.annotate = annotate;

  function rewriteCssUrls(css, cssPath) {
    if (F.fs.mode !== 'local') return css;
    return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, u) => (isLocalRef(u) && !u.startsWith('/') ? `url("${F.fs.url(join(dirOf(cssPath), cleanRef(u)))}")` : m));
  }

  async function inlineAssets(src, dir, used) {
    const files = new Set(F.files());
    const linkRe = /<link\b[^>]*>/gi;
    const parts = [];
    let m, last = 0;
    while ((m = linkRe.exec(src))) {
      const tag = m[0];
      const rel = /\brel\s*=\s*["']?([^"'\s>]+)/i.exec(tag);
      const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag);
      parts.push(src.slice(last, m.index));
      last = m.index + tag.length;
      if (rel && /stylesheet/i.test(rel[1]) && href && isLocalRef(href[1])) {
        const p = join(dir, cleanRef(href[1]));
        if (files.has(p) || F.state.docs.has(p)) {
          try { used.add(p); parts.push(`<style data-facet-src="${esc(p)}">\n${rewriteCssUrls(await F.textOf(p), p)}\n</style>`); continue; } catch (e) { /* hagyjuk */ }
        }
      }
      parts.push(tag);
    }
    parts.push(src.slice(last));
    src = parts.join('');
    const scriptRe = /<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script\s*>/gi;
    const out = [];
    last = 0;
    while ((m = scriptRe.exec(src))) {
      out.push(src.slice(last, m.index));
      last = m.index + m[0].length;
      const ref = m[2];
      if (isLocalRef(ref)) {
        const p = join(dir, cleanRef(ref));
        if (files.has(p) || F.state.docs.has(p)) {
          try {
            used.add(p);
            const code = (await F.textOf(p)).replace(/<\/script/gi, '<\\/script');
            out.push(`<script${m[1]}${m[3]} data-facet-src="${esc(p)}">${code}\n//# sourceURL=${location.origin}/facet-src/${p}</script>`);
            continue;
          } catch (e) { /* hagyjuk */ }
        }
      }
      out.push(m[0]);
    }
    out.push(src.slice(last));
    return out.join('');
  }

  function bridge(id, accent) {
    return `<script data-facet-bridge>(function(){
var send=function(m){try{m.__facet=1;m.id=${id};parent.postMessage(m,'*');}catch(e){}};
var fmt=function(v){if(typeof v==='string')return v;try{if(v instanceof Element){return '<'+v.tagName.toLowerCase()+(v.id?'#'+v.id:'')+(typeof v.className==='string'&&v.className.trim()?'.'+v.className.trim().split(/\\s+/).join('.'):'')+'>';}if(v instanceof Error)return v.name+': '+v.message;if(typeof v==='function')return 'ƒ '+(v.name||'névtelen')+'()';var s=JSON.stringify(v);return s===undefined?String(v):s;}catch(e){return String(v);}};
['log','info','warn','error','debug','table'].forEach(function(k){var o=console[k];console[k]=function(){var a=[].slice.call(arguments);send({t:'console',level:k==='debug'||k==='table'?'log':k,text:a.map(fmt).join(' ')});if(o)o.apply(console,a);};});
addEventListener('error',function(e){send({t:'console',level:'error',text:(e.message||'Hiba'),src:e.filename||'',line:e.lineno||0});});
addEventListener('unhandledrejection',function(e){var r=e.reason;send({t:'console',level:'error',text:'Kezeletlen Promise-hiba: '+(r&&r.message||r)});});
var Y=${Math.round(W.scroll) || 0};addEventListener('load',function(){if(Y)scrollTo(0,Y);send({t:'loaded'});});
var st;addEventListener('scroll',function(){clearTimeout(st);st=setTimeout(function(){send({t:'scroll',y:scrollY});},80);},{passive:true});
var on=false,box=null,tag=null,hideT;
function ensure(){if(box)return;box=document.createElement('div');tag=document.createElement('div');box.style.cssText='position:fixed;pointer-events:none;z-index:2147483647;outline:2px solid ${accent};outline-offset:2px;border-radius:2px;background:${accent}14;transition:all .08s';tag.style.cssText='position:fixed;pointer-events:none;z-index:2147483647;padding:3px 7px;border-radius:4px;background:${accent};color:#13090C;font:600 11px ui-monospace,Menlo,monospace;white-space:nowrap';document.documentElement.appendChild(box);document.documentElement.appendChild(tag);}
function desc(el){return el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(typeof el.className==='string'&&el.className.trim()?'.'+el.className.trim().split(/\\s+/).slice(0,2).join('.'):'');}
function show(el){ensure();var r=el.getBoundingClientRect();box.style.left=r.left+'px';box.style.top=r.top+'px';box.style.width=r.width+'px';box.style.height=r.height+'px';tag.textContent=desc(el)+' · '+el.getAttribute('data-nxl')+'. sor';var ty=r.top-26;tag.style.left=Math.max(2,r.left-2)+'px';tag.style.top=(ty<2?r.bottom+6:ty)+'px';}
function clear(){if(box){box.remove();tag.remove();box=null;tag=null;}}
addEventListener('message',function(e){var d=e.data||{};if(!d.__facet)return;if(d.t==='inspect'){on=d.on;document.documentElement.style.cursor=on?'crosshair':'';if(!on)clear();}if(d.t==='highlight'){var el=document.querySelector('[data-nxl="'+d.line+'"]');if(el){show(el);if(d.scroll)el.scrollIntoView({block:'center',behavior:'smooth'});clearTimeout(hideT);if(!on)hideT=setTimeout(clear,1500);}}});
addEventListener('mouseover',function(e){if(!on)return;var el=e.target.closest&&e.target.closest('[data-nxl]');if(el)show(el);},true);
addEventListener('click',function(e){if(!on)return;e.preventDefault();e.stopPropagation();var el=e.target.closest&&e.target.closest('[data-nxl]');if(el)send({t:'pick',line:+el.getAttribute('data-nxl'),tag:el.tagName.toLowerCase(),elid:el.id||'',cls:[].slice.call(el.classList)});},true);
})();<\/script>`;
  }

  async function buildDoc(htmlPath, id) {
    let src = await F.textOf(htmlPath);
    const dir = dirOf(htmlPath);
    const used = new Set([htmlPath]);
    src = annotate(src);
    src = await inlineAssets(src, dir, used);
    const acc = F.facets[F.state.facet] ? F.facets[F.state.facet].accent : '#FF5C7A';
    const head = (F.fs.mode === 'local' ? `<base href="${F.fs.url(dir ? dir + '/' : '').replace(/\/?$/, '/')}">` : '') + bridge(id, acc);
    if (/<head[^>]*>/i.test(src)) src = src.replace(/<head[^>]*>/i, (m) => m + head);
    else if (/<html[^>]*>/i.test(src)) src = src.replace(/<html[^>]*>/i, (m) => m + '<head>' + head + '</head>');
    else src = head + src;
    W.used = used;
    return src;
  }

  // ───────────── előnézet panel ─────────────
  let renderSeq = 0;
  function previewPanel(body) {
    if (!$('.pv-bar', body)) {
      body.innerHTML = '';
      const bar = h('div', { class: 'pv-bar' });
      Object.entries(DEVICES).forEach(([k, d]) => bar.append(h('button', { class: 'chip pv-mode' + (W.mode === k ? ' on' : ''), 'data-mode': k, onclick: () => setMode(k) }, d.label)));
      bar.append(h('button', { class: 'chip pv-mode' + (W.mode === 'multi' ? ' on' : ''), 'data-mode': 'multi', onclick: () => setMode('multi') }, '3 nézet'));
      bar.append(h('span', { class: 'sp' }));
      bar.append(h('button', { class: 'chip' + (W.inspect ? ' on' : ''), id: 'pvInspect', title: 'Kattints egy elemre az oldalon, és a kódban odaugrik', onclick: () => setInspect(!W.inspect) }, h('span', { html: '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M1.5 1.5 L10 5 L6 6 L5 10 Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>' }), 'Kijelölés'));
      bar.append(h('button', { class: 'chip', title: 'Előnézet frissítése', onclick: () => W.render(true) }, '↻'));
      if (F.fs.mode === 'local') bar.append(h('button', { class: 'chip', title: 'Megnyitás új böngészőlapon', onclick: openInTab }, '↗'));
      body.append(bar, h('div', { class: 'pv-stage', id: 'pvStage' }), h('div', { class: 'pv-meta', id: 'pvMeta' }));
    }
    W.render();
  }

  async function openInTab() {
    const a = F.active();
    const p = await htmlFor(a && a.path);
    if (!p) return F.toast('Nincs HTML fájl ehhez az előnézethez.');
    await F.saveAll();
    F.openUrl(location.origin + F.fs.url(p));
  }

  function setMode(m) {
    W.mode = m;
    F.store.set('pvMode', m);
    $$('.pv-mode').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    W.frames = [];
    W.render(true);
  }
  function setInspect(on) {
    W.inspect = on;
    const b = $('#pvInspect');
    if (b) b.classList.toggle('on', on);
    W.frames.forEach((f) => post(f, { t: 'inspect', on }));
    if (on) F.toast('Kijelölés: kattints egy elemre az előnézetben, és a kód odaugrik.');
  }
  W.setInspect = setInspect;
  const post = (fr, msg) => { try { fr.contentWindow.postMessage(Object.assign({ __facet: 1 }, msg), '*'); } catch (e) { /* még töltődik */ } };

  W.render = async (force) => {
    const stage = $('#pvStage');
    if (!stage) return;
    const a = F.active();
    if (!a) return;
    const seq = ++renderSeq;
    const htmlPath = await htmlFor(a.path);
    if (seq !== renderSeq) return;
    if (!htmlPath) {
      stage.innerHTML = '';
      W.frames = [];
      if (a.facet === 'js') stage.append(jsRunner(a));
      else stage.append(h('div', { class: 'pv-empty', html: `Nem találok HTML fájlt, ami ezt a fájlt használja.<br><br>Hozz létre egy <b>index.html</b>-t ugyanebben a mappában, és linkeld be: <code style="font-family:var(--font-code)">&lt;link rel="stylesheet" href="${esc(a.path.split('/').pop())}"&gt;</code>` }));
      $('#pvMeta').textContent = '';
      return;
    }
    W.htmlPath = htmlPath;
    const modes = W.mode === 'multi' ? ['phone', 'tablet', 'desktop'] : [W.mode];
    if (force || W.frames.length !== modes.length || !W.frames[0] || !W.frames[0].isConnected) {
      stage.innerHTML = '';
      W.frames = [];
      modes.forEach((m, i) => {
        const d = DEVICES[m];
        const fr = h('iframe', { title: 'Előnézet · ' + d.label, sandbox: 'allow-scripts allow-forms allow-modals allow-popups allow-same-origin allow-downloads' });
        fr.dataset.mode = m;
        fr.dataset.idx = i;
        fr.style.width = d.w + 'px';
        fr.style.height = d.h + 'px';
        const screen = h('div', { class: 'screen' }, fr);
        const dev = h('div', { class: 'device ' + m }, screen, W.mode === 'multi' ? h('span', { class: 'dlabel', text: `${d.label} · ${d.w}×${d.h}` }) : null);
        stage.append(dev);
        W.frames.push(fr);
      });
      stage.style.flexDirection = W.mode === 'multi' && stage.clientWidth < 900 ? 'column' : 'row';
      stage.style.alignItems = W.mode === 'multi' && stage.clientWidth < 900 ? 'center' : 'flex-start';
      fit();
    }
    const t0 = performance.now();
    let doc;
    try { doc = await buildDoc(htmlPath, 0); } catch (e) { $('#pvMeta').textContent = 'Az előnézet nem állítható össze: ' + e.message; return; }
    if (seq !== renderSeq) return;
    W.frames.forEach((fr) => {
      fr.onload = () => {
        const ms = Math.round(performance.now() - t0);
        if (fr === W.frames[0]) {
          const d = DEVICES[fr.dataset.mode];
          $('#pvMeta').innerHTML = `<span>${esc(htmlPath)}</span><span>${W.mode === 'multi' ? '3 nézet' : d.w + '×' + d.h} · ${ms} ms</span>`;
          F.console.note(`${htmlPath.split('/').pop()} frissítve · ${ms} ms`);
        }
        if (W.inspect) post(fr, { t: 'inspect', on: true });
      };
      fr.srcdoc = doc.replace('id=0;', `id=${fr.dataset.idx};`);
    });
  };

  function fit() {
    const stage = $('#pvStage');
    if (!stage) return;
    const multi = W.mode === 'multi';
    const column = multi && stage.clientWidth < 900;
    const availW = Math.max(120, (column || !multi ? stage.clientWidth : stage.clientWidth / 3 - 16) - 26);
    const availH = Math.max(160, stage.clientHeight - (multi ? 36 : 24));
    W.frames.forEach((fr) => {
      const d = DEVICES[fr.dataset.mode];
      const s = Math.min(1, availW / d.w, column ? 1 : availH / (d.h + (fr.dataset.mode === 'desktop' ? 24 : 0)));
      fr.style.transform = `scale(${s})`;
      fr.parentElement.style.width = d.w * s + 'px';
      fr.parentElement.style.height = d.h * s + 'px';
    });
  }
  W.fit = fit;

  // ───────────── üzenetek az előnézetből ─────────────
  window.addEventListener('message', async (e) => {
    const d = e.data;
    if (!d || !d.__facet) return;
    const fromFrame = W.frames.some((f) => f.contentWindow === e.source) || (W.runner && W.runner.contentWindow === e.source);
    if (!fromFrame) return;
    if (d.t === 'console') {
      let src = null;
      const m = /\/facet-src\/(.+)$/.exec(d.src || '');
      if (m) src = { path: decodeURIComponent(m[1]), line: d.line };
      else if (W.htmlPath && d.level === 'error') src = { path: W.htmlPath, line: 0 };
      if (d.id && +d.id > 0) return; // a 3 nézetből csak egyszer naplózunk
      F.console.log(d.level, d.text, src);
      if (d.level === 'error') F.emit('consoleError', d.text, src);
      if (d.level === 'error' && F.state.bottomPane !== 'console') {
        const cnt = $('#consoleCount');
        cnt.classList.add('err');
      }
    } else if (d.t === 'scroll') {
      if (!d.id) W.scroll = d.y;
    } else if (d.t === 'pick') {
      onPick(d);
    }
  });

  async function onPick(d) {
    const a = F.active();
    if (a && a.facet === 'css') {
      const text = a.model.getValue();
      const sels = [].concat(d.elid ? ['#' + d.elid] : [], d.cls.map((c) => '.' + c), [d.tag]);
      for (const s of sels) {
        const re = new RegExp('(^|[\\s,>+~}])' + s.replace(/[.#]/g, (c) => '\\' + c) + '(?![\\w-])[^{]*\\{', 'm');
        const m = re.exec(text);
        if (m) {
          const line = text.slice(0, m.index + m[1].length).split('\n').length;
          F.goto(line, 1);
          flash(line);
          F.toast(`Szabály: <b>${esc(s)}</b>`);
          return;
        }
      }
      F.toast(`Nincs CSS szabály ehhez: <b>${esc(d.tag + (d.elid ? '#' + d.elid : '') + d.cls.map((c) => '.' + c).join(''))}</b> · a HTML-ben mutatom.`);
    }
    if (W.htmlPath && (!a || a.path !== W.htmlPath)) await F.open(W.htmlPath);
    F.goto(d.line, 1);
    const model = F.editor.getModel();
    const lineText = model.getLineContent(d.line);
    const col = lineText.indexOf('<' + d.tag);
    if (col >= 0) F.editor.setSelection(new monaco.Range(d.line, col + 2, d.line, col + 2 + d.tag.length));
    flash(d.line);
  }
  function flash(line) {
    const deco = F.editor.createDecorationsCollection([{ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'facet-pick-line' } }]);
    setTimeout(() => deco.clear(), 1400);
  }

  // ───────────── JS futtatása HTML nélkül ─────────────
  function jsRunner(a) {
    const box = h('div', { class: 'pv-empty', style: { maxWidth: '320px' } });
    box.innerHTML = `Ehhez a JavaScript fájlhoz nincs HTML oldal, ezért <b style="color:var(--fg-bright)">konzolos módban</b> fut: a kimenet az alsó Konzol fülön jelenik meg.<br><br>`;
    box.append(h('button', { class: 'btn accent', onclick: () => runJs(a) }, '▶ Futtatás most'));
    return box;
  }
  async function runJs(a) {
    F.bottom.show('console');
    F.console.clear();
    F.console.note('futtatás: ' + a.path);
    if (W.runner) W.runner.remove();
    const code = a.model.getValue().replace(/<\/script/gi, '<\\/script');
    const fr = h('iframe', { sandbox: 'allow-scripts allow-same-origin allow-modals', style: { display: 'none' } });
    W.runner = fr;
    document.body.append(fr);
    fr.srcdoc = '<!doctype html><html><head>' + bridge(0, F.facets.js.accent) + `</head><body><script>${code}\n//# sourceURL=${location.origin}/facet-src/${a.path}<\/script></body></html>`;
  }

  // ───────────── HTML: elempaletta, szerkezet, ellenőrzés ─────────────
  const BLOCKS = [
    ['Navigáció', '<nav class="nav">\n\t<a class="logo" href="#">${1:Márkanév}</a>\n\t<ul>\n\t\t<li><a href="#">Kezdőlap</a></li>\n\t\t<li><a href="#rolunk">Rólunk</a></li>\n\t\t<li><a href="#kapcsolat">Kapcsolat</a></li>\n\t</ul>\n</nav>'],
    ['Hero', '<header class="hero">\n\t<h1>${1:Fő üzenet egy mondatban}</h1>\n\t<p>${2:Rövid magyarázat arról, mit kap a látogató.}</p>\n\t<a class="btn" href="#">${3:Kezdjük}</a>\n</header>'],
    ['Kártya', '<article class="card">\n\t<img src="${1:kep.jpg}" alt="${2:Kép leírása}">\n\t<h2>${3:Cím}</h2>\n\t<p>${4:Rövid leírás.}</p>\n</article>'],
    ['Űrlap', '<form class="form">\n\t<label for="nev">Név</label>\n\t<input id="nev" name="nev" type="text" required>\n\n\t<label for="email">E-mail</label>\n\t<input id="email" name="email" type="email" required>\n\n\t<label for="uzenet">Üzenet</label>\n\t<textarea id="uzenet" name="uzenet" rows="4"></textarea>\n\n\t<button type="submit">${1:Küldés}</button>\n</form>'],
    ['Táblázat', '<table>\n\t<thead>\n\t\t<tr><th>${1:Név}</th><th>${2:Érték}</th></tr>\n\t</thead>\n\t<tbody>\n\t\t<tr><td>Első</td><td>10</td></tr>\n\t\t<tr><td>Második</td><td>20</td></tr>\n\t</tbody>\n</table>'],
    ['Lista', '<ul>\n\t<li>${1:Első}</li>\n\t<li>Második</li>\n\t<li>Harmadik</li>\n</ul>'],
    ['Kép', '<figure>\n\t<img src="${1:kep.jpg}" alt="${2:Kép leírása}">\n\t<figcaption>${3:Képaláírás}</figcaption>\n</figure>'],
    ['Gomb', '<button type="button" class="btn">${1:Gomb}</button>'],
    ['Galéria', '<section class="galeria">\n\t<img src="${1:1.jpg}" alt="">\n\t<img src="2.jpg" alt="">\n\t<img src="3.jpg" alt="">\n</section>'],
    ['Szakasz', '<section id="${1:rolunk}">\n\t<h2>${2:Rólunk}</h2>\n\t<p>${3:Szöveg}</p>\n</section>'],
    ['Videó', '<video src="${1:video.mp4}" controls width="640"></video>'],
    ['Lábléc', '<footer class="footer">\n\t<p>© ${1:2026} ${2:Márkanév}</p>\n</footer>']
  ];

  function domTree(a) {
    const doc = new DOMParser().parseFromString(annotate(a.model.getValue()), 'text/html');
    const rows = [];
    const cur = F.editor.getPosition() ? F.editor.getPosition().lineNumber : 0;
    const walk = (el, depth) => {
      [...el.children].forEach((c) => {
        if (['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'BR'].includes(c.tagName)) return;
        rows.push({ el: c, depth, line: +c.getAttribute('data-nxl') || 0 });
        if (depth < 9) walk(c, depth + 1);
      });
    };
    walk(doc.body, 0);
    let selLine = 0;
    rows.forEach((r) => { if (r.line && r.line <= cur) selLine = r.line; });
    return { rows, selLine, doc };
  }

  function elementsPanel(body, a) {
    body.innerHTML = '';
    const grid = h('div', { class: 'grid3' });
    BLOCKS.forEach(([name, snip]) => grid.append(h('button', { class: 'chip', title: name + ' beszúrása a kurzorhoz', onclick: () => F.insertSnippet(snip) }, name)));
    body.append(h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Elemek beszúrása', h('span', { class: 'sub', text: 'a kurzorhoz' })), grid,
      h('div', { class: 'set-note', html: 'Tipp: írd be, hogy <code style="font-family:var(--font-code);color:var(--accent)">ul>li*3</code>, és nyomj Tabot (Emmet).' })));
    const { rows, selLine } = domTree(a);
    const tree = h('div', { class: 'dom-tree' });
    rows.slice(0, 400).forEach((r) => {
      const el = r.el;
      const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '';
      const txt = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').slice(0, 28);
      tree.append(h('div', { class: r.line === selLine ? 'sel' : '', style: { paddingLeft: (6 + r.depth * 14) + 'px' }, onclick: () => { F.goto(r.line, 1); W.frames.forEach((f) => post(f, { t: 'highlight', line: r.line, scroll: true })); },
        html: `<span class="tg">${esc(el.tagName.toLowerCase())}</span>${el.id ? '<span class="cl">#' + esc(el.id) + '</span>' : ''}<span class="cl">${esc(cls)}</span>${txt ? ' <span style="color:var(--muted-2)">' + esc(txt) + '</span>' : ''}` }));
    });
    body.append(h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Szerkezet', h('span', { class: 'sub', text: rows.length + ' elem' })), rows.length ? tree : h('div', { class: 'set-note', text: 'A <body> még üres.' })));
  }

  function checks(a) {
    const text = a.model.getValue();
    const { doc } = domTree(a);
    const out = [];
    const ln = (el) => +el.getAttribute('data-nxl') || 1;
    const add = (sev, msg, line, why) => out.push({ sev, msg, line, why });
    if (!/<html[^>]*\blang=/i.test(text)) add('warn', 'Hiányzik a nyelv: <html lang="hu">', 1, 'A felolvasóprogramok és a keresők ebből tudják, milyen nyelvű az oldal.');
    if (!/<title>[^<]+<\/title>/i.test(text)) add('warn', 'Nincs <title> az oldalon', 1, 'Ez jelenik meg a böngészőfülön és a keresőtalálatokban.');
    if (!/name=["']viewport["']/i.test(text)) add('err', 'Hiányzik a viewport meta', 1, 'Nélküle telefonon kicsinyítve, apró betűkkel jelenik meg az oldal. Tedd a <head>-be: <meta name="viewport" content="width=device-width, initial-scale=1">');
    if (!/<meta[^>]+charset/i.test(text)) add('warn', 'Hiányzik a karakterkódolás', 1, 'Az ékezetek miatt kell: <meta charset="UTF-8">');
    doc.querySelectorAll('img').forEach((el) => { if (!el.hasAttribute('alt')) add('err', 'Kép alt szöveg nélkül', ln(el), 'Írd le röviden, mi van a képen. Ha díszítés, legyen alt="".'); });
    doc.querySelectorAll('a').forEach((el) => {
      if (!el.getAttribute('href')) add('warn', 'Link href nélkül', ln(el), 'A link nem visz sehova. Adj meg címet, vagy használj <button>-t.');
      if (!el.textContent.trim() && !el.getAttribute('aria-label') && !el.querySelector('img[alt]')) add('err', 'Üres link szöveg nélkül', ln(el), 'Felolvasóval nem derül ki, hova visz.');
    });
    doc.querySelectorAll('button').forEach((el) => { if (!el.textContent.trim() && !el.getAttribute('aria-label')) add('err', 'Gomb felirat nélkül', ln(el), 'Adj neki szöveget vagy aria-label attribútumot.'); });
    doc.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select').forEach((el) => {
      const labeled = (el.id && doc.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label') || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
      if (!labeled) add('warn', `Űrlapmező címke nélkül (<${el.tagName.toLowerCase()}>)`, ln(el), 'Kössd össze egy <label for="..."> elemmel, így a címkére kattintva is aktív lesz.');
    });
    const hs = [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    const h1s = hs.filter((x) => x.tagName === 'H1');
    if (!h1s.length && doc.body.children.length) add('warn', 'Nincs <h1> főcím', 1, 'Minden oldalnak legyen egy fő címe.');
    if (h1s.length > 1) add('warn', 'Több <h1> is van', ln(h1s[1]), 'Egy oldalon egy fő cím legyen, a többi <h2>, <h3>.');
    let prev = 0;
    hs.forEach((x) => { const lv = +x.tagName[1]; if (prev && lv > prev + 1) add('warn', `Címszint ugrás: h${prev} után h${lv}`, ln(x), 'Ne hagyj ki szintet, így logikus marad a szerkezet.'); prev = lv; });
    const ids = {};
    doc.querySelectorAll('[id]').forEach((el) => { if (ids[el.id]) add('err', `Ismétlődő id: #${el.id}`, ln(el), 'Egy id csak egyszer szerepelhet az oldalon.'); ids[el.id] = 1; });
    const files = new Set(F.files());
    const dir = dirOf(a.path);
    doc.querySelectorAll('[src], link[href], a[href]').forEach((el) => {
      const ref = el.getAttribute('src') || el.getAttribute('href');
      if (!isLocalRef(ref) || ref.startsWith('/')) return;
      const p = join(dir, cleanRef(ref));
      if (!p || files.has(p) || [...files].some((f) => f.startsWith(p + '/'))) return;
      add('err', `Hiányzó fájl: ${ref}`, ln(el) || lineOf(text, ref), `A(z) ${p} nem létezik a projektben. Elírtad, vagy még nem töltötted fel?`);
    });
    return out.sort((x, y) => (x.sev === 'warn') - (y.sev === 'warn') || x.line - y.line);
  }
  const lineOf = (text, s) => { const i = text.indexOf(s); return i < 0 ? 1 : text.slice(0, i).split('\n').length; };

  function checkPanel(body, a) {
    body.innerHTML = '';
    const list = checks(a);
    if (!list.length) body.append(h('div', { class: 'ok-card' }, h('span', { class: 'diamond' }), h('span', { text: 'Minden ellenőrzés rendben: akadálymentesség, mobilnézet, hivatkozások.' })));
    list.forEach((c) => body.append(h('div', { class: 'a11y-item', onclick: () => F.goto(c.line, 1) }, h('span', { class: 'pr-sev' + (c.sev === 'warn' ? ' warn' : '') }), h('span', null, h('b', { style: { fontWeight: 600 }, text: c.msg }), h('br'), h('span', { style: { color: 'var(--muted)' }, text: c.why }), ' ', h('small', { text: c.line + '. sor' })))));
    F.problems.set('html', list.map((c) => ({ file: a.path, line: c.line, sev: c.sev === 'warn' ? 'warn' : 'err', title: c.msg, detail: 'HTML-ellenőrzés' })));
  }

  // ───────────── CSS: színek, építők, változók ─────────────
  const COLOR_RE = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
  function toHex(c) {
    const el = document.createElement('canvas').getContext('2d');
    el.fillStyle = '#000';
    el.fillStyle = c;
    const v = el.fillStyle;
    if (v.startsWith('#')) return v.length === 7 ? v : null;
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v);
    return m ? '#' + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('') : null;
  }
  function mix(hex, to, t) {
    const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16);
    const ch = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
    return '#' + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  function colorsIn(text) {
    const map = new Map();
    const lines = text.split('\n');
    lines.forEach((l, i) => {
      if (/^\s*\/[/*]/.test(l)) return;
      let m;
      COLOR_RE.lastIndex = 0;
      while ((m = COLOR_RE.exec(l))) {
        const key = m[0].toLowerCase().replace(/\s+/g, '');
        if (!map.has(key)) map.set(key, { raw: m[0], uses: [], name: null });
        const e = map.get(key);
        e.uses.push({ line: i + 1, col: m.index + 1 });
        const v = /^\s*(--[\w-]+)\s*:/.exec(l);
        if (v && !e.name) e.name = v[1];
      }
    });
    return [...map.values()];
  }
  function ruleAt(model) {
    const pos = F.editor.getPosition();
    if (!pos) return null;
    const text = model.getValue();
    const off = model.getOffsetAt(pos);
    const open = text.lastIndexOf('{', off - 1), close = text.lastIndexOf('}', off - 1);
    if (open < 0 || close > open) return null;
    const sel = text.slice(text.lastIndexOf('}', open) + 1, open).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    return sel.split('\n').pop().trim() || null;
  }

  const B = W.builder = F.store.get('cssBuilder', { mode: 'column', justify: 'flex-start', align: 'stretch', gap: 16, cols: 3 });
  const SH = W.shadow = F.store.get('cssShadow', { x: 0, y: 10, blur: 24, spread: -6, alpha: 35, color: '#3B2A20', inset: false });
  const builderCss = () => (B.mode === 'grid'
    ? `display: grid;\ngrid-template-columns: repeat(${B.cols}, minmax(0, 1fr));\ngap: ${B.gap}px;\nalign-items: ${B.align};`
    : `display: flex;\nflex-direction: ${B.mode};\njustify-content: ${B.justify};\nalign-items: ${B.align};\ngap: ${B.gap}px;`);
  const shadowVal = () => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(SH.color.slice(i, i + 2), 16)); return `${SH.inset ? 'inset ' : ''}${SH.x}px ${SH.y}px ${SH.blur}px ${SH.spread}px rgba(${r}, ${g}, ${b}, ${(SH.alpha / 100).toFixed(2)})`; };

  function insertDecls(css) {
    const a = F.active();
    if (!a) return;
    const pos = F.editor.getPosition();
    const lineText = a.model.getLineContent(pos.lineNumber);
    const ind = (lineText.match(/^\s*/) || [''])[0] || '  ';
    const text = css.split('\n').map((l, i) => (i ? ind : '') + l).join('\n');
    const atEmpty = !lineText.trim();
    F.editor.executeEdits('facet', [{ range: new monaco.Range(pos.lineNumber, atEmpty ? 1 : pos.column, pos.lineNumber, atEmpty ? lineText.length + 1 : pos.column), text: (atEmpty ? ind : '') + text }]);
    F.editor.focus();
  }

  function visualPanel(body, a) {
    body.innerHTML = '';
    const text = a.model.getValue();
    const colors = colorsIn(text);
    const sel = ruleAt(a.model);
    const cbox = h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Színek ebben a fájlban', h('span', { class: 'sub', text: colors.length + ' szín' })));
    if (!colors.length) cbox.append(h('div', { class: 'set-note', text: 'Még nincs szín a fájlban. Használd a Színválasztót, vagy írj be egy hex kódot.' }));
    colors.slice(0, 24).forEach((c) => {
      const hex = toHex(c.raw);
      const sw = h('label', { class: 'swatch', style: { background: c.raw }, title: 'Átszínezés: minden előfordulás egyszerre változik' });
      if (hex) {
        const inp = h('input', { type: 'color', value: hex, 'aria-label': 'Szín módosítása: ' + c.raw });
        let cur = c.raw;
        inp.addEventListener('input', () => {
          const nv = inp.value.toUpperCase();
          const model = a.model;
          const edits = [];
          const re = new RegExp(cur.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
          model.getValue().split('\n').forEach((l, i) => {
            let m; re.lastIndex = 0;
            while ((m = re.exec(l))) edits.push({ range: new monaco.Range(i + 1, m.index + 1, i + 1, m.index + 1 + m[0].length), text: nv });
          });
          if (edits.length) model.pushEditOperations([], edits, () => null);
          cur = nv;
          sw.style.background = nv;
          info.lastChild.textContent = nv + ' · ' + c.uses.length + ' helyen';
        });
        inp.addEventListener('change', () => F.refreshStage());
        sw.append(inp);
      }
      let n = 0;
      const info = h('span', { class: 'sw-info', onclick: () => { const u = c.uses[n++ % c.uses.length]; F.goto(u.line, u.col, u.col + c.raw.length); } },
        h('span', { class: 'sw-name', text: c.name || c.raw }), h('span', { class: 'sw-sub', text: (c.name ? c.raw + ' · ' : '') + c.uses.length + ' helyen' }));
      const tints = h('span', { class: 'tints' });
      if (hex) [mix(hex, '#FFFFFF', 0.45), hex.toUpperCase(), mix(hex, '#000000', 0.4)].forEach((t) => tints.append(h('button', { style: { background: t }, title: t + ' beszúrása', onclick: () => F.insertSnippet(t) })));
      cbox.append(h('div', { class: 'swatch-row' }, sw, info, tints));
    });
    const pick = h('input', { type: 'color', id: 'cssPick', value: '#4DA3FF', style: { width: '40px', height: '32px', border: '0', background: 'transparent', padding: '0' } });
    pick.onchange = () => F.insertSnippet(pick.value.toUpperCase());
    cbox.append(h('label', { class: 'range-row', for: 'cssPick' }, h('span', { text: 'Új szín' }), pick, h('span', { class: 'set-note', text: 'választás után a kurzorhoz kerül' })));
    body.append(cbox);

    // Flexbox / Grid építő
    const demo = h('div', { class: 'flex-demo' });
    const code = h('div', { class: 'code-out' });
    const paint = () => {
      F.store.set('cssBuilder', B);
      demo.style.display = B.mode === 'grid' ? 'grid' : 'flex';
      demo.style.flexDirection = B.mode === 'grid' ? '' : B.mode;
      demo.style.justifyContent = B.justify;
      demo.style.alignItems = B.align;
      demo.style.gap = Math.round(B.gap / 2) + 'px';
      demo.style.gridTemplateColumns = B.mode === 'grid' ? `repeat(${B.cols}, minmax(0, 1fr))` : '';
      demo.innerHTML = '';
      const n = B.mode === 'grid' ? Math.max(3, B.cols * 2) : 3;
      for (let i = 0; i < n; i++) demo.append(h('span', { style: B.mode === 'grid' ? { height: '16px' } : { width: [56, 34, 44][i % 3] + 'px', height: [14, 22, 18][i % 3] + 'px' } }));
      code.textContent = builderCss();
      $$('[data-bmode]', fb).forEach((x) => x.classList.toggle('active', x.dataset.bmode === B.mode));
      $$('[data-just]', fb).forEach((x) => x.classList.toggle('active', x.dataset.just === B.justify));
      $$('[data-align]', fb).forEach((x) => x.classList.toggle('active', x.dataset.align === B.align));
      gapOut.value = B.gap + 'px';
      colsRow.hidden = B.mode !== 'grid';
      justRow.hidden = B.mode === 'grid';
      colsOut.value = B.cols;
    };
    const seg = (attr, items, key) => h('div', { class: 'seg-group' }, items.map(([v, l]) => h('button', { class: 'seg', ['data-' + attr]: v, onclick: () => { B[key] = v; paint(); } }, l)));
    const gapIn = h('input', { type: 'range', min: 0, max: 64, step: 2, value: B.gap, id: 'bGap' });
    const gapOut = h('output');
    gapIn.oninput = () => { B.gap = +gapIn.value; paint(); };
    const colsIn = h('input', { type: 'range', min: 1, max: 6, value: B.cols, id: 'bCols' });
    const colsOut = h('output');
    colsIn.oninput = () => { B.cols = +colsIn.value; paint(); };
    const colsRow = h('label', { class: 'range-row', for: 'bCols' }, h('span', { text: 'Oszlopok' }), colsIn, colsOut);
    const justRow = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, h('span', { class: 'set-note', text: 'Főtengely (justify-content)' }), seg('just', [['flex-start', 'eleje'], ['center', 'közép'], ['space-between', 'szét'], ['flex-end', 'vége']], 'justify'));
    const fb = h('div', { class: 'card' },
      h('div', { class: 'card-title' }, 'Flexbox és Grid építő', h('span', { class: 'sub', text: sel || 'kurzor helye' })),
      seg('bmode', [['row', 'sor'], ['column', 'oszlop'], ['grid', 'rács']], 'mode'),
      demo, justRow,
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, h('span', { class: 'set-note', text: 'Kereszttengely (align-items)' }), seg('align', [['flex-start', 'eleje'], ['center', 'közép'], ['stretch', 'nyújt'], ['flex-end', 'vége']], 'align')),
      h('label', { class: 'range-row', for: 'bGap' }, h('span', { text: 'Térköz' }), gapIn, gapOut), colsRow, code,
      h('button', { class: 'chip primary', style: { justifyContent: 'center' }, onclick: () => insertDecls(builderCss()) }, 'Beszúrás a kurzorhoz'));
    body.append(fb);
    paint();

    // Árnyéktervező
    const sdemo = h('div', { class: 'shadow-demo' }, h('span'));
    const scode = h('div', { class: 'code-out' });
    const spaint = () => { F.store.set('cssShadow', SH); sdemo.firstChild.style.boxShadow = shadowVal(); scode.textContent = 'box-shadow: ' + shadowVal() + ';'; };
    const rng = (key, label, min, max, unit) => {
      const id = 'sh_' + key;
      const inp = h('input', { type: 'range', id, min, max, value: SH[key] });
      const out = h('output', { text: SH[key] + unit });
      inp.oninput = () => { SH[key] = +inp.value; out.value = SH[key] + unit; spaint(); };
      return h('label', { class: 'range-row', for: id }, h('span', { text: label }), inp, out);
    };
    const scol = h('input', { type: 'color', id: 'shColor', value: SH.color, style: { width: '40px', height: '28px', border: '0', background: 'transparent', padding: '0' } });
    scol.oninput = () => { SH.color = scol.value; spaint(); };
    body.append(h('div', { class: 'card' },
      h('div', { class: 'card-title' }, 'Árnyéktervező', h('span', { class: 'sub', text: 'box-shadow' })),
      sdemo, rng('x', 'Vízszintes', -40, 40, 'px'), rng('y', 'Függőleges', -40, 60, 'px'), rng('blur', 'Elmosás', 0, 80, 'px'), rng('spread', 'Kiterjedés', -30, 30, 'px'), rng('alpha', 'Erősség', 0, 100, '%'),
      h('label', { class: 'range-row', for: 'shColor' }, h('span', { text: 'Szín' }), scol), scode,
      h('button', { class: 'chip primary', style: { justifyContent: 'center' }, onclick: () => insertDecls('box-shadow: ' + shadowVal() + ';') }, 'Beszúrás a kurzorhoz')));
    spaint();
  }

  function varsPanel(body, a) {
    body.innerHTML = '';
    const text = a.model.getValue();
    const vars = [];
    text.split('\n').forEach((l, i) => {
      const m = /^(\s*)(--[\w-]+)\s*:\s*([^;]+);/.exec(l);
      if (m) vars.push({ name: m[2], value: m[3].trim(), line: i + 1, col: l.indexOf(m[3]) + 1 });
    });
    const card = h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'CSS változók', h('span', { class: 'sub', text: vars.length + ' db' })));
    if (!vars.length) card.append(h('div', { class: 'set-note', html: 'Még nincs változó. A <code style="font-family:var(--font-code)">:root { --szin: #C8793A; }</code> formában definiáld, és <code style="font-family:var(--font-code)">var(--szin)</code>-nel használd. Így egy helyen tudod módosítani.' }));
    vars.forEach((v) => {
      const uses = (text.match(new RegExp('var\\(\\s*' + v.name + '\\b', 'g')) || []).length;
      const isColor = !!toHex(v.value) && COLOR_RE.test(v.value);
      COLOR_RE.lastIndex = 0;
      const inp = h('input', { class: 'field', value: v.value, 'aria-label': v.name, spellcheck: 'false' });
      inp.onchange = () => {
        const model = a.model;
        const line = model.getLineContent(v.line);
        const m = /^(\s*--[\w-]+\s*:\s*)([^;]+)(;.*)$/.exec(line);
        if (!m) return F.refreshStage();
        model.pushEditOperations([], [{ range: new monaco.Range(v.line, m[1].length + 1, v.line, m[1].length + m[2].length + 1), text: inp.value.trim() }], () => null);
        F.refreshStage();
      };
      card.append(h('div', { class: 'var-row' },
        h('span', { class: 'vn', title: `${v.name} · ${uses} használat`, text: v.name, onclick: () => F.goto(v.line, v.col) }),
        isColor ? h('span', { class: 'vs', style: { background: v.value } }) : null, inp,
        h('span', { class: 'kbd', title: 'használat', text: '×' + uses })));
    });
    card.append(h('button', { class: 'chip', style: { alignSelf: 'flex-start' }, onclick: () => F.insertSnippet('--${1:nev}: ${2:érték};') }, '+ Új változó a kurzorhoz'));
    body.append(card);
  }

  // ───────────── JS: kódrészletek ─────────────
  const JS_SNIPS = [
    ['Elem kiválasztása', "const ${1:elem} = document.querySelector('${2:.osztaly}');"],
    ['Összes elem', "const ${1:elemek} = document.querySelectorAll('${2:.osztaly}');"],
    ['Kattintás esemény', "${1:elem}.addEventListener('click', (e) => {\n\t${0}\n});"],
    ['Űrlap beküldése', "${1:form}.addEventListener('submit', (e) => {\n\te.preventDefault();\n\tconst adatok = new FormData(e.target);\n\t${0}\n});"],
    ['fetch (JSON)', "const valasz = await fetch('${1:adatok.json}');\nconst ${2:adat} = await valasz.json();"],
    ['Függvény', 'function ${1:nev}(${2:param}) {\n\t${0}\n}'],
    ['Nyílfüggvény', 'const ${1:nev} = (${2:param}) => {\n\t${0}\n};'],
    ['Időzítő', 'setTimeout(() => {\n\t${0}\n}, ${1:1000});'],
    ['Ciklus tömbön', '${1:tomb}.forEach((${2:elem}) => {\n\t${0}\n});'],
    ['Mentés (localStorage)', "localStorage.setItem('${1:kulcs}', JSON.stringify(${2:ertek}));"],
    ['Betöltés (localStorage)', "const ${1:ertek} = JSON.parse(localStorage.getItem('${2:kulcs}') || 'null');"],
    ['Osztály', 'class ${1:Nev} {\n\tconstructor(${2:param}) {\n\t\t${0}\n\t}\n}'],
    ['Elem létrehozása', "const ${1:el} = document.createElement('${2:div}');\n${1:el}.textContent = '${3:Szöveg}';\ndocument.body.append(${1:el});"],
    ['Osztály ki/be', "${1:elem}.classList.toggle('${2:aktiv}');"]
  ];
  function jsSnipPanel(body) {
    body.innerHTML = '';
    const grid = h('div', { class: 'grid2' });
    JS_SNIPS.forEach(([n, s]) => grid.append(h('button', { class: 'chip', onclick: () => F.insertSnippet(s) }, n)));
    body.append(h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Kódrészletek', h('span', { class: 'sub', text: 'a kurzorhoz' })), grid));
  }

  // ───────────── vázlatok ─────────────
  function cssOutline(model) {
    const out = [];
    const text = model.getValue().replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    const re = /(^|})\s*([^{}@][^{}]*?)\s*\{/g;
    let m;
    while ((m = re.exec(text))) {
      const sel = m[2].trim();
      if (!sel || /^\d+%$|^from$|^to$/.test(sel)) continue;
      const line = text.slice(0, m.index + m[0].indexOf(m[2])).split('\n').length;
      out.push({ k: sel[0] === '.' ? '.' : sel[0] === '#' ? '#' : sel[0] === ':' ? ':' : '◇', c: '#FFB86B', t: sel.replace(/\s+/g, ' ').slice(0, 60), line });
    }
    text.replace(/@(media|keyframes|supports|font-face)[^{]*/g, (mm, k, off) => { out.push({ k: '@', c: '#B9A6F7', t: mm.trim().slice(0, 60), line: text.slice(0, off).split('\n').length }); return mm; });
    return out.sort((x, y) => x.line - y.line);
  }
  function htmlOutline(model) {
    const out = [];
    const re = /<(h[1-6]|header|nav|main|section|article|aside|footer|form|table|ul|ol|div|img|button)\b([^>]*)>/gi;
    const text = model.getValue();
    let m;
    while ((m = re.exec(text))) {
      const tag = m[1].toLowerCase();
      const id = /\bid\s*=\s*["']([^"']+)/.exec(m[2]);
      const cl = /\bclass\s*=\s*["']([^"']+)/.exec(m[2]);
      if (tag === 'div' && !id && !cl) continue;
      let label = tag + (id ? '#' + id[1] : '') + (cl ? '.' + cl[1].trim().split(/\s+/)[0] : '');
      if (/^h[1-6]$/.test(tag)) { const end = text.indexOf('</' + tag, m.index); if (end > 0) label += '  ' + text.slice(m.index + m[0].length, end).replace(/<[^>]+>/g, '').trim().slice(0, 30); }
      out.push({ k: /^h[1-6]$/.test(tag) ? tag.toUpperCase() : '◇', c: '#FF8FA3', t: label, line: text.slice(0, m.index).split('\n').length, depth: /^h[2-6]$/.test(tag) ? +tag[1] - 1 : 0 });
      if (out.length > 300) break;
    }
    return out;
  }
  function jsOutline(model) {
    const out = [];
    model.getValue().split('\n').forEach((l, i) => {
      let m;
      if ((m = /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)\s*\(([^)]*)/.exec(l))) out.push({ k: 'ƒ', c: '#7FB4FF', t: m[1] + '(' + m[2] + ')', line: i + 1 });
      else if ((m = /^\s*(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/.exec(l))) out.push({ k: 'ƒ', c: '#7FB4FF', t: m[1] + '()', line: i + 1 });
      else if ((m = /^\s*(?:export\s+)?class\s+([\w$]+)/.exec(l))) out.push({ k: 'C', c: '#6FD3C1', t: m[1], line: i + 1 });
      else if ((m = /^\s*([\w$]+)\s*\(([^)]*)\)\s*\{/.exec(l)) && !/^(if|for|while|switch|catch|function)$/.test(m[1])) out.push({ k: 'm', c: '#7FB4FF', t: m[1] + '()', line: i + 1, depth: 1 });
      else if ((m = /^(?:const|let)\s+([\w$]+)\s*=/.exec(l))) out.push({ k: 'v', c: '#B9A6F7', t: m[1], line: i + 1 });
    });
    return out;
  }

  // ───────────── facet regisztráció ─────────────
  const previewStage = { id: 'preview', label: 'Élő előnézet', fill: true, render: previewPanel };
  W.runJs = (a) => runJs(a);
  const showPreview = () => { if (!F.panelOpen('stage')) F.setPanel('stage', true); if (F.stageTab() !== 'preview') F.showStage('preview'); else W.render(true); };

  async function wrapTag() {
    const sel = F.editor.getSelection();
    if (!sel || sel.isEmpty()) return F.toast('Jelölj ki valamit, amit becsomagolsz.');
    const v = await F.dialog({ title: 'Becsomagolás címkébe', fields: [{ id: 't', label: 'Címke', value: 'div', placeholder: 'pl. section, strong, a' }], ok: 'Becsomagolás', validate: (x) => (/^[a-z][\w-]*$/i.test(x.t.split(/[.#\s]/)[0]) ? null : 'Érvényes címkenevet adj meg.') });
    if (!v) return;
    const m = /^([a-z][\w-]*)((?:[.#][\w-]+)*)/i.exec(v.t);
    const tag = m[1];
    const cls = (m[2].match(/\.[\w-]+/g) || []).map((x) => x.slice(1)).join(' ');
    const id = ((m[2].match(/#[\w-]+/) || [])[0] || '').slice(1);
    const text = F.editor.getModel().getValueInRange(sel);
    const open = `<${tag}${id ? ` id="${id}"` : ''}${cls ? ` class="${cls}"` : ''}>`;
    F.editor.executeEdits('facet', [{ range: sel, text: open + text + `</${tag}>` }]);
  }

  F.extendFacet('html', {
    runLabel: 'Előnézet', run: async () => showPreview(), bottom: 'console', hint: 'Az előnézet konzolja ide érkezik', outline: htmlOutline,
    tools: [
      { label: 'Elem beszúrása', run: () => F.showStage('elements') },
      { label: 'HTML5 váz', kbd: '!', run: () => F.insertSnippet(window.FacetSamples.blank('oldal.html').replace(/\$/g, '\\$').replace('<h1>oldal</h1>', '<h1>${1:Cím}</h1>')) },
      { label: 'Becsomagolás', run: wrapTag },
      { label: 'Kép', kbd: 'img', run: () => F.insertSnippet('<img src="${1:kep.jpg}" alt="${2:Kép leírása}">') },
      { label: 'Link', kbd: 'a', run: () => F.insertSnippet('<a href="${1:#}">${2:Link szövege}</a>') },
      { label: 'Kijelölés', run: () => { showPreview(); setTimeout(() => setInspect(!W.inspect), 60); } },
      { label: 'Formázás', kbd: '⇧⌥F', run: () => F.editor.getAction('editor.action.formatDocument').run() }
    ],
    stage: [previewStage, { id: 'elements', label: 'Elemek', render: elementsPanel }, { id: 'check', label: () => { const a = F.active(); const n = a && a.facet === 'html' ? checks(a).length : 0; return 'Ellenőrzés' + (n ? ` <span class="count">${n}</span>` : ''); }, render: checkPanel }],
    onActivate(path) { const a = F.active(); if (a) F.problems.set('html', checks(a).map((c) => ({ file: path, line: c.line, sev: c.sev === 'warn' ? 'warn' : 'err', title: c.msg, detail: 'HTML-ellenőrzés' }))); },
    onChange() { if (F.stageTab() === 'elements' || F.stageTab() === 'check') F.refreshStage(); }
  });

  F.extendFacet('css', {
    runLabel: 'Előnézet', run: async () => showPreview(), bottom: 'console', hint: 'Az előnézet konzolja ide érkezik', outline: cssOutline,
    tools: [
      { label: 'Színválasztó', run: () => { F.showStage('visual'); setTimeout(() => { const p = $('#cssPick'); if (p) p.click(); }, 80); } },
      { label: 'Flexbox', kbd: 'df', run: () => insertDecls('display: flex;\nalign-items: center;\ngap: 16px;') },
      { label: 'Grid', kbd: 'dg', run: () => insertDecls('display: grid;\ngrid-template-columns: repeat(auto-fit, minmax(200px, 1fr));\ngap: 16px;') },
      { label: 'Árnyék', kbd: 'bxs', run: () => F.showStage('visual') },
      { label: 'Változó', kbd: '--', run: () => F.insertSnippet('--${1:nev}: ${2:érték};') },
      { label: 'Média lekérdezés', kbd: '@m', run: () => F.insertSnippet('@media (max-width: ${1:600px}) {\n\t${0}\n}') },
      { label: 'Formázás', kbd: '⇧⌥F', run: () => F.editor.getAction('editor.action.formatDocument').run() }
    ],
    stage: [{ id: 'visual', label: 'Vizuális eszközök', render: visualPanel }, previewStage, { id: 'vars', label: 'Változók', render: varsPanel }],
    onChange() { if (F.stageTab() === 'vars') F.refreshStage(); }
  });

  F.extendFacet('js', {
    runLabel: 'Futtatás', run: async (a) => { const p = await htmlFor(a.path); if (p) showPreview(); else runJs(a); }, bottom: 'console', hint: 'console.log kimenete ide érkezik', outline: jsOutline,
    tools: [
      { label: 'Elem kiválasztása', run: () => F.insertSnippet(JS_SNIPS[0][1]) },
      { label: 'Esemény', run: () => F.insertSnippet(JS_SNIPS[2][1]) },
      { label: 'fetch', run: () => F.insertSnippet(JS_SNIPS[4][1]) },
      { label: 'Függvény', run: () => F.insertSnippet(JS_SNIPS[6][1]) },
      { label: 'console.log', kbd: 'log', run: () => F.insertSnippet('console.log(${1});') },
      { label: 'Formázás', kbd: '⇧⌥F', run: () => F.editor.getAction('editor.action.formatDocument').run() }
    ],
    stage: [previewStage, { id: 'snippets', label: 'Kódrészletek', render: jsSnipPanel }]
  });

  F.extendFacet('json', {
    tools: [
      { label: 'Formázás', kbd: '⇧⌥F', run: () => F.editor.getAction('editor.action.formatDocument').run() },
      { label: 'Ellenőrzés', run: () => { try { JSON.parse(F.editor.getModel().getValue()); F.toast('Érvényes JSON.', 'ok'); } catch (e) { F.toast('Hibás JSON: ' + esc(e.message), 'err'); } } },
      { label: 'Tömörítés', run: () => { try { F.replaceAll(F.editor.getModel(), JSON.stringify(JSON.parse(F.editor.getModel().getValue())), 'Tömörítve'); } catch (e) { F.toast('Hibás JSON: ' + esc(e.message), 'err'); } } }
    ]
  });

  const md = (s) => esc(s).replace(/^### (.*)$/gm, '<h3>$1</h3>').replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^# (.*)$/gm, '<h1>$1</h1>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<i>$1</i>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/^- (.*)$/gm, '• $1').replace(/\n\n/g, '<br><br>');
  F.extendFacet('md', {
    stage: [{ id: 'mdview', label: 'Nézet', render: (b, a) => { b.innerHTML = ''; b.append(h('div', { class: 'card', style: { lineHeight: '1.6', color: 'var(--fg)' }, html: md(a.model.getValue()) })); } }],
    onChange() { F.refreshStage(); }
  });

  // ───────────── események ─────────────
  W.showPreview = showPreview;
  const rerender = F.debounce(() => { if (F.stageTab() === 'preview' && ['html', 'css', 'js'].includes(F.state.facet)) W.render(); }, 280);
  F.on('change', (path) => {
    if (!['html', 'htm', 'css', 'js'].includes(F.ext(path))) return;
    if (!W.htmlPath || F.projectOf(path) === F.projectOf(W.htmlPath) || (W.used && W.used.has(path))) rerender();
  });
  F.on('resize', F.debounce(fit, 60));
  window.addEventListener('resize', F.debounce(fit, 100));
  F.on('cursor', F.debounce(() => {
    const a = F.active();
    if (!a || a.facet !== 'html') return;
    if (F.stageTab() === 'elements') F.refreshStageNow();
    if (W.inspect && W.frames.length) W.frames.forEach((f) => post(f, { t: 'highlight', line: F.editor.getPosition().lineNumber, scroll: true }));
  }, 250));
  F.on('facet', (k) => { if (!['html', 'css', 'js'].includes(k) && W.inspect) W.inspect = false; });

  const WC = (facet, label, keywords, run, icon) => F.command({ label, keywords, run, icon, facet });
  ['html', 'css', 'js'].forEach((fk) => {
    WC(fk, 'Előnézet frissítése', 'preview reload frissites', () => showPreview(), '↻');
    WC(fk, 'Telefon nézet', 'mobil phone eszkoz', () => { showPreview(); setMode('phone'); }, '▯');
    WC(fk, 'Tablet nézet', 'tablet ipad', () => { showPreview(); setMode('tablet'); }, '▭');
    WC(fk, 'Asztali nézet', 'desktop monitor', () => { showPreview(); setMode('desktop'); }, '▬');
    WC(fk, '3 nézet egyszerre', 'multi responsive reszponziv', () => { showPreview(); setMode('multi'); }, '☰');
    WC(fk, 'Kijelölés az előnézetben', 'inspect kijeloles vizsgalat', () => { showPreview(); setTimeout(() => setInspect(!W.inspect), 60); }, '↖');
    WC(fk, 'Megnyitás új böngészőlapon', 'open browser tab bongeszo', () => openInTab(), '↗');
  });
  WC('html', 'Becsomagolás címkébe', 'wrap tag csomagolas', wrapTag, '<>');
  WC('html', 'Oldal ellenőrzése', 'check a11y akadalymentes seo', () => F.showStage('check'), '✓');
  WC('html', 'Elempaletta', 'elements blokk komponens', () => F.showStage('elements'), '▦');
  WC('css', 'Flexbox és Grid építő', 'flex grid layout elrendezes', () => F.showStage('visual'), '▦');
  WC('css', 'Árnyéktervező', 'shadow arnyek box-shadow', () => F.showStage('visual'), '◫');
  WC('css', 'CSS változók', 'variables valtozo', () => F.showStage('vars'), '--');
  WC('js', 'Futtatás konzolban', 'run console node', () => { const a = F.active(); if (a) runJs(a); }, '▶');
})();
