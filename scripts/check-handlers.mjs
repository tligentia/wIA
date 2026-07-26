/**
 * check-handlers — verifica que toda función invocada desde un atributo
 * `onclick="…"` (en index.html o generada por plantillas de JS) existe realmente.
 *
 * Por qué: la app usa scripts clásicos con ámbito global compartido y muchos
 * manejadores en línea. Un renombrado o un borrado no da error hasta que el
 * usuario pulsa el botón, y entonces falla en silencio en la consola. Este
 * chequeo estático convierte ese fallo latente en un fallo de build.
 *
 * Uso: npm run check:handlers
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(process.cwd());
const jsDir = join(root, 'js');

const sourceFiles = [
    ...readdirSync(jsDir).filter((f) => f.endsWith('.js')).map((f) => join(jsDir, f)),
    join(root, 'secure-gate.js'),
    join(root, 'Plantilla', 'Version.js'),
];

const sources = sourceFiles.map((path) => ({ path, code: readFileSync(path, 'utf8') }));
const html = readFileSync(join(root, 'index.html'), 'utf8');

// ── Nombres definidos: `function X(`, `window.X =`, `const X = (`/`async` ──
const defined = new Set();
for (const { code } of sources) {
    for (const m of code.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) defined.add(m[1]);
    for (const m of code.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)) defined.add(m[1]);
    for (const m of code.matchAll(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/gm)) defined.add(m[1]);
}
// Globales del navegador que aparecen legítimamente en manejadores en línea.
const BROWSER_GLOBALS = new Set(['document', 'window', 'event', 'alert', 'confirm', 'console', 'navigator', 'this']);

// ── Nombres invocados desde onclick, tanto en el HTML como en las plantillas ──
const referenced = new Map(); // nombre → [orígenes]
const addRef = (name, origin) => {
    if (BROWSER_GLOBALS.has(name)) return;
    if (!referenced.has(name)) referenced.set(name, []);
    if (!referenced.get(name).includes(origin)) referenced.get(name).push(origin);
};

const scanHandlers = (text, origin) => {
    // Captura el cuerpo de cualquier on<evento>="…" / on<evento>='…'
    for (const m of text.matchAll(/\son[a-z]+\s*=\s*(["'])([\s\S]*?)\1/g)) {
        const body = m[2];
        // Llamadas de nivel superior: `nombre(` no precedido de `.`
        for (const call of body.matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
            addRef(call[1], origin);
        }
    }
};

scanHandlers(html, 'index.html');
for (const { path, code } of sources) {
    scanHandlers(code, path.replace(root, '').replace(/^[\\/]/, ''));
}

const missing = [...referenced.entries()].filter(([name]) => !defined.has(name));

console.log(`Manejadores en línea: ${referenced.size} funciones referenciadas, ${defined.size} definidas.`);

if (missing.length === 0) {
    console.log('\n✔ Todas las funciones invocadas desde atributos on* existen.');
    process.exit(0);
}

console.error('\n✖ Funciones referenciadas desde atributos on* que NO existen:\n');
for (const [name, origins] of missing) {
    console.error(`  · ${name}()  ←  ${origins.join(', ')}`);
}
process.exit(1);
