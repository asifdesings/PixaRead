# Third-party components in the audiobook feature

| Component | Version | Licence | How it was verified |
|---|---|---|---|
| Kokoro-82M v1.0 model weights (int8 ONNX) and voice pack | v1.0 | Apache-2.0 | The Kokoro README states "Apache-licensed weights"; the kokoro-onnx README lists "kokoro model: Apache 2.0". The Hugging Face model card could not be reached from the build environment, and the origin of the training data behind individual voices was **not** independently checked. |
| kokoro-onnx (source of the packaged ONNX/voice files, and of `config.json`) | model-files-v1.0 | MIT | LICENSE fetched from the repository. |
| kokoro-js (text normalisation and phonemisation rules adapted in `ab/tts-worker.js`) | 1.2.1 | Apache-2.0 | `package.json` and repository LICENSE (`ab/vendor/LICENSE.kokoro-Apache-2.0.txt`). |
| ONNX Runtime Web (`ab/vendor/ort*.mjs`, `ort-wasm-simd-threaded.wasm`) | 1.20.1 | MIT | `package.json`; LICENSE from the onnxruntime repository (`ab/vendor/LICENSE.onnxruntime-web-MIT.txt`). |
| phonemizer (`ab/vendor/phonemizer.js`) | 1.2.1 | Apache-2.0 (wrapper) | `package.json` and LICENSE (`ab/vendor/LICENSE.phonemizer-Apache-2.0.txt`). |
| **eSpeak NG**, compiled to WebAssembly and embedded inside phonemizer.js | as built in phonemizer 1.2.1 | **GPL-3.0-or-later** | Upstream COPYING and README fetched (`ab/vendor/LICENSE.espeak-ng-GPL-3.0.txt`). The phonemizer package itself does not state this. |
| pdf.js (`lib/pdf.min.js`, `lib/pdf.worker.min.js`) | 3.11.174 | Apache-2.0 | `package.json` and LICENSE. |
| JSZip (`lib/jszip.min.js`) | 3.10.2 | MIT or GPL-3.0 (your choice) | LICENSE.markdown fetched. Use it under MIT. |

## Please read: eSpeak NG is GPL

The bundled phonemiser contains eSpeak NG, which is licensed GPL-3.0-or-later. Distributing a site or app that includes it
brings GPL obligations at least for that component (licence notice, access to its source). Whether PixaRead as a whole must
then also be offered under the GPL depends on how the combination is judged, and this has not been legally reviewed.
Personal use is not affected. If you intend to distribute PixaRead to others (especially commercially), get advice, or
replace the phonemiser with a non-GPL English grapheme-to-phoneme component and re-test. This is not legal advice.
