/**
 * test-rag — recuperación por similitud sobre los documentos del proyecto.
 *
 * El modelo de embeddings real no se descarga aquí (son 120 MB y no hay red en
 * las pruebas): se sustituye por un codificador determinista de bolsa de
 * palabras. Eso permite verificar lo que de verdad puede romperse —el troceado,
 * la cuantización, el filtrado por umbral, el presupuesto de tokens, la
 * invalidación del índice y la degradación cuando falla— sin depender de la red.
 *
 * Uso: npm run test:rag
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';

const root = process.cwd();
const read = (p) => readFileSync(resolve(root, p), 'utf8');

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
    navigator: { userAgent: 'node', languages: ['es'], maxTouchPoints: 0, storage: null },
    console: { ...console, warn() {}, error() {}, log() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => Date.now() },
    crypto: webcrypto,
    localStorage: { _d: new Map(), getItem(k) { return this._d.get(k) ?? null; }, setItem(k, v) { this._d.set(k, v); }, removeItem(k) { this._d.delete(k); } },
    indexedDB: { open: () => ({}) },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    requestIdleCallback: (fn) => setTimeout(fn, 0),
    fetch: () => Promise.reject(new Error('sin red')),
    TextEncoder, TextDecoder, AbortSignal: globalThis.AbortSignal,
    alert: () => {},
    DOMParser: class { parseFromString() { return { body: { querySelectorAll: () => [], innerHTML: '' } }; } },
};
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
sandbox.window.location = { protocol: 'https:', host: 'x', origin: 'https://x', hostname: 'x' };
sandbox.window.matchMedia = () => ({ matches: false, addEventListener() {} });
createContext(sandbox);

for (const f of ['js/01-core.js', 'js/02-state.js', 'js/03-webgpu.js', 'js/04-providers.js',
                 'js/05-workspace.js', 'js/06-chat.js', 'js/09-i18n.js', 'js/11-rag.js']) {
    runInContext(read(f), sandbox, { filename: f });
}

// IndexedDB en memoria + modelo de embeddings simulado.
runInContext(`
    globalThis.__store = new Map();
    idbStore.get = async (k) => __store.get(k);
    idbStore.set = async (k, v) => { __store.set(k, v); return true; };
    idbStore.del = async (k) => { __store.delete(k); return true; };
    saveState = () => true;
    applySettingsToUI = () => {};

    // Codificador determinista: bolsa de palabras normalizada sobre un
    // vocabulario fijo. Da vectores comparables por coseno, que es lo único
    // que la lógica de recuperación necesita.
    globalThis.__embedCalls = 0;
    globalThis.__fakeEmbed = (text) => {
        // 512 dimensiones: con menos, palabras distintas colisionan en el mismo
        // cubo y la prueba de relevancia acaba midiendo colisiones, no ranking.
        const dim = 512;
        const v = new Array(dim).fill(0);
        for (const word of String(text).toLowerCase().match(/[a-záéíóúñ]+/g) || []) {
            let h = 0;
            for (let i = 0; i < word.length; i++) h = (h * 31 + word.charCodeAt(i)) | 0;
            v[Math.abs(h) % dim] += 1;
        }
        const norm = Math.hypot(...v) || 1;
        return v.map(x => x / norm);
    };
    loadRagPipeline = async () => {
        ragState.modelId = 'test/fake-embeddings';
        ragState.modelDef = { id: 'test/fake-embeddings', queryPrefix: '', passagePrefix: '' };
        ragState.pipeline = async (text) => { __embedCalls++; return { data: __fakeEmbed(text) }; };
        return ragState.pipeline;
    };
`, sandbox);

let failures = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failures++;
};
const run = (e) => runInContext(e, sandbox);

// Documento largo con tres temas bien separados.
const parrafo = (tema, relleno) => `${tema}. ${relleno.repeat(40)}`;
const DOC = [
    parrafo('El plazo de presentación de la declaración de la renta termina el 30 de junio', 'renta impuestos hacienda plazo declaración '),
    parrafo('La garantía del producto cubre defectos de fabricación durante 24 meses', 'garantía producto defecto fabricación reparación '),
    parrafo('El horario de atención al público es de lunes a viernes de 9 a 14', 'horario atención público lunes viernes oficina '),
].join('\n\n');

// ── 1. Troceado ──────────────────────────────────────────────────────
{
    const chunks = run(`chunkText(${JSON.stringify(DOC)})`);
    check('trocea un documento largo', chunks.length > 1, `${chunks.length} fragmentos`);
    check('ningún fragmento excede el tamaño máximo',
        chunks.every(c => c.text.length <= run('RAG_CHUNK_CHARS') + 50),
        `máximo ${Math.max(...chunks.map(c => c.text.length))}`);
    check('los fragmentos cubren todo el documento',
        chunks.map(c => c.text).join(' ').length >= DOC.length * 0.9);

    const corto = run(`chunkText('una frase suelta')`);
    check('un texto corto queda en un solo fragmento', corto.length === 1);
    check('un texto vacío no genera fragmentos', run(`chunkText('')`).length === 0);
}

// ── 2. Cuantización a int8 ───────────────────────────────────────────
{
    const ok = run(`(() => {
        const v = __fakeEmbed('renta impuestos hacienda');
        const q = quantizeVector(v);
        const dentroDeRango = q.every(x => Number.isInteger(x) && x >= -127 && x <= 127);
        // El coseno consigo mismo debe seguir siendo ~1 tras cuantizar
        const auto = dotQuantized(v, q);
        return { dentroDeRango, auto };
    })()`);
    check('los vectores se cuantizan a enteros de 8 bits', ok.dentroDeRango);
    check('la cuantización conserva la similitud', Math.abs(ok.auto - 1) < 0.02, `coseno propio ${ok.auto.toFixed(4)}`);
}

// ── 3. Indexado ──────────────────────────────────────────────────────
const PROYECTO = {
    id: 'p1', name: 'Legal', systemPrompt: '',
    documents: [{ id: 'd1', name: 'manual.txt', data: DOC }],
};
run(`state.projects = [${JSON.stringify(PROYECTO)}]; state.activeProjectId = 'p1';
     getActiveProject = () => state.projects[0];`);

{
    const res = await run(`ensureProjectIndexed(state.projects[0])`);
    check('indexa el documento', res.indexed === 1, JSON.stringify(res));
    const guardado = run('__store.get("rag-index")');
    check('el índice se guarda CIFRADO', guardado?.__wiaEnc === 'v1', String(guardado?.__wiaEnc));

    const llamadas = run('__embedCalls');
    const repetido = await run(`ensureProjectIndexed(state.projects[0])`);
    check('no reindexa lo que no ha cambiado', repetido.upToDate === true && run('__embedCalls') === llamadas,
        `${run('__embedCalls')} vs ${llamadas} embeddings`);
}

// ── 4. El índice se invalida al cambiar el documento ─────────────────
{
    const llamadas = run('__embedCalls');
    run(`state.projects[0].documents[0].data = ${JSON.stringify(DOC + '\n\nNuevo apartado sobre devoluciones y reembolsos.')};`);
    const res = await run(`ensureProjectIndexed(state.projects[0])`);
    check('reindexa cuando el documento cambia', res.indexed === 1 && run('__embedCalls') > llamadas);
}

// ── 5. Recuperación: devuelve lo relacionado, no lo primero ──────────
{
    const budget = 4000;
    sandbox.__budget = budget;
    const res = await run(`retrieveRelevantChunks('¿cuándo termina el plazo de la declaración de la renta?', state.projects[0], __budget)`);
    check('recupera algún fragmento', res.length > 0, `${res.length} extractos`);
    check('el mejor resultado habla del tema preguntado',
        /renta|declaración|plazo/i.test(res[0]?.text || ''),
        (res[0]?.text || '').slice(0, 60));
    check('los resultados vienen ordenados por relevancia',
        res.every((r, i) => i === 0 || res[i - 1].score >= r.score));
    check('cada extracto sabe de qué documento viene', res.every(r => r.docName === 'manual.txt'));

    const otro = await run(`retrieveRelevantChunks('¿cuál es el horario de atención al público?', state.projects[0], __budget)`);
    // Aserción estricta: el mejor resultado tiene que ser del tema preguntado,
    // no basta con que la palabra aparezca en algún punto del solape.
    check('otra pregunta cambia el mejor resultado',
        /horario/i.test(otro[0]?.text || ''),
        (otro[0]?.text || '').slice(0, 60));
    check('y no es el mismo fragmento que la pregunta anterior',
        otro[0]?.text !== res[0]?.text);
}

// ── 6. Presupuesto de tokens ─────────────────────────────────────────
{
    // Presupuesto para ~un fragmento y medio: debe entrar uno, no cero ni dos.
    const unChunk = Math.ceil(run('RAG_CHUNK_CHARS') / 3.5) + 16;
    sandbox.__budget1 = Math.floor(unChunk * 1.5);
    const res = await run(`retrieveRelevantChunks('renta declaración plazo', state.projects[0], __budget1)`);
    const total = res.reduce((n, r) => n + Math.ceil(r.text.length / 3.5) + 16, 0);
    check('con presupuesto justo entra al menos un extracto', res.length >= 1, `${res.length} extractos`);
    check('y nunca se pasa del presupuesto', total <= sandbox.__budget1, `${total} tokens de ${sandbox.__budget1}`);

    const nada = await run(`retrieveRelevantChunks('renta declaración plazo', state.projects[0], 20)`);
    check('con presupuesto ridículo no fuerza nada', nada.length === 0, `${nada.length} extractos`);
}

// ── 6b. El umbral de similitud depende del modelo ────────────────────
{
    const configurados = run('RAG_MODELS.map(m => [m.id, m.minScore])');
    check('cada modelo de embeddings declara su propio umbral',
        configurados.every(([, s]) => typeof s === 'number'),
        configurados.map(([id, s]) => `${id.split('/')[1]}=${s}`).join(' '));
    check('el umbral de E5 es más alto que el de MiniLM',
        configurados[0][1] > configurados[1][1],
        `${configurados[0][1]} > ${configurados[1][1]}`);

    // Una pregunta sin nada que ver no debe arrastrar fragmentos por inercia.
    run(`ragState.modelDef = { ...ragState.modelDef, minScore: 0.5 };`);
    const ruido = await run(`retrieveRelevantChunks('receta de tarta de queso al horno', state.projects[0], __budget)`);
    check('con umbral alto, una consulta ajena no recupera ruido', ruido.length === 0, `${ruido.length} extractos`);
    run(`ragState.modelDef = { ...ragState.modelDef, minScore: 0 };`);
}

// ── 7. Integración con la construcción del prompt ────────────────────
{
    run(`__chat = { id: 'c1', projectId: 'p1', messages: [
        { role: 'user', content: '¿cuándo termina el plazo de la declaración de la renta?' },
        { role: 'assistant', content: '' },
    ] };
    getActiveChat = () => __chat;
    state.settings.provider = 'openai';
    state.settings.model = 'm';
    state.settings.maxTokens = 1024;
    state.rawModels = [{ name: 'm', context: 32768 }];`);

    await run(`prepareRagContext(__chat, '¿cuándo termina el plazo de la declaración de la renta?')`);
    check('prepareRagContext deja el contexto listo', !!run('state._ragContext'));

    const mensajes = run('buildApiMessages(__chat)');
    const system = mensajes[0].content;
    check('el system prompt lleva los extractos', system.includes('EXTRACTOS RELEVANTES'));
    check('advierte al modelo de que son extractos', /no los documentos completos/i.test(system));
    check('NO se envía el documento entero',
        Math.ceil(system.length / 3.5) < Math.ceil(DOC.length / 3.5) * 0.8,
        `system=${Math.ceil(system.length / 3.5)} tkn vs documento=${Math.ceil(DOC.length / 3.5)} tkn`);

    const marca = run('__chat.messages[__chat.messages.length-1].contextTrim');
    check('la respuesta queda marcada como modo RAG', marca?.mode === 'rag', JSON.stringify(marca));
}

// ── 8. Con RAG apagado se vuelve al comportamiento anterior ──────────
{
    run(`state.settings.ragEnabled = false; state._ragContext = null;`);
    const ctx = await run(`prepareRagContext(__chat, 'renta')`);
    check('el conmutador desactiva la recuperación', ctx === null);
    const system = run('buildApiMessages(__chat)')[0].content;
    check('sin RAG se envía la base de conocimiento completa (recortada)',
        system.includes('BASE DE CONOCIMIENTO') && !system.includes('EXTRACTOS RELEVANTES'));
    run(`state.settings.ragEnabled = true;`);
}

// ── 9. Si el modelo de embeddings falla, no se rompe el envío ────────
{
    run(`loadRagPipeline = async () => { throw new Error('sin conexión con Hugging Face'); };
         ragState.pipeline = null; ragState.modelId = null; state._ragContext = null;`);
    const ctx = await run(`prepareRagContext(__chat, 'renta declaración')`);
    check('un fallo de embeddings degrada en vez de romper', ctx === null);
    const system = run('buildApiMessages(__chat)')[0].content;
    check('y se sigue enviando la base de conocimiento', system.includes('BASE DE CONOCIMIENTO'));
}

// ── 10. Documentos pequeños no se indexan ────────────────────────────
{
    run(`state.projects[0].documents = [{ id: 'd2', name: 'nota.txt', data: 'Una nota muy corta.' }];`);
    const res = await run(`ensureProjectIndexed(state.projects[0])`);
    check('un documento pequeño no monta índice', res.skipped === true, JSON.stringify(res));
}

console.log(failures === 0 ? '\n✔ RAG correcto.' : `\n✖ ${failures} fallo(s).`);
process.exitCode = failures === 0 ? 0 : 1;
