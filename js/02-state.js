/* ============================================
   wIA — 02-state.js
   Estado global, referencias DOM, init, helpers de proveedor y persistencia (localStorage + IndexedDB)
   (Scripts clásicos cargados en orden desde index.html;
   comparten el ámbito global igual que el antiguo app.js)
   ============================================ */

// ─── State ──────────────────────────────────
const state = {
    chats: [],
    activeChatId: null,
    isStreaming: false,
    abortController: null,
    attachments: [],
    capabilities: [],
    rawModelsProvider: null,
    modelCatalogState: 'idle',
    providerAvailability: {},
    hasSavedSettings: false,
    modelFeatureFilters: [],
    modelShowFavoritesOnly: false,
    modelShowVerifiedOnly: false,
    orderQueue: [],           // Órdenes pendientes (prompts que empiezan por +)
    isRunningQueue: false,
    projects: [],
    incognitoSessionActive: false,
    activeProjectId: 'general',
    settings: {
        provider: 'ollama',
        ollamaUrl: 'http://localhost:11434',
        model: 'gemma4:e4b',
        apiKey: '',
        theme: 'system',
        temperature: 0.8,
        topP: 0.9,
        topK: 40,
        maxTokens: 8192,
        favoriteModels: [],   // IDs de modelos marcados como favoritos por el usuario
        favoriteProviders: [],// Motores fijados al principio de sus listas
        providerUsageHistory: [], // IDs de motores, del uso más reciente al más antiguo
        modelSuccessHistory: [],  // [{provider, model}] usados con éxito, recientes primero (para fallback rápido)
        webgpuVisionModel: '',// Asistente visual elegido (tier 'vision'); vacío = el por defecto
        visionChainEnabled: true, // Conmutador de la cadena de análisis de imagen (WebGPU)
        systemPrompt: `# System Prompt: Asistente IA Experto

## Rol y Personalidad
Eres un asistente de IA experto, útil y preciso.  
Mantén un tono profesional, objetivo y técnico.

## Idioma
Responde **siempre** en el mismo idioma que el usuario.

## Estilo de Respuesta
- Prioriza la **concisión** y **claridad técnica**.
- Evita explicaciones innecesarias o redundantes.

## Generación de Código
\`\`\`markdown
Cuando generes código:
- Incluye comentarios explicativos que detallen la lógica y propósito de cada bloque.
- Usa bloques de código Markdown con sintaxis apropiada (ej. \`\`\`python).
- Verifica sintaxis antes de entregar.
\`\`\`

## Manejo de Incertidumbre
- Si algo no está claro, **pide aclaración específica** antes de asumir.
- **No inventes** información ni especules sin base verificable.

## Restricciones de Comportamiento
- ❌ **Evita**: Ser condescendiente, complaciente o seguir la corriente sin fundamento.
- ✅ **Mantén**: Objetividad rigurosa y precisión factual.

---
*Última actualización: 10/04/2026*`,
        thinkingMode: true,
        incognitoMode: false,
        privacyLockEnabled: false,
        anonymizeOutgoing: false, // 🕶️ DLP local: anonimizar antes de enviar a la IA
        // Per-provider configs — memorized independently
        providerConfigs: {
            ollama:        { url: 'http://localhost:11434', model: 'gemma4:e4b', apiKey: '', temperature: 0.8, topP: 0.9, topK: 40, maxTokens: 8192 },
            ollama_remote: { url: '', model: 'gemma4:e4b', apiKey: '', temperature: 0.8, topP: 0.9, topK: 40, maxTokens: 8192 },
            ollama_cloud:  { url: 'https://ollama.com', model: 'qwen3-vl:235b-instruct', apiKey: '', temperature: 0.8, topP: 0.9, topK: 40, maxTokens: 8192 },
            lmstudio:      { url: 'http://localhost:1234/v1', model: '', apiKey: '', temperature: 0.8, topP: 0.9, topK: 40, maxTokens: 8192 },
            groq:          { url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', apiKey: '', temperature: 0.8, topP: 0.9, topK: 40, maxTokens: 8192 },
            openrouter:    { url: 'https://openrouter.ai/api/v1', model: 'google/gemma-3-27b-it', apiKey: '', temperature: 0.8, topP: 0.9, topK: 40, maxTokens: 16384 },
            gemini:        { url: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash', apiKey: '', temperature: 0.8, topP: 0.9, topK: 40, maxTokens: 16384 },
            claude:        { url: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-20250514', apiKey: '', temperature: 0.8, topP: 0.9, topK: 40, maxTokens: 16384 },
            openai:        { url: 'https://api.openai.com/v1', model: 'gpt-4.1', apiKey: '', temperature: 0.8, topP: 0.9, topK: 40, maxTokens: 8192 },
            nvidia:        { url: 'https://integrate.api.nvidia.com/v1', model: 'meta/llama-3.3-70b-instruct', apiKey: '', temperature: 0.8, topP: 0.9, topK: 40, maxTokens: 8192 },
            // maxTokens contenido por defecto: los modelos pequeños de navegador
            // tienden a divagar sin emitir fin-de-secuencia, y 4096 tokens de
            // bucle parecen un cuelgue de minutos.
            webgpu:        { url: '', model: 'onnx-community/Llama-3.2-1B-Instruct-ONNX', apiKey: '', temperature: 0.8, topP: 0.9, topK: 40, maxTokens: 1024 },
        },
    },
};

// ─── DOM References ─────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
    sidebar: $('#sidebar'),
    chatList: $('#chatList'),
    modelStatus: $('#modelStatus'),
    welcomeScreen: $('#welcomeScreen'),
    messagesContainer: $('#messagesContainer'),
    messagesScroll: $('#messagesScroll'),
    messageInput: $('#messageInput'),
    sendBtn: $('#sendBtn'),
    stopBtn: $('#stopBtn'),
    searchChats: $('#searchChats'),
    statusDot: $('#statusDot'),
    statusText: $('#statusText'),
    charCount: $('#charCount'),
    settingsModal: $('#settingsModal'),
    deleteModal: $('#deleteModal'),
    moveModal: $('#moveModal'),
    moveProjectSelect: $('#moveProjectSelect'),
    menuBtn: $('#menuBtn'),
    mobileNewChat: $('#mobileNewChat'),
    desktopNewChatToggle: $('#desktopNewChatToggle'),
    sidebarNewChatBtn: $('#sidebarNewChatBtn'),
    // Projects
    projectSelect: $('#projectSelect'),
    projectSettingsBtn: $('#projectSettingsBtn'),
    newProjectBtn: $('#newProjectBtn'),
    projectModal: $('#projectModal'),
    projectName: $('#projectName'),
    projectPrompt: $('#projectPrompt'),
    projectEmoji: $('#projectEmoji'),
    projectDescription: $('#projectDescription'),
    projectProvider: $('#projectProvider'),
    projectModel: $('#projectModel'),
    projectTemperature: $('#projectTemperature'),
    projectStartersEditor: $('#projectStartersEditor'),
    agentsModal: $('#agentsModal'),
    agentsGalleryBtn: $('#agentsGalleryBtn'),
    closeAgentsModal: $('#closeAgentsModal'),
    newAgentBtn: $('#newAgentBtn'),
    importAgentBtn: $('#importAgentBtn'),
    importAgentFile: $('#importAgentFile'),
    attachProjectDocsBtn: $('#attachProjectDocsBtn'),
    projectFileUpload: $('#projectFileUpload'),
    projectDocList: $('#projectDocList'),
    saveProjectBtn: $('#saveProjectBtn'),
    deleteProjectBtn: $('#deleteProjectBtn'),
    closeProjectModal: $('#closeProjectModal'),
    closeProjectModal2: $('#closeProjectModal2'),
    // Toolbar
    attachmentPreview: $('#attachmentPreview'),
    fileUpload: $('#fileUpload'),
    attachBtn: $('#attachBtn'),
    toolInternet: $('#toolInternet'),
    visionIndicator: $('#visionIndicator'),
    toolThinking: $('#toolThinking'),
    // Settings
    providerSelect: $('#providerSelect'),
    providerFavoriteBtn: $('#providerFavoriteBtn'),
    settingsActiveProvider: $('#settingsActiveProvider'),
    settingsActiveModel: $('#settingsActiveModel'),
    settingsActiveAvailability: $('#settingsActiveAvailability'),
    modelContextProvider: $('#modelContextProvider'),
    modelContextModel: $('#modelContextModel'),
    modelContextMeta: $('#modelContextMeta'),
    modelContextCount: $('#modelContextCount'),
    ollamaUrl: $('#ollamaUrl'),
    themeSelect: $('#themeSelect'),
    modelSelect: $('#modelSelect'),
    refreshModels: $('#refreshModels'),
    webgpuManualAdd: $('#webgpuManualAdd'),
    webgpuManualModelInput: $('#webgpuManualModelInput'),
    webgpuAddModelBtn: $('#webgpuAddModelBtn'),
    temperature: $('#temperature'),
    tempValue: $('#tempValue'),
    systemPrompt: $('#systemPrompt'),
    thinkingMode: $('#thinkingMode'),
    incognitoMode: $('#incognitoMode'),
    privacyLockEnabled: $('#privacyLockEnabled'),
    privacyLockPin: $('#privacyLockPin'),
    apiKeyInput: $('#apiKeyInput'),
    apiKeyGroup: $('#apiKeyGroup'),
    apiKeyToggle: $('#apiKeyToggle'),
    providerAuthBadge: $('#providerAuthBadge'),
    validateConnectionBtn: $('#validateConnectionBtn'),
    validateConnectionLabel: $('#validateConnectionLabel'),
    connectionValidationHint: $('#connectionValidationHint'),
    connectionValidationResult: $('#connectionValidationResult'),
    inputDisclaimer: $('#inputDisclaimer'),
    // Generation params
    topP: $('#topP'),
    topPValue: $('#topPValue'),
    topK: $('#topK'),
    topKValue: $('#topKValue'),
    maxTokens: $('#maxTokens'),
    maxTokensValue: $('#maxTokensValue'),
    modelMaxContext: $('#modelMaxContext'),
    // New
    improvePromptBtn: $('#improvePromptBtn'),
    privacyModal: $('#privacyModal'),
    openPrivacy: $('#openPrivacy'),
    closePrivacy: $('#closePrivacy'),
    closePrivacyBtn: $('#closePrivacyBtn'),
    modelFunctionFilters: $('#modelFunctionFilters'),
    exportSettingsBtn: $('#exportSettingsBtn'),
    importSettingsBtn: $('#importSettingsBtn'),
    importSettingsFile: $('#importSettingsFile'),
    exportAllBtn: $('#exportAllBtn'),
    importAllBtn: $('#importAllBtn'),
    importAllFile: $('#importAllFile'),
    downloadDocsPdfBtn: $('#downloadDocsPdfBtn'),
    docsToc: $('#docsToc'),
    docsBody: $('#docsBody'),
    docsVersionTag: $('#docsVersionTag'),
    docsBackTop: $('#docsBackTop'),
    settingsContent: $('#settingsContent'),
    anonymizeToggle: $('#anonymizeToggle'),
    // Model Manager
    manageModelsBtn: $('#manageModelsBtn'),
    modelManagerModal: $('#modelManagerModal'),
    closeModelManager: $('#closeModelManager'),
    closeModelManager2: $('#closeModelManager2'),
    managedModelList: $('#managedModelList'),
    pullModelInput: $('#pullModelInput'),
    pullModelBtn: $('#pullModelBtn'),
    pullProgressContainer: $('#pullProgressContainer'),
    pullStatusText: $('#pullStatusText'),
    pullPercentageText: $('#pullPercentageText'),
    pullProgressBar: $('#pullProgressBar'),
    // CORS Helper
    corsErrorModal: document.getElementById('corsErrorModal'),
    closeCorsModal: document.getElementById('closeCorsModal'),
    retryCorsBtn: document.getElementById('retryCorsBtn'),
    corsWarningBadge: document.getElementById('corsWarningBadge'),
    // Prompt Manager
    promptManagerModal: $('#promptManagerModal'),
    pmCategories: $('#pmCategories'),
    pmContent: $('#pmContent'),
    newPromptBtn: $('#newPromptBtn'),
    closePromptManager: $('#closePromptManager'),
    slashDropdown: $('#slashCommandDropdown'),
    slashDropdownList: $('#slashDropdownList'),
    promptLibraryBtn: $('#promptLibraryBtn'),
    savePromptModal: $('#savePromptModal'),
    savePromptTitle: $('#savePromptTitle'),
    savePromptCategory: $('#savePromptCategory'),
    savePromptContent: $('#savePromptContent'),
    closeSavePrompt: $('#closeSavePrompt'),
    cancelSavePrompt: $('#cancelSavePrompt'),
    confirmSavePrompt: $('#confirmSavePrompt'),
    // Model Slash Command
    modelSlashDropdown: $('#modelSlashDropdown'),
    modelSlashDropdownList: $('#modelSlashDropdownList'),
};

let persistenceAlertOpen = false;

function isQuotaExceededError(error) {
    return error?.name === 'QuotaExceededError' || error?.code === 22 || error?.code === 1014;
}

function showPersistenceAlert(message) {
    if (persistenceAlertOpen) return;
    persistenceAlertOpen = true;
    alert(message);
    persistenceAlertOpen = false;
}

function isIncognitoMode() {
    return !!state.settings.incognitoMode;
}

function isConversationPersistenceDisabled() {
    return !!state.incognitoSessionActive || isIncognitoMode();
}

function buildPersistenceErrorMessage(error) {
    if (isQuotaExceededError(error)) {
        return 'No se pudo guardar en el navegador porque se alcanzó la cuota local. Libera historial/documentos o usa el modo Incógnito.';
    }
    return `No se pudo guardar el estado local: ${error.message}`;
}

// ─── Init ───────────────────────────────────
async function init() {
    // Configure marked once at startup — not on every renderMarkdown call.
    // (El resaltado de sintaxis se aplica en processCodeBlocks: desde marked v5
    // la opción `highlight` de setOptions dejó de existir.)
    // Si el CDN de marked no carga, la app arranca igual: renderMarkdown ya
    // degrada a texto plano escapado.
    if (typeof marked !== 'undefined') {
        marked.setOptions({
            breaks: true,
            gfm: true,
        });
    }

    await loadState();
    // Pide almacenamiento persistente: reduce el riesgo de que el navegador
    // purgue chats/proyectos por presión de espacio (best-effort, silencioso).
    if (navigator.storage?.persist) {
        navigator.storage.persisted().then(p => { if (!p) navigator.storage.persist().catch(() => {}); }).catch(() => {});
    }
    const localDetection = typeof detectLocalProviderAvailability === 'function'
        ? detectLocalProviderAvailability({ selectDefault: !state.hasSavedSettings })
        : Promise.resolve();
    loadPromptLibrary();
    renderProjectSelect();
    renderWelcomeStarters();
    renderChatList();
    if (typeof renderOrderQueue === 'function') renderOrderQueue();
    bindEvents();
    bindSlashCommandEvents();
    await localDetection;
    applySettingsToUI();
    checkProviderStatus().then(result => showConnectionValidationResult?.(result));
    setInterval(() => {
        checkProviderStatus().then(result => showConnectionValidationResult?.(result));
    }, 30000); // 30s is plenty — halved polling overhead
    autoResizeTextarea();

    // Render dynamic version
    const versionEl = document.getElementById('versionTag');
    if (versionEl && window.APP_VERSION) {
        versionEl.textContent = `Vers: ${window.APP_VERSION}`;
    }
}

// ─── Provider Helpers ───────────────────────
function getProviderDef(providerId) {
    return PROVIDERS[providerId] || PROVIDERS.ollama;
}

function getOrderedProviderEntries() {
    const entries = Object.entries(PROVIDERS);
    const validIds = new Set(entries.map(([id]) => id));
    const favorites = (Array.isArray(state.settings.favoriteProviders) ? state.settings.favoriteProviders : [])
        .filter(id => validIds.has(id));
    const history = (Array.isArray(state.settings.providerUsageHistory) ? state.settings.providerUsageHistory : [])
        .filter(id => validIds.has(id));
    const fallbackOrder = [
        'webgpu', 'ollama', 'lmstudio', 'ollama_remote', 'ollama_cloud',
        'groq', 'openrouter', 'gemini', 'claude', 'openai', 'nvidia',
    ];
    const rank = (list, id) => {
        const index = list.indexOf(id);
        return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    };

    return entries.sort(([idA], [idB]) => {
        const favoriteDiff = Number(!favorites.includes(idA)) - Number(!favorites.includes(idB));
        if (favoriteDiff) return favoriteDiff;

        const recentDiff = rank(history, idA) - rank(history, idB);
        if (recentDiff) return recentDiff;

        const favoriteRankDiff = rank(favorites, idA) - rank(favorites, idB);
        if (favoriteRankDiff) return favoriteRankDiff;

        return rank(fallbackOrder, idA) - rank(fallbackOrder, idB);
    });
}

function markProviderUsed(providerId) {
    if (!PROVIDERS[providerId]) return;
    const history = (Array.isArray(state.settings.providerUsageHistory) ? state.settings.providerUsageHistory : [])
        .filter(id => id !== providerId && PROVIDERS[id]);
    state.settings.providerUsageHistory = [providerId, ...history];
}

function renderProviderOptions() {
    if (!dom.providerSelect) return;
    const selectedProvider = state.settings.provider || 'ollama';
    const favorites = Array.isArray(state.settings.favoriteProviders) ? state.settings.favoriteProviders : [];
    dom.providerSelect.innerHTML = getOrderedProviderEntries().map(([id, def]) => {
        const favoriteMark = favorites.includes(id) ? '★ ' : '';
        const availability = state.providerAvailability[id];
        const availabilityMark = availability?.status === 'available'
            ? ` · ✓ ${availability.detail || 'Disponible'}`
            : (availability?.status === 'checking' ? ' · comprobando…' : '');
        return `<option value="${id}">${favoriteMark}${def.icon} ${escapeHtml(def.name)}${escapeHtml(availabilityMark)}</option>`;
    }).join('');
    dom.providerSelect.value = selectedProvider;

    if (dom.providerFavoriteBtn) {
        const isFavorite = favorites.includes(selectedProvider);
        const providerName = getProviderDef(selectedProvider).name;
        dom.providerFavoriteBtn.classList.toggle('active', isFavorite);
        dom.providerFavoriteBtn.setAttribute('aria-pressed', String(isFavorite));
        dom.providerFavoriteBtn.setAttribute('aria-label', `${isFavorite ? 'Quitar' : 'Añadir'} ${providerName} ${isFavorite ? 'de' : 'a'} favoritos`);
        dom.providerFavoriteBtn.title = isFavorite
            ? `Quitar ${providerName} de favoritos`
            : `Marcar ${providerName} como favorito`;
    }
}

function getActiveProviderConfig() {
    const providerId = state.settings.provider;
    const def = getProviderDef(providerId);
    let pc = state.settings.providerConfigs[providerId];
    
    if (!pc) {
        // Create new config with defaults if it doesn't exist
        pc = { 
            url: def.defaultUrl, 
            model: def.defaultModel, 
            apiKey: '',
            temperature: 0.8,
            topP: 0.9,
            topK: 40,
            maxTokens: 4096
        };
        state.settings.providerConfigs[providerId] = pc;
    } else {
        // Fallback to defaults if missing
        if (!pc.url && def.defaultUrl) pc.url = def.defaultUrl;
        if (!pc.model && def.defaultModel) pc.model = def.defaultModel;
        if (pc.temperature === undefined) pc.temperature = 0.8;
        if (pc.topP === undefined) pc.topP = 0.9;
        if (pc.topK === undefined) pc.topK = 40;
        if (pc.maxTokens === undefined) pc.maxTokens = 4096;
    }
    return pc;
}

function getAuthHeaders() {
    const prov = getProviderDef(state.settings.provider);
    const apiKey = state.settings.apiKey;
    const headers = { 'Content-Type': 'application/json' };
    
    if (prov.type === 'anthropic' && apiKey) {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
        headers['anthropic-dangerous-direct-browser-access'] = 'true';
    } else if ((prov.auth === 'apikey' || prov.auth === 'optional_bearer') && apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }
    
    // OpenRouter requires extra headers
    if (state.settings.provider === 'openrouter') {
        const origin = window.location.origin && window.location.origin !== 'null' ? window.location.origin : 'https://wia-local.tligent.com';
        headers['HTTP-Referer'] = origin;
        headers['X-Title'] = 'wIA Chat';
    }
    
    return headers;
}

function syncProviderToState() {
    const pc = getActiveProviderConfig();
    const def = getProviderDef(state.settings.provider);
    
    state.settings.ollamaUrl = pc.url || def.defaultUrl;
    state.settings.model = pc.model || def.defaultModel;
    state.settings.apiKey = pc.apiKey || '';
    state.settings.temperature = pc.temperature !== undefined ? pc.temperature : 0.8;
    state.settings.topP = pc.topP !== undefined ? pc.topP : 0.9;
    state.settings.topK = pc.topK !== undefined ? pc.topK : 40;
    state.settings.maxTokens = pc.maxTokens !== undefined ? pc.maxTokens : 4096;
}

function saveCurrentProviderConfig() {
    const provider = state.settings.provider;
    if (!state.settings.providerConfigs[provider]) {
        state.settings.providerConfigs[provider] = {};
    }
    const pc = state.settings.providerConfigs[provider];
    pc.url = state.settings.ollamaUrl;
    pc.model = state.settings.model;
    pc.apiKey = state.settings.apiKey || '';
    pc.temperature = state.settings.temperature;
    pc.topP = state.settings.topP;
    pc.topK = state.settings.topK;
    pc.maxTokens = state.settings.maxTokens;
}

function updateProviderUI() {
    const prov = getProviderDef(state.settings.provider);
    const isWebGPU = state.settings.provider === 'webgpu';
    const badge = dom.providerAuthBadge;
    
    // Auth badge
    if (badge) {
        badge.className = 'provider-auth-badge';
        if (isWebGPU) {
            badge.className += ' auth-none';
            badge.innerHTML = '🧠 Inferencia 100% local en GPU/CPU del navegador · Zero-server';
        } else if (prov.auth === 'none') {
            badge.className += ' auth-none';
            badge.innerHTML = '🔓 Sin autenticación requerida';
        } else if (prov.auth === 'apikey') {
            badge.className += ' auth-apikey';
            badge.innerHTML = '🔑 Requiere API Key';
        } else if (prov.auth === 'optional_bearer') {
            badge.className += ' auth-bearer';
            badge.innerHTML = '🔐 Bearer Token opcional';
        }
    }
    
    // Show/hide API key group
    if (dom.apiKeyGroup) {
        dom.apiKeyGroup.style.display = (prov.auth === 'apikey' || prov.auth === 'optional_bearer') ? 'block' : 'none';
    }
    if (dom.apiKeyInput) {
        dom.apiKeyInput.value = state.settings.apiKey || '';
    }

    // Show/hide server URL (hidden for WebGPU)
    const urlGroup = dom.ollamaUrl?.closest('.setting-group');
    if (urlGroup) urlGroup.style.display = isWebGPU ? 'none' : '';
    
    // Show/hide WebGPU info panel
    const webgpuInfo = document.getElementById('webgpuInfoPanel');
    if (webgpuInfo) webgpuInfo.style.display = isWebGPU ? 'block' : 'none';
    if (dom.webgpuManualAdd) dom.webgpuManualAdd.style.display = isWebGPU ? 'flex' : 'none';
    if (isWebGPU && typeof startWebGPUMonitor === 'function') startWebGPUMonitor();
    else if (typeof _webgpuMonitorTimer !== 'undefined' && _webgpuMonitorTimer) { clearInterval(_webgpuMonitorTimer); _webgpuMonitorTimer = null; }

    // URL Placeholder and behavior
    if (dom.ollamaUrl) {
        if (state.settings.provider === 'ollama') {
            dom.ollamaUrl.placeholder = 'http://localhost:11434';
        } else if (state.settings.provider === 'ollama_remote') {
            dom.ollamaUrl.placeholder = 'https://dominio-remoto.com';
        } else {
            dom.ollamaUrl.placeholder = prov.defaultUrl || 'http://...';
        }
    }
    // Dynamic text/title for refresh button
    if (dom.refreshModels) {
        if (isWebGPU) {
            dom.refreshModels.textContent = '🔄 Escanear caché';
            dom.refreshModels.title = 'Buscar modelos WebGPU descargados en la caché del navegador';
        } else {
            dom.refreshModels.textContent = '🔄 Actualizar';
            dom.refreshModels.title = 'Recargar la lista de modelos desde el servidor remoto';
        }
    }

    // A single validation action covers credentials, URLs and local WebGPU.
    if (dom.validateConnectionLabel) {
        dom.validateConnectionLabel.textContent = isWebGPU
            ? 'Comprobar WebGPU'
            : (prov.auth === 'apikey' ? 'Validar API Key' : 'Validar conexión');
    }
    if (dom.connectionValidationHint) {
        if (isWebGPU) {
            dom.connectionValidationHint.textContent = 'Comprueba WebGPU/WASM y vuelve a escanear los modelos disponibles en el navegador.';
        } else if (prov.auth === 'apikey') {
            dom.connectionValidationHint.textContent = 'Valida la credencial y actualiza el catálogo de modelos de este proveedor.';
        } else if (prov.auth === 'optional_bearer') {
            dom.connectionValidationHint.textContent = 'Comprueba la URL y, si lo has indicado, también el Bearer Token.';
        } else {
            dom.connectionValidationHint.textContent = 'Comprueba la URL del servidor y actualiza sus modelos disponibles.';
        }
    }
    
    updateInputDisclaimer();
}

function updateInputDisclaimer() {
    if (!dom.inputDisclaimer) return;
    const prov = getProviderDef(state.settings.provider);
    const provName = prov.name;
    
    if (state.settings.provider === 'webgpu') {
        const modelDef = WEBGPU_MODELS.find(m => m.id === state.settings.model);
        const label = modelDef ? modelDef.label : state.settings.model;
        const loaded = webgpuState.loadedModelId === state.settings.model;
        dom.inputDisclaimer.textContent = loaded 
            ? `🧠 ${label} cargado en GPU/CPU · Vision asistida local disponible · Privacidad total`
            : `🧠 ${label} · Vision asistida local · Primer uso descarga el modelo`;
    } else if (prov.auth === 'none' && prov.type === 'ollama') {
        dom.inputDisclaimer.textContent = `Modelo local vía ${provName} · Privacidad total`;
    } else if (prov.auth === 'none') {
        dom.inputDisclaimer.textContent = `Conectando vía ${provName} · Privacidad local`;
    } else {
        dom.inputDisclaimer.textContent = `Conectando vía ${provName} · Datos enviados a ${prov.name}`;
    }

    if (isConversationPersistenceDisabled()) {
        dom.inputDisclaimer.textContent += ' · Modo incógnito activo';
    }
}

// ─── Persistence ────────────────────────────
// Chats, proyectos y documentos viven en IndexedDB (cuota de GBs, apto para
// imágenes/documentos en base64). Los ajustes siguen en localStorage por ser
// pequeños y necesitarse de forma síncrona. Se migra automáticamente desde el
// antiguo almacenamiento en localStorage (~5 MB de cuota) la primera vez.
const idbStore = {
    _dbPromise: null,
    open() {
        if (!this._dbPromise) {
            this._dbPromise = new Promise((resolve, reject) => {
                const req = indexedDB.open('wia-db', 1);
                req.onupgradeneeded = () => req.result.createObjectStore('kv');
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }
        return this._dbPromise;
    },
    async get(key) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const req = db.transaction('kv', 'readonly').objectStore('kv').get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    async set(key, value) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('kv', 'readwrite');
            tx.objectStore('kv').put(value, key);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    },
    async del(key) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('kv', 'readwrite');
            tx.objectStore('kv').delete(key);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    }
};

// ─── Bóveda de secretos ──────────────────────
// Las API keys NO se guardan en texto plano. Se cifran con AES-GCM usando una
// clave que se genera una vez y vive en IndexedDB como CryptoKey NO exportable:
// su material nunca sale del subsistema criptográfico del navegador (ni por
// consola ni por un backup de localStorage). En localStorage solo queda el
// texto cifrado. Sin WebCrypto (contexto no seguro) se degrada a texto plano.
const secretVault = {
    _keyPromise: null,
    available() {
        return typeof crypto !== 'undefined' && !!crypto.subtle;
    },
    async _getKey() {
        if (!this._keyPromise) {
            this._keyPromise = (async () => {
                let key = null;
                try { key = await idbStore.get('wia-secret-key'); } catch (_) {}
                if (!key) {
                    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
                    await idbStore.set('wia-secret-key', key);
                }
                return key;
            })();
        }
        return this._keyPromise;
    },
    async encrypt(plaintext) {
        if (!plaintext) return '';
        if (!this.available()) return plaintext; // sin subtle: se guarda tal cual
        try {
            const key = await this._getKey();
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
            const combined = new Uint8Array(iv.length + ct.byteLength);
            combined.set(iv, 0);
            combined.set(new Uint8Array(ct), iv.length);
            return 'enc:v1:' + btoa(String.fromCharCode(...combined));
        } catch (e) {
            console.warn('No se pudo cifrar un secreto:', e);
            return plaintext;
        }
    },
    async decrypt(payload) {
        if (!payload || typeof payload !== 'string') return '';
        if (!payload.startsWith('enc:v1:')) return payload; // texto plano heredado
        if (!this.available()) return '';
        try {
            const key = await this._getKey();
            const combined = Uint8Array.from(atob(payload.slice(7)), c => c.charCodeAt(0));
            const iv = combined.slice(0, 12);
            const ct = combined.slice(12);
            const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
            return new TextDecoder().decode(pt);
        } catch (e) {
            console.warn('No se pudo descifrar un secreto:', e);
            return '';
        }
    }
};

// Todos los sitios donde vive una API key dentro de state.settings.
function forEachSecretSlot(settings, fn) {
    if (!settings) return;
    if ('apiKey' in settings) fn(settings, 'apiKey');
    const pcs = settings.providerConfigs || {};
    for (const prov of Object.keys(pcs)) {
        if (pcs[prov] && 'apiKey' in pcs[prov]) fn(pcs[prov], prov);
    }
}

// Copia de settings con las API keys en blanco (lo que va a localStorage).
function settingsWithoutSecrets(settings) {
    const clone = JSON.parse(JSON.stringify(settings));
    forEachSecretSlot(clone, (obj) => { obj.apiKey = ''; });
    return clone;
}

// Persiste las keys cifradas en IndexedDB (coalescido, fire-and-forget).
let _pendingSecretSave = null;
function scheduleSecretPersist() {
    if (_pendingSecretSave) return;
    _pendingSecretSave = setTimeout(async () => {
        _pendingSecretSave = null;
        try {
            const secrets = {};
            forEachSecretSlot(state.settings, (obj, slot) => { secrets[slot] = obj.apiKey || ''; });
            for (const slot of Object.keys(secrets)) {
                secrets[slot] = await secretVault.encrypt(secrets[slot]);
            }
            await idbStore.set('wia-secrets', secrets);
        } catch (e) {
            console.warn('No se pudieron guardar las claves cifradas:', e);
        }
    }, 200);
}

// Restaura las keys descifradas desde IndexedDB a state.settings.
async function hydrateSecrets() {
    let secrets = null;
    try { secrets = await idbStore.get('wia-secrets'); } catch (_) {}
    if (!secrets) {
        // Sin bóveda aún: si venimos de localStorage con keys en claro (legado),
        // se migran cifrándolas en la próxima escritura.
        forEachSecretSlot(state.settings, (obj) => { if (obj.apiKey) scheduleSecretPersist(); });
        return;
    }
    const top = state.settings;
    if (secrets.apiKey !== undefined && 'apiKey' in top) top.apiKey = await secretVault.decrypt(secrets.apiKey);
    const pcs = top.providerConfigs || {};
    for (const prov of Object.keys(pcs)) {
        if (secrets[prov] !== undefined && pcs[prov]) pcs[prov].apiKey = await secretVault.decrypt(secrets[prov]);
    }
}

async function loadState() {
    try {
        // 1º IndexedDB; si no hay datos, migra desde localStorage
        let projects = null;
        let chats = null;
        try {
            projects = await idbStore.get('projects');
            chats = await idbStore.get('chats');
        } catch (e) {
            console.warn('IndexedDB no disponible, usando localStorage:', e);
        }

        let migrated = false;
        if (projects === undefined || projects === null) {
            const savedProjects = localStorage.getItem('antigravity_projects');
            if (savedProjects) { projects = JSON.parse(savedProjects); migrated = true; }
        }
        if (chats === undefined || chats === null) {
            const savedChats = localStorage.getItem('antigravity_chats');
            if (savedChats) { chats = JSON.parse(savedChats); migrated = true; }
        }

        state.projects = Array.isArray(projects) && projects.length > 0
            ? projects
            : [{ id: 'general', name: 'General', systemPrompt: '', documents: [] }];

        if (Array.isArray(chats)) {
            state.chats = chats;
            // Migrate orphan chats to 'general'
            state.chats.forEach(c => {
                if (!c.projectId) c.projectId = 'general';
            });
        }

        if (migrated) {
            try {
                await idbStore.set('projects', state.projects);
                await idbStore.set('chats', state.chats);
                // Libera la cuota de localStorage solo tras migrar con éxito
                localStorage.removeItem('antigravity_projects');
                localStorage.removeItem('antigravity_chats');
                console.log('[Persistencia] chats y proyectos migrados a IndexedDB');
            } catch (e) {
                console.warn('No se pudo migrar a IndexedDB, se mantiene localStorage:', e);
            }
        }

        // Restaura la cola de órdenes pendientes (prefijo +) de la sesión previa.
        try {
            const savedQueue = localStorage.getItem('wia_order_queue');
            if (savedQueue) {
                const parsed = JSON.parse(savedQueue);
                if (Array.isArray(parsed)) state.orderQueue = parsed;
            }
        } catch (_) {}

        const settings = localStorage.getItem('antigravity_settings');
        state.hasSavedSettings = !!settings;
        if (settings) {
            const parsed = JSON.parse(settings);
            // Deep merge providerConfigs
            const defaultConfigs = { ...state.settings.providerConfigs };
            state.settings = { ...state.settings, ...parsed };
            if (parsed.providerConfigs) {
                state.settings.providerConfigs = { ...defaultConfigs, ...parsed.providerConfigs };
            }
            if (parsed.activeProjectId) {
                state.activeProjectId = parsed.activeProjectId;
            }
        }
        if (window.SecureGate?.getConfig) {
            state.settings.privacyLockEnabled = !!window.SecureGate.getConfig().enabled;
        }
        state.incognitoSessionActive = !!state.settings.incognitoMode;
        // Migration: IDs de modelos WebGPU muertos, renombrados o gated en Hugging Face
        const webgpuModelMigrations = {
            'onnx-community/Qwen2.5-3B-Instruct': 'onnx-community/Qwen2.5-Coder-3B-Instruct',
            'onnx-community/phi-4-mini-instruct': 'webgpu/Phi-4-mini-instruct-ONNX-GQA',
            'onnx-community/Phi-4-mini-instruct-ONNX-GQA': 'webgpu/Phi-4-mini-instruct-ONNX-GQA',
            // Repos renombrados con sufijo -ONNX (el nombre antiguo redirige, pero
            // la detección de caché y los enlaces del catálogo usan el nuevo)
            'onnx-community/Llama-3.2-1B-Instruct': 'onnx-community/Llama-3.2-1B-Instruct-ONNX',
            'onnx-community/Llama-3.2-3B-Instruct': 'onnx-community/Llama-3.2-3B-Instruct-ONNX',
            // Repos que pasaron a gated (401 sin login): se degradan al R1 1.5B público
            'onnx-community/DeepSeek-R1-Distill-Qwen-7B-ONNX': 'onnx-community/DeepSeek-R1-Distill-Qwen-1.5B-ONNX',
            'onnx-community/DeepSeek-R1-Distill-Llama-8B-ONNX': 'onnx-community/DeepSeek-R1-Distill-Qwen-1.5B-ONNX',
            // Retirados tras probarlos (fallan en Transformers.js 3.8.1): se
            // reubican a un modelo verificado equivalente en tamaño/uso.
            'onnx-community/Qwen2.5-1.5B-Instruct': 'onnx-community/Qwen2.5-Coder-1.5B-Instruct',
            'onnx-community/Qwen2.5-Math-1.5B-Instruct': 'onnx-community/DeepSeek-R1-Distill-Qwen-1.5B-ONNX',
            'onnx-community/Apertus-8B-Instruct-2509-ONNX': 'onnx-community/Llama-3.2-3B-Instruct-ONNX',
            'onnx-community/Qwen2-VL-2B-Instruct': 'onnx-community/Llama-3.2-3B-Instruct-ONNX',
            'onnx-community/Phi-3.5-vision-instruct': 'onnx-community/Llama-3.2-3B-Instruct-ONNX',
        };
        if (webgpuModelMigrations[state.settings.model]) {
            state.settings.model = webgpuModelMigrations[state.settings.model];
        }
        const webgpuCfg = state.settings.providerConfigs?.webgpu;
        if (webgpuCfg && webgpuModelMigrations[webgpuCfg.model]) {
            webgpuCfg.model = webgpuModelMigrations[webgpuCfg.model];
        }
        // Migración: el antiguo default de 4096 tokens dejaba a los modelos
        // pequeños divagando minutos; se rebaja al nuevo default salvo que
        // el usuario lo haya personalizado a otro valor.
        if (webgpuCfg && webgpuCfg.maxTokens === 4096) {
            webgpuCfg.maxTokens = 1024;
        }
        // Migración: el clasificador de heridas pasó de servirse en local
        // (/models/) a Hugging Face (tligent-ia/wound-classifier-onnx).
        if (state.settings.webgpuVisionModel === 'wound-classifier') {
            state.settings.webgpuVisionModel = 'tligent-ia/wound-classifier-onnx';
        }

        // Restaura las API keys descifradas desde la bóveda (IndexedDB) antes de
        // sincronizar el proveedor activo, que copia pc.apiKey a state.settings.
        await hydrateSecrets();

        // Migración: si el localStorage traía claves en texto plano (versiones
        // anteriores al cifrado), reescríbelo ya saneado y cífralas en la bóveda.
        if (state.hasSavedSettings) {
            try {
                localStorage.setItem('antigravity_settings', JSON.stringify(settingsWithoutSecrets(state.settings)));
                scheduleSecretPersist();
            } catch (_) {}
        }

        // Sync active provider config to top-level state
        syncProviderToState();
        
        // Ensure activeProjectId is valid
        if (!state.projects.find(p => p.id === state.activeProjectId)) {
            state.activeProjectId = 'general';
        }
    } catch (e) {
        console.warn('Failed to load saved state:', e);
    }
    applySettingsToUI();
}

let _pendingIdbSave = null;

function saveState(options = {}) {
    try {
        state.settings.activeProjectId = state.activeProjectId;
        saveCurrentProviderConfig();
        if (!isConversationPersistenceDisabled()) {
            // Escritura a IndexedDB coalescida: muchas llamadas consecutivas
            // (p. ej. durante streaming) producen una sola transacción.
            if (!_pendingIdbSave) {
                _pendingIdbSave = setTimeout(() => {
                    _pendingIdbSave = null;
                    persistConversationsToIdb(options);
                }, 150);
            }
        }
        // Las API keys se cifran aparte en IndexedDB; en localStorage van en blanco.
        localStorage.setItem('antigravity_settings', JSON.stringify(settingsWithoutSecrets(state.settings)));
        scheduleSecretPersist();
        persistOrderQueue();
        return true;
    } catch (e) {
        console.warn('Failed to save state:', e);
        if (options.notifyOnError !== false) {
            showPersistenceAlert(buildPersistenceErrorMessage(e));
        }
        return false;
    }
}

// Persiste la cola de órdenes pendientes (prefijo +) entre sesiones. Respeta
// el modo incógnito (no deja rastro). Guarda en localStorage por ser pequeña.
function persistOrderQueue() {
    try {
        if (isConversationPersistenceDisabled()) { localStorage.removeItem('wia_order_queue'); return; }
        localStorage.setItem('wia_order_queue', JSON.stringify(state.orderQueue || []));
    } catch (e) { /* cuota / almacenamiento no disponible */ }
}

async function persistConversationsToIdb(options = {}) {
    try {
        await idbStore.set('projects', state.projects);
        await idbStore.set('chats', state.chats);
        return true;
    } catch (e) {
        console.warn('Failed to persist conversations to IndexedDB:', e);
        if (options.notifyOnError !== false) {
            showPersistenceAlert(buildPersistenceErrorMessage(e));
        }
        return false;
    }
}

/**
 * saveStateNow — versión awaitable para operaciones transaccionales
 * (p. ej. añadir documentos grandes): confirma que la escritura en
 * IndexedDB terminó y devuelve si tuvo éxito.
 */
async function saveStateNow(options = {}) {
    if (!saveState({ ...options, notifyOnError: false })) return false;
    if (isConversationPersistenceDisabled()) return true;
    clearTimeout(_pendingIdbSave);
    _pendingIdbSave = null;
    return persistConversationsToIdb(options);
}

function createDefaultProjects() {
    return [{ id: 'general', name: 'General', systemPrompt: '', documents: [] }];
}

function resetProjectsAndChatsState() {
    state.chats = [];
    state.projects = createDefaultProjects();
    state.activeChatId = null;
    state.activeProjectId = 'general';
    state.attachments = [];
    state.capabilities = [];
    state.modelFeatureFilters = [];
    state.rawModels = [];
}

function applyPostResetUI({ preserveSettings = true } = {}) {
    renderAttachmentPreview();
    renderProjectSelect();
    renderChatList();
    showWelcome();
    dom.messageInput.value = '';
    autoResizeTextarea();
    updateSendButton();
    if (preserveSettings) {
        applySettingsToUI();
        checkProviderStatus();
    }
}

/**
 * debouncedSaveState — identical to saveState but delays 800ms.
 * Used during streaming: avoids a localStorage write per token (~60+ writes/s).
 * Non-critical paths (user action confirmations) still call saveState() directly.
 */
const debouncedSaveState = debounce(saveState, 800);

function formatTokens(n) {
    if (!n) return '--';
    if (n >= 1024 * 1024) return Math.round(n / (1024 * 1024) * 10) / 10 + 'M';
    if (n >= 1000) return (n / 1000) + 'K';
    return n;
}

function getCompactProviderLabel(providerId = state.settings.provider) {
    const map = {
        webgpu: 'WebGPU',
        ollama: 'Ollama',
        ollama_remote: 'Ollama remoto',
        ollama_cloud: 'Ollama cloud',
        lmstudio: 'LM Studio',
        groq: 'Groq',
        openrouter: 'OpenRouter',
        gemini: 'Gemini',
        claude: 'Claude',
        openai: 'OpenAI',
        nvidia: 'Nvidia'
    };
    return map[providerId] || getProviderDef(providerId).name;
}

function getCompactModelLabel(modelId = state.settings.model, providerId = state.settings.provider) {
    if (!modelId) return 'Sin modelo';
    if (providerId === 'webgpu') {
        const modelDef = WEBGPU_MODELS.find(m => m.id === modelId);
        return modelDef?.label || modelId.split('/').pop() || modelId;
    }
    if (modelId.includes('/')) return modelId.split('/').pop();
    return modelId;
}

function updateSettingsActiveContext() {
    const providerId = state.settings.provider;
    const provider = getProviderDef(providerId);
    const fullModel = state.settings.model || 'Sin modelo seleccionado';
    const compactModel = getCompactModelLabel(fullModel, providerId);
    const catalogReady = state.rawModelsProvider === providerId;
    const modelCount = catalogReady && Array.isArray(state.rawModels) ? state.rawModels.length : null;
    const runtimeLabel = providerId === 'webgpu'
        ? 'Ejecución local en el navegador'
        : (state.settings.ollamaUrl || provider.defaultUrl || 'Endpoint pendiente de configurar');

    if (dom.settingsActiveProvider) {
        dom.settingsActiveProvider.textContent = `${provider.icon} ${provider.name}`;
        dom.settingsActiveProvider.title = `Motor activo: ${provider.name}`;
    }
    if (dom.settingsActiveModel) {
        dom.settingsActiveModel.textContent = `◇ ${compactModel}`;
        dom.settingsActiveModel.title = `Modelo activo: ${fullModel}`;
    }
    if (dom.settingsActiveAvailability) {
        const availability = state.providerAvailability[providerId];
        const statusText = availability?.status === 'available'
            ? `✓ ${availability.detail || 'Disponible'}`
            : (availability?.status === 'unavailable'
                ? 'No detectado'
                : (availability?.status === 'error' ? 'Requiere atención' : 'Sin comprobar'));
        dom.settingsActiveAvailability.textContent = statusText;
        dom.settingsActiveAvailability.className = `settings-active-availability is-${availability?.status || 'unknown'}`;
    }
    if (dom.modelContextProvider) dom.modelContextProvider.textContent = `${provider.icon} ${provider.name}`;
    if (dom.modelContextModel) {
        dom.modelContextModel.textContent = compactModel;
        dom.modelContextModel.title = fullModel;
    }
    if (dom.modelContextMeta) dom.modelContextMeta.textContent = runtimeLabel;
    if (dom.modelContextCount) {
        if (state.modelCatalogState === 'loading') dom.modelContextCount.textContent = 'Cargando catálogo…';
        else if (state.modelCatalogState === 'error') dom.modelContextCount.textContent = 'Catálogo no disponible';
        else dom.modelContextCount.textContent = modelCount === null
                ? 'Catálogo pendiente'
                : `${modelCount} ${modelCount === 1 ? 'modelo' : 'modelos'}`;
    }

    const modelHeading = document.getElementById('settingsHeadingModels');
    if (modelHeading) modelHeading.textContent = `Modelos de ${provider.name}`;
}

// ─── Indicador IA Local / Cloud ──────────────
function isPrivateHostname(hostname) {
    if (!hostname) return false;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') return true;
    if (hostname.endsWith('.local') || hostname.endsWith('.lan')) return true;
    // Rangos RFC1918: motores en el equipo o la red privada del usuario
    return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
}

/**
 * getAILocality — clasifica el motor activo como local o cloud según dónde
 * se ejecuta realmente la inferencia: WebGPU siempre es local (navegador);
 * el resto se decide por el host de la URL configurada, no por el nombre
 * del proveedor (un "Ollama Remoto" en 192.168.x.x sigue siendo local).
 */
function getAILocality() {
    const def = getProviderDef(state.settings.provider);
    if (def.type === 'webgpu') {
        return { mode: 'local', label: 'IA Local', detail: 'La inferencia se ejecuta en tu navegador (WebGPU). Nada sale de tu equipo.' };
    }
    const url = state.settings.ollamaUrl || def.defaultUrl || '';
    try {
        const host = new URL(url).hostname;
        if (isPrivateHostname(host)) {
            return { mode: 'local', label: 'IA Local', detail: `Motor en tu equipo o red privada (${host}). Tus consultas no salen a internet.` };
        }
    } catch (e) { /* URL vacía o inválida → se asume cloud */ }
    return { mode: 'cloud', label: 'IA Cloud', detail: `Las consultas se envían a un proveedor externo: ${def.name}.` };
}

function updateAILocalityBadge() {
    const locality = getAILocality();
    document.querySelectorAll('.ai-locality-badge').forEach(badge => {
        badge.textContent = `${locality.mode === 'local' ? '🖥️' : '☁️'} ${locality.label}`;
        badge.classList.toggle('local', locality.mode === 'local');
        badge.classList.toggle('cloud', locality.mode === 'cloud');
        badge.title = locality.detail;
    });
}

function updateStatusMeta() {
    const modelStatus = dom.modelStatus || $('#modelStatus');
    const providerLabel = getCompactProviderLabel();
    const modelLabel = getCompactModelLabel() + (isIncognitoMode() ? ' · Incógnito' : '');
    const providerSpan = $('.status-provider');
    const modelSpan = $('.status-model');
    const statusText = dom.statusText?.textContent || '';

    if (providerSpan) providerSpan.textContent = providerLabel;
    if (modelSpan) modelSpan.textContent = modelLabel;

    if (modelStatus) {
        modelStatus.title = `${getProviderDef(state.settings.provider).name}\nModelo: ${state.settings.model}\nEstado: ${statusText}`;
    }
    if (dom.statusText) dom.statusText.title = statusText;
    if (modelSpan) modelSpan.title = state.settings.model || modelLabel;

    updateSettingsActiveContext();
    updateAILocalityBadge();
}

function updateModelContextIndicator() {
    if (!dom.modelMaxContext) return;
    
    const provId = state.settings.provider;
    const modelId = state.settings.model;
    let contextSize = null;
    
    if (provId === 'webgpu') {
        const m = WEBGPU_MODELS.find(x => x.id === modelId);
        if (m) contextSize = m.context;
    } else if (state.rawModels) {
        const m = state.rawModels.find(x => x.name === modelId || x.id === modelId);
        // For OpenRouter/others, context_length might be available
        if (m) contextSize = m.context_length || m.context;
    }
    
    if (contextSize) {
        dom.modelMaxContext.textContent = `CTX: ${formatTokens(contextSize)}`;
        dom.modelMaxContext.style.display = 'inline-block';
        
        // Adjust maxTokens slider max if contextSize is larger than current range
        if (dom.maxTokens) {
            const currentRangeMax = parseInt(dom.maxTokens.max);
            if (contextSize > currentRangeMax) {
                dom.maxTokens.max = contextSize;
            }
        }
    } else {
        dom.modelMaxContext.style.display = 'none';
    }
}

// ─── Tema visual (incluye "Sistema") ─────────
const _systemThemeMedia = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

/**
 * applyTheme — aplica un tema al documento. El valor 'system' se resuelve
 * según la preferencia clara/oscura del sistema operativo y se actualiza en
 * vivo si el usuario cambia el modo del SO con la app abierta.
 */
function resolveThemeValue(themeSetting) {
    if (themeSetting !== 'system') return themeSetting || 'dark';
    return _systemThemeMedia?.matches ? 'light' : 'dark';
}

function applyTheme(themeSetting) {
    document.documentElement.setAttribute('data-theme', resolveThemeValue(themeSetting));
}

_systemThemeMedia?.addEventListener?.('change', () => {
    if ((state.settings.theme || 'system') === 'system') applyTheme('system');
});

function applySettingsToUI() {
    renderProviderOptions();
    if (typeof updateAnonButtonUI === 'function') updateAnonButtonUI();
    dom.ollamaUrl.value = state.settings.ollamaUrl;
    if (dom.themeSelect) dom.themeSelect.value = state.settings.theme || 'system';
    applyTheme(state.settings.theme || 'system');
    dom.modelSelect.value = state.settings.model;
    dom.temperature.value = state.settings.temperature;
    dom.tempValue.textContent = state.settings.temperature;
    dom.systemPrompt.value = state.settings.systemPrompt;
    dom.thinkingMode.checked = state.settings.thinkingMode;
    if (dom.incognitoMode) dom.incognitoMode.checked = !!state.settings.incognitoMode;
    if (dom.privacyLockEnabled) dom.privacyLockEnabled.checked = !!state.settings.privacyLockEnabled;
    if (dom.privacyLockPin) dom.privacyLockPin.value = '';
    // Generation params
    if (dom.topP) { dom.topP.value = state.settings.topP; dom.topPValue.textContent = state.settings.topP; }
    if (dom.topK) { dom.topK.value = state.settings.topK; dom.topKValue.textContent = state.settings.topK; }
    if (dom.maxTokens) { 
        dom.maxTokens.value = state.settings.maxTokens; 
        dom.maxTokensValue.textContent = state.settings.maxTokens; 
    }
    
    // Update model context indicator
    updateModelContextIndicator();
    
    // Update status model label
    const prov = getProviderDef(state.settings.provider);
    const providerSpan = $('.status-provider');
    if (providerSpan) providerSpan.textContent = getCompactProviderLabel(state.settings.provider);
    $('.status-model').textContent = getCompactModelLabel(state.settings.model, state.settings.provider);
    updateStatusMeta();

    updateProviderUI();
}
