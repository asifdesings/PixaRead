The voice model files are not stored in this folder in the download package (about 121 MB).
Put these three files here before you publish the site (or run ../../get-model.sh):

  kokoro-v1.0.int8.onnx   92,361,271 bytes   sha256 6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb
  voices-v1.0.bin         28,214,398 bytes   sha256 bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d
  config.json                  2,351 bytes   sha256 5abb01e2403b072bf03d04fde160443e209d7a0dad49a423be15196b9b43c17f

Source: https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0  (Kokoro-82M v1.0, int8)
Licence of the model: Apache-2.0 (see ../../THIRD-PARTY-NOTICES.md).
The app downloads these files from this folder only when the user taps "Download voice model", stores them on the
device, and verifies them against the sizes and checksums in ../model-manifest.json.
