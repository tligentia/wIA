/**
 * test-boot — carga los módulos en el mismo orden que index.html y comprueba
 * que el ámbito global compartido queda completo.
 *
 * Por qué: wIA son scripts clásicos que se reparten el estado por variables
 * globales, y el ORDEN de carga importa. Si un módulo revienta al evaluarse o
 * alguien renombra algo que otro módulo espera, la app no falla al cargar sino
 * mucho después, con un ReferenceError en mitad de una acción del usuario.
 * Esta prueba adelanta ese fallo al momento del despliegue.
 *
 * Uso: npm run test:boot
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const noopEl = () => ({
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    addEventListener() {}, removeEventListener() {}, appendChild() {}, insertBefore() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    style: {}, dataset: {}, textContent: '', innerHTML: '', value: '', focus() {},
});

const documentStub = {
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => noopEl(),
    addEventListener() {},
    readyState: 'complete',
    documentElement: { setAttribute() {}, lang: 'es' },
    body: { classList: { toggle() {}, add() {}, remove() {} }, appendChild() {} },
    head: { appendChild() {} },
    hidden: false,
};

const sandbox = {
    document: documentStub,
    navigator: {
        userAgent: 'node', languages: ['es'], maxTouchPoints: 0,
        platform: 'Linux', storage: null, clipboard: { writeText: () => Promise.resolve() },
    },
    console: { ...console, warn() {}, error() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => Date.now(), memory: null },
    crypto: { randomUUID: () => 'id', subtle: null, getRandomValues: (a) => a },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    indexedDB: { open: () => ({}) },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    requestIdleCallback: (fn) => setTimeout(fn, 0),
    caches: undefined,
    fetch: () => Promise.reject(new Error('sin red')),
    AbortController: globalThis.AbortController,
    AbortSignal: globalThis.AbortSignal,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    Worker: class { postMessage() {} terminate() {} },
    DOMParser: class { parseFromString() { return { body: { querySelectorAll: () => [], innerHTML: '' } }; } },
    Blob: globalThis.Blob,
    URL: globalThis.URL,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.location = { protocol: 'https:', host: 'wia.test', origin: 'https://wia.test', hostname: 'wia.test' };
sandbox.window.matchMedia = () => ({ matches: false, addEventListener() {} });
createContext(sandbox);

let failures = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failures++;
};

// ── Orden EXACTO de index.html ──
const LOAD_ORDER = [
    'Plantilla/Version.js',
    'secure-gate.js',
    'js/01-core.js', 'js/02-state.js', 'js/03-webgpu.js', 'js/04-providers.js',
    'js/05-workspace.js', 'js/06-chat.js', 'js/07-ui.js', 'js/08-anon.js',
    'js/09-i18n.js', 'js/10-docs.js', 'js/11-rag.js', 'js/12-pwa.js',
];

for (const file of LOAD_ORDER) {
    try {
        runInContext(read(file), sandbox, { filename: file });
        check(`carga ${file}`, true);
    } catch (e) {
        check(`carga ${file}`, false, e.message);
    }
}

// ── Globales que otros módulos dan por hechos ──
const REQUIRED_GLOBALS = [
    // 01-core
    'PROVIDERS', 'WEBGPU_MODELS', 'escapeHtml', 'estimateTokenCount', 'debounce',
    'sanitizeRenderedHtml', 'isMobileDevice', 'getVisionAssistDef',
    // 02-state
    'state', 'dom', 'init', 'saveState', 'getAuthHeaders', 'getProviderDef',
    'syncProviderToState', 'applySettingsToUI', 'idbStore', 'secretVault',
    // 03-webgpu
    'webgpuState', 'webgpuWorker', 'loadWebGPUModel', 'runWebGPUGeneration', 'checkWebGPUSupport',
    // 04-providers
    'checkProviderStatus', 'populateModels', 'fetchModelCapabilities', 'getModelFunctionKeys',
    // 05-workspace
    'handleFiles', 'compressImageFile', 'renderChatList', 'getActiveChat', 'createChat',
    // 06-chat
    'sendMessage', 'renderMessages', 'buildApiMessages', 'buildGeminiMessages',
    'buildAnthropicMessages', 'buildWebGPUConversation', 'getPromptTokenBudget',
    'buildSystemContext', 'applyHistoryBudget', 'stopStreaming',
    'messageSignature', 'invalidateMessageRender', 'hashString',
    // 07-ui
    'bindEvents', 'openSettings', 'autoResizeTextarea', 'updateSendButton',
    // 08-anon
    'anonymizeOutgoingText', 'deanonymizeForDisplay',
    // 09-i18n
    't', 'applyI18n', 'setLanguage', 'getLang',
    // 10-docs
    'renderDocs',
    // 11-rag
    'prepareRagContext', 'ensureProjectIndexed', 'retrieveRelevantChunks',
    'chunkText', 'quantizeVector', 'formatRagContext', 'renderRagIndexStatus',
];

const missing = REQUIRED_GLOBALS.filter((name) => {
    try { return runInContext(`typeof ${name}`, sandbox) === 'undefined'; }
    catch { return true; }
});
check(`${REQUIRED_GLOBALS.length} globales compartidas disponibles`, missing.length === 0,
    missing.length ? `faltan: ${missing.join(', ')}` : '');

// ── El catálogo debe ser coherente consigo mismo ──
const catalogIssues = runInContext(`(() => {
    const issues = [];
    const ids = new Set();
    for (const m of WEBGPU_MODELS) {
        if (ids.has(m.id)) issues.push('id duplicado: ' + m.id);
        ids.add(m.id);
        if (!m.label) issues.push('sin label: ' + m.id);
        if (!m.tier) issues.push('sin tier: ' + m.id);
    }
    // El modelo por defecto de cada proveedor debe existir en su configuración
    for (const [id, def] of Object.entries(PROVIDERS)) {
        const pc = state.settings.providerConfigs[id];
        if (!pc) issues.push('sin providerConfig: ' + id);
        else if (def.defaultModel && pc.model !== def.defaultModel) {
            issues.push('modelo por defecto divergente en ' + id + ': ' + def.defaultModel + ' vs ' + pc.model);
        }
    }
    // El fallback seguro de móvil y el de texto deben existir en el catálogo
    if (!WEBGPU_MODELS.some(m => m.id === MOBILE_SAFE_WEBGPU_MODEL)) issues.push('MOBILE_SAFE_WEBGPU_MODEL no está en el catálogo');
    if (!WEBGPU_MODELS.some(m => m.id === WEBGPU_TEXT_FALLBACK_MODEL)) issues.push('WEBGPU_TEXT_FALLBACK_MODEL no está en el catálogo');
    if (!WEBGPU_MODELS.some(m => m.id === WEBGPU_IMAGE_ASSIST.id)) issues.push('el asistente visual por defecto no está en el catálogo');
    return issues;
})()`, sandbox);
check('catálogo de modelos coherente', catalogIssues.length === 0, catalogIssues.join(' · '));

// ── escapeHtml debe escapar también comillas (atributos) ──
const escaped = runInContext(`escapeHtml('a"b\\'c<d&e')`, sandbox);
check('escapeHtml protege atributos', !escaped.includes('"') && !escaped.includes("'"), escaped);

console.log(failures === 0 ? '\n✔ Arranque correcto.' : `\n✖ ${failures} fallo(s).`);
process.exitCode = failures === 0 ? 0 : 1;
