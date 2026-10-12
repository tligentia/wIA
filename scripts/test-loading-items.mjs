/**
 * test-loading-items — la tarjeta de carga de un modelo enseña por separado cada
 * descarga (varios ficheros a la vez) y la instalación.
 *
 * Uso: npm run test:loading
 */
import { createChatHarness, settle } from './harness-chat.mjs';

let failures = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failures++;
};

const h = createChatHarness({ handler: async () => { throw new Error('sin red'); } });
const run = (code) => JSON.parse(h.run(`JSON.stringify((() => { ${code} })())`));

console.log('1. Seguimiento por fichero\n');
{
    const r = run(`
        const t = createLoadFilesTracker();
        t.track({ status: 'initiate', file: 'tokenizer.json' });
        t.track({ status: 'initiate', file: 'onnx/model_q4.onnx' });
        t.track({ status: 'progress', file: 'onnx/model_q4.onnx', loaded: 50, total: 200 });
        t.track({ status: 'progress', file: 'tokenizer.json', loaded: 10, total: 10 });
        t.track({ status: 'done', file: 'tokenizer.json' });
        const a = t.snapshot();
        t.track({ status: 'progress', file: 'onnx/model_q4.onnx', loaded: 200, total: 200 });
        return { a, b: t.snapshot(), pct: overallLoadPct(a, 0), one: overallLoadPct([a[0]], 77) };
    `);
    const tok = r.a.find(f => f.file === 'tokenizer.json'), onnx = r.a.find(f => f.file.endsWith('.onnx'));
    check('cada fichero tiene su propio estado', tok.state === 'done' && onnx.state === 'downloading' && onnx.pct === 25, JSON.stringify(r.a));
    check('al completarse, el fichero pasa a «done»', r.b.every(f => f.state === 'done'));
    check('el porcentaje global suma bytes de todos', r.pct === Math.round(((10 + 50) / 210) * 100), String(r.pct));
    check('con un solo fichero se respeta el porcentaje propio', r.one === 77);
}

console.log('\n2. Tarjeta de carga\n');
{
    const html = (loading) => h.run(`renderLoadingState(${JSON.stringify(loading)})`);
    const items = [
        { file: 'onnx/model_q4.onnx', loaded: 50 * 1048576, total: 200 * 1048576, pct: 25, state: 'downloading' },
        { file: 'tokenizer.json', loaded: 2048, total: 2048, pct: 100, state: 'done' },
        { file: 'config.json', loaded: 0, total: 0, pct: 0, state: 'pending' },
    ];
    const multi = html({ active: true, phase: 'downloading', progress: 25, progressLabel: 'Descarga', items });
    check('varias descargas: una fila por elemento', (multi.match(/loading-card-item is-/g) || []).length === 4, 'filas=' + (multi.match(/loading-card-item is-/g) || []).length);
    check('muestra los nombres y los bytes', multi.includes('model_q4.onnx') && multi.includes('50.0 MB / 200.0 MB'));
    check('la instalación va aparte y aún pendiente', multi.includes('Instalación') && multi.includes('is-pending'));
    const inst = html({ active: true, phase: 'installing', progress: 84, progressLabel: 'Instalando', items });
    check('en la fase de instalación, su fila muestra el avance', inst.includes('is-active') && inst.includes('84%') && inst.includes('Instalando'));
    const single = html({ active: true, phase: 'downloading', progress: 40, progressLabel: 'Descarga', items: [items[0]] });
    check('con un solo elemento se mantiene la barra única', !single.includes('loading-card-items') && single.includes('40%'));
    const none = html({ active: true, phase: 'downloading', progress: 10, progressLabel: 'Descarga' });
    check('sin datos por fichero, igual que antes', !none.includes('loading-card-items') && none.includes('10%'));
}

await settle();
if (failures) { console.error(`\n✖ ${failures} comprobaciones fallidas.`); process.exit(1); }
console.log('\n✔ Tarjeta de carga con descargas separadas correcta.');
process.exit(0);
