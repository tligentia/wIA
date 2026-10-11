/**
 * test-webgpu-load — acelerador de carga de modelos en el navegador.
 *
 * Cubre las decisiones que dependen del entorno y que, si se rompen, no dan
 * error sino simplemente cargas lentas (o descargas de la variante equivocada):
 * elección de cuantización según GPU y conexión, memoización del escaneo de
 * caché, y precalentado del runtime.
 *
 * Uso: npm run test:webgpu
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { resolve } from 'node:path';
import { classicSource } from './lib/generated-blocks.mjs';

const root = process.cwd();
const read = (p) => classicSource(readFileSync, resolve(root, p));

const noopEl = () => ({
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, removeAttribute() {}, addEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    style: {}, dataset: {}, textContent: '', innerHTML: '', value: '',
});

const sandbox = {
    document: {
        querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
        createElement: () => noopEl(), addEventListener() {},
        documentElement: { setAttribute() {} },
        body: { classList: { toggle() {}, add() {}, remove() {} } },
        head: { appendChild() {} }, hidden: false,
    },
    navigator: { userAgent: 'node', languages: ['es'], maxTouchPoints: 0, hardwareConcurrency: 8, gpu: null },
    console: { ...console, warn() {}, error() {}, log() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => Date.now(), memory: null },
    crypto: { randomUUID: () => 'id', subtle: null, getRandomValues: (a) => a },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    indexedDB: { open: () => ({}) },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    requestIdleCallback: (fn) => setTimeout(fn, 0),
    fetch: () => Promise.reject(new Error('sin red')),
    TextEncoder, TextDecoder, AbortSignal: globalThis.AbortSignal,
    URL, URLSearchParams,
    Worker: class { postMessage() {} terminate() {} },
    DOMParser: class { parseFromString() { return { body: { querySelectorAll: () => [], innerHTML: '' } }; } },
};
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
sandbox.window.location = { protocol: 'https:', host: 'x', origin: 'https://x', hostname: 'x' };
sandbox.window.matchMedia = () => ({ matches: false, addEventListener() {} });
createContext(sandbox);

for (const f of ['js/01-core.js', 'js/02-state.js', 'js/03-webgpu.js', 'js/04-providers.js']) {
    runInContext(read(f), sandbox, { filename: f });
}

let failures = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failures++;
};
const run = (e) => runInContext(e, sandbox);

// ── 1. Cuantización según hardware ───────────────────────────────────
{
    const conGpuF16 = run(`adaptDtypesToDevice(['q4f16', 'q4'], 'webgpu', true)`);
    check('con GPU y f16 se respeta el catálogo', conGpuF16.join() === 'q4f16,q4', conGpuF16.join());

    const sinF16 = run(`adaptDtypesToDevice(['q4f16', 'q4'], 'webgpu', false)`);
    check('sin shader-f16 se degradan las variantes f16', !sinF16.includes('q4f16'), sinF16.join());
    check('y no se duplican al degradar', new Set(sinF16).size === sinF16.length, sinF16.join());

    const enWasm = run(`adaptDtypesToDevice(['q4f16', 'fp16'], 'wasm', true)`);
    check('en WASM no queda ninguna variante f16',
        !enWasm.some(d => d.includes('f16')), enWasm.join());
}

// ── 2. Cuantización según conexión ───────────────────────────────────
{
    // Conexión buena: manda el orden del catálogo (calidad primero).
    run(`navigator.connection = { effectiveType: '4g', downlink: 30, saveData: false };`);
    const rapida = run(`prioritizeDtypesForConditions(['q8', 'q4'])`);
    check('con buena conexión se respeta el orden del catálogo', rapida.join() === 'q8,q4', rapida.join());

    // Conexión lenta: primero lo más ligero, que es lo que domina la espera.
    run(`navigator.connection = { effectiveType: '3g', downlink: 1.2, saveData: false };`);
    const lenta = run(`prioritizeDtypesForConditions(['q8', 'q4'])`);
    check('con conexión lenta se prioriza la variante más ligera', lenta[0] === 'q4', lenta.join());

    // Ahorro de datos activo cuenta como conexión lenta aunque sea rápida.
    run(`navigator.connection = { effectiveType: '4g', downlink: 30, saveData: true };`);
    const ahorro = run(`prioritizeDtypesForConditions(['fp32', 'q4f16'])`);
    check('el ahorro de datos también prioriza lo ligero', ahorro[0] === 'q4f16', ahorro.join());
    check('describeNetwork detecta el ahorro de datos', run('describeNetwork().saveData') === true);

    // Nunca se inventa una variante que el catálogo no declare.
    const originales = run(`prioritizeDtypesForConditions(['q4'])`);
    check('no se añaden variantes inexistentes', originales.join() === 'q4', originales.join());

    run(`delete navigator.connection;`);
    check('sin API de red no se reordena nada',
        run(`prioritizeDtypesForConditions(['q8','q4']).join()`) === 'q8,q4');
}

// ── 3. Escaneo de caché memoizado ────────────────────────────────────
{
    run(`
        globalThis.__scans = 0;
        caches = {
            keys: async () => ['transformers-cache'],
            open: async () => ({
                keys: async () => { __scans++; return [
                    { url: 'https://huggingface.co/onnx-community/Llama-3.2-1B-Instruct-ONNX/resolve/main/model.onnx' },
                ]; },
            }),
        };
        invalidateWebGPUCacheScan();
    `);

    const a = await run('getCachedWebGPUModels()');
    check('detecta el modelo cacheado', a.has('onnx-community/Llama-3.2-1B-Instruct-ONNX'), [...a].join());

    await run('getCachedWebGPUModels()');
    await run('getCachedWebGPUModels()');
    check('las llamadas seguidas reutilizan el escaneo', run('__scans') === 1, `${run('__scans')} escaneos`);

    await run('getCachedWebGPUModels({ force: true })');
    check('force vuelve a escanear', run('__scans') === 2, `${run('__scans')} escaneos`);

    run('invalidateWebGPUCacheScan();');
    await run('getCachedWebGPUModels()');
    check('invalidar obliga a reescanear', run('__scans') === 3, `${run('__scans')} escaneos`);
}

// ── 4. Precalentado del runtime ──────────────────────────────────────
{
    run(`
        globalThis.__primes = 0;
        webgpuBoot.primed = false; webgpuBoot.promise = null;
        decideWebGPUExecutionMode = async () => 'worker';
        webgpuWorker.broken = false;
        webgpuWorker.call = async (msg) => { if (msg.type === 'prime') { __primes++; await new Promise(r => setTimeout(r, 10)); } return { type: 'done' }; };
    `);

    const ok = await run('primeWebGPURuntime()');
    check('el precalentado se completa', ok === true);
    check('deja marcado que el runtime está listo', run('webgpuBoot.primed') === true);
    check('registra cuánto ha tardado', Number.isFinite(run('webgpuBoot.timings.prime')));

    await run('primeWebGPURuntime()');
    check('no vuelve a precalentar si ya está hecho', run('__primes') === 1, `${run('__primes')} veces`);

    // Concurrencia: varias llamadas a la vez comparten una sola operación.
    run(`webgpuBoot.primed = false; webgpuBoot.promise = null; __primes = 0;`);
    await run('Promise.all([primeWebGPURuntime(), primeWebGPURuntime(), primeWebGPURuntime()])');
    check('las llamadas simultáneas se coalescen', run('__primes') === 1, `${run('__primes')} veces`);
}

// ── 5. Un fallo al precalentar no puede romper nada ──────────────────
{
    run(`
        webgpuBoot.primed = false; webgpuBoot.promise = null;
        decideWebGPUExecutionMode = async () => { throw new Error('sin worker ni red'); };
    `);
    const ok = await run('primeWebGPURuntime()');
    check('un fallo de precalentado se degrada en silencio', ok === false);
    check('y no deja el runtime marcado como listo', run('webgpuBoot.primed') === false);
    check('ni deja una promesa colgada', run('webgpuBoot.promise') === null);
}

// ── 6. El precalentado solo se programa con WebGPU activo ────────────
{
    run(`
        webgpuBoot.primed = false; webgpuBoot.promise = null; __primes = 0;
        decideWebGPUExecutionMode = async () => 'worker';
        state.settings.provider = 'openai';
        scheduleWebGPUPriming();
    `);
    await new Promise(r => setTimeout(r, 30));
    check('con otro motor no se precalienta nada', run('__primes') === 0, `${run('__primes')} veces`);

    run(`state.settings.provider = 'webgpu'; scheduleWebGPUPriming();`);
    await new Promise(r => setTimeout(r, 60));
    check('con WebGPU activo sí se precalienta', run('__primes') === 1, `${run('__primes')} veces`);
}

// ── 7. Runtime auto-alojado con respaldo al CDN ──────────────────────
// El runtime se sirve desde lib/ para que el service worker lo cachee (WebGPU
// sin conexión y sin depender de un tercero). Si esa copia falta —despliegue
// parcial, fichero borrado, file://— hay que caer al CDN en vez de quedarse sin
// inferencia. Aquí se comprueba la DECISIÓN; que el import real se reintente
// contra el CDN se verifica en el navegador.
{
    // Un servidor correcto: todo existe y el JS se sirve como JavaScript.
    const okJs = `fetch = async () => ({ ok: true, headers: { get: () => 'text/javascript' } });`;

    // 7a. Copia local completa → módulo y .wasm del propio origen.
    run(`_transformersSources = null; ${okJs}`);
    let src = await run('resolveTransformersSources()');
    check('con la copia local presente se sirve del propio origen', src.origin === 'local', src.origin);
    check('el módulo apunta a lib/', src.moduleUrl.includes('lib/transformers.min.js'));
    check('y los .wasm a lib/ort/', src.wasmPaths.includes('lib/ort/'));

    // 7b. Nada en local → CDN completo.
    run(`_transformersSources = null; fetch = async () => ({ ok: false, headers: { get: () => 'text/javascript' } });`);
    src = await run('resolveTransformersSources()');
    check('sin copia local se recurre al CDN', src.origin === 'cdn', src.origin);
    check('módulo desde jsdelivr', src.moduleUrl.startsWith('https://cdn.jsdelivr.net'));
    check('y .wasm desde jsdelivr', src.wasmPaths.startsWith('https://cdn.jsdelivr.net'));

    // 7c. Está el módulo pero falta el binario grande: el caso realista de un
    // despliegue que se dejó los 21 MB por el camino.
    run(`_transformersSources = null; fetch = async (url) => ({ ok: !String(url).endsWith('.wasm'), headers: { get: () => 'text/javascript' } });`);
    src = await run('resolveTransformersSources()');
    check('si falta solo el .wasm se mezclan orígenes', src.origin === 'mixto', src.origin);
    check('el .wasm cae al CDN', src.wasmPaths.startsWith('https://cdn.jsdelivr.net'));
    check('y el módulo sigue siendo el local', src.moduleUrl.includes('lib/'));

    // 7d. Sin red (el sondeo lanza): no debe romper, sino decidir CDN.
    run(`_transformersSources = null; fetch = async () => { throw new Error('sin red'); };`);
    src = await run('resolveTransformersSources()');
    check('un sondeo que falla no rompe la resolución', src.origin === 'cdn', src.origin);
    check('wasmPaths se fija siempre, nunca queda vacío', typeof src.wasmPaths === 'string' && src.wasmPaths.length > 0);

    // 7e. El .mjs existe pero el servidor no conoce la extensión y lo manda como
    // octet-stream: con nosniff el navegador no lo ejecutaría, así que debe
    // contar como no disponible (este fallo real se detectó en el navegador).
    run(`
        _transformersSources = null;
        fetch = async (url) => ({
            ok: true,
            headers: { get: () => String(url).endsWith('.mjs') ? 'application/octet-stream' : 'text/javascript' },
        });
    `);
    src = await run('resolveTransformersSources()');
    check('un .mjs con MIME erróneo manda los .wasm al CDN', src.wasmPaths.startsWith('https://cdn.jsdelivr.net'), src.origin);
    check('y no se queda en «local» fingiendo que todo va bien', src.origin !== 'local', src.origin);

    // 7f. La decisión se toma una sola vez (no se re-sondea en cada carga).
    // Aunque ahora el servidor responda perfecto, no debe volver a sondear:
    // la decisión anterior sigue en pie.
    const antes = src.origin;
    run(okJs);
    const cached = await run('resolveTransformersSources()');
    check('la decisión queda memoizada', cached.origin === antes, `${antes} → ${cached.origin}`);
}

console.log(failures === 0 ? '\n✔ Acelerador de carga WebGPU correcto.' : `\n✖ ${failures} fallo(s).`);
process.exitCode = failures === 0 ? 0 : 1;
