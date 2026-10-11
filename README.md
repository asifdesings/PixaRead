# PixaRead v1.3: reader + offline AI audiobook generator

PixaRead is still the same reader (EPUB, PDF, HTML, Markdown, TXT, bookmarks, progress, themes, fonts, browser **Read aloud**).
New in this package: an **Audiobooks** feature that turns any imported book into real, downloadable audio files, using an AI
voice that runs on your own device. Book text and audio never leave the device. It is a separate feature from the reader's
**Read aloud** button, which still uses your phone's built-in voices through `speechSynthesis` and is unchanged.

> This package must be served from **https** (or `http://localhost`). The audiobook feature cannot run in the Claude-hosted
> artifact page or from a `file://` page (no service worker, no model download, no workers). Those pages keep working as a
> plain reader; the Audiobooks screen explains why it is unavailable.

## What is in the package

| Path | Purpose |
|---|---|
| `index.html` | The whole reader (your previous file plus small integration changes, listed below) |
| `ab/audiobook.js` | Audiobook module: storage, model setup, job runner, screens, player, export |
| `ab/text-prep.js` | Turns stored chapter HTML into narration passages |
| `ab/tts-worker.js` | Web Worker: phonemiser + ONNX Runtime + the voice model |
| `ab/model-manifest.json` | Model files, sizes and SHA-256 checksums |
| `ab/vendor/` | ONNX Runtime Web (WASM), phonemizer (eSpeak NG WASM), licences |
| `lib/` | JSZip and pdf.js, shipped locally so EPUB/PDF import works offline (CDN stays as fallback) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline app shell and installability |
| `get-model.sh`, `ab/model/` | Fetches/holds the three voice model files (about 121 MB, **not** inside the zip) |
| `serve.js` | Tiny static test server (`node serve.js 8089`) |
| `tests/` | The end-to-end tests that were run (see "Tests") |
| `THIRD-PARTY-NOTICES.md` | Licences (read the eSpeak NG note) |

## How it works, and why it works offline

* **Voice**: Kokoro-82M v1.0, int8-quantised (about 92 MB), run with ONNX Runtime Web on the WebAssembly backend inside a Web
  Worker, so the reader stays responsive. eSpeak NG (WASM) turns text into phonemes; the text normalisation and punctuation
  handling follow kokoro-js (Apache-2.0). We call the model directly instead of through `kokoro-js` because kokoro-js can only load
  its model from Hugging Face; here the same Kokoro weights live in files the app stores itself.
* **Model setup is explicit**: first launch of the Audiobooks screen shows the one-time download (about 121 MB), progress,
  Cancel, Continue (downloads resume), and Retry. The files go into the browser's private file storage (OPFS; IndexedDB where OPFS
  is unavailable), are checked against size and SHA-256, then the model is loaded and speaks a test sentence. Only after that is it
  marked "Ready for offline use". Nothing is downloaded silently when you press Generate.
* **Offline shell**: `sw.js` caches the app, the voice runtime and the import libraries when it installs. Model files are
  deliberately not cached by the service worker (the app stores and verifies them itself). If the browser clears model files,
  the Audiobooks screen says which are missing and offers "Restore" (only the missing files are fetched; everything else keeps
  working, and finished audio is not affected).
* **Text**: existing chapter HTML is reused (no second importer). Titles, headings, paragraphs, quotes, lists, captions, footnotes
  and table rows are read in order; code listings and pictures cannot be read aloud and are reported, never silently invented.
  ALL-CAPS titles are spoken as words; footnote marks are not read as numbers. Chapters are split at sentence boundaries into
  passages of at most 240 characters; pauses are longer between paragraphs and around headings, short inside a paragraph.
* **Audio**: each passage is synthesised, saved, and assembled into one 24 kHz, 16-bit mono **WAV per chapter**, streamed to storage
  so a whole book is never held in memory. Progress is saved per passage: pause, cancel, close the app or crash and the job resumes
  at the first missing passage. A failed passage is kept as failed, nothing is skipped, and "Retry" regenerates only that passage.
  Unchanged chapters (same text, voice, speed, pauses and model) are reused.
* **Player**: play/pause, previous/next chapter, seek, −15/+30 s, speed 0.75–2×, volume, sleep timer (15/30/60 min or end of
  chapter), automatic next chapter, position saved (also after the phone restarts). Lock-screen controls (Media Session) are wired in but were not tested.
* **Export**: any chapter as WAV, or the whole book as one WAV (built lazily from the chapter files; refused above 4 GB, the WAV limit).
* **Storage**: IndexedDB version 2 → 3 adds `ab_books`, `ab_chunks`, `ab_audio`, `ab_model`; `books`, `content`, `trans` are
  untouched. Deleting an audiobook asks first and never touches the book or reading progress. `navigator.storage.persist()` is
  requested, but browsers may still refuse; the Audiobooks screen shows whether storage is protected.

## Run and test locally

```sh
cd pixaread-pwa
./get-model.sh              # fetches ab/model/* (about 121 MB) and verifies checksums
node serve.js 8089          # any static server works; use http://localhost or https
# open http://localhost:8089 in Chrome
```
Then: import a book → book page → **Audiobook** (or the headphones button in the library) → Download voice model → choose
chapters and a voice → Hear this voice → Generate → Listen / Export. Install it from the Chrome menu ("Install app").

Offline check by hand: finish setup and generate one chapter online, close the browser, **stop the server** (or enable airplane
mode on the phone), reopen the installed app, read, generate another chapter, play audio.

## Deploy

Any static host over https works: keep the folder layout, include `ab/model/` with the three model files.

* **GitHub Pages / Netlify**: fine (the model file is 92 MB; GitHub's per-file limit is 100 MB).
* **Cloudflare Pages**: files are limited to 25 MiB, so the model cannot be hosted there. Host the three model files elsewhere
  (with `Access-Control-Allow-Origin` for your site and Range support) and set `"base"` in `ab/model-manifest.json` to that
  absolute URL.
* Serve `sw.js` and `index.html` with `Cache-Control: no-cache`.
* **Updating**: change `VERSION` in `sw.js` on every release. Installed apps fetch the new worker, cache the new files, and show an
  "Update" button instead of switching in the middle of reading. Old caches are deleted on activation.

## Sizes and speed (measured here, in headless Chromium on a single-core sandbox)

* Download: 120.6 MB (92.4 MB model + 28.2 MB voices + config). Stored size is the same.
* Audio: 48,000 bytes per second = 2.9 MB per minute = about 173 MB per hour of narration.
* Browser memory (all processes): about 217 MB before the model, about 631 MB with it loaded.
* Speed: about 3 to 4 times **slower** than real time on this one slow core (the app measures this itself and shows an estimate
  before you start). That means roughly 3 to 4 hours of waiting per hour of audio here. **Speed on phones was not measured.**
  Start with a few chapters. Multi-threading and WebGPU are not enabled (see limitations).

## Tests actually run

All run in headless Chromium against `http://localhost` unless noted; speech was checked by transcribing the generated WAV with an
independent offline recogniser (pocketsphinx), because I cannot listen to audio.

* First launch: service worker installs and caches the shell (17 files); one-time download with progress; SHA-256 verified; model
  loaded and a test sentence spoken; "ready" only afterwards; model survives a full browser restart.
* Generation: 3-chapter book in the right order; dialogue; cancel mid-book; app killed mid-job → "Interrupted" → resume regenerated
  only the 1 missing passage; pressing Generate again regenerated nothing; failed passage kept and retried alone (1 passage);
  chapter and whole-book export open as valid WAVs; no leftover temporary files.
* Transcripts of the 3 chapters: 6 word differences in 61 words (10%, mostly the recogniser's own mistakes such as "lit"→"let").
  This shows the right words in the right order with no duplicates or gaps; it says nothing about how pleasant the voice sounds.
* Player: play/pause, speed, previous/next, auto-advance, end-of-chapter sleep timer, position restored after browser restart,
  missing audio file → clear message → regenerate, delete with confirmation leaves book, chapters, progress and model intact.
* **Offline**: after online setup, the server was stopped, the browser cold-restarted, and with no network: the app opened, a book
  was read, EPUB, PDF and Markdown files were imported, earlier audio played, a **new chapter was generated** (transcript correct),
  and no request failed other than the app's optional Google Fonts links; no model file was requested.
* Evicted model file → clear message, Generate disabled, "Restore" fetched only the missing file; storage-full during generation →
  job stops with a clear message, finished chapters kept; IndexedDB fallback storage works for model, generation and playback;
  `file://` page shows a clear "cannot run here" message.
* Stress: 25 chapters, 423 passages, 60 minutes of **stand-in audio (not narration)**, 173 MB written, browser memory peak 364 MB, no leftovers.
* Existing app: all earlier regression suites (imports for TXT/HTML/MD/EPUB/PDF, fonts and headings, pagination and position,
  bookmarks and progress after reload, settings, highlights) pass; the existing **Read aloud** was exercised with a recording
  stand-in for `speechSynthesis` (voice and rate passed, stop cancels) because headless Chromium has no voices; the database
  upgrade from version 2 to 3 kept a book stored by the previous build.
* Phone layout at 360 px and 390 px: no horizontal overflow, every control at least 40 px.

## Not tested / limitations

* **Android Chrome and iOS Safari were not available: unverified.** Mobile browsers may pause or kill a long job in the background
  (a screen wake lock is requested, and progress is saved so you can resume). Safari lacks OPFS writing on the main thread, so the
  IndexedDB fallback would be used there (tested only in Chromium); memory limits on small phones are unknown.
* **Voice quality is unverified by me.** Kokoro's published grades are shown next to each voice (A is best); I could not listen.
* **English only** (American and British voices). The bundled phonemiser only contains English, so other languages (and
  non-Latin scripts such as Bengali) are blocked or warned about, and the Read aloud button remains the option for them.
* **Speed**: single-threaded WebAssembly. WebGPU is not used (the int8 model's operators are not all supported there; not tested).
  Multi-threading needs cross-origin isolation headers; not enabled.
* Numbers, dates, money and common abbreviations use kokoro-js's rules; Roman numerals, chemical/maths notation and unusual
  abbreviations are read as written.
* OCR for scanned PDFs still needs the internet (its engine and language data are not shipped).
* Browsers can evict stored data under pressure; export what you want to keep.
* Licensing: see the **eSpeak NG (GPL-3.0)** note in `THIRD-PARTY-NOTICES.md`. Not legal advice.

## Changelog

**Preserved unchanged**: library, importers, reader engine, themes, fonts, highlights, translation, existing `speechSynthesis`
Read aloud (`speakStart`, `speakStop`, voice picking and the speech chunking), bookmarks and progress, existing database stores and records.

**Changed in `index.html`** (small, additive): database opens at version 3 (new stores only; blocked upgrades are reported instead
of silently falling back); `PX` bridge object; screen registry so new screens can render; headphones icon and two entry points
(library header, book page); styles for the new screens; service-worker registration with an update prompt; JSZip and pdf.js loaded
from `lib/` first (CDN as fallback); manifest and icon links.

**Added**: everything under `ab/`, `lib/`, `sw.js`, `manifest.webmanifest`, `icons/`, `tests/`, this README.
