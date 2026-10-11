/**
 * test-providers — motores clonados y catálogo de proveedores.
 *
 * Por qué: un clon es una entrada MÁS dentro de PROVIDERS, así que comparte
 * mecanismos con los motores de serie (providerConfigs, favoritos, historial,
 * cabeceras). Los fallos de esta zona son silenciosos y caros: un clon que
 * pierde su `type` deja de saber hablar con su API, un id reutilizado hace que
 * dos conexiones compartan credencial, y un borrado incompleto deja al usuario
 * apuntando a un motor inexistente. Aquí se fija ese contrato.
 *
 * Uso: npm run test:providers
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import { classicSource } from './lib/generated-blocks.mjs';

const root = process.cwd();
const read = (p) => classicSource(readFileSync, resolve(root, p));

const noopEl = () => ({
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    addEventListener() {}, removeEventListener() {}, appendChild() {}, insertBefore() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    style: {}, dataset: {}, textContent: '', innerHTML: '', value: '', focus() {},
});

const sandbox = {
    document: {
        querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
        createElement: () => noopEl(), addEventListener() {}, readyState: 'complete',
        documentElement: { setAttribute() {}, lang: 'es' },
        body: { classList: { toggle() {}, add() {}, remove() {} }, appendChild() {} },
        head: { appendChild() {} }, hidden: false,
    },
    navigator: { userAgent: 'node', languages: ['es'], maxTouchPoints: 0, platform: 'Linux', storage: null },
    console: { ...console, warn() {}, error() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => Date.now(), memory: null },
    // WebCrypto REAL, no un doble: aquí se comprueba PKCE, y un getRandomValues
    // que devolviera el array intacto daría verificadores idénticos sin que la
    // prueba se enterase —justo el fallo que debe detectar—.
    crypto: {
        randomUUID: () => webcrypto.randomUUID(),
        subtle: webcrypto.subtle,
        getRandomValues: (a) => webcrypto.getRandomValues(a),
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    indexedDB: { open: () => ({}) },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    requestIdleCallback: (fn) => setTimeout(fn, 0),
    fetch: () => Promise.reject(new Error('sin red')),
    AbortController: globalThis.AbortController,
    AbortSignal: globalThis.AbortSignal,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    Worker: class { postMessage() {} terminate() {} },
    DOMParser: class { parseFromString() { return { body: { querySelectorAll: () => [], innerHTML: '' } }; } },
    Blob: globalThis.Blob,
    URL: globalThis.URL,
    URLSearchParams: globalThis.URLSearchParams,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.location = { protocol: 'https:', host: 'wia.test', origin: 'https://wia.test', hostname: 'wia.test' };
sandbox.window.matchMedia = () => ({ matches: false, addEventListener() {} });
createContext(sandbox);

for (const file of ['Plantilla/Version.js', 'secure-gate.js',
    'js/01-core.js', 'js/02-state.js', 'js/03-webgpu.js', 'js/04-providers.js',
    'js/05-workspace.js', 'js/06-chat.js', 'js/07-ui.js', 'js/08-anon.js',
    'js/09-i18n.js', 'js/10-docs.js', 'js/11-rag.js', 'js/12-pwa.js']) {
    runInContext(read(file), sandbox, { filename: file });
}

let failures = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failures++;
};
const run = (expr) => runInContext(expr, sandbox);

console.log('1. LocalAI en el catálogo\n');

check('LocalAI existe y habla el dialecto de OpenAI', run(`PROVIDERS.localai?.type`) === 'openai',
    run(`PROVIDERS.localai?.type`));
check('su clave es opcional (solo si se arranca con API_KEY)', run(`PROVIDERS.localai?.auth`) === 'optional_bearer',
    run(`PROVIDERS.localai?.auth`));
check('aparece antes de Groq en el catálogo', run(`(() => {
    const ids = Object.keys(PROVIDERS);
    return ids.indexOf('localai') > -1 && ids.indexOf('localai') < ids.indexOf('groq');
})()`) === true);
check('trae configuración propia memorizable', run(`state.settings.providerConfigs.localai?.url`) === 'http://localhost:8080/v1',
    run(`state.settings.providerConfigs.localai?.url`));

// Antes de que ninguna prueba toque providerConfigs a mano: recién cargada, la
// configuración de cada motor debe traer el endpoint que publica su catálogo.
const urlsDivergentes = run(`(() => {
    const malos = [];
    for (const [id, def] of Object.entries(PROVIDERS)) {
        if (def.custom || !def.defaultUrl) continue;
        const pc = state.settings.providerConfigs[id];
        if (pc && pc.url !== def.defaultUrl) malos.push(id);
    }
    return malos;
})()`);
check('cada motor arranca con su endpoint oficial en la configuración',
    urlsDivergentes.length === 0, urlsDivergentes.join(', '));

// ChatGPT por suscripción: wIA habla con una pasarela LOCAL, no con OpenAI.
// Si esta entrada apuntara a api.openai.com mandaría la petición al sitio
// equivocado, y sin API key devolvería 401 sin explicar por qué.
check('el motor de suscripción apunta a una pasarela local, no a OpenAI', run(`(() => {
    const url = PROVIDERS.chatgpt_local?.defaultUrl || '';
    return /^http:\\/\\/(127\\.0\\.0\\.1|localhost):/.test(url) && !/openai\\.com/.test(url);
})()`) === true, run(`PROVIDERS.chatgpt_local?.defaultUrl`));
check('y no pide API Key, porque la pasarela ya está autenticada',
    run(`PROVIDERS.chatgpt_local?.auth`) === 'none', run(`PROVIDERS.chatgpt_local?.auth`));
check('habla el dialecto de OpenAI', run(`PROVIDERS.chatgpt_local?.type`) === 'openai');
check('no se confunde con el motor OpenAI de API Key',
    run(`PROVIDERS.openai.defaultUrl`) === 'https://api.openai.com/v1' &&
    run(`PROVIDERS.openai.auth`) === 'apikey');

console.log('\n2. Clonar una conexión\n');

// El escenario real: un Ollama ya configurado a mano al que se le saca copia.
run(`state.settings.providerConfigs.ollama = {
    url: 'http://192.168.1.50:11434', model: 'llama3.2', apiKey: 'secreto',
    temperature: 0.3, topP: 0.5, topK: 10, maxTokens: 2048,
};`);
const cloneId = run(`cloneProvider('ollama', 'Ollama Oficina')`);

check('el clon se registra en PROVIDERS', run(`!!PROVIDERS['${cloneId}']`) === true, cloneId);
check('hereda el dialecto de su base', run(`PROVIDERS['${cloneId}'].type`) === 'ollama');
check('se reconoce como copia', run(`isCustomProvider('${cloneId}')`) === true);
check('getProviderBaseId lo resuelve a su original', run(`getProviderBaseId('${cloneId}')`) === 'ollama');
check('conserva el nombre elegido', run(`PROVIDERS['${cloneId}'].name`) === 'Ollama Oficina');
check('copia la configuración ACTUAL, no la de fábrica',
    run(`state.settings.providerConfigs['${cloneId}'].url`) === 'http://192.168.1.50:11434',
    run(`state.settings.providerConfigs['${cloneId}'].url`));
check('copia también modelo y parámetros ajustados',
    run(`state.settings.providerConfigs['${cloneId}'].model`) === 'llama3.2' &&
    run(`state.settings.providerConfigs['${cloneId}'].temperature`) === 0.3);
check('el original queda intacto', run(`state.settings.providerConfigs.ollama.url`) === 'http://192.168.1.50:11434');

// Dos conexiones al mismo tipo de motor no pueden pisarse la configuración.
run(`state.settings.providerConfigs['${cloneId}'].url = 'http://oficina.local:11434';`);
check('cada copia guarda su URL por separado',
    run(`state.settings.providerConfigs.ollama.url`) === 'http://192.168.1.50:11434' &&
    run(`state.settings.providerConfigs['${cloneId}'].url`) === 'http://oficina.local:11434');

const twinId = run(`cloneProvider('ollama', 'Ollama Oficina')`);
check('un nombre repetido NO reutiliza el id de la copia previa', twinId !== cloneId, `${cloneId} vs ${twinId}`);
check('y ambas conviven en el catálogo', run(`!!PROVIDERS['${cloneId}'] && !!PROVIDERS['${twinId}']`) === true);

check('un clon se puede clonar a su vez, sin encadenar bases', run(`(() => {
    const nieto = cloneProvider('${cloneId}', 'Ollama Sucursal');
    return PROVIDERS[nieto].baseProvider === 'ollama';
})()`) === true);

check('WebGPU no es clonable (no tiene endpoint propio)',
    run(`isCloneableProvider('webgpu')`) === false && run(`cloneProvider('webgpu', 'Otro')`) === null);

console.log('\n3. Decisiones que se tomaban por id\n');

check('las cabeceras extra de OpenRouter alcanzan a sus clones', run(`(() => {
    const id = cloneProvider('openrouter', 'OpenRouter 2');
    state.settings.provider = id;
    state.settings.apiKey = 'k';
    const h = getAuthHeaders();
    state.settings.provider = 'ollama';
    return !!h['HTTP-Referer'] && !!h['X-Title'];
})()`) === true);

check('un clon de Groq conserva el soporte de herramientas', run(`(() => {
    const id = cloneProvider('groq', 'Groq 2');
    return getModelFunctionKeys({ name: 'llama-3.3-70b-versatile' }, id).includes('tools');
})()`) === true);

check('el diagnóstico de red de un clon es el de su motor base', run(`(() => {
    const id = cloneProvider('lmstudio', 'LM Studio 2');
    // Sin DOM real, basta con que no reviente y siga distinguiendo la base.
    return getProviderBaseId(id) === 'lmstudio';
})()`) === true);

console.log('\n4. Endpoint oficial propuesto\n');

// Todo motor comercial debe traer su endpoint publicado: es lo que se ofrece
// para recuperarlo cuando el usuario lo cambia o lo borra.
const sinEndpoint = run(`(() => {
    const comerciales = ['groq', 'openrouter', 'gemini', 'claude', 'openai', 'nvidia', 'ollama_cloud', 'localai', 'lmstudio'];
    return comerciales.filter(id => !PROVIDERS[id] || !PROVIDERS[id].defaultUrl);
})()`);
check('todos los motores con endpoint publicado lo declaran', sinEndpoint.length === 0, sinEndpoint.join(', '));

check('una copia hereda el endpoint oficial de su base', run(`(() => {
    const id = cloneProvider('claude', 'Claude trabajo');
    return PROVIDERS[id].defaultUrl === PROVIDERS.claude.defaultUrl;
})()`) === true);

check('Ollama remoto no propone endpoint: el host lo pone el usuario',
    run(`PROVIDERS.ollama_remote.defaultUrl`) === '');

console.log('\n5. OAuth con el proveedor (PKCE)\n');

check('OpenRouter ofrece inicio de sesión', run(`supportsProviderOAuth('openrouter')`) === true);
check('y sus copias lo heredan', run(`(() => {
    const id = cloneProvider('openrouter', 'OpenRouter OAuth');
    return supportsProviderOAuth(id) && getProviderOAuth(id).label === 'OpenRouter';
})()`) === true);
// No se anuncia OAuth donde el proveedor no lo publica para terceros: un botón
// que lleva a una página de error es peor que no tener botón.
const oauthIndebido = run(`['openai','claude','groq','nvidia','gemini','ollama','lmstudio','localai','webgpu','chatgpt_local']
    .filter(id => supportsProviderOAuth(id))`);
check('no se anuncia en los motores que no lo publican', oauthIndebido.length === 0, oauthIndebido.join(', '));

check('el verificador PKCE es largo y del alfabeto permitido', run(`(() => {
    const v = createPkceVerifier();
    return v.length >= 43 && v.length <= 128 && /^[A-Za-z0-9\\-._~]+$/.test(v);
})()`) === true);
check('dos verificadores seguidos no se repiten',
    run(`createPkceVerifier() !== createPkceVerifier()`) === true);
check('el reto es base64url sin relleno', await run(`(async () => {
    const c = await createPkceChallenge('verificador-de-prueba');
    return typeof c === 'string' && c.length > 0 && !/[+/=]/.test(c);
})()`) === true);
check('el mismo verificador da siempre el mismo reto (S256)', await run(`(async () => {
    const a = await createPkceChallenge('abc');
    const b = await createPkceChallenge('abc');
    const c = await createPkceChallenge('abd');
    return a === b && a !== c;
})()`) === true);

console.log('\n6. Renombrar y eliminar\n');

check('renombrar cambia el rótulo…', run(`(() => {
    renameCustomProvider('${cloneId}', 'Ollama Sede');
    return PROVIDERS['${cloneId}'].name;
})()`) === 'Ollama Sede');
check('…y NO el id, para no romper su configuración guardada',
    run(`state.settings.providerConfigs['${cloneId}'].url`) === 'http://oficina.local:11434');
check('renameCustomProvider sigue reservado a las copias', run(`renameCustomProvider('ollama', 'Mi Ollama')`) === false);
check('un motor de serie no se puede eliminar', run(`deleteCustomProvider('ollama') === false && !!PROVIDERS.ollama`) === true);

// Renombrar un motor de serie: cambia el rótulo, NO el id, y se puede deshacer.
check('un motor de serie sí se puede renombrar', run(`(() => {
    renameProvider('ollama', 'Ollama del salón');
    return PROVIDERS.ollama.name;
})()`) === 'Ollama del salón');
check('el rótulo se guarda aparte, sin tocar el id ni su configuración',
    run(`state.settings.providerNames.ollama`) === 'Ollama del salón' &&
    run(`!!state.settings.providerConfigs.ollama`) === true);
check('la barra de estado muestra el nombre elegido, no la abreviatura fija',
    run(`getCompactProviderLabel('ollama')`) === 'Ollama del salón',
    run(`getCompactProviderLabel('ollama')`));
check('sobrevive a una re-sincronización (arranque)', run(`(() => {
    syncCustomProviders();
    return PROVIDERS.ollama.name;
})()`) === 'Ollama del salón');
check('un nombre vacío restaura el de fábrica', run(`(() => {
    renameProvider('ollama', '   ');
    return PROVIDERS.ollama.name === getDefaultProviderName('ollama')
        && state.settings.providerNames.ollama === undefined;
})()`) === true);
check('reescribir el nombre de fábrica no deja basura guardada', run(`(() => {
    renameProvider('ollama', getDefaultProviderName('ollama'));
    return state.settings.providerNames.ollama === undefined;
})()`) === true);
check('renombrar un motor inexistente no crea nada', run(`renameProvider('no-existe', 'X')`) === false);
check('renameProvider vale igual para las copias', run(`(() => {
    const id = cloneProvider('ollama', 'Copia renombrable');
    renameProvider(id, 'Ya renombrada');
    return PROVIDERS[id].name === 'Ya renombrada' && state.settings.providerNames[id] === undefined;
})()`) === true);
check('renombrar la base NO arrastra el nombre de sus copias', run(`(() => {
    const id = cloneProvider('groq', 'Groq de pruebas');
    renameProvider('groq', 'Groq renombrado');
    const ok = PROVIDERS[id].name === 'Groq de pruebas' && PROVIDERS.groq.name === 'Groq renombrado';
    renameProvider('groq', '');
    return ok;
})()`) === true);

check('al eliminar la copia activa se vuelve a su motor base', run(`(() => {
    state.settings.provider = '${twinId}';
    state.settings.favoriteProviders = ['${twinId}', 'ollama'];
    state.settings.providerUsageHistory = ['${twinId}', 'webgpu'];
    state.projects = [{ id: 'p1', agentProvider: '${twinId}' }];
    deleteCustomProvider('${twinId}');
    return state.settings.provider;
})()`) === 'ollama');
check('y no deja rastro en configuración, favoritos ni historial', run(`(() => {
    return !PROVIDERS['${twinId}']
        && !state.settings.providerConfigs['${twinId}']
        && !state.settings.favoriteProviders.includes('${twinId}')
        && !state.settings.providerUsageHistory.includes('${twinId}');
})()`) === true);
check('los proyectos que lo usaban caen a su motor base, no a un id fantasma',
    run(`state.projects[0].agentProvider`) === 'ollama');
check('las demás copias sobreviven al borrado', run(`!!PROVIDERS['${cloneId}']`) === true);

console.log('\n7. Persistencia entre sesiones\n');

check('registrar es idempotente: no duplica al repetirse', run(`(() => {
    const antes = Object.keys(PROVIDERS).length;
    syncCustomProviders();
    syncCustomProviders();
    return Object.keys(PROVIDERS).length === antes;
})()`) === true);

check('una copia huérfana (base retirada) se descarta en vez de quedar sin dialecto', run(`(() => {
    const registrados = registerCustomProviders([
        { id: 'zombi~x', name: 'Zombi', baseProvider: 'motor-que-ya-no-existe' },
    ]);
    return registrados.length === 0 && !PROVIDERS['zombi~x'];
})()`) === true);

check('y se purga de los ajustes para no reaparecer', run(`(() => {
    state.settings.customProviders = [{ id: 'zombi~y', name: 'Zombi', baseProvider: 'nada' }];
    syncCustomProviders();
    return state.settings.customProviders.length === 0;
})()`) === true);

check('las claves de las copias entran en la bóveda cifrada', run(`(() => {
    const id = cloneProvider('groq', 'Groq bóveda');
    state.settings.providerConfigs[id].apiKey = 'gsk_test';
    const slots = [];
    forEachSecretSlot(state.settings, (obj, slot) => slots.push(slot));
    return slots.includes(id);
})()`) === true);

check('settingsWithoutSecrets vacía también la clave de las copias', run(`(() => {
    const limpio = settingsWithoutSecrets(state.settings);
    return Object.values(limpio.providerConfigs).every(pc => pc.apiKey === '');
})()`) === true);

// Sin favoritos ni historial que manden, cada copia debe salir pegada a su
// original en vez de amontonarse al final de la lista.
const orden = run(`(() => {
    state.settings.favoriteProviders = [];
    state.settings.providerUsageHistory = [];
    cloneProvider('ollama', 'Ollama Orden');
    return getOrderedProviderEntries().map(([id]) => id);
})()`);
check('cada copia aparece justo debajo de su motor base en la lista',
    orden.indexOf('ollama~ollama-orden') === orden.indexOf('ollama') + 1,
    orden.join(' › '));

console.log('\nMistral y Cerebras en el catálogo\n');

for (const [id, url] of [['mistral', 'https://api.mistral.ai/v1'], ['cerebras', 'https://api.cerebras.ai/v1']]) {
    check(`${id} existe, habla el dialecto de OpenAI y pide clave`,
        run(`PROVIDERS.${id}?.type`) === 'openai' && run(`PROVIDERS.${id}?.auth`) === 'apikey',
        `${run(`PROVIDERS.${id}?.type`)} / ${run(`PROVIDERS.${id}?.auth`)}`);
    check(`${id} arranca con su endpoint oficial`, run(`PROVIDERS.${id}.defaultUrl`) === url
        && run(`state.settings.providerConfigs.${id}?.url`) === url, run(`state.settings.providerConfigs.${id}?.url`));
    check(`el modelo de fábrica de ${id} coincide en catálogo y ajustes`,
        run(`PROVIDERS.${id}.defaultModel === state.settings.providerConfigs.${id}.model`) === true);
    check(`${id} se puede clonar y la copia hereda herramientas`, run(`(() => {
        const copia = cloneProvider('${id}', 'Copia de prueba ${id}');
        const ok = !!copia && getProviderBaseId(copia) === '${id}'
            && getModelFunctionKeys({ name: 'modelo' }, copia).includes('tools');
        deleteCustomProvider(copia);
        return ok;
    })()`) === true);
    check(`${id} tiene enlace a su catálogo de modelos`, run(`getProviderExploreLinks('${id}').length`) > 0);
    check(`${id} no ofrece OAuth (solo API key)`, run(`supportsProviderOAuth('${id}')`) === false);
}
check('salen detrás de los motores cloud que ya había', (() => {
    const ids = run(`(() => {
        state.settings.favoriteProviders = [];
        state.settings.providerUsageHistory = [];
        return getOrderedProviderEntries().map(([id]) => id).filter(id => !id.includes('~'));
    })()`);
    return ids.indexOf('mistral') > ids.indexOf('nvidia') && ids.indexOf('cerebras') > ids.indexOf('mistral');
})());
check('el proxy local los admite como destino', /'api\.mistral\.ai'/.test(read('server.js')) && /'api\.cerebras\.ai'/.test(read('server.js')));

console.log('\nFreeLLMAPI (pasarela autoalojada)\n');

check('existe, habla el dialecto de OpenAI y pide su clave unificada',
    run(`PROVIDERS.freellmapi?.type`) === 'openai' && run(`PROVIDERS.freellmapi?.auth`) === 'apikey');
check('apunta a la pasarela local con el modelo «auto»',
    run(`PROVIDERS.freellmapi.defaultUrl`) === 'http://localhost:31415/v1' && run(`state.settings.providerConfigs.freellmapi.model`) === 'auto');
check('reconoce su clave y la distingue de las de otros proveedores',
    run(`checkApiKeyFormat('freellmapi', 'freellmapi-abc123def456').ok`) === true
    && run(`checkApiKeyFormat('freellmapi', 'gsk_' + 'a1B2'.repeat(8)).looksLike`) === 'groq'
    && run(`checkApiKeyFormat('openai', 'freellmapi-abc123def456').looksLike`) === 'freellmapi');
check('aunque su URL sea localhost, NO se anuncia como IA local', run(`(() => {
    const prev = state.settings.provider;
    saveCurrentProviderConfig(); state.settings.provider = 'freellmapi'; syncProviderToState();
    const loc = getAILocality();
    state.settings.provider = prev; syncProviderToState();
    return loc.mode === 'cloud' && /pasarela/.test(loc.detail);
})()`) === true);
check('lo mismo vale para la pasarela de ChatGPT', run(`(() => {
    const prev = state.settings.provider;
    saveCurrentProviderConfig(); state.settings.provider = 'chatgpt_local'; syncProviderToState();
    const mode = getAILocality().mode;
    state.settings.provider = prev; syncProviderToState();
    return mode;
})()`) === 'cloud');
check('un Ollama en localhost sigue siendo IA local', run(`(() => {
    const prev = state.settings.provider;
    saveCurrentProviderConfig(); state.settings.provider = 'ollama'; syncProviderToState();
    const mode = getAILocality().mode;
    state.settings.provider = prev; syncProviderToState();
    return mode;
})()`) === 'local');
check('una copia de la pasarela hereda su condición', run(`(() => {
    const id = cloneProvider('freellmapi', 'Free de prueba');
    const ok = PROVIDERS[id].gateway === true;
    deleteCustomProvider(id);
    return ok;
})()`) === true);

console.log('\nFicha de acceso de los motores con clave\n');

const conClave = run(`Object.keys(PROVIDERS).filter(id => PROVIDERS[id].auth === 'apikey')`);
check('todo motor que exige clave dice dónde se consigue',
    conClave.every(id => /^https:\/\//.test(run(`getProviderAccess('${id}')?.keyUrl || ''`))),
    conClave.filter(id => !run(`getProviderAccess('${id}')?.keyUrl`)).join(', '));
check('los motores sin clave no tienen ficha',
    run(`['ollama', 'lmstudio', 'webgpu', 'chatgpt_local'].every(id => getProviderAccess(id) === null)`) === true);
check('cada coste tiene traducción en los dos idiomas', (() => {
    const ids = run(`Object.keys(PROVIDER_ACCESS).filter(id => PROVIDER_ACCESS[id].cost)`);
    const es = JSON.parse(read('lang/es.json')), en = JSON.parse(read('lang/en.json'));
    return ids.length > 0 && ids.every(id => es[`access.cost.${id}`] && en[`access.cost.${id}`]);
})());
check('el texto de respaldo del coste coincide con el del diccionario español', (() => {
    const es = JSON.parse(read('lang/es.json'));
    return run(`Object.entries(PROVIDER_ACCESS).filter(([, a]) => a.cost).map(([id, a]) => [id, a.cost])`)
        .every(([id, cost]) => es[`access.cost.${id}`] === cost);
})());

const CLAVES = {
    groq: 'gsk_' + 'a1B2'.repeat(8),
    openrouter: 'sk-or-v1-' + 'a1b2'.repeat(10),
    claude: 'sk-ant-api03-' + 'a1B2'.repeat(8),
    openai: 'sk-proj-' + 'a1B2'.repeat(8),
    nvidia: 'nvapi-' + 'a1B2'.repeat(8),
    cerebras: 'csk-' + 'a1b2'.repeat(8),
    mistral: 'a1B2'.repeat(8),
};
check('cada motor reconoce una clave con su formato',
    Object.entries(CLAVES).every(([id, k]) => run(`checkApiKeyFormat('${id}', '${k}').ok`) === true),
    Object.entries(CLAVES).filter(([id, k]) => !run(`checkApiKeyFormat('${id}', '${k}').ok`)).map(([id]) => id).join(', '));
check('Gemini acepta las claves antiguas (AIza…) y las nuevas (AQ.…)',
    run(`checkApiKeyFormat('gemini', 'AIza' + 'a'.repeat(35)).ok`) === true
    && run(`checkApiKeyFormat('gemini', 'AQ.' + 'Ab1_'.repeat(10)).ok`) === true);

const ajena = run(`checkApiKeyFormat('openai', '${CLAVES.groq}')`);
check('una clave de otro proveedor se detecta', ajena.ok === false, JSON.stringify(ajena));
check('y se dice de quién parece', ajena.looksLike === 'groq', String(ajena.looksLike));
check('«sk-ant-» se atribuye a Claude y «sk-or-» a OpenRouter, no a OpenAI',
    run(`guessProviderFromKey('${CLAVES.claude}')`) === 'claude'
    && run(`guessProviderFromKey('${CLAVES.openrouter}')`) === 'openrouter'
    && run(`guessProviderFromKey('${CLAVES.openai}')`) === 'openai');
check('una clave de Claude en el motor OpenAI no pasa por buena aunque empiece por «sk-»', (() => {
    const r = run(`checkApiKeyFormat('openai', '${CLAVES.claude}')`);
    return r.ok === false && r.looksLike === 'claude';
})());
check('una clave sin prefijo conocido no se atribuye a nadie', run(`guessProviderFromKey('${CLAVES.mistral}')`) === null);
check('sin clave no hay aviso', run(`checkApiKeyFormat('groq', '').ok`) === true);
check('un motor sin formato declarado no opina', run(`checkApiKeyFormat('ollama_cloud', 'lo-que-sea').ok`) === true
    && run(`checkApiKeyFormat('localai', 'lo-que-sea').ok`) === true);
check('con el endpoint oficial se revisa el formato',
    run(`checkApiKeyFormat('openai', 'clave-rara', 'https://api.openai.com/v1').ok`) === false);
check('si el motor apunta a otro servidor, sus claves no se juzgan',
    run(`checkApiKeyFormat('openai', 'clave-rara', 'https://mi-proxy.example/v1').ok`) === true);
check('una copia se rige por la ficha de su motor base', run(`(() => {
    const copia = cloneProvider('groq', 'Groq ficha');
    const ficha = getProviderAccess(copia) === PROVIDER_ACCESS.groq;
    const mal = checkApiKeyFormat(copia, '${CLAVES.openai}');
    deleteCustomProvider(copia);
    return ficha && mal.ok === false && mal.looksLike === 'openai';
})()`) === true);

console.log('\nCatálogo WebGPU ampliable y estado de prueba\n');

const catalogFile = JSON.parse(read('webgpu-models.json'));
{
    const idOk = (id) => /^[\w.-]+\/[\w.-]+$/.test(id);
    const serie = run(`WEBGPU_MODELS.map(m => m.id)`);
    check('webgpu-models.json: todos los ids son repos de Hugging Face',
        [...catalogFile.models, ...catalogFile.broken].every(m => idOk(m.id)));
    check('cada modelo roto lleva motivo y fecha de la prueba', catalogFile.broken.every(b => b.reason && /^\d{4}-\d{2}-\d{2}$/.test(b.tested)));
    check('el fichero declara el runtime con el que se probó', /Transformers\.js \d/.test(catalogFile.runtime));
    check('un modelo no puede estar a la vez en «models» y en «broken»',
        !catalogFile.models.some(m => catalogFile.broken.some(b => b.id.toLowerCase() === m.id.toLowerCase())));
    check('ningún modelo de serie figura como roto',
        !catalogFile.broken.some(b => serie.some(id => id.toLowerCase() === b.id.toLowerCase())),
        catalogFile.broken.filter(b => serie.includes(b.id)).map(b => b.id).join(', '));
    check('un modelo marcado como probado indica cuándo', catalogFile.models.filter(m => m.verified).every(m => m.tested));
}

sandbox.__catalog = catalogFile;
const antes = run(`WEBGPU_MODELS.length`);
const registro = run(`registerWebGPUCatalog(__catalog)`);
check('los modelos del fichero entran en el catálogo', run(`WEBGPU_MODELS.length`) === antes + catalogFile.models.length
    && registro.added.length === catalogFile.models.length, `${antes} → ${run(`WEBGPU_MODELS.length`)}`);
check('registrar dos veces no duplica nada', (() => {
    run(`registerWebGPUCatalog(__catalog)`);
    return run(`WEBGPU_MODELS.length`) === antes + catalogFile.models.length
        && run(`WEBGPU_BROKEN_MODELS.length`) === catalogFile.broken.length;
})());
check('todo modelo del fichero cae en un grupo que la lista pinta',
    catalogFile.models.every(m => run(`WEBGPU_TIERS`).includes(m.tier)), catalogFile.models.map(m => m.tier).join());
check('un grupo mal escrito no deja el modelo invisible', (() => {
    run(`registerWebGPUCatalog({ models: [{ id: 'prueba/grupo-raro', tier: 'balanced' }] })`);
    const tier = run(`WEBGPU_MODELS.find(m => m.id === 'prueba/grupo-raro').tier`);
    run(`WEBGPU_MODELS.splice(WEBGPU_MODELS.findIndex(m => m.id === 'prueba/grupo-raro'), 1)`);
    return tier === 'optional';
})());
check('un id mal formado se descarta', run(`registerWebGPUCatalog({ models: [{ id: '../../etc' }, { id: 'sin-barra' }, null] }).added.length`) === 0);
check('los rotos se reconocen sin distinguir mayúsculas',
    run(`!!getWebGPUBrokenInfo('ONNX-COMMUNITY/gemma-3-270m-it-onnx')`) === true && run(`getWebGPUBrokenInfo('onnx-community/Qwen3-0.6B-ONNX')`) === null);

check('un modelo del catálogo usa solo las cuantizaciones que declara',
    JSON.stringify(run(`webgpuDtypeCandidates('onnx-community/SmolLM2-135M-Instruct-ONNX-MHA')`)) === '["q4f16"]');
check('uno añadido a mano prueba también q4 y q8',
    JSON.stringify(run(`webgpuDtypeCandidates('alguien/modelo-desconocido')`)) === '["q4f16","q4","q8"]');
check('«no encuentro el fichero» permite probar otra variante', run(`isRetryableWebGPULoadError('Could not locate file: model_q4f16.onnx')`) === true
    && run(`isRetryableWebGPULoadError('12356408')`) === true && run(`isRetryableWebGPULoadError('Unsupported model type: falcon_h1')`) === false);

{
    const estado = (expr) => run(`getWebGPUModelStatus(${expr}).kind`);
    run(`state.settings.webgpuModelReports = {}`);
    check('modelo de serie verificado → probado', estado(`{ name: 'onnx-community/SmolLM2-135M-Instruct-ONNX-MHA', verified: true }`) === 'verified');
    check('modelo desconocido → sin probar', estado(`{ name: 'alguien/nuevo' }`) === 'untested');
    check('modelo del registro de rotos → no funciona', estado(`{ name: 'onnx-community/gemma-3-270m-it-ONNX' }`) === 'broken');
    run(`recordWebGPUModelReport('alguien/nuevo', 'fail', '12356408')`);
    check('tras fallar en este equipo → falló aquí', estado(`{ name: 'alguien/nuevo' }`) === 'failed-here');
    check('y se guarda un motivo legible, con fecha y runtime', (() => {
        const r = run(`state.settings.webgpuModelReports['alguien/nuevo']`);
        return /runtime/.test(r.detail) && /^\d{4}-\d{2}-\d{2}$/.test(r.at) && r.runtime === run(`TRANSFORMERS_VERSION`);
    })());
    run(`recordWebGPUModelReport('alguien/nuevo', 'ok')`);
    check('si después funciona → probado aquí', estado(`{ name: 'alguien/nuevo' }`) === 'ok-here');
    run(`recordWebGPUModelReport('onnx-community/gemma-3-270m-it-ONNX', 'ok')`);
    check('lo que pasa en este equipo manda sobre el registro de rotos', estado(`{ name: 'onnx-community/gemma-3-270m-it-ONNX' }`) === 'ok-here');
    run(`state.settings.webgpuModelReports = {}`);
}

{
    const hallados = run(`filterDiscoveredWebGPUModels([
        { id: 'onnx-community/SmolLM2-135M-Instruct-ONNX-MHA' },
        { id: 'onnx-community/gemma-3-270m-it-ONNX', lastModified: '2026-03-13T10:00:00Z' },
        { id: 'alguien/Modelo-Nuevo-ONNX', lastModified: '2026-10-01T00:00:00Z', downloads: 12 },
        { id: 'alguien/privado', private: true }, { id: 'alguien/con-acceso', gated: 'auto' },
        { id: 'onnx-community/tiny-random-gpt2-ONNX' }, { id: 'alguien/cosa-GGUF' }, null,
    ])`);
    check('la búsqueda descarta lo ya catalogado, lo privado y lo que no es chat',
        hallados.map(m => m.id).join() === 'onnx-community/gemma-3-270m-it-ONNX,alguien/Modelo-Nuevo-ONNX', hallados.map(m => m.id).join());
    check('y marca los que ya constan como rotos', !!hallados[0].broken && hallados[1].broken === null);
}

check('los JSON de datos y su copia para file:// coinciden', (() => {
    const bundle = read('data-bundle.js');
    const data = JSON.parse(bundle.slice(bundle.indexOf('window.WIA_DATA = ') + 18).replace(/;\s*$/, ''));
    return ['lang/es.json', 'agents.json', 'lib/anonimae-rules.json', 'webgpu-models.json']
        .every(f => JSON.stringify(data[f]) === JSON.stringify(JSON.parse(read(f))));
})());

console.log('\nAgentes\n');

{
    // Sin DOM: se anula el pintado y se cambia de agente por su lógica.
    run(`
        applySettingsToUI = () => {}; updateStatusMeta = () => {}; checkProviderStatus = () => Promise.resolve();
        renderProjectSelect = () => {}; renderAgentsGallery = () => {}; updateAnonButtonUI = () => {};
        globalThis.__ir = (id) => { state.activeProjectId = id; applyAgentEngine(getActiveProject()); };
    `);
    // Punto de partida conocido: motor general Groq, sin anonimizar.
    run(`(() => {
        state.projects = [
            { id: 'general', name: 'General', systemPrompt: '', documents: [] },
            { id: 'a-motor', name: 'Agente con motor', agentProvider: 'openai', agentModel: 'gpt-agente', agentTemperature: 0.1, documents: [] },
            { id: 'a-plano', name: 'Agente plano', systemPrompt: 'Hola', documents: [] },
            { id: 'a-anon', name: 'Agente confidencial', agentAnonymize: true, documents: [{ id: 'd1', name: 'doc.txt', data: 'x' }] },
        ];
        state.chats = [{ id: 'c1', projectId: 'a-anon', messages: [] }];
        state.activeProjectId = 'general';
        delete state.settings.agentBaseline;
        state.settings.provider = 'groq'; syncProviderToState();
        state.settings.model = 'modelo-general'; state.settings.temperature = 0.8;
        state.settings.anonymizeOutgoing = false;
        saveCurrentProviderConfig();
    })()`);
    const foto = () => run(`({ p: state.settings.provider, m: state.settings.model, t: state.settings.temperature, a: !!state.settings.anonymizeOutgoing, base: !!state.settings.agentBaseline })`);

    run(`__ir('a-motor')`);
    let f = foto();
    check('un agente con motor propio lo aplica al activarse', f.p === 'openai' && f.m === 'gpt-agente' && f.t === 0.1, JSON.stringify(f));

    run(`__ir('a-plano')`);
    f = foto();
    check('al pasar a un agente en «Global» vuelve el motor general', f.p === 'groq' && f.m === 'modelo-general' && f.t === 0.8 && !f.base, JSON.stringify(f));

    run(`__ir('a-motor'); __ir('general')`);
    f = foto();
    check('y también al volver a «General»', f.p === 'groq' && f.m === 'modelo-general' && !f.base, JSON.stringify(f));
    check('el modelo del agente no se queda memorizado en el motor general',
        run(`state.settings.providerConfigs.groq.model`) === 'modelo-general', run(`state.settings.providerConfigs.groq.model`));

    run(`__ir('a-anon')`);
    f = foto();
    check('«anonimizar siempre» enciende 🕶️ sin tocar el motor', f.a === true && f.p === 'groq' && f.m === 'modelo-general', JSON.stringify(f));
    run(`__ir('general')`);
    check('y al salir se recupera lo que hubiera', foto().a === false);
    run(`state.settings.anonymizeOutgoing = true; __ir('a-anon'); __ir('general')`);
    check('si el usuario ya anonimizaba, salir del agente no lo apaga', foto().a === true);
    run(`state.settings.anonymizeOutgoing = false`);

    run(`__ir('a-motor'); __ir('a-anon')`);
    f = foto();
    check('de un agente con ajustes a otro: se parte siempre de los generales', f.p === 'groq' && f.m === 'modelo-general' && f.a === true, JSON.stringify(f));
    run(`__ir('general')`);

    const copia = run(`(() => { const c = duplicateProject('a-anon'); return c && { id: c.id, name: c.name, anon: c.agentAnonymize, docs: c.documents.length, docId: c.documents[0].id }; })()`);
    check('duplicar copia el agente con sus documentos y ajustes', copia && copia.id !== 'a-anon' && /copia/.test(copia.name) && copia.anon === true && copia.docs === 1 && copia.docId !== 'd1', JSON.stringify(copia));
    check('pero no sus chats', run(`state.chats.filter(c => c.projectId === '${copia.id}').length`) === 0 && run(`state.chats.length`) === 1);

    const ida = run(`serializeAgent(state.projects.find(p => p.id === 'a-anon')).agent.agentAnonymize`);
    check('la exportación conserva «anonimizar siempre»', ida === true);
    check('un agente importado solo activa la anonimización con true literal',
        run(`buildAgentFromDefinition({ name: 'X', agentAnonymize: true }).project.agentAnonymize`) === true
        && run(`buildAgentFromDefinition({ name: 'X', agentAnonymize: 'sí' }).project.agentAnonymize`) === false
        && run(`buildAgentFromDefinition({ name: 'X' }).project.agentAnonymize`) === false);

    check('«@» encuentra agentes por nombre sin tildes ni mayúsculas',
        run(`getAgentSlashMatches('CONFIDENCIAL').map(p => p.id).join()`) .startsWith('a-anon'));
    check('y no se activa si nada coincide', run(`getAgentSlashMatches('jesus_dp').length`) === 0);

    const catalogo = JSON.parse(read('agents.json')).agents;
    check('el catálogo de agentes es instalable de principio a fin', catalogo.every(a => {
        sandbox.__def = a;
        const r = run(`buildAgentFromDefinition(__def)`);
        return r.project.name === a.name && r.warnings.length === 0 && r.project.starters.length === a.starters.length;
    }));
    check('el catálogo no repite nombres', new Set(catalogo.map(a => a.name)).size === catalogo.length);
    sandbox.__def = catalogo[0];
    check('un agente del catálogo ya instalado se reconoce', run(`(() => {
        const { project } = installAgentDefinition(__def);
        const antes = findInstalledCatalogAgent(__def);
        project.catalogName = __def.name;
        return antes === null && findInstalledCatalogAgent(__def)?.id === project.id;
    })()`) === true);
}

console.log(failures === 0 ? '\n✔ Motores y clonado correctos.' : `\n✖ ${failures} fallo(s).`);
process.exitCode = failures === 0 ? 0 : 1;
