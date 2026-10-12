/* >>> imports (generado por scripts/gen-modules.mjs: no editar a mano) >>> */
// El primer import es el del módulo anterior: así se evalúan en orden (ver scripts/gen-modules.mjs).
import {
    autoResizeTextarea, downloadTextFile, openSettings, updateSendButton,
} from './07-ui.js?v=2610.AI';
import {
    debounce, escapeHtml, loadLocalJson, tr,
} from './01-core.js?v=2610.AI';
import {
    dom, saveState, secretVault, state,
} from './02-state.js?v=2610.AI';
import {
    extractTextFromPDF, formatBytes, getActiveChat, readFileAsText,
} from './05-workspace.js?v=2610.AI';
import {
    renderMessages,
} from './06-chat.js?v=2610.AI';
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
    const st = { counters: {}, valueToPlaceholder: new Map(), placeholderToValue: {} };
    if (chat.anonVault && typeof secretVault !== 'undefined') {
        try {
            const dec = await secretVault.decrypt(chat.anonVault);
            if (dec) {
                const d = JSON.parse(dec);
                st.counters = d.counters || {};
                st.placeholderToValue = d.map || {};
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
        chat.anonVault = await secretVault.encrypt(JSON.stringify({ counters: st.counters, map: st.placeholderToValue }));
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
function getAnonEngine() {
    const key = (state.settings.anonDisabledTypes || []).slice().sort().join('|');
    if (!_anonEngine || _anonEngineKey !== key || _anonEngineRules !== _anonRules) {
        _anonEngine = new LocalDetectionEngine(filterRulesByEnabledTypes(_anonRules));
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
    const engine = getAnonEngine();
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
    const sig = (state.settings.anonDisabledTypes || []).slice().sort().join('|');
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
        const res = anonymizeTextSync(content, chat);
        if (res.count) await persistAnonVault(chat, anonChatState[chat.id]);
        return { ...res, ok: true };
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
    const engine = new LocalDetectionEngine(filterRulesByEnabledTypes(_anonRules));
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
    renderAnonReport(restoring ? [] : result.entities);
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
}

function openAnonTool({ fromLink = false } = {}) {
    const modal = document.getElementById('anonToolModal');
    if (!modal) return false;
    anonTool.openedByLink = anonTool.openedByLink || fromLink;
    modal.classList.remove('hidden');
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
    // Cambiar el original recalcula el resultado (y descarta lo editado a mano).
    $id('anonToolInput')?.addEventListener('input', () => { anonTool.outputDirty = false; rerender(); });
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
        if (error && summary) summary.textContent = error;
    });
    $id('anonToolDownload')?.addEventListener('click', () => {
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
    $id('anonToolToChat')?.addEventListener('click', () => {
        // Al chat va la versión ANONIMIZADA (la del panel derecho), nunca el
        // original: los datos reales no llegan ni a la caja de mensaje. Se deja
        // 🕶️ activado por si se escribe algo más antes de enviar; los marcadores
        // ya puestos no se vuelven a detectar.
        const text = $id('anonToolOutput').value.trim();
        if (!text) return;
        toggleAnonMode(true);
        closeAnonTool();
        dom.messageInput.value = text;
        if (typeof autoResizeTextarea === 'function') autoResizeTextarea();
        if (typeof updateSendButton === 'function') updateSendButton();
        dom.messageInput.focus();
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
    deanonymizeForDisplay, updateAnonButtonUI, renderAnonTypesPanel,
};
/* <<< exports <<< */
