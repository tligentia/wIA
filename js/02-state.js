/* >>> imports (generado por scripts/gen-modules.mjs: no editar a mano) >>> */
// El primer import es el del módulo anterior: así se evalúan en orden (ver scripts/gen-modules.mjs).
import {
    MOBILE_SAFE_WEBGPU_MODEL, PROVIDERS, WEBGPU_MODELS, applyProviderNames,
    buildCustomProviderId, checkApiKeyFormat, debounce, escapeHtml, getDefaultProviderName,
    getProviderAccess, getProviderBaseId, getProviderOAuth, isCloneableProvider,
    isCustomProvider, isHeavyForMobile, isMobileDevice, loadWebGPUCatalogFile,
    registerCustomProviders, tr,
} from './01-core.js?v=2610.AF';
import {
    getCachedWebGPUModels, scheduleWebGPUPriming, startWebGPUMonitor, stopWebGPUMonitor,
    warmUpActiveWebGPUModel, webgpuState,
} from './03-webgpu.js?v=2610.AF';
import {
    checkProviderStatus, detectLocalProviderAvailability, finishProviderOAuth,
} from './04-providers.js?v=2610.AF';
import {
    renderAttachmentPreview, renderChatList, renderOrderQueue, renderProjectSelect,
    renderWelcomeStarters, showWelcome,
} from './05-workspace.js?v=2610.AF';
import {
    renderMessages,
} from './06-chat.js?v=2610.AF';
import {
    autoResizeTextarea, bindEvents, bindSlashCommandEvents, loadPromptLibrary,
    showConnectionValidationResult, updateSendButton,
} from './07-ui.js?v=2610.AF';
import {
    updateAnonButtonUI,
} from './08-anon.js?v=2610.AF';
import {
    bindLangSwitch, loadTranslations, refreshLocalizedUI, t,
} from './09-i18n.js?v=2610.AF';
import {
    renderRagIndexStatus,
} from './11-rag.js?v=2610.AF';
/* <<< imports <<< */

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
        language: 'auto',   // 'auto' (detecta navegador) | 'es' | 'en'
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
        ragEnabled: true,     // Buscar fragmentos relevantes en los documentos del proyecto
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
        autoFailover: false,      // 🔁 Si el motor falla o agota su cupo antes de contestar, prueba otro de su mismo tipo (local/cloud)
        anonDisabledTypes: [],    // IDs de tipos de datos que NO se anonimizan (resto: activos)
        // Motores clonados por el usuario: [{ id, name, icon, baseProvider }].
        // Su URL, credencial y modelo viven en providerConfigs como los de serie.
        customProviders: [],
        // Nombres personalizados de los motores de serie: id → rótulo. Solo
        // guarda los que difieren del de fábrica, para que renombrar sea
        // reversible y los cambios del catálogo lleguen a quien no lo tocó.
        providerNames: {},
        // Per-provider configs — memorized independently
        providerConfigs: {
            ollama:        { url: 'http://localhost:11434', model: 'gemma4:e4b', apiKey: '', temperature: 0.8, topP: 0.9, topK: 40, maxTokens: 8192 },
            ollama_remote: { url: '', model: 'gemma4:e4b', apiKey: '', temperature: 0.8, topP: 0.9, topK: 40, maxTokens: 8192 },
            ollama_cloud:  { url: 'https://ollama.com', model: 'qwen3-vl:235b-instruct', apiKey: '', temperature: 0.8, topP: 0.9, topK: 40, maxTokens: 8192 },
            lmstudio:      { url: 'http://localhost:1234/v1', model: '', apiKey: '', temperature: 0.8, topP: 0.9, topK: 40, maxTokens: 8192 },
            localai:       { url: 'http://localhost:8080/v1', model: '', apiKey: '', temperature: 0.8, topP: 0.9, topK: 40, maxTokens: 8192 },
            groq:          { url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', apiKey: '', temperature: 0.8, topP: 0.9, topK: 40, maxTokens: 8192 },
            openrouter:    { url: 'https://openrouter.ai/api/v1', model: 'google/gemma-3-27b-it', apiKey: '', temperature: 0.8, topP: 0.9, topK: 40, maxTokens: 16384 },
            gemini:        { url: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash', apiKey: '', temperature: 0.8, topP: 0.9, topK: 40, maxTokens: 16384 },
            claude:        { url: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5', apiKey: '', temperature: 0.8, topP: 0.9, topK: 40, maxTokens: 16384 },
            openai:        { url: 'https://api.openai.com/v1', model: 'gpt-4.1', apiKey: '', temperature: 0.8, topP: 0.9, topK: 40, maxTokens: 8192 },
            chatgpt_local: { url: 'http://127.0.0.1:10531/v1', model: '', apiKey: '', temperature: 0.8, topP: 0.9, topK: 40, maxTokens: 8192 },
            freellmapi:    { url: 'http://localhost:31415/v1', model: 'auto', apiKey: '', temperature: 0.8, topP: 0.9, topK: 40, maxTokens: 8192 },
            nvidia:        { url: 'https://integrate.api.nvidia.com/v1', model: 'meta/llama-3.3-70b-instruct', apiKey: '', temperature: 0.8, topP: 0.9, topK: 40, maxTokens: 8192 },
            mistral:       { url: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', apiKey: '', temperature: 0.8, topP: 0.9, topK: 40, maxTokens: 8192 },
            cerebras:      { url: 'https://api.cerebras.ai/v1', model: '', apiKey: '', temperature: 0.8, topP: 0.9, topK: 40, maxTokens: 8192 },
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
    projectAnonymize: $('#projectAnonymize'),
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
    providerCloneBtn: $('#providerCloneBtn'),
    providerRenameBtn: $('#providerRenameBtn'),
    providerDeleteBtn: $('#providerDeleteBtn'),
    providerOauth: $('#providerOauth'),
    providerOauthBtn: $('#providerOauthBtn'),
    providerOauthLabel: $('#providerOauthLabel'),
    providerUrlSuggest: $('#providerUrlSuggest'),
    providerUrlSuggestBtn: $('#providerUrlSuggestBtn'),
    engineCopyModal: $('#engineCopyModal'),
    engineCopyTitle: $('#engineCopyTitle'),
    engineCopyMessage: $('#engineCopyMessage'),
    engineCopyNameLabel: $('#engineCopyNameLabel'),
    engineCopyName: $('#engineCopyName'),
    engineCopyConfirm: $('#engineCopyConfirm'),
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
    modelSearchInput: $('#modelSearchInput'),
    refreshModels: $('#refreshModels'),
    webgpuManualAdd: $('#webgpuManualAdd'),
    webgpuManualModelInput: $('#webgpuManualModelInput'),
    webgpuAddModelBtn: $('#webgpuAddModelBtn'),
    webgpuDiscoverBtn: $('#webgpuDiscoverBtn'),
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
    apiKeyAccessNote: $('#apiKeyAccessNote'),
    apiKeyFormatHint: $('#apiKeyFormatHint'),
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
    anonSelectAll: $('#anonSelectAll'),
    anonTypesList: $('#anonTypesList'),
    ragEnabledToggle: $('#ragEnabledToggle'),
    autoFailoverToggle: $('#autoFailoverToggle'),
    ragReindexBtn: $('#ragReindexBtn'),
    ragIndexStatus: $('#ragIndexStatus'),
    languageSelect: $('#languageSelect'),
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

    // El catálogo WebGPU ampliable se lee antes de restaurar el estado: el
    // modelo guardado puede ser uno de los que solo existen en ese fichero.
    if (typeof loadWebGPUCatalogFile === 'function') await loadWebGPUCatalogFile();
    await loadState();
    // Vuelta del proveedor tras autorizar (OAuth PKCE): se canjea el código por
    // la clave ANTES de sondear conexiones, para que el primer chequeo ya la use
    // y el usuario no vea un «falta API Key» que acaba de resolver.
    if (typeof finishProviderOAuth === 'function') await finishProviderOAuth();
    // Marca el dispositivo como móvil para adaptar avisos/estilos (WebGPU pesado).
    if (typeof isMobileDevice === 'function') {
        document.body.classList.toggle('mobile-device', isMobileDevice());
    }
    // Idioma: carga los diccionarios externos (lang/*.json), aplica traducciones
    // y genera la documentación en el idioma activo.
    if (typeof bindLangSwitch === 'function') bindLangSwitch();
    if (typeof loadTranslations === 'function') await loadTranslations();
    if (typeof refreshLocalizedUI === 'function') refreshLocalizedUI();
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
    // Sondeo periódico del motor. Se salta cuando hay una generación en curso o
    // un modelo WebGPU cargándose: checkProviderStatus reescribe la barra de
    // estado ("Verificando…") y repinta la rejilla de modelos, lo que borraba el
    // contador «✍️ Generando… N tkn» en mitad de la respuesta. También se salta
    // con la pestaña oculta, para no gastar cuota de las APIs cloud en segundo
    // plano; al volver a primer plano se comprueba una vez.
    setInterval(() => {
        if (state.isStreaming || webgpuState?.isLoading || document.hidden) return;
        checkProviderStatus().then(result => showConnectionValidationResult?.(result));
    }, 30000);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden || state.isStreaming || webgpuState?.isLoading) return;
        checkProviderStatus().then(result => showConnectionValidationResult?.(result));
    });
    autoResizeTextarea();

    // Versión junto al logo (barra lateral, cabecera flotante y móvil).
    if (window.APP_VERSION) {
        const label = window.APP_VERSION_LABEL || window.APP_VERSION;
        document.querySelectorAll('.app-version').forEach((el) => { el.textContent = label; });
    }

    // Precarga temprana del modelo WebGPU activo si YA está en caché del
    // navegador: al volver a la app, cargarlo a VRAM en segundo plano deja el
    // primer envío casi instantáneo. Solo si está cacheado (no dispara
    // descargas sorpresa) y en tiempo ocioso para no competir con el arranque.
    if (state.settings.provider === 'webgpu') {
        // Escalón 1 (siempre): precalentar el runtime. Es el coste fijo de
        // cualquier carga —importar Transformers.js, montar onnxruntime,
        // negociar el adaptador— y no depende del modelo, así que se paga en
        // tiempo ocioso en vez de cuando el usuario ya está esperando.
        if (typeof scheduleWebGPUPriming === 'function') scheduleWebGPUPriming();

        // Escalón 2 (solo si ya está en caché): subir el modelo a memoria. No se
        // dispara una descarga sorpresa de cientos de MB sin que el usuario haya
        // hecho nada.
        if (typeof warmUpActiveWebGPUModel === 'function') {
            const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
            idle(async () => {
                try {
                    if (typeof getCachedWebGPUModels === 'function') {
                        webgpuState.cachedModelIds = await getCachedWebGPUModels();
                    }
                    if (webgpuState.cachedModelIds?.has(state.settings.model)) {
                        warmUpActiveWebGPUModel();
                    }
                } catch (e) { /* silencioso: se cargará al escribir */ }
            });
        }
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
        'webgpu', 'ollama', 'lmstudio', 'localai', 'ollama_remote', 'ollama_cloud',
        'groq', 'openrouter', 'freellmapi', 'gemini', 'claude', 'openai', 'chatgpt_local', 'nvidia',
        'mistral', 'cerebras',
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

        // Un clon no está en fallbackOrder: hereda el puesto de su base para
        // quedar justo debajo de ella (el +0.5 evita empatar y perder el orden).
        const baseRank = (id) => rank(fallbackOrder, getProviderBaseId(id)) + (isCustomProvider(id) ? 0.5 : 0);
        return baseRank(idA) - baseRank(idB);
    });
}

// ─── Clonado de motores ─────────────────────
// Registra en PROVIDERS los clones guardados y purga de settings los que ya no
// se pueden reconstruir (su base desapareció), para que no se acumulen huérfanos
// en localStorage ni reaparezcan si algún día vuelve un id de motor retirado.
function syncCustomProviders() {
    const registered = registerCustomProviders(state.settings.customProviders);
    state.settings.customProviders = registered;
    // Después de registrar, no antes: una copia recién creada no debe heredar
    // el nombre personalizado que hubiera bajo el id de su base.
    applyProviderNames(state.settings.providerNames);
    return registered;
}

/**
 * renameProvider — cambia el rótulo de CUALQUIER motor, de serie o copia.
 *
 * En una copia el nombre vive en customProviders; en un motor de serie se
 * guarda aparte, en providerNames, y solo si difiere del de fábrica. Así el
 * renombrado es reversible (nombre vacío o igual al original ⇒ se restaura) y
 * quien no lo haya tocado sigue recibiendo los cambios del catálogo.
 *
 * El id nunca cambia: es la clave de providerConfigs, favoritos, historial y
 * del motor fijado en proyectos y agentes.
 */
function renameProvider(providerId, name) {
    if (!PROVIDERS[providerId]) return false;
    const label = String(name || '').trim();
    if (isCustomProvider(providerId)) return renameCustomProvider(providerId, label);

    if (!state.settings.providerNames || typeof state.settings.providerNames !== 'object') {
        state.settings.providerNames = {};
    }
    if (!label || label === getDefaultProviderName(providerId)) {
        delete state.settings.providerNames[providerId];
    } else {
        state.settings.providerNames[providerId] = label;
    }
    applyProviderNames(state.settings.providerNames);
    return true;
}

// ¿Lleva este motor un rótulo distinto al de fábrica?
function hasCustomProviderName(providerId) {
    if (isCustomProvider(providerId)) return true;
    return !!state.settings.providerNames?.[providerId];
}

/**
 * cloneProvider — duplica un motor con nombre propio.
 *
 * Copia la configuración ACTUAL del origen (URL, credencial, modelo y
 * parámetros), no los valores por defecto del catálogo: clonar sirve justo para
 * partir de una conexión que ya funciona y cambiarle una cosa —otro host, otra
 * clave, otro modelo—. La API key se copia porque vive en la misma bóveda
 * cifrada que la del origen y nunca sale del navegador.
 */
function cloneProvider(sourceId, name) {
    if (!isCloneableProvider(sourceId)) return null;
    const baseId = getProviderBaseId(sourceId);
    const source = getProviderDef(sourceId);
    const label = String(name || '').trim() || `${source.name} (copia)`;
    const id = buildCustomProviderId(baseId, label);

    const list = Array.isArray(state.settings.customProviders) ? state.settings.customProviders : [];
    state.settings.customProviders = [...list, { id, name: label, icon: source.icon, baseProvider: baseId }];
    syncCustomProviders();
    if (!PROVIDERS[id]) return null;

    const src = state.settings.providerConfigs[sourceId] || {};
    state.settings.providerConfigs[id] = {
        url: src.url ?? source.defaultUrl,
        model: src.model ?? source.defaultModel,
        apiKey: src.apiKey || '',
        temperature: src.temperature ?? 0.8,
        topP: src.topP ?? 0.9,
        topK: src.topK ?? 40,
        maxTokens: src.maxTokens ?? 4096,
    };
    return id;
}

function renameCustomProvider(providerId, name) {
    const label = String(name || '').trim();
    if (!label || !isCustomProvider(providerId)) return false;
    const entry = (state.settings.customProviders || []).find(p => p.id === providerId);
    if (!entry) return false;
    // El id no cambia al renombrar: es la clave de providerConfigs, de favoritos,
    // del historial y del motor fijado en cada proyecto/agente. Renombrarlo
    // convertiría todas esas referencias en punteros rotos.
    entry.name = label;
    syncCustomProviders();
    return true;
}

function deleteCustomProvider(providerId) {
    if (!isCustomProvider(providerId)) return false;
    const baseId = getProviderBaseId(providerId);
    state.settings.customProviders = (state.settings.customProviders || []).filter(p => p.id !== providerId);
    delete state.settings.providerConfigs[providerId];
    state.settings.favoriteProviders = (state.settings.favoriteProviders || []).filter(id => id !== providerId);
    state.settings.providerUsageHistory = (state.settings.providerUsageHistory || []).filter(id => id !== providerId);
    state.settings.modelSuccessHistory = (state.settings.modelSuccessHistory || []).filter(e => e?.provider !== providerId);
    delete state.providerAvailability[providerId];
    // Proyectos y agentes que apuntaban al clon vuelven a su motor base en vez
    // de quedarse con un id inexistente (que caería al Ollama por defecto).
    (state.projects || []).forEach(p => { if (p.agentProvider === providerId) p.agentProvider = baseId; });
    syncCustomProviders();
    if (state.settings.provider === providerId) {
        state.settings.provider = baseId;
        syncProviderToState();
    }
    return true;
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

    // Clonar solo tiene sentido en motores con endpoint propio; renombrar y
    // eliminar, solo sobre copias (un motor de serie no se puede borrar).
    const cloneable = isCloneableProvider(selectedProvider);
    const isCopy = isCustomProvider(selectedProvider);
    if (dom.providerCloneBtn) {
        dom.providerCloneBtn.hidden = !cloneable;
        dom.providerCloneBtn.title = tr('engine.clone.title', 'Clonar {name} con otro nombre').replace('{name}', getProviderDef(selectedProvider).name);
    }
    // Renombrar vale para cualquier motor, no solo para las copias.
    if (dom.providerRenameBtn) {
        dom.providerRenameBtn.hidden = false;
        dom.providerRenameBtn.title = tr('engine.rename.title', 'Renombrar {name}')
            .replace('{name}', getProviderDef(selectedProvider).name);
    }
    if (dom.providerDeleteBtn) {
        dom.providerDeleteBtn.hidden = !isCopy;
        dom.providerDeleteBtn.title = tr('engine.delete.title', 'Eliminar {name}').replace('{name}', getProviderDef(selectedProvider).name);
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
    } else if (prov.type === 'gemini' && apiKey) {
        // Cabecera, NO `?key=` en la URL: en query string la clave acaba dentro
        // del parámetro `url=` del proxy CORS, en el historial y en cualquier
        // log intermedio. `Authorization: Bearer` no sirve aquí (Google lo
        // reserva para tokens OAuth, no para API keys).
        headers['x-goog-api-key'] = apiKey;
    } else if ((prov.auth === 'apikey' || prov.auth === 'optional_bearer') && apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }
    
    // OpenRouter requires extra headers (también en sus clones)
    if (getProviderBaseId(state.settings.provider) === 'openrouter') {
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
    updateApiKeyAccessNote();
    updateApiKeyFormatHint();

    // Inicio de sesión con el proveedor: solo donde hay un OAuth utilizable.
    const oauth = typeof getProviderOAuth === 'function' ? getProviderOAuth(state.settings.provider) : null;
    if (dom.providerOauth) dom.providerOauth.classList.toggle('hidden', !oauth);
    if (oauth && dom.providerOauthLabel) {
        dom.providerOauthLabel.textContent = tr('oauth.connect', 'Conectar con {name}').replace('{name}', oauth.label);
    }

    // Show/hide server URL (hidden for WebGPU)
    const urlGroup = dom.ollamaUrl?.closest('.setting-group');
    if (urlGroup) urlGroup.style.display = isWebGPU ? 'none' : '';
    
    // Show/hide WebGPU info panel
    const webgpuInfo = document.getElementById('webgpuInfoPanel');
    if (webgpuInfo) webgpuInfo.style.display = isWebGPU ? 'block' : 'none';
    if (dom.webgpuManualAdd) dom.webgpuManualAdd.style.display = isWebGPU ? 'flex' : 'none';
    if (isWebGPU && typeof startWebGPUMonitor === 'function') startWebGPUMonitor();
    else if (typeof stopWebGPUMonitor === 'function') stopWebGPUMonitor();

    // URL Placeholder and behavior
    if (dom.ollamaUrl) {
        const baseId = getProviderBaseId(state.settings.provider);
        if (baseId === 'ollama') {
            dom.ollamaUrl.placeholder = 'http://localhost:11434';
        } else if (baseId === 'ollama_remote') {
            dom.ollamaUrl.placeholder = 'https://dominio-remoto.com';
        } else {
            dom.ollamaUrl.placeholder = prov.defaultUrl || 'http://...';
        }
    }
    updateProviderUrlSuggestion();

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
        const _tr = (k, fb) => (typeof t === 'function' ? t(k, fb) : fb);
        dom.validateConnectionLabel.textContent = isWebGPU
            ? _tr('connection.check', 'Comprobar WebGPU')
            : (prov.auth === 'apikey' ? _tr('connection.validateKey', 'Validar API Key') : _tr('connection.validate', 'Validar conexión'));
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

/**
 * updateApiKeyAccessNote — dónde se consigue la clave del motor activo.
 *
 * Pinta la ficha de PROVIDER_ACCESS bajo el campo: enlace a la página de claves
 * del proveedor, la forma de la clave y lo que cuesta. Se construye con nodos,
 * no con innerHTML: el nombre del motor lo puede haber escrito el usuario.
 */
function updateApiKeyAccessNote() {
    const providerId = state.settings.provider;
    const access = typeof getProviderAccess === 'function' ? getProviderAccess(providerId) : null;

    if (dom.apiKeyInput) {
        dom.apiKeyInput.placeholder = access?.keyExample
            || tr('field.apiKey.placeholder', 'sk-... / gsk_... / tu-api-key');
    }
    const note = dom.apiKeyAccessNote;
    if (!note) return;
    note.classList.toggle('hidden', !access);
    if (!access) return;

    const link = document.createElement('a');
    link.href = access.keyUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = access.keyUrl.replace(/^https?:\/\//, '');

    const parts = [`🔑 ${tr('access.getKey', 'Consigue tu clave en')} `, link];
    if (access.keyExample) parts.push(` · ${tr('access.format', 'Formato')}: ${access.keyExample}`);
    if (access.cost) parts.push(` · ${tr(`access.cost.${getProviderBaseId(providerId)}`, access.cost)}`);
    note.replaceChildren(...parts);
}

/**
 * updateApiKeyFormatHint — avisa, sin bloquear, de una clave con mala pinta.
 *
 * Se evalúa mientras se escribe, contra lo que hay en los campos (no contra el
 * estado guardado), para que el aviso llegue antes de pulsar «Validar».
 */
function updateApiKeyFormatHint() {
    const hint = dom.apiKeyFormatHint;
    if (!hint || typeof checkApiKeyFormat !== 'function') return;
    const providerId = state.settings.provider;
    const key = dom.apiKeyInput?.value ?? state.settings.apiKey;
    const url = dom.ollamaUrl?.value || state.settings.ollamaUrl;
    const result = checkApiKeyFormat(providerId, key, url);

    hint.classList.toggle('hidden', result.ok);
    if (result.ok) { hint.textContent = ''; return; }

    let text = tr('access.formatMismatch', 'Esta clave no tiene el formato habitual de {name} ({example}).')
        .replace('{name}', getProviderDef(providerId).name)
        .replace('{example}', result.expected);
    if (result.looksLike) {
        text += ' ' + tr('access.looksLike', 'Parece una clave de {other}.')
            .replace('{other}', getDefaultProviderName(result.looksLike) || result.looksLike);
    }
    hint.textContent = text + ' ' + tr('access.formatCheck', 'Puedes validarla igualmente.');
}

/**
 * updateProviderUrlSuggestion — ofrece el endpoint que publica el proveedor.
 *
 * Los motores comerciales ya arrancan con su URL puesta, pero en cuanto se
 * edita (o se vacía, o se duplica la conexión y se toca) no había forma de
 * recuperarla sin buscarla en la documentación del proveedor. La propuesta solo
 * se muestra cuando lo escrito difiere del endpoint oficial; si coinciden,
 * repetirlo sería ruido. Los motores sin endpoint publicado —Ollama remoto,
 * que es el host del usuario— no proponen nada.
 */
function updateProviderUrlSuggestion() {
    const box = dom.providerUrlSuggest;
    if (!box) return;
    const prov = getProviderDef(state.settings.provider);
    const official = String(prov.defaultUrl || '').trim();
    const current = String(dom.ollamaUrl?.value ?? state.settings.ollamaUrl ?? '').trim();
    const normalize = (url) => url.replace(/\/+$/, '').toLowerCase();

    const worthOffering = !!official && prov.type !== 'webgpu' && normalize(current) !== normalize(official);
    box.classList.toggle('hidden', !worthOffering);
    if (worthOffering && dom.providerUrlSuggestBtn) {
        dom.providerUrlSuggestBtn.textContent = official;
        dom.providerUrlSuggestBtn.title = tr('field.serverUrl.officialUse', 'Usar {url}').replace('{url}', official);
    }
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
    },
    async keys() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const req = db.transaction('kv', 'readonly').objectStore('kv').getAllKeys();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    /** Varias escrituras en UNA transacción: o entran todas o ninguna. ops: [['set', clave, valor] | ['del', clave]] */
    async batch(ops) {
        if (!ops.length) return true;
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('kv', 'readwrite');
            const store = tx.objectStore('kv');
            for (const [op, key, value] of ops) {
                if (op === 'set') store.put(value, key);
                else store.delete(key);
            }
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
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
    },

    // ── Registros grandes (chats, proyectos, índice RAG) ──────────────────
    // Estos NO pasan por base64: un historial con imágenes ocupa megas y
    // `btoa(String.fromCharCode(...bytes))` desbordaría la pila al expandir el
    // array como argumentos. IndexedDB guarda ArrayBuffer y Uint8Array tal cual
    // (clonado estructurado), así que el binario se almacena directamente:
    // menos memoria, sin el 33 % de sobrecoste del base64 y más rápido.
    async encryptRecord(value) {
        // Sin WebCrypto (contexto no seguro) se guarda en claro pero MARCADO,
        // para que la lectura sepa distinguirlo y no intente descifrarlo.
        if (!this.available()) return { __wiaEnc: 'plain', value };
        try {
            const key = await this._getKey();
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const plaintext = new TextEncoder().encode(JSON.stringify(value));
            const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
            return { __wiaEnc: 'v1', iv, data };
        } catch (e) {
            console.warn('No se pudo cifrar el registro; se guarda en claro:', e);
            return { __wiaEnc: 'plain', value };
        }
    },

    /**
     * decryptRecord — devuelve { value, wasEncrypted }.
     *
     * `wasEncrypted: false` señala un registro heredado en texto plano (los
     * arrays sueltos que escribían las versiones anteriores) para que quien
     * llama pueda reescribirlo ya cifrado.
     */
    async decryptRecord(record) {
        if (record === null || record === undefined) return { value: null, wasEncrypted: true };
        // Formato antiguo: el array iba directo a IndexedDB, sin envoltorio.
        if (Array.isArray(record) || typeof record !== 'object') return { value: record, wasEncrypted: false };
        if (record.__wiaEnc === 'plain') return { value: record.value, wasEncrypted: false };
        if (record.__wiaEnc !== 'v1') return { value: record, wasEncrypted: false };

        if (!this.available()) {
            console.warn('Historial cifrado pero sin WebCrypto disponible en este contexto.');
            return { value: null, wasEncrypted: true, unreadable: true };
        }
        try {
            const key = await this._getKey();
            const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv }, key, record.data);
            return { value: JSON.parse(new TextDecoder().decode(pt)), wasEncrypted: true };
        } catch (e) {
            // La clave vive en IndexedDB junto a los datos: si se borra una y no
            // la otra (limpieza parcial del navegador), el historial es
            // irrecuperable. Se avisa en vez de fingir que está vacío.
            console.error('No se pudo descifrar el historial (¿se borró la clave del navegador?):', e);
            return { value: null, wasEncrypted: true, unreadable: true };
        }
    }
};

// ─── Cifrado de copias de seguridad ──────────
// La clave de la bóveda es NO exportable y vive en este navegador, así que no
// sirve para un fichero que se va a restaurar en otro equipo. Las copias
// protegidas derivan su clave de una contraseña (PBKDF2-SHA256, sal aleatoria)
// y cifran con AES-GCM: el fichero se abre en cualquier navegador que conozca la
// contraseña, y sin ella no revela nada (ni siquiera los títulos de los chats).
const backupCrypto = {
    ITERATIONS: 600000,
    available() { return typeof crypto !== 'undefined' && !!crypto.subtle; },
    _toB64(bytes) {
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(bin);
    },
    _fromB64(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); },
    async _key(passphrase, salt, iterations) {
        const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
            base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    },
    async seal(payload, passphrase, meta = {}) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await this._key(passphrase, salt, this.ITERATIONS);
        const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
        return {
            _type: 'wia-backup-enc', ...meta,
            kdf: 'PBKDF2-SHA256', iterations: this.ITERATIONS,
            salt: this._toB64(salt), iv: this._toB64(iv), data: this._toB64(new Uint8Array(data)),
        };
    },
    /** Descifra un sobre; lanza Error('bad-passphrase') si la contraseña no vale o el fichero está alterado. */
    async open(envelope, passphrase) {
        if (!envelope || envelope._type !== 'wia-backup-enc' || !envelope.salt || !envelope.iv || !envelope.data) throw new Error('bad-envelope');
        // Tope al coste que puede pedir un fichero ajeno: un valor enorme congelaría la pestaña.
        const iterations = Number(envelope.iterations);
        if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 5000000) throw new Error('bad-envelope');
        try {
            const key = await this._key(passphrase, this._fromB64(envelope.salt), iterations);
            const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: this._fromB64(envelope.iv) }, key, this._fromB64(envelope.data));
            return JSON.parse(new TextDecoder().decode(pt));
        } catch (_) {
            throw new Error('bad-passphrase');
        }
    },
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

// ─── Importación de ajustes ──────────────────
// Origen (esquema + host + puerto) al que un motor mandaría su credencial. Los
// clones heredan la URL por defecto de su base, que puede no estar registrada
// todavía cuando se evalúa un fichero recién importado.
function providerEndpointOrigin(providerId, config) {
    const def = PROVIDERS[providerId] || PROVIDERS[String(providerId).split('~')[0]];
    const raw = String((config && config.url) || def?.defaultUrl || '').trim();
    try { return new URL(raw).origin; } catch (_) { return raw.toLowerCase(); }
}

/**
 * mergeImportedSettings — funde unos ajustes importados con los actuales.
 *
 * Devuelve { settings, droppedKeys } sin tocar `current`.
 *
 * La regla que importa es la de las API keys. Los ficheros que exporta wIA no
 * las llevan, así que al importar hay que conservar las que ya hay en este
 * navegador… pero una clave solo vale para el servidor al que el usuario
 * decidió dársela. Si el fichero trae OTRA URL para ese motor, conservar la
 * clave la enviaría a ese servidor en la siguiente petición: bastaría con
 * convencer a alguien de importar «mis ajustes» para llevarse su clave. Por
 * eso la clave guardada se mantiene únicamente si el origen del endpoint no
 * cambia; si cambia, se descarta y se avisa (`droppedKeys`).
 *
 * Una clave que venga DENTRO del fichero (exportaciones antiguas) se respeta:
 * llega emparejada con su propia URL y no compromete las del usuario.
 */
function mergeImportedSettings(current, imported) {
    const incoming = imported && typeof imported === 'object' ? imported : {};
    const currentConfigs = current.providerConfigs || {};
    const merged = { ...current, ...incoming };
    if (typeof incoming.provider !== 'string' || !incoming.provider) merged.provider = current.provider;

    const importedConfigs = { ...(incoming.providerConfigs && typeof incoming.providerConfigs === 'object' ? incoming.providerConfigs : {}) };
    // Formato antiguo o escrito a mano: la conexión activa viene solo en los
    // campos de nivel superior. Se trata como la configuración de ese motor
    // para que pase por la misma regla que el resto.
    if (typeof incoming.provider === 'string' && incoming.provider && !importedConfigs[incoming.provider]) {
        const flat = {};
        if (typeof incoming.ollamaUrl === 'string') flat.url = incoming.ollamaUrl;
        if (typeof incoming.model === 'string') flat.model = incoming.model;
        if (typeof incoming.apiKey === 'string') flat.apiKey = incoming.apiKey;
        if (Object.keys(flat).length) importedConfigs[incoming.provider] = flat;
    }

    const droppedKeys = [];
    merged.providerConfigs = { ...currentConfigs };
    for (const [id, cfg] of Object.entries(importedConfigs)) {
        if (!cfg || typeof cfg !== 'object') continue;
        const prev = currentConfigs[id] || {};
        const next = { ...prev, ...cfg };
        if (typeof cfg.apiKey !== 'string' || !cfg.apiKey) {
            const sameEndpoint = providerEndpointOrigin(id, prev) === providerEndpointOrigin(id, next);
            next.apiKey = sameEndpoint ? (prev.apiKey || '') : '';
            if (!sameEndpoint && prev.apiKey) droppedKeys.push(id);
        }
        merged.providerConfigs[id] = next;
    }

    // Los campos de nivel superior son un espejo del motor activo: se dejan
    // coherentes aquí para que nunca quede una clave junto a una URL ajena.
    const active = merged.providerConfigs[merged.provider];
    merged.apiKey = (active && active.apiKey) || '';
    if (active && active.url) merged.ollamaUrl = active.url;
    return { settings: merged, droppedKeys };
}

// Aplica unos ajustes importados al estado vivo. Devuelve los ids de los
// motores cuya clave guardada se ha descartado (ver mergeImportedSettings).
function applyImportedSettings(imported) {
    const { settings, droppedKeys } = mergeImportedSettings(state.settings, imported);
    state.settings = settings;
    // Mismo orden que en loadState: primero los clones que traiga el fichero,
    // después se valida el motor activo y por último se sincroniza.
    syncCustomProviders();
    if (!PROVIDERS[state.settings.provider]) {
        const base = String(state.settings.provider || '').split('~')[0];
        state.settings.provider = PROVIDERS[base] ? base : 'ollama';
    }
    syncProviderToState();
    return droppedKeys;
}

// Aviso para el usuario cuando una importación ha descartado claves.
function describeDroppedKeys(droppedKeys) {
    if (!droppedKeys || !droppedKeys.length) return '';
    const names = droppedKeys.map((id) => getProviderDef(id).name || id).join(', ');
    return tr('import.keysDropped', 'El archivo cambia la URL del servidor de: {names}. Por seguridad, la API key guardada para esos motores NO se ha conservado: revisa la URL y vuelve a introducirla si confías en ella.')
        .replace('{names}', names);
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
        // `needsReencrypt` se activa si lo leído estaba en texto plano (versiones
        // anteriores al cifrado): al terminar la carga se reescribe ya cifrado.
        let needsReencrypt = false;
        let unreadable = false;
        let legacyFormat = false;
        try {
            const rawProjects = await secretVault.decryptRecord(await idbStore.get('projects'));
            projects = rawProjects.value;
            if (rawProjects.unreadable) { unreadable = true; chatStore.projectsLocked = true; }
            if (projects && !rawProjects.wasEncrypted) needsReencrypt = true;

            const chatKeys = (await idbStore.keys()).filter(k => String(k).startsWith(chatStore.PREFIX));
            if (chatKeys.length) {
                // Formato por chat: cada conversación es su propio registro.
                chats = [];
                for (const k of chatKeys) {
                    const id = String(k).slice(chatStore.PREFIX.length);
                    chatStore.onDisk.add(id);
                    try {
                        const rec = await secretVault.decryptRecord(await idbStore.get(k));
                        if (rec.unreadable) { chatStore.unreadable.add(id); unreadable = true; }
                        else if (rec.value) chats.push(rec.value);
                    } catch (_) { chatStore.unreadable.add(id); unreadable = true; }
                }
                // Sin índice, el orden de la lista lo da la fecha de creación (el
                // panel lateral reordena por última actividad de todos modos).
                chats.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                if (await idbStore.get('chats')) chatStore.legacyChats = true;
            } else {
                // Formato anterior: un único registro con todos los chats.
                const rawChats = await secretVault.decryptRecord(await idbStore.get('chats'));
                chats = rawChats.value;
                if (rawChats.unreadable) unreadable = true;
                else if (chats) { legacyFormat = true; chatStore.legacyChats = true; }
                if (chats && !rawChats.wasEncrypted) needsReencrypt = true;
            }
        } catch (e) {
            console.warn('IndexedDB no disponible, usando localStorage:', e);
        }

        if (unreadable) {
            // No se sobrescribe nada: si el usuario recupera la clave (o restaura
            // el perfil del navegador) sus chats siguen ahí.
            showPersistenceAlert('No se ha podido descifrar tu historial guardado. La clave de cifrado de este navegador no está disponible (puede haberse borrado al limpiar datos del sitio). Los chats anteriores no se mostrarán, pero no se han borrado. Si tienes una copia de seguridad, restáurala desde Ajustes → Datos.');
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

        // Lo que se acaba de leer es, por definición, lo que hay en disco.
        for (const c of state.chats) chatStore.sigs.set(c.id, chatSignature(c));
        chatStore.projectsSig = projectsSignature();
        initChatSync();

        if (migrated) {
            try {
                await persistConversationsToIdb({ notifyOnError: false, full: true });
                // Libera la cuota de localStorage solo tras migrar con éxito
                localStorage.removeItem('antigravity_projects');
                localStorage.removeItem('antigravity_chats');
                console.log('[Persistencia] chats y proyectos migrados a IndexedDB (cifrados)');
            } catch (e) {
                console.warn('No se pudo migrar a IndexedDB, se mantiene localStorage:', e);
            }
        } else if (needsReencrypt || legacyFormat) {
            // Historial de una versión anterior (en claro, o en un único registro):
            // se reescribe cifrado y por chat en cuanto se ha leído bien.
            persistConversationsToIdb({ notifyOnError: false, full: true })
                .then(() => console.log('[Persistencia] historial existente reescrito cifrado'))
                .catch(() => {});
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
        // Los motores clonados se registran ANTES de cualquier lectura de
        // PROVIDERS: syncProviderToState, hydrateSecrets y la UI de arranque
        // consultan el catálogo, y si el clon activo aún no existiera se caería
        // al Ollama por defecto perdiendo la conexión que el usuario dejó puesta.
        syncCustomProviders();
        // Si el clon activo ya no se pudo registrar, se cae a su motor base
        // (el prefijo del id) en lugar de al Ollama por defecto.
        if (!PROVIDERS[state.settings.provider]) {
            const base = String(state.settings.provider || '').split('~')[0];
            state.settings.provider = PROVIDERS[base] ? base : 'ollama';
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

        // En móvil y sin datos previos, arranca con un modelo WebGPU ligero por
        // defecto (los grandes pueden agotar la memoria del teléfono).
        if (!state.hasSavedSettings && typeof isMobileDevice === 'function' && isMobileDevice()) {
            const wc = state.settings.providerConfigs?.webgpu;
            if (wc && typeof isHeavyForMobile === 'function' && isHeavyForMobile(wc.model)) {
                wc.model = MOBILE_SAFE_WEBGPU_MODEL;
                if (state.settings.provider === 'webgpu') state.settings.model = MOBILE_SAFE_WEBGPU_MODEL;
            }
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
        // Durante un failover state.settings lleva un motor provisional: se guarda
        // el elegido por el usuario, no el que está contestando por él.
        const persisted = state._engineOverride ? { ...state.settings, ...state._engineOverride } : state.settings;
        localStorage.setItem('antigravity_settings', JSON.stringify(settingsWithoutSecrets(persisted)));
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

// ─── Almacén de conversaciones ───────────────
// Antes todo el historial era UN registro cifrado: cada guardado volvía a
// serializar, cifrar y escribir TODAS las conversaciones (imágenes incluidas), y
// dos pestañas abiertas se pisaban entre sí. Ahora cada chat es su propio
// registro cifrado (`chat:<id>`) y solo se escribe lo que ha cambiado. No hay un
// índice compartido a propósito: sería un registro que todas las pestañas
// reescriben (y se pisarían igual); el conjunto de claves `chat:*` ES el índice.
// Una pestaña avisa a las demás por BroadcastChannel.
const chatStore = {
    PREFIX: 'chat:',
    key: (id) => 'chat:' + id,
    sigs: new Map(),            // id → firma de lo último que hay en disco
    onDisk: new Set(),          // ids con registro en disco (incluye los ilegibles)
    unreadable: new Set(),      // ids que no se pudieron descifrar: no se tocan
    projectsSig: '',
    projectsLocked: false,      // 'projects' ilegible: no se sobrescribe
    legacyChats: false,         // existe el registro único antiguo 'chats'
    chain: Promise.resolve(),   // serializa las escrituras de esta pestaña
    tabId: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()),
    channel: null,
};

function _fnv(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36) + ':' + str.length;
}

/**
 * Firma de un chat para saber si cambió. Barata para los que no se están
 * mirando (campos propios + nº de mensajes + tamaño del último) y completa para
 * el chat activo, que es el que se edita: así no se serializan todos los chats
 * en cada guardado.
 */
function chatSignature(chat) {
    const msgs = chat.messages || [];
    const last = msgs[msgs.length - 1];
    const own = Object.keys(chat).filter(k => k !== 'messages').sort().map(k => chat[k]);
    let sig = JSON.stringify([own, msgs.length, last ? [String(last.content || '').length, String(last.thinking || '').length, (last.images || []).length] : 0]);
    if (chat.id === state.activeChatId) sig += '|' + _fnv(JSON.stringify(msgs));
    return sig;
}

function projectsSignature() {
    return _fnv(JSON.stringify((state.projects || []).map(p => ({
        ...p, documents: (p.documents || []).map(d => [d.id, d.name, String(d.data || '').length]),
    }))));
}

function postChatSync(message) {
    try { chatStore.channel?.postMessage({ ...message, tab: chatStore.tabId }); } catch (_) {}
}

async function persistConversationsToIdb(options = {}) {
    const run = () => _persistConversations(options);
    const p = chatStore.chain.then(run, run);
    chatStore.chain = p.catch(() => {});
    return p;
}

async function _persistConversations(options = {}) {
    try {
        // Chats y proyectos se guardan CIFRADOS (AES-GCM con la clave no
        // exportable de la bóveda): cualquier extensión con permiso sobre el
        // sitio, o quien abriese las herramientas de desarrollo, leería si no
        // conversaciones y documentos enteros.
        const full = !!options.full;
        const ops = [];
        const newSigs = new Map();
        const changed = [];

        const pSig = projectsSignature();
        const writeProjects = !chatStore.projectsLocked && (full || pSig !== chatStore.projectsSig);
        if (writeProjects) ops.push(['set', 'projects', await secretVault.encryptRecord(state.projects)]);

        const ids = [];
        for (const chat of state.chats) {
            ids.push(chat.id);
            const sig = chatSignature(chat);
            newSigs.set(chat.id, sig);
            if (full || chatStore.sigs.get(chat.id) !== sig || !chatStore.onDisk.has(chat.id)) {
                ops.push(['set', chatStore.key(chat.id), await secretVault.encryptRecord(chat)]);
                changed.push(chat.id);
            }
        }
        // Los chats ilegibles se dejan tal cual en disco: ni se leen ni se borran.
        const removed = [...chatStore.onDisk].filter(id => !ids.includes(id) && !chatStore.unreadable.has(id));
        removed.forEach(id => ops.push(['del', chatStore.key(id)]));

        await idbStore.batch(ops);

        chatStore.sigs = newSigs;
        chatStore.onDisk = new Set([...ids, ...chatStore.unreadable]);
        if (writeProjects) chatStore.projectsSig = pSig;
        // El registro único antiguo ya no hace falta cuando el nuevo está completo.
        if (chatStore.legacyChats && !chatStore.unreadable.size) {
            try { await idbStore.del('chats'); chatStore.legacyChats = false; } catch (_) {}
        }
        if (changed.length || removed.length || writeProjects) {
            postChatSync({ t: 'changed', ids: changed, removed, projects: writeProjects });
        }
        return true;
    } catch (e) {
        console.warn('Failed to persist conversations to IndexedDB:', e);
        if (options.notifyOnError !== false) {
            showPersistenceAlert(buildPersistenceErrorMessage(e));
        }
        return false;
    }
}

/** Borra TODO el historial guardado (chats, proyectos, índice y el formato antiguo). */
async function purgeConversationStore() {
    try {
        const keys = await idbStore.keys();
        const doomed = keys.filter(k => k === 'chats' || k === 'projects' || String(k).startsWith(chatStore.PREFIX));
        await idbStore.batch(doomed.map(k => ['del', k]));
    } catch (e) { console.warn('No se pudo vaciar el almacén de conversaciones:', e); }
    chatStore.sigs = new Map(); chatStore.onDisk = new Set(); chatStore.unreadable = new Set();
    chatStore.projectsSig = ''; chatStore.projectsLocked = false; chatStore.legacyChats = false;
    postChatSync({ t: 'purged' });
}

// ── Sincronización entre pestañas ──
async function _readChatRecord(id) {
    const rec = await secretVault.decryptRecord(await idbStore.get(chatStore.key(id)));
    return rec.unreadable ? null : rec.value;
}

async function syncFromOtherTab(msg) {
    try {
        if (msg.t === 'purged') {
            chatStore.sigs = new Map(); chatStore.onDisk = new Set(); chatStore.projectsSig = '';
            resetProjectsAndChatsState();
            applyPostResetUI({ preserveSettings: true });
            return;
        }
        if (msg.t !== 'changed') return;

        // Mientras esta pestaña genera una respuesta, su chat activo no se toca.
        const protectedId = state.isStreaming ? state.activeChatId : null;
        let activeChanged = false;
        let removedActive = false;

        for (const id of (msg.ids || [])) {
            if (id === protectedId) continue;
            const chat = await _readChatRecord(id);
            if (!chat) continue;
            const at = state.chats.findIndex(c => c.id === id);
            if (at >= 0) state.chats[at] = chat; else state.chats.unshift(chat);
            chatStore.onDisk.add(id);
            chatStore.sigs.set(id, chatSignature(chat));
            if (id === state.activeChatId) activeChanged = true;
        }
        for (const id of (msg.removed || [])) {
            if (id === protectedId) continue;
            state.chats = state.chats.filter(c => c.id !== id);
            chatStore.onDisk.delete(id);
            chatStore.sigs.delete(id);
            if (id === state.activeChatId) removedActive = true;
        }

        if (msg.projects) {
            const rec = await secretVault.decryptRecord(await idbStore.get('projects'));
            if (Array.isArray(rec.value) && rec.value.length) {
                state.projects = rec.value;
                chatStore.projectsSig = projectsSignature();
                if (!state.projects.find(p => p.id === state.activeProjectId)) state.activeProjectId = 'general';
                renderProjectSelect();
            }
        }
        if (removedActive) { state.activeChatId = null; showWelcome(); }
        renderChatList();
        if (activeChanged && typeof renderMessages === 'function') renderMessages({ force: true });
    } catch (e) {
        console.warn('No se pudo sincronizar con otra pestaña:', e);
    }
}

function initChatSync() {
    if (chatStore.channel || typeof BroadcastChannel === 'undefined') return;
    try {
        chatStore.channel = new BroadcastChannel('wia-conversations');
        chatStore.channel.onmessage = (ev) => {
            const msg = ev.data;
            if (!msg || msg.tab === chatStore.tabId) return;
            // Tras las escrituras en curso de esta pestaña, para no leer a medias.
            chatStore.chain = chatStore.chain.then(() => syncFromOtherTab(msg)).catch(() => {});
        };
    } catch (_) { chatStore.channel = null; }
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
    // Un motor renombrado (o una copia) manda sobre las abreviaturas de abajo:
    // si el usuario le puso nombre, es el que debe verse en la barra de estado.
    if (hasCustomProviderName(providerId)) return getProviderDef(providerId).name;
    const map = {
        webgpu: 'WebGPU',
        ollama: 'Ollama',
        ollama_remote: 'Ollama remoto',
        ollama_cloud: 'Ollama cloud',
        lmstudio: 'LM Studio',
        localai: 'LocalAI',
        groq: 'Groq',
        openrouter: 'OpenRouter',
        gemini: 'Gemini',
        claude: 'Claude',
        openai: 'OpenAI',
        chatgpt_local: 'ChatGPT',
        freellmapi: 'FreeLLMAPI',
        nvidia: 'Nvidia',
        mistral: 'Mistral',
        cerebras: 'Cerebras'
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
                // El detalle explica el porqué cuando lo hay (p. ej. «Bloqueado
                // (HTTPS→HTTP)» para un motor local desde una página segura).
                ? (availability.detail && availability.detail !== 'No detectado'
                    ? availability.detail
                    : 'No detectado')
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

    // Este encabezado lleva data-i18n en el HTML, así que applyI18n también lo
    // reescribe: se usa la misma vía de traducción para que no se pisen entre sí
    // según el orden en que se ejecuten.
    const modelHeading = document.getElementById('settingsHeadingModels');
    if (modelHeading) {
        const template = (typeof t === 'function' ? t('panel.models.headingFor', 'Modelos de {provider}') : 'Modelos de {provider}');
        modelHeading.textContent = template.replace('{provider}', provider.name);
    }
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
    return getProviderLocality(state.settings.provider, state.settings.ollamaUrl);
}

/**
 * getProviderLocality — lo mismo para un motor cualquiera y una URL dada. Lo
 * usa también el failover para no sacar una consulta de tu equipo a un tercero.
 */
function getProviderLocality(providerId, configuredUrl) {
    const def = getProviderDef(providerId);
    if (def.type === 'webgpu') {
        return { mode: 'local', label: 'IA Local', detail: 'La inferencia se ejecuta en tu navegador (WebGPU). Nada sale de tu equipo.' };
    }
    const url = configuredUrl || def.defaultUrl || '';
    // Una pasarela corre en tu equipo pero reenvía cada consulta a proveedores
    // externos: anunciarla como «IA Local» por su URL sería engañoso.
    if (def.gateway) {
        return { mode: 'cloud', label: 'IA Cloud', detail: tr('locality.gateway', '{name} es una pasarela: se ejecuta en tu equipo, pero reenvía las consultas a proveedores externos.').replace('{name}', def.name) };
    }
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
    if (dom.ragEnabledToggle) dom.ragEnabledToggle.checked = state.settings.ragEnabled !== false;
    if (dom.autoFailoverToggle) dom.autoFailoverToggle.checked = state.settings.autoFailover === true;
    if (typeof renderRagIndexStatus === 'function') renderRagIndexStatus();
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

/* >>> exports (generado por scripts/gen-modules.mjs: no editar a mano) >>> */
export {
    state, $, $$, dom, showPersistenceAlert, isIncognitoMode,
    isConversationPersistenceDisabled, init, getProviderDef, getOrderedProviderEntries,
    renameProvider, cloneProvider, deleteCustomProvider, markProviderUsed,
    renderProviderOptions, getActiveProviderConfig, getAuthHeaders, syncProviderToState,
    saveCurrentProviderConfig, updateProviderUI, updateApiKeyFormatHint,
    updateProviderUrlSuggestion, updateInputDisclaimer, idbStore, secretVault, backupCrypto,
    settingsWithoutSecrets, applyImportedSettings, describeDroppedKeys, saveState,
    persistOrderQueue, chatStore, purgeConversationStore, saveStateNow,
    resetProjectsAndChatsState, applyPostResetUI, formatTokens, getCompactProviderLabel,
    getCompactModelLabel, updateSettingsActiveContext, getProviderLocality, updateStatusMeta,
    updateModelContextIndicator, applyTheme, applySettingsToUI,
};
/* <<< exports <<< */
