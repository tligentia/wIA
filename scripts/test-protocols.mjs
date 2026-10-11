/**
 * test-protocols — cada protocolo de motor completa un turno de punta a punta.
 *
 * Por qué: sendMessage mezclaba Ollama, OpenAI, Gemini, Anthropic y WebGPU en una
 * sola función de casi mil líneas. Al trocearla por protocolo hace falta fijar
 * lo que cada uno envía y cómo reconstruye la respuesta en streaming, incluido
 * el razonamiento («thinking») y las métricas.
 *
 * Uso: npm run test:protocols
 */
import { createChatHarness, streamOf, settle, withTimeout } from './harness-chat.mjs';

let failures = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failures++;
};
const sse = (o) => 'data: ' + JSON.stringify(o);

const PROTOCOLS = [
    {
        id: 'ollama', provider: 'ollama', endpoint: '/api/chat',
        stream: [JSON.stringify({ message: { content: 'Ho' } }), JSON.stringify({ message: { content: 'la' } }),
            JSON.stringify({ done: true, total_duration: 5e9, eval_count: 7, eval_duration: 1e9, prompt_eval_count: 3, message: { content: '' } })],
        body: (b) => Array.isArray(b.messages) && b.stream === true && b.options?.temperature !== undefined,
    },
    {
        id: 'openai', provider: 'openai', endpoint: '/chat/completions',
        stream: [sse({ choices: [{ delta: { content: 'Ho' } }] }), sse({ choices: [{ delta: { content: 'la' } }] }),
            sse({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 7, total_tokens: 10 } }), 'data: [DONE]'],
        body: (b) => Array.isArray(b.messages) && b.stream === true && b.max_tokens > 0,
    },
    {
        id: 'gemini', provider: 'gemini', endpoint: ':streamGenerateContent',
        stream: [sse({ candidates: [{ content: { parts: [{ text: 'razono', thought: true }] } }] }),
            sse({ candidates: [{ content: { parts: [{ text: 'Ho' }] } }] }),
            sse({ candidates: [{ content: { parts: [{ text: 'la' }] } }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 7, totalTokenCount: 10 } })],
        body: (b) => Array.isArray(b.contents) && b.generationConfig?.maxOutputTokens > 0,
        thinking: 'razono',
    },
    {
        id: 'anthropic', provider: 'claude', endpoint: '/messages',
        stream: [sse({ type: 'message_start', message: { usage: { input_tokens: 3 } } }),
            sse({ type: 'content_block_start', content_block: { type: 'thinking' } }),
            sse({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'razono' } }),
            sse({ type: 'content_block_start', content_block: { type: 'text' } }),
            sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Ho' } }),
            sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'la' } }),
            sse({ type: 'message_delta', usage: { output_tokens: 7 } })],
        body: (b) => Array.isArray(b.messages) && b.messages[0]?.role === 'user' && b.max_tokens > 0,
        thinking: 'razono',
    },
];

for (const p of PROTOCOLS) {
    console.log(`\n${p.id}\n`);
    const calls = [];
    const h = createChatHarness({
        handler: async (url, opts) => {
            if (!url.includes(p.endpoint)) throw new Error('sin red');
            calls.push({ url, body: JSON.parse(opts.body || '{}'), headers: opts.headers || {} });
            return streamOf(p.stream);
        },
    });
    h.run(`state.settings.provider='${p.provider}'; state.settings.model='m'; state.settings.ollamaUrl='http://localhost:1/v1';
           state.settings.apiKey='clave-de-prueba'; state.settings.incognitoMode=true; state.incognitoSessionActive=true;
           state.settings.systemPrompt='Eres útil';`);
    const result = await withTimeout(h.run(`sendMessage('Saluda')`));
    await settle();
    const msgs = h.run('getActiveChat().messages');
    const last = msgs[msgs.length - 1];
    check('el turno termina', result === 'resolved', result);
    check('hace una petición con el cuerpo propio del protocolo', calls.length >= 1 && p.body(calls[0].body), JSON.stringify(Object.keys(calls[0]?.body || {})));
    check('reconstruye la respuesta en streaming', last?.role === 'assistant' && last.content === 'Hola', JSON.stringify(last?.content));
    if (p.thinking) check('separa el razonamiento de la respuesta', last.thinking === p.thinking, JSON.stringify(last.thinking));
    check('recoge métricas de uso', !!last?.metrics && Object.keys(last.metrics).length > 0, JSON.stringify(last?.metrics));
    check('la UI queda libre', h.run('state.isStreaming') === false);
}

console.log('\nerrores del motor\n');
{
    const h = createChatHarness({ handler: async () => ({ ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({ error: { message: 'clave inválida' } }), body: null }) });
    h.run(`state.settings.provider='openai'; state.settings.model='m'; state.settings.ollamaUrl='http://localhost:1/v1'; state.settings.incognitoMode=true; state.incognitoSessionActive=true;`);
    await withTimeout(h.run(`sendMessage('hola')`));
    await settle();
    const msgs = h.run('getActiveChat().messages');
    check('un 401 se muestra como error en el chat', /clave inválida|401/.test(msgs[msgs.length - 1]?.content || ''), (msgs[msgs.length - 1]?.content || '').slice(0, 80));
    check('y no deja la UI bloqueada', h.run('state.isStreaming') === false);
}

if (failures) { console.error(`\n✖ ${failures} comprobaciones fallidas.`); process.exit(1); }
console.log('\n✔ Protocolos de motor correctos.');
process.exit(0);
