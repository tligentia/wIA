/**
 * test-anon-ai — sistema interno / IA local y términos propios.
 *
 * Qué no puede romperse:
 *  · por defecto se anonimiza con el sistema interno y NO se llama a ningún modelo;
 *  · el modo IA solo consulta al modelo si el motor activo es IA Local verificado:
 *    con un motor en la nube el texto sin anonimizar NO sale (se usa el interno);
 *  · lo que la IA señale se valida (debe estar en el texto) y se suma al interno;
 *  · los términos propios se anonimizan siempre, sin distinguir mayúsculas ni tildes.
 *
 * Uso: npm run test:anon-ai
 */
import { readFileSync } from 'node:fs';
import { createChatHarness, settle } from './harness-chat.mjs';

const withTimeout = (p, ms = 15000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

let failures = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failures++;
};

const aiAnswer = (items) => JSON.stringify({ message: { content: JSON.stringify({ items }) }, done: true });

function harness({ aiItems = [], tagsOk = true } = {}) {
    const calls = [];
    const h = createChatHarness({
        handler: async (url, opts = {}) => {
            calls.push({ url, body: opts.body ? JSON.parse(opts.body) : null });
            if (url.endsWith('/api/tags')) {
                return tagsOk ? { ok: true, status: 200, json: async () => ({ models: [{ name: 'm' }] }), text: async () => '{}', headers: new Map() }
                              : { ok: false, status: 503, statusText: 'x', json: async () => ({}), text: async () => '', headers: new Map() };
            }
            if (url.endsWith('/api/chat')) {
                return { ok: true, status: 200, json: async () => JSON.parse(aiAnswer(aiItems)), text: async () => aiAnswer(aiItems), headers: new Map() };
            }
            throw new Error('sin red: ' + url);
        },
    });
    h.run('secretVault.available = () => false');
    return { h, calls };
}

// Un chat nuevo con el anonimizador preparado; devuelve una función para anonimizar en él.
async function chatFor(h) {
    await withTimeout(h.run(`globalThis.__c = createChat(); ensureAnonReady(globalThis.__c)`));
    return async (text) => JSON.parse(await withTimeout(h.run(
        `(async () => JSON.stringify(await anonymizeOutgoingText(${JSON.stringify(text)}, globalThis.__c)))()`)));
}

// ── 1. Por defecto: interno, sin llamar al modelo ───────────────────────────
console.log('1. Sistema interno por defecto\n');
{
    const { h, calls } = harness();
    h.run(`state.settings.provider='ollama'; state.settings.model='m'; state.settings.ollamaUrl='http://localhost:11434';`);
    const anonymize = await chatFor(h);
    check('el ajuste por defecto es «interno»', h.run('state.settings.anonMode') === 'internal');
    const r = await anonymize('Hablé con Juan Pérez sobre Galáctica Zeta.');
    check('anonimiza con el sistema interno', !r.text.includes('Juan') && !r.text.includes('Pérez'), r.text);
    check('no consulta a ningún modelo', calls.filter((c) => c.url.endsWith('/api/chat')).length === 0);
    check('lo que el interno no conoce se queda (Galáctica Zeta)', r.text.includes('Galáctica Zeta'), r.text);
}

// ── 2. Términos propios ─────────────────────────────────────────────────────
console.log('\n2. Términos propios\n');
{
    const { h } = harness();
    h.run(`state.settings.customTerms = [
        { id: 'a', text: 'Galáctica Zeta', type: 'empresa' },
        { id: 'b', text: 'señor Wenceslao Pífano', type: 'nombre' },
    ];`);
    const anonymize = await chatFor(h);
    const r = await anonymize('Trabajo en GALACTICA   ZETA con el señor wenceslao pífano.');
    check('un término propio se anonimiza sin distinguir mayúsculas, tildes ni espacios múltiples',
        !/galactica|zeta/i.test(r.text) && !/pífano/i.test(r.text), r.text);
    check('con el marcador de su tipo', /\[Empresa_\d+\]/.test(r.text) && /\[Nombre_\d+\]/.test(r.text), r.text);
    const again = await anonymize('Otra vez Galáctica Zeta.');
    check('el mismo término reutiliza el marcador', /\[Empresa_001\]/.test(again.text), again.text);
}

// ── 3. Modo IA con IA Local verificado ──────────────────────────────────────
console.log('\n3. Modo IA con un motor local\n');
{
    const { h, calls } = harness({ aiItems: [
        { text: 'Galáctica Zeta', type: 'empresa' },
        { text: 'Texto inventado que no está', type: 'nombre' },   // alucinación: debe ignorarse
    ] });
    h.run(`state.settings.provider='ollama'; state.settings.model='m'; state.settings.ollamaUrl='http://localhost:11434'; state.settings.anonMode='ai';`);
    const anonymize = await chatFor(h);
    const r = await anonymize('Trabajo en Galáctica Zeta con Juan Pérez.');
    const chats = calls.filter((c) => c.url.endsWith('/api/chat'));
    check('verifica el motor y consulta al modelo local', calls.some((c) => c.url.endsWith('/api/tags')) && chats.length === 1);
    check('lo que el modelo señala se anonimiza', !r.text.includes('Galáctica'), r.text);
    check('y el sistema interno sigue aplicándose', !r.text.includes('Juan') && !r.text.includes('Pérez'), r.text);
    check('un término que no está en el texto se descarta', !r.text.includes('inventado') && r.ai.added === 1, JSON.stringify(r.ai));
    check('el texto consultado al modelo es el original (el motor es local)', JSON.stringify(chats[0].body).includes('Galáctica Zeta'));
}

// ── 4. Modo IA con un motor en la nube: NO sale nada ────────────────────────
console.log('\n4. Modo IA con un motor en la nube\n');
{
    const { h, calls } = harness({ aiItems: [{ text: 'Galáctica Zeta', type: 'empresa' }] });
    h.run(`state.settings.provider='groq'; state.settings.model='m'; state.settings.ollamaUrl='https://api.groq.com/openai/v1'; state.settings.anonMode='ai';`);
    const anonymize = await chatFor(h);
    const status = h.run('JSON.stringify(localAIStatus())');
    check('el motor en la nube no cuenta como IA Local', JSON.parse(status).ok === false, status);
    const r = await anonymize('Trabajo en Galáctica Zeta con Juan Pérez.');
    check('no se hace ninguna petición de red', calls.length === 0, calls.map((c) => c.url).join(','));
    check('se usa el sistema interno', !r.text.includes('Juan') && r.ok === true, r.text);
    check('y se indica por qué no se usó la IA', typeof r.ai?.note === 'string' && r.ai.note.length > 0 && r.ai.used === false, JSON.stringify(r.ai));
}

// ── 5. Motor local que no responde ──────────────────────────────────────────
console.log('\n5. IA local que no responde\n');
{
    const { h, calls } = harness({ tagsOk: false });
    h.run(`state.settings.provider='ollama'; state.settings.model='m'; state.settings.ollamaUrl='http://localhost:11434'; state.settings.anonMode='ai';`);
    const anonymize = await chatFor(h);
    const r = await anonymize('Habló Juan Pérez.');
    check('no se considera verificado: no se consulta al modelo', calls.filter((c) => c.url.endsWith('/api/chat')).length === 0);
    check('el envío no se bloquea y el interno anonimiza', r.ok === true && !r.text.includes('Pérez'), r.text);
}

// ── 6. Modo IA con el modelo del navegador (WebGPU) ─────────────────────────
console.log('\n6. Modo IA con WebGPU (modelo del navegador)\n');
{
    const { h, calls } = harness();
    // El worker real no existe en Node: se simula su protocolo (generate → done con result).
    // Un modelo del catálogo, ya «cargado» (pipeline = marcador de worker).
    h.run(`
        globalThis.__gen = [];
        state.settings.provider = 'webgpu';
        state.settings.model = WEBGPU_MODELS.find(m => !m.omnimodal).id;
        state.settings.anonMode = 'ai';
        webgpuState.supported = 'webgpu';
        webgpuState.pipeline = { __worker: true };
        webgpuState.loadedModelId = state.settings.model;
        webgpuWorker.call = async (msg) => {
            globalThis.__gen.push(msg);
            const body = JSON.stringify({ items: [{ text: 'Galáctica Zeta', type: 'empresa' }, { text: 'Inventado', type: 'nombre' }] });
            return { type: 'done', tokenCount: 9, result: [{ generated_text: [msg.input.messages[0], msg.input.messages[1], { role: 'assistant', content: body }] }] };
        };
    `);
    const status = JSON.parse(h.run('JSON.stringify(localAIStatus())'));
    check('el modelo del navegador cuenta como IA Local utilizable', status.ok === true, JSON.stringify(status));
    const anonymize = await chatFor(h);
    const r = await anonymize('Trabajo en Galáctica Zeta con Juan Pérez.');
    const gens = JSON.parse(h.run('JSON.stringify(globalThis.__gen)'));
    check('se consulta al modelo del navegador (una vez, sin red)', gens.length === 1 && calls.length === 0, `gens=${gens.length} red=${calls.length}`);
    const msgs = gens[0]?.input?.messages || [];
    check('consulta determinista (do_sample:false) con sistema + texto como último turno', gens[0]?.options?.do_sample === false
        && msgs[0].role === 'system' && msgs[msgs.length - 1].role === 'user' && msgs[msgs.length - 1].content.includes('Galáctica Zeta'), JSON.stringify(gens[0]?.options));
    const shotItems = msgs.slice(1, -1).filter((m) => m.role === 'assistant').flatMap((m) => JSON.parse(m.content).items.map((i) => i.text));
    check('los ejemplos van en turnos aparte, no dentro del texto del sistema',
        shotItems.length > 0 && msgs.length > 2 && shotItems.every((t) => !msgs[0].content.includes(t)) && !/Marta Soler|Calle Olmo/.test(msgs[0].content), shotItems.join(' | '));
    check('lo que señala el modelo se anonimiza y el interno sigue aplicando', !r.text.includes('Galáctica') && !r.text.includes('Pérez'), r.text);
    check('un término que no está en el texto se descarta', r.ai.used === true && r.ai.added === 1 && !r.text.includes('Inventado'), JSON.stringify(r.ai));
}
{
    // Modelo multimodal o navegador sin WebGPU: no se usa la IA y el interno sigue funcionando.
    const { h, calls } = harness();
    h.run(`state.settings.provider = 'webgpu'; state.settings.anonMode = 'ai'; webgpuState.supported = 'wasm';
           state.settings.model = WEBGPU_MODELS.find(m => !m.omnimodal).id;`);
    const st = JSON.parse(h.run('JSON.stringify(localAIStatus())'));
    check('sin WebGPU acelerado no se ofrece el modo IA', st.ok === false && /WebGPU/.test(st.reason), st.reason);
    const anonymize = await chatFor(h);
    const r = await anonymize('Habló Juan Pérez.');
    check('el envío no se bloquea: se usa el sistema interno', r.ok === true && !r.text.includes('Pérez') && r.ai.used === false, JSON.stringify(r.ai));
    check('y no se hace ninguna petición', calls.length === 0);
    const omni = WEBGPU_OMNI_CHECK();
    function WEBGPU_OMNI_CHECK() {
        const id = h.run(`(WEBGPU_MODELS.find(m => m.omnimodal) || {}).id || ''`);
        if (!id) return null;
        h.run(`webgpuState.supported = 'webgpu'; state.settings.model = ${JSON.stringify(id)};`);
        return JSON.parse(h.run('JSON.stringify(localAIStatus())'));
    }
    if (omni) check('un modelo multimodal no sirve para anonimizar', omni.ok === false, omni.reason);
}
{
    // El chat y el anonimizador comparten un único pipeline: si ya hay una generación, se avisa.
    const { h } = harness();
    h.run(`state.settings.provider = 'webgpu'; webgpuState.supported = 'webgpu';
           state.settings.model = WEBGPU_MODELS.find(m => !m.omnimodal).id;
           webgpuState.pipeline = { __worker: true }; webgpuState.loadedModelId = state.settings.model;
           webgpuState.generating = true;`);
    const msg = await withTimeout(h.run(`completeWebGPU('s','u').then(() => 'ok', e => e.message)`));
    check('no lanza una segunda generación sobre el mismo pipeline', msg !== 'ok' && /generando/i.test(msg), msg);
}

// ── 6b. El modelo del navegador devuelve el ejemplo del prompt ──────────────
console.log('\n6b. Modelo del navegador que copia el ejemplo\n');
{
    // Llama-3.2-3B devolvía literalmente los datos del ejemplo del prompt en vez de
    // los del texto: la validación literal los descartaba y la IA aportaba 0 términos.
    const setup = (h, behaviour) => h.run(`
        globalThis.__gen = [];
        state.settings.provider = 'webgpu';
        state.settings.model = WEBGPU_MODELS.find(m => !m.omnimodal).id;
        state.settings.anonMode = 'ai';
        webgpuState.supported = 'webgpu';
        webgpuState.pipeline = { __worker: true };
        webgpuState.loadedModelId = state.settings.model;
        webgpuWorker.call = async (msg) => {
            const messages = msg.input.messages;
            globalThis.__gen.push(messages.length);
            const shots = messages.slice(1, -1).filter(m => m.role === 'assistant').map(m => JSON.parse(m.content));
            const echo = shots[0] || { items: [{ text: 'Marta Soler', type: 'nombre' }] };
            const real = { items: [{ text: 'Tomasz Kowalczyk', type: 'nombre' }, { text: 'Estudio Lumbreras', type: 'empresa' }] };
            const body = (${behaviour})(messages.length > 2, echo, real);
            return { type: 'done', tokenCount: 9, result: [{ generated_text: [...messages, { role: 'assistant', content: body }] }] };
        };
    `);
    const texto = 'Reunión con Tomasz Kowalczyk, de Estudio Lumbreras, en la Urbanización Los Cerezos.';

    // a) Con los turnos de ejemplo copia el ejemplo; sin ellos acierta → un reintento lo arregla.
    {
        const { h } = harness();
        setup(h, `(withShots, echo, real) => JSON.stringify(withShots ? echo : real)`);
        const anonymize = await chatFor(h);
        const r = await anonymize(texto);
        const gens = JSON.parse(h.run('JSON.stringify(globalThis.__gen)'));
        check('si todo lo devuelto es el ejemplo, reintenta una vez sin turnos de ejemplo',
            gens.length === 2 && gens[0] > 2 && gens[1] === 2, JSON.stringify(gens));
        check('y tras el reintento anonimiza los datos del texto', r.ai.used === true && r.ai.added === 2
            && !r.text.includes('Tomasz') && !r.text.includes('Lumbreras'), JSON.stringify(r.ai) + ' ' + r.text);
    }
    // b) Copia el ejemplo siempre → no se queda en bucle ni rompe: el interno sigue anonimizando.
    {
        const { h } = harness();
        setup(h, `(withShots, echo) => JSON.stringify(echo)`);
        const anonymize = await chatFor(h);
        const r = await anonymize('Habló Juan Pérez en Estudio Lumbreras.');
        const gens = JSON.parse(h.run('JSON.stringify(globalThis.__gen)'));
        check('con el ejemplo copiado dos veces no hay más reintentos', gens.length === 2, JSON.stringify(gens));
        check('el envío no se bloquea y el interno anonimiza', r.ok === true && r.ai.added === 0 && !r.text.includes('Pérez'), JSON.stringify(r.ai) + ' ' + r.text);
    }
    // c) Si el texto contiene de verdad esos nombres, no es un eco: no se reintenta.
    {
        const { h } = harness();
        setup(h, `(withShots, echo) => JSON.stringify(echo)`);
        const anonymize = await chatFor(h);
        const r = await anonymize('Beatriz Quintana trabaja en Talleres Ferrer, en Avenida del Mar 12, Cádiz.');
        const gens = JSON.parse(h.run('JSON.stringify(globalThis.__gen)'));
        check('un ejemplo que sí está en el texto no se trata como eco (una sola consulta)', gens.length === 1 && r.ai.added >= 1, JSON.stringify(gens) + ' ' + JSON.stringify(r.ai));
    }
    // d) Un motor HTTP no tiene ejemplo en el prompt: nunca se reintenta.
    {
        const { h, calls } = harness({ aiItems: [{ text: 'Marta Soler', type: 'nombre' }] });
        h.run(`state.settings.provider='ollama'; state.settings.model='m'; state.settings.ollamaUrl='http://localhost:11434'; state.settings.anonMode='ai';`);
        const anonymize = await chatFor(h);
        await anonymize('Habló Juan Pérez.');
        check('con Ollama no hay reintento', calls.filter((c) => c.url.endsWith('/api/chat')).length === 1);
    }
    // e) Lectura tolerante de la respuesta de modelos pequeños.
    {
        const { h } = harness();
        const parse = (raw) => JSON.parse(h.run(`JSON.stringify(_parseAIItems(${JSON.stringify(raw)}).map(i => i.text))`));
        const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        check('bloque ```json con nota posterior',
            eq(parse('```json\n{"items":[{"text":"Ana Ruiz","type":"nombre"}]}\n```\nNota: {no es un dato}'), ['Ana Ruiz']));
        check('clave "items" repetida (JSON.parse solo conservaría la última)',
            eq(parse('{"items":[{"text":"Ana Ruiz","type":"nombre"}],"items":[{"text":"Casa Verde","type":"empresa"}]}'), ['Ana Ruiz', 'Casa Verde']));
        check('respuesta cortada por el límite de tokens: se aprovechan los objetos completos',
            eq(parse('{"items":[{"text":"Ana Ruiz","type":"nombre"},{"text":"Casa Ver'), ['Ana Ruiz']));
        check('lista de textos sueltos y arrays', eq(parse('["Ana Ruiz","Casa Verde"]'), ['Ana Ruiz', 'Casa Verde']));
        check('sin datos / basura', eq(parse('{"items":[]}'), []) && eq(parse('no sé'), []));
    }
}

// ── 7. Progreso parpadeando en el botón del sistema que trabaja ─────────────
console.log('\n7. Progreso en los botones\n');
{
    const { h } = harness({ aiItems: [{ text: 'Galáctica Zeta', type: 'empresa' }] });
    h.run(`state.settings.provider='ollama'; state.settings.model='m'; state.settings.ollamaUrl='http://localhost:11434'; state.settings.anonMode='ai';
           globalThis.__busy = [];
           const _set = setAnonBusy; setAnonBusy = (m, p) => { globalThis.__busy.push(m + ':' + p); return _set(m, p); };`);
    const anonymize = await chatFor(h);
    await anonymize('Trabajo en Galáctica Zeta con Juan Pérez.');
    const busy = JSON.parse(h.run('JSON.stringify(globalThis.__busy)'));
    check('la IA local marca su botón con el avance por trozos', busy.some((b) => b === 'ai:0/1') && busy.some((b) => b === 'ai:1/1'), busy.join(' | '));
    check('el JScript Interno marca el suyo mientras analiza', busy.some((b) => b.startsWith('internal:')), busy.join(' | '));
    const es = JSON.parse(readFileSync('lang/es.json', 'utf8'));
    const html = readFileSync('index.html', 'utf8');
    check('el sistema interno se llama «JScript Interno» (textos e index.html)',
        /JScript Interno/.test(es['anon.mode.internal']) && /JScript Interno/.test(es['anon.mode.internal.short'])
        && (html.match(/data-anon-mode="internal"[^>]*>⚙️ JScript Interno/g) || []).length === 2);
}

// ── 8. Menú rápido al marcar texto y «Vaciar casillas» ─────────────────────
console.log('\n8. Menú rápido al marcar texto\n');
{
    const { h } = harness();
    await chatFor(h);   // reglas cargadas (diccionarios para sugerir el tipo)
    h.run(`renderAnonTool = () => {}; hideAnonSelMenu = () => {};`);
    const guess = (t) => h.run(`guessAnonTermType(${JSON.stringify(t)})`);
    check('«Marta Rodríguez» → Persona', guess('Marta Rodríguez') === 'nombre', guess('Marta Rodríguez'));
    check('«Proyecto Alfa SL» → Organización', guess('Proyecto Alfa SL') === 'empresa');
    check('«Calle Luna 23» → Dirección', guess('Calle Luna 23') === 'direccion');
    check('«ref-2041» → Otro dato', guess('ref-2041') === 'dato');
    check('una palabra suelta en minúscula → Otro dato', guess('alfa') === 'dato');

    h.run(`state.settings.customTerms = []; anonTool.sel = 'Proyecto Alfa';`);
    const n = h.run(`applyAnonSelectionType('empresa')`);
    const terms = JSON.parse(h.run('JSON.stringify(state.settings.customTerms)'));
    check('elegir un tipo en el menú crea el término con ese tipo', n === 1 && terms.length === 1 && terms[0].text === 'Proyecto Alfa' && terms[0].type === 'empresa', JSON.stringify(terms));
    check('y deja un aviso en la ventana', /Proyecto Alfa/.test(h.run('anonTool.flash')), h.run('anonTool.flash'));

    h.run(`anonTool.sel = 'Ana López\\nBeatriz Núñez';`);
    const m = h.run(`applyAnonSelectionType('nombre')`);
    check('varias líneas marcadas crean un término por línea', m === 2 && JSON.parse(h.run('JSON.stringify(state.settings.customTerms)')).length === 3);

    h.run(`anonTool.sel = '[Nombre_001]';`);
    const k = h.run(`applyAnonSelectionType('nombre')`);
    check('un marcador no se añade como término', k === 0 && JSON.parse(h.run('JSON.stringify(state.settings.customTerms)')).length === 3);

    // Lo añadido se anonimiza de verdad en el siguiente análisis.
    const anonymize = await chatFor(h);
    const r = await anonymize('Mañana presentamos el Proyecto Alfa con Ana López.');
    check('lo marcado se anonimiza después', !/Alfa/.test(r.text) && !/López/.test(r.text), r.text);
}

await settle();
if (failures) { console.error(`\n✖ ${failures} comprobaciones fallidas.`); process.exit(1); }
console.log('\n✔ Interno / IA local y términos propios correctos.');
process.exit(0);
