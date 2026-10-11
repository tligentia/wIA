/**
 * test-bump — `npm run version:bump` deja el grafo de módulos coherente.
 *
 * Por qué: la versión va en la URL de cada import (`?v=`), en index.html y en el
 * precache del service worker. Si un bump olvidara alguno, el navegador serviría
 * HTML nuevo con JS viejos de la caché del SW y la app no arrancaría. Se prueba
 * en una copia temporal para no tocar la versión real.
 *
 * Uso: npm run test:bump
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

let failures = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failures++;
};

const tmp = mkdtempSync(join(tmpdir(), 'wia-bump-'));
try {
    for (const p of ['js', 'scripts', 'Plantilla', 'index.html', 'sw.js', 'package.json']) cpSync(p, join(tmp, p), { recursive: true });
    const run = (...args) => spawnSync(process.execPath, args, { cwd: tmp, encoding: 'utf8' });

    check('antes del bump el grafo está al día', run('--expose-internals', 'scripts/gen-modules.mjs', '--check').status === 0);

    const bump = run('scripts/bump-version.js');
    check('el bump termina bien', bump.status === 0, (bump.stderr || '').split('\n')[0]);
    const version = /Version actualizada a v([\w.]+)/.exec(bump.stdout)?.[1];
    check('anuncia la nueva versión', !!version, version);

    const tokens = new Set();
    for (const f of readdirSync(join(tmp, 'js')).filter((f) => f.endsWith('.js'))) {
        for (const m of readFileSync(join(tmp, 'js', f), 'utf8').matchAll(/\.js\?v=([^'"]+)'/g)) tokens.add(m[1]);
    }
    for (const m of readFileSync(join(tmp, 'index.html'), 'utf8').matchAll(/js\/main\.js\?v=([^"]+)"/g)) tokens.add(m[1]);
    for (const m of readFileSync(join(tmp, 'sw.js'), 'utf8').matchAll(/\.js\?v=([^']+)'/g)) tokens.add(m[1]);
    check('todos los imports, index.html y el precache llevan la versión nueva', tokens.size === 1 && tokens.has(version), [...tokens].join(','));
    check('la caché del SW tiene la misma versión', readFileSync(join(tmp, 'sw.js'), 'utf8').includes(`wia-shell-v${version}`));
    check('y el grafo queda al día (check:modules)', run('--expose-internals', 'scripts/gen-modules.mjs', '--check').status === 0);
} finally {
    rmSync(tmp, { recursive: true, force: true });
}

if (failures) { console.error(`\n✖ ${failures} comprobaciones fallidas.`); process.exit(1); }
console.log('\n✔ El bump de versión mantiene el grafo coherente.');
