/**
 * test-failover — resiliencia entre motores (nivel B) y lectura del enrutado de
 * la pasarela FreeLLMAPI (nivel A).
 *
 * Por qué: el failover reenvía el mensaje del usuario a OTRO proveedor. Los
 * fallos de esta zona no se ven en pantalla pero son caros: cruzar de motor
 * local a cloud filtra una consulta que debía quedarse en el equipo, reintentar
 * con texto ya recibido mezcla dos respuestas, y dejar el motor provisional en
 * la configuración guardada cambia lo que el usuario eligió. Aquí se fija ese
 * contrato con el envío REAL (sendMessage), no con una copia.
 *
 * Uso: npm run test:failover
 */
import { createChatHarness, streamOf, settle, withTimeout } from './harness-chat.mjs';

let failures = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failures++;
};

const hdr = (map = {}) => ({ get: (k) => map[String(k).toLowerCase()] ?? null });
const okReply = (text, headers = {}) => ({
    ...streamOf(['data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }), 'data: [DONE]']),
    headers: hdr(headers),
});
const failReply = (status, message, headers = {}) => ({
    ok: false, status, statusText: message, headers: hdr(headers),
    json: async () => ({ error: { message } }), text: async () => message,
    clone() { return this; },
});

/** Entorno con claves en los motores indicados y un manejador por host. */
function setup({ routes, keys = {}, provider = 'groq', failover = true, extra = {} }) {
    const calls = [];
    const h = createChatHarness({
        extra,
        handler: async (url, opts) => {
            const host = new URL(url).host;
            const route = routes[host];
            if (!route) throw new TypeError('Failed to fetch');
            calls.push({ host, auth: (opts.headers || {}).Authorization || '', body: opts.body ? JSON.parse(opts.body) : null });
            return route(url, opts, calls.length);
        },
    });
    h.run('secretVault.available = () => false');
    h.run(`clearEngineCooldowns();
           ${Object.entries(keys).map(([id, k]) => `state.settings.providerConfigs['${id}'].apiKey='${k}';`).join('\n')}
           state.settings.provider='${provider}'; syncProviderToState();
           state.settings.incognitoMode=true; state.incognitoSessionActive=true;
           state.settings.autoFailover=${failover};
           createChat();`);
    return { h, calls };
}
const lastMsg = (h) => JSON.parse(h.run('JSON.stringify(getActiveChat().messages.at(-1))'));

// ─── Clasificación de fallos ──────────────────────────────────────────────
console.log('\nClasificación de fallos\n');
{
    const { h } = setup({ routes: {} });
    const c = (e) => JSON.parse(h.run(`JSON.stringify(classifyEngineFailure(${e}))`));
    check('429 es cupo y admite otro motor', c(`Object.assign(new Error('429: x'), { status: 429 })`).kind === 'rate_limit'
        && c(`Object.assign(new Error('429: x'), { status: 429 })`).retryable === true);
    check('el estado se lee también del texto «503: …»', c(`new Error('503: caído')`).kind === 'server');
    check('y del formato antiguo «Error: 429 Too Many»', c(`new Error('Error: 429 Too Many Requests')`).kind === 'rate_limit');
    check('401 y 403 son credenciales', c(`new Error('401: no')`).kind === 'auth' && c(`new Error('403: no')`).kind === 'auth');
    check('402 es saldo', c(`new Error('402: pago')`).kind === 'credit');
    check('404 es modelo inexistente', c(`new Error('404: no model')`).kind === 'model');
    check('«Failed to fetch» es red y reintentable', c(`new TypeError('Failed to fetch')`).kind === 'network'
        && c(`new TypeError('Failed to fetch')`).retryable === true);
    check('un 400 NO se reenvía a otro proveedor', c(`new Error('400: bad request')`).retryable === false);
    check('un error desconocido NO se reenvía', c(`new Error('algo raro')`).retryable === false);
    h.run(`markEngineFailure('groq', 'm', classifyEngineFailure(new Error('400: bad request')), Date.now())`);
    check('y un 400 no deja al motor en pausa', h.run(`getEngineCooldown('groq', 'm')`) === 0);
    check('el «Retry-After» se conserva', c(`Object.assign(new Error('429: x'), { status: 429, retryAfterMs: 7000 })`).retryAfterMs === 7000);
    check('parseRetryAfter entiende segundos y fechas', h.run(`parseRetryAfter('30')`) === 30000
        && h.run(`parseRetryAfter('')`) === 0
        && h.run(`parseRetryAfter('Wed, 21 Oct 2026 07:28:30 GMT', Date.parse('Wed, 21 Oct 2026 07:28:00 GMT'))`) === 30000);
}

// ─── Escalera de pausas ───────────────────────────────────────────────────
console.log('\nEscalera de pausas\n');
{
    const { h } = setup({ routes: {}, keys: { groq: 'k' } });
    const ms = (provider, failure, now) => h.run(`markEngineFailure('${provider}', 'm', ${JSON.stringify(failure)}, ${now}).ms`);
    const rl = { kind: 'rate_limit', retryable: true, status: 429, retryAfterMs: 0 };
    const MIN = 60e3, H = 60 * MIN;
    check('1.er 429: 2 min', ms('groq', rl, 1000) === 2 * MIN);
    check('2.º 429 seguido: 10 min', ms('groq', rl, 2000) === 10 * MIN);
    check('3.er 429: 1 h', ms('groq', rl, 3000) === H);
    check('4.º 429: 24 h', ms('groq', rl, 4000) === 24 * H);
    check('pasadas 24 h la escalera empieza de nuevo', ms('groq', rl, 4000 + 25 * H) === 2 * MIN);
    h.run('clearEngineCooldowns()');
    check('con «Retry-After» se obedece y no escala', ms('groq', { ...rl, retryAfterMs: 45e3 }, 1000) === 45e3
        && ms('groq', rl, 2000) === 2 * MIN);
    h.run('clearEngineCooldowns()');
    check('un 5xx o la red pausan 90 s sin escalar', ms('groq', { kind: 'server', retryable: true, status: 502, retryAfterMs: 0 }, 1) === 90e3
        && ms('groq', { kind: 'network', retryable: true, status: 0, retryAfterMs: 0 }, 2) === 90e3);
    check('una clave rechazada pausa 10 min', ms('groq', { kind: 'auth', retryable: true, status: 401, retryAfterMs: 0 }, 1) === 10 * MIN);
    check('un motor local se recupera en 5 s y no escala', ms('ollama', rl, 1) === 5e3 && ms('ollama', rl, 2) === 5e3);
    h.run('clearEngineCooldowns()');
    h.run(`markEngineFailure('groq', 'm', ${JSON.stringify(rl)}, Date.now())`);
    check('mientras dura, el motor figura en pausa', h.run(`getEngineCooldown('groq', 'm')`) > 0);
    h.run(`markEngineSuccess('groq', 'm')`);
    check('un éxito la borra', h.run(`getEngineCooldown('groq', 'm')`) === 0);
    h.run(`markEngineFailure('groq', 'modelo-a', { kind: 'model', retryable: true, status: 404, retryAfterMs: 0 }, Date.now())`);
    check('un 404 pausa solo ese modelo, no el motor',
        h.run(`getEngineCooldown('groq', 'modelo-a')`) > 0 && h.run(`getEngineCooldown('groq', 'modelo-b')`) === 0);
    h.run('clearEngineCooldowns()');
}

// ─── Selección de motores alternativos ───────────────────────────────────
console.log('\nSelección de motores alternativos\n');
{
    const { h } = setup({ routes: {}, keys: { groq: 'g', mistral: 'm', openai: 'o', freellmapi: 'freellmapi-abcdefgh' } });
    const cands = (primary, extra = '') => JSON.parse(h.run(`JSON.stringify(getFailoverCandidates('${primary}', ${extra || '{}'}).map(c => c.provider))`));
    const fromGroq = cands('groq');
    check('desde un motor cloud solo salen motores cloud con clave',
        fromGroq.includes('mistral') && fromGroq.includes('openai') && fromGroq.includes('freellmapi'), fromGroq.join(','));
    check('no incluye el propio motor', !fromGroq.includes('groq'));
    check('no salta a WebGPU', !fromGroq.includes('webgpu'));
    check('NUNCA pasa de cloud a un motor local', !fromGroq.includes('ollama') && !fromGroq.includes('lmstudio'));
    check('un motor sin clave no es candidato', !fromGroq.includes('claude') && !fromGroq.includes('gemini'));
    check('la pasarela cuenta como cloud aunque sea localhost', fromGroq.includes('freellmapi'));
    // LM Studio y LocalAI no traen modelo de fábrica: sin uno configurado no son candidatos.
    check('un motor sin modelo configurado no es candidato', !cands('ollama').includes('lmstudio'));
    h.run(`state.settings.providerConfigs.lmstudio.model='qwen3'; state.settings.providerConfigs.localai.model='llama'`);
    const fromOllama = cands('ollama');
    check('desde un motor local NUNCA salen motores cloud',
        !fromOllama.some(id => ['groq', 'mistral', 'openai', 'freellmapi'].includes(id)), fromOllama.join(','));
    check('desde un motor local sí quedan los locales', fromOllama.includes('lmstudio') && fromOllama.includes('localai'));
    check('se omiten los ya probados', !cands('groq', `{ exclude: ['mistral'] }`).includes('mistral'));
    h.run(`markEngineFailure('openai', 'gpt-4.1', { kind: 'rate_limit', retryable: true, status: 429, retryAfterMs: 0 }, Date.now())`);
    check('un motor en pausa no es candidato', !cands('groq').includes('openai'));
    h.run('clearEngineCooldowns()');
    h.run(`state.settings.modelSuccessHistory = [{ provider: 'openai', model: 'gpt-4.1-mini' }, { provider: 'mistral', model: 'mistral-large-latest' }];`);
    const ordered = JSON.parse(h.run(`JSON.stringify(getFailoverCandidates('groq'))`));
    check('antes van los que han respondido bien hace poco, con ese modelo',
        ordered[0].provider === 'openai' && ordered[0].model === 'gpt-4.1-mini' && ordered[1].provider === 'mistral', JSON.stringify(ordered.slice(0, 2)));
}

// ─── Motor provisional ────────────────────────────────────────────────────
console.log('\nMotor provisional\n');
{
    const stored = [];
    const { h } = setup({
        routes: {}, keys: { groq: 'gk', mistral: 'mk' },
        extra: { localStorage: { getItem: () => null, setItem: (k, v) => { if (k === 'antigravity_settings') stored.push(JSON.parse(v)); }, removeItem() {} } },
    });
    const during = await h.run(`withEngineOverride('mistral', 'mistral-small-latest', async () => {
        saveState();
        return { p: state.settings.provider, m: state.settings.model, u: state.settings.ollamaUrl, k: state.settings.apiKey };
    })`);
    check('dentro de la llamada hay otro motor, con SU clave y SU URL',
        during.p === 'mistral' && during.m === 'mistral-small-latest' && during.k === 'mk' && /mistral\.ai/.test(during.u), JSON.stringify(during));
    check('al terminar todo vuelve a estar como estaba',
        h.run(`state.settings.provider`) === 'groq' && h.run(`state.settings.apiKey`) === 'gk' && h.run(`state._engineOverride`) === null);
    check('lo guardado durante el cambio sigue siendo el motor elegido por el usuario',
        stored.length > 0 && stored.every(s => s.provider === 'groq'), stored.map(s => s.provider).join(','));
    let threw = false;
    try { await h.run(`withEngineOverride('mistral', 'x', async () => { throw new Error('boom'); })`); } catch (_) { threw = true; }
    check('aunque la llamada falle se restaura', threw && h.run(`state.settings.provider`) === 'groq' && h.run(`state._engineOverride`) === null);
}

// ─── Envío real ───────────────────────────────────────────────────────────
console.log('\nEnvío con failover desactivado\n');
{
    const { h, calls } = setup({
        routes: { 'api.groq.com': () => failReply(429, 'Rate limit reached', { 'retry-after': '12' }), 'api.mistral.ai': () => okReply('desde mistral') },
        keys: { groq: 'gk', mistral: 'mk' }, failover: false,
    });
    const r = await withTimeout(h.run(`sendMessage('hola')`));
    await settle();
    const m = lastMsg(h);
    check('el envío termina', r === 'resolved', r);
    check('solo se llama al motor elegido', calls.length === 1 && calls[0].host === 'api.groq.com', calls.map(c => c.host).join(','));
    check('el error explica que es un cupo, no una clave', /Cupo agotado/.test(m.content) && /12 s/.test(m.content), m.content.slice(0, 120));
    check('no queda marca de failover', !m.failover);
}

console.log('\nEnvío con failover activado\n');
{
    const { h, calls } = setup({
        routes: { 'api.groq.com': () => failReply(429, 'Rate limit reached', { 'retry-after': '30' }), 'api.mistral.ai': () => okReply('desde mistral') },
        keys: { groq: 'gk', mistral: 'mk' },
    });
    const r = await withTimeout(h.run(`sendMessage('hola')`));
    await settle();
    const m = lastMsg(h);
    check('el envío termina', r === 'resolved', r);
    check('se prueba primero el elegido y después el alternativo',
        calls.length === 2 && calls[0].host === 'api.groq.com' && calls[1].host === 'api.mistral.ai', calls.map(c => c.host).join(','));
    check('cada motor recibe SU clave y no la del otro', calls[0].auth === 'Bearer gk' && calls[1].auth === 'Bearer mk', calls.map(c => c.auth).join(','));
    check('la respuesta es la del motor alternativo', m.content === 'desde mistral');
    check('el mensaje dice quién contestó de verdad', m.provider === 'mistral');
    check('y qué motor se saltó y por qué',
        m.failover?.hops?.[0]?.provider === 'groq' && m.failover.hops[0].kind === 'rate_limit', JSON.stringify(m.failover));
    check('la configuración del usuario queda intacta', h.run(`state.settings.provider`) === 'groq' && h.run(`state.settings.apiKey`) === 'gk');
    check('el motor que falló queda en pausa según su «Retry-After»',
        (() => { const ms = h.run(`getEngineCooldown('groq', state.settings.model)`); return ms > 25e3 && ms <= 30e3; })());
    check('el que respondió figura como éxito reciente', h.run(`state.settings.modelSuccessHistory[0].provider`) === 'mistral');

    // Segunda consulta: el motor en pausa no se vuelve a golpear.
    calls.length = 0;
    await withTimeout(h.run(`sendMessage('otra')`));
    await settle();
    check('mientras está en pausa se va directo al alternativo', calls.length === 1 && calls[0].host === 'api.mistral.ai', calls.map(c => c.host).join(','));
    check('y el mensaje lo refleja como «en pausa»', lastMsg(h).failover?.hops?.[0]?.kind === 'cooldown');
}

console.log('\nLímites del failover\n');
{
    // Local → nunca cloud
    const { h, calls } = setup({
        routes: { 'api.groq.com': () => okReply('no debería'), 'api.mistral.ai': () => okReply('no debería') },
        keys: { groq: 'gk', mistral: 'mk' }, provider: 'ollama',
    });
    h.run(`state.settings.model='m'`);
    await withTimeout(h.run(`sendMessage('privado')`));
    await settle();
    const m = lastMsg(h);
    check('si un motor local cae, la consulta NO sale a ningún proveedor cloud',
        !calls.some(c => c.host.includes('groq') || c.host.includes('mistral')), calls.map(c => c.host).join(','));
    check('y el usuario recibe el error', /⚠️/.test(m.content));
}
{
    // Con texto ya recibido no se reintenta
    const enc = new TextEncoder();
    const partial = () => {
        let i = 0;
        return {
            ok: true, status: 200, statusText: 'OK', headers: hdr(),
            body: { getReader: () => ({ read: async () => {
                if (i++ === 0) return { done: false, value: enc.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: 'medio' } }] }) + '\n') };
                throw new TypeError('network error');
            } }) },
        };
    };
    const { h, calls } = setup({
        routes: { 'api.groq.com': partial, 'api.mistral.ai': () => okReply('otra respuesta') },
        keys: { groq: 'gk', mistral: 'mk' },
    });
    await withTimeout(h.run(`sendMessage('hola')`));
    await settle();
    check('un corte a mitad de respuesta no se reintenta en otro motor', calls.length === 1 && calls[0].host === 'api.groq.com', calls.map(c => c.host).join(','));
    check('no se mezclan dos respuestas', !/otra respuesta/.test(lastMsg(h).content));
}
{
    // Un 400 es culpa de la petición: no se manda a otro proveedor
    const { h, calls } = setup({
        routes: { 'api.groq.com': () => failReply(400, 'bad request'), 'api.mistral.ai': () => okReply('no') },
        keys: { groq: 'gk', mistral: 'mk' },
    });
    await withTimeout(h.run(`sendMessage('hola')`));
    await settle();
    check('un 400 no se reenvía a otro proveedor', calls.length === 1, calls.map(c => c.host).join(','));
}
{
    // Todos fallan: máximo de saltos y el error nombra los motores probados
    const down = () => failReply(503, 'unavailable');
    const { h, calls } = setup({
        routes: { 'api.groq.com': down, 'api.mistral.ai': down, 'api.openai.com': down, 'api.cerebras.ai': down },
        keys: { groq: 'gk', mistral: 'mk', openai: 'ok', cerebras: 'ck' },
    });
    h.run(`state.settings.providerConfigs.cerebras.model='llama3.1-8b'`);
    await withTimeout(h.run(`sendMessage('hola')`));
    await settle();
    const m = lastMsg(h);
    check('no recorre todos los motores: el elegido + 2 alternativos como máximo', calls.length === 3, calls.map(c => c.host).join(','));
    check('el error final enumera los motores probados', /Motores probados/.test(m.content) && /groq/.test(m.content), m.content.slice(-160));
}

console.log('\nEnrutado de la pasarela (FreeLLMAPI)\n');
{
    const { h } = setup({
        routes: { 'localhost:31415': () => okReply('hola', { 'x-routed-via': 'groq/llama-3.3-70b-versatile', 'x-fallback-attempts': '2', 'x-fallback-trail': 'google/gemini key1=rate_limited' }) },
        keys: { freellmapi: 'freellmapi-abcdefgh' }, provider: 'freellmapi', failover: false,
    });
    await withTimeout(h.run(`sendMessage('hola')`));
    await settle();
    const m = lastMsg(h);
    check('guarda qué proveedor sirvió la respuesta', m.routing?.via === 'groq/llama-3.3-70b-versatile', JSON.stringify(m.routing));
    check('y los saltos que dio la pasarela', m.routing?.attempts === 2 && /rate_limited/.test(m.routing.trail));
    check('el motor del mensaje sigue siendo la pasarela', m.provider === 'freellmapi');
}
{
    const { h } = setup({ routes: { 'localhost:31415': () => okReply('hola') }, keys: { freellmapi: 'freellmapi-abcdefgh' }, provider: 'freellmapi', failover: false });
    await withTimeout(h.run(`sendMessage('hola')`));
    await settle();
    check('sin cabeceras legibles no se inventa nada', lastMsg(h).routing === undefined);
}
{
    const names = JSON.parse(setup({ routes: {} }).h.run(`JSON.stringify(withGatewayStrategies([{ name: 'gpt-oss-120b' }]).map(m => m.name))`));
    check('ofrece «auto» y las estrategias aunque el catálogo no las traiga',
        ['auto', 'auto:smart', 'auto:fast', 'auto:reliable', 'auto:balanced'].every(n => names.includes(n)) && names.includes('gpt-oss-120b'), names.join(','));
    const again = JSON.parse(setup({ routes: {} }).h.run(`JSON.stringify(withGatewayStrategies([{ name: 'auto' }]).filter(m => m.name === 'auto').length)`));
    check('sin duplicar «auto» si ya viene', again === 1);
}

console.log('\nPuerto de la pasarela\n');
{
    const jsonRes = (status, body) => ({ ok: status < 400, status, headers: hdr(), json: async () => body, clone() { return this; }, text: async () => JSON.stringify(body) });
    const run = async (routes) => {
        const { h } = setup({ routes, keys: { freellmapi: 'freellmapi-abcdefgh' }, provider: 'freellmapi', failover: false });
        await withTimeout(h.run(`checkProviderStatus()`), 6000);
        return h;
    };
    // Docker: nada en 31415, pasarela real en 3001
    let h = await run({
        'localhost:3001': (url) => url.endsWith('/api/ping') ? jsonRes(200, { ok: true })
            : url.endsWith('/v1/models') ? jsonRes(200, { data: [{ id: 'llama-3.3-70b' }] }) : jsonRes(404, {}),
    });
    check('si no hay nada en :31415 y sí en :3001, pasa a esa URL', h.run(`state.settings.ollamaUrl`) === 'http://localhost:3001/v1', h.run(`state.settings.ollamaUrl`));
    check('y la deja guardada en el motor', h.run(`state.settings.providerConfigs.freellmapi.url`) === 'http://localhost:3001/v1');
    // Un servicio ajeno en 3001 no se confunde con la pasarela
    h = await run({ 'localhost:3001': (url) => url.endsWith('/api/ping') ? jsonRes(200, { ok: true }) : { ...jsonRes(200, null), json: async () => { throw new Error('html'); } } });
    check('un servicio cualquiera en :3001 no se toma por la pasarela', h.run(`state.settings.ollamaUrl`) === 'http://localhost:31415/v1');
    // El usuario con URL propia no se toca
    const own = setup({ routes: { 'localhost:3001': () => jsonRes(200, { data: [] }) }, keys: { freellmapi: 'k' }, provider: 'freellmapi', failover: false });
    own.h.run(`state.settings.ollamaUrl='http://192.168.1.5:9000/v1'`);
    await withTimeout(own.h.run(`checkProviderStatus()`), 6000);
    check('una URL personalizada no se sustituye', own.h.run(`state.settings.ollamaUrl`) === 'http://192.168.1.5:9000/v1');
}

console.log('');
if (failures) { console.error(`✖ ${failures} comprobación(es) fallida(s).`); process.exit(1); }
console.log('✔ Resiliencia entre motores correcta.');
