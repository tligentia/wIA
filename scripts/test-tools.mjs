/**
 * test-tools — la búsqueda web por llamada a herramienta debe completar el turno.
 *
 * Por qué: la continuación tras la herramienta se lanzaba con isStreaming aún
 * activo y sendMessage salía en su primera línea, así que la respuesta no
 * llegaba nunca y el chat se quedaba «generando» para siempre. Además, el
 * dialecto OpenAI rechaza una llamada de herramienta sin id/type ni la
 * respuesta sin tool_call_id, y un modelo que insiste en buscar no debe
 * encadenar búsquedas sin fin.
 *
 * Uso: npm run test:tools
 */
import { createChatHarness, streamOf, settle, withTimeout } from './harness-chat.mjs';

let failures = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failures++;
};

async function scenario({ provider, endpoint, toolReply, alwaysTool = false }) {
    const calls = [];
    const h = createChatHarness({
        activeSelectors: ['#toolInternet'],
        handler: async (url, opts) => {
            if (!url.includes(endpoint)) throw new Error('sin red');
            const body = JSON.parse(opts.body || '{}');
            calls.push(body);
            const wantsTool = !!body.tools && (alwaysTool || calls.length === 1);
            return streamOf(wantsTool ? toolReply : provider === 'ollama'
                ? [JSON.stringify({ message: { role: 'assistant', content: 'París.' }, done: true })]
                : ['data: ' + JSON.stringify({ choices: [{ delta: { content: 'París.' } }] }), 'data: [DONE]']);
        },
    });
    h.run(`state.settings.provider='${provider}'; state.settings.model='m'; state.settings.ollamaUrl='http://localhost:1/v1';
           state.capabilities=['tools']; state.settings.incognitoMode=true; state.incognitoSessionActive=true;
           state.settings.anonymizeOutgoing=false;`);
    const result = await withTimeout(h.run(`sendMessage('¿Capital de Francia?')`));
    await settle();
    const chatCalls = calls.filter((c) => c.messages);
    return { result, calls: chatCalls, h, streaming: h.run('state.isStreaming'), msgs: h.run('getActiveChat().messages') };
}

console.log('1. Ollama: busca y luego responde\n');
{
    const r = await scenario({
        provider: 'ollama', endpoint: '/api/chat',
        toolReply: [JSON.stringify({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'search_web', arguments: { query: 'capital de Francia' } } }] }, done: true })],
    });
    check('sendMessage termina', r.result === 'resolved', r.result);
    check('hay una segunda petición con el resultado', r.calls.length >= 2, `peticiones: ${r.calls.length}`);
    check('la UI queda libre (isStreaming=false)', r.streaming === false);
    check('el chat acaba con la respuesta del modelo', r.msgs[r.msgs.length - 1]?.content === 'París.');
}

console.log('\n2. OpenAI: formato de la llamada de herramienta\n');
{
    const r = await scenario({
        provider: 'openai', endpoint: '/chat/completions',
        toolReply: [
            'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ id: 'call_abc', function: { name: 'search_web', arguments: '{"query":"capital' } }] } }] }),
            'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ function: { arguments: ' de Francia"}' } }] } }] }),
            'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
            'data: [DONE]',
        ],
    });
    check('sendMessage termina', r.result === 'resolved', r.result);
    const second = r.calls[1];
    const asst = second?.messages.find((m) => m.role === 'assistant' && m.tool_calls);
    const tool = second?.messages.find((m) => m.role === 'tool');
    check('la llamada lleva id y type', asst?.tool_calls?.[0]?.id === 'call_abc' && asst.tool_calls[0].type === 'function');
    check('los argumentos viajan como texto JSON y completos', asst?.tool_calls?.[0]?.function?.arguments === '{"query":"capital de Francia"}', JSON.stringify(asst?.tool_calls?.[0]?.function?.arguments));
    check('la respuesta de la herramienta cita el id', tool?.tool_call_id === 'call_abc', String(tool?.tool_call_id));
    check('la UI queda libre', r.streaming === false);
}

console.log('\n3. Un modelo que insiste en buscar tiene tope\n');
{
    const r = await scenario({
        provider: 'ollama', endpoint: '/api/chat', alwaysTool: true,
        toolReply: [JSON.stringify({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'search_web', arguments: { query: 'x' } } }] }, done: true })],
    });
    check('sendMessage termina', r.result === 'resolved', r.result);
    const withTools = r.calls.filter((c) => c.tools).length;
    check('no encadena búsquedas sin fin', r.calls.length <= 5, `peticiones: ${r.calls.length}, con herramientas: ${withTools}`);
    check('la última petición ya no ofrece herramientas', !r.calls[r.calls.length - 1]?.tools);
    check('la UI queda libre', r.streaming === false);
}

console.log('\n4. Con poco presupuesto, el último turno se conserva entero\n');
{
    const h = createChatHarness({ handler: async () => { throw new Error('sin red'); } });
    const e = (role, tokens, extra = {}) => ({ value: { role, content: role + tokens, ...extra }, tokens });
    // viejo (grande) · respuesta · PREGUNTA · llamada a herramienta · resultado enorme
    sandboxEntries(h, [e('user', 500), e('assistant', 500), e('user', 50), e('assistant', 5, { tool_calls: [{}] }), e('tool', 900)]);
    const r = h.run('applyHistoryBudget(__entries, 100)');
    const roles = r.kept.map((k) => k.value.role).join(',');
    check('conserva pregunta + llamada + resultado aunque excedan el presupuesto', roles === 'user,assistant,tool', roles);
    check('y descarta lo antiguo', r.dropped === 2, `descartados: ${r.dropped}`);
    sandboxEntries(h, [e('user', 10), e('assistant', 10), e('user', 10), e('assistant', 10)]);
    const r2 = h.run('applyHistoryBudget(__entries, 1000)');
    check('con presupuesto de sobra no descarta nada', r2.dropped === 0);
    sandboxEntries(h, [e('assistant', 10), e('assistant', 10)]);
    const r3 = h.run('applyHistoryBudget(__entries, 1)');
    check('sin ningún turno de usuario sigue conservando el último mensaje', r3.kept.length === 1 && r3.dropped === 1);
}

function sandboxEntries(h, entries) { h.sandbox.__entries = entries; }

if (failures) { console.error(`\n✖ ${failures} comprobaciones fallidas.`); process.exit(1); }
console.log('\n✔ Herramientas de búsqueda correctas.');
process.exit(0);
