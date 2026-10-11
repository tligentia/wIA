/**
 * test-context-budget — pruebas del recorte de contexto.
 *
 * Los módulos de wIA son scripts clásicos de navegador que comparten ámbito
 * global. Aquí se cargan en un contexto de node:vm con lo mínimo del DOM
 * simulado, lo que permite probar la lógica pura (presupuesto, recorte de
 * historial, recorte de la base de conocimiento) sin navegador.
 *
 * Uso: npm run test:context
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { resolve } from 'node:path';
import { classicSource } from './lib/generated-blocks.mjs';

const root = process.cwd();
const read = (p) => classicSource(readFileSync, resolve(root, p));

// ── DOM mínimo: los módulos solo consultan nodos que aquí no existen ──
const noopEl = () => ({
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, removeAttribute() {}, addEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    style: {}, dataset: {}, textContent: '', innerHTML: '', value: '',
});
const documentStub = {
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => noopEl(),
    addEventListener() {},
    documentElement: { setAttribute() {} },
    body: { classList: { toggle() {}, add() {}, remove() {} } },
    head: { appendChild() {} },
    hidden: false,
};
const windowStub = {
    location: { protocol: 'https:', host: 'wia.test', origin: 'https://wia.test' },
    matchMedia: null,
    addEventListener() {},
    fetch: () => Promise.reject(new Error('sin red en las pruebas')),
};

const sandbox = {
    window: windowStub,
    document: documentStub,
    navigator: { userAgent: 'node', languages: ['es'], maxTouchPoints: 0 },
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => Date.now() },
    crypto: { randomUUID: () => 'test-uuid' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    DOMParser: class { parseFromString() { return { body: { querySelectorAll: () => [], innerHTML: '' } }; } },
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
createContext(sandbox);

runInContext(read('js/01-core.js'), sandbox, { filename: '01-core.js' });
runInContext(read('js/02-state.js'), sandbox, { filename: '02-state.js' });
runInContext(read('js/06-chat.js'), sandbox, { filename: '06-chat.js' });

// Escrituras a disco desactivadas durante las pruebas.
runInContext('saveState = () => true; getActiveProject = () => state.projects[0];', sandbox);

let failures = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failures++;
};

const run = (expr) => runInContext(expr, sandbox);
const setup = ({ context = 8192, maxTokens = 1024, messages = [], documents = [] }) => {
    sandbox.__fixture = { context, maxTokens, messages, documents };
    run(`
        state.settings.provider = 'openai';
        state.settings.model = 'modelo-de-prueba';
        state.settings.maxTokens = __fixture.maxTokens;
        state.settings.systemPrompt = 'Eres un asistente.';
        state.rawModels = [{ name: 'modelo-de-prueba', context: __fixture.context }];
        state.projects = [{ id: 'general', name: 'General', systemPrompt: '', documents: __fixture.documents }];
        state.activeProjectId = 'general';
        __chat = { id: 'c1', projectId: 'general', messages: __fixture.messages };
    `);
};

const words = (n) => 'palabra '.repeat(n).trim();

// ── 1. Ventana de contexto y presupuesto ─────────────────────────────
setup({ context: 8192, maxTokens: 1024 });
check('lee la ventana de contexto del catálogo', run('getModelContextWindow()') === 8192);
check('reserva espacio para la respuesta y un margen',
    run('getPromptTokenBudget()') === 8192 - 1024 - 512,
    `presupuesto=${run('getPromptTokenBudget()')}`);

setup({ context: 0, maxTokens: 1024 });
run(`state.rawModels = [{ name: 'modelo-de-prueba' }];`);
check('sin metadatos asume 8K conservador', run('getModelContextWindow()') === 8192);

// ── 2. Conversación corta: no se toca ────────────────────────────────
setup({
    context: 8192, maxTokens: 1024,
    messages: [
        { role: 'user', content: 'hola' },
        { role: 'assistant', content: 'qué tal' },
        { role: 'user', content: 'bien' },
    ],
});
{
    const out = run('buildApiMessages(__chat)');
    check('una conversación corta se envía íntegra', out.length === 4, `${out.length} mensajes (1 system + 3)`);
    check('no marca recorte cuando no lo hay', run('__chat.messages[__chat.messages.length-1].contextTrim') === undefined);
}

// ── 3. Conversación larga: recorta por el principio ──────────────────
setup({
    context: 2048, maxTokens: 512,
    messages: Array.from({ length: 40 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `mensaje ${i} ${words(60)}`,
    })),
});
{
    const out = run('buildApiMessages(__chat)');
    const budget = run('getPromptTokenBudget()');
    const total = out.reduce((n, m) => n + Math.ceil(String(m.content).length / 3.5), 0);
    check('recorta la conversación larga', out.length < 41, `${out.length} de 41`);
    check('el resultado cabe en el presupuesto', total <= budget, `${total} tokens vs presupuesto ${budget}`);
    check('conserva el system prompt', out[0].role === 'system');
    check('conserva el ÚLTIMO turno (la pregunta viva)',
        String(out[out.length - 1].content).startsWith('mensaje 39'),
        String(out[out.length - 1].content).slice(0, 12));
    check('deja constancia del recorte para avisar en la UI',
        run('__chat.messages[__chat.messages.length-1].contextTrim?.droppedMessages') > 0);
}

// ── 4. Nunca descarta el último mensaje, aunque no quepa ─────────────
setup({
    context: 2048, maxTokens: 512,
    messages: [{ role: 'user', content: words(20000) }],
});
{
    const out = run('buildApiMessages(__chat)');
    check('mantiene el último turno aunque desborde por sí solo',
        out.some(m => m.role === 'user'), `${out.length} mensajes`);
}

// ── 5. Base de conocimiento: se recorta, no se envía entera ──────────
setup({
    context: 4096, maxTokens: 512,
    // Igual que en el flujo real: sendMessage encola el mensaje vacío del
    // asistente ANTES de construir el prompt, y es ahí donde se anota el recorte.
    messages: [{ role: 'user', content: 'resume' }, { role: 'assistant', content: '' }],
    documents: [
        { id: 'd1', name: 'manual.txt', data: words(30000) },
        { id: 'd2', name: 'anexo.txt', data: words(30000) },
    ],
});
{
    const out = run('buildApiMessages(__chat)');
    const system = out[0].content;
    const systemTokens = Math.ceil(system.length / 3.5);
    const budget = run('getPromptTokenBudget()');
    check('la base de conocimiento no monopoliza el contexto',
        systemTokens <= budget * 0.6, `system=${systemTokens} tokens, presupuesto=${budget}`);
    check('avisa al modelo de que el documento va recortado',
        system.includes('recortado') || system.includes('recortados'));
    check('marca el recorte de documentos en la UI',
        run('__chat.messages[__chat.messages.length-1].contextTrim?.docsTruncated') === true);
}

// ── 6. Anthropic: el recorte no puede dejar 'assistant' el primero ───
setup({
    context: 2048, maxTokens: 512,
    messages: Array.from({ length: 40 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `m${i} ${words(60)}`,
    })),
});
{
    const data = run('buildAnthropicMessages(__chat)');
    check('Anthropic recibe siempre un user como primer mensaje',
        data.messages[0].role === 'user', data.messages[0].role);
}

// ── 7. Gemini: mismo presupuesto, formato propio ─────────────────────
{
    const data = run('buildGeminiMessages(__chat)');
    check('Gemini recorta y mantiene su formato de roles',
        data.contents.length < 40 && data.contents.every(c => c.role === 'user' || c.role === 'model'),
        `${data.contents.length} turnos`);
}

// ── 8. WebGPU: las imágenes se van con su mensaje al recortar ────────
setup({
    context: 2048, maxTokens: 512,
    messages: [
        { role: 'user', content: `antigua ${words(400)}`, imageMeta: [{ data: 'AAAA', mimeType: 'image/png', name: 'vieja.png' }] },
        ...Array.from({ length: 20 }, (_, i) => ({ role: i % 2 === 0 ? 'assistant' : 'user', content: `relleno ${i} ${words(60)}` })),
        { role: 'user', content: 'reciente', imageMeta: [{ data: 'BBBB', mimeType: 'image/png', name: 'nueva.png' }] },
    ],
});
{
    const out = run('buildWebGPUConversation(__chat, "sistema", true)');
    const imagePlaceholders = out.conversationHistory
        .flatMap(m => Array.isArray(m.content) ? m.content : [])
        .filter(part => part.type === 'image').length;
    check('cada marcador de imagen tiene su tensor correspondiente',
        imagePlaceholders === out.imageMetaList.length,
        `${imagePlaceholders} marcadores vs ${out.imageMetaList.length} imágenes`);
    check('la imagen descartada no viaja suelta',
        !out.imageMetaList.some(img => img.name === 'vieja.png'),
        out.imageMetaList.map(i => i.name).join(', ') || 'ninguna');
}

console.log(failures === 0 ? '\n✔ Presupuesto de contexto correcto.' : `\n✖ ${failures} fallo(s).`);
process.exitCode = failures === 0 ? 0 : 1;
