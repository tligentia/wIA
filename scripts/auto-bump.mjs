/**
 * auto-bump — avanza la versión si hay modificaciones nuevas sin commitear.
 *
 * Lo ejecuta el hook `Stop` de Claude Code (.claude/settings.json) al final de
 * cada turno, de modo que la versión suba SIEMPRE que se haya modificado algo,
 * lo pida alguien o no. Es idempotente: sin cambios nuevos desde el último
 * avance no hace nada, y con el árbol limpio (todo commiteado, donde ya actúa el
 * hook de pre-commit) tampoco.
 *
 * Uso:  node scripts/auto-bump.mjs [--dry-run]
 * Salida: una línea JSON {"systemMessage": …} cuando avanza, para que Claude
 * Code la muestre; nada en otro caso.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedPaths, computeFingerprint, readFingerprint, storeFingerprint } from './lib/bump-fingerprint.mjs';

const dryRun = process.argv.includes('--dry-run');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function currentVersion() {
    try {
        const src = readFileSync(join(root, 'Plantilla/Version.js'), 'utf8');
        const y = /VERSION_YEAR = (\d+)/.exec(src)?.[1];
        const m = /VERSION_MONTH = (\d+)/.exec(src)?.[1];
        const s = /VERSION_SEQUENCE = '([A-Z]{2})'/.exec(src)?.[1];
        return y && m && s ? `v${y}${String(m).padStart(2, '0')}.${s}` : '?';
    } catch { return '?'; }
}

try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, stdio: 'ignore' });
} catch {
    process.exit(0);       // fuera de un repositorio: nada que hacer
}

const changed = changedPaths(root);
if (!changed.length) process.exit(0);           // árbol limpio: lo commiteado ya llevó su bump

const fingerprint = computeFingerprint(root);
if (fingerprint === readFingerprint(root)) process.exit(0);   // nada nuevo desde el último avance

if (dryRun) {
    console.log(`auto-bump: avanzaría desde ${currentVersion()} (${changed.length} ficheros con cambios)`);
    process.exit(0);
}

const before = currentVersion();
const res = spawnSync(process.execPath, ['scripts/bump-version.js'], { cwd: root, encoding: 'utf8' });
if (res.status !== 0) {
    console.error(`auto-bump: no se pudo avanzar la versión.\n${res.stderr || res.stdout}`);
    process.exit(0);       // no bloquea el cierre del turno
}
storeFingerprint(root);
console.log(JSON.stringify({ systemMessage: `Versión avanzada automáticamente: ${before} → ${currentVersion()}` }));
