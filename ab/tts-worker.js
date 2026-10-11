/* PixaRead local text-to-speech worker.
 *
 * Runs entirely on the device: ONNX Runtime Web (WASM) executes the Kokoro-82M model, eSpeak NG (WASM, via the
 * "phonemizer" package) turns text into phonemes. Nothing here uses the network.
 *
 * The text normalisation and the punctuation-aware phonemisation follow kokoro-js 1.2.1 (Apache-2.0,
 * https://github.com/hexgrad/kokoro/tree/main/kokoro.js). The inference layer is our own because kokoro-js can only
 * load its model from Hugging Face through transformers.js; this worker reads the same Kokoro weights from files that
 * PixaRead stores on the device.
 */
import * as ort from './vendor/ort.wasm.min.mjs';
import { phonemize } from './vendor/phonemizer.js';

const SR = 24000;
const MAX_TOKENS = 510;           // the model's context is 512 including the two padding tokens
let session = null, vocab = null, voicesFile = null, voiceIndex = null;
const voiceCache = new Map();

/* ---------------- voice pack (.npz of float32 arrays, entries stored uncompressed) ---------------- */
async function readNpzIndex(file){
  const tailLen = Math.min(file.size, 70000), tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
  if (eocd < 0) throw new Error('The voice file is not a valid archive.');
  const count = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOff = tail.getUint32(eocd + 16, true);
  const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer()), dec = new TextDecoder(), map = new Map();
  let p = 0;
  for (let i = 0; i < count; i++){
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('The voice file is damaged.');
    const method = cd.getUint16(p + 10, true), usize = cd.getUint32(p + 24, true), nlen = cd.getUint16(p + 28, true), elen = cd.getUint16(p + 30, true), clen = cd.getUint16(p + 32, true), lho = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen)).replace(/\.npy$/, '');
    map.set(name, {method, usize, lho}); p += 46 + nlen + elen + clen;
  }
  return map;
}
async function loadVoice(name){
  if (voiceCache.has(name)) return voiceCache.get(name);
  const e = voiceIndex.get(name); if (!e) throw new Error('Voice "' + name + '" is not in the voice file.');
  if (e.method !== 0) throw new Error('This voice file is compressed, which is not supported.');
  const lh = new DataView(await voicesFile.slice(e.lho, e.lho + 30).arrayBuffer());
  const start = e.lho + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
  const ab = await voicesFile.slice(start, start + e.usize).arrayBuffer(), dv = new DataView(ab);
  const major = dv.getUint8(6), hl = major === 1 ? dv.getUint16(8, true) : dv.getUint32(8, true), off = (major === 1 ? 10 : 12) + hl;
  const data = new Float32Array(ab.slice(off));
  if (data.length < 510 * 256) throw new Error('Voice "' + name + '" has an unexpected size.');
  voiceCache.set(name, data); return data;
}

/* ---------------- text normalisation (adapted from kokoro-js) ---------------- */
function yearOrTime(s){
  if (s.includes('.')) return s;
  if (s.includes(':')){ const [h, m] = s.split(':').map(Number); return m === 0 ? `${h} o'clock` : m < 10 ? `${h} oh ${m}` : `${h} ${m}`; }
  const a = parseInt(s.slice(0, 4), 10); if (a < 1100 || a % 1000 < 10) return s;
  const left = s.slice(0, 2), right = parseInt(s.slice(2, 4), 10), suffix = s.endsWith('s') ? 's' : '';
  if (a % 1000 >= 100 && a % 1000 <= 999){ if (right === 0) return `${left} hundred${suffix}`; if (right < 10) return `${left} oh ${right}${suffix}`; }
  return `${left} ${right}${suffix}`;
}
function money(s){
  const unit = s[0] === '$' ? 'dollar' : 'pound';
  if (isNaN(Number(s.slice(1)))) return `${s.slice(1)} ${unit}s`;
  if (!s.includes('.')){ const pl = s.slice(1) === '1' ? '' : 's'; return `${s.slice(1)} ${unit}${pl}`; }
  const [w, f] = s.slice(1).split('.'), c = parseInt(f.padEnd(2, '0'), 10);
  return `${w} ${unit}${w === '1' ? '' : 's'} and ${c} ${s[0] === '$' ? (c === 1 ? 'cent' : 'cents') : (c === 1 ? 'penny' : 'pence')}`;
}
function decimal(s){ const [a, b] = s.split('.'); return `${a} point ${b.split('').join(' ')}`; }
function normalizeText(t){
  return t.replace(/[‘’]/g, "'").replace(/«/g, '“').replace(/»/g, '”').replace(/[“”]/g, '"').replace(/\(/g, '«').replace(/\)/g, '»')
    .replace(/、/g, ', ').replace(/。/g, '. ').replace(/！/g, '! ').replace(/，/g, ', ').replace(/：/g, ': ').replace(/；/g, '; ').replace(/？/g, '? ')
    .replace(/[^\S \n]/g, ' ').replace(/  +/g, ' ').replace(/(?<=\n) +(?=\n)/g, '')
    .replace(/\bD[Rr]\.(?= [A-Z])/g, 'Doctor').replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, 'Mister').replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, 'Miss').replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, 'Mrs')
    .replace(/\betc\.(?! [A-Z])/gi, 'etc').replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, yearOrTime)
    .replace(/(?<=\d),(?=\d)/g, '')
    .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, money)
    .replace(/\d*\.\d+/g, decimal).replace(/(?<=\d)-(?=\d)/g, ' to ').replace(/(?<=\d)S/g, ' S')
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S").replace(/(?<=X')S\b/g, 's')
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, m => m.replace(/\./g, '-')).replace(/(?<=[A-Z])\.(?=[A-Z])/gi, '-').trim();
}
const PUNCT = ';:,.!?¡¿—…"«»“”(){}[]';
const PUNCT_RE = new RegExp(`(\\s*[${PUNCT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]+\\s*)+`, 'g');
function splitKeep(text, re){
  const out = []; let last = 0;
  for (const m of text.matchAll(re)){
    if (last < m.index) out.push({match: false, text: text.slice(last, m.index)});
    if (m[0].length) out.push({match: true, text: m[0]});
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({match: false, text: text.slice(last)});
  return out;
}
// accent 'a' = American English, 'b' = British English. (The bundled eSpeak NG build only contains English.)
async function toPhonemes(text, accent){
  const lang = accent === 'a' ? 'en-us' : 'en';
  let out = '';
  for (const part of splitKeep(normalizeText(text), PUNCT_RE)) out += part.match ? part.text : (await phonemize(part.text, lang)).join(' ');
  out = out.replace(/kəkˈoːɹoʊ/g, 'kˈoʊkəɹoʊ').replace(/kəkˈɔːɹəʊ/g, 'kˈəʊkəɹəʊ').replace(/ʲ/g, 'j').replace(/r/g, 'ɹ').replace(/x/g, 'k').replace(/ɬ/g, 'l')
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ').replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, 'z');
  if (accent === 'a') out = out.replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di');
  return out.trim();
}
const tokenize = ph => { const ids = []; for (const ch of ph){ const id = vocab[ch]; if (id !== undefined) ids.push(id); } return ids; };
// A passage that is too long for the model is cut at the last space (or punctuation) before the limit; the words are never cut.
function splitPhonemes(ph, limit){
  const pieces = []; let rest = ph;
  while (tokenize(rest).length > limit){
    let cut = -1; const chars = [...rest]; let count = 0, lastSpace = -1;
    for (let i = 0; i < chars.length; i++){ if (vocab[chars[i]] !== undefined) count++; if (count > limit) break; if (chars[i] === ' ' || /[;:,.!?—…]/.test(chars[i])) lastSpace = i; }
    cut = lastSpace > 0 ? lastSpace + 1 : Math.floor(chars.length / 2);
    pieces.push(chars.slice(0, cut).join('').trim()); rest = chars.slice(cut).join('').trim();
  }
  if (rest) pieces.push(rest);
  return pieces.filter(Boolean);
}

/* ---------------- inference ---------------- */
async function runPiece(ph, voiceData, speed){
  const ids = [0, ...tokenize(ph), 0];
  if (ids.length <= 2) return new Float32Array(0);
  const idx = Math.min(Math.max(ids.length - 2, 0), 509), style = voiceData.slice(idx * 256, idx * 256 + 256);
  const out = await session.run({
    tokens: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    style: new ort.Tensor('float32', style, [1, 256]),
    speed: new ort.Tensor('float32', [speed], [1])
  });
  return Float32Array.from(out[session.outputNames[0]].data);   // copy: the runtime may reuse its buffer
}
// Removes the long silence the model leaves around a passage, keeping a short natural margin.
function trimSilence(a){
  const th = 0.008, pad = Math.round(SR * 0.03); let s = 0, e = a.length - 1;
  while (s < a.length && Math.abs(a[s]) < th) s++;
  while (e > s && Math.abs(a[e]) < th) e--;
  if (s >= e) return a;
  return a.subarray(Math.max(0, s - pad), Math.min(a.length, e + 1 + pad));
}
async function synth({text, voice, speed, simulateFail}){
  if (!session) throw new Error('The voice model is not loaded.');
  if (simulateFail) throw new Error('Simulated failure (test).');
  const t0 = performance.now(), accent = voice[0] === 'b' ? 'b' : 'a';
  const ph = await toPhonemes(text, accent);
  if (!ph) return {pcm: new Int16Array(0), samples: 0, tokens: 0, ms: 0, phonemes: ''};
  const voiceData = await loadVoice(voice), parts = [];
  let tokens = 0;
  for (const piece of splitPhonemes(ph, MAX_TOKENS - 2)){ tokens += tokenize(piece).length; parts.push(trimSilence(await runPiece(piece, voiceData, speed || 1))); }
  const gap = Math.round(SR * 0.09), total = parts.reduce((n, p) => n + p.length, 0) + gap * Math.max(0, parts.length - 1);
  const pcm = new Int16Array(total); let o = 0;
  parts.forEach((p, i) => { for (let k = 0; k < p.length; k++) pcm[o++] = Math.max(-1, Math.min(1, p[k])) * 32767; if (i < parts.length - 1) o += gap; });
  return {pcm, samples: total, tokens, ms: Math.round(performance.now() - t0), phonemes: ph};
}

/* ---------------- messages ---------------- */
async function init({modelFile, voicesFile: vf, config, threads}){
  ort.env.wasm.wasmPaths = new URL('./vendor/', import.meta.url).href;
  ort.env.wasm.numThreads = threads > 1 ? threads : 1;
  ort.env.wasm.proxy = false;
  vocab = config.vocab;
  let buf = new Uint8Array(await modelFile.arrayBuffer());
  session = await ort.InferenceSession.create(buf, {executionProviders: ['wasm'], graphOptimizationLevel: 'all'});
  buf = null;
  voicesFile = vf; voiceIndex = await readNpzIndex(vf); voiceCache.clear();
  return {voices: [...voiceIndex.keys()], threads: ort.env.wasm.numThreads, isolated: self.crossOriginIsolated === true};
}
let queue = Promise.resolve();
self.onmessage = e => {
  const {id, type, ...p} = e.data;
  queue = queue.then(async () => {
    try {
      let r = {};
      if (type === 'init') r = await init(p);
      else if (type === 'synth') r = await synth(p);
      else if (type === 'dispose'){ session = null; voiceCache.clear(); }
      const transfer = r && r.pcm ? [r.pcm.buffer] : [];
      self.postMessage({id, ok: true, ...r}, transfer);
    } catch (err){ self.postMessage({id, ok: false, error: String((err && err.message) || err)}); }
  });
};
