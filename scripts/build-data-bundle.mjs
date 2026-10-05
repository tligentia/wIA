/**
 * build-data-bundle — empaqueta los JSON de datos en `data-bundle.js`.
 *
 * Abierta con doble clic (file://), la app no puede leer sus JSON con fetch.
 * Este script los vuelca en un fichero JavaScript que sí se puede cargar con
 * <script>; js/01-core.js (loadLocalJson) recurre a él solo cuando fetch falla.
 *
 *   node scripts/build-data-bundle.mjs           regenera el fichero
 *   node scripts/build-data-bundle.mjs --check   falla si está desfasado
 *
 * Al añadir un JSON que la app lea en ejecución, añádelo a DATA_FILES.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export const DATA_FILES = [
    'lang/es.json', 'lang/en.json',
    'lang/docs/es.json', 'lang/docs/en.json',
    'agents.json',
    'lib/anonimae-rules.json',
    'webgpu-models.json',
];
const OUT = 'data-bundle.js';

export function buildBundle() {
    const data = {};
    for (const file of DATA_FILES) data[file] = JSON.parse(readFileSync(file, 'utf8'));
    return `/* wIA — data-bundle.js
   GENERADO por scripts/build-data-bundle.mjs: no editar a mano.
   Copia de los JSON de datos para cuando la app se abre como fichero local
   (file://), donde fetch no puede leerlos. Ver loadLocalJson en js/01-core.js. */
window.WIA_DATA = ${JSON.stringify(data)};
`;
}

if (process.argv[1] && process.argv[1].endsWith('build-data-bundle.mjs')) {
    const next = buildBundle();
    if (process.argv.includes('--check')) {
        const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
        if (current !== next) {
            console.error(`✖ ${OUT} está desfasado respecto a los JSON. Ejecuta: npm run build:data`);
            process.exit(1);
        }
        console.log(`✔ ${OUT} al día (${DATA_FILES.length} ficheros).`);
    } else {
        writeFileSync(OUT, next);
        console.log(`✔ ${OUT} generado (${(next.length / 1024).toFixed(0)} KB, ${DATA_FILES.length} ficheros).`);
    }
}
