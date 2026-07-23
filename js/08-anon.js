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
        _anonRulesPromise = fetch('lib/anonimae-rules.json')
            .then(r => r.ok ? r.json() : null)
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
                    st.valueToPlaceholder.set(String(val).trim().toLowerCase(), ph);
                }
            }
        } catch (e) { console.warn('[Anon] No se pudo descifrar el mapa del chat:', e); }
    }
    anonChatState[chat.id] = st;
    return st;
}

/**
 * anonymizeOutgoingText — sustituye entidades sensibles por placeholders
 * consistentes dentro del chat y persiste el mapa cifrado en el propio chat.
 * Devuelve { text, count }.
 */
async function anonymizeOutgoingText(content, chat) {
    try {
        const rules = await loadAnonRules();
        if (!rules || typeof LocalDetectionEngine === 'undefined') return { text: content, count: 0 };
        const st = await ensureAnonState(chat);
        const engine = new LocalDetectionEngine(filterRulesByEnabledTypes(rules));
        const entities = engine.detect(content);
        if (!entities.length) return { text: content, count: 0 };
        const res = LocalPlaceholderEngine.process(content, entities, st);
        try {
            chat.anonVault = await secretVault.encrypt(JSON.stringify({ counters: st.counters, map: st.placeholderToValue }));
        } catch (e) { console.warn('[Anon] No se pudo cifrar el mapa:', e); }
        return { text: res.anonymizedText, count: entities.length };
    } catch (e) {
        console.warn('[Anon] Error anonimizando; se envía el texto original:', e);
        return { text: content, count: 0 };
    }
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
                if (typeof renderMessages === 'function' && state.activeChatId === chat.id) renderMessages();
            });
        }
        return text;
    }
    let out = text;
    for (const [ph, val] of Object.entries(st.placeholderToValue)) {
        if (out.indexOf(ph) !== -1) out = out.split(ph).join(val);
    }
    return out;
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

(function bindAnonUI() {
    const btn = document.getElementById('anonToggleBtn');
    if (btn) btn.addEventListener('click', () => toggleAnonMode());
    if (dom.anonymizeToggle) {
        dom.anonymizeToggle.addEventListener('change', (e) => toggleAnonMode(e.target.checked));
    }
    bindAnonTypeControls();
    // Precarga las reglas para poder pintar los tipos, y pinta el panel.
    loadAnonRules().then(() => renderAnonTypesPanel());
    // Estado inicial (tras loadState, que corre en init() async; este script se
    // ejecuta antes, así que sincroniza también en el próximo tick).
    updateAnonButtonUI();
    setTimeout(updateAnonButtonUI, 1200);
})();
