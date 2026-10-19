/* FACET — Dokumentum facet (mini Word)
   .docx: oldalnézetes, formázott szerkesztés; olvasás és írás saját DOCX-kezelővel.
   .txt:  ugyanaz a papírnézet, sima szöveggel; egy kattintással .docx-szé alakítható.
   .doc / .rtf / .odt: megnyitás az alapértelmezett programmal, átalakítási tanáccsal. */
(function () {
  'use strict';
  const { h, esc, $, $$ } = F;
  const D = F.doc = {};

  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const FONTS = ['Calibri', 'Aptos', 'Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Garamond', 'Verdana', 'Trebuchet MS', 'Courier New'];
  const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];
  const HL = { yellow: '#FFFF00', green: '#00FF00', cyan: '#00FFFF', magenta: '#FF00FF', blue: '#0000FF', red: '#FF0000', darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000', darkYellow: '#808000', darkGray: '#808080', lightGray: '#C0C0C0', black: '#000000', white: '#FFFFFF' };

  // ───────────── konténer (a motor zip-olvasójával/írójával) ─────────────
  function unpack(buf) {
    const dv = new DataView(buf), dec = new TextDecoder();
    const files = {};
    let o = 0;
    while (o + 8 <= buf.byteLength) {
      const nl = dv.getInt32(o); o += 4;
      const name = dec.decode(new Uint8Array(buf, o, nl)); o += nl;
      const dl = dv.getInt32(o); o += 4;
      files[name] = new Uint8Array(buf, o, dl); o += dl;
    }
    return files;
  }
  function pack(files) {
    const enc = new TextEncoder();
    const items = Object.entries(files).map(([n, d]) => [enc.encode(n), typeof d === 'string' ? enc.encode(d) : d]);
    const total = items.reduce((s, [n, d]) => s + 8 + n.length + d.length, 0);
    const out = new Uint8Array(total), dv = new DataView(out.buffer);
    let o = 0;
    items.forEach(([n, d]) => { dv.setInt32(o, n.length); o += 4; out.set(n, o); o += n.length; dv.setInt32(o, d.length); o += 4; out.set(d, o); o += d.length; });
    return out;
  }
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const xmlText = (u8) => new TextDecoder().decode(u8);
  const parseXml = (u8) => (u8 ? new DOMParser().parseFromString(xmlText(u8), 'application/xml') : null);
  const kids = (el, name) => (el ? Array.from(el.childNodes).filter((n) => n.nodeType === 1 && (!name || n.localName === name)) : []);
  const kid = (el, name) => kids(el, name)[0] || null;
  const attr = (el, name) => {
    if (!el) return null;
    for (const a of el.attributes) if (a.localName === name) return a.value;
    return null;
  };
  const deep = (el, name) => { if (!el) return null; const all = el.getElementsByTagNameNS('*', name); return all.length ? all[0] : null; };
  const xe = (t) => String(t).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ───────────── DOCX → HTML ─────────────
  function docxToHtml(files) {
    const doc = parseXml(files['word/document.xml']);
    if (!doc) return { html: '<p><br></p>', notes: [] };
    const notes = new Set();
    // stílusok: címsorok felismerése név alapján (magyar Wordben az azonosító „Cmsor1”, a név „heading 1”)
    const styles = {};
    const st = parseXml(files['word/styles.xml']);
    kids(st && st.documentElement, 'style').forEach((s) => {
      const id = attr(s, 'styleId');
      const name = (attr(kid(s, 'name'), 'val') || '').toLowerCase();
      const snp = kid(kid(s, 'pPr'), 'numPr');
      styles[id] = { name, based: attr(kid(s, 'basedOn'), 'val'), numId: attr(kid(snp, 'numId'), 'val'), ilvl: attr(kid(snp, 'ilvl'), 'val') };
    });
    const headingOf = (id) => {
      let s = styles[id], guard = 0;
      while (s && guard++ < 6) {
        const m = /^heading (\d)$/.exec(s.name);
        if (m) return Math.min(3, +m[1]);
        if (s.name === 'title') return 1;
        if (s.name === 'subtitle') return 2;
        s = styles[s.based];
      }
      const m2 = /^(heading|cmsor|berschrift|titre)(\d)$/i.exec(id || '');
      return m2 ? Math.min(3, +m2[2]) : 0;
    };
    /** Stílusból öröklött számozás (pl. „List Bullet”), vagy a stílus neve alapján. */
    const styleList = (id) => {
      let s = styles[id], guard = 0;
      while (s && guard++ < 6) {
        if (s.numId) return { numId: s.numId, ilvl: +(s.ilvl || 0) };
        if (/^list bullet/.test(s.name)) return { fmt: 'bullet', ilvl: 0 };
        if (/^list number/.test(s.name)) return { fmt: 'decimal', ilvl: 0 };
        s = styles[s.based];
      }
      return null;
    };
    // számozás: bullet vagy szám
    const numFmt = {};
    const nd = parseXml(files['word/numbering.xml']);
    if (nd) {
      const abs = {};
      kids(nd.documentElement, 'abstractNum').forEach((a) => {
        abs[attr(a, 'abstractNumId')] = {};
        kids(a, 'lvl').forEach((l) => { abs[attr(a, 'abstractNumId')][attr(l, 'ilvl')] = attr(kid(l, 'numFmt'), 'val') || 'bullet'; });
      });
      kids(nd.documentElement, 'num').forEach((n) => { numFmt[attr(n, 'numId')] = abs[attr(kid(n, 'abstractNumId'), 'val')] || {}; });
    }
    // kapcsolatok: képek, linkek
    const rels = {};
    const rd = parseXml(files['word/_rels/document.xml.rels']);
    kids(rd && rd.documentElement, 'Relationship').forEach((r) => { rels[attr(r, 'Id')] = attr(r, 'Target'); });
    const media = (rid) => {
      const t = rels[rid];
      if (!t) return null;
      const path = t.startsWith('/') ? t.slice(1) : 'word/' + t.replace(/^\.\//, '');
      const data = files[path];
      if (!data) return null;
      const ext = path.split('.').pop().toLowerCase();
      const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp' }[ext];
      if (!mime) { notes.add('Néhány beágyazott elem (pl. EMF-ábra) nem jeleníthető meg.'); return null; }
      return `data:${mime};base64,${b64(data)}`;
    };

    function runHtml(r, link) {
      const rp = kid(r, 'rPr');
      const css = [];
      let open = '', close = '';
      const on = (n) => { const e = kid(rp, n); return e && attr(e, 'val') !== '0' && attr(e, 'val') !== 'false' && attr(e, 'val') !== 'none'; };
      if (rp) {
        if (on('b')) { open += '<b>'; close = '</b>' + close; }
        if (on('i')) { open += '<i>'; close = '</i>' + close; }
        if (on('u')) { open += '<u>'; close = '</u>' + close; }
        if (on('strike') || on('dstrike')) { open += '<s>'; close = '</s>' + close; }
        const va = attr(kid(rp, 'vertAlign'), 'val');
        if (va === 'superscript') { open += '<sup>'; close = '</sup>' + close; }
        if (va === 'subscript') { open += '<sub>'; close = '</sub>' + close; }
        const col = attr(kid(rp, 'color'), 'val');
        if (col && col !== 'auto') css.push('color:#' + col);
        const hl = attr(kid(rp, 'highlight'), 'val');
        const shd = attr(kid(rp, 'shd'), 'fill');
        if (hl && HL[hl]) css.push('background-color:' + HL[hl]);
        else if (shd && shd !== 'auto' && /^[0-9A-F]{6}$/i.test(shd)) css.push('background-color:#' + shd);
        const sz = attr(kid(rp, 'sz'), 'val');
        if (sz) css.push('font-size:' + (+sz / 2) + 'pt');
        const font = attr(kid(rp, 'rFonts'), 'ascii') || attr(kid(rp, 'rFonts'), 'hAnsi');
        if (font) css.push(`font-family:'${font.replace(/'/g, '')}'`);
      }
      let inner = '';
      kids(r).forEach((n) => {
        switch (n.localName) {
          case 't': inner += esc(n.textContent); break;
          case 'tab': inner += '\t'; break;
          case 'br': if (attr(n, 'type') === 'page') pageBreak = true; else inner += '<br>'; break;
          case 'cr': inner += '<br>'; break;
          case 'noBreakHyphen': inner += '-'; break;
          case 'sym': inner += String.fromCharCode(parseInt(attr(n, 'char') || '20', 16) & 0xFF || 32); break;
          case 'drawing': {
            const blip = deep(n, 'blip');
            const ext = deep(n, 'extent');
            const src = media(attr(blip, 'embed'));
            if (src) {
              const w = Math.round((+attr(ext, 'cx') || 0) / 9525), hh = Math.round((+attr(ext, 'cy') || 0) / 9525);
              inner += `<img src="${src}"${w ? ` width="${w}"` : ''}${hh ? ` height="${hh}"` : ''} alt="">`;
            }
            break;
          }
          case 'pict': case 'object': {
            const im = deep(n, 'imagedata');
            const src = im && media(attr(im, 'id'));
            if (src) inner += `<img src="${src}" alt="">`; else notes.add('Néhány beágyazott objektum nem jeleníthető meg.');
            break;
          }
          default: break;
        }
      });
      if (!inner) return '';
      let html = open + inner + close;
      if (css.length) html = `<span style="${css.join(';')}">${html}</span>`;
      return html;
    }

    function inlineHtml(p) {
      let out = '';
      kids(p).forEach((n) => {
        const ln = n.localName;
        if (ln === 'r') out += runHtml(n);
        else if (ln === 'hyperlink') {
          const href = rels[attr(n, 'id')] || (attr(n, 'anchor') ? '#' + attr(n, 'anchor') : '');
          const inner = kids(n, 'r').map((r) => runHtml(r)).join('');
          out += href ? `<a href="${esc(href)}">${inner}</a>` : inner;
        } else if (ln === 'ins' || ln === 'smartTag' || ln === 'fldSimple' || ln === 'customXml') out += inlineHtml(n);
        else if (ln === 'sdt') out += inlineHtml(kid(n, 'sdtContent'));
        else if (ln === 'del' || ln === 'moveFrom') notes.add('A dokumentum követett (Word-ben elfogadatlan) változásokat tartalmazott; a törölt részek nem látszanak.');
        else if (ln === 'commentRangeStart' || ln === 'commentReference') notes.add('A Word-megjegyzések (kommentek) nem jelennek meg, és mentéskor elvesznek.');
      });
      return out;
    }

    let pageBreak = false;
    const out = [];
    const listStack = []; // { level, tag, numId }
    const closeLists = (toLevel) => { while (listStack.length && listStack[listStack.length - 1].level > toLevel) out.push(`</li></${listStack.pop().tag}>`); };

    function block(el) {
      kids(el).forEach((n) => {
        if (n.localName === 'p') {
          const pp = kid(n, 'pPr');
          const styleId = attr(kid(pp, 'pStyle'), 'val');
          const hd = headingOf(styleId);
          const jc = attr(kid(pp, 'jc'), 'val');
          const align = jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' || jc === 'distribute' ? 'justify' : '';
          const numPr = kid(pp, 'numPr');
          const sl = numPr ? null : styleList(styleId);
          const numId = numPr ? attr(kid(numPr, 'numId'), 'val') : sl && sl.numId ? sl.numId : sl ? 'style:' + sl.fmt : null;
          pageBreak = false;
          const inner = inlineHtml(n) || '<br>';
          const brk = pageBreak;
          const st2 = align ? ` style="text-align:${align}"` : '';
          if (numId && numId !== '0') {
            const lvl = numPr ? +(attr(kid(numPr, 'ilvl'), 'val') || 0) : sl.ilvl;
            const fmt = sl && sl.fmt ? sl.fmt : (numFmt[numId] || {})[String(lvl)] || 'bullet';
            const tag = fmt === 'bullet' || fmt === 'none' ? 'ul' : 'ol';
            closeLists(lvl);
            let top = listStack[listStack.length - 1];
            if (top && top.level === 0 && lvl === 0 && top.numId !== numId && tag === 'ol') { closeLists(-1); top = null; }
            if (top && top.level === lvl) {
              if (top.tag === tag) out.push(`</li><li${st2}>${inner}`);
              else { out.push(`</li></${listStack.pop().tag}>`); out.push(`<${tag}><li${st2}>${inner}`); listStack.push({ level: lvl, tag }); }
            } else {
              let next = top ? top.level + 1 : 0;
              while (next < lvl) { out.push(`<${tag}><li>`); listStack.push({ level: next, tag }); next++; }
              out.push(`<${tag}><li${st2}>${inner}`);
              listStack.push({ level: lvl, tag, numId });
            }
            return;
          }
          closeLists(-1);
          if (kid(pp, 'pageBreakBefore')) out.push('<hr class="pagebreak">');
          const empty = inner === '<br>';
          if (brk && empty) { out.push('<hr class="pagebreak">'); return; }
          if (hd) out.push(`<h${hd}${st2}>${inner}</h${hd}>`);
          else out.push(`<p${st2}>${inner}</p>`);
          if (brk) out.push('<hr class="pagebreak">');
        } else if (n.localName === 'tbl') {
          closeLists(-1);
          let t = '<table><tbody>';
          kids(n, 'tr').forEach((tr) => {
            t += '<tr>';
            kids(tr, 'tc').forEach((tc) => {
              const span = attr(kid(kid(tc, 'tcPr'), 'gridSpan'), 'val');
              const sub = [];
              const save = out.length;
              block(tc);
              closeLists(-1);
              sub.push(...out.splice(save));
              t += `<td${span ? ` colspan="${span}"` : ''}>${sub.join('') || '<p><br></p>'}</td>`;
            });
            t += '</tr>';
          });
          out.push(t + '</tbody></table>');
        } else if (n.localName === 'sdt') {
          block(kid(n, 'sdtContent'));
        } else if (n.localName === 'customXml') block(n);
      });
    }
    block(kid(doc.documentElement, 'body'));
    closeLists(-1);
    if (files['word/header1.xml'] || files['word/footer1.xml']) notes.add('Az élőfej és élőláb nem szerkeszthető itt, mentéskor kimarad.');
    return { html: out.join('') || '<p><br></p>', notes: [...notes] };
  }
  D.docxToHtml = docxToHtml;

  // ───────────── HTML → DOCX ─────────────
  function htmlToDocx(root) {
    const rels = [];
    const media = {};
    let rid = 10, imgN = 0, numN = 2;
    const nums = []; // további (újrakezdett) számozott listák
    const relId = (type, target, ext) => { const id = 'rId' + (rid++); rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${xe(target)}"${ext ? ' TargetMode="External"' : ''}/>`); return id; };

    const cssOf = (el) => (el.getAttribute && el.getAttribute('style')) || '';
    const cssVal = (style, prop) => { const m = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)', 'i').exec(style); return m ? m[1].trim() : null; };
    const hex = (c) => {
      if (!c) return null;
      c = c.trim();
      if (/^#[0-9a-f]{6}$/i.test(c)) return c.slice(1).toUpperCase();
      if (/^#[0-9a-f]{3}$/i.test(c)) return c.slice(1).split('').map((x) => x + x).join('').toUpperCase();
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(c);
      if (m) { if (m[4] !== undefined && +m[4] === 0) return null; return [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('').toUpperCase(); }
      const named = { red: 'FF0000', blue: '0000FF', green: '008000', black: '000000', white: 'FFFFFF', yellow: 'FFFF00', orange: 'FFA500', gray: '808080', grey: '808080', purple: '800080' };
      return named[c.toLowerCase()] || null;
    };
    const ptOf = (v) => {
      if (!v) return null;
      const m = /([\d.]+)\s*(pt|px|em|rem)?/.exec(v);
      if (!m) { const kw = { 'xx-small': 7, 'x-small': 7.5, small: 10, medium: 12, large: 13.5, 'x-large': 18, 'xx-large': 24, 'xxx-large': 36 }; return kw[v] || null; }
      const n = +m[1];
      return m[2] === 'px' ? n * 0.75 : m[2] === 'em' || m[2] === 'rem' ? n * 11 : n;
    };

    /** Futamok (szövegdarabok egyforma formázással) egy blokkon belül. */
    function runs(node, fmt, out) {
      node.childNodes.forEach((n) => {
        if (n.nodeType === 3) { if (n.textContent) out.push({ t: n.textContent, f: fmt }); return; }
        if (n.nodeType !== 1) return;
        const tag = n.tagName.toLowerCase();
        if (tag === 'br') { out.push({ br: true, f: fmt }); return; }
        if (tag === 'img') { out.push({ img: n, f: fmt }); return; }
        if (['ul', 'ol', 'table', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'blockquote', 'hr'].includes(tag)) return; // blokkszint: külön kezeljük
        const f = Object.assign({}, fmt);
        const style = cssOf(n);
        if (tag === 'b' || tag === 'strong' || /bold|[6-9]00/.test(cssVal(style, 'font-weight') || '')) f.b = true;
        if (tag === 'i' || tag === 'em' || /italic/.test(cssVal(style, 'font-style') || '')) f.i = true;
        if (tag === 'u' || /underline/.test(cssVal(style, 'text-decoration') || cssVal(style, 'text-decoration-line') || '')) f.u = true;
        if (tag === 's' || tag === 'strike' || tag === 'del' || /line-through/.test(cssVal(style, 'text-decoration') || cssVal(style, 'text-decoration-line') || '')) f.s = true;
        if (tag === 'sup') f.va = 'superscript';
        if (tag === 'sub') f.va = 'subscript';
        if (tag === 'code' || tag === 'kbd') f.font = 'Consolas';
        if (tag === 'font') { if (n.getAttribute('color')) f.color = hex(n.getAttribute('color')); if (n.getAttribute('face')) f.font = n.getAttribute('face').split(',')[0].replace(/['"]/g, '').trim(); }
        if (tag === 'a' && n.getAttribute('href')) f.href = n.getAttribute('href');
        const col = hex(cssVal(style, 'color')); if (col) f.color = col;
        const bg = hex(cssVal(style, 'background-color') || cssVal(style, 'background')); if (bg) f.bg = bg;
        const sz = ptOf(cssVal(style, 'font-size')); if (sz) f.sz = sz;
        const ff = cssVal(style, 'font-family'); if (ff) f.font = ff.split(',')[0].replace(/['"]/g, '').trim();
        runs(n, f, out);
      });
      return out;
    }

    function rPr(f) {
      let x = '';
      if (f.href) x += '<w:rStyle w:val="Hyperlink"/>';
      if (f.font) x += `<w:rFonts w:ascii="${xe(f.font)}" w:hAnsi="${xe(f.font)}" w:cs="${xe(f.font)}"/>`;
      if (f.b) x += '<w:b/>';
      if (f.i) x += '<w:i/>';
      if (f.s) x += '<w:strike/>';
      if (f.color) x += `<w:color w:val="${f.color}"/>`;
      if (f.sz) x += `<w:sz w:val="${Math.round(f.sz * 2)}"/><w:szCs w:val="${Math.round(f.sz * 2)}"/>`;
      if (f.u) x += '<w:u w:val="single"/>';
      if (f.bg) x += `<w:shd w:val="clear" w:color="auto" w:fill="${f.bg}"/>`;
      if (f.va) x += `<w:vertAlign w:val="${f.va}"/>`;
      return x ? `<w:rPr>${x}</w:rPr>` : '';
    }

    function runXml(r) {
      if (r.br) return `<w:r>${rPr(r.f)}<w:br/></w:r>`;
      if (r.img) {
        const src = r.img.getAttribute('src') || '';
        const m = /^data:image\/(png|jpe?g|gif|bmp|webp);base64,(.+)$/i.exec(src);
        if (!m) return '';
        const ext = m[1].toLowerCase().replace('jpeg', 'jpg');
        imgN++;
        const name = `media/kep${imgN}.${ext}`;
        media['word/' + name] = unb64(m[2]);
        const id = relId('image', name);
        let w = +r.img.getAttribute('width') || r.img.naturalWidth || r.img.width || 300;
        let hh = +r.img.getAttribute('height') || r.img.naturalHeight || r.img.height || 200;
        if (w > 624) { hh = Math.round(hh * 624 / w); w = 624; }
        const cx = Math.round(w * 9525), cy = Math.round(hh * 9525);
        return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${imgN}" name="Kép ${imgN}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${imgN}" name="kep${imgN}.${ext}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
      }
      return r.t.split('\t').map((part, i) => (i ? `<w:r>${rPr(r.f)}<w:tab/></w:r>` : '') + (part ? `<w:r>${rPr(r.f)}<w:t xml:space="preserve">${xe(part.replace(/ /g, ' ').replace(/\n/g, ' '))}</w:t></w:r>` : '')).join('');
    }

    function inlineXml(list) {
      let x = '', i = 0;
      while (i < list.length) {
        const href = list[i].f.href;
        if (href) {
          const grp = [];
          while (i < list.length && list[i].f.href === href) grp.push(list[i++]);
          const ext = /^(https?:|mailto:)/i.test(href);
          if (ext) x += `<w:hyperlink r:id="${relId('hyperlink', href, true)}">${grp.map(runXml).join('')}</w:hyperlink>`;
          else x += grp.map(runXml).join('');
        } else x += runXml(list[i++]);
      }
      return x;
    }

    function pXml(el, opts = {}) {
      const style = cssOf(el);
      const al = cssVal(style, 'text-align') || (el.getAttribute && el.getAttribute('align'));
      const jc = al === 'center' ? 'center' : al === 'right' ? 'right' : al === 'justify' ? 'both' : '';
      let ppr = '';
      if (opts.style) ppr += `<w:pStyle w:val="${opts.style}"/>`;
      if (opts.num) ppr += `<w:numPr><w:ilvl w:val="${opts.num.lvl}"/><w:numId w:val="${opts.num.id}"/></w:numPr>`;
      if (opts.indent) ppr += `<w:ind w:left="${opts.indent}"/>`;
      if (jc) ppr += `<w:jc w:val="${jc}"/>`;
      const content = inlineXml(runs(el, {}, []));
      return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${content}</w:p>`;
    }

    function listXml(list, lvl, parentNum) {
      const ordered = list.tagName.toLowerCase() === 'ol';
      let id;
      if (!ordered) id = 1;
      else if (parentNum && parentNum.ordered) id = parentNum.id;
      else { id = ++numN; nums.push(id); }
      let x = '';
      kids(list, 'li').forEach((li) => {
        x += pXml(li, { style: 'ListParagraph', num: { lvl: Math.min(lvl, 8), id } });
        Array.from(li.children).forEach((c) => {
          const t = c.tagName.toLowerCase();
          if (t === 'ul' || t === 'ol') x += listXml(c, lvl + 1, { id, ordered });
          else if (['p', 'div'].includes(t)) x += pXml(c, { indent: 720 * (lvl + 1) });
        });
      });
      return x;
    }

    function tableXml(tbl) {
      const rows = Array.from(tbl.querySelectorAll(':scope > tbody > tr, :scope > thead > tr, :scope > tr'));
      const cols = Math.max(1, ...rows.map((r) => Array.from(r.children).reduce((s, c) => s + (+c.getAttribute('colspan') || 1), 0)));
      const colW = Math.floor(9070 / cols);
      let x = `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/>`).join('')}</w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${'<w:gridCol w:w="' + colW + '"/>'.repeat(cols)}</w:tblGrid>`;
      rows.forEach((tr) => {
        x += '<w:tr>';
        Array.from(tr.children).forEach((td) => {
          const span = +td.getAttribute('colspan') || 1;
          const head = td.tagName.toLowerCase() === 'th';
          let inner = blocksXml(td, head);
          if (!/<w:p[ >]/.test(inner)) inner += '<w:p/>';
          x += `<w:tc><w:tcPr><w:tcW w:w="${colW * span}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}</w:tcPr>${inner}</w:tc>`;
        });
        x += '</w:tr>';
      });
      return x + '</w:tbl>';
    }

    function blocksXml(container, boldAll) {
      let x = '';
      let loose = [];
      const flush = () => {
        if (!loose.length) return;
        const tmp = document.createElement('p');
        loose.forEach((n) => tmp.append(n.cloneNode(true)));
        if (boldAll) { const b = document.createElement('b'); while (tmp.firstChild) b.append(tmp.firstChild); tmp.append(b); }
        if (tmp.textContent.trim() || tmp.querySelector('img')) x += pXml(tmp);
        loose = [];
      };
      Array.from(container.childNodes).forEach((n) => {
        if (n.nodeType === 3) { if (n.textContent.trim()) loose.push(n); return; }
        if (n.nodeType !== 1) return;
        const t = n.tagName.toLowerCase();
        if (/^h[1-6]$/.test(t)) { flush(); x += pXml(n, { style: 'Heading' + Math.min(3, +t[1]) }); }
        else if (t === 'p' || t === 'div' || t === 'blockquote' || t === 'pre') {
          flush();
          if (n.querySelector(':scope > p, :scope > h1, :scope > h2, :scope > h3, :scope > ul, :scope > ol, :scope > table, :scope > div, :scope > hr')) x += blocksXml(n, boldAll);
          else if (boldAll) { const c = n.cloneNode(true); const b = document.createElement('b'); while (c.firstChild) b.append(c.firstChild); c.append(b); x += pXml(c); }
          else x += pXml(n, t === 'blockquote' ? { indent: 720 } : {});
        } else if (t === 'ul' || t === 'ol') { flush(); x += listXml(n, 0, null); }
        else if (t === 'table') { flush(); x += tableXml(n); }
        else if (t === 'hr') { flush(); x += n.classList.contains('pagebreak') ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="A6A6A6"/></w:pBdr></w:pPr></w:p>'; }
        else loose.push(n);
      });
      flush();
      return x;
    }

    const body = blocksXml(root, false) || '<w:p/>';
    const document_ = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`;

    const lvls = (fmt) => Array.from({ length: 9 }, (_, i) => {
      const bullet = ['•', '◦', '▪'][i % 3];
      return fmt === 'bullet'
        ? `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${bullet}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr></w:lvl>`
        : `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${['decimal', 'lowerLetter', 'lowerRoman'][i % 3]}"/><w:lvlText w:val="%${i + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`;
    }).join('');
    const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${lvls('bullet')}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lvls('decimal')}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>${nums.map((id) => `<w:num w:numId="${id}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join('')}</w:numbering>`;

    const hd = (n, sz, color) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${n === 1 ? 360 : 240}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:color w:val="${color}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr></w:style>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="hu-HU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${hd(1, 32, '1F3864')}${hd(2, 26, '2F5496')}${hd(3, 24, '2F5496')}<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style><w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style></w:styles>`;

    const imgTypes = [...new Set(Object.keys(media).map((k) => k.split('.').pop()))];
    const ctypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imgTypes.map((e) => `<Default Extension="${e}" ContentType="image/${e === 'jpg' ? 'jpeg' : e}"/>`).join('')}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    return Object.assign({
      '[Content_Types].xml': ctypes,
      '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>',
      'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
      'docProps/app.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>FACET</Application></Properties>',
      'word/document.xml': document_,
      'word/styles.xml': styles,
      'word/numbering.xml': numbering,
      'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${rels.join('')}</Relationships>`
    }, media);
  }
  D.htmlToDocx = htmlToDocx;

  // ───────────── beillesztés tisztítása ─────────────
  const ALLOWED = new Set(['p', 'h1', 'h2', 'h3', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sup', 'sub', 'a', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'br', 'img', 'span', 'font', 'code', 'blockquote', 'hr']);
  function sanitize(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const walk = (node) => {
      Array.from(node.childNodes).forEach((n) => {
        if (n.nodeType === 8) { n.remove(); return; }
        if (n.nodeType !== 1) return;
        let t = n.tagName.toLowerCase();
        if (['script', 'style', 'meta', 'link', 'title', 'xml', 'iframe', 'object', 'svg'].includes(t)) { n.remove(); return; }
        walk(n);
        if (/^h[4-6]$/.test(t)) { const r = doc.createElement('h3'); while (n.firstChild) r.append(n.firstChild); n.replaceWith(r); n = r; t = 'h3'; }
        if (t === 'div' || t === 'section' || t === 'article') { const r = doc.createElement('p'); while (n.firstChild) r.append(n.firstChild); n.replaceWith(r); n = r; t = 'p'; }
        if (!ALLOWED.has(t)) { n.replaceWith(...n.childNodes); return; }
        const keepStyle = (n.getAttribute('style') || '').split(';').map((x) => x.trim()).filter((x) => /^(color|background-color|font-size|font-weight|font-style|text-decoration|text-align)\s*:/i.test(x)).join(';');
        const href = n.getAttribute('href'), src = n.getAttribute('src'), colspan = n.getAttribute('colspan');
        Array.from(n.attributes).forEach((a) => n.removeAttribute(a.name));
        if (keepStyle) n.setAttribute('style', keepStyle);
        if (t === 'a' && href && /^(https?:|mailto:|#)/i.test(href)) n.setAttribute('href', href);
        if (t === 'img') { if (src && /^data:image\//.test(src)) n.setAttribute('src', src); else n.remove(); }
        if (colspan) n.setAttribute('colspan', colspan);
      });
    };
    walk(doc.body);
    return doc.body.innerHTML;
  }

  // ───────────── a szerkesztő ─────────────
  const prefs = Object.assign({ zoom: 100, txtFont: 'Calibri', txtSize: 12 }, F.store.get('docPrefs', {}));
  const savePrefs = () => F.store.set('docPrefs', prefs);

  async function create(path) {
    const ext = F.ext(path);
    if (ext === 'txt') return textEditor(path);
    if (ext === 'docx') return richEditor(path);
    return foreignEditor(path, ext);
  }

  function base(path, kind) {
    const ed = { path, kind, ver: 0, listeners: [], autosaveDelay: kind === 'docx' ? 2500 : 1200 };
    ed.version = () => ed.ver;
    ed.onChange = (cb) => ed.listeners.push(cb);
    ed.bump = () => { ed.ver++; ed.listeners.forEach((cb) => cb()); };
    return ed;
  }

  function stage(ed, paper, opts) {
    const wrap = h('div', { class: 'docv' + (opts && opts.plain ? ' plain' : '') });
    const find = h('div', { class: 'doc-find', hidden: true });
    const scroller = h('div', { class: 'doc-scroll' }, h('div', { class: 'doc-zoom' }, paper));
    wrap.append(find, scroller);
    ed.el = wrap;
    ed.paper = paper;
    ed.scroller = scroller;
    ed.findBar = find;
    applyZoom(ed);
    return wrap;
  }
  /** Nagyítás: a beállított érték, de keskeny ablakban a lap a szélességhez igazodik. */
  function applyZoom(ed) {
    const z = ed.el && ed.el.querySelector('.doc-zoom');
    if (!z) return;
    const avail = ed.scroller ? ed.scroller.clientWidth - 32 : 0;
    const fit = avail > 200 ? avail / 794 : 1;
    z.style.zoom = Math.min(prefs.zoom / 100, fit);
  }
  const refit = F.debounce(() => F.state.docs.forEach((d) => { if (d.custom && d.custom.el) applyZoom(d.custom); }), 80);
  F.on('resize', refit);
  F.on('open', () => setTimeout(refit, 0));
  window.addEventListener('resize', refit);

  function counts(text) {
    const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
    return { words, chars: text.replace(/\s/g, '').length, charsAll: text.length };
  }

  // .txt
  async function textEditor(path) {
    const ed = base(path, 'txt');
    ed.history = true;
    let text = '';
    try { text = await F.fs.read(path); } catch (e) { text = ''; }
    const ta = h('textarea', { class: 'doc-page doc-txt', spellcheck: 'true', 'aria-label': 'Dokumentum szövege', lang: 'hu' });
    ta.value = text;
    const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.max(1000, ta.scrollHeight) + 'px'; };
    const applyFont = () => { ta.style.fontFamily = `'${prefs.txtFont}', Carlito, Arial, sans-serif`; ta.style.fontSize = prefs.txtSize + 'pt'; fit(); };
    ta.addEventListener('input', () => { fit(); ed.bump(); });
    stage(ed, ta, { plain: true });
    ed.text = () => ta.value;
    ed.setText = (t) => { ta.value = t; fit(); ed.bump(); };
    ed.save = () => F.fs.write(path, ta.value);
    ed.focus = () => { ta.focus({ preventScroll: true }); requestAnimationFrame(fit); };
    ed.dispose = () => {};
    ed.applyFont = applyFont;
    ed.status = () => { const c = counts(ta.value); return `${c.words} szó · ${c.charsAll} karakter`; };
    ed.outline = () => [];
    ed.findIn = (q, back) => findText(ta, q, back);
    ed.replaceSel = (q, r) => {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (sel.toLowerCase() === q.toLowerCase()) { ta.setRangeText(r, ta.selectionStart, ta.selectionEnd, 'end'); ed.bump(); }
      return findText(ta, q, false);
    };
    applyFont();
    setTimeout(fit, 0);
    return ed;
  }
  function findText(ta, q, back) {
    if (!q) return false;
    const v = ta.value.toLowerCase(), n = q.toLowerCase();
    let i = back ? v.lastIndexOf(n, Math.max(0, ta.selectionStart - 1)) : v.indexOf(n, ta.selectionEnd);
    if (i < 0) i = back ? v.lastIndexOf(n) : v.indexOf(n);
    if (i < 0) return false;
    ta.focus();
    ta.setSelectionRange(i, i + q.length);
    const lineH = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    const line = ta.value.slice(0, i).split('\n').length;
    const sc = ta.closest('.doc-scroll');
    if (sc) sc.scrollTop = Math.max(0, line * lineH - sc.clientHeight / 2);
    return true;
  }

  // .docx
  async function richEditor(path) {
    const ed = base(path, 'docx');
    let html = '<p><br></p>', notes = [], fresh = false;
    try {
      const r = await F.api('GET', 'zip/read', { path });
      if (r.status === 200) {
        const files = unpack(await r.arrayBuffer());
        if (files['word/document.xml']) ({ html, notes } = docxToHtml(files));
        else fresh = true;
      } else if (r.status === 415) {
        throw new Error('Ez a fájl nem érvényes .docx (lehet, hogy régi .doc formátum átnevezve). Nyisd meg Wordben, és mentsd .docx-ként.');
      } else fresh = true;
    } catch (e) {
      if (/docx/.test(e.message)) throw e;
      if (F.fs.mode !== 'local') throw new Error('A .docx szerkesztéséhez a helyi FACET motor kell.');
      fresh = true;
    }
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* régi motor */ }
    const page = h('div', { class: 'doc-page doc-rich', contenteditable: 'true', spellcheck: 'true', lang: 'hu', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Dokumentum' });
    page.innerHTML = html;
    stage(ed, page);
    if (notes.length || !fresh) {
      const bar = h('div', { class: 'doc-note' }, h('span', { html: '<b>Egyszerűsített nézet.</b> ' + (notes.length ? esc(notes.join(' ')) + ' ' : '') + 'A szöveg, a formázás, a listák, a táblázatok és a képek megmaradnak. Az eredeti fájlról az első mentés előtt biztonsági másolat készül.' }),
        h('button', { class: 'icon-btn', 'aria-label': 'Bezárás', onclick: () => bar.remove(), html: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2 L8 8 M8 2 L2 8" stroke="currentColor" stroke-width="1.4"/></svg>' }));
      if (notes.length || !F.store.get('docNoteSeen', false)) ed.el.prepend(bar);
      F.store.set('docNoteSeen', true);
    }
    let range = null;
    const inPage = (n) => n && (n === page || page.contains(n));
    const track = () => { const s = getSelection(); if (s.rangeCount && inPage(s.anchorNode)) range = s.getRangeAt(0).cloneRange(); F.emit('docSelection', ed); };
    document.addEventListener('selectionchange', track);
    const mo = new MutationObserver(() => ed.bump());
    mo.observe(page, { subtree: true, childList: true, characterData: true, attributes: true });
    page.addEventListener('paste', (e) => {
      const cd = e.clipboardData;
      if (!cd) return;
      const file = Array.from(cd.files || []).find((f) => f.type.startsWith('image/'));
      if (file) { e.preventDefault(); insertImageFile(ed, file); return; }
      const htmlData = cd.getData('text/html');
      e.preventDefault();
      if (htmlData) document.execCommand('insertHTML', false, sanitize(htmlData));
      else document.execCommand('insertText', false, cd.getData('text/plain'));
    });
    page.addEventListener('drop', (e) => {
      const file = Array.from(e.dataTransfer.files || []).find((f) => f.type.startsWith('image/'));
      if (file) { e.preventDefault(); insertImageFile(ed, file); }
    });
    page.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') { e.preventDefault(); const li = getSelection().anchorNode && getSelection().anchorNode.parentElement && getSelection().anchorNode.parentElement.closest('li'); if (li) ed.exec(e.shiftKey ? 'outdent' : 'indent'); else document.execCommand('insertText', false, '\t'); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind(ed); }
    });
    page.addEventListener('click', (e) => { const a = e.target.closest('a'); if (a && (e.metaKey || e.ctrlKey)) { e.preventDefault(); F.openUrl(a.href); } });

    ed.restore = () => {
      const s = getSelection();
      // Ha a kijelölés még a dokumentumban van, az a friss — csak akkor állítjuk vissza, ha elkerült (pl. eszköztár).
      if (s.rangeCount && inPage(s.anchorNode) && document.activeElement === page) return;
      page.focus({ preventScroll: true });
      if (range) { s.removeAllRanges(); s.addRange(range); }
    };
    ed.exec = (cmd, val) => {
      ed.restore();
      document.execCommand('styleWithCSS', false, cmd === 'foreColor' || cmd === 'hiliteColor' || cmd === 'backColor');
      document.execCommand(cmd, false, val == null ? null : val);
      normalize(page);
      track();
    };
    ed.setFont = (face) => { ed.restore(); document.execCommand('styleWithCSS', false, false); document.execCommand('fontName', false, face); normalize(page); track(); };
    ed.setSize = (pt) => {
      ed.restore();
      document.execCommand('styleWithCSS', false, false);
      document.execCommand('fontSize', false, '7');
      page.querySelectorAll('font[size="7"]').forEach((f) => { f.removeAttribute('size'); f.style.fontSize = pt + 'pt'; });
      page.querySelectorAll('span').forEach((s) => { if (s.style.fontSize === 'xxx-large' || s.style.fontSize === '-webkit-xxx-large') s.style.fontSize = pt + 'pt'; });
      normalize(page);
      track();
    };
    ed.block = (tag) => { ed.exec('formatBlock', tag === 'p' ? 'P' : tag.toUpperCase()); };
    ed.insertHtml = (x) => { ed.restore(); document.execCommand('insertHTML', false, x); normalize(page); };
    ed.state = () => {
      const s = getSelection();
      const node = s.anchorNode && inPage(s.anchorNode) ? (s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode) : null;
      const q = (c) => { try { return document.queryCommandState(c); } catch (e) { return false; } };
      const cs = node ? getComputedStyle(node) : null;
      const blk = node && node.closest('h1, h2, h3, p, li, td');
      return {
        b: q('bold'), i: q('italic'), u: q('underline'), s: q('strikeThrough'),
        ul: q('insertUnorderedList'), ol: q('insertOrderedList'),
        block: blk ? blk.tagName.toLowerCase() : 'p',
        align: cs ? cs.textAlign : 'left',
        font: cs ? cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim() : 'Calibri',
        size: cs ? Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2 : 11
      };
    };
    ed.text = () => page.innerText;
    ed.save = async () => {
      if (F.fs.mode !== 'local') throw new Error('A .docx mentéséhez a helyi FACET motor kell.');
      const files = htmlToDocx(page);
      const r = await F.api('POST', 'zip/write', { path }, pack(files));
      if (!r.ok) { let m = 'Mentés nem sikerült'; try { m = (await r.json()).error || m; } catch (e) { /* üres */ } throw new Error(m); }
    };
    ed.focus = () => page.focus({ preventScroll: true });
    ed.dispose = () => { document.removeEventListener('selectionchange', track); mo.disconnect(); };
    ed.status = () => { const c = counts(page.innerText); return `${c.words} szó · ${c.charsAll} karakter · kb. ${Math.max(1, Math.ceil(page.scrollHeight / 1123))} oldal`; };
    ed.outline = () => Array.from(page.querySelectorAll('h1, h2, h3')).map((el) => ({ k: el.tagName, c: '#E6D3B3', t: el.textContent.trim().slice(0, 60) || '(üres cím)', depth: +el.tagName[1] - 1, run: () => { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); const r2 = document.createRange(); r2.selectNodeContents(el); r2.collapse(true); page.focus(); getSelection().removeAllRanges(); getSelection().addRange(r2); } }));
    ed.findIn = (q, back) => {
      if (!q) return false;
      page.focus();
      // eslint-disable-next-line no-restricted-globals
      const ok = window.find && window.find(q, false, !!back, true, false, false, false);
      return !!ok;
    };
    ed.replaceSel = (q, r) => {
      const s = getSelection();
      if (s.rangeCount && inPage(s.anchorNode) && s.toString().toLowerCase() === q.toLowerCase()) document.execCommand('insertText', false, r);
      return ed.findIn(q, false);
    };
    ed.insertImage = () => {
      const inp = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', style: { display: 'none' } });
      inp.onchange = () => { if (inp.files[0]) insertImageFile(ed, inp.files[0]); inp.remove(); };
      document.body.append(inp);
      inp.click();
    };
    if (fresh) setTimeout(() => { page.focus(); }, 30);
    return ed;
  }

  function insertImageFile(ed, file) {
    if (file.size > 15 * 1024 * 1024) { F.toast('A kép túl nagy (15 MB fölött).', 'warn'); return; }
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth, hh = img.naturalHeight;
        if (w > 600) { hh = Math.round(hh * 600 / w); w = 600; }
        ed.insertHtml(`<img src="${fr.result}" width="${w}" height="${hh}" alt="">`);
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  /** <font> címkék átalakítása span-ekké, üres formázások takarítása. */
  function normalize(page) {
    page.querySelectorAll('font').forEach((f) => {
      const s = document.createElement('span');
      if (f.getAttribute('face')) s.style.fontFamily = f.getAttribute('face');
      if (f.getAttribute('color')) s.style.color = f.getAttribute('color');
      if (f.style.fontSize) s.style.fontSize = f.style.fontSize;
      while (f.firstChild) s.append(f.firstChild);
      f.replaceWith(s);
    });
  }

  // nem támogatott formátumok
  function foreignEditor(path, ext) {
    const ed = base(path, ext);
    const box = h('div', { class: 'doc-foreign' },
      h('div', { class: 'doc-foreign-ic', text: ext.toUpperCase() }),
      h('h2', { text: path.split('/').pop() }),
      h('p', { text: ext === 'doc' ? 'Ez a régi Word-formátum (.doc), amit a FACET nem tud szerkeszteni. Nyisd meg Wordben vagy Pagesben, és mentsd el .docx-ként. Utána itt is szerkesztheted.'
        : `A(z) .${ext} formátumot a FACET nem tudja szerkeszteni. Mentsd el .docx-ként, vagy nyisd meg a hozzá tartozó programmal.` }),
      F.fs.mode === 'local' ? h('div', { class: 'wl-actions' },
        h('button', { class: 'btn accent', onclick: () => F.api('POST', 'openext', { path }) }, 'Megnyitás az alapértelmezett programmal'),
        h('button', { class: 'btn', onclick: () => F.api('POST', 'reveal', { path }) }, F.isMac ? 'Mutasd a Finderben' : 'Mutasd a mappában')) : null);
    ed.el = h('div', { class: 'docv' }, box);
    ed.text = () => '';
    ed.save = async () => {};
    ed.focus = () => {};
    ed.dispose = () => {};
    ed.status = () => '';
    ed.outline = () => [];
    ed.readonly = true;
    return ed;
  }

  // ───────────── keresés ─────────────
  function openFind(ed) {
    const bar = ed.findBar;
    if (!bar) return;
    bar.innerHTML = '';
    const q = h('input', { class: 'field', placeholder: 'Keresés a dokumentumban', 'aria-label': 'Keresett szöveg', value: D.lastFind || '' });
    const r = h('input', { class: 'field', placeholder: 'Csere erre', 'aria-label': 'Csere erre' });
    const info = h('span', { class: 'set-note' });
    const go = (back) => { D.lastFind = q.value; const ok = ed.findIn(q.value, back); info.textContent = ok ? '' : 'Nincs találat'; };
    q.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey); } if (e.key === 'Escape') bar.hidden = true; };
    r.onkeydown = (e) => { if (e.key === 'Escape') bar.hidden = true; };
    bar.append(q, h('button', { class: 'icon-btn', title: 'Előző', onclick: () => go(true), text: '↑' }), h('button', { class: 'icon-btn', title: 'Következő (Enter)', onclick: () => go(false), text: '↓' }),
      r, h('button', { class: 'btn', onclick: () => { const ok = ed.replaceSel(q.value, r.value); info.textContent = ok ? '' : 'Nincs több találat'; } }, 'Csere'), info,
      h('button', { class: 'icon-btn', title: 'Bezárás (Esc)', onclick: () => { bar.hidden = true; }, html: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2 L8 8 M8 2 L2 8" stroke="currentColor" stroke-width="1.4"/></svg>' }));
    bar.hidden = false;
    q.focus();
    q.select();
  }
  D.openFind = openFind;

  // ───────────── eszköztár (szalag) ─────────────
  const ICON = {
    ul: '<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="3" cy="4" r="1.2" fill="currentColor"/><circle cx="3" cy="8" r="1.2" fill="currentColor"/><circle cx="3" cy="12" r="1.2" fill="currentColor"/><path d="M6 4 H14 M6 8 H14 M6 12 H14" stroke="currentColor" stroke-width="1.4"/></svg>',
    ol: '<svg width="16" height="16" viewBox="0 0 16 16"><text x="0.5" y="6" font-size="5.5" fill="currentColor" font-family="sans-serif">1</text><text x="0.5" y="13" font-size="5.5" fill="currentColor" font-family="sans-serif">2</text><path d="M6 4 H14 M6 11 H14" stroke="currentColor" stroke-width="1.4"/></svg>',
    left: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 3 H14 M2 6.5 H10 M2 10 H14 M2 13.5 H9" stroke="currentColor" stroke-width="1.4"/></svg>',
    center: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 3 H14 M4 6.5 H12 M2 10 H14 M4.5 13.5 H11.5" stroke="currentColor" stroke-width="1.4"/></svg>',
    right: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 3 H14 M6 6.5 H14 M2 10 H14 M7 13.5 H14" stroke="currentColor" stroke-width="1.4"/></svg>',
    justify: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 3 H14 M2 6.5 H14 M2 10 H14 M2 13.5 H14" stroke="currentColor" stroke-width="1.4"/></svg>',
    indent: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M7 4 H14 M7 8 H14 M7 12 H14 M2 5.5 L4.5 8 L2 10.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
    outdent: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M7 4 H14 M7 8 H14 M7 12 H14 M4.5 5.5 L2 8 L4.5 10.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
    link: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M7 9 A2.5 2.5 0 0 0 10.5 9 L12.5 7 A2.5 2.5 0 0 0 9 3.5 L8 4.5 M9 7 A2.5 2.5 0 0 0 5.5 7 L3.5 9 A2.5 2.5 0 0 0 7 12.5 L8 11.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
    img: '<svg width="16" height="16" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="6" cy="6.5" r="1.2" fill="currentColor"/><path d="M2.5 12 L6.5 8.5 L9 10.5 L11 9 L13.5 11.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
    table: '<svg width="16" height="16" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2 6.5 H14 M2 10 H14 M6 3 V13 M10 3 V13" stroke="currentColor" stroke-width="1.1"/></svg>',
    page: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 2 V6 H13 V2 M3 14 V10 H13 V14" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M1.5 8 H14.5" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 1.5"/></svg>',
    clear: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M4 3 H12 M8 3 L6 13 M3 13 L13 3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
    find: '<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 10.5 L14 14" stroke="currentColor" stroke-width="1.4"/></svg>',
    undo: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M4 6 H10 A3 3 0 0 1 10 12 H6 M6.5 3.5 L4 6 L6.5 8.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
    redo: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M12 6 H6 A3 3 0 0 0 6 12 H10 M9.5 3.5 L12 6 L9.5 8.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>'
  };
  const cur = () => { const a = F.active(); return a && a.custom && a.custom.paper ? a.custom : null; };
  const rbtn = (html, title, run, cls) => {
    const b = h('button', { class: 'rb' + (cls ? ' ' + cls : ''), title, 'aria-label': title, html });
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => { const ed = cur(); if (ed) run(ed); });
    return b;
  };
  const sep = () => h('span', { class: 'rsep' });

  function ribbon() {
    const ed = cur();
    const bar = h('div', { class: 'ribbon' });
    if (!ed) return bar;
    if (ed.kind === 'txt') {
      const fsel = h('select', { class: 'rsel', title: 'Betűtípus (csak a megjelenítéshez)', 'aria-label': 'Betűtípus' }, FONTS.map((f) => h('option', { value: f, selected: f === prefs.txtFont }, f)));
      fsel.onchange = () => { prefs.txtFont = fsel.value; savePrefs(); const e2 = cur(); if (e2 && e2.applyFont) e2.applyFont(); };
      const ssel = h('select', { class: 'rsel small', title: 'Betűméret (csak a megjelenítéshez)', 'aria-label': 'Betűméret' }, SIZES.map((s) => h('option', { value: s, selected: s === prefs.txtSize }, s + ' pt')));
      ssel.onchange = () => { prefs.txtSize = +ssel.value; savePrefs(); const e2 = cur(); if (e2 && e2.applyFont) e2.applyFont(); };
      bar.append(h('span', { class: 'tb-label', text: 'Szöveg' }), fsel, ssel, sep(), rbtn(ICON.find, 'Keresés és csere (⌘F)', openFind), sep(),
        h('button', { class: 'chip primary', onclick: () => convertToDocx(ed) }, 'Formázáshoz: átalakítás .docx-be'),
        h('span', { class: 'set-note', style: { marginLeft: '6px' }, text: 'A .txt csak sima szöveget tárol.' }));
      return bar;
    }
    if (ed.readonly) return bar;
    const st = ed.state ? ed.state() : {};
    const blk = h('select', { class: 'rsel', title: 'Bekezdésstílus', 'aria-label': 'Bekezdésstílus' },
      [['p', 'Normál szöveg'], ['h1', 'Cím 1'], ['h2', 'Cím 2'], ['h3', 'Cím 3']].map(([v, l]) => h('option', { value: v, selected: st.block === v }, l)));
    blk.onchange = () => { const e2 = cur(); if (e2) e2.block(blk.value); };
    const font = h('select', { class: 'rsel', title: 'Betűtípus', 'aria-label': 'Betűtípus' }, FONTS.map((f) => h('option', { value: f, selected: f === st.font }, f)));
    if (st.font && !FONTS.includes(st.font)) font.prepend(h('option', { value: st.font, selected: true }, st.font));
    font.onchange = () => { const e2 = cur(); if (e2) e2.setFont(font.value); };
    const size = h('select', { class: 'rsel small', title: 'Betűméret', 'aria-label': 'Betűméret' }, SIZES.map((s) => h('option', { value: s, selected: s === st.size }, String(s))));
    if (st.size && !SIZES.includes(st.size)) size.prepend(h('option', { value: st.size, selected: true }, String(st.size)));
    size.onchange = () => { const e2 = cur(); if (e2) e2.setSize(+size.value); };
    const color = (cmd, title, def, glyph) => {
      const inp = h('input', { type: 'color', value: F.store.get('docColor:' + cmd, def), 'aria-label': title });
      const swatch = h('span', { class: 'rcol-bar', style: { background: inp.value } });
      const apply = h('button', { class: 'rb rcol', title, html: glyph });
      apply.append(swatch);
      apply.addEventListener('mousedown', (e) => e.preventDefault());
      apply.onclick = () => { const e2 = cur(); if (e2) e2.exec(cmd, inp.value); };
      inp.oninput = () => { swatch.style.background = inp.value; };
      inp.onchange = () => { F.store.set('docColor:' + cmd, inp.value); const e2 = cur(); if (e2) e2.exec(cmd, inp.value); };
      return h('span', { class: 'rcolor' }, apply, h('label', { class: 'rcol-pick', title: 'Szín választása' }, inp, h('span', { html: '<svg width="8" height="8" viewBox="0 0 10 10"><path d="M2 3.5 L5 6.5 L8 3.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>' })));
    };
    const on = (x) => (x ? 'on' : '');
    bar.append(
      rbtn(ICON.undo, 'Visszavonás (⌘Z)', (e) => e.exec('undo')), rbtn(ICON.redo, 'Újra (⇧⌘Z)', (e) => e.exec('redo')), sep(),
      blk, font, size, sep(),
      rbtn('<b>B</b>', 'Félkövér (⌘B)', (e) => e.exec('bold'), on(st.b)),
      rbtn('<i style="font-family:Georgia,serif">I</i>', 'Dőlt (⌘I)', (e) => e.exec('italic'), on(st.i)),
      rbtn('<u>U</u>', 'Aláhúzott (⌘U)', (e) => e.exec('underline'), on(st.u)),
      rbtn('<s>S</s>', 'Áthúzott', (e) => e.exec('strikeThrough'), on(st.s)),
      color('foreColor', 'Betűszín', '#C00000', '<span style="font-weight:700">A</span>'),
      color('hiliteColor', 'Kiemelés', '#FFF59D', '<svg width="14" height="14" viewBox="0 0 16 16"><path d="M3 13 L5 11 L11 5 L13 7 L7 13 Z M10 4 L12 2 L16 6 L14 8" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>'),
      sep(),
      rbtn(ICON.ul, 'Felsorolás', (e) => e.exec('insertUnorderedList'), on(st.ul)),
      rbtn(ICON.ol, 'Számozott lista', (e) => e.exec('insertOrderedList'), on(st.ol)),
      rbtn(ICON.outdent, 'Behúzás csökkentése', (e) => e.exec('outdent')),
      rbtn(ICON.indent, 'Behúzás növelése', (e) => e.exec('indent')), sep(),
      rbtn(ICON.left, 'Balra igazítás', (e) => e.exec('justifyLeft'), on(st.align === 'left' || st.align === 'start')),
      rbtn(ICON.center, 'Középre igazítás', (e) => e.exec('justifyCenter'), on(st.align === 'center')),
      rbtn(ICON.right, 'Jobbra igazítás', (e) => e.exec('justifyRight'), on(st.align === 'right' || st.align === 'end')),
      rbtn(ICON.justify, 'Sorkizárás', (e) => e.exec('justifyFull'), on(st.align === 'justify')), sep(),
      rbtn(ICON.link, 'Hivatkozás', insertLink), rbtn(ICON.img, 'Kép beszúrása', (e) => e.insertImage()),
      rbtn(ICON.table, 'Táblázat beszúrása', insertTable), rbtn(ICON.page, 'Oldaltörés', (e) => e.insertHtml('<hr class="pagebreak"><p><br></p>')), sep(),
      rbtn(ICON.clear, 'Formázás törlése', (e) => { e.exec('removeFormat'); e.exec('unlink'); }),
      rbtn(ICON.find, 'Keresés és csere (⌘F)', openFind));
    return bar;
  }
  const refreshRibbon = F.debounce(() => {
    const a = F.active();
    if (!a || a.facet !== 'doc' || $('#toolbar').contains(document.activeElement)) return;
    F.renderToolbar(true);
  }, 150);
  F.on('docSelection', refreshRibbon);

  async function insertLink(ed) {
    const sel = getSelection().toString();
    ed.restore();
    const saved = getSelection().rangeCount ? getSelection().getRangeAt(0).cloneRange() : null;
    const v = await F.dialog({ title: 'Hivatkozás', fields: [{ id: 'url', label: 'Cím', placeholder: 'https://…', value: 'https://' }].concat(sel ? [] : [{ id: 't', label: 'Megjelenő szöveg', placeholder: 'pl. A projektünk oldala' }]), ok: 'Beszúrás', validate: (x) => (/^(https?:\/\/\S+|mailto:\S+)$/.test(x.url) ? null : 'Adj meg egy https:// kezdetű címet.') });
    if (!v) return;
    ed.paper.focus();
    if (saved) { getSelection().removeAllRanges(); getSelection().addRange(saved); }
    if (sel) document.execCommand('createLink', false, v.url);
    else document.execCommand('insertHTML', false, `<a href="${esc(v.url)}">${esc(v.t || v.url)}</a>&nbsp;`);
  }
  async function insertTable(ed) {
    ed.restore();
    const saved = getSelection().rangeCount ? getSelection().getRangeAt(0).cloneRange() : null;
    const v = await F.dialog({ title: 'Táblázat beszúrása', fields: [{ id: 'r', label: 'Sorok', value: '3' }, { id: 'c', label: 'Oszlopok', value: '3' }, { id: 'hdr', type: 'checkbox', label: 'Első sor fejléc (félkövér)', value: true }], ok: 'Beszúrás', validate: (x) => (+x.r >= 1 && +x.r <= 50 && +x.c >= 1 && +x.c <= 12 ? null : 'Sorok: 1–50, oszlopok: 1–12') });
    if (!v) return;
    ed.paper.focus();
    if (saved) { getSelection().removeAllRanges(); getSelection().addRange(saved); }
    let t = '<table><tbody>';
    for (let r = 0; r < +v.r; r++) { t += '<tr>'; for (let c = 0; c < +v.c; c++) t += r === 0 && v.hdr ? '<th><br></th>' : '<td><br></td>'; t += '</tr>'; }
    document.execCommand('insertHTML', false, t + '</tbody></table><p><br></p>');
  }

  async function convertToDocx(ed) {
    const target = ed.path.replace(/\.txt$/i, '.docx');
    if (F.files().includes(target)) { const ok = await F.confirm('Már létezik', `A(z) <b>${esc(target)}</b> már létezik. Felülírod?`, 'Felülírás', true); if (!ok) return; }
    const tmp = document.createElement('div');
    ed.text().split(/\r?\n/).forEach((line) => { const p = document.createElement('p'); p.textContent = line; if (!line) p.innerHTML = '<br>'; tmp.append(p); });
    try {
      const r = await F.api('POST', 'zip/write', { path: target }, pack(htmlToDocx(tmp)));
      if (!r.ok) throw new Error('Mentés nem sikerült');
    } catch (e) { F.toast(esc(e.message), 'err'); return; }
    await F.refreshTree();
    await F.open(target);
    F.toast(`Kész: <b>${esc(target.split('/').pop())}</b> — itt már formázhatsz is. Az eredeti .txt megmaradt.`, 'ok');
  }

  async function saveAs(ed, fmt) {
    const stem = ed.path.replace(/\.[^./]+$/, '');
    const v = await F.dialog({ title: 'Mentés másként', fields: [{ id: 'p', label: 'Új fájl', value: stem + '.' + fmt }], ok: 'Mentés', validate: (x) => (new RegExp('\\.' + fmt + '$', 'i').test(x.p) ? null : 'A fájl végződése legyen .' + fmt) });
    if (!v) return;
    try {
      if (fmt === 'docx') {
        const src = ed.paper && ed.kind === 'docx' ? ed.paper : (() => { const t = document.createElement('div'); ed.text().split(/\r?\n/).forEach((l) => { const p = document.createElement('p'); p.textContent = l; t.append(p); }); return t; })();
        const r = await F.api('POST', 'zip/write', { path: v.p }, pack(htmlToDocx(src)));
        if (!r.ok) throw new Error('Mentés nem sikerült');
      } else if (fmt === 'txt') await F.fs.write(v.p, ed.text());
      else if (fmt === 'html') await F.fs.write(v.p, `<!DOCTYPE html>\n<html lang="hu">\n<head>\n<meta charset="UTF-8">\n<title>${esc(stem.split('/').pop())}</title>\n<style>body{font-family:Calibri,Arial,sans-serif;max-width:760px;margin:40px auto;line-height:1.5;padding:0 16px}table{border-collapse:collapse}td,th{border:1px solid #aaa;padding:4px 8px}img{max-width:100%}</style>\n</head>\n<body>\n${ed.paper && ed.kind === 'docx' ? ed.paper.innerHTML : esc(ed.text()).replace(/\n/g, '<br>\n')}\n</body>\n</html>\n`);
      else if (fmt === 'md') await F.fs.write(v.p, toMarkdown(ed));
    } catch (e) { F.toast(esc(e.message), 'err'); return; }
    await F.refreshTree();
    F.toast(`Elmentve: <b>${esc(v.p)}</b>`, 'ok');
  }

  function toMarkdown(ed) {
    if (!ed.paper || ed.kind !== 'docx') return ed.text();
    const inl = (n) => Array.from(n.childNodes).map((c) => {
      if (c.nodeType === 3) return c.textContent;
      if (c.nodeType !== 1) return '';
      const t = c.tagName.toLowerCase(), inner = inl(c);
      if (t === 'b' || t === 'strong') return inner.trim() ? `**${inner}**` : inner;
      if (t === 'i' || t === 'em') return inner.trim() ? `*${inner}*` : inner;
      if (t === 's') return `~~${inner}~~`;
      if (t === 'a') return `[${inner}](${c.getAttribute('href')})`;
      if (t === 'br') return '  \n';
      if (t === 'img') return '![kép]()';
      return inner;
    }).join('');
    const out = [];
    const list = (el, depth) => {
      let i = 1;
      Array.from(el.children).forEach((li) => {
        if (li.tagName.toLowerCase() !== 'li') return;
        const own = li.cloneNode(true);
        own.querySelectorAll('ul, ol').forEach((x) => x.remove());
        out.push('  '.repeat(depth) + (el.tagName.toLowerCase() === 'ol' ? `${i++}. ` : '- ') + inl(own).trim());
        li.querySelectorAll(':scope > ul, :scope > ol').forEach((sub) => list(sub, depth + 1));
      });
    };
    Array.from(ed.paper.children).forEach((n) => {
      const t = n.tagName.toLowerCase();
      if (/^h[1-3]$/.test(t)) out.push('#'.repeat(+t[1]) + ' ' + inl(n).trim(), '');
      else if (t === 'ul' || t === 'ol') { list(n, 0); out.push(''); }
      else if (t === 'table') {
        const rows = Array.from(n.querySelectorAll('tr')).map((r) => Array.from(r.children).map((c) => inl(c).trim().replace(/\|/g, '\\|')));
        if (rows.length) { out.push('| ' + rows[0].join(' | ') + ' |', '|' + rows[0].map(() => ' --- |').join('')); rows.slice(1).forEach((r) => out.push('| ' + r.join(' | ') + ' |')); out.push(''); }
      } else if (t === 'hr') out.push('---', '');
      else { const x = inl(n).trim(); out.push(x, ''); }
    });
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  // ───────────── jobb panel ─────────────
  function infoPanel(body, a) {
    body.innerHTML = '';
    const ed = a.custom;
    if (!ed) return;
    const txt = ed.text();
    const c = counts(txt);
    const paras = ed.paper && ed.kind === 'docx' ? ed.paper.querySelectorAll('p, li, h1, h2, h3').length : txt.split(/\n+/).filter((x) => x.trim()).length;
    const mins = Math.max(1, Math.round(c.words / 200));
    const stat = (k, v) => h('div', { class: 'dstat' }, h('b', { text: v }), h('span', { text: k }));
    body.append(h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Statisztika', h('span', { class: 'sub', text: ed.kind.toUpperCase() })),
      h('div', { class: 'dstats' }, stat('szó', c.words.toLocaleString('hu-HU')), stat('karakter', c.charsAll.toLocaleString('hu-HU')), stat('bekezdés', String(paras)), stat('perc olvasás', '~' + mins))));
    if (!ed.readonly) {
      body.append(h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Mentés másként'),
        h('div', { class: 'grid2' },
          ed.kind !== 'docx' ? h('button', { class: 'chip', onclick: () => saveAs(ed, 'docx') }, 'Word (.docx)') : null,
          ed.kind !== 'txt' ? h('button', { class: 'chip', onclick: () => saveAs(ed, 'txt') }, 'Szöveg (.txt)') : null,
          h('button', { class: 'chip', onclick: () => saveAs(ed, 'md') }, 'Markdown (.md)'),
          h('button', { class: 'chip', onclick: () => saveAs(ed, 'html') }, 'Weboldal (.html)'))));
      const zoom = h('input', { type: 'range', min: 50, max: 200, step: 10, value: prefs.zoom, id: 'docZoom' });
      const out = h('output', { text: prefs.zoom + '%' });
      zoom.oninput = () => { prefs.zoom = +zoom.value; out.value = prefs.zoom + '%'; savePrefs(); F.state.docs.forEach((d) => { if (d.custom && d.custom.el) applyZoom(d.custom); }); };
      body.append(h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Nézet'), h('label', { class: 'range-row', for: 'docZoom' }, h('span', { text: 'Nagyítás' }), zoom, out)));
    }
    const ol = ed.outline ? ed.outline() : [];
    if (ol.length) {
      body.append(h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Tartalom', h('span', { class: 'sub', text: ol.length + ' cím' })),
        ol.map((it) => h('div', { class: 'ol-item', style: { paddingLeft: (4 + it.depth * 14) + 'px' }, onclick: it.run }, h('span', { class: 'ol-k', style: { color: it.c }, text: it.k }), h('span', { style: { fontFamily: 'var(--font-ui)' }, text: it.t })))));
    }
    if (F.fs.mode === 'local') body.append(h('div', { class: 'card' }, h('div', { class: 'card-title' }, 'Fájl'),
      h('div', { class: 'grid2' }, h('button', { class: 'chip', onclick: () => F.api('POST', 'openext', { path: a.path }) }, ed.kind === 'docx' ? 'Megnyitás Wordben' : 'Megnyitás máshol'), h('button', { class: 'chip', onclick: () => F.api('POST', 'reveal', { path: a.path }) }, F.isMac ? 'Finderben' : 'Mappában'))));
  }

  // ───────────── facet ─────────────
  F.extendFacet('doc', {
    custom: { create },
    hint: '',
    outline: (model, custom) => (custom && custom.outline ? custom.outline() : []),
    tools: [{ el: ribbon }],
    stage: [{ id: 'docinfo', label: 'Dokumentum', render: infoPanel }],
    onChange: F.debounce(() => { if (F.stageTab() === 'docinfo') F.refreshStage(); F.updateStatus(); }, 400),
    onActivate: () => { F.renderToolbar(true); F.updateStatus(); }
  });

  const C = (label, keywords, run, icon) => F.command({ label, keywords, run, icon: icon || 'W', facet: 'doc' });
  C('Keresés és csere', 'find replace kereses csere', () => { const e = cur(); if (e) openFind(e); }, '⌕');
  C('Mentés Word-ként (.docx)', 'save as docx word', () => { const e = cur(); if (e) saveAs(e, 'docx'); }, 'W');
  C('Mentés szövegként (.txt)', 'save as txt', () => { const e = cur(); if (e) saveAs(e, 'txt'); }, 'T');
  C('Mentés Markdownként (.md)', 'save as markdown md', () => { const e = cur(); if (e) saveAs(e, 'md'); }, 'M');
  C('Mentés weboldalként (.html)', 'save as html', () => { const e = cur(); if (e) saveAs(e, 'html'); }, '<>');
  C('Táblázat beszúrása', 'table tablazat', () => { const e = cur(); if (e && e.kind === 'docx') insertTable(e); }, '▦');
  C('Kép beszúrása', 'image kep', () => { const e = cur(); if (e && e.kind === 'docx') e.insertImage(); }, '▣');
  C('Oldaltörés', 'page break oldaltores', () => { const e = cur(); if (e && e.kind === 'docx') e.insertHtml('<hr class="pagebreak"><p><br></p>'); }, '—');
  F.command({ label: 'Új Word-dokumentum', keywords: 'docx word dokumentum uj', icon: 'W', run: () => F.newFile(null, 'dokumentum.docx') });
})();
