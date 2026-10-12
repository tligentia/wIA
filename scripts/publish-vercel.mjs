/**
 * publish-vercel — deja la versión actual en la URL fija de Vercel.
 *
 * Cada push a una rama genera un despliegue «Preview» con una URL aleatoria
 * (wia-xxxxxxxx-tligents-projects.vercel.app). Este script espera a que el
 * despliegue del commit actual esté listo y lo PROMUEVE (`vercel promote`) para
 * que la URL fija
 *
 *     https://wia-tligents-projects.vercel.app
 *
 * sirva siempre la última versión, sin depender de que la rama sea `main`.
 * Después comprueba que la URL fija responde con la versión del commit.
 *
 * Uso:  npm run publish:vercel [-- --dry-run]
 * Requisitos: haber hecho push del commit, `gh` y `vercel` con sesión iniciada.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const STABLE_URL = 'https://wia-tligents-projects.vercel.app';
const REPO = 'tligentia/wIA';
const SCOPE = 'tligents-projects';
const dryRun = process.argv.includes('--dry-run');

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`✖ ${msg}`); process.exit(1); };

const version = (() => {
    const src = readFileSync('Plantilla/Version.js', 'utf8');
    const y = /VERSION_YEAR = (\d+)/.exec(src)?.[1], m = /VERSION_MONTH = (\d+)/.exec(src)?.[1], q = /VERSION_SEQUENCE = '([A-Z]{2})'/.exec(src)?.[1];
    return `${y}${String(m).padStart(2, '0')}.${q}`;
})();

const sha = sh('git', ['rev-parse', 'HEAD']);
const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
try {
    sh('git', ['fetch', '-q', 'origin', branch]);
    if (sh('git', ['rev-parse', `origin/${branch}`]) !== sha) fail(`El commit actual (${sha.slice(0, 7)}) no está en origin/${branch}: haz push antes.`);
} catch (e) {
    fail(`No se pudo comprobar origin/${branch}: ${e.message.split('\n')[0]}`);
}

// 1) Esperar al despliegue de este commit.
let url = '';
for (let i = 0; i < 36 && !url; i++) {
    try {
        const id = sh('gh', ['api', `repos/${REPO}/deployments?sha=${sha}`, '--jq', '.[0].id']);
        if (id && id !== 'null') {
            const status = sh('gh', ['api', `repos/${REPO}/deployments/${id}/statuses`, '--jq', '.[0] | "\\(.state) \\(.environment_url // .target_url)"']);
            const [state, target] = status.split(' ');
            if (state === 'success') url = target;
            else if (state === 'failure' || state === 'error') fail(`El despliegue de ${sha.slice(0, 7)} ha fallado en Vercel.`);
        }
    } catch { /* aún no existe */ }
    if (!url) await sleep(5000);
}
if (!url) fail('Vercel no ha terminado el despliegue de este commit (timeout de 3 min).');
console.log(`Despliegue listo: ${url}`);

if (dryRun) {
    console.log(`(dry-run) promovería ${url} → ${STABLE_URL} (v${version})`);
    process.exit(0);
}

// 2) Promover ese despliegue: la URL fija pasa a servirlo. Con `builds` en vercel.json,
//    «promote» crea un despliegue de producción nuevo: tarda unos segundos y, a veces,
//    el primer intento falla de forma transitoria, así que se reintenta una vez.
const promote = () => {
    const res = spawnSync('vercel', ['promote', url, '--yes', '--non-interactive', '--scope', SCOPE], { encoding: 'utf8' });
    process.stdout.write(res.stdout || '');
    if (res.status !== 0) process.stderr.write(res.stderr || '');
    return res.status === 0;
};

const servedVersion = async () => {
    try {
        const body = await (await fetch(`${STABLE_URL}/Plantilla/Version.js?_=${Date.now()}`, { cache: 'no-store' })).text();
        const q = /VERSION_SEQUENCE = '([A-Z]{2})'/.exec(body)?.[1];
        const m = /VERSION_MONTH = (\d+)/.exec(body)?.[1];
        const y = /VERSION_YEAR = (\d+)/.exec(body)?.[1];
        return `${y}${String(m).padStart(2, '0')}.${q}`;
    } catch { return ''; }
};

// 3) Esperar a que la URL fija sirva esta versión (hasta ~2 min; un reintento a la mitad).
let served = '';
let ok = promote();
for (let i = 0; i < 24; i++) {
    served = await servedVersion();
    if (served === version) break;
    if (i === 11) { console.log('La URL fija aún no sirve la versión nueva: reintento la promoción…'); ok = promote() || ok; }
    await sleep(5000);
}
if (served !== version) fail(`${STABLE_URL} sirve v${served || '?'} y se esperaba v${version}${ok ? '' : ' (la promoción falló)'}.`);
console.log(`✔ ${STABLE_URL} sirve v${version}`);
