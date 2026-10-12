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

await settle();
if (failures) { console.error(`\n✖ ${failures} comprobaciones fallidas.`); process.exit(1); }
console.log('\n✔ Interno / IA local y términos propios correctos.');
process.exit(0);
