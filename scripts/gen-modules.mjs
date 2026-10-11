/**
 * gen-modules — el grafo de módulos ES de js/ (imports y exports reales).
 *
 * Cada js/NN-*.js es un módulo ES. Sus `import` y `export` NO se escriben a
 * mano: se calculan con un análisis de ámbitos exacto (scripts/lib/module-graph)
 * y se mantienen entre marcadores al principio y al final de cada fichero.
 * `npm run gen:modules` los regenera; `npm run check:modules` (parte de
 * `npm test`) falla si algo está desactualizado.
 *
 * Reglas que además se vigilan, porque son las que hacen que esto funcione:
 *
 *  · ORDEN DE EVALUACIÓN. El código de arranque de unos módulos usa lo de otros al
 *    cargar, y hasta ahora el orden de los <script> lo garantizaba (01 → 12). En
 *    ESM el orden lo da el grafo, y con ciclos (chat ↔ interfaz ↔ proyectos) una
 *    `const` de un módulo aún no evaluado da error. Se conserva el orden porque
 *    (a) ningún módulo usa AL CARGAR nada de uno posterior —se comprueba aquí— y
 *    (b) el PRIMER import de cada módulo es el del anterior (NN-1) y el punto de
 *    entrada (js/main.js) importa el último: la evaluación recorre la cadena hasta
 *    el 01, que se evalúa primero, y vuelve evaluando 02, 03… en orden.
 *  · UN `import` NO SE PUEDE REASIGNAR. Un módulo que asignara una variable de otro
 *    fallaría en ejecución; se vigila que no ocurra (el dueño expone una función).
 *  · LA VERSIÓN VA EN LA URL (`?v=`). Un navegador con el service worker anterior
 *    servía el index.html nuevo con los JS viejos de su caché. El token sale de
 *    CACHE en sw.js y se escribe en los imports, en index.html y en el precache.
 *
 * Uso: node --expose-internals scripts/gen-modules.mjs [--check]
 *      (npm run gen:modules / npm run check:modules)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { analyze, stripGenerated, IMPORTS_START, IMPORTS_END, EXPORTS_START, EXPORTS_END } from './lib/module-graph.mjs';

const CHECK = process.argv.includes('--check');
const problems = [];
let written = 0;

const sw = readFileSync('sw.js', 'utf8');
const TOKEN = /const CACHE = 'wia-shell-v([^']+)'/.exec(sw)?.[1];
if (!TOKEN) { console.error('✖ No se encontró «const CACHE = \'wia-shell-v…\'» en sw.js'); process.exit(1); }

const files = readdirSync('js').filter((f) => /^\d\d-[\w-]+\.js$/.test(f)).sort();
const spec = (f) => `./${f}?v=${TOKEN}`;

// ── Análisis ───────────────────────────────────────────────────────────────
const clean = {}, info = {}, owner = new Map();
for (const f of files) {
    clean[f] = stripGenerated(readFileSync(join('js', f), 'utf8'));
    info[f] = analyze(clean[f], f);
    for (const name of info[f].top.keys()) {
        if (owner.has(name)) problems.push(`«${name}» se declara en ${owner.get(name)} y en ${f}`);
        else owner.set(name, f);
    }
}

const imports = {};   // f → Map(otroFichero → Set(nombres))
const exported = {};  // f → Set(nombres que algún otro módulo usa)
files.forEach((f) => { imports[f] = new Map(); exported[f] = new Set(); });
for (const f of files) {
    for (const [name, use] of info[f].free) {
        const o = owner.get(name);
        if (!o || o === f) continue;
        if (!imports[f].has(o)) imports[f].set(o, new Set());
        imports[f].get(o).add(name);
        exported[o].add(name);
        if (use.assigned) problems.push(`${f} asigna «${name}», que es de ${o} (un import no se puede reasignar: que ${o} exponga una función)`);
        if (use.load && o > f) problems.push(`${f} usa «${name}» de ${o} AL CARGAR, pero ${o} se evalúa después`);
    }
}

// ── Generación ──────────────────────────────────────────────────────────────
const wrap = (names, indent = '    ', width = 96) => {
    const lines = []; let cur = indent;
    for (const n of names) {
        const piece = n + ', ';
        if (cur.length + piece.length > width && cur.trim()) { lines.push(cur.replace(/\s+$/, '')); cur = indent; }
        cur += piece;
    }
    if (cur.trim()) lines.push(cur.replace(/,?\s+$/, ','));
    return lines.join('\n');
};

function importsBlock(f, idx) {
    const prev = idx > 0 ? files[idx - 1] : null;
    const order = [...imports[f].keys()].filter((o) => o !== prev).sort();
    const stmts = [];
    const stmt = (o, names) => names.length
        ? `import {\n${wrap(names)}\n} from '${spec(o)}';`
        : `import '${spec(o)}';`;
    if (prev) stmts.push(stmt(prev, [...(imports[f].get(prev) || [])].sort()));
    for (const o of order) stmts.push(stmt(o, [...imports[f].get(o)].sort()));
    if (!stmts.length) return '';
    return `${IMPORTS_START}\n// El primer import es el del módulo anterior: así se evalúan en orden (ver scripts/gen-modules.mjs).\n${stmts.join('\n')}\n${IMPORTS_END}\n\n`;
}

function exportsBlock(f) {
    const declared = [...info[f].top.keys()].filter((n) => exported[f].has(n));
    if (!declared.length) return '';
    return `\n${EXPORTS_START}\nexport {\n${wrap(declared)}\n};\n${EXPORTS_END}\n`;
}

function emit(path, next) {
    const prevText = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (prevText === next) return;
    if (CHECK) problems.push(`${path}: desactualizado`);
    else { writeFileSync(path, next); written++; }
}

files.forEach((f, idx) => emit(join('js', f), importsBlock(f, idx) + clean[f].replace(/\s+$/, '\n') + exportsBlock(f)));

emit('js/main.js', `/* wIA — js/main.js: punto de entrada (generado por scripts/gen-modules.mjs).
   Importa el ÚLTIMO módulo; cada uno importa primero al anterior, así que la
   evaluación recorre la cadena hasta 01-core y vuelve en orden 01 → ${files[files.length - 1].slice(0, 2)}. */
import '${spec(files[files.length - 1])}';
`);

// ── Versión en index.html y en el precache del SW ──────────────────────────
const html = readFileSync('index.html', 'utf8');
const htmlNext = html.replace(/(<script type="module" src="js\/main\.js)\?v=[^"]*"/, `$1?v=${TOKEN}"`);
if (!/<script type="module" src="js\/main\.js\?v=/.test(html)) problems.push('index.html no carga js/main.js como módulo');
emit('index.html', htmlNext);
const swNext = sw.replace(/'\.\/js\/([\w-]+\.js)\?v=[^']*'/g, `'./js/$1?v=${TOKEN}'`);
for (const f of [...files, 'main.js']) if (!sw.includes(`'./js/${f}?v=`)) problems.push(`sw.js no precachea js/${f}`);
emit('sw.js', swNext);

const edges = files.reduce((n, f) => n + imports[f].size, 0);
const names = files.reduce((n, f) => n + exported[f].size, 0);
console.log(`${files.length} módulos · ${edges} dependencias entre ficheros · ${names} nombres compartidos · versión ${TOKEN}`);
if (problems.length) {
    console.error(`\n✖ ${problems.length} problema(s):\n` + problems.map((p) => '  · ' + p).join('\n'));
    if (CHECK) console.error('\nEjecuta: npm run gen:modules');
    process.exit(1);
}
console.log(CHECK ? '✔ Grafo de módulos al día.' : `✔ Generado (${written} fichero(s) actualizados).`);
