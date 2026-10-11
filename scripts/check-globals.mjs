/**
 * check-globals — nadie redefine en silencio lo de otro fichero.
 *
 * Los scripts de js/ son clásicos y comparten el ámbito global (unas 500
 * funciones y constantes). Eso tiene una trampa concreta: dos `function f()` en
 * ficheros distintos NO dan error, gana la última en cargarse y la otra deja de
 * existir sin aviso; dos `const` iguales sí dan SyntaxError, pero solo al cargar
 * el segundo fichero en el navegador. Esta comprobación los detecta antes.
 *
 * También avisa de nombres de nivel superior que sombrean APIs del navegador
 * (p. ej. una función `t` o `name` que pisara `window.name`).
 *
 * Uso: npm run check:globals
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const files = [
    ...readdirSync('js').filter((f) => f.endsWith('.js')).sort().map((f) => join('js', f)),
    'secure-gate.js', 'Plantilla/Version.js', 'portal-loader.js', 'lib/anonimae-engine.js',
];

// Declaraciones de nivel superior: empiezan en la columna 0.
const DECL = /^(?:export\s+)?(?:async\s+)?(function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/;
const seen = new Map();   // nombre → [{ file, line, kind }]
for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, i) => {
        const m = DECL.exec(text);
        if (!m) return;
        const list = seen.get(m[2]) || [];
        list.push({ file, line: i + 1, kind: m[1] });
        seen.set(m[2], list);
    });
}

const BROWSER_NAMES = new Set(['name', 'status', 'event', 'top', 'parent', 'self', 'length', 'origin', 'location', 'history', 'screen', 'print', 'close', 'stop', 'focus', 'blur', 'open', 'find', 'external']);
let failures = 0;
for (const [name, where] of seen) {
    if (where.length > 1) {
        failures++;
        console.error(`✖ «${name}» se declara ${where.length} veces:`);
        where.forEach((w) => console.error(`    ${w.file}:${w.line} (${w.kind})`));
    }
    if (BROWSER_NAMES.has(name)) {
        failures++;
        console.error(`✖ «${name}» pisa una propiedad global del navegador (${where[0].file}:${where[0].line})`);
    }
}

console.log(`Nombres globales: ${seen.size} en ${files.length} ficheros.`);
if (failures) { console.error(`\n✖ ${failures} problema(s).`); process.exit(1); }
console.log('\n✔ Sin duplicados ni sombras de APIs del navegador.');
