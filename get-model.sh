#!/bin/sh
# Downloads the three voice model files into ab/model/ and checks them against ab/model-manifest.json.
set -e
cd "$(dirname "$0")/ab/model"
REL=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
curl -fL -o kokoro-v1.0.int8.onnx "$REL/kokoro-v1.0.int8.onnx"
curl -fL -o voices-v1.0.bin "$REL/voices-v1.0.bin"
curl -fL -o config.json https://raw.githubusercontent.com/thewh1teagle/kokoro-onnx/main/src/kokoro_onnx/config.json
printf '%s  %s\n' \
  6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb kokoro-v1.0.int8.onnx \
  bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d voices-v1.0.bin \
  5abb01e2403b072bf03d04fde160443e209d7a0dad49a423be15196b9b43c17f config.json | sha256sum -c -
echo "Model files are in place."
