// Copies the face-api.js model weights bundled inside node_modules into ./models
// so the app has a stable, gitignored local path independent of node_modules layout.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'node_modules', '@vladmandic', 'face-api', 'model');
const DEST = path.join(__dirname, '..', 'models', 'face-api');

const FILES = [
  'ssd_mobilenetv1_model-weights_manifest.json',
  'ssd_mobilenetv1_model.bin',
  'face_landmark_68_tiny_model-weights_manifest.json',
  'face_landmark_68_tiny_model.bin',
];

if (!fs.existsSync(SRC)) {
  console.error(`face-api model source not found at ${SRC}. Run "npm install" first.`);
  process.exit(1);
}

fs.mkdirSync(DEST, { recursive: true });

for (const file of FILES) {
  const from = path.join(SRC, file);
  const to = path.join(DEST, file);
  fs.copyFileSync(from, to);
  console.log(`copied ${file}`);
}

console.log(`face-api models installed to ${DEST}`);
