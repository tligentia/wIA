/**
 * generated-blocks — regiones que genera scripts/gen-modules.mjs dentro de js/*.js.
 *
 * Sin dependencias: lo importan también las pruebas, que cargan los módulos como
 * scripts clásicos en un contexto `vm` (donde `import`/`export` no existen y
 * todos los nombres ya son globales) quitando estas dos regiones.
 */
export const IMPORTS_START = '/* >>> imports (generado por scripts/gen-modules.mjs: no editar a mano) >>> */';
export const IMPORTS_END = '/* <<< imports <<< */';
export const EXPORTS_START = '/* >>> exports (generado por scripts/gen-modules.mjs: no editar a mano) >>> */';
export const EXPORTS_END = '/* <<< exports <<< */';

/** Quita las regiones de imports y exports y devuelve el código «limpio». */
export function stripGenerated(src) {
    let out = src;
    for (const [a, b] of [[IMPORTS_START, IMPORTS_END], [EXPORTS_START, EXPORTS_END]]) {
        const i = out.indexOf(a);
        if (i === -1) continue;
        const j = out.indexOf(b, i);
        if (j === -1) throw new Error(`Falta el marcador de cierre ${b}`);
        out = out.slice(0, i) + out.slice(j + b.length);
    }
    return out.replace(/^\s+/, '').replace(/\s+$/, '') + '\n';
}

/** Lee un fichero de la app tal como lo necesita un script clásico (para las pruebas en vm). */
export function classicSource(readFileSync, path) {
    const text = readFileSync(path, 'utf8');
    return /(^|\/)js\/\d\d-[\w-]+\.js$/.test(path.replace(/\\/g, '/')) ? stripGenerated(text) : text;
}
