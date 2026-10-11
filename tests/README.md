# End-to-end tests that were run

Needs: `npm i puppeteer-core @sparticuz/chromium jsdom`, Python 3 with `pip install pocketsphinx scipy numpy`, the model files in
`../ab/model/`, and the site served on port 8089 (`node ../serve.js 8089`, started from this folder).
Run from this folder. Browser profiles are kept in /tmp so tests can continue where the previous one stopped.

Order: `e2e_a.js` (fresh install, model setup) -> `e2e_b1.js` -> `e2e_b2.js` -> `e2e_c1.js` -> `e2e_c2.js` (generation, resume, retry, export, player),
`e2e_d1.js` then `e2e_d4.js` (offline: d4 stops the server itself; restart it afterwards), `e2e_e2.js` (eviction, storage full),
`e2e_e3.js` (IndexedDB fallback), `e2e_e4.js` (long-book pipeline with stand-in audio), `e2e_reg.js` (imports), `e2e_lay.js` (phone layout),
`node t_text.js` (text preparation). `transcribe.py` turns a generated WAV back into text for an independent check.
Some scripts assume the profile and book created by the previous one; the fixtures in this folder match their expectations.
