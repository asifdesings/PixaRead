/* PixaRead service worker: makes the app open and work with no network.
 *
 * - The app shell (page, scripts, voice engine runtime) is cached when the worker installs, so PixaRead opens offline.
 * - The voice model files (about 120 MB) are NOT cached here. The app downloads them on request into the browser's private
 *   file storage and verifies them; the worker lets those requests go straight to the network and never stores them.
 * - Only this site's own files are handled. Requests to other sites are left alone.
 *
 * To publish an update, change VERSION. Browsers then fetch the new worker, cache the new files, and PixaRead offers a
 * one-tap "Update" instead of switching versions in the middle of reading.
 */
const VERSION = 'pixaread-1.3.0';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
  'ab/text-prep.js', 'ab/audiobook.js', 'ab/tts-worker.js', 'ab/model-manifest.json',
  'lib/jszip.min.js', 'lib/pdf.min.js', 'lib/pdf.worker.min.js',
  'ab/vendor/ort.wasm.min.mjs', 'ab/vendor/ort-wasm-simd-threaded.mjs', 'ab/vendor/ort-wasm-simd-threaded.wasm', 'ab/vendor/phonemizer.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, {cache: 'reload'})))));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('pixaread-') && k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/ab/model/')) return;
  if (req.mode === 'navigate'){
    e.respondWith(caches.match('index.html', {ignoreSearch: true}).then(r => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, {ignoreSearch: true}).then(r => r || fetch(req)));
});
