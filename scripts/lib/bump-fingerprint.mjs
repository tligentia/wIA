/**
 * bump-fingerprint — huella del trabajo sin commitear, para saber si hay
 * cambios NUEVOS desde el último avance de versión.
 *
 * Por qué: la versión debe avanzar con cada modificación, pero un hook que
 * corre al final de cada turno de Claude no puede subirla otra vez si no se ha
 * tocado nada. La huella se calcula sobre el contenido de los ficheros
 * modificados o nuevos, con la propia versión normalizada (el bump cambia la
 * versión en ~15 ficheros; eso no cuenta como una modificación).
 *
 * Se guarda en `.git/` (nunca se commitea).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** Ficheros que el avance de versión toca: su contenido no es una «modificación». */
const VERSION_ONLY = new Set(['Plantilla/Version.js']);

/** Quita de un texto todo lo que depende de la versión. */
export function normalizeVersions(text) {
    return text
        .replace(/\bv?\d{4}\.[A-Z]{2}\b/g, '0000.XX')            // v2610.AG · ?v=2610.AG · wia-shell-v2610.AG
        .replace(/\bV\d{2}\.\d{2}[A-Z]{2}\b/g, 'V00.00XX')        // V26.10AG
        .replace(/const VERSION_(YEAR|MONTH) = \d+;/g, 'const VERSION_$1 = 0;')
        .replace(/const VERSION_SEQUENCE = '[A-Z]{2}';/g, "const VERSION_SEQUENCE = 'XX';");
}

/** Rutas con cambios sin commitear (modificadas, nuevas, borradas), sin ignoradas. */
export function changedPaths(root) {
    const parts = git(root, ['status', '--porcelain', '-z', '--untracked-files=all']).split('\0');
    const paths = [];
    for (let i = 0; i < parts.length; i++) {
        const entry = parts[i];
        if (entry.length < 4) continue;
        const code = entry.slice(0, 2);
        paths.push({ code, path: entry.slice(3) });
        if (/[RC]/.test(code)) i++;       // renombrado/copia: la ruta de origen va en la entrada siguiente
    }
    return paths;
}

/** Huella del estado de trabajo; '' si no hay cambios. */
export function computeFingerprint(root) {
    const entries = changedPaths(root);
    if (!entries.length) return '';
    const hash = createHash('sha1');
    for (const { code, path } of entries.sort((a, b) => a.path.localeCompare(b.path))) {
        if (VERSION_ONLY.has(path)) continue;
        hash.update(`${code}\0${path}\0`);
        const abs = join(root, path);
        if (!existsSync(abs)) continue;          // borrado: basta el código
        let buf;
        try { buf = readFileSync(abs); } catch { continue; }
        // Binario (imágenes, fuentes…): contenido tal cual. Texto: sin versiones.
        hash.update(buf.includes(0) ? buf : normalizeVersions(buf.toString('utf8')));
        hash.update('\0');
    }
    return hash.digest('hex');
}

export function fingerprintFile(root) {
    return resolve(root, git(root, ['rev-parse', '--git-path', 'wia-bump-fingerprint']).trim());
}

export function readFingerprint(root) {
    try { return readFileSync(fingerprintFile(root), 'utf8').trim(); } catch { return ''; }
}

export function storeFingerprint(root, value = computeFingerprint(root)) {
    try {
        const file = fingerprintFile(root);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, value + '\n');
        return true;
    } catch { return false; }
}
