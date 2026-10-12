/* >>> imports (generado por scripts/gen-modules.mjs: no editar a mano) >>> */
// El primer import es el del módulo anterior: así se evalúan en orden (ver scripts/gen-modules.mjs).
import {
    checkWebGPUSupport, deleteWebGPUModelCache, getCachedWebGPUModels,
    invalidateWebGPUCacheScan, releaseWebGPUMemory, warmUpActiveWebGPUModel, webgpuState,
    webgpuWorker,
} from './03-webgpu.js?v=2610.AR';
import {
    MODEL_FILTER_ORDER, MODEL_FUNCTION_DEFS, PROVIDERS, TRANSFORMERS_VERSION,
    UNCENSORED_NAME_HINTS, WEBGPU_BROKEN_MODELS, WEBGPU_MODELS, createPkceChallenge,
    createPkceVerifier, describeWebGPULoadFailure, escapeHtml, getProviderBaseId,
    getProviderOAuth, getVisionAssistDef, getWebGPUBrokenInfo, notify, tr, trf,
} from './01-core.js?v=2610.AR';
import {
    applySettingsToUI, dom, getActiveProviderConfig, getAuthHeaders, getProviderDef,
    getProviderLocality, isIncognitoMode, renderProviderOptions, saveState, state,
    syncProviderToState, updateInputDisclaimer, updateModelContextIndicator,
    updateSettingsActiveContext, updateStatusMeta,
} from './02-state.js?v=2610.AR';
import {
    renderAttachmentPreview,
} from './05-workspace.js?v=2610.AR';
import {
    supportsWebGPUImageAssist,
} from './06-chat.js?v=2610.AR';
/* <<< imports <<< */

/* ============================================
   wIA — 04-providers.js
   Conexión a proveedores, metadatos de modelos y gestión de modelos Ollama
   (Scripts clásicos cargados en orden desde index.html;
   comparten el ámbito global igual que el antiguo app.js)
   ============================================ */

// ─── Backend Connection ──────────────────────
async function providerHttpError(response) {
    let detail = response.statusText || 'Error del proveedor';
    try {
        const payload = await response.clone().json();
        detail = payload.error?.message || payload.error?.detail || payload.message || detail;
    } catch (_) {
        try {
            const text = await response.text();
            if (text && text.length < 240) detail = text;
        } catch (_) {}
    }
    const error = new Error(`${response.status}: ${detail}`);
    error.status = response.status;
    error.retryAfterMs = parseRetryAfter(response.headers?.get?.('retry-after'));
    return error;
}

// «Retry-After» llega en segundos o como fecha HTTP. 0 = no informado.
function parseRetryAfter(value, now = Date.now()) {
    const raw = String(value ?? '').trim();
    if (!raw) return 0;
    if (/^\d+(\.\d+)?$/.test(raw)) return Math.max(0, Math.round(parseFloat(raw) * 1000));
    const when = Date.parse(raw);
    return Number.isFinite(when) ? Math.max(0, when - now) : 0;
}

function describeConnectionError(error) {
    const raw = String(error?.message || error || 'Error desconocido');
    const normalized = raw.toLowerCase();

    if (normalized.includes('api key requerida')) {
        return { code: 'missing-api-key', message: 'Introduce una API Key para validar', status: 'API Key requerida' };
    }
    if (normalized.includes('url del servidor requerida')) {
        return { code: 'missing-url', message: 'Introduce la URL del servidor', status: 'URL requerida' };
    }
    if (/\b(401|403)\b/.test(normalized) || normalized.includes('unauthorized') || normalized.includes('invalid api key') || normalized.includes('authentication')) {
        return { code: 'auth', message: 'API Key no válida o sin permisos', status: 'Credenciales no válidas' };
    }
    if (/\b404\b/.test(normalized)) {
        return { code: 'not-found', message: 'Endpoint no encontrado; revisa la URL', status: 'URL no válida' };
    }
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || normalized.includes('timed out') || normalized.includes('timeout')) {
        return { code: 'timeout', message: 'Tiempo de espera agotado', status: 'Sin respuesta' };
    }
    if (normalized.includes('failed to fetch') || normalized.includes('cors') || normalized.includes('networkerror')
        || normalized.includes('proxy error') || normalized.includes('econnrefused') || /\b(502|503|504)\b/.test(normalized)) {
        return {
            code: 'network',
            message: 'No se pudo alcanzar el motor. Comprueba el servicio, la URL, la red y los permisos CORS.',
            status: 'Sin acceso al motor'
        };
    }
    return { code: 'provider', message: raw.slice(0, 180), status: 'Desconectado' };
}

// ─── Resiliencia entre motores (failover y pausas) ──────────────
/**
 * Lo que sigue es el núcleo —no el servidor— de lo que hace una pasarela como
 * FreeLLMAPI: clasificar un fallo, poner en pausa el motor que lo causó con una
 * escalera de esperas y escoger otro motor ya configurado. Son funciones sin
 * red ni DOM para poder probarlas con reloj inyectado.
 *
 * Qué NO hace, a propósito:
 *  · Nunca cruza de local a cloud ni al revés: una consulta que iba a un Ollama
 *    de tu equipo no acaba en un tercero porque este se haya caído.
 *  · Nunca salta a WebGPU (descargaría cientos de MB sin avisar).
 *  · No reintenta una vez ha empezado a llegar texto: duplicaría o mezclaría
 *    respuestas. Solo cubre fallos de conexión/cupo ANTES del primer token.
 */
const ENGINE_COOLDOWN_LADDER_MS = [2 * 60e3, 10 * 60e3, 60 * 60e3, 24 * 60 * 60e3];
const ENGINE_COOLDOWN_WINDOW_MS = 24 * 60 * 60e3;   // los fallos solo escalan dentro de 24 h
const ENGINE_COOLDOWN_TRANSIENT_MS = 90e3;           // 5xx, red y timeouts: no escalan
const ENGINE_COOLDOWN_AUTH_MS = 10 * 60e3;           // clave rechazada o modelo inexistente
const ENGINE_COOLDOWN_CREDIT_MS = 60 * 60e3;         // sin saldo: no se arregla en minutos
const ENGINE_COOLDOWN_LOCAL_MS = 5e3;                // motor propio: se recupera enseguida
const ENGINE_COOLDOWN_MAX_MS = 24 * 60 * 60e3;
const ENGINE_COOLDOWN_STORAGE_KEY = 'wia_engine_cooldowns';
const FAILOVER_MAX_HOPS = 2;                         // motores alternativos por mensaje

let _engineCooldowns = null;

/**
 * classifyEngineFailure — qué ha pasado y si merece probar con otro motor.
 *
 * `retryable` = otro motor podría contestar a la MISMA petición. Un 400/413/422
 * no lo es (la petición en sí es mala), y un error desconocido tampoco: ante la
 * duda se muestra el error en vez de reenviar el mensaje a un tercero.
 */
function classifyEngineFailure(error) {
    const raw = String(error?.message || error || '');
    let status = Number(error?.status) || 0;
    if (!status) {
        const m = /^(?:error:\s*)?([45]\d\d)\b/i.exec(raw.trim());
        if (m) status = Number(m[1]);
    }
    const retryAfterMs = Math.max(0, Number(error?.retryAfterMs) || 0);
    const out = (kind, retryable) => ({ kind, retryable, status, retryAfterMs });

    if (status === 429) return out('rate_limit', true);
    if (status === 402) return out('credit', true);
    if (status === 401 || status === 403) return out('auth', true);
    if (status === 404) return out('model', true);
    if (status === 408 || status === 425) return out('timeout', true);
    if (status >= 500) return out('server', true);
    if (status >= 400) return out('client', false);

    const low = raw.toLowerCase();
    if (error?.name === 'TimeoutError' || low.includes('timed out') || low.includes('timeout')) return out('timeout', true);
    if (low.includes('failed to fetch') || low.includes('networkerror') || low.includes('network error')
        || low.includes('econnrefused') || low.includes('proxy error') || low.includes('load failed')) return out('network', true);
    return out('unknown', false);
}

function _engineCooldownStore() {
    if (_engineCooldowns) return _engineCooldowns;
    _engineCooldowns = {};
    try {
        const saved = JSON.parse(localStorage.getItem(ENGINE_COOLDOWN_STORAGE_KEY) || '{}');
        if (saved && typeof saved === 'object') _engineCooldowns = saved;
    } catch (_) { /* sin almacenamiento: solo en memoria */ }
    return _engineCooldowns;
}

function _persistEngineCooldowns() {
    // En incógnito no se deja rastro de qué motores se han usado.
    if (typeof isIncognitoMode === 'function' && isIncognitoMode()) return;
    try { localStorage.setItem(ENGINE_COOLDOWN_STORAGE_KEY, JSON.stringify(_engineCooldownStore())); } catch (_) {}
}

// El 404 «modelo no encontrado» pausa solo ese modelo; el resto, el motor entero.
function _engineCooldownKey(providerId, model, kind) {
    return kind === 'model' ? `${providerId}|${model || ''}` : providerId;
}

function _isLocalEngine(providerId) {
    const cfg = state.settings.providerConfigs?.[providerId] || {};
    return getProviderLocality(providerId, cfg.url || getProviderDef(providerId)?.defaultUrl || '').mode === 'local';
}

/**
 * markEngineFailure — anota el fallo y devuelve hasta cuándo queda en pausa.
 *
 *  · 429/402 sin «Retry-After»: escalera 2 min → 10 min → 1 h → 24 h dentro de
 *    una ventana móvil de 24 h.
 *  · Con «Retry-After»: se obedece (es un dato, no una suposición) y no escala.
 *  · 5xx / red / timeout: 90 s fijos, no escalan.
 *  · Motor local (localhost, red privada): 5 s, sin escalar.
 */
function markEngineFailure(providerId, model, failure, now = Date.now()) {
    // Una petición mala (400/413/422) o un error que no se entiende no dice nada
    // de la salud del motor: pausarlo castigaría al motor por culpa del mensaje.
    if (!providerId || !failure || !failure.retryable) return { key: '', until: now, ms: 0 };
    const store = _engineCooldownStore();
    const key = _engineCooldownKey(providerId, model, failure.kind);
    const entry = store[key] || { hits: [], until: 0, kind: '' };
    entry.hits = (entry.hits || []).filter(t => now - t < ENGINE_COOLDOWN_WINDOW_MS);

    let ms;
    if (_isLocalEngine(providerId)) {
        ms = ENGINE_COOLDOWN_LOCAL_MS;
    } else if (failure.retryAfterMs > 0 && (failure.kind === 'rate_limit' || failure.kind === 'credit' || failure.kind === 'server')) {
        ms = Math.min(Math.max(failure.retryAfterMs, 5e3), ENGINE_COOLDOWN_MAX_MS);
    } else if (failure.kind === 'rate_limit' || failure.kind === 'credit') {
        entry.hits.push(now);
        ms = ENGINE_COOLDOWN_LADDER_MS[Math.min(entry.hits.length, ENGINE_COOLDOWN_LADDER_MS.length) - 1];
        if (failure.kind === 'credit') ms = Math.max(ms, ENGINE_COOLDOWN_CREDIT_MS);
    } else if (failure.kind === 'auth' || failure.kind === 'model') {
        ms = ENGINE_COOLDOWN_AUTH_MS;
    } else {
        ms = ENGINE_COOLDOWN_TRANSIENT_MS;
    }
    entry.until = now + ms;
    entry.kind = failure.kind;
    store[key] = entry;
    _persistEngineCooldowns();
    return { key, until: entry.until, ms };
}

// Un éxito borra la pausa y la escalera: el motor vuelve a estar sano.
function markEngineSuccess(providerId, model) {
    const store = _engineCooldownStore();
    let changed = false;
    for (const key of [providerId, `${providerId}|${model || ''}`]) {
        if (store[key]) { delete store[key]; changed = true; }
    }
    if (changed) _persistEngineCooldowns();
}

/** Milisegundos de pausa que le quedan a un motor (0 = disponible). */
function getEngineCooldown(providerId, model, now = Date.now()) {
    const store = _engineCooldownStore();
    const until = Math.max(
        store[providerId]?.until || 0,
        store[`${providerId}|${model || ''}`]?.until || 0,
    );
    return Math.max(0, until - now);
}

function clearEngineCooldowns() {
    _engineCooldowns = {};
    _persistEngineCooldowns();
}

function _engineIsUsable(providerId) {
    const def = getProviderDef(providerId);
    if (!def || def.type === 'webgpu') return false;
    const cfg = state.settings.providerConfigs?.[providerId] || {};
    if (!(cfg.url || def.defaultUrl)) return false;
    if (def.auth === 'apikey') return !!cfg.apiKey;
    return true;
}

/**
 * getFailoverCandidates — motores alternativos para una petición, por orden.
 *
 * Mismo tipo de ejecución que el motor de origen (local↔local, cloud↔cloud),
 * con credenciales o sin ellas si no las necesita, fuera de pausa y sin los ya
 * probados. Orden: los que respondieron bien hace poco, luego favoritos, luego
 * uso reciente y por último el resto. El modelo es el último que funcionó en
 * ese motor, o el que tiene configurado.
 */
function getFailoverCandidates(primaryId, { exclude = [], now = Date.now() } = {}) {
    const primaryCfg = state.settings.providerConfigs?.[primaryId] || {};
    const wantMode = getProviderLocality(primaryId, primaryCfg.url || getProviderDef(primaryId)?.defaultUrl || '').mode;
    const skip = new Set([primaryId, ...exclude.map(e => (typeof e === 'string' ? e : e?.provider))]);
    const history = Array.isArray(state.settings.modelSuccessHistory) ? state.settings.modelSuccessHistory : [];
    const favorites = Array.isArray(state.settings.favoriteProviders) ? state.settings.favoriteProviders : [];
    const usage = Array.isArray(state.settings.providerUsageHistory) ? state.settings.providerUsageHistory : [];
    const rank = (list, id) => { const i = list.indexOf(id); return i < 0 ? 1e6 : i; };

    return Object.keys(PROVIDERS)
        .filter(id => !skip.has(id) && _engineIsUsable(id))
        .map((id, order) => {
            const cfg = state.settings.providerConfigs?.[id] || {};
            const def = getProviderDef(id);
            const url = cfg.url || def.defaultUrl || '';
            const learned = history.find(e => e.provider === id)?.model;
            const model = learned || cfg.model || def.defaultModel || '';
            const seen = state.providerAvailability?.[id];
            const recentlyDown = seen && (seen.status === 'unavailable' || seen.status === 'error')
                && now - (seen.checkedAt || 0) < 10 * 60e3;
            return {
                provider: id, model, order,
                mode: getProviderLocality(id, url).mode,
                paused: getEngineCooldown(id, model, now) > 0,
                down: !!recentlyDown,
                score: [history.findIndex(e => e.provider === id) < 0 ? 1e6 : history.findIndex(e => e.provider === id),
                        rank(favorites, id), rank(usage, id), order],
            };
        })
        .filter(c => c.model && c.mode === wantMode && !c.paused && !c.down)
        .sort((a, b) => {
            for (let i = 0; i < a.score.length; i++) if (a.score[i] !== b.score[i]) return a.score[i] - b.score[i];
            return 0;
        })
        .map(({ provider, model }) => ({ provider, model }));
}

/**
 * withEngineOverride — ejecuta `fn` con OTRO motor activo y lo deja todo como
 * estaba. Los constructores de petición leen state.settings (URL, clave,
 * modelo), así que se cambian de forma temporal; saveState usa la instantánea
 * (state._engineOverride) para no guardar nunca el motor provisional.
 */
async function withEngineOverride(providerId, model, fn) {
    const keys = ['provider', 'ollamaUrl', 'model', 'apiKey', 'temperature', 'topP', 'topK', 'maxTokens'];
    const snapshot = {};
    keys.forEach(k => { snapshot[k] = state.settings[k]; });
    state._engineOverride = snapshot;
    try {
        state.settings.provider = providerId;
        syncProviderToState();
        if (model) state.settings.model = model;
        updateStatusMeta();
        return await fn();
    } finally {
        keys.forEach(k => { state.settings[k] = snapshot[k]; });
        state._engineOverride = null;
        updateStatusMeta();
    }
}

/**
 * describeChatFailure — texto del error de un envío, según lo que ha pasado.
 * Antes todo error decía «verifica la API Key», incluso un 429 de cuota.
 * `hops` son los motores ya probados antes de rendirse.
 */
function describeChatFailure(error, providerName, hops = []) {
    const failure = classifyEngineFailure(error);
    const detail = String(error?.message || error || '').replace(/^(?:error:\s*)?[45]\d\d:?\s*/i, '').slice(0, 300);
    const wait = failure.retryAfterMs > 0 ? Math.max(1, Math.round(failure.retryAfterMs / 1000)) : 0;
    const tried = hops.length
        ? `\n\n*${tr('chat.failover.tried', 'Motores probados')}: ${hops.map(h => `${h.provider}${h.status ? ` (${h.status})` : ''}`).join(', ')}.*`
        : '';
    let head;
    switch (failure.kind) {
        case 'rate_limit':
            head = `⚠️ **${trf('chat.err.rate', 'Cupo agotado en {name}', { name: providerName })}**\n\n`
                + (wait ? `${trf('chat.err.rateWait', 'Puedes reintentar en unos {s} s.', { s: wait })} ` : '')
                + tr('chat.err.rateHint', 'Elige otro motor o activa el failover automático en Ajustes para que wIA lo haga solo.');
            break;
        case 'credit':
            head = `⚠️ **${trf('chat.err.credit', '{name} no tiene saldo o créditos', { name: providerName })}**\n\n`
                + tr('chat.err.creditHint', 'Revisa el plan de la cuenta o cambia de motor.');
            break;
        case 'auth':
            head = `⚠️ **${trf('chat.err.auth', '{name} ha rechazado las credenciales', { name: providerName })}**\n\n`
                + tr('chat.err.authHint', 'Comprueba que la API Key es de este motor, que no ha caducado y que tiene permisos.');
            break;
        case 'model':
            head = `⚠️ **${trf('chat.err.model', '{name} no encuentra el modelo', { name: providerName })}**\n\n`
                + tr('chat.err.modelHint', 'Elige otro modelo de la lista del motor: puede haber sido retirado.');
            break;
        case 'server':
            head = `⚠️ **${trf('chat.err.server', '{name} no está respondiendo bien', { name: providerName })}**\n\n`
                + tr('chat.err.serverHint', 'Es un fallo del servicio, no de tu configuración. Reintenta en un momento o cambia de motor.');
            break;
        default:
            head = `⚠️ **Error de conexión con ${providerName}**\n\n`
                + 'Verifica que el proveedor está configurado correctamente y que la API Key (si aplica) es válida.';
    }
    return `${head}${detail ? `\n\n\`${detail}\`` : ''}${tried}`;
}

// ─── FreeLLMAPI: estrategias de enrutado y puerto ──────────────
// La pasarela decide el motor según el «modelo»: «auto» usa la cadena activa y
// «auto:<estrategia>» reordena por inteligencia, velocidad o fiabilidad. No
// salen en su /v1/models, así que se ofrecen aquí; sin ellas el modelo por
// defecto «auto» no estaba en la lista y la validación lo sustituía por el
// primer modelo del catálogo, anulando el enrutado.
const FREELLMAPI_STRATEGIES = [
    ['auto', 'Automático (cadena activa)', 'chat.free.auto'],
    ['auto:balanced', 'Equilibrado', 'chat.free.balanced'],
    ['auto:smart', 'El más capaz', 'chat.free.smart'],
    ['auto:fast', 'El más rápido', 'chat.free.fast'],
    ['auto:reliable', 'El más fiable', 'chat.free.reliable'],
];

function withGatewayStrategies(models) {
    const have = new Set(models.map(m => m.name));
    const own = FREELLMAPI_STRATEGIES
        .filter(([id]) => !have.has(id))
        .map(([id, label, key]) => ({
            name: id,
            label: `🆓 ${tr(key, label)}`,
            desc: tr('chat.free.desc', 'La pasarela elige el proveedor y cambia solo si uno agota su cupo.'),
            capabilities: ['tools'],
        }));
    return [...own, ...models];
}

const FREELLMAPI_DEFAULT_URL = 'http://localhost:31415/v1';
// 31415 es el puerto de la app de escritorio; el instalador Docker publica 3001.
const FREELLMAPI_ALT_ORIGINS = ['http://localhost:3001', 'http://127.0.0.1:3001'];

/**
 * ¿Hay una FreeLLMAPI en este origen? Sin enviar ninguna credencial: su
 * /api/ping contesta y /v1/models sin clave devuelve un JSON de error 401 (o la
 * lista). Un servicio cualquiera en el 3001 no cumple las dos cosas.
 */
async function looksLikeFreeLLMAPI(origin) {
    try {
        const ping = await fetch(`${origin}/api/ping`, { signal: AbortSignal.timeout(2500) });
        if (!ping.ok) return false;
        const res = await fetch(`${origin}/v1/models`, { signal: AbortSignal.timeout(2500) });
        const body = await res.json().catch(() => null);
        return !!body && (Array.isArray(body.data) || (res.status === 401 && !!body.error));
    } catch (_) {
        return false;
    }
}

async function findFreeLLMAPIAltUrl() {
    for (const origin of FREELLMAPI_ALT_ORIGINS) {
        if (await looksLikeFreeLLMAPI(origin)) return `${origin}/v1`;
    }
    return null;
}

function configureConnectionHelp(failure = {}) {
    const providerId = state.settings.provider;
    const provider = getProviderDef(providerId);
    const endpoint = state.settings.ollamaUrl || provider.defaultUrl || 'URL sin configurar';
    const mixedContent = window.location.protocol === 'https:' && /^http:\/\//i.test(endpoint);
    const title = document.getElementById('corsHelpTitle');
    const summaryTitle = document.getElementById('corsHelpSummaryTitle');
    const summary = document.getElementById('corsHelpSummary');
    const steps = document.getElementById('corsHelpSteps');
    const badgeText = document.getElementById('corsWarningText');
    if (!steps) return;

    if (title) title.textContent = `🛡️ Diagnóstico · ${provider.name}`;
    if (summaryTitle) summaryTitle.textContent = `No se pudo acceder a ${provider.name}`;
    if (badgeText) badgeText.textContent = `${provider.name}: sin acceso · Ver diagnóstico`;

    let summaryText = `${failure.message || 'El navegador no recibió respuesta.'} Endpoint: ${endpoint}.`;
    const items = [];

    if (mixedContent) {
        summaryText = `La página usa HTTPS, pero el motor está configurado con HTTP (${endpoint}). El navegador puede bloquear esta conexión por contenido mixto.`;
        items.push(['Usa un endpoint compatible', 'Sirve el motor mediante HTTPS o abre wIA desde un origen HTTP/local de confianza.']);
    }

    const baseId = getProviderBaseId(providerId);
    if (baseId === 'ollama') {
        items.push(
            ['1. Comprueba Ollama', `Confirma que Ollama está abierto y responde en ${escapeHtml(endpoint)}. Una conexión rechazada no es un error CORS.`],
            ['2. Autoriza el origen de wIA', 'Si Ollama responde fuera de wIA pero el navegador lo bloquea, configura OLLAMA_ORIGINS y reinicia completamente Ollama.<code class="connection-help-command">launchctl setenv OLLAMA_ORIGINS "*"</code><code class="connection-help-command">[System.Environment]::SetEnvironmentVariable(\'OLLAMA_ORIGINS\', \'*\', \'User\')</code>'],
            ['3. Reintenta', 'Vuelve a wIA después de reiniciar Ollama. Si continúa, revisa que la URL y el puerto sean correctos.']
        );
    } else if (baseId === 'lmstudio') {
        items.push(
            ['1. Inicia el servidor local', 'En LM Studio abre Developer/Local Server, carga un modelo y arranca el servidor.'],
            ['2. Revisa el endpoint y CORS', `La URL suele terminar en /v1 (actual: ${escapeHtml(endpoint)}). Habilita las peticiones desde navegador en la configuración del servidor.`]
        );
    } else if (baseId === 'chatgpt_local') {
        items.push(
            ['1. Arranca la pasarela local', `wIA no habla con OpenAI en este motor: se conecta a una pasarela que corre en tu equipo y expone la suscripción de ChatGPT como API compatible con OpenAI. Arráncala y déjala abierta.<code class="connection-help-command">npx openai-oauth@latest</code>Debe quedar escuchando en ${escapeHtml(endpoint)}.`],
            ['2. Inicia sesión una vez', 'Si nunca lo hiciste, la pasarela pedirá autorizar con tu cuenta de ChatGPT en el navegador.<code class="connection-help-command">npx openai-oauth login</code>Tus credenciales se quedan en tu máquina; wIA solo ve el endpoint local.'],
            ['3. Ten en cuenta los términos', 'Estas pasarelas son proyectos NO oficiales, sin relación con OpenAI, y usan el flujo de su cliente Codex. El uso de tu suscripción por esta vía queda sujeto a los términos de OpenAI y bajo tu responsabilidad. Si prefieres la vía respaldada, usa el motor «OpenAI» con una API Key.']
        );
    } else if (baseId === 'freellmapi') {
        items.push(
            ['1. Arranca FreeLLMAPI', `wIA no habla con ningún proveedor en este motor: se conecta a la pasarela FreeLLMAPI, que debe estar en marcha y responder en ${escapeHtml(endpoint)}.<code class="connection-help-command">curl -fsSL https://freellmapi.co/install.sh | bash</code>Ese instalador usa Docker y publica el puerto <strong>3001</strong>; la app de escritorio usa el <strong>31415</strong>. wIA prueba ambos, pero si la tuya escucha en otro, cambia la URL (termina en <code class="connection-help-command">/v1</code>).`],
            ['2. Usa su clave unificada', 'En el panel de FreeLLMAPI (página Keys) copia la clave que empieza por <code class="connection-help-command">freellmapi-</code> y pégala como API Key. Las claves de cada proveedor se configuran allí, no en wIA.'],
            ['3. Si el navegador la bloquea', 'Ejecuta wIA con su servidor (<code class="connection-help-command">node server.js</code>): su proxy local alcanza la pasarela. Sin ese servidor, la pasarela solo acepta navegadores que figuren en su variable <code class="connection-help-command">DASHBOARD_ORIGINS</code>: añade ahí el origen de wIA y reinicia FreeLLMAPI.']
        );
    } else if (baseId === 'localai') {
        items.push(
            ['1. Arranca LocalAI', `Comprueba que el contenedor o binario está en marcha y responde en ${escapeHtml(endpoint)}. La API es compatible con OpenAI y suele colgar de /v1.`],
            ['2. Permite el origen de wIA', 'LocalAI solo acepta peticiones de navegador con CORS habilitado: arráncalo con <code class="connection-help-command">CORS=true</code> y, si lo restringes, añade el origen de wIA en <code class="connection-help-command">CORS_ALLOW_ORIGINS</code>.'],
            ['3. Clave solo si la exiges', 'Deja la API Key vacía salvo que hayas arrancado LocalAI con API_KEY; en ese caso ponla aquí y viajará como Bearer.']
        );
    } else if (baseId === 'ollama_remote') {
        items.push(
            ['1. Verifica alcance y protocolo', 'Comprueba que el host remoto sea accesible desde este dispositivo y usa HTTPS si wIA también se sirve por HTTPS.'],
            ['2. Configura el servidor remoto', 'Autoriza el origen de wIA con OLLAMA_ORIGINS o añade Access-Control-Allow-Origin en tu proxy inverso. No expongas Ollama directamente a Internet sin autenticación.']
        );
    } else {
        items.push(
            ['1. Comprueba la red y el endpoint', `Verifica que ${escapeHtml(endpoint)} sea accesible y que no haya VPN, proxy, firewall o bloqueo DNS.`],
            ['2. Distingue red de credenciales', 'Los errores 401/403 se muestran como credenciales no válidas. Este diagnóstico aparece cuando el navegador no puede obtener ninguna respuesta.'],
            ['3. Usa el servidor de wIA si es necesario', 'Al ejecutar wIA con server.js, el proxy local puede evitar restricciones CORS de proveedores que no aceptan llamadas directas desde el navegador.']
        );
    }

    if (summary) summary.textContent = summaryText;
    steps.innerHTML = items.map(([heading, body]) =>
        `<div class="connection-help-step"><strong>${heading}</strong>${body}</div>`
    ).join('');
}

function prepareModelPanelForProvider(providerId = state.settings.provider) {
    const provider = getProviderDef(providerId);
    state.rawModels = [];
    state.rawModelsProvider = providerId;
    state.modelCatalogState = 'loading';
    state.modelFeatureFilters = [];
    state.modelShowFavoritesOnly = false;
    state.modelShowVerifiedOnly = false;
    const search = document.getElementById('modelSearchInput');
    if (search) search.value = '';
    if (dom.modelFunctionFilters) dom.modelFunctionFilters.innerHTML = '';
    const cards = document.getElementById('modelCardsContainer');
    if (cards) cards.innerHTML = `<div class="model-cards-empty is-loading">Cargando modelos de ${escapeHtml(provider.name)}…</div>`;
    if (dom.modelSelect) {
        dom.modelSelect.innerHTML = `<option value="${escapeHtml(state.settings.model || '')}" selected>${escapeHtml(state.settings.model || 'Cargando catálogo…')}</option>`;
    }
    updateSettingsActiveContext();
}

// ─── OAuth con el proveedor (PKCE) ──────────
// El estado del intercambio vive en sessionStorage, no en localStorage: solo
// tiene que sobrevivir a la ida y vuelta al proveedor en ESTA pestaña, y así no
// queda un verificador olvidado en el disco si el usuario abandona a medias.
const OAUTH_PENDING_KEY = 'wia_oauth_pending';

function readPendingOAuth() {
    try {
        const raw = sessionStorage.getItem(OAUTH_PENDING_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
}

function clearPendingOAuth() {
    try { sessionStorage.removeItem(OAUTH_PENDING_KEY); } catch (_) {}
}

// URL de retorno: el propio origen y ruta, SIN query ni hash. Debe ser estable
// (la registra el proveedor en el redirect) y no arrastrar parámetros viejos.
function oauthCallbackUrl() {
    return `${window.location.origin}${window.location.pathname}`;
}

/**
 * startProviderOAuth — manda al usuario al proveedor a autorizar.
 * Guarda a qué motor volver, porque al regresar la app arranca de cero y el
 * código hay que aplicarlo a la conexión concreta desde la que se pidió (que
 * puede ser una copia, no el motor de serie).
 */
async function startProviderOAuth(providerId = state.settings.provider) {
    const oauth = getProviderOAuth(providerId);
    if (!oauth) return false;

    const verifier = createPkceVerifier();
    const challenge = await createPkceChallenge(verifier);
    if (!challenge) {
        alert(tr('oauth.insecureContext', 'Tu navegador no permite el cifrado necesario para este inicio de sesión. Abre wIA por HTTPS (o en localhost) e inténtalo de nuevo.'));
        return false;
    }

    try {
        sessionStorage.setItem(OAUTH_PENDING_KEY, JSON.stringify({
            provider: providerId, verifier, startedAt: Date.now(),
        }));
    } catch (_) {
        alert(tr('oauth.noStorage', 'No se pudo iniciar el proceso: este navegador tiene bloqueado el almacenamiento de sesión.'));
        return false;
    }

    const url = new URL(oauth.authUrl);
    url.searchParams.set('callback_url', oauthCallbackUrl());
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    window.location.assign(url.toString());
    return true;
}

/**
 * finishProviderOAuth — al volver del proveedor, canjea el código por la clave.
 *
 * Se llama en el arranque. El `code` se retira de la barra de direcciones antes
 * de nada: es de un solo uso, pero no debe quedarse en el historial, en los
 * marcadores ni en el `Referer` de la siguiente petición.
 */
async function finishProviderOAuth() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code) return false;

    const pending = readPendingOAuth();
    try {
        const clean = new URL(window.location.href);
        clean.searchParams.delete('code');
        window.history.replaceState({}, '', clean.pathname + clean.search + clean.hash);
    } catch (_) {}

    // Sin verificador no se puede completar: o la pestaña no es la que inició
    // el proceso, o alguien ha llegado con un `code` de fuera. No se canjea.
    if (!pending?.verifier || !pending.provider) { clearPendingOAuth(); return false; }
    const oauth = getProviderOAuth(pending.provider);
    if (!oauth || !PROVIDERS[pending.provider]) { clearPendingOAuth(); return false; }

    try {
        const res = await fetch(oauth.exchangeUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, code_verifier: pending.verifier, code_challenge_method: 'S256' }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data?.key) throw new Error('la respuesta no incluye ninguna clave');

        // La clave se guarda en la conexión que inició el proceso, no en el
        // motor activo: el usuario pudo cambiar de motor mientras autorizaba.
        const cfg = state.settings.providerConfigs[pending.provider] || {};
        cfg.apiKey = data.key;
        state.settings.providerConfigs[pending.provider] = cfg;
        state.settings.provider = pending.provider;
        syncProviderToState();
        saveState();
        clearPendingOAuth();
        return true;
    } catch (e) {
        clearPendingOAuth();
        console.warn('[OAuth] no se pudo completar el inicio de sesión:', e);
        alert(tr('oauth.failed', 'No se pudo completar el inicio de sesión con el proveedor. Puedes introducir tu API Key a mano.'));
        return false;
    }
}

function setConnectionValidationFeedback(kind = 'idle', message = 'Sin validar') {
    if (!dom.connectionValidationResult) return;
    dom.connectionValidationResult.className = `connection-validation-result is-${kind}`;
    dom.connectionValidationResult.textContent = message;
}

function setProviderAvailability(providerId, status, detail = '') {
    state.providerAvailability[providerId] = { status, detail, checkedAt: Date.now() };
    renderProviderOptions();
    updateSettingsActiveContext();
}

async function detectLocalProviderAvailability({ selectDefault = false } = {}) {
    const priority = ['webgpu', 'ollama', 'lmstudio'];
    priority.forEach(id => {
        state.providerAvailability[id] = { status: 'checking', detail: 'Comprobando' };
    });
    renderProviderOptions();
    updateSettingsActiveContext();

    // Contenido mixto: una página servida por HTTPS no puede llamar a
    // http://localhost:11434 (el navegador lo bloquea siempre). Sondearlo solo
    // gastaba 2,5 s del arranque para un resultado imposible, así que en ese
    // caso se marca como no alcanzable con un motivo explicable en la UI.
    const httpsPage = window.location.protocol === 'https:';
    const blockedByMixedContent = (url) => httpsPage && /^http:\/\//i.test(url);

    const probeJsonEndpoint = async (url) => {
        if (blockedByMixedContent(url)) return false;
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
            return response.ok;
        } catch (_) {
            return false;
        }
    };

    // Las comprobaciones se ejecutan en paralelo para no penalizar el arranque;
    // la elección conserva estrictamente el orden de prioridad solicitado.
    const [webgpuMode, ollamaAvailable, lmstudioAvailable] = await Promise.all([
        checkWebGPUSupport(),
        probeJsonEndpoint(`${PROVIDERS.ollama.defaultUrl}/api/tags`),
        probeJsonEndpoint(`${PROVIDERS.lmstudio.defaultUrl}/models`),
    ]);

    const results = {
        webgpu: webgpuMode === 'webgpu',
        ollama: ollamaAvailable,
        lmstudio: lmstudioAvailable,
    };
    const mixedContentBlocked = {
        ollama: blockedByMixedContent(PROVIDERS.ollama.defaultUrl),
        lmstudio: blockedByMixedContent(PROVIDERS.lmstudio.defaultUrl),
    };
    priority.forEach(id => {
        let detail;
        if (results[id]) detail = 'Disponible';
        else if (mixedContentBlocked[id]) detail = 'Bloqueado (HTTPS→HTTP)';
        else if (id === 'webgpu' && webgpuMode === 'wasm') detail = 'Solo WASM';
        else detail = 'No detectado';
        state.providerAvailability[id] = {
            status: results[id] ? 'available' : 'unavailable',
            detail,
            checkedAt: Date.now(),
        };
    });

    const hasUsage = Array.isArray(state.settings.providerUsageHistory) && state.settings.providerUsageHistory.length > 0;
    if (selectDefault && !state.hasSavedSettings && !hasUsage) {
        // Si no se detecta ninguno, WebGPU sigue siendo el fallback final porque
        // puede degradar a WASM y no requiere un servicio externo.
        const selectedProvider = priority.find(id => results[id]) || 'webgpu';
        state.settings.provider = selectedProvider;
        syncProviderToState();
    }

    renderProviderOptions();
    updateStatusMeta();
    return results;
}

let providerStatusRun = 0;

async function checkProviderStatus(options = {}) {
    const runId = ++providerStatusRun;
    const providerId = state.settings.provider;
    dom.statusDot.className = 'status-dot loading';
    dom.statusText.textContent = 'Verificando...';
    updateStatusMeta();
    dom.corsWarningBadge?.classList.add('hidden');
    
    const prov = getProviderDef(providerId);
    const provType = prov.type;
    if (state.rawModelsProvider !== providerId) {
        prepareModelPanelForProvider(providerId);
    }
    
    try {
        let models = [];
        const headers = getAuthHeaders();
        const baseUrl = String(state.settings.ollamaUrl || '').trim().replace(/\/+$/, '');

        if (provType !== 'webgpu' && !baseUrl) throw new Error('URL del servidor requerida');
        if (prov.auth === 'apikey' && !String(state.settings.apiKey || '').trim()) {
            throw new Error('API Key requerida');
        }
        
        if (provType === 'ollama') {
            // Ollama native API
            const url = `${baseUrl}/api/tags`;
            const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
            if (!res.ok) throw await providerHttpError(res);
            const data = await res.json();
            models = data.models || [];
            
        } else if (provType === 'openai') {
            // OpenAI-compatible (LMStudio, Groq, OpenRouter, OpenAI)
            const url = `${baseUrl}/models`;
            const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
            if (!res.ok) throw await providerHttpError(res);
            const data = await res.json();
            // Map pricing metadata if provided (OpenRouter mostly)
            models = (data.data || []).map(m => ({
                name: m.id,
                label: m.name || m.id,
                pricing: m.pricing,
                capabilities: m.capabilities || m.modalities,
                context: m.context_length || m.context_window || m.max_context_length,
                repoUrl: m.website || m.url || null
            }));
            // Una pasarela decide el motor según el «modelo»: se ofrecen sus
            // estrategias (auto, auto:smart…) aunque no vengan en el catálogo.
            if (getProviderBaseId(providerId) === 'freellmapi') models = withGatewayStrategies(models);
            
        } else if (provType === 'gemini') {
            // Gemini REST API
            const apiKey = state.settings.apiKey;
            if (!apiKey) throw new Error('API Key requerida');
            const url = `${baseUrl}/models`;
            const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
            if (!res.ok) throw await providerHttpError(res);
            const data = await res.json();
            models = (data.models || [])
                .filter(m => m.name && m.supportedGenerationMethods?.includes('generateContent'))
                .map(m => ({
                    name: m.name.replace('models/', ''),
                    label: m.displayName || m.name.replace('models/', ''),
                    desc: m.description || '',
                    capabilities: m.supportedGenerationMethods || [],
                    context: m.inputTokenLimit || m.outputTokenLimit || null
                }));
            
        } else if (provType === 'anthropic') {
            // Anthropic expone GET /v1/models utilizable desde navegador con
            // x-api-key + anthropic-dangerous-direct-browser-access: lista real
            // y validación de la key sin gastar tokens (antes se hacía un POST
            // facturable contra /messages con una lista fija obsoleta).
            const fallbackModels = [
                'claude-sonnet-5',
                'claude-opus-4-8',
                'claude-haiku-4-5-20251001',
                'claude-sonnet-4-5',
                'claude-3-5-haiku-latest',
            ];
            const apiKey = state.settings.apiKey;
            if (apiKey) {
                const res = await fetch(`${baseUrl}/models?limit=100`, {
                    headers,
                    signal: AbortSignal.timeout(8000)
                });
                if (!res.ok) throw await providerHttpError(res);
                const data = await res.json();
                models = (data.data || []).map(m => ({
                    name: m.id,
                    label: m.display_name || m.id,
                    capabilities: ['tools', 'thinking']
                }));
            }
            if (models.length === 0) {
                models = fallbackModels.map(m => ({ name: m, label: m, capabilities: ['tools', 'thinking'] }));
            }
        } else if (provType === 'webgpu') {
            // WebGPU / Transformers.js — no server needed, models run in browser
            const support = await checkWebGPUSupport();
            
            // Scan Cache Storage. Sin forzar: esta comprobación es periódica y
            // recorrer miles de entradas cada vez sale caro; el escaneo se
            // invalida explícitamente cuando algo cambia en la caché.
            webgpuState.cachedModelIds = await getCachedWebGPUModels();
            if (runId !== providerStatusRun || state.settings.provider !== providerId) {
                return { ok: false, stale: true, provider: providerId };
            }
            const cacheCount = webgpuState.cachedModelIds.size;
            const cacheSuffix = cacheCount > 0 ? ` · ${cacheCount} en caché` : '';

            const mergedWebGPUModels = [
                ...WEBGPU_MODELS,
                ...getWebGPUCustomModels().filter(custom => !WEBGPU_MODELS.some(base => base.id === custom.id))
            ];
            models = mergedWebGPUModels.map(m => ({
                name: m.id,
                label: m.label,
                size: m.size,
                sizeBytes: m.sizeBytes,
                capabilities: m.capabilities,
                desc: m.desc,
                tier: m.tier,
                pricing: null,
                context: m.context,
                dtype: m.dtype,
                selectable: m.selectable !== false,
                experimental: !!m.experimental,
                verified: !!m.verified,
                visionAssist: !!m.visionAssist,
                omnimodal: !!m.omnimodal,
                engine: m.engine || null,
                task: m.task || null,
                repoUrl: m.repoUrl,
                custom: !!m.custom,
            }));
            dom.statusDot.className = 'status-dot online';
            const deviceLabel = support === 'webgpu' 
                ? `🧠 WebGPU activo${cacheSuffix}` 
                : `⚠️ Modo WASM (sin GPU)${cacheSuffix}`;
            dom.statusText.textContent = deviceLabel;

            // Update WebGPU support badge in the panel
            const supportBadge = document.getElementById('webgpuSupportBadge');
            if (supportBadge) {
                supportBadge.textContent = support === 'webgpu' ? '✅ WebGPU disponible' : '⚠️ Solo WASM (alerta de hardware)';
                supportBadge.className = `webgpu-support-badge ${support === 'webgpu' ? 'supported' : 'fallback'}`;
            }

            // Show error modal immediately if WebGPU is unsupported (and we haven't flagged it silently)
            if (support === 'wasm') {
                const modal = document.getElementById('webgpuSupportModal');
                if (modal && !modal.dataset.shown) {
                    modal.classList.remove('hidden');
                    modal.dataset.shown = 'true'; // Prevent spamming it on every refresh in same session
                }
            }

            // Validation: Ensure selected model exists in the curated list
            const currentId = state.settings.model;
            const selectedMeta = mergedWebGPUModels.find(m => m.id === currentId);
            
            if ((!selectedMeta || selectedMeta.selectable === false) && mergedWebGPUModels.length > 0) {
                console.warn(`[WebGPU] El modelo '${currentId}' no está validado o ha sido eliminado. Cambiando a un fallback seguro...`);
                // Prefer first 'quick' model, otherwise first available
                const fallback = mergedWebGPUModels.find(m => m.tier === 'quick' && m.selectable !== false) || mergedWebGPUModels.find(m => m.selectable !== false) || mergedWebGPUModels[0];
                state.settings.model = fallback.id;
                // Update persistent configs for this provider too
                if (state.settings.providerConfigs.webgpu) {
                    state.settings.providerConfigs.webgpu.model = fallback.id;
                }
                saveState();
                applySettingsToUI();
            }

            populateModels(models);
            setProviderAvailability(providerId, 'available', support === 'webgpu' ? 'Disponible' : 'WASM');

            // «Mejorar prompt» habla HTTP con el proveedor y no tiene rama WebGPU:
            // si venimos de otro motor, el botón se quedaba visible y al pulsarlo
            // fallaba con «Respuesta vacía del modelo». Se oculta explícitamente.
            dom.improvePromptBtn?.classList.add('hidden');

            // Check if currently selected model is already loaded
            if (webgpuState.loadedModelId === state.settings.model) {
                dom.statusText.textContent = '🧠 Modelo cargado';
            }

            await fetchModelCapabilities(state.settings.model);
            updateInputDisclaimer();
            updateStatusMeta();
            return {
                ok: true,
                provider: state.settings.provider,
                models,
                modelCount: models.length,
                mode: support
            }; // Skip further common logic
        }
        
        if (runId !== providerStatusRun || state.settings.provider !== providerId) {
            return { ok: false, stale: true, provider: providerId };
        }
        let hasModel = models.some(m => m.name === state.settings.model);
        if (!hasModel && models.length > 0) {
            const fallbackModel = models.find(m => m.name === prov.defaultModel) || models[0];
            state.settings.model = fallbackModel.name;
            getActiveProviderConfig().model = fallbackModel.name;
            saveState();
            hasModel = true;
        }
        populateModels(models);
        setProviderAvailability(providerId, 'available', 'Disponible');

        dom.statusDot.className = 'status-dot online';
        dom.statusText.textContent = hasModel ? 'Conectado' : 'Modelo no encontrado';
        
        if (hasModel || models.length > 0) {
            dom.improvePromptBtn?.classList.remove('hidden');
            await fetchModelCapabilities(state.settings.model);
        } else {
            dom.improvePromptBtn?.classList.add('hidden');
        }
        updateStatusMeta();
        return {
            ok: true,
            provider: state.settings.provider,
            models,
            modelCount: models.length
        };
    } catch (e) {
        if (runId !== providerStatusRun || state.settings.provider !== providerId) {
            return { ok: false, stale: true, provider: providerId, error: e };
        }
        dom.statusDot.className = 'status-dot offline';
        const failure = describeConnectionError(e);
        setProviderAvailability(providerId, failure.code === 'network' ? 'unavailable' : 'error', failure.status);
        const isCors = failure.code === 'network';

        // La app de escritorio de FreeLLMAPI escucha en :31415 y su instalador
        // Docker en :3001. Si la URL es la de fábrica y no hay nadie, se busca en
        // el otro puerto (sin enviar la clave) y se pasa a él, avisando.
        if (isCors && getProviderBaseId(providerId) === 'freellmapi'
            && String(state.settings.ollamaUrl || '').replace(/\/+$/, '') === FREELLMAPI_DEFAULT_URL) {
            const altUrl = await findFreeLLMAPIAltUrl();
            if (altUrl && runId === providerStatusRun && state.settings.provider === providerId) {
                state.settings.ollamaUrl = altUrl;
                getActiveProviderConfig().url = altUrl;
                saveState();
                if (dom.ollamaUrl) dom.ollamaUrl.value = altUrl;
                console.info(`[FreeLLMAPI] No había nada en ${FREELLMAPI_DEFAULT_URL}; usando la pasarela de ${altUrl}.`);
                return checkProviderStatus(options);
            }
        }

        dom.statusText.textContent = failure.status;
        dom.improvePromptBtn?.classList.add('hidden');
        
        if (isCors) {
            console.warn(`[Conexión] ${getProviderDef(state.settings.provider).name}: sin respuesta; puede ser red, servicio, URL o CORS.`, e);
            configureConnectionHelp(failure);
            dom.corsWarningBadge.classList.remove('hidden');
        } else {
            dom.corsWarningBadge.classList.add('hidden');
        }

        state.rawModels = [];
        state.rawModelsProvider = state.settings.provider;
        state.modelCatalogState = 'error';
        if (dom.modelFunctionFilters) dom.modelFunctionFilters.innerHTML = '';
        const modelCards = document.getElementById('modelCardsContainer');
        if (modelCards) modelCards.innerHTML = `<div class="model-cards-empty is-error">No se pudo cargar el catálogo de ${escapeHtml(prov.name)}.<br>${escapeHtml(failure.message)}</div>`;
        dom.modelSelect.innerHTML = `<option value="${escapeHtml(state.settings.model)}" selected>${escapeHtml(state.settings.model)} (sin verificar)</option>`;
        updateSettingsActiveContext();
        updateStatusMeta();
        return {
            ok: false,
            provider: state.settings.provider,
            error: e,
            code: failure.code,
            message: failure.message,
            modelCount: 0
        };
    }
}

async function fetchModelCapabilities(modelName) {
    const providerId = state.settings.provider;
    const provType = getProviderDef(providerId).type;
    const selectedModel = (state.rawModels || []).find(m => m.name === modelName) || WEBGPU_MODELS.find(m => m.id === modelName) || { name: modelName };
    const inferred = getRuntimeCapabilities(selectedModel, providerId);

    if (providerId === 'webgpu') {
        state.capabilities = Array.from(new Set([
            ...inferred,
            ...(supportsWebGPUImageAssist(providerId) ? ['vision'] : [])
        ]));
        updateToolbarVisibility();
        return;
    }

    if (['openai', 'gemini', 'anthropic'].includes(provType) || getProviderBaseId(providerId) === 'lmstudio') {
        state.capabilities = inferred;
        updateToolbarVisibility();
        return;
    }

    try {
        // getAuthHeaders es obligatorio: Ollama remoto y Ollama Cloud exigen
        // Bearer, así que sin cabeceras esta detección de capacidades fallaba
        // siempre en silencio en esos dos motores. El timeout evita que un
        // servidor que no responde deje la barra de herramientas congelada.
        const res = await fetch(`${state.settings.ollamaUrl}/api/show`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ name: modelName }),
            signal: AbortSignal.timeout(6000)
        });
        if (!res.ok) throw await providerHttpError(res);
        const data = await res.json();
        const rawCaps = normalizeKeywordList(data.details?.capabilities || data.capabilities || []);
        const merged = new Set([...inferred, ...rawCaps]);
        state.capabilities = Array.from(merged);
        updateToolbarVisibility();
    } catch(e) {
        state.capabilities = inferred;
        updateToolbarVisibility();
    }
}

function updateToolbarVisibility() {
    const baseAccept = '.txt,.csv,.json,.md,.js,.py,.html,.css,.sql,.go,.rs,.c,.cpp,.pdf,application/pdf';
    const allowImages = state.capabilities.includes('vision') || supportsWebGPUImageAssist();
    // Vision
    if (allowImages) {
        dom.fileUpload.setAttribute('accept', `image/*,${baseAccept}`);
    } else {
        dom.fileUpload.setAttribute('accept', baseAccept);
        // Quitar imágenes previas
        state.attachments = state.attachments.filter(a => !a.isImage);
        renderAttachmentPreview();
    }
    
    // Tools (búsqueda en Internet)
    if (state.capabilities.includes('tools')) {
        dom.toolInternet.classList.remove('hidden');
        dom.toolInternet.classList.toggle('active', !!state.settings.webSearchEnabled);
    } else {
        dom.toolInternet.classList.add('hidden');
        dom.toolInternet.classList.remove('active');
    }

    // Indicador de visión: se muestra cuando el motor puede analizar imágenes.
    // En WebGPU eso significa que hay un asistente visual disponible (siempre lo
    // hay: por defecto o el elegido). En proveedores con visión nativa, si el
    // modelo la soporta.
    updateVisionIndicator();
    
    // Thinking
    if (state.capabilities.includes('thinking') || state.settings.model.includes('gemma') || state.settings.model.includes('deepseek') || state.settings.model.includes('claude') || state.settings.model.includes('o1') || state.settings.model.includes('o3')) {
        dom.toolThinking.classList.remove('hidden');
        if (state.settings.thinkingMode) {
            dom.toolThinking.classList.add('active');
        } else {
            dom.toolThinking.classList.remove('active');
        }
    } else {
        dom.toolThinking.classList.add('hidden');
    }
}

// ─── Model Metadata Helpers ──────────────────
function normalizeKeywordList(value) {
    if (!value) return [];
    const items = Array.isArray(value) ? value : [value];
    return items
        .flatMap(item => typeof item === 'string' ? item.split(',') : [])
        .map(item => item.trim().toLowerCase())
        .filter(Boolean);
}

function isFreeModel(model) {
    const prompt = parseFloat(model?.pricing?.prompt ?? model?.pricing?.input ?? NaN);
    const completion = parseFloat(model?.pricing?.completion ?? model?.pricing?.output ?? NaN);
    const name = (model?.name || '').toLowerCase();
    return ((prompt === 0 || Number.isNaN(prompt)) && (completion === 0 || Number.isNaN(completion)) && !!model?.pricing)
        || name.includes(':free')
        || name.includes('-free')
        || name.includes('gratis');
}

function getNumericSizeMB(model) {
    if (typeof model?.sizeBytes === 'number') return model.sizeBytes;
    // Ollama devuelve `size` en bytes; el catálogo WebGPU usa `sizeBytes` en MB.
    if (typeof model?.size === 'number') return model.size / (1024 * 1024);
    if (typeof model?.size_vram === 'number') return model.size_vram / (1024 * 1024);
    const text = String(model?.size || '').toLowerCase();
    const match = text.match(/([\d.]+)\s*(gb|mb)/);
    if (!match) return null;
    const value = parseFloat(match[1]);
    return match[2] === 'gb' ? value * 1024 : value;
}

function formatModelSizeGB(model) {
    const gigabyte = 1024 * 1024 * 1024;
    const megabyte = 1024 * 1024;

    if (typeof model?.size === 'number' && model.size > 0) {
        return `${(model.size / gigabyte).toFixed(2)} GB`;
    }
    if (typeof model?.sizeBytes === 'number' && model.sizeBytes > 0) {
        return `${(model.sizeBytes / 1024).toFixed(2)} GB`;
    }
    if (typeof model?.size_vram === 'number' && model.size_vram > 0) {
        return `${(model.size_vram / gigabyte).toFixed(2)} GB`;
    }

    const text = String(model?.size || '').trim();
    const match = text.match(/^(~?\s*)([\d.]+)\s*(gb|mb)$/i);
    if (!match) return text || (model?.details?.parameter_size || '');
    const prefix = match[1].replace(/\s/g, '');
    const value = Number(match[2]);
    const bytes = match[3].toLowerCase() === 'gb' ? value * gigabyte : value * megabyte;
    return `${prefix}${(bytes / gigabyte).toFixed(2)} GB`;
}

function getModelFunctionKeys(model, providerId = state.settings.provider) {
    const keys = new Set();
    const name = (model?.name || model?.id || '').toLowerCase();
    const explicit = normalizeKeywordList(model?.capabilities);
    const tags = normalizeKeywordList(model?.tags);
    const detailCaps = normalizeKeywordList(model?.details?.capabilities);
    const allHints = new Set([...explicit, ...tags, ...detailCaps]);
    const sizeMB = getNumericSizeMB(model);

    allHints.forEach(key => {
        if (MODEL_FUNCTION_DEFS[key]) keys.add(key);
        if (key === 'tool' || key === 'function_calling') keys.add('tools');
    });

    if (isFreeModel(model)) keys.add('free');
    if (model?.experimental || model?.selectable === false) keys.add('experimental');

    if (/(vision|vl|llava|pixtral|omni|gpt-4o|gpt-4\.1|qwen2-vl|phi-3\.5-vision|smolvlm|gemini|claude-3|claude-sonnet-4|claude-opus-4)/.test(name)) keys.add('vision');
    if (model?.omnimodal || allHints.has('omnimodal')) keys.add('omnimodal');
    if (/(think|reason|reasoning|r1|qwq|o1|o3|deepseek|math)/.test(name)) keys.add('thinking');
    if (/(coder|codex|code|devstral|deepcoder)/.test(name)) keys.add('coding');
    if (/(tool|function|gpt-4\.1|gpt-4o|gemini|claude|llama-3\.3|qwen2\.5|qwen3)/.test(name)) keys.add('tools');
    if (/(qwen|gemma|llama|gemini|claude|ministral|mistral|multilingual)/.test(name)) keys.add('multilingual');
    if (/(tiny|mini|flash|haiku|turbo|360m|0\.5b|1b|1\.5b)/.test(name)) keys.add('fast');
    if (/(7b|8b|11b|70b|72b|405b|large|apertus-8b)/.test(name)) keys.add('large');
    // Modelos sin alineamiento: se reconocen por las marcas habituales del repo
    if (UNCENSORED_NAME_HINTS.some(hint => name.includes(hint))) keys.add('uncensored');

    if (sizeMB !== null) {
        if (sizeMB <= 1200) keys.add('fast');
        if (sizeMB >= 3500) keys.add('large');
    }

    // Por motor base, para que un clon de Groq/OpenAI/... conserve el soporte
    // de herramientas de su original.
    if (['gemini', 'openai', 'chatgpt_local', 'freellmapi', 'nvidia', 'openrouter', 'groq', 'mistral', 'cerebras', 'claude', 'lmstudio', 'localai'].includes(getProviderBaseId(providerId))) {
        keys.add('tools');
    }

    return MODEL_FILTER_ORDER.filter(key => keys.has(key));
}

function getRuntimeCapabilities(model, providerId = state.settings.provider) {
    const keys = new Set(getModelFunctionKeys(model, providerId));
    const caps = [];
    if (keys.has('tools')) caps.push('tools');
    if (keys.has('thinking')) caps.push('thinking');
    if (keys.has('vision') && !(providerId === 'webgpu' && model?.selectable === false)) caps.push('vision');
    return caps;
}

function getModelTags(model) {
    return getModelFunctionKeys(model).map(key => ({
        key,
        label: MODEL_FUNCTION_DEFS[key]?.label || key,
        cls: MODEL_FUNCTION_DEFS[key]?.cls || ''
    }));
}

// ─── Favoritos de modelos ────────────────────
// Se guardan como IDs con prefijo de proveedor ("webgpu:onnx-.../..."),
// para que un mismo nombre de modelo no colisione entre proveedores.
function favoriteModelKey(modelId, providerId = state.settings.provider) {
    return `${providerId}:${modelId}`;
}

function isFavoriteModel(modelId, providerId = state.settings.provider) {
    return (state.settings.favoriteModels || []).includes(favoriteModelKey(modelId, providerId));
}

function toggleFavoriteModel(modelId, providerId = state.settings.provider) {
    const key = favoriteModelKey(modelId, providerId);
    const favs = state.settings.favoriteModels || (state.settings.favoriteModels = []);
    const idx = favs.indexOf(key);
    if (idx >= 0) favs.splice(idx, 1); else favs.push(key);
    saveState();
    if (state.rawModels) populateModels(state.rawModels);
}
// 🔁 Failover automático entre motores (ver sendWithFailover en 06-chat.js).
(function bindFailoverUI() {
    dom.autoFailoverToggle?.addEventListener('change', (event) => {
        state.settings.autoFailover = event.target.checked;
        saveState();
    });
})();

window.toggleFavoriteModel = toggleFavoriteModel;

function getModelPrice(m) {
    if (!m.pricing) return null;
    const p = parseFloat(m.pricing.prompt || m.pricing.input || 0);
    const c = parseFloat(m.pricing.completion || m.pricing.output || 0);
    if ((p === 0 || isNaN(p)) && (c === 0 || isNaN(c))) return null; // free handled by tag
    const total = (p + c) / 2;
    if (total < 0.001) return `< $0.001/mtok`;
    return `$${total.toFixed(3)}/mtok`;
}

function renderModelTagsHtml(tags) {
    return tags.map(t => `<span class="model-tag ${t.cls}">${t.label}</span>`).join('');
}

function getProviderExploreLinks(providerId = state.settings.provider) {
    const links = {
        webgpu: [
            { label: '🔍 Transformers.js en HuggingFace', url: 'https://huggingface.co/models?library=transformers.js&sort=downloads' },
            { label: '📊 WebGPU Report', url: 'https://webgpureport.org/' }
        ],
        ollama: [
            { label: '🦙 Catálogo Ollama', url: 'https://ollama.com/search' },
            { label: '📚 Biblioteca Ollama', url: 'https://ollama.com/library' }
        ],
        ollama_remote: [
            { label: '🦙 Catálogo Ollama', url: 'https://ollama.com/search' },
            { label: '📚 Biblioteca Ollama', url: 'https://ollama.com/library' }
        ],
        ollama_cloud: [
            { label: '☁️ Ollama Cloud', url: 'https://ollama.com/' },
            { label: '🦙 Buscar modelos', url: 'https://ollama.com/search' }
        ],
        openrouter: [
            { label: '🔀 Modelos OpenRouter', url: 'https://openrouter.ai/models' }
        ],
        groq: [
            { label: '⚡ Modelos Groq', url: 'https://console.groq.com/docs/models' }
        ],
        openai: [
            { label: '🤖 Modelos OpenAI', url: 'https://platform.openai.com/docs/models' }
        ],
        nvidia: [
            { label: '🟢 Catálogo Nvidia NIM', url: 'https://build.nvidia.com/models' }
        ],
        freellmapi: [
            { label: '🆓 FreeLLMAPI en GitHub', url: 'https://github.com/tashfeenahmed/freellmapi' }
        ],
        mistral: [
            { label: '🌬️ Modelos Mistral', url: 'https://docs.mistral.ai/models' }
        ],
        cerebras: [
            { label: '🚀 Modelos Cerebras', url: 'https://inference-docs.cerebras.ai/models/overview' }
        ],
        gemini: [
            { label: '✨ Modelos Gemini', url: 'https://ai.google.dev/gemini-api/docs/models' }
        ],
        claude: [
            { label: '🟣 Modelos Claude', url: 'https://docs.anthropic.com/en/docs/about-claude/models/overview' }
        ],
        lmstudio: [
            { label: '💻 LM Studio Models', url: 'https://lmstudio.ai/models' }
        ]
    };
    return links[providerId] || [];
}

function parseHuggingFaceModelId(input) {
    const raw = String(input || '').trim();
    if (!raw) return '';
    try {
        const url = new URL(raw);
        if (!/huggingface\.co$/i.test(url.hostname)) return '';
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts[0] === 'models') parts.shift();
        if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
        return '';
    } catch {
        const sanitized = raw.replace(/^https?:\/\/huggingface\.co\//i, '').replace(/^models\//i, '').replace(/\/+$/, '');
        const parts = sanitized.split('/').filter(Boolean);
        return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : '';
    }
}

function humanizeWebGPUModelLabel(modelId) {
    const [, repo = modelId] = modelId.split('/');
    return repo
        .replace(/-ONNX$/i, '')
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (m) => m.toUpperCase());
}

function createWebGPUModelEntry(modelId, overrides = {}) {
    return {
        name: modelId,
        id: modelId,
        label: humanizeWebGPUModelLabel(modelId),
        size: overrides.size || 'Manual',
        sizeBytes: overrides.sizeBytes ?? null,
        capabilities: overrides.capabilities || [],
        desc: overrides.desc || 'Modelo añadido manualmente. Se intentará cargar desde Hugging Face usando Transformers.js/ONNX.',
        tier: overrides.tier || 'manual',
        pricing: null,
        context: overrides.context || null,
        dtype: overrides.dtype || 'q4f16',
        selectable: overrides.selectable !== false,
        experimental: overrides.experimental !== false,
        repoUrl: overrides.repoUrl || `https://huggingface.co/${modelId}`,
        custom: true,
    };
}

// ─── Estado de prueba de un modelo WebGPU ────
// Lo que le ha pasado a ESTE navegador con cada modelo. Se guarda con los
// ajustes; no se envía a ningún sitio.
function recordWebGPUModelReport(modelId, status, detail = '') {
    if (!modelId || (status !== 'ok' && status !== 'fail')) return;
    const reports = { ...(state.settings.webgpuModelReports || {}) };
    reports[modelId] = {
        status,
        at: new Date().toISOString().slice(0, 10),
        runtime: typeof TRANSFORMERS_VERSION !== 'undefined' ? TRANSFORMERS_VERSION : '',
        ...(status === 'fail' ? { detail: describeWebGPULoadFailure(detail) } : {}),
    };
    state.settings.webgpuModelReports = reports;
    saveState();
}

function clearWebGPUModelReport(modelId) {
    if (!state.settings.webgpuModelReports?.[modelId]) return;
    const reports = { ...state.settings.webgpuModelReports };
    delete reports[modelId];
    state.settings.webgpuModelReports = reports;
    saveState();
}

/**
 * getWebGPUModelStatus — qué se sabe de si un modelo funciona.
 *
 * Devuelve { kind, label, title }. Orden de fiabilidad: lo que ha pasado en
 * este equipo manda sobre lo que diga el catálogo, porque depende de la GPU y
 * del navegador; después, el catálogo; y si nadie lo ha probado, se dice.
 *   ok-here · failed-here · broken · verified · untested
 */
function getWebGPUModelStatus(model) {
    const id = model?.name || model?.id || '';
    const report = state.settings.webgpuModelReports?.[id];
    const broken = getWebGPUBrokenInfo(id);
    const when = (date, runtime) => [date, runtime ? `Transformers.js ${runtime}` : ''].filter(Boolean).join(' · ');
    if (report?.status === 'ok') {
        return { kind: 'ok-here', label: tr('webgpu.status.okHere', '✅ Probado aquí'),
            title: tr('webgpu.status.okHere.title', 'Ha cargado y respondido en este equipo ({when}).').replace('{when}', when(report.at, report.runtime)) };
    }
    if (report?.status === 'fail') {
        return { kind: 'failed-here', label: tr('webgpu.status.failedHere', '⛔ Falló aquí'),
            title: tr('webgpu.status.failedHere.title', 'No funcionó en este equipo ({when}): {why}. Puedes volver a intentarlo.')
                .replace('{when}', when(report.at, report.runtime)).replace('{why}', report.detail || '') };
    }
    if (broken) {
        return { kind: 'broken', label: tr('webgpu.status.broken', '⛔ No funciona'),
            title: tr('webgpu.status.broken.title', 'Probado y no funciona ({when}): {why}.')
                .replace('{when}', when(broken.tested, broken.runtime.replace(/^Transformers\.js\s*/i, ''))).replace('{why}', broken.reason) };
    }
    if (model?.verified) {
        return { kind: 'verified', label: tr('webgpu.status.verified', '✅ Probado'),
            title: tr('webgpu.status.verified.title', 'Probado: carga e infiere correctamente en WebGPU') };
    }
    return { kind: 'untested', label: tr('webgpu.status.untested', '⚠️ Sin probar'),
        title: tr('webgpu.status.untested.title', 'Nadie lo ha probado todavía: puede tardar o no funcionar en tu equipo') };
}

function getWebGPUCustomModels() {
    const custom = state.settings.providerConfigs?.webgpu?.customModels;
    return Array.isArray(custom) ? custom : [];
}

function saveWebGPUCustomModels(customModels) {
    if (!state.settings.providerConfigs.webgpu) state.settings.providerConfigs.webgpu = {};
    state.settings.providerConfigs.webgpu.customModels = customModels;
}

function addManualWebGPUModel(inputValue) {
    const modelId = parseHuggingFaceModelId(inputValue);
    if (!modelId) {
        notify(trf('dlg.webgpu.invalidRepo', 'Pega un repo válido de Hugging Face o una URL completa, por ejemplo: onnx-community/Qwen2.5-Coder-7B-Instruct'), 'error');
        return false;
    }

    const current = getWebGPUCustomModels();
    const alreadyExists = WEBGPU_MODELS.some(m => m.id === modelId) || current.some(m => m.id === modelId);
    const broken = getWebGPUBrokenInfo(modelId);
    if (broken && !alreadyExists) {
        const msg = tr('webgpu.add.brokenConfirm', 'Este modelo ya se probó y NO funcionó ({when}):\n\n{why}\n\n¿Añadirlo de todos modos para probarlo en tu equipo?')
            .replace('{when}', [broken.tested, broken.runtime].filter(Boolean).join(' · ')).replace('{why}', broken.reason);
        if (!confirm(msg)) return false;
    }
    if (alreadyExists) {
        state.settings.model = modelId;
        getActiveProviderConfig().model = modelId;
        saveState();
        if (state.rawModels) populateModels(state.rawModels);
        return true;
    }

    const created = createWebGPUModelEntry(modelId, {
        capabilities: getModelFunctionKeys({ name: modelId }, 'webgpu'),
    });
    const next = [created, ...current];
    saveWebGPUCustomModels(next);
    state.settings.model = modelId;
    getActiveProviderConfig().model = modelId;
    saveState();
    return true;
}

/**
 * removeManualWebGPUModel — quita del catálogo un modelo añadido a mano.
 * También borra sus ficheros de la caché del navegador y, si era el modelo
 * activo, devuelve la selección a un modelo verificado del catálogo.
 */
async function removeManualWebGPUModel(modelId) {
    const current = getWebGPUCustomModels();
    const def = current.find(m => m.id === modelId);
    if (!def) return false;
    if (!confirm(trf('dlg.webgpu.removeCustom', '¿Quitar «{p0}» de tus modelos añadidos manualmente?\n\nSe eliminará del catálogo y se borrarán sus archivos de la caché del navegador. No afecta al repositorio original en Hugging Face.', { p0: def.label || modelId }))) {
        return false;
    }

    saveWebGPUCustomModels(current.filter(m => m.id !== modelId));

    // Si estaba cargado en memoria, liberarlo
    if (webgpuState.loadedModelId === modelId || webgpuWorker.loadedModelId === modelId) {
        try { await releaseWebGPUMemory(); } catch (e) {}
    }
    // Borrar sus ficheros cacheados (sin preguntar otra vez)
    try {
        const cache = await caches.open('transformers-cache');
        for (const req of await cache.keys()) {
            if (decodeURIComponent(req.url).includes(modelId)) await cache.delete(req);
        }
        invalidateWebGPUCacheScan();
        webgpuState.cachedModelIds = await getCachedWebGPUModels({ force: true });
    } catch (e) { console.warn('[WebGPU] no se pudo limpiar la caché del modelo manual:', e); }

    // Si era el modelo seleccionado, volver a uno verificado
    if (state.settings.model === modelId) {
        const fallback = WEBGPU_MODELS.find(m => m.verified && !m.visionAssist) || WEBGPU_MODELS[0];
        if (fallback) {
            state.settings.model = fallback.id;
            getActiveProviderConfig().model = fallback.id;
        }
    }
    if (state.settings.webgpuVisionModel === modelId) state.settings.webgpuVisionModel = '';
    // Quitar también de favoritos para no dejar huérfanos
    const favKey = favoriteModelKey(modelId, 'webgpu');
    state.settings.favoriteModels = (state.settings.favoriteModels || []).filter(k => k !== favKey);

    saveState();
    await checkProviderStatus();
    updateStatusMeta();
    return true;
}
window.removeManualWebGPUModel = removeManualWebGPUModel;

/**
 * updateVisionIndicator — muestra el icono 👁 en la caja de prompt cuando el
 * motor activo puede analizar imágenes, con un tooltip que nombra el modelo
 * de visión (y, en WebGPU, la cadena visión → chat).
 */
function updateVisionIndicator() {
    const el = document.getElementById('visionIndicator');
    if (!el) return;
    const provType = getProviderDef(state.settings.provider).type;
    let active = false, tip = '';

    if (provType === 'webgpu' && typeof getVisionAssistDef === 'function') {
        const chatDef = WEBGPU_MODELS.find(m => m.id === state.settings.model);
        const chainOn = state.settings.visionChainEnabled !== false;
        const chatLabel = chatDef?.label || state.settings.model;
        if (chatDef?.omnimodal) {
            active = true;
            tip = `Visión omnimodal activa · ${chatLabel} recibe la imagen y responde directamente.`;
        } else if (chainOn) {
            active = true;
            const assist = getVisionAssistDef();
            tip = `Cadena visual activa · ${assist.label} analiza tus imágenes → ${chatLabel} responde.`;
        } else {
            active = false; // cadena desactivada y modelo no omnimodal → sin visión
        }
    } else if (state.capabilities.includes('vision') || getModelFunctionKeys({ name: state.settings.model }).includes('vision')) {
        active = true;
        tip = 'Visión nativa activa: este modelo entiende las imágenes que adjuntes.';
    }

    el.classList.toggle('hidden', !active);
    el.classList.toggle('active', active);
    if (active) el.title = tip;
}
window.updateVisionIndicator = updateVisionIndicator;

function renderProviderExploreLinks() {
    const links = getProviderExploreLinks();
    if (links.length === 0) return '';
    return `<div class="model-cards-provider-links">
        ${links.map(link => `<a href="${link.url}" target="_blank" rel="noopener noreferrer" class="model-explore-link">${escapeHtml(link.label)}</a>`).join('')}
    </div>`;
}

function renderModelFunctionFilters(models) {
    if (!dom.modelFunctionFilters) return;
    const availableKeys = new Set();
    models.forEach(model => getModelFunctionKeys(model).forEach(key => availableKeys.add(key)));
    state.modelFeatureFilters = state.modelFeatureFilters.filter(key => availableKeys.has(key));

    if (availableKeys.size === 0) {
        dom.modelFunctionFilters.innerHTML = '';
        return;
    }

    const isWebGPU = state.settings.provider === 'webgpu';
    const hasFavorites = models.some(m => isFavoriteModel(m.name));
    const hasVerified = isWebGPU && models.some(m => m.verified);

    // Toggles especiales siempre delante: favoritos y (en WebGPU) probados
    const specialToggles = [
        hasFavorites ? `<button type="button" class="filter-pill filter-pill-star ${state.modelShowFavoritesOnly ? 'active' : ''}" data-filter-key="__fav" title="Mostrar solo tus favoritos">⭐ Favoritos</button>` : '',
        hasVerified ? `<button type="button" class="filter-pill filter-pill-verified ${state.modelShowVerifiedOnly ? 'active' : ''}" data-filter-key="__verified" title="Mostrar solo modelos probados y verificados">✅ Probados</button>` : '',
    ].filter(Boolean).join('');

    const buttons = MODEL_FILTER_ORDER
        .filter(key => availableKeys.has(key))
        .map(key => {
            const def = MODEL_FUNCTION_DEFS[key];
            const active = state.modelFeatureFilters.includes(key) ? 'active' : '';
            return `<button type="button" class="filter-pill ${active}" data-filter-key="${key}" title="Filtrar por ${escapeHtml(def.shortLabel)}">${escapeHtml(def.shortLabel)}</button>`;
        })
        .join('');

    const anyActive = state.modelFeatureFilters.length || state.modelShowFavoritesOnly || state.modelShowVerifiedOnly;
    const clearBtn = anyActive
        ? `<button type="button" class="filter-pill filter-pill-clear" data-filter-key="__clear">✕ Limpiar</button>`
        : '';

    dom.modelFunctionFilters.innerHTML = specialToggles + buttons + clearBtn;
}

/**
 * renderModelCard — tarjeta unitaria de modelo con estrella de favorito y
 * badge de estado claro (probado / cargado / en caché). Compartida por la
 * sección de favoritos y por los grupos del catálogo.
 */
function renderModelCard(m, { isWebGPU }) {
    const currentSelection = state.settings.model;
    // Los modelos de visión no son modelos de chat: su "activo" es ser el
    // asistente visual elegido, no el modelo seleccionado para conversar.
    const isVisionAssist = !!m.visionAssist;
    const isActive = isVisionAssist
        ? getVisionAssistDef().id === m.name
        : m.name === currentSelection;
    const isFav = isFavoriteModel(m.name);
    const disabled = m.selectable === false;
    const tags = getModelTags(m);
    // Sin `onclick` inline: el id del modelo lo elige el usuario (pega un repo de
    // Hugging Face), así que interpolarlo dentro de una cadena JS era frágil.
    // La acción viaja en data-model-action y la resuelve el listener de la tarjeta.
    const star = `<button class="model-card-star ${isFav ? 'on' : ''}" data-model-action="favorite" title="${isFav ? 'Quitar de favoritos' : 'Marcar como favorito'}">${isFav ? '★' : '☆'}</button>`;
    // Los modelos añadidos a mano se pueden quitar del catálogo
    const removeBtn = m.custom
        ? `<button class="model-card-remove" data-model-action="remove" title="Quitar este modelo añadido manualmente">🗑️</button>`
        : '';
    const repoLink = m.repoUrl ? `<a href="${escapeHtml(m.repoUrl)}" target="_blank" rel="noopener noreferrer" class="model-card-link" title="Abrir ficha del modelo">Ver ficha</a>` : '';

    // Badge de estado (prioridad: en uso como asistente > cargado > caché > probado)
    let statusBadge = '';
    if (isWebGPU) {
        const isLoaded = webgpuState.loadedModelId === m.name;
        const isCached = webgpuState.cachedModelIds && webgpuState.cachedModelIds.has(m.name);
        if (isVisionAssist && isActive) statusBadge = '<span class="model-status-badge loaded" title="Es el asistente visual que describe tus imágenes adjuntas">👁 En uso</span>';
        else if (isLoaded) statusBadge = '<span class="model-status-badge loaded" title="Modelo cargado en memoria">● Cargado</span>';
        else if (isCached) statusBadge = `<span class="model-status-badge cached" title="Guardado en la caché del navegador">💾 En caché <button class="model-card-delete-cache-btn" data-model-action="delete-cache" title="Borrar de la caché">🗑️</button></span>`;
        else {
            const st = getWebGPUModelStatus(m);
            const cls = { 'ok-here': 'verified', verified: 'verified', 'failed-here': 'broken', broken: 'broken', untested: 'untested' }[st.kind];
            statusBadge = `<span class="model-status-badge ${cls}" title="${escapeHtml(st.title)}">${escapeHtml(st.label)}</span>`;
        }
    } else if (isActive) {
        statusBadge = '<span class="model-status-badge loaded">✓ Activo</span>';
    }

    const price = !isWebGPU ? getModelPrice(m) : null;
    const sizeStr = formatModelSizeGB(m);

    return `<div class="model-card ${isActive ? 'model-card-active' : ''} ${disabled ? 'model-card-disabled' : ''}" data-model="${escapeHtml(m.name)}" data-disabled="${disabled ? 'true' : 'false'}" title="${escapeHtml(m.desc || m.name)}">
        <div class="model-card-corner">${removeBtn}${star}</div>
        <div class="model-card-top">
            <span class="model-card-name">${escapeHtml(m.label || m.name)}</span>
        </div>
        <div class="model-card-badges">${statusBadge}${sizeStr ? `<span class="model-card-size-chip">${escapeHtml(String(sizeStr))}</span>` : ''}${price ? `<span class="model-card-size-chip">${escapeHtml(price)}</span>` : ''}</div>
        ${m.desc ? `<div class="model-card-desc">${escapeHtml(m.desc)}</div>` : ''}
        <div class="model-card-tags">${renderModelTagsHtml(tags)}</div>
        ${repoLink ? `<div class="model-card-actions">${repoLink}</div>` : ''}
    </div>`;
}

// ─── Novedades de Hugging Face y modelos que no funcionan ──
// Consulta pública (sin clave) de los repos que declaran compatibilidad con
// Transformers.js. Solo se hace cuando el usuario pulsa «Buscar novedades».
const WEBGPU_DISCOVER_URL = 'https://huggingface.co/api/models?pipeline_tag=text-generation&filter=transformers.js&sort=lastModified&direction=-1&limit=60&full=true';
const webgpuDiscovery = { state: 'idle', items: [], error: '' };

// De la respuesta de HF a lo que se enseña: fuera lo que ya está en el
// catálogo o añadido, lo privado/gated y lo que claramente no es un chat.
function filterDiscoveredWebGPUModels(apiModels) {
    const known = new Set([...WEBGPU_MODELS, ...getWebGPUCustomModels()].map(m => m.id.toLowerCase()));
    const notChat = /tiny-random|-base(-|$)|embedding|rerank|whisper|tts|-mlx$|gguf/i;
    return (Array.isArray(apiModels) ? apiModels : [])
        .filter(m => m && typeof m.id === 'string' && !m.private && !m.gated)
        .filter(m => !known.has(m.id.toLowerCase()) && !notChat.test(m.id))
        .map(m => ({
            id: m.id,
            updated: String(m.lastModified || '').slice(0, 10),
            downloads: Number(m.downloads) || 0,
            broken: getWebGPUBrokenInfo(m.id),
        }))
        .slice(0, 30);
}

async function discoverWebGPUModels() {
    webgpuDiscovery.state = 'loading';
    renderWebGPUCatalogExtras();
    try {
        const res = await fetch(WEBGPU_DISCOVER_URL, { signal: AbortSignal.timeout(12000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        webgpuDiscovery.items = filterDiscoveredWebGPUModels(await res.json());
        webgpuDiscovery.state = 'ready';
    } catch (e) {
        webgpuDiscovery.state = 'error';
        webgpuDiscovery.error = String(e?.message || e);
    }
    renderWebGPUCatalogExtras();
}

// Pinta, bajo las tarjetas, lo encontrado en HF y la lista de «no funcionan».
function renderWebGPUCatalogExtras() {
    const box = document.getElementById('webgpuCatalogExtras');
    if (!box) return;
    const isWebGPU = state.settings.provider === 'webgpu';
    box.classList.toggle('hidden', !isWebGPU);
    if (!isWebGPU) return;

    let html = '';
    if (webgpuDiscovery.state === 'loading') {
        html += `<p class="setting-help-text">${escapeHtml(tr('webgpu.discover.loading', 'Consultando Hugging Face…'))}</p>`;
    } else if (webgpuDiscovery.state === 'error') {
        html += `<p class="setting-help-text">${escapeHtml(tr('webgpu.discover.error', 'No se pudo consultar Hugging Face: {msg}').replace('{msg}', webgpuDiscovery.error))}</p>`;
    } else if (webgpuDiscovery.state === 'ready') {
        const rows = webgpuDiscovery.items.map(m => {
            const status = m.broken
                ? `<span class="model-status-badge broken" title="${escapeHtml(m.broken.reason)}">${escapeHtml(tr('webgpu.status.broken', '⛔ No funciona'))}</span>`
                : `<span class="model-status-badge untested">${escapeHtml(tr('webgpu.status.untested', '⚠️ Sin probar'))}</span>`;
            return `<div class="webgpu-extra-row">
                <a href="https://huggingface.co/${escapeHtml(m.id)}" target="_blank" rel="noopener noreferrer" class="webgpu-extra-name">${escapeHtml(m.id)}</a>
                <span class="webgpu-extra-meta">${escapeHtml(m.updated)}</span>
                ${status}
                <button type="button" class="filter-pill" data-webgpu-add="${escapeHtml(m.id)}">${escapeHtml(tr('webgpu.discover.add', 'Añadir'))}</button>
            </div>`;
        }).join('');
        html += `<details class="webgpu-extra-group" open>
            <summary>${escapeHtml(tr('webgpu.discover.title', '🆕 Novedades en Hugging Face ({n})').replace('{n}', webgpuDiscovery.items.length))}</summary>
            <p class="setting-help-text">${escapeHtml(tr('webgpu.discover.help', 'Repos recientes que declaran compatibilidad con Transformers.js y aún no están en tu catálogo. Nadie los ha probado aquí: al usarlos, wIA anotará si funcionan en tu equipo.'))}</p>
            ${rows || `<p class="setting-help-text">${escapeHtml(tr('webgpu.discover.none', 'No hay repos nuevos que no tengas ya.'))}</p>`}
        </details>`;
    }

    if (WEBGPU_BROKEN_MODELS.length) {
        const rows = WEBGPU_BROKEN_MODELS.map(b => `<div class="webgpu-extra-row">
                <a href="https://huggingface.co/${escapeHtml(b.id)}" target="_blank" rel="noopener noreferrer" class="webgpu-extra-name">${escapeHtml(b.id)}</a>
                <span class="webgpu-extra-meta">${escapeHtml([b.tested, b.runtime].filter(Boolean).join(' · '))}</span>
                <span class="webgpu-extra-reason">${escapeHtml(b.reason)}</span>
            </div>`).join('');
        html += `<details class="webgpu-extra-group">
            <summary>${escapeHtml(tr('webgpu.broken.title', '⛔ Probados: no funcionan ({n})').replace('{n}', WEBGPU_BROKEN_MODELS.length))}</summary>
            <p class="setting-help-text">${escapeHtml(tr('webgpu.broken.help', 'Modelos que se han probado y no cargan o no sirven para chatear con el runtime indicado. Se listan para ahorrarte la descarga; una versión nueva del runtime puede arreglarlos.'))}</p>
            ${rows}
        </details>`;
    }
    box.innerHTML = html;
    box.querySelectorAll('[data-webgpu-add]').forEach(btn => btn.addEventListener('click', () => {
        if (!addManualWebGPUModel(btn.dataset.webgpuAdd)) return;
        webgpuDiscovery.items = webgpuDiscovery.items.filter(m => m.id !== btn.dataset.webgpuAdd);
        checkProviderStatus();
    }));
}

function getFunctionalGroup(model) {
    const keys = getModelFunctionKeys(model);
    if (keys.includes('omnimodal')) return { key: 'omnimodal', label: '◉ Omnimodal' };
    if (keys.includes('medical')) return { key: 'medical', label: '⚕ Imagen médica' };
    if (keys.includes('uncensored')) return { key: 'uncensored', label: '🔓 Modelos sin censura' };
    if (keys.includes('vision')) return { key: 'vision', label: '👁 Modelos con visión' };
    if (keys.includes('coding')) return { key: 'coding', label: '💻 Modelos para código' };
    if (keys.includes('thinking')) return { key: 'thinking', label: '🧠 Modelos analíticos' };
    if (keys.includes('multilingual')) return { key: 'multilingual', label: '🌍 Modelos multilingües' };
    return { key: 'general', label: '✨ Modelos generales' };
}

function populateModels(models) {
    const modelCardsContainer = document.getElementById('modelCardsContainer');
    if (!modelCardsContainer) return;

    state.rawModels = Array.isArray(models) ? [...models] : [];
    state.rawModelsProvider = state.settings.provider;
    state.modelCatalogState = 'ready';
    updateSettingsActiveContext();

    if (!models || models.length === 0) {
        modelCardsContainer.innerHTML = `<div class="model-cards-empty">No hay modelos disponibles</div>`;
        if (dom.modelFunctionFilters) dom.modelFunctionFilters.innerHTML = '';
        // Also reset the hidden select
        dom.modelSelect.innerHTML = `<option value="">No hay modelos</option>`;
        return;
    }

    const isWebGPU = state.settings.provider === 'webgpu';
    renderModelFunctionFilters(state.rawModels);

    const searchTerm = (document.getElementById('modelSearchInput')?.value || '').toLowerCase().trim();
    const activeFilters = new Set(state.modelFeatureFilters);

    let filtered = models.filter(model => {
        const nameLower = (model.name || '').toLowerCase();
        const labelLower = (model.label || '').toLowerCase();
        const descLower = (model.desc || '').toLowerCase();
        if (searchTerm && !nameLower.includes(searchTerm) && !labelLower.includes(searchTerm) && !descLower.includes(searchTerm)) return false;

        const keys = getModelFunctionKeys(model);
        if (activeFilters.size > 0 && !Array.from(activeFilters).every(key => keys.includes(key))) return false;
        if (state.modelShowFavoritesOnly && !isFavoriteModel(model.name)) return false;
        if (state.modelShowVerifiedOnly && !model.verified) return false;
        return true;
    });

    if (filtered.length === 0) {
        const msg = state.modelShowFavoritesOnly ? 'Aún no tienes modelos favoritos. Marca la ⭐ de un modelo para añadirlo.' : 'Ningún modelo coincide con los filtros';
        modelCardsContainer.innerHTML = `<div class="model-cards-empty">${msg}</div>`;
        return;
    }

    const linksHeader = renderProviderExploreLinks();

    // Sección de favoritos (siempre arriba, sin colapsar), salvo si ya estás
    // filtrando solo por favoritos (sería redundante).
    const favModels = filtered.filter(m => isFavoriteModel(m.name));
    let favHtml = '';
    if (favModels.length > 0 && !state.modelShowFavoritesOnly) {
        favHtml = `<div class="model-favorites-section">
            <div class="model-section-header">⭐ Tus favoritos <span class="model-tier-count">${favModels.length}</span></div>
            <div class="model-cards-grid">${favModels.map(m => renderModelCard(m, { isWebGPU })).join('')}</div>
        </div>`;
    }

    if (isWebGPU) {
        const tiers = [
            { key: 'quick',    label: '⚡ Ligeros y rápidos', color: 'tier-quick' },
            { key: 'optional', label: '📦 Equilibrados y capaces', color: 'tier-optional' },
            { key: 'large',    label: '🏋️ Grandes y exigentes', color: 'tier-large' },
            { key: 'omnimodal', label: '◉ Omnimodal (ve y responde directamente)', color: 'tier-omnimodal' },
            { key: 'medical', label: '⚕ Imagen médica (análisis local orientativo)', color: 'tier-medical' },
            { key: 'vision',   label: '👁 Asistentes visuales (describen u obtienen texto)', color: 'tier-vision' },
            { key: 'uncensored', label: '🔓 Sin censura (menos rechazos)', color: 'tier-uncensored' },
            { key: 'manual',   label: '🧩 Añadidos manualmente', color: 'tier-manual' },
        ];

        let html = (linksHeader ? `<div class="model-cards-webgpu-header">${linksHeader}</div>` : '') + favHtml;

        tiers.forEach(tier => {
            const tierModels = filtered.filter(m => m.tier === tier.key);
            if (tierModels.length === 0) return;
            const isOpen = tier.key === 'quick' || tier.key === 'optional' || tier.key === 'omnimodal' || tier.key === 'medical' || tier.key === 'uncensored' || tier.key === 'manual';
            html += `<details class="model-tier-group ${tier.color}" ${isOpen ? 'open' : ''}>
                <summary class="model-tier-header">${tier.label} <span class="model-tier-count">${tierModels.length}</span></summary>
                <div class="model-cards-grid">${tierModels.map(m => renderModelCard(m, { isWebGPU })).join('')}</div>
            </details>`;
        });

        modelCardsContainer.innerHTML = html;
    } else {
        const groups = {};
        filtered.forEach(m => {
            const group = getFunctionalGroup(m);
            if (!groups[group.key]) groups[group.key] = { label: group.label, models: [] };
            groups[group.key].models.push(m);
        });

        let html = (linksHeader || '') + favHtml;
        ['omnimodal', 'medical', 'uncensored', 'vision', 'coding', 'thinking', 'multilingual', 'general'].forEach(groupKey => {
            if (!groups[groupKey] || groups[groupKey].models.length === 0) return;
            const groupModels = groups[groupKey].models.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            html += `<details class="model-letter-group" open>
                <summary class="model-letter-header">${groups[groupKey].label} <span class="model-tier-count">${groupModels.length}</span></summary>
                <div class="model-cards-grid">${groupModels.map(m => renderModelCard(m, { isWebGPU })).join('')}</div>
            </details>`;
        });

        modelCardsContainer.innerHTML = html;
    }

    // ── Bind card click events ───────────────────
    modelCardsContainer.querySelectorAll('.model-card').forEach(card => {
        card.addEventListener('click', (event) => {
            const modelId = card.dataset.model;
            if (!modelId) return;

            // Acciones de los botones internos (estrella, borrar caché, quitar
            // manual). Van antes que la selección de modelo y la cancelan.
            const action = event.target.closest('[data-model-action]')?.dataset.modelAction;
            if (action) {
                event.stopPropagation();
                if (action === 'favorite') toggleFavoriteModel(modelId);
                else if (action === 'remove') removeManualWebGPUModel(modelId);
                else if (action === 'delete-cache') deleteWebGPUModelCache(modelId);
                return;
            }

            if (card.dataset.disabled === 'true') {
                notify(trf('dlg.webgpu.notEnabled', 'Este modelo ya está identificado y catalogado, pero todavía no está habilitado para el chat WebGPU actual.'), 'info');
                return;
            }

            // Los modelos de visión no se "conversan": al elegirlos se fijan
            // como asistente visual (describen las imágenes que adjuntes) y no
            // tocan el modelo de chat seleccionado.
            const visionDef = WEBGPU_MODELS.find(m => m.id === modelId && m.visionAssist);
            if (visionDef) {
                const yaActivo = getVisionAssistDef().id === modelId;
                state.settings.webgpuVisionModel = yaActivo ? '' : modelId;
                // Si cambia el asistente, descartar el pipeline visual previo
                webgpuState.imageAssistPipeline = null;
                webgpuState.imageAssistModelId = null;
                saveState();
                if (state.rawModels) populateModels(state.rawModels);
                return;
            }

            // Update hidden select value (used by saveSettings)
            dom.modelSelect.value = modelId;
            // Also store in state immediately for UI feedback
            state.settings.model = modelId;
            getActiveProviderConfig().model = modelId;
            fetchModelCapabilities(modelId);
            saveState();

            // Precarga en 2º plano SOLO si el modelo ya está en caché del
            // navegador: cargarlo a VRAM es casi instantáneo y deja el envío
            // listo. Si no está cacheado, no se descarga aquí (evita bajar
            // cientos de MB por un simple clic); se hará al empezar a escribir.
            if (webgpuState.cachedModelIds?.has(modelId) && typeof warmUpActiveWebGPUModel === 'function') {
                warmUpActiveWebGPUModel();
            }

            // Re-render to update active card
            if (state.rawModels) populateModels(state.rawModels);

            updateInputDisclaimer();
            updateStatusMeta();
            updateModelContextIndicator();
        });
    });

    // Sync hidden select against the full list so filters do not silently change the saved model
    const currentSelection = state.settings.model;
    dom.modelSelect.innerHTML = state.rawModels.map(m =>
        `<option value="${escapeHtml(m.name)}" ${m.name === currentSelection ? 'selected' : ''}>${escapeHtml(m.label || m.name)}</option>`
    ).join('');
    if (state.rawModels.some(m => m.name === currentSelection)) {
        dom.modelSelect.value = currentSelection;
    } else {
        // Nunca caer en un modelo de visión: no sirven como modelo de chat
        const firstSelectable = state.rawModels.find(m => m.selectable !== false && !m.visionAssist) || state.rawModels[0];
        if (firstSelectable) dom.modelSelect.value = firstSelectable.name;
    }

    renderWebGPUCatalogExtras();

    // Model manager button visibility
    const prov = getProviderDef(state.settings.provider);
    if (dom.manageModelsBtn) {
        dom.manageModelsBtn.style.display = (prov.type === 'ollama') ? 'inline-block' : 'none';
    }
}

// ─── Model Management Logic ──────────────────
async function openModelManager() {
    dom.modelManagerModal.classList.remove('hidden');
    bindManagedModelListActions();
    renderManagedModelList();
}

// Delegación en el contenedor (se enlaza una sola vez): el nombre del modelo lo
// devuelve el servidor Ollama, así que no debe acabar dentro de una cadena JS.
let _managedListBound = false;
function bindManagedModelListActions() {
    if (_managedListBound || !dom.managedModelList) return;
    _managedListBound = true;
    dom.managedModelList.addEventListener('click', (event) => {
        const name = event.target.closest('[data-delete-model]')?.dataset.deleteModel;
        if (name) deleteModel(name);
    });
}

async function renderManagedModelList() {
    const prov = getProviderDef(state.settings.provider);
    if (prov.type !== 'ollama') return;

    dom.managedModelList.innerHTML = '<p style="text-align: center; color: var(--text-tertiary); padding: 20px;">Cargando modelos locales...</p>';

    try {
        const headers = getAuthHeaders();
        const res = await fetch(`${state.settings.ollamaUrl}/api/tags`, { headers, signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error('Error al conectar con Ollama');
        const data = await res.json();
        const models = data.models || [];

        if (models.length === 0) {
            dom.managedModelList.innerHTML = '<p style="text-align: center; color: var(--text-tertiary); padding: 20px;">No se encontraron modelos instalados.</p>';
            return;
        }

        dom.managedModelList.innerHTML = models.map(m => {
            const sizeGB = (m.size / (1024 * 1024 * 1024)).toFixed(2);
            return `
                <div class="model-list-item">
                    <div class="model-item-info">
                        <span class="model-item-name">${escapeHtml(m.name)}</span>
                        <span class="model-item-size">${sizeGB} GB — ${escapeHtml(m.details?.parameter_size || 'N/A')}</span>
                    </div>
                    <button class="btn-icon remove-model-btn" data-delete-model="${escapeHtml(m.name)}" title="Eliminar modelo">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            `;
        }).join('');
    } catch (e) {
        const failure = describeConnectionError(e);
        const needsDiagnosis = failure.code === 'network';
        if (needsDiagnosis) configureConnectionHelp(failure);
        
        dom.managedModelList.innerHTML = `
            <div style="text-align: center; color: var(--danger); padding: 20px;">
                <p>${escapeHtml(failure.message)}</p>
                ${needsDiagnosis ? '<button type="button" class="btn-secondary" data-open-modal="corsErrorModal" style="margin-top:10px;">Ver diagnóstico</button>' : ''}
            </div>
        `;
    }
}

async function deleteModel(name) {
    if (!confirm(trf('dlg.ollama.confirmDelete', '¿Estás seguro de que quieres eliminar el modelo "{p0}"? Esta acción liberará espacio en disco pero no se puede deshacer.', { p0: name }))) return;

    try {
        const headers = getAuthHeaders();
        const res = await fetch(`${state.settings.ollamaUrl}/api/delete`, {
            method: 'DELETE',
            headers,
            body: JSON.stringify({ name }),
            signal: AbortSignal.timeout(15000)
        });
        if (!res.ok) throw new Error('Fallo al eliminar el modelo');
        
        renderManagedModelList();
        checkProviderStatus(); // Refresh global catalogue
    } catch (e) {
        notify(trf('dlg.error.generic', 'Error: {p0}', { p0: e.message }), 'error');
    }
}

async function pullModel(name) {
    if (!name.trim()) return;

    dom.pullModelBtn.disabled = true;
    dom.pullProgressContainer.classList.remove('hidden');
    dom.pullStatusText.textContent = 'Iniciando descarga...';
    dom.pullPercentageText.textContent = '0%';
    dom.pullProgressBar.style.width = '0%';

    try {
        const headers = getAuthHeaders();
        const res = await fetch(`${state.settings.ollamaUrl}/api/pull`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ name, stream: true })
        });

        if (!res.ok) throw new Error('Error al iniciar la descarga');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const json = JSON.parse(line);
                    if (json.status) dom.pullStatusText.textContent = json.status;
                    
                    if (json.total && json.completed) {
                        const percent = Math.round((json.completed / json.total) * 100);
                        dom.pullPercentageText.textContent = `${percent}%`;
                        dom.pullProgressBar.style.width = `${percent}%`;
                    }
                } catch (e) {}
            }
        }

        dom.pullStatusText.textContent = '¡Descarga completada!';
        dom.pullProgressBar.style.width = '100%';
        setTimeout(() => {
            dom.pullProgressContainer.classList.add('hidden');
            dom.pullModelBtn.disabled = false;
            dom.pullModelInput.value = '';
            renderManagedModelList();
            checkProviderStatus();
        }, 2000);

    } catch (e) {
        dom.pullStatusText.textContent = `Error: ${e.message}`;
        dom.pullStatusText.style.color = 'var(--danger)';
        dom.pullModelBtn.disabled = false;
    }
}

window.deleteModel = deleteModel;
window.pullModel = pullModel;

/* >>> exports (generado por scripts/gen-modules.mjs: no editar a mano) >>> */
export {
    providerHttpError, parseRetryAfter, FAILOVER_MAX_HOPS, classifyEngineFailure,
    markEngineFailure, markEngineSuccess, getEngineCooldown, getFailoverCandidates,
    withEngineOverride, describeChatFailure, prepareModelPanelForProvider, startProviderOAuth,
    finishProviderOAuth, setConnectionValidationFeedback, detectLocalProviderAvailability,
    checkProviderStatus, recordWebGPUModelReport, getWebGPUCustomModels, addManualWebGPUModel,
    updateVisionIndicator, discoverWebGPUModels, populateModels, openModelManager, pullModel,
};
/* <<< exports <<< */
