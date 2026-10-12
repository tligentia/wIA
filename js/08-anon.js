/* >>> imports (generado por scripts/gen-modules.mjs: no editar a mano) >>> */
// El primer import es el del módulo anterior: así se evalúan en orden (ver scripts/gen-modules.mjs).
import {
    autoResizeTextarea, downloadTextFile, openSettings, updateSendButton,
} from './07-ui.js?v=2610.AT';
import {
    WEBGPU_MODELS, debounce, escapeHtml, getWebGPUBrokenInfo, loadLocalJson, notify, tr,
} from './01-core.js?v=2610.AT';
import {
    dom, getAILocality, getAuthHeaders, getProviderDef, saveState, secretVault, state,
} from './02-state.js?v=2610.AT';
import {
    checkWebGPUSupport, completeWebGPU, webgpuState,
} from './03-webgpu.js?v=2610.AT';
import {
    extractTextFromPDF, formatBytes, getActiveChat, readFileAsText,
} from './05-workspace.js?v=2610.AT';
import {
    renderMessages,
} from './06-chat.js?v=2610.AT';
/* <<< imports <<< */

/* ============================================
   wIA — 08-anon.js
   Anonimización DLP local (motor AnonimAE embebido en lib/)
   --------------------------------------------
   Con el modo 🕶️ activo, los datos sensibles (DNI, email, teléfono,
   IBAN, tarjetas, nombres, expedientes...) se sustituyen por
   placeholders ANTES de enviar el prompt al motor de IA. El mapa
   reversible se guarda por chat, cifrado con la misma bóveda AES-GCM
   de las API keys, y la respuesta se "des-anonimiza" SOLO en pantalla:
   los datos reales nunca salen del navegador.
   (Script clásico: comparte ámbito global con el resto de módulos.)
   ============================================ */

// Reglas de detección (regex + diccionarios), cargadas una sola vez.
let _anonRules = null;
let _anonRulesPromise = null;
function loadAnonRules() {
    if (_anonRules) return Promise.resolve(_anonRules);
    if (!_anonRulesPromise) {
        _anonRulesPromise = loadLocalJson('lib/anonimae-rules.json', { cache: 'default' })
            .then(rules => { _anonRules = rules; return rules; })
            .catch(e => { console.warn('[Anon] No se pudieron cargar las reglas:', e); return null; });
    }
    return _anonRulesPromise;
}

// Estado por chat en memoria: { counters, valueToPlaceholder(Map), placeholderToValue }
const anonChatState = {};
const _anonHydrating = new Set();

async function ensureAnonState(chat) {
    if (!chat) return null;
    if (anonChatState[chat.id]) return anonChatState[chat.id];
    const st = { counters: {}, valueToPlaceholder: new Map(), placeholderToValue: {}, aiTerms: [] };
    if (chat.anonVault && typeof secretVault !== 'undefined') {
        try {
            const dec = await secretVault.decrypt(chat.anonVault);
            if (dec) {
                const d = JSON.parse(dec);
                st.counters = d.counters || {};
                st.placeholderToValue = d.map || {};
                st.aiTerms = Array.isArray(d.aiTerms) ? d.aiTerms : [];
                for (const [ph, val] of Object.entries(st.placeholderToValue)) {
                    st.valueToPlaceholder.set(LocalPlaceholderEngine.keyFor(LocalPlaceholderEngine.categoryOf(ph), val), ph);
                }
            }
        } catch (e) { console.warn('[Anon] No se pudo descifrar el mapa del chat:', e); }
    }
    anonChatState[chat.id] = st;
    return st;
}

// Guarda cifrado en el chat el mapa de marcadores acumulado.
async function persistAnonVault(chat, st) {
    try {
        chat.anonVault = await secretVault.encrypt(JSON.stringify({ counters: st.counters, map: st.placeholderToValue, aiTerms: st.aiTerms || [] }));
    } catch (e) { console.warn('[Anon] No se pudo cifrar el mapa:', e); }
}

/**
 * ensureAnonReady — ¿se puede anonimizar ahora mismo en este chat?
 *
 * Con el modo 🕶️ activo, enviar sin anonimizar es justo lo que el usuario ha
 * pedido que no ocurra. Antes, si las reglas no cargaban, el mensaje salía tal
 * cual y sin aviso. Quien envía llama aquí primero y, si devuelve false, NO
 * envía.
 */
async function ensureAnonReady(chat) {
    try {
        const rules = await loadAnonRules();
        if (!rules || typeof LocalDetectionEngine === 'undefined') {
            // Se permite reintentar: el fallo pudo ser de red y pasajero.
            _anonRulesPromise = null;
            return false;
        }
        if (chat) await ensureAnonState(chat);
        return true;
    } catch (e) {
        console.warn('[Anon] El anonimizador no está disponible:', e);
        return false;
    }
}

/**
 * anonymizeTextSync — sustituye las entidades de `text` usando el estado YA
 * cargado del chat. Síncrona para poder usarse al montar el contexto (system
 * prompt, documentos del proyecto, fragmentos RAG). Lanza si el anonimizador
 * no está listo: quien llama decide, pero nunca recibe el texto sin tratar
 * creyendo que está protegido.
 */
// Construir el motor compila todas las expresiones regulares: se reutiliza
// mientras no cambien las reglas ni los tipos desactivados.
let _anonEngine = null;
let _anonEngineKey = '';
let _anonEngineRules = null;

// ─── Términos propios del usuario ───
// Se anonimizan siempre (sin distinguir mayúsculas ni tildes) y viajan con los ajustes.
const ANON_TERM_TYPES = [
    { id: 'nombre', icon: '🧑', label: 'Persona' },
    { id: 'empresa', icon: '🏢', label: 'Organización' },
    { id: 'direccion', icon: '📍', label: 'Dirección o lugar' },
    { id: 'dato', icon: '🔒', label: 'Otro dato' },
];

function getCustomTerms() {
    const list = Array.isArray(state.settings.customTerms) ? state.settings.customTerms : [];
    const known = ANON_TERM_TYPES.map(t => t.id);
    return list
        .filter(t => t && typeof t.text === 'string' && t.text.trim().length >= 2)
        .map(t => ({ id: t.id, text: t.text.trim(), type: known.includes(t.type) ? t.type : 'dato' }));
}

function termsSignature(terms) {
    return (terms || []).map(t => `${t.type}:${String(t.text).toLowerCase()}`).sort().join('|');
}

// Reglas efectivas: tipos activos + términos propios + los que la IA local ha hallado.
function effectiveRules(extraTerms = []) {
    return { ...filterRulesByEnabledTypes(_anonRules), customTerms: getCustomTerms().concat(extraTerms || []) };
}

function getAnonEngine(extraTerms = []) {
    const key = `${(state.settings.anonDisabledTypes || []).slice().sort().join('|')}#${termsSignature(getCustomTerms().concat(extraTerms || []))}`;
    if (!_anonEngine || _anonEngineKey !== key || _anonEngineRules !== _anonRules) {
        _anonEngine = new LocalDetectionEngine(effectiveRules(extraTerms));
        _anonEngineRules = _anonRules;
        _anonEngineKey = key;
    }
    return _anonEngine;
}

function anonymizeTextSync(text, chat) {
    if (!text) return { text: text || '', count: 0 };
    const st = chat ? anonChatState[chat.id] : null;
    if (!_anonRules || !st || typeof LocalDetectionEngine === 'undefined') {
        throw new Error('anonimizador no preparado');
    }
    const engine = getAnonEngine(st.aiTerms);
    const entities = engine.detect(text);
    if (!entities.length) return { text, count: 0 };
    const res = LocalPlaceholderEngine.process(text, entities, st);
    return { text: res.anonymizedText, count: entities.length };
}

/**
 * anonymizeHistoryText — anonimiza un mensaje YA guardado del historial antes de
 * reenviarlo. Con 🕶️ activo, lo escrito antes de activarlo (o pegado por otra
 * vía, o devuelto por el modelo con datos reales) saldría en claro en cada
 * petición. Es idempotente —los marcadores no se vuelven a detectar— y se
 * memoriza por texto: el mismo mensaje da el mismo resultado mientras no cambien
 * los tipos activos, y así un historial largo no se reanaliza en cada envío.
 * Lanza si el anonimizador no está listo: jamás devuelve texto sin tratar.
 */
function anonymizeHistoryText(text, chat) {
    if (!state.settings.anonymizeOutgoing || !text || typeof text !== 'string') return text;
    const st = chat ? anonChatState[chat.id] : null;
    if (!st) throw new Error('anonimizador no preparado');
    const sig = (state.settings.anonDisabledTypes || []).slice().sort().join('|') + '#' + termsSignature(getCustomTerms().concat(st.aiTerms || []));
    if (!st._histMemo || st._histSig !== sig) { st._histMemo = new Map(); st._histSig = sig; }
    if (st._histMemo.has(text)) return st._histMemo.get(text);
    const before = Object.keys(st.placeholderToValue).length;
    const res = anonymizeTextSync(text, chat);
    if (Object.keys(st.placeholderToValue).length !== before) persistAnonVault(chat, st);
    st._histMemo.set(text, res.text);
    return res.text;
}

/**
 * anonymizeOutgoingText — sustituye entidades sensibles por placeholders
 * consistentes dentro del chat y persiste el mapa cifrado en el propio chat.
 * Devuelve { text, count, ok }. Con `ok: false` el texto NO está anonimizado y
 * no debe enviarse.
 */
async function anonymizeOutgoingText(content, chat) {
    try {
        if (!(await ensureAnonReady(chat))) return { text: content, count: 0, ok: false };
        // Modo IA: el modelo local suma los términos que el sistema interno no reconoce.
        // Si falla o deja de ser local, se sigue SOLO con el interno (nunca bloquea el envío).
        let ai = { used: false, added: 0, note: '' };
        if (state.settings.anonMode === 'ai') {
            try {
                const v = await verifyLocalAI();
                if (v.ok) {
                    const st = anonChatState[chat.id];
                    ai.added = mergeAITerms(st.aiTerms, await aiDetectTerms(content));
                    ai.used = true;
                } else ai.note = v.reason;
            } catch (e) {
                ai.note = e?.message || String(e);
                console.warn('[Anon] La IA local no ha podido revisar el mensaje; se usa el sistema interno:', e);
            }
        }
        const res = anonymizeTextSync(content, chat);
        if (res.count || ai.added) await persistAnonVault(chat, anonChatState[chat.id]);
        return { ...res, ok: true, ai };
    } catch (e) {
        console.warn('[Anon] Error anonimizando:', e);
        return { text: content, count: 0, ok: false };
    }
}

// Restaura los valores reales de un texto con el mapa de un chat ya cargado.
function restoreAnonText(text, chat) {
    const st = chat ? anonChatState[chat.id] : null;
    if (!st || !text) return text;
    return LocalPlaceholderEngine.restore(text, st.placeholderToValue);
}

/**
 * listAnonItems — qué marcadores contiene `text` y qué valor real esconde cada
 * uno, sin repetidos y en orden de aparición. Alimenta el desplegable del
 * mensaje; es solo para pantalla. Devuelve [] si el mapa del chat aún no está
 * descifrado (deanonymizeForDisplay lo hidrata y fuerza el repintado).
 */
function listAnonItems(text, chat) {
    const st = chat ? anonChatState[chat.id] : null;
    if (!st || !text || text.indexOf('[') === -1) return [];
    const seen = new Set();
    const items = [];
    for (const m of text.matchAll(/\[([A-Za-zÁÉÍÓÚÑáéíóúñ]+)_(\d{3,})\]/g)) {
        if (seen.has(m[0])) continue;
        seen.add(m[0]);
        const value = st.placeholderToValue[m[0]];
        if (value !== undefined) items.push({ placeholder: m[0], category: m[1], value });
    }
    return items;
}

/**
 * deanonymizeForDisplay — restaura los valores reales SOLO para mostrar en
 * pantalla. Si el mapa del chat aún no está descifrado, lo hidrata en segundo
 * plano y re-renderiza al terminar.
 */
function deanonymizeForDisplay(text) {
    if (!text || text.indexOf('[') === -1) return text;
    const chat = typeof getActiveChat === 'function' ? getActiveChat() : null;
    if (!chat) return text;
    const st = anonChatState[chat.id];
    if (!st) {
        if (chat.anonVault && !_anonHydrating.has(chat.id)) {
            _anonHydrating.add(chat.id);
            ensureAnonState(chat).then(() => {
                _anonHydrating.delete(chat.id);
                // force: el mapa recién descifrado cambia lo que se MUESTRA sin
                // tocar los datos del mensaje, así que su firma no varía y el
                // render incremental no repintaría nada.
                if (typeof renderMessages === 'function' && state.activeChatId === chat.id) renderMessages({ force: true });
            });
        }
        return text;
    }
    // Tolerante: el modelo puede devolver el marcador en otra caja o escapado.
    return LocalPlaceholderEngine.restore(text, st.placeholderToValue);
}


// ─── Modo IA: detección con el modelo local ──────────────────────────────
// Dos sistemas: «interno» (algorítmico: reglas + diccionarios + términos propios,
// por defecto) e «IA», que además pide al modelo local que señale los nombres y
// datos que el sistema interno no reconoce. El interno SIEMPRE se aplica (la IA
// solo suma), y la IA solo se usa si el motor activo es IA Local VERIFICADO: el
// texto sin anonimizar jamás se envía a un motor que no sea de tu equipo o red.
const ANON_AI_ENGINES = ['ollama', 'openai'];     // HTTP; WebGPU (en el navegador) va aparte con completeWebGPU
const ANON_AI_CHUNK = 2600;                        // caracteres por consulta
const ANON_AI_CHUNK_BROWSER = 1100;                // el modelo del navegador es pequeño: trozos más cortos
const ANON_AI_MAX_CHUNKS = 10;                     // tope por texto (~26 000 caracteres)
const _aiVerify = { key: '', at: 0, ok: false, reason: '' };
let _aiVerifyPending = '';                          // motor+modelo cuya verificación está en curso

function _aiEngineKey() {
    return `${state.settings.provider}|${state.settings.ollamaUrl}|${state.settings.model}`;
}

/** ¿El motor activo es IA Local utilizable para anonimizar? (comprobación síncrona) */
function localAIStatus() {
    const prov = getProviderDef(state.settings.provider);
    if (prov.type === 'webgpu') {
        // Corre en esta pestaña: el texto no sale del equipo. Hace falta un modelo
        // de texto que no conste como roto y un navegador con WebGPU real (en WASM
        // iría demasiado lento para revisar textos).
        const model = String(state.settings.model || '').trim();
        if (!model) return { ok: false, reason: tr('anon.ai.reason.model', 'Selecciona un modelo en el motor local.') };
        const def = WEBGPU_MODELS.find(m => m.id === model);
        if (def?.omnimodal) return { ok: false, reason: tr('anon.ai.reason.webgpuModel', 'Este modelo del navegador es multimodal y no sirve para anonimizar; elige uno de texto.') };
        if (getWebGPUBrokenInfo(model)) return { ok: false, reason: tr('anon.ai.reason.webgpuBroken', 'Este modelo del navegador consta como no funcional en este equipo; elige otro.') };
        if (webgpuState.supported === 'wasm') return { ok: false, reason: tr('anon.ai.reason.webgpuNoGpu', 'Este navegador no tiene WebGPU con aceleración: anonimizar con IA iría demasiado lento. Usa un motor local como Ollama.') };
        return { ok: true, reason: '' };
    }
    if (!ANON_AI_ENGINES.includes(prov.type)) {
        return { ok: false, reason: tr('anon.ai.reason.engine', 'El motor «{name}» no admite anonimizar con IA; hace falta un motor local (Ollama, LM Studio o LocalAI).').replace('{name}', prov.name) };
    }
    const loc = getAILocality();
    if (loc.mode !== 'local') {
        return { ok: false, reason: tr('anon.ai.reason.notLocal', 'El motor activo («{name}») no es IA Local: el texto sin anonimizar saldría de tu equipo. Selecciona un motor local.').replace('{name}', prov.name) };
    }
    if (!String(state.settings.model || '').trim()) {
        return { ok: false, reason: tr('anon.ai.reason.model', 'Selecciona un modelo en el motor local.') };
    }
    return { ok: true, reason: '' };
}

/**
 * verifyLocalAI — comprueba de verdad que el motor local responde (consulta su
 * lista de modelos). El resultado se recuerda un minuto por motor+URL+modelo.
 */
async function verifyLocalAI({ force = false } = {}) {
    const st = localAIStatus();
    if (!st.ok) return st;
    const key = _aiEngineKey();
    if (!force && _aiVerify.key === key && Date.now() - _aiVerify.at < 60000) return { ok: _aiVerify.ok, reason: _aiVerify.reason };
    const prov = getProviderDef(state.settings.provider);
    const base = String(state.settings.ollamaUrl || '').trim().replace(/\/+$/, '');
    let result;
    if (prov.type === 'webgpu') {
        // Sin red que consultar: se comprueba el adaptador. El modelo se carga al
        // primer uso (si ya está en memoria por el chat, se reutiliza).
        const support = await checkWebGPUSupport();
        result = support === 'webgpu' ? { ok: true, reason: '' }
            : { ok: false, reason: tr('anon.ai.reason.webgpuNoGpu', 'Este navegador no tiene WebGPU con aceleración: anonimizar con IA iría demasiado lento. Usa un motor local como Ollama.') };
        Object.assign(_aiVerify, { key, at: Date.now(), ok: result.ok, reason: result.reason });
        return result;
    }
    try {
        const url = prov.type === 'ollama' ? `${base}/api/tags` : `${base}/models`;
        const res = await fetch(url, { headers: getAuthHeaders(), signal: AbortSignal.timeout(5000) });
        result = res.ok ? { ok: true, reason: '' }
            : { ok: false, reason: tr('anon.ai.reason.unreachable', 'El motor local no responde ({detail}).').replace('{detail}', `HTTP ${res.status}`) };
    } catch (e) {
        result = { ok: false, reason: tr('anon.ai.reason.unreachable', 'El motor local no responde ({detail}).').replace('{detail}', e?.name === 'TimeoutError' ? 'timeout' : (e?.message || 'error')) };
    }
    Object.assign(_aiVerify, { key, at: Date.now(), ok: result.ok, reason: result.reason });
    return result;
}

/** ¿Está el modo IA activo AHORA (elegido, motor local y ya verificado)? */
function anonAIActive() {
    return state.settings.anonMode === 'ai' && localAIStatus().ok
        && _aiVerify.ok && _aiVerify.key === _aiEngineKey();
}

// Una consulta no-streaming al motor local; devuelve el texto de la respuesta.
async function _localAIComplete(system, user) {
    const st = localAIStatus();          // última barrera: nada sale si ya no es local
    if (!st.ok) throw new Error(st.reason);
    const prov = getProviderDef(state.settings.provider);
    if (prov.type === 'webgpu') {
        // El modelo del navegador puede tener que descargarse la primera vez: se
        // refleja en la nota de la ventana del anonimizador (si está abierta).
        let shownLoading = false;
        const onProgress = (pct) => {
            shownLoading = true;
            anonTool.aiNote = tr('anon.ai.loadingModel', '⬇ Cargando el modelo del navegador… {pct}%').replace('{pct}', Math.round(pct || 0));
            setAnonAINote();
        };
        try {
            return await completeWebGPU(ANON_AI_SYSTEM_BROWSER, user, { maxTokens: 450, onProgress });
        } finally {
            if (shownLoading) { anonTool.aiNote = ''; setAnonAINote(); }
        }
    }
    const base = String(state.settings.ollamaUrl || '').trim().replace(/\/+$/, '');
    const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
    const signal = AbortSignal.timeout(90000);
    if (prov.type === 'ollama') {
        const res = await fetch(`${base}/api/chat`, {
            method: 'POST', headers, signal,
            body: JSON.stringify({
                model: state.settings.model, stream: false, format: 'json',
                messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
                options: { temperature: 0, num_predict: 900 },
            }),
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return (await res.json()).message?.content || '';
    }
    const res = await fetch(`${base}/chat/completions`, {
        method: 'POST', headers, signal,
        body: JSON.stringify({
            model: state.settings.model, stream: false, temperature: 0, max_tokens: 900,
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()).choices?.[0]?.message?.content || '';
}

const ANON_AI_SYSTEM = 'Eres un detector de datos personales para anonimizar textos. Recibes un texto y devuelves ÚNICAMENTE un objeto JSON '
    + 'con la forma {"items":[{"text":"…","type":"nombre|empresa|direccion|dato"}]}. En "items" van los fragmentos EXACTOS, copiados literalmente '
    + 'del texto, que identifican a personas (nombre y apellidos), organizaciones, direcciones o lugares concretos, o cualquier otro dato '
    + 'personal. No incluyas marcadores como [Nombre_001], ni palabras comunes, ni explicaciones. Si no hay ninguno, {"items":[]}.';

// Variante para modelos pequeños del navegador: más corta, con un ejemplo de la
// forma de la respuesta. Lo que devuelvan igualmente se valida contra el texto.
const ANON_AI_SYSTEM_BROWSER = 'Detecta datos personales en el texto del usuario. Responde SOLO con JSON: '
    + '{"items":[{"text":"…","type":"nombre|empresa|direccion|dato"}]}. '
    + '"text" es el fragmento copiado EXACTAMENTE del texto: nombres de personas, empresas, direcciones, lugares concretos u otros datos personales. '
    + 'Si no hay ninguno: {"items":[]}. Ejemplo de respuesta: {"items":[{"text":"Marta Soler","type":"nombre"},{"text":"Calle Olmo 4","type":"direccion"}]}.';

function _parseAIItems(raw) {
    let data = null;
    const txt = String(raw || '');
    try { data = JSON.parse(txt); } catch (_) {
        const m = txt.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (m) { try { data = JSON.parse(m[0]); } catch (_) { /* respuesta no JSON */ } }
    }
    const list = Array.isArray(data) ? data : (data?.items || data?.terms || data?.entities || []);
    return Array.isArray(list) ? list : [];
}

/**
 * aiDetectTerms — pide al modelo local los fragmentos sensibles de `text` y
 * devuelve [{text, type}] ya validados: copiados literalmente del texto, de
 * tamaño razonable y que no son un marcador. Divide los textos largos.
 */
async function aiDetectTerms(text) {
    const size = getProviderDef(state.settings.provider).type === 'webgpu' ? ANON_AI_CHUNK_BROWSER : ANON_AI_CHUNK;
    const paragraphs = String(text || '').split(/\n{2,}/);
    const chunks = [];
    let cur = '';
    for (const p of paragraphs) {
        if (cur && cur.length + p.length + 2 > size) { chunks.push(cur); cur = ''; }
        cur = cur ? `${cur}\n\n${p}` : p;
        while (cur.length > size * 1.5) { chunks.push(cur.slice(0, size)); cur = cur.slice(size); }
    }
    if (cur.trim()) chunks.push(cur);
    const found = new Map();
    const types = ANON_TERM_TYPES.map(t => t.id);
    for (const chunk of chunks.slice(0, ANON_AI_MAX_CHUNKS)) {
        const items = _parseAIItems(await _localAIComplete(ANON_AI_SYSTEM, chunk));
        const flat = chunk.toLowerCase();
        for (const it of items) {
            const t = String(it?.text || '').trim();
            if (t.length < 2 || t.length > 120 || /^\[[^\]]+_\d+\]$/.test(t)) continue;
            if (!flat.includes(t.toLowerCase())) continue;           // debe estar en el texto
            if (!found.has(t.toLowerCase())) found.set(t.toLowerCase(), { text: t, type: types.includes(it?.type) ? it.type : 'dato' });
        }
    }
    return [...found.values()];
}

/** Suma términos de la IA a una lista sin repetir; devuelve cuántos son nuevos. */
function mergeAITerms(list, found) {
    const have = new Set(list.map(t => t.text.toLowerCase()));
    let added = 0;
    for (const t of found) {
        if (have.has(t.text.toLowerCase())) continue;
        have.add(t.text.toLowerCase());
        list.push({ text: t.text, type: t.type });
        added++;
    }
    return added;
}

// ─── UI: botón 🕶️ en la caja de prompt ──────
function updateAnonButtonUI() {
    const btn = document.getElementById('anonToggleBtn');
    if (btn) {
        const on = !!state.settings.anonymizeOutgoing;
        btn.classList.toggle('anon-active', on);
        btn.title = on
            ? 'Anonimización ACTIVA: DNI, emails, teléfonos, IBAN, nombres… se sustituyen por placeholders antes de enviarse a la IA. Clic para desactivar.'
            : 'Anonimizar datos sensibles antes de enviar a la IA (DLP local). Clic para activar.';
    }
    if (dom.anonymizeToggle) dom.anonymizeToggle.checked = !!state.settings.anonymizeOutgoing;
}

function toggleAnonMode(forceValue) {
    state.settings.anonymizeOutgoing = forceValue !== undefined ? !!forceValue : !state.settings.anonymizeOutgoing;
    saveState();
    updateAnonButtonUI();
    if (state.settings.anonymizeOutgoing) loadAnonRules(); // precarga
}

// ─── Tipos de datos: activar/desactivar por tipo ─────────────
// Iconos por tipo (para la lista del panel de Anonimización).
const ANON_TYPE_ICONS = {
    termino_propio: '📌',
    email: '📧', telefono: '📞', dni: '🪪', iban: '🏦', tarjeta: '💳',
    juridico: '⚖️', codigo_postal: '📮', pasaporte: '🛂', direccion: '📍',
    organizacion: '🏢', fax: '📠', diligencias: '📋', cif: '🏭', nss: '🩺',
    matricula: '🚗', ip: '🌐', mac: '🖧', fecha: '📅', usuario_red: '👤',
    credencial: '🔑', coordenadas: '🗺️', poliza: '📄', nombre: '🧑',
};

// Mapea las claves de diccionario del motor a un id/nombre de tipo toggleable.
const ANON_DICT_TYPES = {
    nombres: { id: 'nombre', name: 'Nombres de persona' },
    apellidos: { id: 'nombre', name: 'Nombres de persona' },
    organizaciones: { id: 'organizacion', name: 'Organizaciones (diccionario)' },
};

// Lista canónica de tipos de datos a partir de las reglas cargadas.
function getAnonEntityTypes() {
    if (!_anonRules) return [];
    const seen = new Set();
    const out = [];
    (_anonRules.entities || []).forEach(e => {
        if (seen.has(e.id)) return;
        seen.add(e.id);
        out.push({ id: e.id, name: e.name });
    });
    for (const [dictKey, meta] of Object.entries(ANON_DICT_TYPES)) {
        if ((_anonRules.dictionaries || {})[dictKey] && !seen.has(meta.id)) {
            seen.add(meta.id);
            out.push({ id: meta.id, name: meta.name });
        }
    }
    return out;
}

function isAnonTypeEnabled(id) {
    const off = Array.isArray(state.settings.anonDisabledTypes) ? state.settings.anonDisabledTypes : [];
    return !off.includes(id);
}

// Devuelve una copia de las reglas con solo los tipos activos (entidades + dicts).
function filterRulesByEnabledTypes(rules) {
    const off = Array.isArray(state.settings.anonDisabledTypes) ? state.settings.anonDisabledTypes : [];
    if (!off.length) return rules;
    const entities = (rules.entities || []).filter(e => !off.includes(e.id));
    const dictionaries = {};
    for (const [dictKey, words] of Object.entries(rules.dictionaries || {})) {
        const typeId = ANON_DICT_TYPES[dictKey]?.id || `dict_${dictKey}`;
        if (!off.includes(typeId)) dictionaries[dictKey] = words;
    }
    return { entities, dictionaries };
}

function setAnonTypeEnabled(id, enabled) {
    let off = Array.isArray(state.settings.anonDisabledTypes) ? [...state.settings.anonDisabledTypes] : [];
    if (enabled) off = off.filter(x => x !== id);
    else if (!off.includes(id)) off.push(id);
    state.settings.anonDisabledTypes = off;
    saveState();
}

// Pinta la lista de tipos en el panel de Anonimización (con estado y bindings).
function renderAnonTypesPanel() {
    if (!dom.anonTypesList) return;
    const types = getAnonEntityTypes();
    if (!types.length) {
        dom.anonTypesList.innerHTML = '<p class="setting-help-text">Cargando tipos de datos…</p>';
        loadAnonRules().then(() => { if (getAnonEntityTypes().length) renderAnonTypesPanel(); });
        return;
    }
    dom.anonTypesList.innerHTML = types.map(t => {
        const on = isAnonTypeEnabled(t.id);
        return `<label class="anon-type-row" title="${escapeHtml(t.name)}">
            <span class="anon-type-icon" aria-hidden="true">${ANON_TYPE_ICONS[t.id] || '🔒'}</span>
            <span class="anon-type-name">${escapeHtml(t.name)}</span>
            <input type="checkbox" class="anon-type-check" data-type-id="${escapeHtml(t.id)}" ${on ? 'checked' : ''}>
        </label>`;
    }).join('');
    dom.anonTypesList.querySelectorAll('.anon-type-check').forEach(cb => {
        cb.addEventListener('change', (e) => {
            setAnonTypeEnabled(e.target.dataset.typeId, e.target.checked);
            updateAnonSelectAllState();
        });
    });
    updateAnonSelectAllState();
    renderCustomTermsPanel();
    renderAnonModeUI();
}

// Actualiza el estado del interruptor "Activar todos" (marcado si todos activos).
function updateAnonSelectAllState() {
    if (!dom.anonSelectAll) return;
    const types = getAnonEntityTypes();
    const allOn = types.length > 0 && types.every(t => isAnonTypeEnabled(t.id));
    dom.anonSelectAll.checked = allOn;
}

function bindAnonTypeControls() {
    if (dom.anonSelectAll) {
        dom.anonSelectAll.addEventListener('change', (e) => {
            const enableAll = e.target.checked;
            state.settings.anonDisabledTypes = enableAll ? [] : getAnonEntityTypes().map(t => t.id);
            saveState();
            renderAnonTypesPanel();
        });
    }
}

// ─── UI: sistema de anonimización (interno / IA) ─────────────────────────
function renderAnonModeUI() {
    const wanted = state.settings.anonMode === 'ai' ? 'ai' : 'internal';
    let st;
    try { st = localAIStatus(); } catch (_) { st = { ok: false, reason: '' }; }
    document.querySelectorAll('[data-anon-mode]').forEach((btn) => {
        const mode = btn.dataset.anonMode;
        btn.classList.toggle('active', mode === wanted);
        btn.setAttribute('aria-pressed', String(mode === wanted));
        if (mode === 'ai') {
            btn.disabled = !st.ok;
            btn.title = st.ok
                ? tr('anon.mode.ai.title', 'Refuerza la detección con tu modelo local. Solo disponible con IA Local verificado.')
                : st.reason;
        }
    });
    let help;
    if (wanted === 'ai') {
        const key = _aiEngineKey();
        const checked = st.ok && _aiVerify.key === key;
        if (anonAIActive()) help = tr('anon.mode.help.ai', 'IA local activa: el modelo revisa el texto además del sistema interno. El texto no sale de tu equipo.');
        else if (!st.ok || (checked && !_aiVerify.ok)) help = tr('anon.mode.help.unavailable', 'IA no disponible ahora: {reason} Se usa el sistema interno.').replace('{reason}', st.ok ? _aiVerify.reason : st.reason);
        else {
            help = tr('anon.mode.verifying', 'Verificando el motor local…');
            // Se cambió de motor o modelo desde la última comprobación: se verifica ahora.
            if (_aiVerifyPending !== key) {
                _aiVerifyPending = key;
                verifyLocalAI().then(renderAnonModeUI).catch(() => {}).finally(() => { _aiVerifyPending = ''; });
            }
        }
    } else {
        help = st.ok
            ? tr('anon.mode.help.internal.canAI', 'Sistema interno (reglas y diccionarios). Puedes reforzarlo con tu modelo local.')
            : tr('anon.mode.help.internal', 'Sistema interno (reglas y diccionarios). La IA se activa solo con un motor IA Local verificado.');
    }
    document.querySelectorAll('.anon-mode-help').forEach((el) => { el.textContent = help; });
}

async function setAnonMode(mode) {
    if (mode === 'ai') {
        const help = document.querySelectorAll('.anon-mode-help');
        help.forEach((el) => { el.textContent = tr('anon.mode.verifying', 'Verificando el motor local…'); });
        const v = await verifyLocalAI({ force: true });
        if (!v.ok) {
            state.settings.anonMode = 'internal';
            saveState();
            renderAnonModeUI();
            if (typeof notify === 'function') notify(v.reason, 'info');
            return;
        }
    }
    state.settings.anonMode = mode === 'ai' ? 'ai' : 'internal';
    saveState();
    renderAnonModeUI();
    if (state.settings.anonMode === 'ai') reviewAnonToolWithAI();
}

// ─── UI: términos propios ────────────────────────────────────────────────
function renderCustomTermsPanel() {
    const list = document.getElementById('anonTermsList');
    if (!list) return;
    const terms = getCustomTerms();
    list.innerHTML = '';
    const clear = document.getElementById('anonTermsClear');
    if (clear) clear.hidden = terms.length === 0;
    if (!terms.length) {
        const li = document.createElement('li');
        li.className = 'anon-terms-empty';
        li.textContent = tr('anon.terms.empty', 'Aún no has añadido ninguno.');
        list.append(li);
        return;
    }
    for (const t of terms) {
        const meta = ANON_TERM_TYPES.find(x => x.id === t.type) || ANON_TERM_TYPES[3];
        const li = document.createElement('li');
        li.className = 'anon-terms-item';
        const icon = document.createElement('span');
        icon.textContent = meta.icon;
        icon.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.className = 'anon-terms-text';
        text.textContent = t.text;
        const kind = document.createElement('span');
        kind.className = 'anon-terms-kind';
        kind.textContent = tr(`anon.terms.type.${meta.id}`, meta.label);
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn-icon anon-terms-del';
        del.dataset.termId = t.id;
        del.title = tr('anon.terms.remove', 'Quitar');
        del.setAttribute('aria-label', `${tr('anon.terms.remove', 'Quitar')}: ${t.text}`);
        del.textContent = '🗑';
        li.append(icon, text, kind, del);
        list.append(li);
    }
}

/** Añade términos (varios separados por salto de línea o «;»). Devuelve cuántos son nuevos. */
function addCustomTerms(raw, type = 'dato') {
    const known = ANON_TERM_TYPES.map(t => t.id);
    const kind = known.includes(type) ? type : 'dato';
    const current = Array.isArray(state.settings.customTerms) ? [...state.settings.customTerms] : [];
    const have = new Set(current.map(t => String(t.text || '').toLowerCase()));
    let added = 0;
    for (const piece of String(raw || '').split(/[\n;]+/)) {
        const text = piece.trim().replace(/\s+/g, ' ');
        if (text.length < 2 || text.length > 120 || have.has(text.toLowerCase())) continue;
        have.add(text.toLowerCase());
        current.push({ id: `t${Date.now().toString(36)}${added}`, text, type: kind });
        added++;
    }
    if (added) {
        state.settings.customTerms = current;
        saveState();
        renderCustomTermsPanel();
    }
    return added;
}

function removeCustomTerm(id) {
    state.settings.customTerms = (state.settings.customTerms || []).filter(t => t.id !== id);
    saveState();
    renderCustomTermsPanel();
}

function bindAnonModeAndTerms() {
    // Conmutador interno / IA (settings y ventana del anonimizador)
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-anon-mode]');
        if (!btn || btn.disabled) return;
        setAnonMode(btn.dataset.anonMode);
    });
    // Panel de términos propios
    document.getElementById('anonTermsAdd')?.addEventListener('click', () => {
        const input = document.getElementById('anonTermsInput');
        const type = document.getElementById('anonTermsType')?.value || 'dato';
        if (addCustomTerms(input.value, type)) input.value = '';
        input.focus();
    });
    document.getElementById('anonTermsList')?.addEventListener('click', (e) => {
        const del = e.target.closest('[data-term-id]');
        if (del) removeCustomTerm(del.dataset.termId);
    });
    document.getElementById('anonTermsClear')?.addEventListener('click', () => {
        if (!getCustomTerms().length) return;
        if (!confirm(tr('anon.terms.clearConfirm', '¿Quitar todos los términos propios?'))) return;
        state.settings.customTerms = [];
        saveState();
        renderCustomTermsPanel();
    });
    // Alta rápida desde la ventana: el texto seleccionado en cualquiera de las dos casillas
    document.getElementById('anonToolAddTerm')?.addEventListener('click', () => {
        const pick = (el) => (el && el.selectionEnd > el.selectionStart) ? el.value.slice(el.selectionStart, el.selectionEnd) : '';
        const selected = pick(document.getElementById('anonToolInput')) || pick(document.getElementById('anonToolOutput'));
        const summary = document.getElementById('anonToolSummary');
        if (!selected.trim()) {
            if (summary) summary.textContent = tr('anon.tool.addTerm.none', 'Selecciona primero el texto en alguna de las dos casillas.');
            return;
        }
        const type = document.getElementById('anonToolTermType')?.value || 'dato';
        const n = addCustomTerms(selected, type);
        anonTool.outputDirty = false;
        anonTool.extraEntities = [];
        anonTool.lastReview = 0;
        renderAnonTool();
        if (!n && summary) summary.textContent = tr('anon.tool.addTerm.exists', 'Ese término ya estaba en tu lista.');
    });
    try { renderCustomTermsPanel(); renderAnonModeUI(); } catch (e) { console.warn('[Anon] No se pudo pintar el panel:', e); }
}



// ─── Anonimizador como herramienta (/anon) ──
// Mismo motor y mismos tipos activos que el chat, pero sin chat: se pega un
// texto y se obtiene la versión con marcadores, o al revés. El mapa de la
// sesión vive SOLO en memoria: no se guarda ni se envía, y se pierde al
// recargar o al pulsar «Nueva sesión».
const anonTool = {
    mode: 'anon',
    openedByLink: false,
    fileName: '',      // archivo cargado en la ventana (para nombrar la descarga)
    outputDirty: false, // el usuario ha editado a mano el resultado: no se pisa al repintar
    aiTerms: [],        // términos hallados por la IA local en la sesión de la ventana
    aiCache: new Map(), // texto → términos, para no repetir la consulta al modelo
    aiNote: '',         // último aviso de la revisión con IA local
    extraEntities: [],  // datos nuevos hallados al revisar lo escrito a mano en el resultado
    lastReview: 0,      // nº de datos anonimizados en la última revisión del resultado editado
    session: { counters: {}, valueToPlaceholder: new Map(), placeholderToValue: {} },
};

// ¿La URL pide abrir el anonimizador? Tres formas equivalentes:
//   …/anon   requiere que el servidor devuelva index.html para esa ruta
//            (server.js, .htaccess y vercel.json lo hacen);
//   …/?anon  y  …/#anon   funcionan en cualquier hosting y con file://.
function isAnonDeepLink(loc = window.location) {
    const path = String(loc.pathname || '');
    const hash = String(loc.hash || '').replace(/^#\/?/, '').toLowerCase();
    let query = false;
    try { query = new URLSearchParams(loc.search || '').has('anon'); } catch (_) {}
    return /\/anon\/?$/i.test(path) || query || hash === 'anon';
}

// URL de la app sin la marca del acceso directo (conserva lo demás).
function urlWithoutAnonLink(loc = window.location) {
    const params = new URLSearchParams(loc.search || '');
    params.delete('anon');
    const query = params.toString();
    const hash = /^#\/?anon$/i.test(loc.hash || '') ? '' : (loc.hash || '');
    return String(loc.pathname || '/').replace(/\/anon\/?$/i, '/') + (query ? `?${query}` : '') + hash;
}

function resetAnonToolSession() {
    anonTool.session = { counters: {}, valueToPlaceholder: new Map(), placeholderToValue: {} };
    anonTool.fileName = '';
    anonTool.outputDirty = false;
    anonTool.extraEntities = [];
    anonTool.lastReview = 0;
    anonTool.aiTerms = [];
}

// Tope de lo que se procesa de una vez: el motor analiza ~100 KB por segundo y
// un fichero enorme dejaría la pestaña bloqueada.
const ANON_FILE_MAX_BYTES = 2 * 1024 * 1024;
const ANON_REPORT_MAX_ROWS = 300;

/** «Informe 2026 (v2).docx» → «Informe_2026_v2»: seguro para nombrar un fichero. */
function anonFileStem(name) {
    return String(name || '')
        .replace(/\.[^.]+$/, '')
        .replace(/[^\w.\-áéíóúñÁÉÍÓÚÑ ]+/g, '')
        .trim()
        .replace(/\s+/g, '_')
        .slice(0, 60);
}

/**
 * renderAnonReport — tabla de lo que se ha anonimizado: tipo, marcador, valor
 * original y nº de veces. Solo se pinta en pantalla; el valor original es lo
 * que el usuario acaba de pegar o cargar en esta misma ventana.
 */
function renderAnonReport(entities) {
    const box = document.getElementById('anonToolReport');
    const body = document.getElementById('anonToolReportBody');
    const more = document.getElementById('anonToolReportMore');
    if (!box || !body) return;
    body.replaceChildren();
    more?.classList.add('hidden');
    const rows = new Map();
    for (const e of entities) {
        const ph = anonTool.session.valueToPlaceholder.get(LocalPlaceholderEngine.keyFor(e.placeholder || 'Entity', e.text));
        if (!ph) continue;
        const row = rows.get(ph) || { ph, id: e.id, name: e.name, value: e.text, n: 0 };
        row.n++;
        rows.set(ph, row);
    }
    box.classList.toggle('hidden', rows.size === 0);
    let shown = 0;
    for (const row of rows.values()) {
        if (shown++ >= ANON_REPORT_MAX_ROWS) break;
        const tr_ = document.createElement('tr');
        const cell = (text, cls) => { const td = document.createElement('td'); if (cls) td.className = cls; td.textContent = text; tr_.append(td); return td; };
        cell(`${ANON_TYPE_ICONS[row.id] || '🔒'} ${row.name}`);
        const ph = document.createElement('td');
        const code = document.createElement('code');
        code.textContent = row.ph;
        ph.append(code);
        tr_.append(ph);
        cell(row.value, 'val');
        cell(String(row.n), 'num');
        body.append(tr_);
    }
    if (more && rows.size > ANON_REPORT_MAX_ROWS) {
        more.textContent = tr('anon.tool.report.more', '… y {n} marcadores más (el resultado los incluye todos).').replace('{n}', rows.size - ANON_REPORT_MAX_ROWS);
        more.classList.remove('hidden');
    }
}

/**
 * loadAnonToolFile — lee un archivo (texto o PDF) en el campo de entrada. Todo
 * ocurre en el navegador. Devuelve un mensaje de error o '' si fue bien.
 */
async function loadAnonToolFile(file) {
    if (!file) return '';
    if (file.size > ANON_FILE_MAX_BYTES) {
        return tr('anon.tool.file.tooBig', 'El archivo pesa {size}: el máximo es {max}.')
            .replace('{size}', formatBytes(file.size)).replace('{max}', formatBytes(ANON_FILE_MAX_BYTES));
    }
    try {
        const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
        const text = isPdf ? await extractTextFromPDF(file) : await readFileAsText(file);
        // extractTextFromPDF devuelve el fallo como texto en vez de lanzarlo.
        if (isPdf && /^(PDF\.js no está cargado|Error extrayendo texto del PDF)/.test(text)) {
            return tr('anon.tool.file.error', 'No se pudo leer el archivo: {error}').replace('{error}', text);
        }
        if (!String(text).trim()) return tr('anon.tool.file.empty', 'El archivo no contiene texto que anonimizar.');
        document.getElementById('anonToolInput').value = text;
        anonTool.fileName = file.name;
        anonTool.outputDirty = false;
        anonTool.extraEntities = [];
        anonTool.lastReview = 0;
        anonTool.aiTerms = [];
        anonTool.aiNote = '';
        return '';
    } catch (e) {
        return tr('anon.tool.file.error', 'No se pudo leer el archivo: {error}').replace('{error}', e?.message || String(e));
    }
}

/**
 * runAnonTool — transforma `input` según el modo. Devuelve { text, entities }.
 * En modo «anon» acumula el mapa de la sesión; en «restore» lo aplica.
 */
function runAnonTool(input, mode = anonTool.mode) {
    if (!input) return { text: '', entities: [] };
    if (mode === 'restore') {
        return { text: LocalPlaceholderEngine.restore(input, anonTool.session.placeholderToValue), entities: [] };
    }
    if (!_anonRules) return { text: '', entities: [], notReady: true };
    const engine = new LocalDetectionEngine(effectiveRules(anonTool.aiTerms));
    const entities = engine.detect(input);
    const res = LocalPlaceholderEngine.process(input, entities, anonTool.session);
    return { text: res.anonymizedText, entities };
}

function renderAnonTool() {
    const input = document.getElementById('anonToolInput');
    const output = document.getElementById('anonToolOutput');
    const summary = document.getElementById('anonToolSummary');
    if (!input || !output) return;
    const restoring = anonTool.mode === 'restore';

    document.getElementById('anonToolModeAnon')?.classList.toggle('active', !restoring);
    document.getElementById('anonToolModeRestore')?.classList.toggle('active', restoring);
    document.getElementById('anonToolModeAnon')?.setAttribute('aria-selected', String(!restoring));
    document.getElementById('anonToolModeRestore')?.setAttribute('aria-selected', String(restoring));
    const inLabel = document.getElementById('anonToolInputLabel');
    const outLabel = document.getElementById('anonToolOutputLabel');
    if (inLabel) {
        const base = restoring ? tr('anon.tool.input.restore', 'Texto con marcadores') : tr('anon.tool.input', 'Texto original');
        inLabel.textContent = anonTool.fileName ? `${base} — ${anonTool.fileName}` : base;
    }
    if (outLabel) outLabel.textContent = restoring ? tr('anon.tool.output.restore', 'Texto restaurado') : tr('anon.tool.output', 'Texto anonimizado');
    input.placeholder = restoring
        ? tr('anon.tool.placeholder.restore', 'Pega aquí la respuesta que contiene marcadores como [Nombre_001]…')
        : tr('anon.tool.placeholder', 'Pega aquí el texto con datos personales…');
    const toChat = document.getElementById('anonToolToChat');
    if (toChat) toChat.hidden = restoring;

    const result = runAnonTool(input.value);
    // Si el usuario ha corregido el resultado a mano, un repintado que no viene
    // de cambiar el original (carga de reglas, cambio de idioma…) no lo pisa.
    if (!anonTool.outputDirty) output.value = result.text;
    const dl = document.getElementById('anonToolDownload');
    if (dl) dl.disabled = !output.value;
    renderAnonReport(restoring ? [] : result.entities.concat(anonTool.extraEntities));
    if (!summary) return;
    summary.replaceChildren();
    const known = Object.keys(anonTool.session.placeholderToValue).length;
    if (result.notReady) {
        summary.textContent = tr('anon.tool.loading', 'Cargando las reglas de detección…');
    } else if (restoring) {
        summary.textContent = known
            ? tr('anon.tool.restore.known', 'Marcadores conocidos en esta sesión: {n}.').replace('{n}', known)
            : tr('anon.tool.restore.empty', 'Aún no hay marcadores en esta sesión: anonimiza primero un texto para poder restaurar su respuesta.');
    } else if (!input.value.trim()) {
        summary.textContent = '';
    } else if (!result.entities.length) {
        summary.textContent = tr('anon.tool.none', 'No se ha detectado ningún dato sensible con los tipos activos.');
    } else {
        const byType = new Map();
        for (const e of result.entities) byType.set(e.id, { name: e.name, n: (byType.get(e.id)?.n || 0) + 1 });
        const head = document.createElement('span');
        head.textContent = tr('anon.tool.found', 'Datos protegidos: {n}').replace('{n}', result.entities.length);
        summary.append(head);
        for (const [id, info] of byType) {
            const chip = document.createElement('span');
            chip.className = 'anon-tool-chip';
            chip.textContent = `${ANON_TYPE_ICONS[id] || '🔒'} ${info.name} · ${info.n}`;
            summary.append(chip);
        }
    }
    if (anonTool.outputDirty) {
        const note = document.createElement('span');
        note.className = 'anon-tool-chip anon-tool-edited';
        note.textContent = tr('anon.tool.edited', '✏️ Resultado editado a mano: se recalcula si cambias el texto original.');
        summary.append(note);
    }
    if (anonTool.lastReview > 0) appendReviewNote(summary);
    if (anonTool.aiNote && state.settings.anonMode === 'ai') setAnonAINote();
}

/** Aviso de que al revisar lo escrito en el resultado se han anonimizado datos nuevos. */
function appendReviewNote(summary) {
    summary.querySelector('.anon-tool-reviewed')?.remove();
    if (anonTool.lastReview <= 0) return;
    const note = document.createElement('span');
    note.className = 'anon-tool-chip anon-tool-reviewed';
    note.textContent = tr('anon.tool.reviewed', '🛡️ Se han anonimizado {n} dato(s) nuevo(s) añadidos al resultado.').replace('{n}', anonTool.lastReview);
    summary.append(note);
}

/**
 * reviewAnonOutput — revisa lo que el usuario ha escrito o pegado EN EL RESULTADO.
 * El resultado ya está anonimizado, pero al editarlo a mano pueden colarse datos
 * reales nuevos (un nombre, un teléfono…). Se pasa el motor de detección sobre
 * el texto: los marcadores existentes no se vuelven a detectar, y lo nuevo recibe
 * marcador con la MISMA sesión, así que es coherente con el resto.
 * Devuelve cuántos datos nuevos se han anonimizado.
 */
function reviewAnonOutput() {
    if (anonTool.mode !== 'anon') return 0;
    const out = document.getElementById('anonToolOutput');
    if (!out || !out.value.trim()) return 0;
    const before = out.value;
    const res = runAnonTool(before, 'anon');
    if (res.notReady || !res.entities.length) return 0;
    // Mantiene el cursor a la misma distancia del final del texto.
    const fromEnd = before.length - (out.selectionEnd ?? before.length);
    out.value = res.text;
    const pos = Math.max(0, res.text.length - fromEnd);
    try { out.setSelectionRange(pos, pos); } catch (_) {}
    anonTool.extraEntities.push(...res.entities);
    anonTool.lastReview += res.entities.length;
    renderAnonReport(runAnonTool(document.getElementById('anonToolInput').value, 'anon').entities.concat(anonTool.extraEntities));
    const summary = document.getElementById('anonToolSummary');
    if (summary) appendReviewNote(summary);
    const dl = document.getElementById('anonToolDownload');
    if (dl) dl.disabled = !out.value;
    return res.entities.length;
}


/**
 * reviewAnonToolWithAI — con el modo IA activo, el modelo local revisa el texto
 * original de la ventana y suma los términos que el sistema interno no conoce.
 * Reutiliza lo ya consultado para el mismo texto (caché) y no pisa lo editado a mano.
 */
async function reviewAnonToolWithAI() {
    if (anonTool.mode !== 'anon' || state.settings.anonMode !== 'ai') return;
    const input = document.getElementById('anonToolInput');
    const text = input?.value || '';
    if (!text.trim()) return;
    const v = await verifyLocalAI();
    renderAnonModeUI();
    if (!v.ok) return;
    let found = anonTool.aiCache.get(text);
    if (!found) {
        anonTool.aiNote = tr('anon.ai.reviewing', '🤖 La IA local está revisando el texto…');
        setAnonAINote();
        try {
            found = await aiDetectTerms(text);
            anonTool.aiCache.set(text, found);
        } catch (e) {
            anonTool.aiNote = tr('anon.ai.failed', '⚠️ La IA local no ha podido revisar el texto; se usa el sistema interno.');
            setAnonAINote();
            console.warn('[Anon] Revisión con IA local fallida:', e);
            return;
        }
    }
    if (input.value !== text) return;                 // el texto cambió mientras tanto
    const added = mergeAITerms(anonTool.aiTerms, found);
    anonTool.aiNote = tr('anon.ai.done', '🤖 IA local: {n} término(s) nuevo(s) añadidos.').replace('{n}', added);
    if (added) {
        if (!anonTool.outputDirty) renderAnonTool();
        else reviewAnonOutput();
    }
    setAnonAINote();
}

function setAnonAINote() {
    const summary = document.getElementById('anonToolSummary');
    if (!summary) return;
    summary.querySelector('.anon-tool-ai')?.remove();
    if (!anonTool.aiNote) return;
    const note = document.createElement('span');
    note.className = 'anon-tool-chip anon-tool-ai';
    note.textContent = anonTool.aiNote;
    summary.append(note);
}

function openAnonTool({ fromLink = false } = {}) {
    const modal = document.getElementById('anonToolModal');
    if (!modal) return false;
    anonTool.openedByLink = anonTool.openedByLink || fromLink;
    modal.classList.remove('hidden');
    renderAnonModeUI();
    renderAnonTool();
    loadAnonRules().then(renderAnonTool);
    document.getElementById('anonToolInput')?.focus();
    return true;
}

function closeAnonTool() {
    document.getElementById('anonToolModal')?.classList.add('hidden');
    // Si se llegó por la URL, se limpia para que recargar no lo reabra.
    if (anonTool.openedByLink && isAnonDeepLink()) {
        try { window.history.replaceState({}, '', urlWithoutAnonLink()); } catch (_) {}
    }
    anonTool.openedByLink = false;
}

function bindAnonTool() {
    const $id = (id) => document.getElementById(id);
    if (!$id('anonToolModal')) return;
    const rerender = debounce(renderAnonTool, 150);
    // Tras una pausa al escribir en el resultado, se revisa si se coló algo sensible.
    const reviewOutputSoon = debounce(reviewAnonOutput, 600);
    // Cambiar el original recalcula el resultado (y descarta lo editado a mano).
    const aiReviewSoon = debounce(reviewAnonToolWithAI, 1200);
    $id('anonToolInput')?.addEventListener('input', () => { anonTool.outputDirty = false; anonTool.extraEntities = []; anonTool.lastReview = 0; anonTool.aiTerms = []; anonTool.aiNote = ''; rerender(); aiReviewSoon(); });
    // El resultado también se puede editar: se conserva hasta que cambie el original.
    $id('anonToolOutput')?.addEventListener('input', () => {
        anonTool.outputDirty = true;
        const dl = $id('anonToolDownload');
        if (dl) dl.disabled = !$id('anonToolOutput').value;
        // Sin reanalizar el original en cada pulsación: solo se avisa de la edición.
        const summary = $id('anonToolSummary');
        if (summary && !summary.querySelector('.anon-tool-edited')) {
            const note = document.createElement('span');
            note.className = 'anon-tool-chip anon-tool-edited';
            note.textContent = tr('anon.tool.edited', '✏️ Resultado editado a mano: se recalcula si cambias el texto original.');
            summary.append(note);
        }
        reviewOutputSoon();
    });
    $id('anonToolOpenBtn')?.addEventListener('click', () => {
        dom.settingsModal?.classList.add('hidden');
        openAnonTool();
    });
    // Icono directo de la caja de mensaje.
    $id('anonToolBtn')?.addEventListener('click', () => openAnonTool());
    $id('anonToolLoadFile')?.addEventListener('click', () => $id('anonToolFile')?.click());
    $id('anonToolFile')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';     // permite volver a cargar el mismo archivo
        if (!file) return;
        const summary = $id('anonToolSummary');
        if (summary) summary.textContent = tr('anon.tool.loading', 'Cargando las reglas de detección…');
        await loadAnonRules();
        const error = await loadAnonToolFile(file);
        renderAnonTool();
        if (!error) reviewAnonToolWithAI();
        if (error && summary) summary.textContent = error;
    });
    $id('anonToolDownload')?.addEventListener('click', async () => {
        await reviewAnonToolWithAI();
        reviewAnonOutput();
        const text = $id('anonToolOutput').value;
        if (!text) return;
        const kind = anonTool.mode === 'restore' ? 'restaurado' : 'anonimizado';
        const stem = anonFileStem(anonTool.fileName);
        downloadTextFile(text, stem ? `${stem}_${kind}.md` : `texto_${kind}_${Date.now()}.md`, 'text/markdown');
    });
    $id('anonToolClose')?.addEventListener('click', closeAnonTool);
    $id('anonToolModal')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeAnonTool(); });
    $id('anonToolModal')?.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAnonTool(); });
    const setMode = (mode) => {
        if (anonTool.mode === mode) return;
        anonTool.mode = mode;
        // Al cambiar de modo el campo se vacía: lo que había era la ENTRADA del
        // otro modo y no tiene sentido como entrada de este.
        $id('anonToolInput').value = '';
        anonTool.fileName = '';
        anonTool.outputDirty = false;
        anonTool.extraEntities = [];
        anonTool.lastReview = 0;
        renderAnonTool();
        $id('anonToolInput').focus();
    };
    $id('anonToolModeAnon')?.addEventListener('click', () => setMode('anon'));
    $id('anonToolModeRestore')?.addEventListener('click', () => setMode('restore'));
    $id('anonToolReset')?.addEventListener('click', () => {
        resetAnonToolSession();
        $id('anonToolInput').value = '';
        renderAnonTool();
    });
    $id('anonToolCopy')?.addEventListener('click', async (e) => {
        await reviewAnonToolWithAI();
        reviewAnonOutput();
        const text = $id('anonToolOutput').value;
        if (!text) return;
        const btn = e.currentTarget;
        const label = btn.textContent;
        try {
            await navigator.clipboard.writeText(text);
            btn.textContent = tr('anon.tool.copied', '✓ Copiado');
        } catch (_) {
            $id('anonToolOutput').select();
            btn.textContent = tr('anon.tool.copyManual', 'Pulsa Ctrl/⌘+C');
        }
        setTimeout(() => { btn.textContent = label; }, 1600);
    });
    $id('anonToolTypes')?.addEventListener('click', () => {
        closeAnonTool();
        if (typeof openSettings === 'function') openSettings('anon');
    });
    $id('anonToolToChat')?.addEventListener('click', async () => {
        // Al chat va la versión ANONIMIZADA (la del panel derecho), nunca el
        // original: los datos reales no llegan ni a la caja de mensaje. Se deja
        // 🕶️ activado por si se escribe algo más antes de enviar; los marcadores
        // ya puestos no se vuelven a detectar.
        await reviewAnonToolWithAI();
        reviewAnonOutput();
        const text = $id('anonToolOutput').value.trim();
        if (!text) return;
        toggleAnonMode(true);
        closeAnonTool();
        // Se añade a continuación de lo que ya hubiera en la caja, en un párrafo
        // aparte, para no perder lo que el usuario estuviera escribiendo.
        const current = dom.messageInput.value.replace(/\s+$/, '');
        dom.messageInput.value = current ? `${current}\n\n${text}` : text;
        if (typeof autoResizeTextarea === 'function') autoResizeTextarea();
        if (typeof updateSendButton === 'function') updateSendButton();
        dom.messageInput.focus();
        const end = dom.messageInput.value.length;
        try { dom.messageInput.setSelectionRange(end, end); } catch (_) {}
        dom.messageInput.scrollTop = dom.messageInput.scrollHeight;
    });
    // Los tipos activos se cambian en Ajustes: al volver, el resultado se recalcula.
    window.addEventListener('hashchange', () => { if (isAnonDeepLink()) openAnonTool({ fromLink: true }); });
    if (isAnonDeepLink()) openAnonTool({ fromLink: true });
}

(function bindAnonUI() {
    const btn = document.getElementById('anonToggleBtn');
    if (btn) btn.addEventListener('click', () => toggleAnonMode());
    if (dom.anonymizeToggle) {
        dom.anonymizeToggle.addEventListener('change', (e) => toggleAnonMode(e.target.checked));
    }
    bindAnonTypeControls();
    bindAnonTool();
    bindAnonModeAndTerms();
    if (state.settings.anonMode === 'ai') {
        // Guardado en modo IA: se verifica el motor en cuanto arranca.
        setTimeout(() => verifyLocalAI().then(renderAnonModeUI).catch(() => {}), 1500);
    }
    // Precarga las reglas para poder pintar los tipos, y pinta el panel.
    loadAnonRules().then(() => renderAnonTypesPanel());
    // Estado inicial (tras loadState, que corre en init() async; este script se
    // ejecuta antes, así que sincroniza también en el próximo tick).
    updateAnonButtonUI();
    setTimeout(updateAnonButtonUI, 1200);
})();

/* >>> exports (generado por scripts/gen-modules.mjs: no editar a mano) >>> */
export {
    loadAnonRules, anonChatState, persistAnonVault, ensureAnonReady, anonymizeTextSync,
    anonymizeHistoryText, anonymizeOutgoingText, restoreAnonText, listAnonItems,
    deanonymizeForDisplay, updateAnonButtonUI, renderAnonTypesPanel, renderAnonModeUI,
};
/* <<< exports <<< */
