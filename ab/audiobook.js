/* PixaRead audiobook generator.
 *
 * A separate feature from the reader's "Read aloud" button (which keeps using the browser's own speechSynthesis and is
 * not touched here). This module makes real audio files on the device with a local AI voice (Kokoro 82M, int8),
 * stores them in the browser's private file storage, and plays them back. No text or audio ever leaves the device.
 *
 * It connects to the reader through window.PX (see index.html): the book list, the stored chapter HTML, and a few UI helpers.
 */
(function(){
'use strict';
const PX = window.PX, T = window.PXText;
if (!PX || !T) return;
const {esc, ic, toast, dialog, DB} = PX, $ = PX.$;
const BASE = new URL('./', document.currentScript ? document.currentScript.src : location.href).href;
const MANIFEST_URL = BASE + 'model-manifest.json';
const SR = 24000;
const PXA = window.PixaAudio = {version: '1.0.0', test: {failOnce: new Set(), forceIdb: false}};

/* ======================================================= small helpers ======================================================= */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MB = n => (n >= 1e8 ? Math.round(n / 1e6) : (n / 1e6).toFixed(1)) + ' MB';
const fmtBytes = n => n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : MB(n);
function clock(s){ s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); }
function human(s){ s = Math.max(0, Math.round(s || 0)); if (s < 90) return s + ' sec'; if (s < 5400) return Math.round(s / 60) + ' min'; const h = Math.floor(s / 3600), m = Math.round(s % 3600 / 60); return h + ' h ' + String(m).padStart(2, '0') + ' min'; }
const now = () => Date.now();
function wavHeader(dataBytes){
  const b = new ArrayBuffer(44), v = new DataView(b), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, dataBytes, true);
  return new Uint8Array(b);
}
async function sha256Hex(buf){ return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join(''); }

/* ======================================================= storage: OPFS first, IndexedDB as a fallback ======================================================= */
const Store = (() => {
  let mode = null, root = null;
  const hasOpfs = () => !!(navigator.storage && navigator.storage.getDirectory && typeof FileSystemFileHandle !== 'undefined' && FileSystemFileHandle.prototype.createWritable);
  const dirs = async (parts, create) => { let d = root; for (const p of parts) d = await d.getDirectoryHandle(p, {create}); return d; };
  const split = path => { const parts = path.split('/'); return {dir: parts.slice(0, -1), name: parts[parts.length - 1]}; };
  const wrapQuota = e => { if (e && (e.name === 'QuotaExceededError' || /quota/i.test(String(e.message)))){ const q = new Error('There is not enough free storage on this device.'); q.quota = true; return q; } return e; };
  async function init(){
    if (mode) return mode;
    if (!PXA.test.forceIdb && !window.__PXA_FORCE_IDB && hasOpfs()){
      try { root = await navigator.storage.getDirectory(); const h = await root.getFileHandle('.probe', {create: true}), w = await h.createWritable(); await w.write(new Uint8Array([1])); await w.close(); await root.removeEntry('.probe'); mode = 'opfs'; }
      catch(e){ mode = 'idb'; }
    } else mode = 'idb';
    return mode;
  }
  async function put(path, data){
    await init();
    try {
      if (mode === 'opfs'){ const {dir, name} = split(path), d = await dirs(dir, true), h = await d.getFileHandle(name, {create: true}), w = await h.createWritable(); await w.write(data); await w.close(); }
      else await DB.put('ab_audio', {id: path, blob: data instanceof Blob ? data : new Blob([data])});
    } catch(e){ throw wrapQuota(e); }
  }
  async function get(path){
    await init();
    try {
      if (mode === 'opfs'){ const {dir, name} = split(path), d = await dirs(dir, false), h = await d.getFileHandle(name); return await h.getFile(); }
      const r = await DB.get('ab_audio', path); return r ? r.blob : null;
    } catch(e){ return null; }
  }
  const size = async path => { const f = await get(path); return f ? f.size : 0; };
  async function del(path){
    await init();
    try {
      if (mode === 'opfs'){ const {dir, name} = split(path), d = await dirs(dir, false); await d.removeEntry(name); }
      else await DB.del('ab_audio', path);
    } catch(e){}
  }
  async function delPrefix(prefix){
    await init();
    try {
      if (mode === 'opfs'){ const parts = prefix.split('/').filter(Boolean), last = parts.pop(), d = await dirs(parts, false); await d.removeEntry(last, {recursive: true}); }
      else for (const r of await DB.all('ab_audio')) if (r.id.startsWith(prefix)) await DB.del('ab_audio', r.id);
    } catch(e){}
  }
  // A writer that never holds a whole file in memory (OPFS), and can continue an unfinished download.
  async function writer(path, append){
    await init();
    if (mode === 'opfs'){
      const {dir, name} = split(path), d = await dirs(dir, true), h = await d.getFileHandle(name, {create: true});
      const w = await h.createWritable({keepExistingData: !!append});
      if (append){ const f = await h.getFile(); await w.seek(f.size); }
      return {write: async x => { try { await w.write(x); } catch(e){ throw wrapQuota(e); } }, close: async () => { try { await w.close(); } catch(e){ throw wrapQuota(e); } }, abort: () => w.abort().catch(() => {})};
    }
    const parts = [];
    return {write: async x => { parts.push(x instanceof Blob ? x : new Blob([x])); }, close: async () => { try { await DB.put('ab_audio', {id: path, blob: new Blob(parts)}); } catch(e){ throw wrapQuota(e); } }, abort: async () => {}};
  }
  async function bytesUnder(prefix){
    await init(); let n = 0;
    try {
      if (mode === 'opfs'){
        const walk = async d => { for await (const [, h] of d.entries()){ if (h.kind === 'file') n += (await h.getFile()).size; else await walk(h); } };
        const parts = prefix.split('/').filter(Boolean); await walk(await dirs(parts, false));
      } else for (const r of await DB.all('ab_audio')) if (r.id.startsWith(prefix)) n += r.blob.size;
    } catch(e){}
    return n;
  }
  return {init, put, get, size, del, delPrefix, writer, bytesUnder, mode: () => mode};
})();

const modelPath = (id, name) => 'model/' + id + '/' + name;
const audioPath = (bookId, n) => 'audio/' + bookId + '/' + n + '.wav';
const tmpDir = (bookId) => 'tmp/' + bookId + '/';
const tmpPath = (bookId, n, k) => tmpDir(bookId) + n + '_' + k + '.pcm';

/* ======================================================= environment ======================================================= */
function envProblem(){
  if (typeof WebAssembly === 'undefined') return 'This browser cannot run WebAssembly, which the voice engine needs.';
  if (typeof Worker === 'undefined') return 'This browser cannot run background workers, which the voice engine needs.';
  if (!window.isSecureContext) return 'The voice engine needs a secure page (https or localhost). Open PixaRead from its https address.';
  if (!window.crypto || !crypto.subtle) return 'This browser does not provide the security features needed to verify the voice model.';
  if (location.protocol === 'file:') return 'The voice engine cannot run from a file. Open PixaRead from its web address.';
  return '';
}
async function requestPersistence(){
  try { if (navigator.storage && navigator.storage.persist){ if (await navigator.storage.persisted()) return true; return await navigator.storage.persist(); } } catch(e){}
  return false;
}
async function storageInfo(){
  const o = {persisted: false, usage: 0, quota: 0};
  try { o.persisted = !!(navigator.storage && navigator.storage.persisted && await navigator.storage.persisted()); const e = await navigator.storage.estimate(); o.usage = e.usage || 0; o.quota = e.quota || 0; } catch(e){}
  return o;
}

/* ======================================================= the voice model: download, verify, remove ======================================================= */
const MODEL_REC = 'kokoro';
const Model = {
  manifest: null,
  async loadManifest(){
    if (this.manifest) return this.manifest;
    try { const r = await fetch(MANIFEST_URL, {cache: 'no-cache'}); if (!r.ok) throw new Error(); this.manifest = await r.json(); }
    catch(e){ const rec = await DB.get('ab_model', MODEL_REC); if (rec && rec.manifest) this.manifest = rec.manifest; else throw new Error('The model list could not be loaded. Connect to the internet once and try again.'); }
    return this.manifest;
  },
  async status(){
    const m = await this.loadManifest(), rec = await DB.get('ab_model', MODEL_REC);
    const files = [];
    for (const f of m.files){ const have = await Store.size(modelPath(m.id, f.name)); files.push({name: f.name, size: f.size, have}); }
    const total = m.files.reduce((n, f) => n + f.size, 0), have = files.reduce((n, f) => n + Math.min(f.have, f.size), 0);
    const complete = files.every(f => f.have === f.size);
    if (rec && rec.ready && rec.modelId === m.id && rec.version === m.version){
      if (complete) return {state: 'ready', total, have, files, rec};
      return {state: 'evicted', total, have, files, missing: files.filter(f => f.have !== f.size).map(f => f.name), rec};
    }
    return {state: have > 0 ? 'partial' : 'missing', total, have, files};
  },
  async download({onProgress, signal}){
    const m = await this.loadManifest(), total = m.files.reduce((n, f) => n + f.size, 0);
    await requestPersistence();
    let done = 0;
    for (const f of m.files){
      const path = modelPath(m.id, f.name);
      let have = await Store.size(path);
      if (have > f.size){ await Store.del(path); have = 0; }
      if (have === f.size){ done += f.size; onProgress && onProgress(done, total, f.name); continue; }
      const url = new URL(m.base + f.name, MANIFEST_URL).href;
      let res;
      try { res = await fetch(url, {headers: have ? {Range: 'bytes=' + have + '-'} : {}, signal, cache: 'no-store'}); }
      catch(e){ if (e.name === 'AbortError') throw e; throw new Error('The download failed. Check your internet connection and try again.'); }
      if (res.status === 404) throw new Error('The model file "' + f.name + '" was not found on this server (' + new URL(m.base, MANIFEST_URL).pathname + '). It has to be added to the site first; see README.');
      if (have && res.status === 200){ await Store.del(path); have = 0; }          // the server ignored the range request: start the file again
      else if (!res.ok && res.status !== 206) throw new Error('The server answered with an error (' + res.status + ') for ' + f.name + '.');
      const w = await Store.writer(path, have > 0), rd = res.body.getReader();
      let got = have; const base = done;
      try {
        for (;;){
          const {done: end, value} = await rd.read(); if (end) break;
          await w.write(value); got += value.length; onProgress && onProgress(base + got, total, f.name);
        }
        await w.close();
      } catch(e){
        try { await w.close(); } catch(_){}                                           // keep what was received so the download can continue later
        if (e.name === 'AbortError') throw e;
        if (e.quota) throw e;
        throw new Error('The download was interrupted. Try again; it will continue where it stopped.');
      }
      done = base + f.size;
    }
  },
  // Sizes, checksums, then a real test: load the model and speak a sentence. Only then is it "ready for offline use".
  async verify({onStep}){
    const m = await this.loadManifest(); let hashNote = 'ok';
    for (const f of m.files){
      onStep && onStep('Checking ' + f.name);
      const path = modelPath(m.id, f.name), file = await Store.get(path);
      if (!file || file.size !== f.size) throw new Error(f.name + ' is incomplete.');
      try {
        const got = await sha256Hex(await file.arrayBuffer());
        if (got !== f.sha256){ await Store.del(path); throw new Error(f.name + ' did not match its checksum and was removed. Download it again.'); }
      } catch(e){ if (e instanceof RangeError || /allocation|memory/i.test(String(e.message))) hashNote = 'size-only'; else throw e; }
    }
    onStep && onStep('Starting the voice engine');
    Tts.kill(); await Tts.start();
    onStep && onStep('Speaking a test sentence');
    const t0 = performance.now(), r = await Tts.synth('Offline narration is ready.', 'af_heart', 1);
    const secs = r.samples / SR, wall = (performance.now() - t0) / 1000, pcm = r.pcm; let peak = 0; for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
    if (secs < 0.6 || peak < 500) throw new Error('The voice engine started but did not produce speech. The model files may be damaged.');
    const rtf = secs / Math.max(0.05, wall);
    await DB.put('ab_model', {id: MODEL_REC, modelId: m.id, version: m.version, ready: true, verifiedAt: now(), hash: hashNote, rtf, manifest: m});
    return {rtf, hash: hashNote};
  },
  async remove(){
    const m = await this.loadManifest(); Tts.kill();
    await Store.delPrefix('model/' + m.id + '/'); await DB.del('ab_model', MODEL_REC);
  }
};

/* ======================================================= the voice engine (a Web Worker) ======================================================= */
const Tts = {
  w: null, seq: 0, pend: new Map(), ready: false, info: null, starting: null,
  start(){
    if (this.ready) return Promise.resolve();
    if (this.starting) return this.starting;
    return this.starting = (async () => {
      const m = await Model.loadManifest(), pathOf = n => modelPath(m.id, n);
      const [modelFile, voicesFile, cfgFile] = await Promise.all([Store.get(pathOf('kokoro-v1.0.int8.onnx')), Store.get(pathOf('voices-v1.0.bin')), Store.get(pathOf('config.json'))]);
      if (!modelFile || !voicesFile || !cfgFile) throw new Error('The voice model files are missing from this device.');
      const config = JSON.parse(await cfgFile.text());
      this.w = new Worker(BASE + 'tts-worker.js', {type: 'module'});
      this.w.onmessage = e => { const p = this.pend.get(e.data.id); if (!p) return; this.pend.delete(e.data.id); e.data.ok ? p.res(e.data) : p.rej(new Error(e.data.error)); };
      this.w.onerror = e => { const err = new Error('The voice engine stopped unexpectedly' + (e && e.message ? ': ' + e.message : '.')); this.pend.forEach(p => p.rej(err)); this.pend.clear(); this.ready = false; try { this.w.terminate(); } catch(_){} this.w = null; };
      this.info = await this.call({type: 'init', modelFile, voicesFile, config, threads: 1});
      this.ready = true;
    })().finally(() => { this.starting = null; });
  },
  call(msg){ return new Promise((res, rej) => { if (!this.w) return rej(new Error('The voice engine is not running.')); const id = ++this.seq; this.pend.set(id, {res, rej}); this.w.postMessage({id, ...msg}); }); },
  synth(text, voice, speed, simulateFail){ return this.call({type: 'synth', text, voice, speed, simulateFail}); },
  kill(){ if (this.w){ try { this.w.terminate(); } catch(e){} } const err = new Error('The voice engine was stopped.'); this.pend.forEach(p => p.rej(err)); this.pend.clear(); this.w = null; this.ready = false; this.info = null; this.starting = null; }
};

/* ======================================================= voices ======================================================= */
// Only English voices: the phonemiser bundled with the app contains English only. Quality grades come from the model's own voice table.
const VOICES = [
  {id: 'af_heart', name: 'Heart', accent: 'US', gender: 'Female', grade: 'A'}, {id: 'af_bella', name: 'Bella', accent: 'US', gender: 'Female', grade: 'A-'},
  {id: 'af_nicole', name: 'Nicole', accent: 'US', gender: 'Female', grade: 'B-'}, {id: 'af_aoede', name: 'Aoede', accent: 'US', gender: 'Female', grade: 'C+'},
  {id: 'af_kore', name: 'Kore', accent: 'US', gender: 'Female', grade: 'C+'}, {id: 'af_sarah', name: 'Sarah', accent: 'US', gender: 'Female', grade: 'C+'},
  {id: 'am_fenrir', name: 'Fenrir', accent: 'US', gender: 'Male', grade: 'C+'}, {id: 'am_michael', name: 'Michael', accent: 'US', gender: 'Male', grade: 'C+'}, {id: 'am_puck', name: 'Puck', accent: 'US', gender: 'Male', grade: 'C+'},
  {id: 'bf_emma', name: 'Emma', accent: 'UK', gender: 'Female', grade: 'B-'}, {id: 'bf_isabella', name: 'Isabella', accent: 'UK', gender: 'Female', grade: 'C'},
  {id: 'bm_george', name: 'George', accent: 'UK', gender: 'Male', grade: 'C'}, {id: 'bm_fable', name: 'Fable', accent: 'UK', gender: 'Male', grade: 'C'}
];
const voiceById = id => VOICES.find(v => v.id === id) || VOICES[0];
const voiceLabel = v => v.name + ' · ' + v.accent + ' · ' + v.gender;
const SAMPLE = 'The quiet hour settled over the house, and the reader turned the page.';

/* ======================================================= books -> audiobook chapters ======================================================= */
const prepCache = new Map();
async function loadBook(bookId){
  const meta = PX.getBooks().find(b => b.id === bookId), content = await DB.get('content', bookId);
  if (!meta || !content || !content.chapters) return null;
  return {meta, groups: T.groupChapters(content.chapters), format: meta.format};
}
const prepKey = (bookId, n, o) => bookId + '|' + n + '|' + o.skipFootnotes + '|' + o.paraPause + '|' + o.headPause;
function prepare(book, n, o){
  const key = prepKey(book.meta.id, n, o);
  if (!prepCache.has(key)) prepCache.set(key, T.prepareChapter(book.groups[n], {skipFootnotes: o.skipFootnotes, paraPause: o.paraPause, headPause: o.headPause}));
  return prepCache.get(key);
}
function languageNote(book){
  const lang = String(book.meta.lang || '').toLowerCase(); let sample = '';
  for (const g of book.groups.slice(0, 3)) for (const p of g.pieces) sample += p.html.replace(/<[^>]*>/g, ' ').slice(0, 2000);
  const latin = T.latinShare(sample);
  if (latin < 0.6) return {block: true, text: 'This book is not written in a Latin-script language. The offline voices only speak English, so they cannot read it. The Read aloud button in the reader can use your phone\u2019s own voices for other languages.'};
  if (lang && !/^en/.test(lang)) return {block: false, text: 'This book looks like it is in another language (' + lang + '). The offline voices speak English, so the narration will sound wrong. Consider the Read aloud button in the reader instead.'};
  return null;
}
const settingsKey = a => JSON.stringify({m: a.modelId, v: a.voice, s: a.speed, p: a.paraPause, h: a.headPause, f: a.skipFootnotes});

/* ======================================================= audiobook records ======================================================= */
const getAB = id => DB.get('ab_books', id);
const putAB = a => { a.updatedAt = now(); return DB.put('ab_books', JSON.parse(JSON.stringify(a))); };
const getChunks = async (bookId, n) => (await DB.get('ab_chunks', bookId + '|' + n)) || null;
const putChunks = r => DB.put('ab_chunks', r);

/* ======================================================= the generation job ======================================================= */
const Job = {cur: null, listeners: new Set(), wake: null};
const emit = () => { Job.listeners.forEach(f => { try { f(); } catch(e){} }); };
PXA.onChange = f => { Job.listeners.add(f); return () => Job.listeners.delete(f); };

async function holdWake(){ try { if (navigator.wakeLock) Job.wake = await navigator.wakeLock.request('screen'); } catch(e){} }
function releaseWake(){ try { if (Job.wake){ Job.wake.release(); Job.wake = null; } } catch(e){} }

async function resetChapterFiles(bookId, n){
  const rec = await getChunks(bookId, n);
  if (rec){ for (let k = 0; k < (rec.st || []).length; k++) await Store.del(tmpPath(bookId, n, k)); await DB.del('ab_chunks', rec.id); }
  await Store.del(audioPath(bookId, n));
}

async function assembleChapter(abk, n, ch, chunks, rec){
  const gaps = chunks.map(c => Math.round(c.gap * SR));
  const totalSamples = rec.samples.reduce((a, b) => a + (b || 0), 0) + gaps.reduce((a, b) => a + b, 0);
  const w = await Store.writer(audioPath(abk.id, n), false);
  try {
    await w.write(wavHeader(totalSamples * 2));
    for (let k = 0; k < chunks.length; k++){
      const f = await Store.get(tmpPath(abk.id, n, k));
      if (!f || f.size !== rec.samples[k] * 2) throw new Error('A saved passage is missing (' + (k + 1) + ' of ' + chunks.length + '). Retry this chapter.');
      await w.write(f);
      if (gaps[k]) await w.write(new Uint8Array(gaps[k] * 2));
    }
    await w.close();
  } catch(e){ try { await w.abort(); } catch(_){} throw e; }
  for (let k = 0; k < chunks.length; k++) await Store.del(tmpPath(abk.id, n, k));
  await DB.del('ab_chunks', rec.id);
  ch.status = 'done'; ch.secs = totalSamples / SR; ch.bytes = 44 + totalSamples * 2; ch.done = chunks.length; ch.failed = 0; ch.problem = '';
}

// opts.only: array of chapter numbers to work on (default: every selected chapter that is not finished)
async function runJob(bookId, opts){
  if (Job.cur) throw new Error('Another audiobook is already being made. Pause or stop it first.');
  opts = opts || {};
  const book = await loadBook(bookId), abk = await getAB(bookId);
  if (!book || !abk) throw new Error('The book or its audiobook settings could not be found.');
  const job = Job.cur = {bookId, abort: false, hardStop: false, n: -1, k: 0, nChunks: 0, audioSecs: 0, chars: 0, wall0: now(), spc: 0, charsDone: 0, error: '', phase: 'starting', remainChars: 0};
  abk.status = 'running'; await putAB(abk); emit(); holdWake();
  const o = {skipFootnotes: abk.skipFootnotes, paraPause: abk.paraPause, headPause: abk.headPause}, sk = settingsKey(abk);
  try {
    job.phase = 'loading the voice';
    emit(); await Tts.start();
    const todo = (opts.only || abk.chapters.map((c, i) => i)).filter(i => abk.chapters[i].selected !== false);
    // total characters still to do, for the time estimate
    for (const n of todo){ const ch = abk.chapters[n]; if (ch.status === 'done' || ch.status === 'empty') continue; job.remainChars += prepare(book, n, o).chars; }
    for (const n of todo){
      if (job.abort) break;
      const ch = abk.chapters[n], prep = prepare(book, n, o);
      if (prep.problem){ ch.status = 'empty'; ch.problem = prep.problem; ch.nChunks = 0; await putAB(abk); continue; }
      const fp = await T.fingerprint(prep.chunks, sk);
      const have = ch.status === 'done' && ch.fp === fp && await Store.size(audioPath(abk.id, n)) > 44;
      if (have) continue;                                                       // same text, same voice, same model: reuse the finished chapter
      let rec = await getChunks(abk.id, n);
      if (ch.fp !== fp || !rec || rec.fp !== fp){ await resetChapterFiles(abk.id, n); rec = {id: abk.id + '|' + n, fp, st: new Array(prep.chunks.length).fill(0), samples: new Array(prep.chunks.length).fill(0), err: {}}; }
      ch.fp = fp; ch.nChunks = prep.chunks.length; ch.status = 'running'; ch.problem = '';
      job.n = n; job.nChunks = prep.chunks.length; job.phase = 'narrating';
      ch.done = rec.st.filter(x => x === 1).length; ch.failed = 0;
      for (let k = 0; k < prep.chunks.length; k++){
        if (job.abort) break;
        if (rec.st[k] === 1) continue;
        job.k = k; emit();
        const c = prep.chunks[k], failKey = n + ':' + k;
        const simulate = PXA.test.failOnce.has(failKey); if (simulate) PXA.test.failOnce.delete(failKey);
        try {
          const r = await Tts.synth(c.t, abk.voice, abk.speed, simulate);
          await Store.put(tmpPath(abk.id, n, k), new Blob([r.pcm.buffer]));
          rec.st[k] = 1; rec.samples[k] = r.samples; delete rec.err[k];
          job.audioSecs += r.samples / SR; job.charsDone += c.t.length; job.remainChars -= c.t.length;
          job.spc = job.audioSecs / Math.max(1, job.charsDone);
          PXA.stats.synth++;
        } catch(e){
          if (e.quota){ throw e; }
          if (/engine (stopped|was stopped)/i.test(e.message) && job.abort) break;
          rec.st[k] = 2; rec.err[k] = String(e.message || e);
        }
        ch.done = rec.st.filter(x => x === 1).length; ch.failed = rec.st.filter(x => x === 2).length;
        await putChunks(rec);
        if (k % 4 === 3 || k === prep.chunks.length - 1) await putAB(abk);
        emit();
      }
      if (job.abort){ ch.status = 'pending'; await putAB(abk); break; }
      if (rec.st.some(x => x === 2)){ ch.status = 'error'; ch.problem = rec.st.filter(x => x === 2).length + ' passage(s) failed. Nothing was skipped; retry the failed passages.'; await putAB(abk); continue; }
      job.phase = 'saving chapter ' + (n + 1); emit();
      await assembleChapter(abk, n, ch, prep.chunks, rec);
      await putAB(abk); PXA.stats.chapters++; emit();
    }
    const sel = abk.chapters.filter(c => c.selected !== false);
    abk.status = job.abort ? 'paused' : sel.every(c => c.status === 'done' || c.status === 'empty') ? 'done' : sel.some(c => c.status === 'error') ? 'error' : 'paused';
  } catch(e){
    job.error = String(e.message || e); abk.status = 'error'; abk.lastError = job.error;
    if (e.quota) abk.lastError = 'The device ran out of storage. Your finished chapters are safe. Free some space and resume.';
    if (/voice|engine|model/i.test(job.error) && !e.quota) abk.lastError = job.error;
  } finally {
    abk.chapters.forEach(c => { if (c.status === 'running') c.status = 'pending'; });
    await putAB(abk); releaseWake();
    if (job.hardStop) Tts.kill();
    Job.cur = null; emit();
  }
  return abk;
}
PXA.stats = {synth: 0, chapters: 0};

function stopJob(hard){ if (Job.cur){ Job.cur.abort = true; if (hard) Job.cur.hardStop = true; emit(); } }

async function createAudiobook(book, sel, cfg){
  const old = await getAB(book.meta.id), m = await Model.loadManifest();
  const abk = Object.assign({}, old || {}, {
    id: book.meta.id, title: book.meta.title, author: book.meta.author || '', createdAt: (old && old.createdAt) || now(), status: 'idle', modelId: m.id + '@' + m.version,
    voice: cfg.voice, speed: cfg.speed, paraPause: cfg.paraPause, headPause: cfg.headPause, skipFootnotes: cfg.skipFootnotes, storage: Store.mode(), lastError: ''
  });
  const prev = (old && old.chapters) || [];
  abk.chapters = book.groups.map((g, n) => Object.assign({n, title: g.title, status: 'pending', fp: '', nChunks: 0, done: 0, failed: 0, secs: 0, bytes: 0, problem: ''}, prev[n] && prev[n].title === g.title ? prev[n] : {}, {selected: sel.includes(n)}));
  abk.lastPos = abk.lastPos || {n: 0, t: 0};
  await putAB(abk); return abk;
}

/* a job that was running when the app closed cannot still be running: mark it so the user can resume */
async function recoverInterrupted(){
  for (const a of await DB.all('ab_books')){ if (!Job.cur && (a.status === 'running' || a.chapters.some(c => c.status === 'running'))){ if (a.status === 'running') a.status = 'interrupted'; a.chapters.forEach(c => { if (c.status === 'running') c.status = 'pending'; }); await putAB(a); } }
}

/* ======================================================= export ======================================================= */
function download(blob, name){
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
const chapterFileName = (abk, n) => T.safeName(abk.title, 60) + ' - ' + String(n + 1).padStart(2, '0') + ' ' + T.safeName(abk.chapters[n].title, 60) + '.wav';
async function exportChapter(bookId, n){
  const abk = await getAB(bookId), f = abk && await Store.get(audioPath(bookId, n));
  if (!f || f.size < 45) return toast('This chapter\u2019s audio file is missing. Regenerate the chapter.');
  download(f, chapterFileName(abk, n));
}
async function exportWhole(bookId){
  const abk = await getAB(bookId); if (!abk) return;
  const done = abk.chapters.map((c, n) => ({c, n})).filter(x => x.c.status === 'done'), files = [];
  let data = 0;
  for (const {n} of done){ const f = await Store.get(audioPath(bookId, n)); if (!f || f.size < 45) return toast('Chapter ' + (n + 1) + '\u2019s audio file is missing. Regenerate it first.'); files.push(f); data += f.size - 44; }
  if (!files.length) return toast('No finished chapters to export yet.');
  if (data > 4e9) return toast('The whole book is too large for one WAV file (over 4 GB). Export the chapters one by one.');
  download(new Blob([wavHeader(data), ...files.map(f => f.slice(44))], {type: 'audio/wav'}), T.safeName(abk.title, 80) + ' (audiobook).wav');   // files are referenced, not copied into memory
}

/* ======================================================= deleting ======================================================= */
async function deleteAudiobook(bookId){
  if (Job.cur && Job.cur.bookId === bookId) stopJob(true);
  await sleep(0);
  await Store.delPrefix('audio/' + bookId + '/'); await Store.delPrefix(tmpDir(bookId));
  for (const r of await DB.all('ab_chunks')) if (r.id.startsWith(bookId + '|')) await DB.del('ab_chunks', r.id);
  await DB.del('ab_books', bookId);
  for (const k of [...prepCache.keys()]) if (k.startsWith(bookId + '|')) prepCache.delete(k);
  if (Play.bookId === bookId) Play.unload();
}

/* ======================================================= player ======================================================= */
const Play = {
  a: null, bookId: null, abk: null, n: 0, url: '', lastSave: 0, sleepT: null, sleepEnd: false, sleepLabel: 'off', missing: false, speed: 1, vol: 1,
  el(){
    if (this.a) return this.a;
    const a = this.a = new Audio(); a.preload = 'metadata';
    a.addEventListener('timeupdate', () => { this.tick(); });
    a.addEventListener('ended', () => this.ended());
    a.addEventListener('seeked', () => this.save(true));                 // a position chosen while paused must be kept too
    a.addEventListener('pause', () => { this.save(true); renderPlayLive(); });
    a.addEventListener('play', () => renderPlayLive());
    a.addEventListener('error', () => { if (this.url){ this.missing = true; renderPlay(); } });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(true); });
    addEventListener('pagehide', () => this.save(true));
    return a;
  },
  async open(bookId, n, t, autoplay){
    const abk = await getAB(bookId); if (!abk) return false;
    this.abk = abk; this.bookId = bookId; this.speed = this.speed || 1;
    const doneN = abk.chapters.findIndex(c => c.status === 'done'); if (doneN < 0){ toast('Nothing has been generated for this book yet.'); return false; }
    if (n == null){ n = abk.lastPos && abk.chapters[abk.lastPos.n] && abk.chapters[abk.lastPos.n].status === 'done' ? abk.lastPos.n : doneN; t = t != null ? t : (abk.lastPos ? abk.lastPos.t : 0); }
    return this.load(n, t || 0, autoplay);
  },
  async load(n, t, autoplay){
    const a = this.el(); this.unloadUrl(); this.missing = false; this.n = n;
    const f = await Store.get(audioPath(this.bookId, n));
    if (!f || f.size < 45){ this.missing = true; this.url = ''; renderPlay(); return false; }
    this.url = URL.createObjectURL(f); a.src = this.url; a.playbackRate = this.speed; a.preservesPitch = true; a.volume = this.vol;
    await new Promise(res => { const ok = () => { a.removeEventListener('loadedmetadata', ok); res(); }; a.addEventListener('loadedmetadata', ok); setTimeout(res, 4000); });
    if (t > 0 && isFinite(a.duration) && t < a.duration - 1) a.currentTime = t;
    if (autoplay){ try { await a.play(); } catch(e){} }
    this.media(); renderPlay(); return true;
  },
  unloadUrl(){ if (this.url){ try { URL.revokeObjectURL(this.url); } catch(e){} this.url = ''; } },
  unload(){ if (this.a){ this.a.pause(); this.a.removeAttribute('src'); this.a.load(); } this.unloadUrl(); this.bookId = null; this.abk = null; clearTimeout(this.sleepT); },
  tick(){
    const a = this.a; if (!a) return;
    if (now() - this.lastSave > 5000) this.save(false);
    renderPlayLive();
  },
  save(force){
    if (!this.abk || !this.a || !this.url) return; this.lastSave = now();
    this.abk.lastPos = {n: this.n, t: this.a.currentTime || 0};
    DB.get('ab_books', this.bookId).then(r => { if (r){ r.lastPos = this.abk.lastPos; r.updatedAt = now(); return DB.put('ab_books', r); } }).catch(() => {});
  },
  nextDone(from, dir){ const cs = this.abk.chapters; for (let i = from + dir; i >= 0 && i < cs.length; i += dir) if (cs[i].status === 'done') return i; return -1; },
  async ended(){
    if (this.sleepEnd){ this.sleepEnd = false; this.sleepLabel = 'off'; renderPlay(); toast('Sleep timer: stopped at the end of the chapter'); return; }
    const nx = this.nextDone(this.n, 1);
    if (nx >= 0) await this.load(nx, 0, true);
    else { this.abk.lastPos = {n: this.n, t: 0}; this.save(true); renderPlay(); }
  },
  async step(dir){ const nx = this.nextDone(this.n, dir); if (nx >= 0) await this.load(nx, 0, !this.a.paused); else if (dir < 0 && this.a) this.a.currentTime = 0; },
  toggle(){ const a = this.el(); if (!this.url) return; a.paused ? a.play().catch(() => {}) : a.pause(); },
  seekBy(s){ const a = this.el(); if (isFinite(a.duration)) a.currentTime = Math.max(0, Math.min(a.duration, a.currentTime + s)); },
  setSpeed(x){ this.speed = x; if (this.a) this.a.playbackRate = x; renderPlay(); },
  setSleep(mode){
    clearTimeout(this.sleepT); this.sleepEnd = false; this.sleepLabel = mode;
    if (mode === 'chapter') this.sleepEnd = true;
    else if (mode !== 'off') this.sleepT = setTimeout(() => { if (this.a) this.a.pause(); this.sleepLabel = 'off'; renderPlay(); toast('Sleep timer: paused'); }, +mode * 60000);
    renderPlay();
  },
  media(){
    if (!('mediaSession' in navigator) || !this.abk) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({title: this.abk.chapters[this.n].title, artist: this.abk.author || 'PixaRead', album: this.abk.title});
      navigator.mediaSession.setActionHandler('play', () => this.a.play()); navigator.mediaSession.setActionHandler('pause', () => this.a.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => this.step(-1)); navigator.mediaSession.setActionHandler('nexttrack', () => this.step(1));
      navigator.mediaSession.setActionHandler('seekbackward', () => this.seekBy(-15)); navigator.mediaSession.setActionHandler('seekforward', () => this.seekBy(30));
    } catch(e){}
  }
};

/* ======================================================= screens ======================================================= */
const UI = {quick: false, genBook: null, genCfg: null, genSel: null, modelBusy: null, preview: null, previewMsg: '', model: null, openNote: ''};
const defaultCfg = () => ({voice: 'af_heart', speed: 1, paraPause: 0.7, headPause: 1.0, skipFootnotes: false});
const hdr = (title, extra) => `<header class="hdr"><button class="ib" data-act="back" aria-label="Back">${ic('back')}</button><h1>${esc(title)}</h1>${extra || ''}</header>`;
const SEP = '<p class="note" style="margin-top:12px">Audiobooks are real audio files made on this device by an AI voice. They are separate from the <b>Read aloud</b> button in the reader, which uses your phone\u2019s built-in voices and makes no files.</p>';

/* ---- model card (shared by the library and the generator) ---- */
function modelCard(compact){
  const prob = envProblem(), s = UI.model;
  let body = '';
  if (prob) body = `<p class="note">${esc(prob)}</p><p class="note">The reader and the Read aloud button still work normally.</p>`;
  else if (!s) body = '<p class="note">Checking the voice model\u2026</p>';
  else if (UI.modelBusy){
    const b = UI.modelBusy;
    body = `<div class="lbl" id="ab-m-step">${esc(b.step || 'Working\u2026')}</div><div class="barrow" style="margin:8px 0"><span class="bar"><i id="ab-m-bar" style="width:${Math.round((b.frac || 0) * 100)}%"></i></span><span class="pct" id="ab-m-pct">${Math.round((b.frac || 0) * 100)}%</span></div>${b.verifying ? '' : '<button class="btn wide" data-ab="model-cancel">Cancel</button>'}`;
  }
  else if (s.state === 'ready') body = `<p class="note"><b>Ready for offline use.</b> The voice model is stored on this device (${MB(s.total)}). ${s.rec && s.rec.rtf ? 'Measured speed on this device: about ' + (s.rec.rtf >= 1 ? s.rec.rtf.toFixed(1) + '\u00D7 faster than' : (1 / s.rec.rtf).toFixed(1) + '\u00D7 slower than') + ' real time.' : ''}</p>${compact ? '' : '<button class="btn wide danger" data-ab="model-remove">Remove voice model</button>'}`;
  else if (s.state === 'evicted') body = `<p class="note"><b>Some voice model files are missing</b> (${esc(s.missing.join(', '))}). The browser may have cleared them to free space. Connect to the internet and restore them; your finished audiobooks are not affected.</p><button class="btn solid wide" data-ab="model-get">Restore voice model</button>`;
  else if (s.state === 'partial') body = `<p class="note">The download stopped at ${MB(s.have)} of ${MB(s.total)}. It will continue where it stopped.</p><button class="btn solid wide" data-ab="model-get">Continue download</button>`;
  else body = `<p class="note">To make audiobooks, PixaRead needs a voice model. This is a <b>one-time download of about ${MB(s.total)}</b> and needs an internet connection once. After that, audiobooks are made on this device without internet. Keep the app open and use Wi-Fi.</p>${(navigator.deviceMemory && navigator.deviceMemory < 4) ? `<p class="note">This device reports ${navigator.deviceMemory} GB of memory. The voice engine needs roughly 0.6 GB while it works, so it may be slow or stop on this device.</p>` : ''}<button class="btn solid wide" data-ab="model-get">Download voice model</button>`;
  if (UI.model && UI.model.error && !UI.modelBusy) body += `<p class="note" style="color:var(--fg)"><b>${esc(UI.model.error)}</b></p>`;
  return `<div class="sec">[ Voice model ]</div><div id="ab-model">${body}</div>`;
}
async function refreshModel(rerender){
  if (envProblem()){ UI.model = null; if (rerender) rerender(); return; }
  try { const err = UI.model && UI.model.error; UI.model = await Model.status(); if (err) UI.model.error = err; } catch(e){ UI.model = {state: 'missing', total: 0, have: 0, files: [], error: String(e.message || e)}; }
  if (rerender) rerender();
}
let dlCtl = null;
async function modelGet(rerender){
  UI.modelBusy = {step: 'Starting\u2026', frac: 0}; UI.model && (UI.model.error = ''); rerender();
  dlCtl = new AbortController(); let last = 0;
  try {
    await Model.download({signal: dlCtl.signal, onProgress: (done, total, name) => {
      UI.modelBusy.step = 'Downloading ' + name + ' \u00B7 ' + MB(done) + ' of ' + MB(total); UI.modelBusy.frac = done / total;
      if (now() - last > 200){ last = now(); const bar = $('#ab-m-bar'), pct = $('#ab-m-pct'), st = $('#ab-m-step'); if (bar) bar.style.width = Math.round(UI.modelBusy.frac * 100) + '%'; if (pct) pct.textContent = Math.round(UI.modelBusy.frac * 100) + '%'; if (st) st.textContent = UI.modelBusy.step; }
    }});
    UI.modelBusy = {step: 'Checking files\u2026', frac: 1, verifying: true}; rerender();
    await Model.verify({onStep: s => { UI.modelBusy.step = s; const st = $('#ab-m-step'); if (st) st.textContent = s; }});
    toast('Voice model ready for offline use');
  } catch(e){
    const msg = e.name === 'AbortError' ? 'Download paused. Tap Continue to resume.' : (e.quota ? 'There is not enough free storage for the voice model (about ' + MB((UI.model && UI.model.total) || 0) + ' needed).' : String(e.message || e));
    UI.model = Object.assign(UI.model || {}, {error: msg});
  } finally { UI.modelBusy = null; dlCtl = null; await refreshModel(rerender); }
}

/* ---- audiobook library ---- */
async function renderAudio(){
  const el = $('#s-audio'); if (!el) return;
  let list = []; try { list = (await DB.all('ab_books')).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); } catch(e){}
  const si = await storageInfo(), used = await Store.bytesUnder('audio/');
  const books = PX.getBooks();
  const rows = list.map(a => {
    const b = books.find(x => x.id === a.id), done = a.chapters.filter(c => c.status === 'done').length, total = a.chapters.filter(c => c.selected !== false || c.status === 'done').length;
    const secs = a.chapters.reduce((n, c) => n + (c.status === 'done' ? c.secs : 0), 0), v = voiceById(a.voice);
    const job = Job.cur && Job.cur.bookId === a.id, st = job ? 'Making\u2026' : ({done: 'Complete', paused: 'Paused', interrupted: 'Interrupted', error: 'Needs attention', idle: 'Not started', running: 'Interrupted'})[a.status] || a.status;
    const pos = a.lastPos && a.lastPos.t > 5 ? ` \u00B7 stopped at chapter ${a.lastPos.n + 1}, ${clock(a.lastPos.t)}` : '';
    return `<div class="abrow" data-id="${esc(a.id)}"><div class="abtop">${b ? PX.cover(b, 'lg') : `<span class="cover art lg" style="display:grid;place-items:center">${ic('phones', 4)}</span>`}<div class="abinfo"><span class="t">${esc(a.title)}</span><span class="lbl">${esc(st)} \u00B7 ${done}/${total} chapters</span><span class="lbl">${esc(v.name)} \u00B7 ${v.accent === 'UK' ? 'British' : 'American'} English${secs ? ' \u00B7 ' + human(secs) : ''}${pos}</span>${a.lastError && a.status === 'error' ? `<span class="lbl" style="color:var(--fg)">${esc(a.lastError)}</span>` : ''}</div></div>
      <div class="trio" style="margin-top:8px">${done ? `<button class="btn solid" data-ab="listen" data-id="${esc(a.id)}">${ic('play', 2)} Listen</button>` : ''}<button class="btn" data-ab="gen" data-id="${esc(a.id)}">${a.status === 'done' ? 'Settings' : a.status === 'idle' ? 'Generate' : 'Resume'}</button>${done ? `<button class="btn" data-ab="export-all" data-id="${esc(a.id)}">Export book</button>` : ''}<button class="btn danger" data-ab="delete" data-id="${esc(a.id)}">${ic('trash', 2)} Delete</button></div></div>`;
  }).join('');
  el.innerHTML = hdr('Audiobooks') + `<div class="scroll"><div class="sec">[ Quick listen ]</div><p class="note">Starts instantly. Uses your phone's own voices, the same as Read aloud. Nothing to download, but it is not saved as an audio file, and it usually stops if the screen locks.</p><button class="btn solid wide" data-ab="quick">${ic('play', 2)} Quick listen to a book</button><div class="sec">[ Advanced voice ]</div><p class="note">A realistic AI voice made on this device. Slow (expect hours for a whole book), but the audio is saved and works offline.</p>${modelCard()}
    <div class="sec">[ My audiobooks ]</div>${rows || '<p class="note">No audiobooks yet. Choose a book to make one.</p>'}
    <button class="btn solid wide" style="margin-top:12px" data-ab="new">${ic('plus', 2)} New audiobook</button>
    <div class="sec">[ Storage ]</div><dl class="dl" style="margin-top:0"><dt>Audio on this device</dt><dd>${fmtBytes(used)}</dd><dt>Free space (browser quota)</dt><dd>${si.quota ? fmtBytes(Math.max(0, si.quota - si.usage)) : 'unknown'}</dd><dt>Stored in</dt><dd>${Store.mode() === 'opfs' ? 'private browser files' : 'browser database'}</dd><dt>Protected from clean-up</dt><dd>${si.persisted ? 'yes' : 'not guaranteed'}</dd></dl>
    <p class="note">Browsers decide how much space a site may use and can clear it when the phone is short of space, unless storage is marked as persistent. Export the audio you care about.</p>
    ${list.length ? '<button class="btn wide danger" data-ab="delete-all">Delete all generated audio</button>' : ''}${SEP}</div>`;
}

/* ---- generator ---- */
const SPEEDS = [0.9, 1, 1.1];
const PAUSES = [['Short', 0.4], ['Normal', 0.7], ['Long', 1.0]];
async function openGenerator(bookId){
  UI.genBook = null; UI.preview = null; UI.previewMsg = '';
  const book = await loadBook(bookId); if (!book){ toast('That book could not be opened.'); return; }
  const abk = await getAB(bookId);
  UI.genBook = book;
  UI.genCfg = abk ? {voice: abk.voice, speed: abk.speed, paraPause: abk.paraPause, headPause: abk.headPause, skipFootnotes: abk.skipFootnotes} : defaultCfg();
  UI.genSel = new Set(abk ? abk.chapters.filter(c => c.selected !== false).map(c => c.n) : book.groups.map((g, i) => i));
  PX.go('abgen');
}
async function renderGen(){
  const el = $('#s-abgen'); if (!el) return;
  const book = UI.genBook; if (!book){ el.innerHTML = hdr('Audiobook') + '<div class="scroll"><p class="note">Choose a book first.</p></div>'; return; }
  const cfg = UI.genCfg, abk = await getAB(book.meta.id), job = Job.cur && Job.cur.bookId === book.meta.id;
  const o = {skipFootnotes: cfg.skipFootnotes, paraPause: cfg.paraPause, headPause: cfg.headPause};
  const prepared = book.groups.map((g, n) => prepare(book, n, o));
  const ln = languageNote(book), ready = UI.model && UI.model.state === 'ready';
  const sel = [...UI.genSel].filter(n => n < book.groups.length).sort((a, b) => a - b);
  const selChars = sel.reduce((n, i) => n + prepared[i].chars, 0), selChunks = sel.flatMap(i => prepared[i].chunks);
  const secs = T.estimateSeconds(selChunks, cfg.speed), rtf = ready && UI.model.rec && UI.model.rec.rtf, bytes = secs * SR * 2;
  const si = await storageInfo(), lowSpace = si.quota && bytes * 1.15 > si.quota - si.usage;
  const stats = prepared.reduce((a, p) => { for (const k in p.stats) a[k] = (a[k] || 0) + p.stats[k]; return a; }, {});
  const skipNotes = [stats.code ? stats.code + ' code listing(s) are left out (they cannot be read aloud)' : '', stats.images ? stats.images + ' picture(s) cannot be read; their captions are' : '', stats.skippedFootnotes ? stats.skippedFootnotes + ' footnote(s) skipped by your choice' : ''].filter(Boolean);
  const chRows = book.groups.map((g, n) => {
    const p = prepared[n], on = UI.genSel.has(n), rec = abk && abk.chapters[n], st = rec ? ({done: 'Done', error: 'Failed passages', running: 'In progress', empty: 'Nothing to read', pending: ''})[rec.status] || '' : '';
    return `<div class="li"><button class="main" data-ab="toggle-ch" data-n="${n}" aria-pressed="${on}" ${p.problem ? 'style="opacity:.7"' : ''}><span class="t">${on ? '[x]' : '[ ]'} ${n + 1}. ${esc(g.title)}</span><span class="lbl">${p.problem ? esc(p.problem) : human(T.estimateSeconds(p.chunks, cfg.speed)) + ' \u00B7 ' + Math.round(p.chars / 1000 * 10) / 10 + 'k characters'}${st ? ' \u00B7 ' + esc(st) : ''}${rec && rec.status === 'error' ? ` \u00B7 ${rec.failed} failed` : ''}</span></button>${rec && rec.status === 'error' ? `<button class="ib plain" data-ab="retry" data-n="${n}" aria-label="Retry failed passages" style="width:auto;padding:0 8px">Retry</button>` : ''}</div>`;
  }).join('');
  const prog = job ? progressHtml(book.meta.id) : '';
  const vopts = VOICES.map(v => `<option value="${v.id}" ${v.id === cfg.voice ? 'selected' : ''}>${esc(voiceLabel(v))} (quality ${v.grade})</option>`).join('');
  const canGo = ready && sel.length && !job && !(ln && ln.block) && !lowSpace;
  el.innerHTML = hdr('Audiobook') + `<div class="scroll"><div class="dhero" style="margin-bottom:8px">${PX.cover(book.meta, 'lg')}<div class="rinfo"><span class="t">${esc(book.meta.title)}</span>${book.meta.author ? `<span class="a">${esc(book.meta.author)}</span>` : ''}<span class="lbl">${book.groups.length} chapters</span></div></div>
    ${ln ? `<p class="note"><b>${esc(ln.text)}</b></p>` : ''}
    ${modelCard(true)}
    <div class="sec">[ 1 \u00B7 Chapters ]</div>
    <div class="trio" style="margin-bottom:6px"><button class="btn" data-ab="all">Select all</button><button class="btn" data-ab="none">Select none</button></div>${chRows}
    ${skipNotes.length ? `<p class="note">${esc(skipNotes.join('. '))}.</p>` : ''}
    <div class="sec">[ 2 \u00B7 Voice ]</div>
    <select class="sinput" id="ab-voice" aria-label="Voice" style="width:100%;min-height:48px">${vopts}</select>
    <p class="note">English voices only. Quality grades are the model\u2019s own; A is the most natural.</p>
    <div class="lbl" style="margin:8px 0 4px">Speaking speed</div><div class="seg" style="--c:3">${SPEEDS.map(s => `<button data-ab="speed" data-v="${s}" aria-pressed="${s === cfg.speed}">${s === 1 ? 'Normal' : s < 1 ? 'Slower' : 'Faster'}</button>`).join('')}</div>
    <div class="lbl" style="margin:8px 0 4px">Pause between paragraphs</div><div class="seg" style="--c:3">${PAUSES.map(([l, v]) => `<button data-ab="ppause" data-v="${v}" aria-pressed="${v === cfg.paraPause}">${l}</button>`).join('')}</div>
    <div class="lbl" style="margin:8px 0 4px">Footnotes</div><div class="seg" style="--c:2"><button data-ab="foot" data-v="0" aria-pressed="${!cfg.skipFootnotes}">Read them</button><button data-ab="foot" data-v="1" aria-pressed="${cfg.skipFootnotes}">Skip them</button></div>
    <div class="sec">[ 3 \u00B7 Preview ]</div>
    <button class="btn wide" data-ab="preview" ${ready ? '' : 'disabled style="opacity:.5"'}>${ic('play', 2)} Hear this voice</button><p class="note" id="ab-prev-msg">${esc(UI.previewMsg || (ready ? 'Plays a short sentence with the chosen voice and speed.' : 'Download the voice model first.'))}</p>
    <div class="sec">[ 4 \u00B7 Generate ]</div>
    <dl class="dl" style="margin-top:0"><dt>Selected</dt><dd>${sel.length} of ${book.groups.length} chapters</dd><dt>Narration length</dt><dd>about ${human(secs)}</dd><dt>File size (WAV)</dt><dd>about ${fmtBytes(bytes)}</dd><dt>Time to make</dt><dd>${rtf ? 'about ' + human(secs / rtf) : 'not measured yet'}</dd></dl>
    <p class="note">${rtf ? 'Based on the speed measured on this device when the model was checked.' : ''} Output: one 24 kHz mono WAV file per chapter. Keep the app open and the screen on; mobile browsers can pause apps that run in the background. Progress is saved, so you can resume anytime.</p>
    ${lowSpace ? `<p class="note"><b>There may not be enough free storage for this selection (${fmtBytes(Math.max(0, si.quota - si.usage))} free). Select fewer chapters or free some space.</b></p>` : ''}
    ${abk && abk.lastError && !job ? `<p class="note"><b>${esc(abk.lastError)}</b></p>` : ''}
    ${prog}
    ${job ? '' : `<button class="btn solid wide" data-ab="start" ${canGo ? '' : 'disabled style="opacity:.5"'}>${abk && abk.chapters.some(c => c.status === 'done') ? 'Generate / resume' : 'Generate audiobook'}</button>`}
    ${abk && abk.chapters.some(c => c.status === 'done') ? `<div class="trio" style="margin-top:8px"><button class="btn" data-ab="listen" data-id="${esc(book.meta.id)}">${ic('play', 2)} Listen</button><button class="btn" data-ab="export-all" data-id="${esc(book.meta.id)}">Export book</button></div>` : ''}
    ${SEP}</div>`;
}
function progressHtml(bookId){
  const j = Job.cur; if (!j || j.bookId !== bookId) return '';
  const abk = UI.abkLive, ch = abk && abk.chapters[j.n];
  const frac = j.nChunks ? (j.k + 0) / j.nChunks : 0, rate = j.audioSecs / Math.max(1, (now() - j.wall0) / 1000), eta = rate > 0 && j.spc ? (j.remainChars * j.spc) / rate : 0;
  return `<div id="ab-prog"><div class="lbl">${j.abort ? 'Stopping after this passage\u2026' : esc(j.phase)}${j.n >= 0 ? ' \u00B7 chapter ' + (j.n + 1) + (ch ? ': ' + esc(ch.title) : '') : ''}</div>
    <div class="barrow" style="margin:8px 0"><span class="bar"><i id="ab-prog-bar" style="width:${Math.round(frac * 100)}%"></i></span><span class="pct" id="ab-prog-pct">${j.nChunks ? (j.k + 1) + '/' + j.nChunks : ''}</span></div>
    <p class="note" id="ab-prog-note">${rate > 0 ? 'Speed: ' + (rate >= 1 ? rate.toFixed(1) + '\u00D7 faster than' : (1 / rate).toFixed(1) + '\u00D7 slower than') + ' real time. ' : ''}${eta ? 'About ' + human(eta) + ' left.' : 'Working out the time left\u2026'}</p>
    <div class="trio"><button class="btn" data-ab="pause" ${j.abort ? 'disabled' : ''}>Pause</button><button class="btn danger" data-ab="stop" ${j.abort ? 'disabled' : ''}>Cancel</button></div></div>`;
}

/* ---- player screen ---- */
/* ---- player: icons, styles, full screen, mini bar ---- */
const SV = (d, x) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">${d}${x || ''}</svg>`;
const NUM = n => `<text x="12" y="16.5" font-size="7" text-anchor="middle" font-weight="700">${n}</text>`;
const I = {play: SV('<path d="M8 5v14l11-7z"/>'), pause: SV('<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>'), prev: SV('<path d="M6 6h2v12H6zM9.5 12l8.5 6V6z"/>'), next: SV('<path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/>'),
  b15: SV('<path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/>', NUM(15)), f30: SV('<path d="M12 5V1l5 5-5 5V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z"/>', NUM(30)),
  down: SV('<path d="M7.4 9.6 12 14.2l4.6-4.6 1.4 1.4-6 6-6-6z"/>'), x: SV('<path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z"/>'),
  vol: SV('<path d="M3 9v6h4l5 5V4L7 9zM15.5 8.5a5 5 0 0 1 0 7l-1.4-1.4a3 3 0 0 0 0-4.2z"/>')};
document.head.insertAdjacentHTML('beforeend', `<style id="ab-style">
.abp{padding-bottom:32px;text-align:center}.abp-art{width:min(70vw,300px);margin:8px auto 18px;border:2px solid var(--fg);box-shadow:6px 6px 0 var(--fg);background:var(--faint)}
.abp-art .cover{display:block;width:100%;height:auto;aspect-ratio:1}.abp-art svg,#abm-art svg{display:block;width:100%;height:100%}
.abp-info h2{margin:0 0 4px;font:600 1.25rem/1.25 var(--f-serif)}.abp-info p{margin:2px 0;color:var(--mid)}
.abp-seek{margin-top:16px;margin-bottom:4px}.abp-seek div{display:flex;justify-content:space-between;font:12px var(--f-mono);color:var(--mid)}
.abp input[type=range],#abm input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:28px;background:none;margin:0;--p:0%;cursor:pointer}
.abp input[type=range]::-webkit-slider-runnable-track{height:6px;background:linear-gradient(to right,var(--fg) var(--p),var(--faint) var(--p))}
.abp input[type=range]::-moz-range-track{height:6px;background:linear-gradient(to right,var(--fg) var(--p),var(--faint) var(--p))}
.abp input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;margin-top:-6px;border-radius:50%;background:var(--fg);border:2px solid var(--bg)}
.abp input[type=range]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:var(--fg);border:2px solid var(--bg)}
.abp-ctl{display:flex;align-items:center;justify-content:center;gap:clamp(6px,3vw,18px);margin-top:10px;margin-bottom:10px}
.abp-ctl button,#abm button{flex:none;background:none;border:0;color:var(--fg);cursor:pointer;display:grid;place-items:center;width:48px;height:48px;border-radius:50%}
.abp-ctl button:active,#abm button:active{background:var(--faint)}.abp-ctl svg{width:28px;height:28px}
.abp-ctl .abp-pp{width:68px;height:68px;background:var(--fg);color:var(--bg)}.abp-ctl .abp-pp:active{background:var(--mid)}.abp-ctl .abp-pp svg{width:34px;height:34px}
.abp-opt{display:flex;align-items:center;gap:10px;margin-top:6px;margin-bottom:14px}.abp-vol{flex:1;display:flex;align-items:center;gap:6px;color:var(--mid)}.abp-vol svg{width:20px;height:20px;flex:none}
.chip{font:11px var(--f-label);text-transform:uppercase;letter-spacing:.04em;padding:9px 12px;border:var(--bw) solid var(--fg);background:var(--bg);color:var(--fg);border-radius:999px;cursor:pointer;white-space:nowrap}.chip:active{background:var(--faint)}
.abp .li{text-align:left}
#abm{position:fixed;left:0;right:0;bottom:0;z-index:48;display:flex;align-items:center;gap:2px;padding:8px 8px calc(8px + env(safe-area-inset-bottom,0px));background:var(--bg);border-top:var(--bw) solid var(--fg);transition:transform .25s}
#abm[hidden]{display:none}#abm-seek{position:absolute;left:0;right:0;top:-9px;height:18px;cursor:pointer;touch-action:none}
#abm-seek::before{content:'';position:absolute;left:0;right:0;top:7px;height:4px;background:var(--faint)}#abm-fill{position:absolute;left:0;top:7px;height:4px;background:var(--fg)}
#abm .abm-main{flex:1;min-width:0;width:auto;height:auto;display:flex;align-items:center;gap:10px;justify-content:flex-start;text-align:left;border-radius:0;padding:0}
#abm-art{flex:none;width:44px;height:44px;border:1px solid var(--fg);overflow:hidden}#abm-art .cover{display:block;width:100%;height:100%}
#abm-tx{min-width:0;display:flex;flex-direction:column}#abm-t{font:600 .92rem/1.2 var(--f-serif);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#abm-s{font:11px var(--f-mono);color:var(--mid);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#abm button svg{width:24px;height:24px}#abm .abm-pp{background:var(--fg);color:var(--bg)}#abm .abm-pp:active{background:var(--mid)}
@media(max-width:380px){#abm [data-m=prev]{display:none}}body.abm-on .scroll{padding-bottom:84px}
.abp>*{box-sizing:border-box;width:100%;max-width:520px;margin-left:auto;margin-right:auto}.abp>.abp-art{width:min(70vw,300px)}
@media(min-width:760px){#abm{padding-left:max(8px,calc(50% - 450px));padding-right:max(8px,calc(50% - 450px))}}
@media(prefers-reduced-motion:reduce){#abm{transition:none}}</style>`);
const nextOf = (arr, v) => arr[(arr.indexOf(v) + 1) % arr.length];
const setP = (el, f) => { if (el) el.style.setProperty('--p', (Math.max(0, Math.min(1, f || 0)) * 100) + '%'); };
let renderPlayBusy = false;
async function renderPlay(){
  const el = $('#s-aplay'); if (!el) return;
  const abk = Play.abk; if (!abk){ el.innerHTML = hdr('Listen') + '<div class="scroll"><p class="note">Nothing is playing. Choose an audiobook from the list.</p></div>'; return; }
  const a = Play.el(), ch = abk.chapters[Play.n], b = PX.getBooks().find(x => x.id === abk.id);
  const speeds = [0.75, 1, 1.25, 1.5, 2], sleeps = ['off', '15', '30', '60', 'chapter'], sl = {off: 'Sleep: off', 15: 'Sleep 15 min', 30: 'Sleep 30 min', 60: 'Sleep 60 min', chapter: 'Sleep: end of chapter'};
  const list = abk.chapters.map((c, n) => c.status === 'done' ? `<div class="li"><button class="main" data-ab="play-ch" data-n="${n}"><span class="t">${n === Play.n ? '\u25B6 ' : ''}${n + 1}. ${esc(c.title)}</span><span class="lbl">${clock(c.secs)}</span></button></div>` : '').join('');
  el.innerHTML = `<header class="hdr"><button class="ib" data-act="back" aria-label="Minimize player">${I.down}</button><h1>Now playing</h1></header><div class="scroll abp">
    <div class="abp-art">${b ? PX.cover(b, 'lg') : ''}</div>
    <div class="abp-info"><h2>${esc(ch.title)}</h2><p>${esc(abk.title)}${abk.author ? ' \u00B7 ' + esc(abk.author) : ''}</p><p class="lbl">Chapter ${Play.n + 1} of ${abk.chapters.length} \u00B7 <span id="ab-p-tot">${clock(ch.secs)}</span> long</p></div>
    ${Play.missing ? `<p class="note"><b>This chapter\u2019s audio file is missing or cannot be played.</b> The browser may have cleared it.</p><button class="btn solid wide" data-ab="regen" data-n="${Play.n}">Regenerate this chapter</button>` : `
    <div class="abp-seek"><input type="range" id="ab-seek" min="0" max="1000" value="0" step="1" aria-label="Seek"><div><span id="ab-p-cur">0:00</span><span id="ab-p-rem">-0:00</span></div></div>
    <div class="abp-ctl"><button data-ab="prev" aria-label="Previous chapter">${I.prev}</button><button data-ab="back15" aria-label="Back 15 seconds">${I.b15}</button><button class="abp-pp" id="ab-pp" data-ab="toggle" aria-label="Play or pause"></button><button data-ab="fwd30" aria-label="Forward 30 seconds">${I.f30}</button><button data-ab="next" aria-label="Next chapter">${I.next}</button></div>
    <div class="abp-opt"><button class="chip" data-ab="pspeed" data-v="${nextOf(speeds, Play.speed)}" aria-label="Playback speed">${Play.speed}x</button><label class="abp-vol" aria-label="Volume">${I.vol}<input type="range" id="ab-vol" min="0" max="100" value="${Math.round(Play.vol * 100)}"></label><button class="chip" data-ab="sleep" data-v="${nextOf(sleeps, Play.sleepLabel)}">${sl[Play.sleepLabel]}</button></div>
    <button class="btn wide" data-ab="export-ch" data-n="${Play.n}">Export this chapter</button>`}
    <div class="sec">[ Chapters ]</div>${list}</div>`;
  const sk = $('#ab-seek'); if (sk){ sk.oninput = () => { if (isFinite(a.duration)) a.currentTime = a.duration * sk.value / 1000; setP(sk, sk.value / 1000); }; }
  const vol = $('#ab-vol'); if (vol){ setP(vol, Play.vol); vol.oninput = () => { Play.vol = vol.value / 100; a.volume = Play.vol; setP(vol, Play.vol); }; }
  renderPlayLive();
}
function renderPlayLive(){
  const a = Play.a; mini(); if (!a || !$('#s-aplay') || $('#s-aplay').hidden) return;
  const cur = $('#ab-p-cur'), rem = $('#ab-p-rem'), sk = $('#ab-seek'), pp = $('#ab-pp'), tot = $('#ab-p-tot'), ok = isFinite(a.duration) && a.duration > 0;
  if (cur) cur.textContent = clock(a.currentTime); if (rem && ok) rem.textContent = '-' + clock(a.duration - a.currentTime); if (tot && ok) tot.textContent = clock(a.duration);
  if (sk && document.activeElement !== sk && ok){ sk.value = Math.round(a.currentTime / a.duration * 1000); setP(sk, a.currentTime / a.duration); }
  if (pp){ const want = a.paused ? 'play' : 'pause'; if (pp.dataset.s !== want){ pp.dataset.s = want; pp.innerHTML = I[want]; } }
}
let CUR = '', miniKey = '';
function miniSrc(){
  if (UI.quick && Q.book){ const g = Q.book.groups[Q.n]; return {b: Q.book.meta, t: g.title, s: Q.book.meta.title, on: Q.on, f: Q.parts.length ? Q.i / Q.parts.length : 0}; }
  if (Play.abk && Play.url && !Play.missing && Play.a){ const a = Play.a; return {b: PX.getBooks().find(x => x.id === Play.abk.id), t: Play.abk.chapters[Play.n].title, s: Play.abk.title, on: !a.paused, f: a.duration > 0 ? a.currentTime / a.duration : 0}; }
  return null;
}
function mini(){
  const src = miniSrc(), show = !!src && !['aplay', 'reader'].includes(CUR); let m = $('#abm');
  if (!m){
    if (!show) return; m = document.createElement('div'); m.id = 'abm'; m.setAttribute('role', 'region'); m.setAttribute('aria-label', 'Audio player');
    m.innerHTML = `<div id="abm-seek"><i id="abm-fill"></i></div><button class="abm-main" data-m="open" aria-label="Open player"><span id="abm-art"></span><span id="abm-tx"><span id="abm-t"></span><span id="abm-s"></span></span></button><button data-m="prev" aria-label="Previous">${I.prev}</button><button class="abm-pp" id="abm-pp" data-m="pp" aria-label="Play or pause"></button><button data-m="next" aria-label="Next">${I.next}</button><button data-m="close" aria-label="Close player">${I.x}</button>`;
    document.body.appendChild(m);
    m.onclick = e => { const k = e.target.closest('[data-m]'); if (!k) return; const v = k.dataset.m, q = UI.quick;
      if (v === 'open') PX.go('aplay'); else if (v === 'pp') (q ? (Q.on ? Q.pause() : Q.play()) : Play.toggle());
      else if (v === 'prev') (q ? Q.go(-1) : Play.step(-1)); else if (v === 'next') (q ? Q.go(1) : Play.step(1));
      else if (v === 'close'){ if (q){ Q.stop(); UI.quick = false; Q.book = null; } else Play.unload(); mini(); } };
    const sk = $('#abm-seek'), at = e => { const r = sk.getBoundingClientRect(), a = Play.a; if (!UI.quick && a && isFinite(a.duration)) a.currentTime = a.duration * Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
    sk.onpointerdown = e => { at(e); try { sk.setPointerCapture(e.pointerId); } catch(x){} sk.onpointermove = at; }; sk.onpointerup = () => { sk.onpointermove = null; };
  }
  document.body.classList.toggle('abm-on', show); m.hidden = !show; if (!show) return;
  const key = src.t + '|' + (src.b && src.b.id); if (key !== miniKey){ miniKey = key; $('#abm-art').innerHTML = src.b ? PX.cover(src.b, 'sm') : ''; $('#abm-t').textContent = src.t; $('#abm-s').textContent = src.s; }
  $('#abm-fill').style.width = (Math.max(0, Math.min(1, src.f)) * 100) + '%'; const pp = $('#abm-pp'), w = src.on ? 'pause' : 'play'; if (pp.dataset.s !== w){ pp.dataset.s = w; pp.innerHTML = I[w]; }
}

/* ---- live progress while a job runs (no full re-render for every passage) ---- */
let liveT = 0;
Job.listeners.add(async () => {
  if (!$('#s-abgen') || $('#s-abgen').hidden){ if (!$('#s-audio').hidden && now() - liveT > 800){ liveT = now(); renderAudio(); } return; }
  const j = Job.cur;
  if (j && UI.genBook && j.bookId === UI.genBook.meta.id){
    UI.abkLive = await getAB(j.bookId);
    if (j.k > 0 && $('#ab-prog') && !j.abort && j.phase === 'narrating'){
      const bar = $('#ab-prog-bar'), pct = $('#ab-prog-pct'), note = $('#ab-prog-note');
      if (bar){ bar.style.width = Math.round((j.k / Math.max(1, j.nChunks)) * 100) + '%'; pct.textContent = (j.k + 1) + '/' + j.nChunks;
        const rate = j.audioSecs / Math.max(1, (now() - j.wall0) / 1000), eta = rate > 0 && j.spc ? (j.remainChars * j.spc) / rate : 0;
        note.textContent = (rate > 0 ? 'Speed: ' + (rate >= 1 ? rate.toFixed(1) + '\u00D7 faster than' : (1 / rate).toFixed(1) + '\u00D7 slower than') + ' real time. ' : '') + (eta ? 'About ' + human(eta) + ' left.' : ''); return; }
    }
  }
  if (now() - liveT > 400 || !j){ liveT = now(); renderGen(); }
});

/* ======================================================= events ======================================================= */
async function afterJob(bookId){ UI.abkLive = await getAB(bookId); }
async function startGeneration(){
  const book = UI.genBook, cfg = UI.genCfg; if (!book) return;
  const ln = languageNote(book);
  if (ln && !ln.block){ const ok = await dialog({title: 'Different language', body: esc(ln.text), actions: [{label: 'Cancel', key: 'no'}, {label: 'Make it anyway', key: 'yes', solid: true}]}); if (ok !== 'yes') return; }
  await requestPersistence(); await Store.init();
  const abk = await createAudiobook(book, [...UI.genSel].sort((a, b) => a - b), cfg);
  UI.abkLive = abk; renderGen();
  try { await runJob(book.meta.id); } catch(e){ toast(String(e.message || e)); }
  await afterJob(book.meta.id); renderGen(); const fin = await getAB(book.meta.id);
  if (fin && fin.status === 'done') toast('Audiobook ready');
}
async function chooseBook(cb = openGenerator){
  const books = PX.getBooks(); if (!books.length){ toast('Import a book first.'); return; }
  const rows = books.map((b, i) => `<button class="btn wide" data-k="b${i}" style="margin-bottom:8px;justify-content:flex-start;text-align:left">${esc(b.title)}</button>`).join('');
  const r = await PX.sheetUI(`<h2>Choose a book</h2><div class="dbody" style="max-height:50vh;overflow:auto">${rows}</div><button class="btn wide" data-k="cancel" style="margin-top:8px">Cancel</button>`);
  const m = r && /^b(\d+)$/.exec(r.key); if (m) cb(books[+m[1]].id);
}
/* ---- quick listen: reads the book with the phone's own voices (no model, no files) ---- */
const Q = {book: null, n: 0, i: 0, parts: [], on: false, id: 0, rate: 1, sleep: 0, st: null, wl: null,
  chap(n, i){ this.n = n; this.i = i || 0; this.parts = prepare(this.book, n, {skipFootnotes: true, paraPause: 0.7, headPause: 1}).chunks.map(c => c.t); this.save(); },
  save(){ try { localStorage.setItem('pxq:' + this.book.meta.id, JSON.stringify({n: this.n, i: this.i})); } catch(e){} },
  part(){ const el = $('#q-part'); if (el) el.textContent = 'Part ' + Math.min(this.i + 1, this.parts.length || 1) + ' of ' + (this.parts.length || 1); mini(); },
  speak(){
    const S = PX.speech; if (!S || !('speechSynthesis' in window)){ this.on = false; toast('Reading aloud is not supported on this device.'); renderQuick(); return; }
    const id = ++this.id; try { speechSynthesis.cancel(); } catch(e){}
    if (this.i >= this.parts.length){
      if (this.n + 1 < this.book.groups.length){ this.chap(this.n + 1, 0); renderQuick(); return this.speak(); }
      this.on = false; renderQuick(); toast('The end of the book'); return;
    }
    const lang = String(this.book.meta.lang || 'en'), u = new SpeechSynthesisUtterance(this.parts[this.i]), v = S.pick(lang);
    if (v) u.voice = v; u.lang = (v && v.lang) || lang; u.rate = this.rate; u.pitch = S.pitch();
    u.onend = () => { if (id === this.id && this.on){ this.i++; this.save(); this.part(); this.speak(); } };
    u.onerror = e => { if (id === this.id && e.error !== 'canceled' && e.error !== 'interrupted'){ this.on = false; renderQuick(); } };
    try { speechSynthesis.speak(u); } catch(e){}
  },
  async play(){ this.on = true; try { if (navigator.wakeLock) this.wl = await navigator.wakeLock.request('screen'); } catch(e){} this.speak(); renderQuick(); },
  pause(){ this.on = false; this.id++; try { speechSynthesis.cancel(); } catch(e){} renderQuick(); },
  stop(){ this.on = false; this.id++; clearTimeout(this.st); this.sleep = 0; try { speechSynthesis.cancel(); } catch(e){} try { if (this.wl) this.wl.release(); } catch(e){} this.wl = null; },
  go(d){ const n = this.n + d; if (!this.book || n < 0 || n >= this.book.groups.length) return; this.chap(n, 0); if (this.on) this.speak(); renderQuick(); },
  setSleep(min){ clearTimeout(this.st); this.sleep = min; if (min) this.st = setTimeout(() => { this.sleep = 0; this.pause(); toast('Sleep timer: stopped'); }, min * 60000); renderQuick(); }
};
async function openQuick(bookId){
  const book = await loadBook(bookId); if (!book){ toast('That book could not be opened.'); return; }
  if (Play.a) Play.a.pause(); Q.stop(); Q.book = book; let p = null; try { p = JSON.parse(localStorage.getItem('pxq:' + bookId)); } catch(e){}
  const n = p && p.n < book.groups.length ? p.n : 0; Q.chap(n, p && p.n === n ? p.i : 0);
  Q.rate = PX.speech ? PX.speech.rate() : 1; UI.quick = true; PX.go('aplay');
}
function renderQuick(){
  const el = $('#s-aplay'); if (!el || !Q.book || !UI.quick) return mini(); const g = Q.book.groups[Q.n], m = Q.book.meta, rates = [0.75, 1, 1.25, 1.5, 2], sl = [0, 15, 30, 60];
  el.innerHTML = `<header class="hdr"><button class="ib" data-act="back" aria-label="Minimize player">${I.down}</button><h1>Quick listen</h1></header><div class="scroll abp">
    <div class="abp-art">${PX.cover(m, 'lg')}</div><div class="abp-info"><h2>${esc(g.title)}</h2><p>${esc(m.title || '')}</p><p class="lbl">Chapter ${Q.n + 1} of ${Q.book.groups.length} \u00B7 <span id="q-part"></span></p></div>
    <div class="abp-ctl"><button data-ab="qprev" aria-label="Previous chapter">${I.prev}</button><button class="abp-pp" data-ab="qtoggle" aria-label="Play or pause">${Q.on ? I.pause : I.play}</button><button data-ab="qnext" aria-label="Next chapter">${I.next}</button></div>
    <div class="abp-opt"><button class="chip" data-ab="qspeed" data-v="${nextOf(rates, Q.rate)}" aria-label="Speed">${Q.rate}x</button><button class="chip" data-ab="qsleep" data-v="${nextOf(sl, Q.sleep)}">${Q.sleep ? 'Sleep ' + Q.sleep + ' min' : 'Sleep: off'}</button></div>
    <p class="note">Quick listen uses your phone\u2019s own voice, so it usually stops if the screen locks. Choose the voice in Settings, the same as Read aloud.</p></div>`;
  Q.part(); mini();
}
const CLICK = {
  async 'model-get'(){ await modelGet(rerenderCurrent); },
  'model-cancel'(){ if (dlCtl) dlCtl.abort(); },
  async 'model-remove'(){ const r = await dialog({title: 'Remove voice model?', body: 'The model is about 120 MB. You will need the internet to download it again. Your audiobooks stay.', actions: [{label: 'Keep it', key: 'no'}, {label: 'Remove', key: 'yes', solid: true}]}); if (r === 'yes'){ await Model.remove(); await refreshModel(rerenderCurrent); } },
  new(){ chooseBook(); },
  quick(){ chooseBook(openQuick); },
  qtoggle(){ Q.on ? Q.pause() : Q.play(); }, qprev(){ Q.go(-1); }, qnext(){ Q.go(1); },
  qspeed(d){ Q.rate = +d.v; if (Q.on) Q.speak(); renderQuick(); }, qsleep(d){ Q.setSleep(+d.v); },
  async gen(d){ openGenerator(d.id); },
  async listen(d){ UI.quick = false; Q.stop(); if (await Play.open(d.id, null, null, true)) PX.go('aplay'); },
  async 'export-all'(d){ await exportWhole(d.id); },
  async delete(d){
    const abk = await getAB(d.id); const r = await dialog({title: 'Delete this audiobook?', body: esc('The generated audio for \u201C' + (abk ? abk.title : '') + '\u201D will be deleted from this device. The book itself and your reading progress stay.'), actions: [{label: 'Keep it', key: 'no'}, {label: 'Delete audio', key: 'yes', solid: true}]});
    if (r === 'yes'){ await deleteAudiobook(d.id); toast('Audiobook deleted'); renderAudio(); }
  },
  async 'delete-all'(){
    const r = await dialog({title: 'Delete all generated audio?', body: 'Every audiobook made on this device will be deleted. Your books and reading progress stay. The voice model stays.', actions: [{label: 'Keep them', key: 'no'}, {label: 'Delete all audio', key: 'yes', solid: true}]});
    if (r === 'yes'){ for (const a of await DB.all('ab_books')) await deleteAudiobook(a.id); toast('Generated audio deleted'); renderAudio(); }
  },
  'toggle-ch'(d){ const n = +d.n; UI.genSel.has(n) ? UI.genSel.delete(n) : UI.genSel.add(n); renderGen(); },
  all(){ UI.genSel = new Set(UI.genBook.groups.map((g, i) => i)); renderGen(); },
  none(){ UI.genSel = new Set(); renderGen(); },
  speed(d){ UI.genCfg.speed = +d.v; renderGen(); },
  pause(){ stopJob(false); },
  ppause(d){ UI.genCfg.paraPause = +d.v; UI.genCfg.headPause = Math.max(0.8, +d.v + 0.3); renderGen(); },
  foot(d){ UI.genCfg.skipFootnotes = d.v === '1'; renderGen(); },
  async preview(){
    if (UI.preview) return;
    const msg = $('#ab-prev-msg'); UI.preview = true;
    try {
      if (msg) msg.textContent = 'Starting the voice\u2026'; await Tts.start();
      if (msg) msg.textContent = 'Speaking\u2026';
      const r = await Tts.synth(SAMPLE, UI.genCfg.voice, UI.genCfg.speed), blob = new Blob([wavHeader(r.pcm.length * 2), r.pcm.buffer], {type: 'audio/wav'}), url = URL.createObjectURL(blob), a = new Audio(url);
      a.onended = () => { URL.revokeObjectURL(url); }; await a.play(); UI.previewMsg = 'Played in ' + (r.ms / 1000).toFixed(1) + ' s.';
    } catch(e){ UI.previewMsg = 'The preview failed: ' + String(e.message || e); }
    UI.preview = null; const m2 = $('#ab-prev-msg'); if (m2) m2.textContent = UI.previewMsg;
  },
  start(){ startGeneration(); },
  stop(){ stopJob(true); },
  async retry(d){
    const book = UI.genBook; if (!book || Job.cur) return;
    const n = +d.n; try { await runJob(book.meta.id, {only: [n]}); } catch(e){ toast(String(e.message || e)); } await afterJob(book.meta.id); renderGen();
  },
  async regen(d){
    const n = +d.n, abk = await getAB(Play.bookId); if (!abk) return;
    abk.chapters[n].status = 'pending'; abk.chapters[n].fp = ''; await putAB(abk); await resetChapterFiles(abk.id, n);
    await openGenerator(abk.id); UI.genSel = new Set([n]); toast('Choose Generate to remake this chapter'); renderGen();
  },
  toggle(){ Play.toggle(); }, prev(){ Play.step(-1); }, next(){ Play.step(1); }, back15(){ Play.seekBy(-15); }, fwd30(){ Play.seekBy(30); },
  pspeed(d){ Play.setSpeed(+d.v); }, sleep(d){ Play.setSleep(d.v); },
  async 'play-ch'(d){ await Play.load(+d.n, 0, true); },
  async 'export-ch'(d){ await exportChapter(Play.bookId, +d.n); }
};
function rerenderCurrent(){ if (!$('#s-audio').hidden) renderAudio(); else if (!$('#s-abgen').hidden) renderGen(); }
function wire(id){
  const el = $('#' + id); if (!el) return;
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-ab]'); if (!b || b.disabled) return;
    const f = CLICK[b.dataset.ab]; if (f) Promise.resolve(f(b.dataset, b)).catch(err => toast(String(err && err.message || err)));
  });
  el.addEventListener('change', e => {
    if (e.target.id === 'ab-voice'){ UI.genCfg.voice = e.target.value; UI.previewMsg = ''; renderGen(); }
  });
}

/* ======================================================= registration with the reader ======================================================= */
PX.screens.audio = async () => { await Store.init(); renderAudio(); await refreshModel(rerenderCurrent); recoverInterrupted(); };
PX.screens.abgen = async () => { await Store.init(); UI.abkLive = UI.genBook ? await getAB(UI.genBook.meta.id) : null; renderGen(); await refreshModel(rerenderCurrent); };
PX.screens.aplay = () => UI.quick ? renderQuick() : renderPlay();
PX.hooks.show = name => { CUR = name; if (name === 'reader'){ if (UI.quick) Q.pause(); if (Play.a && !Play.a.paused && Play.url) Play.a.pause(); } mini(); };
['s-audio', 's-abgen', 's-aplay'].forEach(wire);
PXA.openLibrary = () => PX.go('audio');
PXA.openGenerator = openGenerator;
PXA._internals = {Store, Model, Tts, Play, Job, getAB, loadBook, prepare, runJob, stopJob, createAudiobook, deleteAudiobook, exportChapter, exportWhole, VOICES, envProblem, recoverInterrupted, defaultCfg, refreshModel, UI, assembleChapter, wavHeader};
PX.ab = PXA;
Store.init().then(() => recoverInterrupted()).catch(() => {});
})();
