import fs from 'fs';
import path from 'path';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fail(message) {
  console.error(`Version check failed: ${message}`);
  process.exit(1);
}

const root = process.cwd();
const packagePath = path.join(root, 'package.json');
const sourceManifestPath = path.join(root, 'src', 'extension', 'manifest.json');
const packedManifestPath = path.join(root, 'extension', 'manifest.json');

const pkg = readJson(packagePath);
const sourceManifest = readJson(sourceManifestPath);
const packedManifest = readJson(packedManifestPath);

const expected = pkg.version;
const checks = [
  ['src/extension/manifest.json version', sourceManifest.version],
  ['src/extension/manifest.json version_name', sourceManifest.version_name],
  ['extension/manifest.json version', packedManifest.version],
  ['extension/manifest.json version_name', packedManifest.version_name]
];

if (!/^\d{2}\.\d{1,2}\.\d+$/.test(expected)) {
  fail(`package.json version "${expected}" must use YY.M.PATCH, for example 26.6.41`);
}

for (const [label, actual] of checks) {
  if (actual !== expected) {
    fail(`${label} is "${actual}" but package.json is "${expected}"`);
  }
}

console.log(`Version check passed: ${expected}`);
