import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

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

const version = `v${currentYear}${String(currentMonth).padStart(2, '0')}.${sequence}`;

// Sincroniza el nombre de caché del service worker con la versión. Cambiar el
// nombre en cada bump invalida la caché vieja del shell y fuerza al SW a
// reprecachear los archivos nuevos (evita servir JS/estáticos obsoletos tras un
// despliegue). Best-effort: si sw.js cambia de formato, no bloquea el bump.
try {
  const swPath = resolve('sw.js');
  const swSource = readFileSync(swPath, 'utf8');
  const swUpdated = swSource.replace(
    /const CACHE = '[^']*';/,
    `const CACHE = 'wia-shell-${version}';`
  );
  if (swUpdated !== swSource) {
    writeFileSync(swPath, swUpdated);
    console.log(`Caché del service worker → wia-shell-${version}`);
  } else {
    console.warn('Aviso: no se encontró «const CACHE = …» en sw.js; revísalo a mano.');
  }
} catch (e) {
  console.warn(`Aviso: no se pudo actualizar la caché del service worker: ${e.message}`);
}

// Los imports de js/*.js, index.html y el precache del service worker llevan
// «?v=<versión>» (sale de CACHE en sw.js, ya actualizado arriba): sin él, un
// navegador con el SW anterior mezcla el HTML nuevo con JS viejos de su caché.
// Los regenera el generador del grafo de módulos.
const gen = spawnSync(process.execPath, ['--expose-internals', 'scripts/gen-modules.mjs'], { stdio: 'inherit' });
if (gen.status !== 0) {
  console.error('Aviso: no se pudo regenerar el grafo de módulos; ejecuta `npm run gen:modules`.');
  process.exitCode = 1;
}

console.log(`Version actualizada a ${version}`);
