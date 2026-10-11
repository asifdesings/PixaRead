/* PixaRead audiobook: text preparation.
 *
 * Turns the chapter HTML that PixaRead already stored when the book was imported into an ordered list of narration
 * passages. The author's words and order are kept; nothing is summarised, rewritten or added. The only changes are the
 * ones a reader would make aloud: shouted (ALL-CAPS) titles are spoken as normal words, footnote marks are not read as
 * numbers, and code listings (which cannot be read aloud sensibly) are left out and reported.
 */
(function(){
'use strict';

const ABBR = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'etc', 'vs', 'no', 'fig', 'figs', 'eq', 'inc', 'ltd', 'co', 'corp', 'gen', 'col', 'capt', 'lt', 'sgt', 'rev', 'hon', 'gov', 'sen', 'rep', 'dept', 'est', 'approx', 'vol', 'pp', 'ch', 'cf', 'ca', 'viz', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec']);
const SMALL = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for', 'by', 'with', 'from', 'as', 'nor']);

const clean = s => String(s || '').normalize('NFC').replace(/[\u00AD\u200B\u200C\u200D\uFEFF]/g, '').replace(/[\u00A0\u2007\u202F]/g, ' ').replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n */g, '\n').trim();

// "THE QUIET HOUR" is read as a title, not spelled out. Only whole shouted titles are changed, never body text.
function unshout(s){
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length < 4 || letters !== letters.toUpperCase()) return s;
  let first = true;
  return s.toLowerCase().replace(/[a-z][a-z']*/g, w => { const out = (first || !SMALL.has(w)) ? w[0].toUpperCase() + w.slice(1) : w; first = false; return out; });
}

function textOf(node){
  const c = node.cloneNode(true);
  c.querySelectorAll('sup, script, style').forEach(x => { if (x.tagName !== 'SUP' || /^[\s\d*†‡§\[\]()]+$/.test(x.textContent)) x.remove(); });   // footnote marks, not words
  c.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
  return clean(c.textContent);
}

/* html -> [{k, text}], plus counts of what could not be read aloud */
function toSegments(html, opts){
  opts = opts || {};
  const body = new DOMParser().parseFromString('<!doctype html><body>' + html, 'text/html').body;
  const segs = [], stats = {code: 0, tables: 0, images: 0, footnotes: 0, skippedFootnotes: 0};
  let first = true;
  const push = (k, text) => { text = clean(text); if (/[\p{L}\p{N}]/u.test(text)){ segs.push({k, text}); first = false; } };
  const walk = parent => {
    for (const n of parent.children){
      const t = n.tagName.toLowerCase();
      if (n.classList.contains('ch-head')){
        const label = clean((n.querySelector('.ch-label') || {}).textContent || ''), h = n.querySelector('h1,h2,h3');
        const title = h ? textOf(h) : '';
        const lab = label ? unshout(label) : '';
        push('title', [lab, unshout(title)].filter(Boolean).join('. '));
      }
      else if (/^h[1-6]$/.test(t)){ const x = unshout(textOf(n)); if (first || n.classList.contains('ttl')) push('title', x); else push('head', x); }
      else if (t === 'p'){
        if (n.classList.contains('altimg')){ stats.images++; continue; }
        const x = textOf(n);
        if (n.classList.contains('fn')){ stats.footnotes++; if (opts.skipFootnotes){ stats.skippedFootnotes++; continue; } push('foot', x); }
        else push(n.classList.contains('cap') ? 'cap' : 'para', x);
      }
      else if (t === 'figure'){ const cap = n.querySelector('figcaption'); stats.images += n.querySelectorAll('img').length; if (cap) push('cap', textOf(cap)); }
      else if (t === 'img' || t === 'svg'){ stats.images++; }
      else if (t === 'pre'){ stats.code++; }
      else if (t === 'hr'){ segs.push({k: 'break', text: ''}); }
      else if (t === 'blockquote'){ const before = segs.length; walk(n); for (let i = before; i < segs.length; i++) if (segs[i].k === 'para') segs[i].k = 'quote'; }
      else if (t === 'ul' || t === 'ol'){
        let i = 0;
        for (const li of n.children){ if (li.tagName !== 'LI') continue; i++; const sub = li.querySelector('p,ul,ol,blockquote'); const x = sub ? textOf(li) : textOf(li); push('list', (t === 'ol' ? i + '. ' : '') + x); }
      }
      else if (t === 'table'){
        stats.tables++;
        for (const tr of n.querySelectorAll('tr')){ const cells = [...tr.children].map(c => textOf(c)).filter(Boolean); if (cells.length) push('table', cells.join(', ')); }
      }
      else if (t === 'script' || t === 'style') continue;
      else walk(n);
    }
  };
  walk(body);
  return {segs, stats};
}

/* ---- sentences and passages ---- */
function splitSentences(text){
  const out = []; let start = 0, m; const re = /[.!?…]+["'”’)\]»]*\s+/g;
  while ((m = re.exec(text))){
    const end = m.index + m[0].length, punct = m[0].match(/^[.!?…]+/)[0], before = text.slice(start, m.index + punct.length), next = text.charAt(end);
    if (/^[a-z]/.test(next)) continue;                                 // a lower-case word carries on: '"Stop!" he said.', "e.g. this one"
    if (punct === '.'){
      const w = ((before.match(/(\S+)$/) || [''])[0]).replace(/^[("'“‘«]+/, '').replace(/\.+$/, '').toLowerCase();
      if (ABBR.has(w) || /^[a-z]$/i.test(w)) continue;                 // "Dr." and initials such as "J." do not end a sentence
    }
    out.push(text.slice(start, end).trim()); start = end;
  }
  const rest = text.slice(start).trim(); if (rest) out.push(rest);
  return out;
}
// A very long sentence is cut at its own commas, semicolons and dashes; as a last resort between words. Never inside a word.
function splitLong(s, max){
  if (s.length <= max) return [s];
  const parts = s.split(/(?<=[;:—,])\s+/), out = []; let cur = '';
  for (const p of parts){
    if ((cur + ' ' + p).trim().length > max && cur){ out.push(cur); cur = p; } else cur = (cur + ' ' + p).trim();
  }
  if (cur) out.push(cur);
  return out.flatMap(x => { if (x.length <= max) return [x]; const w = x.split(/\s+/), r = []; let c = ''; for (const t of w){ if ((c + ' ' + t).trim().length > max && c){ r.push(c); c = t; } else c = (c + ' ' + t).trim(); } if (c) r.push(c); return r; });
}

const DEFAULTS = {maxChars: 240, paraPause: 0.7, headPause: 1.0, intraPause: 0.12, listPause: 0.4, skipFootnotes: false};

/* segments -> chunks [{t, gap, k}]; gap = silence (seconds) after the chunk */
function makeChunks(segs, o){
  o = Object.assign({}, DEFAULTS, o || {});
  const chunks = [], setGap = (c, g) => { if (c) c.gap = Math.max(c.gap, g); };
  for (const seg of segs){
    if (seg.k === 'break'){ setGap(chunks[chunks.length - 1], o.headPause * 1.2); continue; }
    const isHead = seg.k === 'title' || seg.k === 'head';
    if (isHead) setGap(chunks[chunks.length - 1], o.headPause);                // a pause before a heading
    const lines = seg.k === 'para' || seg.k === 'quote' ? seg.text.split('\n').map(x => x.trim()).filter(Boolean) : [seg.text.replace(/\n+/g, ' ')];
    lines.forEach((line, li) => {
      const sentences = splitSentences(line).flatMap(s => splitLong(s, o.maxChars));
      let cur = '';
      const flush = gap => { if (cur){ chunks.push({t: cur, gap, k: seg.k}); cur = ''; } };
      sentences.forEach((s, si) => {
        if (cur && (cur + ' ' + s).length > o.maxChars) flush(o.intraPause);
        cur = cur ? cur + ' ' + s : s;
      });
      const last = li === lines.length - 1;
      flush(isHead ? o.headPause : seg.k === 'list' || seg.k === 'table' ? o.listPause : last ? o.paraPause : o.listPause);
    });
  }
  if (chunks.length) chunks[chunks.length - 1].gap = 0;
  return chunks;
}

/* PixaRead stores very long chapters in several pieces ("cont"); an audiobook chapter is the whole logical chapter. */
function groupChapters(chapters){
  const groups = [];
  chapters.forEach((c, i) => { if (c.cont && groups.length) groups[groups.length - 1].pieces.push(c); else groups.push({title: c.title || ('Chapter ' + (groups.length + 1)), pieces: [c], first: i}); });
  return groups;
}

function prepareChapter(group, opts){
  const all = [], stats = {code: 0, tables: 0, images: 0, footnotes: 0, skippedFootnotes: 0};
  group.pieces.forEach((c, pi) => { const r = toSegments(c.html || '', opts); if (pi > 0) r.segs.forEach(s => { if (s.k === 'title') s.k = 'head'; }); all.push(...r.segs); for (const k in stats) stats[k] += r.stats[k]; });
  const chunks = makeChunks(all, opts), chars = chunks.reduce((n, c) => n + c.t.length, 0);
  let problem = '';
  if (!chars) problem = stats.images ? 'This chapter contains only pictures, so there is nothing to read aloud.' : 'This chapter has no text to read aloud.';
  else if (chars < 40 && stats.images) problem = 'This chapter is almost only pictures. If it was a scanned page, it needs text recognition (OCR) before it can be narrated.';
  return {chunks, chars, stats, problem};
}

function latinShare(text){
  const letters = (text.match(/\p{L}/gu) || []).length; if (!letters) return 1;
  return (text.match(/[A-Za-z\u00C0-\u024F]/g) || []).length / letters;
}

const sha256 = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
// Same text + same voice settings + same model = same audio, so finished chapters are reused.
const fingerprint = (chunks, settings) => sha256(JSON.stringify({v: 1, s: settings, c: chunks.map(c => [c.t, Math.round(c.gap * 1000)])}));

// approximate narration length: about 15 characters per second at normal speed, plus the pauses
const estimateSeconds = (chunks, speed) => chunks.reduce((n, c) => n + c.t.length / (15 * (speed || 1)) + c.gap, 0);

function safeName(s, max){
  const x = String(s || '').normalize('NFC').replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, ' ').replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, max || 80).trim();
  return x || 'Untitled';
}

window.PXText = {DEFAULTS, toSegments, splitSentences, splitLong, makeChunks, groupChapters, prepareChapter, latinShare, fingerprint, estimateSeconds, safeName, unshout};
})();
