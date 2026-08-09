/* ============================================
   wIA — 01-core.js
   Interceptor CORS, utilidades, saneado HTML, registro de proveedores y catálogo WebGPU
   (Scripts clásicos cargados en orden desde index.html;
   comparten el ámbito global igual que el antiguo app.js)
   ============================================ */

/* ============================================
   wIA — Application Logic
   Multi-Engine AI Chat Interface (Dynamic Versioning Enabled)
   ============================================ */

// ─── Global CORS Proxy Interceptor ───────────
(function() {
    const originalFetch = window.fetch;

    // El proxy /cors-proxy solo existe cuando la app se sirve con server.js.
    // En hosting estático (Netlify, GitHub Pages, Apache...) no está: se detecta
    // una única vez con un health-check y, si falta, las peticiones van directas
    // (los proveedores cloud principales soportan CORS desde navegador).
    let proxyProbe = null;
    function corsProxyAvailable() {
        if (!proxyProbe) {
            if (window.location.protocol === 'file:') {
                proxyProbe = Promise.resolve(false);
            } else {
                proxyProbe = originalFetch.call(window, '/cors-proxy?health=1', { method: 'GET' })
                    .then(res => res.status === 204)
                    .catch(() => false);
            }
        }
        return proxyProbe;
    }

    window.fetch = async function(input, init) {
        let url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : (input && input.url));

        if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
            try {
                const urlObj = new URL(url);
                const isSameOrigin = urlObj.host === window.location.host;
                const isWikipedia = urlObj.hostname.endsWith('wikipedia.org');

                let shouldProxy = !isSameOrigin && !isWikipedia;

                if (shouldProxy) {
                    // Hugging Face (y sus CDNs) sirven cabeceras CORS correctas en todos
                    // sus endpoints, así que no necesitan proxy. Además, HF responde a
                    // /resolve/<file> con un 307 y una Location RELATIVA
                    // (/api/resolve-cache/...): si esa respuesta pasa por /cors-proxy,
                    // el navegador resuelve la redirección contra este origen y la
                    // carga de modelos WebGPU falla con "Could not locate file".
                    const isHuggingFace = urlObj.hostname.endsWith('huggingface.co') ||
                                          urlObj.hostname.endsWith('hf.co') ||
                                          urlObj.hostname.endsWith('amazonaws.com') ||
                                          urlObj.hostname.includes('cdn-lfs') ||
                                          urlObj.hostname.endsWith('jsdelivr.net');
                    if (isHuggingFace) {
                        shouldProxy = false;
                    }
                }

                if (shouldProxy && await corsProxyAvailable()) {
                    const proxyUrl = `/cors-proxy?url=${encodeURIComponent(url)}`;
                    if (input instanceof Request) {
                        input = new Request(proxyUrl, input);
                    } else {
                        input = proxyUrl;
                    }
                }
            } catch (e) {
                console.error('Error in fetch proxy wrapper:', e);
            }
        }
        return originalFetch.call(this, input, init);
    };
})();


// ─── Runtime de inferencia local (Transformers.js) ──
// El runtime se sirve desde el PROPIO ORIGEN (lib/) para que el service worker
// pueda cachearlo: así la inferencia WebGPU funciona sin conexión y no depende
// de un tercero. Si esa copia no está (despliegue parcial, fichero borrado,
// file://…), se cae automáticamente al CDN original. Dos niveles:
//   1) sondeo con HEAD antes de importar → decide módulo y ruta de los .wasm;
//   2) si aun así el import local falla (MIME raro, fichero corrupto), se
//      reintenta contra el CDN.
// El worker (webgpu-worker.js) corre en su propio ámbito y replica esta lógica:
// manténlas sincronizadas al subir de versión.
const TRANSFORMERS_VERSION = '3.8.1';
const TRANSFORMERS_CDN_BASE = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}/dist/`;
const TRANSFORMERS_CDN_URL = `${TRANSFORMERS_CDN_BASE}transformers.min.js`;
// Rutas absolutas a partir de la base del documento: así funciona igual servido
// en la raíz o bajo un subpath del portal. Se resuelven bajo demanda —no al
// cargar el script— para no depender del DOM en el arranque ni en los tests.
function _localAssetUrl(path) {
    const base = (typeof document !== 'undefined' && document.baseURI)
        || (typeof location !== 'undefined' && location.href)
        || 'http://localhost/';
    return new URL(path, base).href;
}
// Ficheros que onnxruntime carga para el backend WebGPU (JSEP): el binario
// grande (~21 MB) y el módulo que lo arranca.
const ORT_WASM_FILE = 'ort-wasm-simd-threaded.jsep.wasm';
const ORT_MJS_FILE = 'ort-wasm-simd-threaded.jsep.mjs';

// Compatibilidad: el resto del código usaba esta constante para el import.
const TRANSFORMERS_MODULE_URL = TRANSFORMERS_CDN_URL;

/**
 * _urlIsAvailable — ¿responde el fichero y, si se le exige, con el tipo
 * correcto? Lo segundo importa: un servidor que no conozca .mjs lo sirve como
 * application/octet-stream y, con `nosniff`, el navegador se niega a ejecutarlo
 * como módulo. Ese caso debe contar como «no disponible» para que actúe el
 * respaldo, en vez de dejar WebGPU sin backend.
 */
async function _urlIsAvailable(url, expectJsMime = false) {
    try {
        const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
        if (!res.ok) return false;
        if (expectJsMime) {
            const type = (res.headers.get('content-type') || '').toLowerCase();
            if (!/javascript|ecmascript/.test(type)) return false;
        }
        return true;
    } catch (e) {
        return false;
    }
}

// Decide (una sola vez) de dónde salen el módulo y los .wasm.
let _transformersSources = null;
async function resolveTransformersSources() {
    if (_transformersSources) return _transformersSources;
    const localModule = _localAssetUrl('lib/transformers.min.js');
    const ortDir = _localAssetUrl('lib/ort/');
    // El backend WebGPU necesita el binario Y su módulo .mjs bien servido: si
    // cualquiera de los dos falla, los .wasm van al CDN en bloque.
    const [moduleOk, wasmOk, mjsOk] = await Promise.all([
        _urlIsAvailable(localModule, true),
        _urlIsAvailable(ortDir + ORT_WASM_FILE),
        _urlIsAvailable(ortDir + ORT_MJS_FILE, true),
    ]);
    const ortOk = wasmOk && mjsOk;
    _transformersSources = {
        moduleUrl: moduleOk ? localModule : TRANSFORMERS_CDN_URL,
        // wasmPaths se fija SIEMPRE de forma explícita: si el módulo viene de
        // local y no se fijara, onnxruntime buscaría los .wasm junto a él y
        // fallaría al no encontrarlos.
        wasmPaths: ortOk ? ortDir : TRANSFORMERS_CDN_BASE,
        origin: moduleOk && ortOk ? 'local' : (moduleOk || ortOk ? 'mixto' : 'cdn'),
    };
    return _transformersSources;
}

/**
 * importTransformers — carga el runtime con respaldo. Devuelve el módulo y deja
 * en _transformersSources la procedencia efectiva (la consulta el monitor y
 * configureOnnxRuntime para fijar wasmPaths).
 */
async function importTransformers() {
    const src = await resolveTransformersSources();
    try {
        return await import(src.moduleUrl);
    } catch (e) {
        if (src.moduleUrl === TRANSFORMERS_CDN_URL) throw e;
        console.warn('[WebGPU] el runtime auto-alojado falló; se recurre al CDN:', e);
        const mod = await import(TRANSFORMERS_CDN_URL);
        // Si el módulo local no sirve, sus .wasm tampoco son de fiar.
        _transformersSources = { moduleUrl: TRANSFORMERS_CDN_URL, wasmPaths: TRANSFORMERS_CDN_BASE, origin: 'cdn' };
        return mod;
    }
}


// ─── Performance Utilities ──────────────────

/**
 * debounce — delays fn execution until `ms` ms after the last call.
 * Used for search input and localStorage saves.
 */
function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ─── Estimación de tokens ───────────────────
// Aproximación por caracteres: ~3,5 por token, que es lo razonable para una
// mezcla de español e inglés con los tokenizadores BPE habituales. No sustituye
// a un tokenizador real, pero para decidir qué recortar del historial basta y
// no obliga a cargar uno por proveedor.
const CHARS_PER_TOKEN = 3.5;
// Colchón para lo que la estimación no ve: plantilla de chat, nombres de rol,
// tokens especiales y el desvío del propio cálculo.
const CONTEXT_SAFETY_MARGIN_TOKENS = 512;

function estimateTokenCount(text) {
    if (!text) return 0;
    if (typeof text !== 'string') {
        try { text = JSON.stringify(text); } catch (_) { return 0; }
    }
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * escapeHtml — escapa texto para insertarlo en HTML.
 *
 * Cubre también comillas simples y dobles porque el resultado se interpola
 * tanto en nodos de texto como DENTRO de atributos (`title="…"`,
 * `data-model="…"`). La versión anterior usaba textContent→innerHTML, que no
 * escapa comillas: un identificador de modelo con `"` (los añade el propio
 * usuario al pegar un repo de Hugging Face) rompía el atributo y con él la
 * tarjeta entera. En nodos de texto las entidades se decodifican igual, así
 * que escapar de más no cambia lo que ve el usuario.
 */
const _HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text).replace(/[&<>"']/g, (ch) => _HTML_ESCAPES[ch]);
}

const MARKDOWN_ALLOWED_TAGS = new Set([
    'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'hr', 'li', 'ol', 'p', 'pre', 'span', 'strong', 'table', 'tbody', 'td', 'th',
    'thead', 'tr', 'ul'
]);
const MARKDOWN_DROP_CONTENT_TAGS = new Set([
    'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea',
    'select', 'option', 'link', 'meta', 'base'
]);

function sanitizeRenderedHtml(html) {
    if (!html) return '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    [...doc.body.querySelectorAll('*')].forEach((node) => {
        const tag = node.tagName.toLowerCase();

        if (MARKDOWN_DROP_CONTENT_TAGS.has(tag)) {
            node.remove();
            return;
        }

        if (!MARKDOWN_ALLOWED_TAGS.has(tag)) {
            node.replaceWith(document.createTextNode(node.textContent || ''));
            return;
        }

        [...node.attributes].forEach((attr) => {
            const name = attr.name.toLowerCase();

            if (name.startsWith('on') || name === 'style' || name === 'srcdoc') {
                node.removeAttribute(attr.name);
                return;
            }

            if (tag === 'a' && name === 'href') {
                const href = (attr.value || '').trim();
                if (!/^(https?:|mailto:|tel:|#)/i.test(href)) {
                    node.removeAttribute('href');
                } else {
                    node.setAttribute('target', '_blank');
                    node.setAttribute('rel', 'noopener noreferrer');
                }
                return;
            }

            if (name === 'class') return;
            if (tag === 'a' && (name === 'target' || name === 'rel' || name === 'title')) return;

            node.removeAttribute(attr.name);
        });
    });

    return doc.body.innerHTML;
}

// ─── Provider Registry ──────────────────────
const PROVIDERS = {
    ollama:        { name: 'Ollama (Local)',     type: 'ollama',     auth: 'none',             defaultUrl: 'http://localhost:11434',                                  defaultModel: 'gemma4:e4b',                icon: '🟢' },
    ollama_remote: { name: 'Ollama (Remoto)',    type: 'ollama',     auth: 'optional_bearer',  defaultUrl: '',                                                        defaultModel: 'gemma4:e4b',                icon: '🌐' },
    ollama_cloud:  { name: 'Ollama Cloud',      type: 'ollama',     auth: 'apikey',           defaultUrl: 'https://ollama.com',                            defaultModel: 'qwen3-vl:235b-instruct',    icon: '☁️' },
    lmstudio:      { name: 'LM Studio',          type: 'openai',     auth: 'none',             defaultUrl: 'http://localhost:1234/v1',                                 defaultModel: '',                          icon: '💻' },
    // LocalAI expone una API compatible con OpenAI (por defecto en :8080/v1) y
    // la clave es opcional: solo la exige si se arranca con API_KEY definida.
    localai:       { name: 'LocalAI',            type: 'openai',     auth: 'optional_bearer',  defaultUrl: 'http://localhost:8080/v1',                                 defaultModel: '',                          icon: '🧩' },
    groq:          { name: 'Groq',               type: 'openai',     auth: 'apikey',           defaultUrl: 'https://api.groq.com/openai/v1',                          defaultModel: 'llama-3.3-70b-versatile',   icon: '⚡' },
    openrouter:    { name: 'OpenRouter',          type: 'openai',     auth: 'apikey',           defaultUrl: 'https://openrouter.ai/api/v1',                            defaultModel: 'google/gemma-3-27b-it',     icon: '🔀' },
    gemini:        { name: 'Google Gemini',       type: 'gemini',     auth: 'apikey',           defaultUrl: 'https://generativelanguage.googleapis.com/v1beta',        defaultModel: 'gemini-2.5-flash',          icon: '✨' },
    // El modelo por defecto debe coincidir con state.settings.providerConfigs.claude
    // (02-state.js): si divergen, gana el de providerConfigs y el de aquí solo se
    // usa como respaldo, con lo que la app arranca con un modelo distinto al anunciado.
    claude:        { name: 'Claude (Anthropic)',  type: 'anthropic',  auth: 'apikey',           defaultUrl: 'https://api.anthropic.com/v1',                            defaultModel: 'claude-sonnet-5',           icon: '🟣' },
    openai:        { name: 'OpenAI',              type: 'openai',     auth: 'apikey',           defaultUrl: 'https://api.openai.com/v1',                               defaultModel: 'gpt-4.1',                   icon: '🤖' },
    nvidia:        { name: 'Nvidia Integrate',    type: 'openai',     auth: 'apikey',           defaultUrl: 'https://integrate.api.nvidia.com/v1',                     defaultModel: 'meta/llama-3.3-70b-instruct', icon: '🟢' },
    webgpu:        { name: 'WebGPU (Browser)',    type: 'webgpu',     auth: 'none',             defaultUrl: '',                                                        defaultModel: 'onnx-community/Llama-3.2-1B-Instruct-ONNX', icon: '🧠' },
};

// Atajo de traducción con respaldo, compartido por todos los módulos:
// 09-i18n.js se carga DESPUÉS que este, así que `t` puede no existir cuando se
// define algo aquí; se comprueba en cada llamada, no al cargar.
function tr(key, fallback = '') {
    return typeof t === 'function' ? t(key, fallback) : fallback;
}

// ─── Inicio de sesión OAuth de proveedores ──
/**
 * De los motores comerciales del catálogo, solo se soporta OAuth donde el
 * proveedor publica un flujo utilizable desde una app estática, sin servidor
 * propio y sin registrar un cliente por despliegue. Hoy eso es OpenRouter.
 *
 * Los demás quedan fuera por motivos concretos, no por falta de ganas:
 *  · OpenAI, Anthropic, Groq y Nvidia no exponen OAuth para su API de
 *    inferencia a terceros: la autenticación es por API key. (El OAuth de
 *    Anthropic y OpenAI cubre sus propios clientes y sus API de administración,
 *    no el acceso de una web ajena a /v1/messages o /v1/chat/completions.)
 *  · Google Gemini sí admite OAuth 2.0, pero exige registrar un client_id en
 *    Google Cloud y declarar el origen de redirección: no se puede embeber en
 *    una app que cada cual despliega en su propio dominio. Encaja como ajuste
 *    avanzado con client_id propio, no como botón inmediato.
 *
 * Añadir un proveedor aquí solo requiere describir su flujo; el resto del
 * código lo consume por el motor base, así que sus clones lo heredan.
 */
const PROVIDER_OAUTH = {
    openrouter: {
        label: 'OpenRouter',
        // PKCE sin registro previo de cliente: se manda al usuario a /auth con
        // el reto y se canjea el código por una clave propia de su cuenta.
        authUrl: 'https://openrouter.ai/auth',
        exchangeUrl: 'https://openrouter.ai/api/v1/auth/keys',
        docsUrl: 'https://openrouter.ai/docs/use-cases/oauth-pkce',
    },
};

function getProviderOAuth(providerId) {
    return PROVIDER_OAUTH[getProviderBaseId(providerId)] || null;
}

function supportsProviderOAuth(providerId) {
    return !!getProviderOAuth(providerId);
}

// Verificador PKCE: 64 caracteres del alfabeto permitido (unreserved), sacados
// de crypto.getRandomValues y no de Math.random, que es predecible.
function createPkceVerifier() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const bytes = new Uint8Array(64);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

// S256: SHA-256 del verificador en base64url (sin relleno). Si el navegador no
// expone crypto.subtle —contexto no seguro—, se devuelve null y quien llame
// decide; nunca se degrada a `plain` en silencio, que anularía la protección.
async function createPkceChallenge(verifier) {
    if (!crypto?.subtle) return null;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    let binary = '';
    for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ─── Nombres personalizados de los motores ──
// Los rótulos de fábrica se congelan aquí, ANTES de que nada los toque: aplicar
// un nombre personalizado sobrescribe `def.name`, así que sin esta copia no
// habría forma de volver al original.
const PROVIDER_DEFAULT_NAMES = Object.fromEntries(
    Object.entries(PROVIDERS).map(([id, def]) => [id, def.name])
);

function getDefaultProviderName(providerId) {
    return PROVIDER_DEFAULT_NAMES[providerId] || '';
}

// Vuelca los nombres elegidos por el usuario sobre PROVIDERS. Idempotente: el
// motor sin nombre propio vuelve al de fábrica, así que la misma función sirve
// para renombrar y para deshacer. Las copias quedan fuera: su nombre lo llevan
// en customProviders, que es donde nacen.
function applyProviderNames(names) {
    for (const [id, def] of Object.entries(PROVIDERS)) {
        if (def.custom) continue;
        const custom = names && typeof names[id] === 'string' ? names[id].trim() : '';
        def.name = custom || PROVIDER_DEFAULT_NAMES[id] || def.name;
    }
}

// ─── Motores clonados por el usuario ────────
// Un clon es una entrada más de PROVIDERS (mismo `type` y `auth` que su base,
// nombre y configuración propios), para poder tener varios Ollama, varios
// LocalAI, etc., cada uno con su URL, credencial y modelo memorizados.
//
// Se REGISTRAN MUTANDO PROVIDERS en vez de mantener un registro paralelo: así
// todo el código existente (`PROVIDERS[id]`, `Object.entries(PROVIDERS)`,
// `getProviderDef`) los ve sin cambios. Los definidos por el usuario llevan
// `custom: true` y `baseProvider`, que es lo que distingue un clon de un motor
// de serie y lo que permite deshacer el registro al recargar.

// Los motores sin endpoint propio (WebGPU corre dentro de esta pestaña) no
// tienen nada que clonar: dos entradas apuntarían al mismo runtime.
function isCloneableProvider(providerId) {
    const def = PROVIDERS[providerId];
    return !!def && def.type !== 'webgpu';
}

// Id del motor de serie del que deriva `providerId` (él mismo si no es un clon).
// Necesario en todo sitio que decida por id —cabeceras de OpenRouter, ayuda de
// diagnóstico, topes de tokens— y que de otro modo ignoraría a los clones.
function getProviderBaseId(providerId) {
    return PROVIDERS[providerId]?.baseProvider || providerId;
}

function isCustomProvider(providerId) {
    return !!PROVIDERS[providerId]?.custom;
}

// Id estable y legible a partir del nombre elegido: `ollama~oficina`. El `~` no
// aparece en ningún id de serie, así que separa base y sufijo sin ambigüedad.
function buildCustomProviderId(baseId, name) {
    const slug = String(name || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        .slice(0, 32) || 'copia';
    let id = `${baseId}~${slug}`;
    let n = 2;
    while (PROVIDERS[id]) id = `${baseId}~${slug}-${n++}`;
    return id;
}

// Vuelca `state.settings.customProviders` sobre PROVIDERS. Idempotente: primero
// retira los clones ya registrados, de modo que sirve igual para el arranque y
// para refrescar tras crear, renombrar o borrar uno.
function registerCustomProviders(list) {
    for (const id of Object.keys(PROVIDERS)) {
        if (PROVIDERS[id].custom) delete PROVIDERS[id];
    }
    const defs = Array.isArray(list) ? list : [];
    const registered = [];
    for (const def of defs) {
        const baseId = def?.baseProvider;
        const base = PROVIDERS[baseId];
        // Un clon huérfano (base retirada del catálogo) se descarta: heredar de
        // la nada dejaría un motor sin `type` que rompería el envío al primer uso.
        if (!def?.id || !base || PROVIDERS[def.id] || !isCloneableProvider(baseId)) continue;
        PROVIDERS[def.id] = {
            name: def.name || `${base.name} (copia)`,
            // type/auth/defaults se heredan en cada arranque en lugar de
            // copiarse al crear el clon: si un motor de serie cambia de dialecto
            // o de URL por defecto, sus clones lo recogen sin migración.
            type: base.type,
            auth: base.auth,
            defaultUrl: base.defaultUrl,
            defaultModel: base.defaultModel,
            icon: def.icon || base.icon,
            custom: true,
            baseProvider: baseId,
        };
        registered.push(def);
    }
    return registered;
}

// ─── Salvaguarda WebGPU en móvil ─────────────
// En teléfonos la RAM/VRAM y (sobre todo en iOS) el límite de memoria por
// pestaña son estrictos: los modelos grandes pueden agotar la memoria y cerrar
// la pestaña. Detectamos móvil y recomendamos/forzamos un modelo ligero.
function isMobileDevice() {
    try {
        const ua = navigator.userAgent || '';
        const uaMobile = /Android|iPhone|iPod|Windows Phone|BlackBerry|Opera Mini|Mobile/i.test(ua);
        // iPadOS moderno se identifica como Mac; se detecta por pantalla táctil.
        const iPadOS = navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
        const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        const smallScreen = Math.min(window.screen?.width || 9999, window.screen?.height || 9999) <= 820;
        return uaMobile || iPadOS || (coarse && smallScreen);
    } catch (e) { return false; }
}

// Umbral (MB) por encima del cual un modelo WebGPU se considera arriesgado en
// móvil, y el modelo ligero recomendado como alternativa segura.
const MOBILE_WEBGPU_MAX_MB = 500;
const MOBILE_SAFE_WEBGPU_MODEL = 'onnx-community/Qwen2.5-0.5B-Instruct';

function isHeavyForMobile(modelId) {
    const def = (typeof WEBGPU_MODELS !== 'undefined' ? WEBGPU_MODELS : []).find(m => m.id === modelId);
    return !!def && Number(def.sizeBytes) > MOBILE_WEBGPU_MAX_MB;
}

// ─── Model Function Metadata ────────────────
const MODEL_FUNCTION_DEFS = {
    omnimodal:    { label: '◉ Omnimodal', shortLabel: 'Omnimodal', cls: 'tag-omnimodal' },
    medical:      { label: '⚕ Imagen médica', shortLabel: 'Imagen médica', cls: 'tag-medical' },
    vision:       { label: '👁 Visión', shortLabel: 'Visión', cls: 'tag-vision' },
    thinking:     { label: '🧠 Thinking', shortLabel: 'Thinking', cls: 'tag-thinking' },
    coding:       { label: '💻 Código', shortLabel: 'Código', cls: 'tag-coding' },
    tools:        { label: '🧰 Tools', shortLabel: 'Tools', cls: 'tag-tools' },
    multilingual: { label: '🌍 Multiidioma', shortLabel: 'Multiidioma', cls: 'tag-multilingual' },
    fast:         { label: '⚡ Ligero', shortLabel: 'Ligero', cls: 'tag-fast' },
    large:        { label: '💎 Grande', shortLabel: 'Grande', cls: 'tag-large' },
    free:         { label: '🆓 Gratis', shortLabel: 'Gratis', cls: 'tag-free' },
    uncensored:   { label: '🔓 Sin censura', shortLabel: 'Sin censura', cls: 'tag-uncensored' },
    experimental: { label: '🧪 Experimental', shortLabel: 'Experimental', cls: 'tag-experimental' },
};

const MODEL_FILTER_ORDER = ['omnimodal', 'medical', 'vision', 'thinking', 'coding', 'tools', 'multilingual', 'fast', 'large', 'free', 'uncensored', 'experimental'];

// Marcas habituales de modelos sin alineamiento/censura en HF, Ollama y
// OpenRouter. Se detectan por el nombre del repo/modelo.
const UNCENSORED_NAME_HINTS = [
    'uncensored', 'abliterated', 'ablated', 'unfiltered', 'unaligned',
    'dolphin', 'nsfw', 'lewd', 'toxic-dpo', 'unlocked', 'decensored',
];

// ─── WebGPU Curated Model Catalog ───────────
// Catálogo curado de modelos que corren en el navegador. El campo `verified`
// indica que se cargó e infirió realmente en WebGPU (probado el 2026-07-14,
// Transformers.js 3.8.1). Los que fallaban se retiraron — ver nota al final.
const WEBGPU_MODELS = [
    // ── Ligeros y rápidos (verificados) ──────────────────────
    {
        id: 'onnx-community/SmolLM2-135M-Instruct-ONNX-MHA',
        label: 'SmolLM2 135M',
        size: '~140 MB',
        sizeBytes: 140,
        tier: 'quick',
        dtype: 'q4f16',
        context: 8192,
        capabilities: ['fast'],
        verified: true,
        desc: 'El modelo más liviano del catálogo. Ideal para arrancar y probar WebGPU en segundos.',
        repoUrl: 'https://huggingface.co/onnx-community/SmolLM2-135M-Instruct-ONNX-MHA'
    },
    {
        id: 'HuggingFaceTB/SmolLM2-360M-Instruct',
        label: 'SmolLM2 360M',
        size: '~250 MB',
        sizeBytes: 250,
        tier: 'quick',
        dtype: 'q4f16',
        context: 8192,
        capabilities: ['fast'],
        verified: true,
        desc: 'Muy ligero y rápido para respuestas cortas y validación del flujo local.',
        repoUrl: 'https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct'
    },
    {
        id: 'onnx-community/Qwen2.5-0.5B-Instruct',
        label: 'Qwen 2.5 0.5B',
        size: '~400 MB',
        sizeBytes: 400,
        tier: 'quick',
        dtype: 'q4f16',
        context: 32768,
        capabilities: ['fast', 'multilingual'],
        verified: true,
        desc: 'Muy ligero (~400 MB) y multilingüe, con contexto amplio (32K). Buena opción si buscas la carga más rápida.',
        repoUrl: 'https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct'
    },
    {
        id: 'onnx-community/granite-4.0-350m-ONNX-web',
        label: 'Granite 4.0 350M',
        size: '~450 MB',
        sizeBytes: 450,
        tier: 'quick',
        dtype: 'q4f16',
        context: 32768,
        capabilities: ['fast', 'multilingual'],
        verified: true,
        desc: 'Modelo compacto de IBM Granite, variante optimizada para navegador (-web).',
        repoUrl: 'https://huggingface.co/onnx-community/granite-4.0-350m-ONNX-web'
    },
    {
        id: 'onnx-community/Qwen2.5-Coder-0.5B-ONNX',
        label: 'Qwen 2.5 Coder 0.5B',
        size: '~550 MB',
        sizeBytes: 550,
        tier: 'quick',
        dtype: 'q4f16',
        context: 32768,
        capabilities: ['fast', 'coding', 'multilingual'],
        verified: true,
        desc: 'Versión muy ligera enfocada a código y autocompletado local.',
        repoUrl: 'https://huggingface.co/onnx-community/Qwen2.5-Coder-0.5B-ONNX'
    },
    {
        id: 'onnx-community/Qwen3-0.6B-ONNX',
        label: 'Qwen 3 0.6B',
        size: '~600 MB',
        sizeBytes: 600,
        tier: 'quick',
        dtype: 'q4f16',
        context: 32768,
        capabilities: ['fast', 'thinking', 'multilingual'],
        verified: true,
        desc: 'Última generación Qwen 3 en formato mínimo. Buen razonamiento para su tamaño.',
        repoUrl: 'https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX'
    },
    // Sin censura (abliterated): requieren dtype q4 — con q4f16 el runtime
    // falla al crear la sesión ("Type (tensor(float16))").
    {
        id: 'onnx-community/Qwen2.5-0.5B-Instruct-abliterated-v3-ONNX',
        label: 'Qwen 2.5 0.5B Abliterated v3',
        size: '~500 MB',
        sizeBytes: 500,
        tier: 'uncensored',
        dtype: 'q4',
        context: 32768,
        capabilities: ['fast', 'multilingual', 'uncensored'],
        verified: true,
        desc: 'Qwen 2.5 sin alineamiento (abliterated v3): responde sin los rechazos habituales. Úsalo con criterio.',
        repoUrl: 'https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct-abliterated-v3-ONNX'
    },
    {
        id: 'onnx-community/Qwen2.5-0.5B-Instruct-abliterated-ONNX',
        label: 'Qwen 2.5 0.5B Abliterated',
        size: '~500 MB',
        sizeBytes: 500,
        tier: 'uncensored',
        dtype: 'q4',
        context: 32768,
        capabilities: ['fast', 'multilingual', 'uncensored'],
        desc: 'Primera versión abliterated de Qwen 2.5 0.5B, sin filtros de rechazo. Úsalo con criterio.',
        verified: true,
        repoUrl: 'https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct-abliterated-ONNX'
    },
    {
        id: 'onnx-community/Llama-3.2-1B-Instruct-ONNX',
        label: 'Llama 3.2 1B',
        size: '~700 MB',
        sizeBytes: 700,
        tier: 'quick',
        dtype: 'q4f16',
        context: 131072,
        capabilities: ['fast'],
        verified: true,
        recommended: true,
        desc: 'Modelo por defecto recomendado: muy buen comportamiento para instrucciones y contexto amplio (128K). Algo más pesado (~700 MB) pero de mayor calidad.',
        repoUrl: 'https://huggingface.co/onnx-community/Llama-3.2-1B-Instruct-ONNX'
    },
    {
        id: 'HuggingFaceTB/SmolLM2-1.7B-Instruct',
        label: 'SmolLM2 1.7B',
        size: '~1.0 GB',
        sizeBytes: 1000,
        tier: 'quick',
        dtype: 'q4f16',
        context: 8192,
        capabilities: ['fast'],
        verified: true,
        desc: 'Muy equilibrado para chat general en equipos modestos.',
        repoUrl: 'https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct'
    },
    // ── Equilibrados / capaces (verificados) ─────────────────
    {
        id: 'onnx-community/Qwen2.5-Coder-1.5B-Instruct',
        label: 'Qwen 2.5 Coder 1.5B',
        size: '~1.4 GB',
        sizeBytes: 1400,
        tier: 'optional',
        dtype: 'q4f16',
        context: 32768,
        capabilities: ['coding', 'multilingual'],
        verified: true,
        desc: 'Muy buena opción para programación local con coste moderado.',
        repoUrl: 'https://huggingface.co/onnx-community/Qwen2.5-Coder-1.5B-Instruct'
    },
    {
        id: 'onnx-community/DeepSeek-R1-Distill-Qwen-1.5B-ONNX',
        label: 'DeepSeek R1 Qwen 1.5B',
        size: '~1.6 GB',
        sizeBytes: 1600,
        tier: 'optional',
        dtype: 'q4f16',
        context: 32768,
        capabilities: ['thinking', 'multilingual'],
        verified: true,
        desc: 'Modelo de razonamiento (R1) destilado de 1.5B. Escribe su cadena de pensamiento antes de responder.',
        repoUrl: 'https://huggingface.co/onnx-community/DeepSeek-R1-Distill-Qwen-1.5B-ONNX'
    },
    {
        id: 'onnx-community/Qwen2.5-Coder-3B-Instruct',
        label: 'Qwen 2.5 Coder 3B',
        size: '~2.1 GB',
        sizeBytes: 2100,
        tier: 'optional',
        dtype: 'q4f16',
        context: 32768,
        capabilities: ['coding', 'multilingual'],
        verified: true,
        desc: 'El mejor equilibrio del catálogo para código en navegador.',
        repoUrl: 'https://huggingface.co/onnx-community/Qwen2.5-Coder-3B-Instruct'
    },
    {
        id: 'onnx-community/Llama-3.2-3B-Instruct-ONNX',
        label: 'Llama 3.2 3B',
        size: '~2.4 GB',
        sizeBytes: 2400,
        tier: 'optional',
        dtype: 'q4f16',
        context: 131072,
        capabilities: ['thinking'],
        verified: true,
        desc: 'Más consistente en seguimiento de instrucciones y contexto largo.',
        repoUrl: 'https://huggingface.co/onnx-community/Llama-3.2-3B-Instruct-ONNX'
    },
    // ── Grande / exigente (sin verificar: descarga OK pero la
    //    compilación de kernels tardó demasiado en el test) ──
    {
        id: 'webgpu/Phi-4-mini-instruct-ONNX-GQA',
        label: 'Phi-4 Mini',
        size: '~2.2 GB',
        sizeBytes: 2200,
        tier: 'large',
        dtype: 'q4f16',
        fallbackDtypes: ['q4'],
        context: 131072,
        capabilities: ['thinking', 'coding', 'large'],
        verified: false,
        desc: 'Potente para razonamiento y tareas técnicas, pero pesado: la compilación de kernels puede tardar varios minutos la primera vez. Requiere un equipo con GPU holgada.',
        repoUrl: 'https://huggingface.co/webgpu/Phi-4-mini-instruct-ONNX-GQA'
    },
    // ── ◉ Omnimodal: modelos que ven y responden directamente ──
    //    El mismo modelo recibe imagen + texto y genera la respuesta final.
    //    Requieren AutoModelForVision2Seq; el pipeline genérico
    //    image-text-to-text no existe en Transformers.js 3.8.1.
    {
        id: 'HuggingFaceTB/SmolVLM-256M-Instruct',
        label: 'SmolVLM 256M Omnimodal',
        size: '~210 MB',
        sizeBytes: 210,
        tier: 'omnimodal',
        omnimodal: true,
        engine: 'vlm',
        context: 8192,
        capabilities: ['omnimodal', 'vision', 'thinking'],
        verified: true,
        recommended: true,
        desc: 'VLM ultracompacto: recibe imagen y pregunta en el mismo contexto y responde directamente. Recomendado para equipos modestos.',
        repoUrl: 'https://huggingface.co/HuggingFaceTB/SmolVLM-256M-Instruct'
    },
    {
        id: 'HuggingFaceTB/SmolVLM-500M-Instruct',
        label: 'SmolVLM 500M Omnimodal',
        size: '~390 MB',
        sizeBytes: 390,
        tier: 'omnimodal',
        omnimodal: true,
        engine: 'vlm',
        context: 8192,
        capabilities: ['omnimodal', 'vision', 'thinking'],
        verified: false,
        desc: 'Más capaz para comprensión visual y preguntas concretas. Tiene demo WebGPU oficial, pero aún no se ha probado en este equipo.',
        repoUrl: 'https://huggingface.co/HuggingFaceTB/SmolVLM-500M-Instruct'
    },
    // ── ⚕ Imagen médica: modelos compatibles con Transformers.js ──
    // DINOv2 X-Ray es un encoder radiológico (no clasifica patologías). SigLIP
    // aporta clasificación zero-shot orientativa para reconocer modalidad y
    // anatomía, pero no fue entrenado como dispositivo diagnóstico.
    {
        id: 'onnx-community/dinov2-base-xray-224-ONNX',
        label: 'DINOv2 Base X-Ray 224',
        size: '~50 MB',
        sizeBytes: 50,
        tier: 'medical',
        visionAssist: true,
        engine: 'medical-embedding',
        task: 'image-feature-extraction',
        dtype: 'q4f16',
        fallbackDtypes: ['q4'],
        context: 0,
        capabilities: ['medical', 'vision', 'fast'],
        verified: true,
        desc: 'Encoder de Stanford AIMI especializado en radiografías. Extrae una firma visual para comparación o RAG; no genera diagnósticos ni nombres de patologías.',
        repoUrl: 'https://huggingface.co/onnx-community/dinov2-base-xray-224-ONNX'
    },
    {
        id: 'tligent-ia/wound-classifier-onnx',
        label: 'Clasificador de Heridas',
        size: '~83 MB',
        sizeBytes: 83,
        tier: 'medical',
        visionAssist: true,
        engine: 'wound-classify',
        task: 'image-classification',
        dtype: 'q8',
        context: 0,
        capabilities: ['medical', 'vision'],
        verified: true,
        recommended: true,
        desc: 'Reconoce el tipo de herida en una foto: abrasión, hematoma, quemadura, corte, laceración, herida diabética/venosa/quirúrgica, úlcera por presión o piel normal. Orientativo, no sustituye valoración médica.',
        repoUrl: 'https://huggingface.co/tligent-ia/wound-classifier-onnx'
    },
    {
        id: 'Xenova/siglip-base-patch16-224',
        label: 'SigLIP Medical Zero-Shot',
        size: '~153 MB',
        sizeBytes: 153,
        tier: 'medical',
        visionAssist: true,
        engine: 'medical-zero-shot',
        task: 'zero-shot-image-classification',
        dtype: 'q4f16',
        fallbackDtypes: ['q4'],
        context: 0,
        capabilities: ['medical', 'vision'],
        verified: true,
        desc: 'Clasificación visual zero-shot para orientar modalidad y región anatómica. Es un modelo generalista: sus resultados médicos son exploratorios, no diagnósticos.',
        repoUrl: 'https://huggingface.co/Xenova/siglip-base-patch16-224'
    },
    // ── 👁 Visión: asistentes de imagen (verificados) ────────
    //    Estos modelos analizan la imagen adjunta y producen texto que se
    //    inyecta como contexto del modelo de chat (la "cadena visión → chat").
    //    Cada uno declara un `engine` según cómo se ejecuta en Transformers.js:
    //      · 'caption'   → pipeline image-to-text (descripción/OCR simple)
    //      · 'florence2' → Florence-2 multitarea (descripción detallada + OCR)
    //      · 'vlm'       → reservado para un VLM auxiliar que razone sobre la imagen
    //    El pipeline conversacional 'image-text-to-text' no existe en el
    //    runtime, pero los VLM SÍ funcionan cargando su clase de modelo.
    {
        id: 'onnx-community/Florence-2-base-ft',
        label: 'Florence-2 (visión avanzada)',
        size: '~450 MB',
        sizeBytes: 450,
        tier: 'vision',
        visionAssist: true,
        engine: 'florence2',
        context: 0,
        capabilities: ['vision', 'coding'],
        verified: true,
        recommended: true,
        desc: 'Modelo de visión avanzado de Microsoft: descripción detallada de la escena + lectura de texto (OCR) en la misma pasada. El mejor asistente visual del catálogo.',
        repoUrl: 'https://huggingface.co/onnx-community/Florence-2-base-ft'
    },
    {
        id: 'Xenova/vit-gpt2-image-captioning',
        label: 'ViT-GPT2 Captioning',
        size: '~250 MB',
        sizeBytes: 250,
        tier: 'vision',
        visionAssist: true,
        engine: 'caption',
        task: 'image-to-text',
        context: 0,
        capabilities: ['vision', 'fast'],
        verified: true,
        desc: 'Describe en una frase el contenido general de la imagen. Ligero y rápido.',
        repoUrl: 'https://huggingface.co/Xenova/vit-gpt2-image-captioning'
    },
    {
        id: 'onnx-community/distilvit-ONNX',
        label: 'DistilViT Captioning',
        size: '~230 MB',
        sizeBytes: 230,
        tier: 'vision',
        visionAssist: true,
        engine: 'caption',
        task: 'image-to-text',
        context: 0,
        capabilities: ['vision', 'fast'],
        verified: true,
        desc: 'Descripción de imágenes ligera (destilada, de Mozilla). Alternativa rápida al captioner por defecto.',
        repoUrl: 'https://huggingface.co/onnx-community/distilvit-ONNX'
    },
    {
        id: 'Xenova/trocr-small-printed',
        label: 'TrOCR Texto impreso',
        size: '~130 MB',
        sizeBytes: 130,
        tier: 'vision',
        visionAssist: true,
        engine: 'caption',
        task: 'image-to-text',
        context: 0,
        capabilities: ['vision', 'fast'],
        verified: true,
        desc: 'OCR: extrae el texto impreso de una imagen (capturas, documentos, carteles).',
        repoUrl: 'https://huggingface.co/Xenova/trocr-small-printed'
    },
    {
        id: 'Xenova/trocr-small-handwritten',
        label: 'TrOCR Manuscrito',
        size: '~130 MB',
        sizeBytes: 130,
        tier: 'vision',
        visionAssist: true,
        engine: 'caption',
        task: 'image-to-text',
        context: 0,
        capabilities: ['vision', 'fast'],
        verified: true,
        desc: 'OCR especializado en texto escrito a mano (notas, formularios rellenados).',
        repoUrl: 'https://huggingface.co/Xenova/trocr-small-handwritten'
    }
    // Búsqueda ampliada de 2026-07-15 (Transformers.js 3.8.1). Probados y NO añadidos:
    // · Qwen3-0.6B-heretic-abliterated-uncensored-ONNX, gemma-3-270m-ONNX,
    //   distil-qwen3-0.6b-text2sql-ONNX y Carbon-500M-ONNX → cargan con q4
    //   pero su tokenizer no trae chat template (son modelos base, no chat).
    // · Qwen2.5-1.5B-abliterated-ONNX y Qwen3-0.6b-heretic-ONNX → faltan
    //   ficheros en el repo ("Could not locate file").
    // · Apertus v1.1 (0.5B / 1.5B) → "Unsupported model type: apertus", igual
    //   que el 8B: la arquitectura no existe en Transformers.js.
    // · Dolphin3.0-Qwen2.5-1.5B-ONNX y Huihui-Qwen3.5-abliterated → sin ONNX
    //   q4/q4f16 publicado.
    //
    // Probados el 2026-07-14 (Transformers.js 3.8.1) y NO añadidos:
    // · Chat VLM (image-text-to-text): no existe el pipeline ni en 3.8.1 ni en
    //   4.2.0 → Qwen2-VL-2B y Phi-3.5-vision siguen fuera.
    // · CLIP/SigLIP (zero-shot-image-classification) y DETR/YOLOS
    //   (object-detection) cargan bien, pero no producen una descripción
    //   textual para el chat sin etiquetas candidatas o post-proceso.
    // · Xenova/mobileclip_s0 y onnx-community/manga-ocr-base-ONNX → faltan
    //   ficheros en el repo (model.onnx / tokenizer.json).
    //
    // Retirados tras probarlos uno a uno (2026-07-14, Transformers.js 3.8.1):
    // · Qwen2.5-1.5B-Instruct y Qwen2.5-Math-1.5B → "Aborted()" al inicializar.
    // · Qwen2-VL-2B y Phi-3.5-vision → pipeline 'image-text-to-text' no soportado.
    // · Apertus-8B → "Unsupported model type: apertus".
    // · gemma-3 (270m/1b), LFM2 (350M/700M), Qwen3-1.7B → fallo de runtime al cargar.
    // · DeepSeek-R1 7B/8B → repos pasaron a gated (401).
];

// Asistente visual por defecto (si el usuario no elige otro en el catálogo).
const WEBGPU_IMAGE_ASSIST = {
    id: 'Xenova/vit-gpt2-image-captioning',
    task: 'image-to-text',
    label: 'Asistente visual local',
    desc: 'Convierte imágenes en descripciones locales para usarlas como contexto en el chat WebGPU.'
};

/**
 * getVisionAssistDef — modelo de visión activo. El usuario puede elegir
 * cualquiera del tier 'vision' del catálogo; si no ha elegido ninguno (o el
 * guardado ya no existe), se usa el captioner por defecto.
 */
function getVisionAssistDef() {
    const chosenId = state?.settings?.webgpuVisionModel;
    if (chosenId) {
        const def = WEBGPU_MODELS.find(m => m.id === chosenId && m.visionAssist);
        if (def) return { ...def, task: def.task || 'image-to-text', engine: def.engine || 'caption' };
    }
    return { ...WEBGPU_IMAGE_ASSIST, engine: 'caption' };
}

const WEBGPU_TEXT_FALLBACK_MODEL = 'HuggingFaceTB/SmolLM2-1.7B-Instruct';
const WEBGPU_PROGRESS_UI_MIN_INTERVAL_MS = 180;
const WEBGPU_PROGRESS_UI_MIN_DELTA_PCT = 2;
