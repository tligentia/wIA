/**
 * test-auto-bump — la versión avanza SIEMPRE que se modifica algo, y solo una
 * vez por modificación, sea por el hook de pre-commit o por el avance
 * automático de fin de turno (scripts/auto-bump.mjs).
 *
 * Se prueba en un repositorio git temporal para no tocar la versión real.
 *
 * Uso: npm run test:auto-bump
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

let failures = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failures++;
};

const tmp = mkdtempSync(join(tmpdir(), 'wia-autobump-'));
try {
    for (const p of ['js', 'scripts', 'Plantilla', '.githooks', 'index.html', 'sw.js', 'package.json', 'README.md']) {
        cpSync(p, join(tmp, p), { recursive: true });
    }
    const run = (cmd, args, env = {}) => spawnSync(cmd, args, { cwd: tmp, encoding: 'utf8', env: { ...process.env, ...env } });
    const git = (...a) => run('git', a);
    const sequence = () => /VERSION_SEQUENCE = '([A-Z]{2})'/.exec(readFileSync(join(tmp, 'Plantilla/Version.js'), 'utf8'))?.[1];
    const auto = () => run(process.execPath, ['scripts/auto-bump.mjs']);
    const touch = (text) => appendFileSync(join(tmp, 'js/11-rag.js'), `\n// ${text}\n`);

    git('init', '-q');
    git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
    git('config', 'core.hooksPath', '.githooks');
    git('add', '-A');
    git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'base');
    const base = sequence();

    check('árbol limpio: no avanza', auto().stdout === '' && sequence() === base, base);

    touch('uno');
    const first = auto();
    const afterFirst = sequence();
    check('una modificación avanza la versión una vez', afterFirst !== base && /Versión avanzada/.test(first.stdout), `${base} → ${afterFirst}`);
    check('sin novedades no vuelve a avanzar', auto().stdout === '' && sequence() === afterFirst);

    touch('dos');
    const afterSecond = (auto(), sequence());
    check('otra modificación avanza otra vez', afterSecond !== afterFirst, `${afterFirst} → ${afterSecond}`);

    git('add', '-A');
    const commit = git('commit', '-qm', 'cambios');
    check('commit con la versión ya avanzada no la repite', sequence() === afterSecond && commit.status === 0, sequence());
    check('tras el commit el árbol queda limpio', git('status', '--porcelain').stdout.trim() === '');
    check('árbol limpio tras commit: auto-bump no actúa', auto().stdout === '' && sequence() === afterSecond);

    touch('tres');
    git('add', '-A');
    const hooked = git('commit', '-qm', 'solo hook');
    const afterHook = sequence();
    check('el hook de pre-commit avanza cuando nadie lo hizo', afterHook !== afterSecond && hooked.status === 0, `${afterSecond} → ${afterHook}`);
    check('y la versión nueva entra en el mismo commit', git('status', '--porcelain').stdout.trim() === '');

    touch('cuatro');
    run(process.execPath, ['scripts/bump-version.js']);
    const manual = sequence();
    check('bump manual + auto-bump no se duplican', auto().stdout === '' && sequence() === manual, manual);
} finally {
    rmSync(tmp, { recursive: true, force: true });
}

if (failures) { console.error(`\n✖ ${failures} comprobaciones fallidas.`); process.exit(1); }
console.log('\n✔ La versión avanza siempre, y una sola vez por modificación.');
