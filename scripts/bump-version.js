import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const versionPath = resolve('Plantilla/Version.js');
const source = readFileSync(versionPath, 'utf8');
const now = new Date();
const currentYear = Number(String(now.getFullYear()).slice(-2));
const currentMonth = now.getMonth() + 1;

const yearMatch = source.match(/const VERSION_YEAR = (\d+);/);
const monthMatch = source.match(/const VERSION_MONTH = (\d+);/);
const sequenceMatch = source.match(/const VERSION_SEQUENCE = '([A-Z]{2})';/);

if (!yearMatch || !monthMatch || !sequenceMatch) {
  throw new Error('No se pudo leer el formato de version en Plantilla/Version.js');
}

const storedYear = Number(yearMatch[1]);
const storedMonth = Number(monthMatch[1]);
const storedSequence = sequenceMatch[1];

const nextSequence = (sequence) => {
  const first = sequence.charCodeAt(0) - 65;
  const second = sequence.charCodeAt(1) - 65;
  const next = first * 26 + second + 1;
  if (next > 675) {
    throw new Error('Se agotaron las versiones mensuales disponibles: ZZ');
  }
  return String.fromCharCode(65 + Math.floor(next / 26)) + String.fromCharCode(65 + (next % 26));
};

const sequence = storedYear === currentYear && storedMonth === currentMonth
  ? nextSequence(storedSequence)
  : 'AA';

const updated = source
  .replace(/const VERSION_YEAR = \d+;/, `const VERSION_YEAR = ${currentYear};`)
  .replace(/const VERSION_MONTH = \d+;/, `const VERSION_MONTH = ${currentMonth};`)
  .replace(/const VERSION_SEQUENCE = '[A-Z]{2}';/, `const VERSION_SEQUENCE = '${sequence}';`);

writeFileSync(versionPath, updated);
console.log(`Version actualizada a v${currentYear}${String(currentMonth).padStart(2, '0')}.${sequence}`);
