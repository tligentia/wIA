/**
 * check-csp — la política de seguridad no puede desincronizarse.
 *
 * Verifica que:
 *   1) las cuatro copias de la CSP (index.html, server.js, .htaccess,
 *      vercel.json) coinciden con la fuente única de scripts/csp-policy.mjs;
 *   2) la política mantiene las garantías que la hacen útil (sin
 *      'unsafe-inline' ni 'unsafe-eval' en script-src, object-src cerrado);
 *   3) no ha vuelto a colarse ningún manejador on* ni ningún <script> en línea
 *      en el HTML o en las plantillas del JS — con uno solo, la CSP deja de
 *      proteger y encima rompe la funcionalidad en silencio.
 *
 * Uso: npm run check:csp
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CSP_POLICY } from './csp-policy.mjs';
import { classicSource } from './lib/generated-blocks.mjs';

const root = process.cwd();
const read = (p) => classicSource(readFileSync, resolve(root, p));

let failures = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failures++;
};

// ── 1. Las cuatro copias coinciden ───────────────────────────────────
check('index.html declara la política', read('index.html').includes(CSP_POLICY));
check('server.js declara la política', read('server.js').includes(CSP_POLICY));
check('.htaccess declara la política', read('.htaccess').includes(CSP_POLICY));
{
    const vercel = JSON.parse(read('vercel.json'));
    const header = vercel.headers?.[0]?.headers?.find((h) => h.key === 'Content-Security-Policy');
    const ok = header?.value === CSP_POLICY;
    check('vercel.json declara la política', ok, ok ? '' : (header ? 'valor distinto' : 'cabecera ausente'));
}

// ── 2. La política conserva sus garantías ────────────────────────────
{
    const scriptSrc = CSP_POLICY.split(';').map(s => s.trim()).find(d => d.startsWith('script-src'));
    check('script-src NO permite scripts en línea', !scriptSrc.includes("'unsafe-inline'"), scriptSrc);
    check('script-src NO permite eval()', !/'unsafe-eval'/.test(scriptSrc), scriptSrc);
    check('script-src sí permite WebAssembly', scriptSrc.includes("'wasm-unsafe-eval'"));
    check('object-src está cerrado', CSP_POLICY.includes("object-src 'none'"));
    check('base-uri está fijado', CSP_POLICY.includes("base-uri 'self'"));
}

// ── 3. Nada que la CSP vaya a bloquear ───────────────────────────────
const sources = [
    { file: 'index.html', code: read('index.html') },
    ...readdirSync(join(root, 'js'))
        .filter((f) => f.endsWith('.js'))
        .map((f) => ({ file: `js/${f}`, code: read(join('js', f)) })),
];

{
    const offenders = [];
    for (const { file, code } of sources) {
        // Atributos on* con un manejador dentro (se ignoran los data-* y las
        // menciones en comentarios, que no llevan comilla de apertura pegada).
        for (const m of code.matchAll(/\son(?:click|change|input|submit|load|error|keydown|keyup|mouseover|focus|blur)\s*=\s*["']/gi)) {
            const line = code.slice(0, m.index).split('\n').length;
            offenders.push(`${file}:${line}`);
        }
    }
    check('ningún atributo on* en el HTML ni en las plantillas', offenders.length === 0,
        offenders.slice(0, 8).join(', '));
}

{
    // <script> sin src y con contenido ejecutable. Los bloques de datos
    // (application/ld+json) no los ejecuta el navegador y no los bloquea la CSP.
    const inline = [];
    for (const m of read('index.html').matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
        const attrs = m[1] || '';
        const body = (m[2] || '').trim();
        if (/\ssrc\s*=/.test(attrs)) continue;
        if (/type\s*=\s*["']application\/(ld\+json|json)["']/i.test(attrs)) continue;
        if (!body) continue;
        inline.push(`línea ${read('index.html').slice(0, m.index).split('\n').length}`);
    }
    check('ningún <script> ejecutable en línea en index.html', inline.length === 0, inline.join(', '));
}

{
    // Todo lo que la app carga como script tiene que estar permitido por la CSP.
    const allowed = CSP_POLICY.split(';').map(s => s.trim()).find(d => d.startsWith('script-src'));
    const externos = [...read('index.html').matchAll(/<script[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
    const fuera = externos.filter((src) => {
        if (!/^https?:\/\//i.test(src)) return false; // relativo → 'self'
        try { return !allowed.includes(new URL(src).origin); } catch { return true; }
    });
    check(`los ${externos.length} scripts del HTML están permitidos`, fuera.length === 0, fuera.join(', '));
}

console.log(failures === 0 ? '\n✔ CSP coherente y sin código en línea.' : `\n✖ ${failures} problema(s).`);
process.exitCode = failures === 0 ? 0 : 1;
