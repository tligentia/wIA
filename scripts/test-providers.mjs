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

const root = process.cwd();
const read = (p) => readFileSync(resolve(root, p), 'utf8');

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

console.log(failures === 0 ? '\n✔ Motores y clonado correctos.' : `\n✖ ${failures} fallo(s).`);
process.exitCode = failures === 0 ? 0 : 1;
