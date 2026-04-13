/* ============================================
   wIA — Application Logic
   Multi-Engine AI Chat Interface
   ============================================ */

// ─── Provider Registry ──────────────────────
const PROVIDERS = {
    ollama:        { name: 'Ollama (Local)',     type: 'ollama',     auth: 'none',             defaultUrl: 'http://localhost:11434',                                  defaultModel: 'gemma4:e4b',                icon: '🟢' },
    ollama_remote: { name: 'Ollama (Remoto)',    type: 'ollama',     auth: 'optional_bearer',  defaultUrl: '',                                                        defaultModel: 'gemma4:e4b',                icon: '🌐' },
    ollama_cloud:  { name: 'Ollama Cloud',      type: 'ollama',     auth: 'apikey',           defaultUrl: '',                                                        defaultModel: 'llama3:latest',             icon: '☁️' },
    lmstudio:      { name: 'LM Studio',          type: 'openai',     auth: 'none',             defaultUrl: 'http://localhost:1234/v1',                                 defaultModel: '',                          icon: '💻' },
    groq:          { name: 'Groq',               type: 'openai',     auth: 'apikey',           defaultUrl: 'https://api.groq.com/openai/v1',                          defaultModel: 'llama-3.3-70b-versatile',   icon: '⚡' },
    openrouter:    { name: 'OpenRouter',          type: 'openai',     auth: 'apikey',           defaultUrl: 'https://openrouter.ai/api/v1',                            defaultModel: 'google/gemma-3-27b-it',     icon: '🔀' },
    gemini:        { name: 'Google Gemini',       type: 'gemini',     auth: 'apikey',           defaultUrl: 'https://generativelanguage.googleapis.com/v1beta',        defaultModel: 'gemini-2.5-flash',          icon: '✨' },
    claude:        { name: 'Claude (Anthropic)',  type: 'anthropic',  auth: 'apikey',           defaultUrl: 'https://api.anthropic.com/v1',                            defaultModel: 'claude-sonnet-4-20250514',  icon: '🟣' },
    openai:        { name: 'OpenAI',              type: 'openai',     auth: 'apikey',           defaultUrl: 'https://api.openai.com/v1',                               defaultModel: 'gpt-4.1',                   icon: '🤖' },
};

// ─── State ──────────────────────────────────
const state = {
    chats: [],
    activeChatId: null,
    isStreaming: false,
    abortController: null,
    attachments: [],
    capabilities: [],
    projects: [],
    activeProjectId: 'general',
    settings: {
        provider: 'ollama',
        ollamaUrl: 'http://localhost:11434',
        model: 'gemma4:e4b',
        apiKey: '',
        theme: 'dark',
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        maxTokens: 4096,
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
        // Per-provider configs — memorized independently
        providerConfigs: {
            ollama:        { url: 'http://localhost:11434', model: 'gemma4:e4b', apiKey: '', temperature: 0.7, topP: 0.9, topK: 40, maxTokens: 4096 },
            ollama_remote: { url: '', model: 'gemma4:e4b', apiKey: '', temperature: 0.7, topP: 0.9, topK: 40, maxTokens: 4096 },
            lmstudio:      { url: 'http://localhost:1234/v1', model: '', apiKey: '', temperature: 0.7, topP: 0.9, topK: 40, maxTokens: 4096 },
            groq:          { url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', apiKey: '', temperature: 0.7, topP: 0.9, topK: 40, maxTokens: 4096 },
            openrouter:    { url: 'https://openrouter.ai/api/v1', model: 'google/gemma-3-27b-it', apiKey: '', temperature: 0.7, topP: 0.9, topK: 40, maxTokens: 8192 },
            gemini:        { url: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash', apiKey: '', temperature: 0.7, topP: 0.9, topK: 40, maxTokens: 8192 },
            claude:        { url: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-20250514', apiKey: '', temperature: 0.7, topP: 0.9, topK: 40, maxTokens: 8192 },
            openai:        { url: 'https://api.openai.com/v1', model: 'gpt-4.1', apiKey: '', temperature: 0.7, topP: 0.9, topK: 40, maxTokens: 4096 },
        },
    },
};

// ─── DOM References ─────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
    sidebar: $('#sidebar'),
    chatList: $('#chatList'),
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
    toolThinking: $('#toolThinking'),
    // Settings
    providerSelect: $('#providerSelect'),
    ollamaUrl: $('#ollamaUrl'),
    themeSelect: $('#themeSelect'),
    modelSelect: $('#modelSelect'),
    refreshModels: $('#refreshModels'),
    temperature: $('#temperature'),
    tempValue: $('#tempValue'),
    systemPrompt: $('#systemPrompt'),
    thinkingMode: $('#thinkingMode'),
    apiKeyInput: $('#apiKeyInput'),
    apiKeyGroup: $('#apiKeyGroup'),
    apiKeyToggle: $('#apiKeyToggle'),
    providerAuthBadge: $('#providerAuthBadge'),
    inputDisclaimer: $('#inputDisclaimer'),
    // Generation params
    topP: $('#topP'),
    topPValue: $('#topPValue'),
    topK: $('#topK'),
    topKValue: $('#topKValue'),
    maxTokens: $('#maxTokens'),
    maxTokensValue: $('#maxTokensValue'),
    // IP Whitelist
    currentIpLabel: $('#currentIpLabel'),
    memorizeIpBtn: $('#memorizeIpBtn'),
    ipWhitelistList: $('#ipWhitelistList'),
    // New
    improvePromptBtn: $('#improvePromptBtn'),
    privacyModal: $('#privacyModal'),
    openPrivacy: $('#openPrivacy'),
    closePrivacy: $('#closePrivacy'),
    closePrivacyBtn: $('#closePrivacyBtn'),
    filterFreeModelsContainer: $('#filterFreeModelsContainer'),
    filterFreeModels: $('#filterFreeModels'),
};

// ─── Init ───────────────────────────────────
function init() {
    loadState();
    renderProjectSelect();
    renderChatList();
    bindEvents();
    checkProviderStatus();
    setInterval(checkProviderStatus, 15000);
    autoResizeTextarea();
}

// ─── Provider Helpers ───────────────────────
function getProviderDef(providerId) {
    return PROVIDERS[providerId] || PROVIDERS.ollama;
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
            temperature: 0.7,
            topP: 0.9,
            topK: 40,
            maxTokens: 4096
        };
        state.settings.providerConfigs[providerId] = pc;
    } else {
        // Fallback to defaults if missing
        if (!pc.url && def.defaultUrl) pc.url = def.defaultUrl;
        if (!pc.model && def.defaultModel) pc.model = def.defaultModel;
        if (pc.temperature === undefined) pc.temperature = 0.7;
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
    state.settings.temperature = pc.temperature !== undefined ? pc.temperature : 0.7;
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
    const badge = dom.providerAuthBadge;
    
    // Auth badge
    if (badge) {
        badge.className = 'provider-auth-badge';
        if (prov.auth === 'none') {
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
    
    updateInputDisclaimer();
}

function updateInputDisclaimer() {
    if (!dom.inputDisclaimer) return;
    const prov = getProviderDef(state.settings.provider);
    const provName = prov.name;
    
    if (prov.auth === 'none' && prov.type === 'ollama') {
        dom.inputDisclaimer.textContent = `Modelo local vía ${provName} · Privacidad total`;
    } else if (prov.auth === 'none') {
        dom.inputDisclaimer.textContent = `Conectando vía ${provName} · Privacidad local`;
    } else {
        dom.inputDisclaimer.textContent = `Conectando vía ${provName} · Datos enviados a ${prov.name}`;
    }
}

function renderIpWhitelist() {
    if (!dom.ipWhitelistList) return;
    dom.ipWhitelistList.innerHTML = '';
    
    const currentIp = SecureGate.getCurrentIp();
    if (dom.currentIpLabel) {
        dom.currentIpLabel.textContent = currentIp || 'Desconocida';
        if (currentIp && SecureGate.isIpWhitelisted(currentIp)) {
            dom.currentIpLabel.style.color = 'var(--success)';
        } else {
            dom.currentIpLabel.style.color = '';
        }
    }
    
    // Hardcoded
    SecureGate.HARDCODED_WHITELIST.forEach(ip => {
        const tag = document.createElement('div');
        tag.className = 'ip-tag hardcoded';
        tag.innerHTML = `<span>${ip}</span> <span title="IP del Sistema">🔒</span>`;
        dom.ipWhitelistList.appendChild(tag);
    });
    
    // User added
    const userIps = SecureGate.getWhitelistedIps();
    userIps.forEach(ip => {
        const tag = document.createElement('div');
        tag.className = 'ip-tag';
        tag.innerHTML = `<span>${ip}</span> <button class="remove-ip" aria-label="Eliminar" data-ip="${ip}">&times;</button>`;
        dom.ipWhitelistList.appendChild(tag);
    });
    
    // Bind remove buttons
    dom.ipWhitelistList.querySelectorAll('.remove-ip').forEach(btn => {
        btn.addEventListener('click', (e) => {
            SecureGate.removeIpFromWhitelist(e.target.dataset.ip);
            renderIpWhitelist();
        });
    });
    
    // Update Memorize btn disabled state
    if (dom.memorizeIpBtn) {
        dom.memorizeIpBtn.disabled = !currentIp || SecureGate.isIpWhitelisted(currentIp);
    }
}

// ─── Persistence ────────────────────────────
function loadState() {
    try {
        const savedProjects = localStorage.getItem('antigravity_projects');
        if (savedProjects) {
            state.projects = JSON.parse(savedProjects);
        } else {
            state.projects = [{ id: 'general', name: 'General', systemPrompt: '', documents: [] }];
        }

        const savedChats = localStorage.getItem('antigravity_chats');
        if (savedChats) {
            state.chats = JSON.parse(savedChats);
            // Migrate orphan chats to 'general'
            state.chats.forEach(c => {
                if (!c.projectId) c.projectId = 'general';
            });
        }
        
        const settings = localStorage.getItem('antigravity_settings');
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

function saveState() {
    try {
        localStorage.setItem('antigravity_projects', JSON.stringify(state.projects));
        localStorage.setItem('antigravity_chats', JSON.stringify(state.chats));
        state.settings.activeProjectId = state.activeProjectId;
        // Save current provider config before persisting
        saveCurrentProviderConfig();
        localStorage.setItem('antigravity_settings', JSON.stringify(state.settings));
    } catch (e) {
        console.warn('Failed to save state:', e);
    }
}

function applySettingsToUI() {
    if (dom.providerSelect) dom.providerSelect.value = state.settings.provider || 'ollama';
    dom.ollamaUrl.value = state.settings.ollamaUrl;
    if (dom.themeSelect) dom.themeSelect.value = state.settings.theme || 'dark';
    document.documentElement.setAttribute('data-theme', state.settings.theme || 'dark');
    dom.modelSelect.value = state.settings.model;
    dom.temperature.value = state.settings.temperature;
    dom.tempValue.textContent = state.settings.temperature;
    dom.systemPrompt.value = state.settings.systemPrompt;
    dom.thinkingMode.checked = state.settings.thinkingMode;
    // Generation params
    if (dom.topP) { dom.topP.value = state.settings.topP; dom.topPValue.textContent = state.settings.topP; }
    if (dom.topK) { dom.topK.value = state.settings.topK; dom.topKValue.textContent = state.settings.topK; }
    if (dom.maxTokens) { dom.maxTokens.value = state.settings.maxTokens; dom.maxTokensValue.textContent = state.settings.maxTokens; }
    // Update status model label
    const prov = getProviderDef(state.settings.provider);
    const providerSpan = $('.status-provider');
    if (providerSpan) providerSpan.textContent = prov.name;
    $('.status-model').textContent = `${prov.icon} ${state.settings.model}`;
    
    updateProviderUI();
    if (typeof SecureGate !== 'undefined') renderIpWhitelist();
}

// ─── Backend Connection ──────────────────────
async function checkProviderStatus() {
    dom.statusDot.className = 'status-dot loading';
    dom.statusText.textContent = 'Verificando...';
    
    const prov = getProviderDef(state.settings.provider);
    const provType = prov.type;
    
    try {
        let models = [];
        const headers = getAuthHeaders();
        
        if (provType === 'ollama') {
            // Ollama native API
            const url = `${state.settings.ollamaUrl}/api/tags`;
            const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
            if (!res.ok) throw new Error('Bad response');
            const data = await res.json();
            models = data.models || [];
            
        } else if (provType === 'openai') {
            // OpenAI-compatible (LMStudio, Groq, OpenRouter, OpenAI)
            const url = `${state.settings.ollamaUrl}/models`;
            const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
            if (!res.ok) {
                let errorText = res.statusText;
                try {
                    const errorJson = await res.json();
                    errorText = errorJson.error?.message || errorJson.message || errorText;
                } catch(e) {}
                throw new Error(`${res.status}: ${errorText}`);
            }
            const data = await res.json();
            // Map pricing metadata if provided (OpenRouter mostly)
            models = (data.data || []).map(m => ({ name: m.id, pricing: m.pricing }));
            
        } else if (provType === 'gemini') {
            // Gemini REST API
            const apiKey = state.settings.apiKey;
            if (!apiKey) throw new Error('API Key requerida');
            const url = `${state.settings.ollamaUrl}/models?key=${apiKey}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
            const data = await res.json();
            models = (data.models || [])
                .filter(m => m.name && m.supportedGenerationMethods?.includes('generateContent'))
                .map(m => ({ name: m.name.replace('models/', '') }));
            
        } else if (provType === 'anthropic') {
            // Anthropic doesn't have a list models endpoint accessible from browser
            // We'll use fixed model list and validate with a ping
            const fixedModels = [
                'claude-sonnet-4-20250514',
                'claude-opus-4-20250514',
                'claude-3-7-sonnet-latest',
                'claude-3-5-haiku-latest',
                'claude-3-5-sonnet-latest',
            ];
            models = fixedModels.map(m => ({ name: m }));
            
            // Validate API key with a minimal request
            const apiKey = state.settings.apiKey;
            if (apiKey) {
                try {
                    const res = await fetch(`${state.settings.ollamaUrl}/messages`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                            model: state.settings.model || fixedModels[0],
                            max_tokens: 1,
                            messages: [{ role: 'user', content: 'ping' }]
                        }),
                        signal: AbortSignal.timeout(8000)
                    });
                    // Even a 400 means the API is reachable; only network errors mean offline
                    if (!res.ok && res.status >= 500) throw new Error('API error');
                } catch (e) {
                    if (e.name === 'TypeError') throw new Error('CORS o red bloqueada');
                    // Other errors (400, 429) still mean reachable
                }
            }
        }
        
        state.rawModels = models;
        populateModels(models);
        
        const hasModel = models.some(m => m.name === state.settings.model || m.name.startsWith(state.settings.model.split(':')[0]));
        dom.statusDot.className = 'status-dot online';
        dom.statusText.textContent = hasModel ? 'Conectado' : 'Modelo no encontrado';
        
        if (hasModel || models.length > 0) {
            dom.improvePromptBtn?.classList.remove('hidden');
            await fetchModelCapabilities(state.settings.model);
        } else {
            dom.improvePromptBtn?.classList.add('hidden');
        }
    } catch (e) {
        dom.statusDot.className = 'status-dot offline';
        dom.statusText.textContent = e.message?.includes('API Key') ? 'API Key requerida' : 
                                     e.message?.includes('CORS') ? 'Error CORS' : 'Desconectado';
        dom.improvePromptBtn?.classList.add('hidden');
        
        if (dom.modelSelect.options.length === 0 || dom.modelSelect.innerHTML.includes('Cargando modelos')) {
            dom.modelSelect.innerHTML = `<option value="${state.settings.model}" selected>${state.settings.model} (Offline)</option>`;
        }
    }
}

async function fetchModelCapabilities(modelName) {
    const provType = getProviderDef(state.settings.provider).type;
    
    // Cloud providers: assume full capabilities
    if (['openai', 'gemini', 'anthropic'].includes(provType) && state.settings.provider !== 'lmstudio') {
        state.capabilities = ['vision', 'tools', 'thinking'];
        updateToolbarVisibility();
        return;
    }
    
    if (state.settings.provider === 'lmstudio') {
        state.capabilities = ['vision', 'tools', 'thinking'];
        updateToolbarVisibility();
        return;
    }
    
    // Ollama: query model capabilities
    try {
        const res = await fetch(`${state.settings.ollamaUrl}/api/show`, {
            method: 'POST',
            body: JSON.stringify({ name: modelName })
        });
        const data = await res.json();
        state.capabilities = data.details?.capabilities || data.capabilities || [];
        updateToolbarVisibility();
    } catch(e) {
        state.capabilities = [];
        updateToolbarVisibility();
    }
}

function updateToolbarVisibility() {
    // Vision
    if (state.capabilities.includes('vision')) {
        dom.fileUpload.setAttribute('accept', 'image/*,.txt,.csv,.json,.md,.js,.py,.html,.css');
    } else {
        dom.fileUpload.setAttribute('accept', '.txt,.csv,.json,.md,.js,.py,.html,.css');
        // Quitar imágenes previas
        state.attachments = state.attachments.filter(a => !a.isImage);
        renderAttachmentPreview();
    }
    
    // Tools
    if (state.capabilities.includes('tools')) {
        dom.toolInternet.classList.remove('hidden');
    } else {
        dom.toolInternet.classList.add('hidden');
        dom.toolInternet.classList.remove('active');
    }
    
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

function populateModels(models) {
    if (!models || models.length === 0) {
        dom.modelSelect.innerHTML = `<option value="">No hay modelos disponibles</option>`;
        if (dom.filterFreeModelsContainer) dom.filterFreeModelsContainer.style.display = 'none';
        return;
    }

    // Inyectar router gratuito de OpenRouter si aplica
    if (state.settings.provider === 'openrouter') {
        const hasFreeRouter = models.some(m => m.name === 'openrouter/free');
        if (!hasFreeRouter) {
            models.unshift({
                name: 'openrouter/free',
                pricing: { prompt: "0", completion: "0" }
            });
        }
    }

    state.rawModels = models; // Guardar referencia para búsqueda reactiva
    
    // Configurar visibilidad del contenedor de píldoras de filtrado
    if (dom.filterFreeModelsContainer) {
        // Mostrar filtro en proveedores que suelen tener modelos gratuitos/gratis
        const providersWithFree = ['openrouter', 'groq', 'openai', 'gemini'];
        if (providersWithFree.includes(state.settings.provider)) {
            dom.filterFreeModelsContainer.style.display = 'flex';
        } else {
            dom.filterFreeModelsContainer.style.display = 'none';
        }
    }

    const searchTerm = (dom.modelSearchInput?.value || '').toLowerCase();
    const showOnlyFree = $('#btnFilterFree')?.classList.contains('active') || false;

    // 1. Filtrado
    let filtered = models.filter(m => {
        const nameLower = m.name.toLowerCase();
        
        // Filtro de búsqueda
        if (searchTerm && !nameLower.includes(searchTerm)) return false;

        // Filtro Free/Gratis (vía ID o pricing)
        if (showOnlyFree && state.settings.provider === 'openrouter') {
            const isFreeId = nameLower.includes(':free') || nameLower.includes(':gratis') || nameLower.includes('free') || nameLower.includes('gratis');
            const zeroPrompt = m.pricing && (m.pricing.prompt === "0" || m.pricing.prompt === "0.0" || m.pricing.prompt === 0);
            const zeroComp = m.pricing && (m.pricing.completion === "0" || m.pricing.completion === "0.0" || m.pricing.completion === 0);
            if (!isFreeId && !(zeroPrompt && zeroComp)) return false;
        }
        
        return true;
    });

    // 2. Ordenación Alfabética
    filtered.sort((a, b) => a.name.localeCompare(b.name));

    // 3. Agrupación y Renderizado
    if (filtered.length === 0) {
        dom.modelSelect.innerHTML = `<option value="">Ningún modelo coincide</option>`;
        return;
    }

    // Agrupar por letra inicial para una navegación tipo List Box Premium
    const groups = {};
    filtered.forEach(m => {
        const firstLetter = m.name.charAt(0).toUpperCase();
        if (!groups[firstLetter]) groups[firstLetter] = [];
        groups[firstLetter].push(m);
    });

    const currentSelection = state.settings.model;
    let html = '';
    Object.keys(groups).sort().forEach(letter => {
        html += `<optgroup label="Grupo ${letter}">`;
        groups[letter].forEach(m => {
            let detailsStr = '';
            // Detectar si es gratis para añadir el tag visual
            const isFree = m.pricing && (m.pricing.prompt === "0" || m.pricing.prompt === "0.0" || m.pricing.prompt === 0) && (m.pricing.completion === "0" || m.pricing.completion === "0.0" || m.pricing.completion === 0);
            const nameLower = m.name.toLowerCase();
            
            if (isFree || nameLower.includes(':free') || nameLower.includes(':gratis') || nameLower.includes('-free') || nameLower.includes('-gratis')) {
                detailsStr = ' (Gratis)';
            } else if (m.details) {
                const params = m.details.parameter_size ? `${m.details.parameter_size}` : '';
                const quant = m.details.quantization_level ? ` — ${m.details.quantization_level}` : '';
                if (params || quant) detailsStr = ` (${params}${quant})`;
            } else if (m.size) {
                const sizeGB = (m.size / (1024 * 1024 * 1024)).toFixed(1);
                detailsStr = ` (${sizeGB} GB)`;
            }
            html += `<option value="${m.name}">${m.name}${detailsStr}</option>`;
        });
        html += `</optgroup>`;
    });

    dom.modelSelect.innerHTML = html;

    // Mantener selección si existe
    if (filtered.some(m => m.name === currentSelection)) {
        dom.modelSelect.value = currentSelection;
    } else if (filtered.length > 0) {
        // Autoseleccionar primero si no hay coincidencia
        dom.modelSelect.value = filtered[0].name;
    }
}


// ─── PDF Parsing Logic ──────────────────────
if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
}

async function extractTextFromPDF(file) {
    if (!window.pdfjsLib) return "PDF.js no está cargado.";
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            fullText += textContent.items.map(item => item.str).join(' ') + '\n';
        }
        return fullText;
    } catch(e) {
        console.error("Error reading PDF:", e);
        return "Error extrayendo texto del PDF: " + e.message;
    }
}

// ─── Project Documents Logic ──────────────────
async function handleProjectFiles(files) {
    const proj = getActiveProject();
    if (!files.length) return;
    
    for (const file of files) {
        if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
            const textData = await extractTextFromPDF(file);
            proj.documents.push({
                id: crypto.randomUUID(),
                name: file.name,
                type: 'text/plain',
                data: textData
            });
            saveState();
            renderProjectDocList();
        } else {
            const reader = new FileReader();
            reader.onload = (e) => {
                proj.documents.push({
                    id: crypto.randomUUID(),
                    name: file.name,
                    type: file.type,
                    data: e.target.result
                });
                saveState();
                renderProjectDocList();
            };
            reader.readAsText(file);
        }
    }
    dom.projectFileUpload.value = '';
}

function renderProjectDocList() {
    const proj = getActiveProject();
    if (!dom.projectDocList) return;
    dom.projectDocList.innerHTML = proj.documents.map(d => `
        <div class="attachment-item" style="max-width: 100%; justify-content: space-between;">
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">📝 ${escapeHtml(d.name)}</span>
            <button class="btn-icon" onclick="removeProjectDoc('${d.id}')" style="width:20px;height:20px;color:var(--danger)">✕</button>
        </div>
    `).join('');
}

window.removeProjectDoc = (id) => {
    const proj = getActiveProject();
    proj.documents = proj.documents.filter(d => d.id !== id);
    saveState();
    renderProjectDocList();
};

// ─── Attachments Logic ──────────────────────
async function handleFiles(files) {
    if (!files.length) return;
    
    for (const file of files) {
        if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
            const textData = await extractTextFromPDF(file);
            state.attachments.push({
                id: crypto.randomUUID(),
                name: file.name,
                type: 'application/pdf',
                isImage: false,
                data: textData
            });
            renderAttachmentPreview();
            continue;
        }

        const isImage = file.type.startsWith('image/');
        if (isImage && !state.capabilities.includes('vision')) {
            alert(`El modelo seleccionado (${state.settings.model}) no soporta imágenes.`);
            continue;
        }
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const data = e.target.result;
            state.attachments.push({
                id: crypto.randomUUID(),
                name: file.name,
                type: file.type,
                isImage: isImage,
                data: isImage ? data.split(',')[1] : data
            });
            renderAttachmentPreview();
        };
        
        if (isImage) {
            reader.readAsDataURL(file);
        } else {
            reader.readAsText(file);
        }
    }
    dom.fileUpload.value = '';
}

function removeAttachment(id) {
    state.attachments = state.attachments.filter(a => a.id !== id);
    renderAttachmentPreview();
}

function renderAttachmentPreview() {
    if (state.attachments.length === 0) {
        dom.attachmentPreview.classList.add('hidden');
        dom.attachmentPreview.innerHTML = '';
        return;
    }
    
    dom.attachmentPreview.classList.remove('hidden');
    dom.attachmentPreview.innerHTML = state.attachments.map(a => {
        if (a.isImage) {
            return `
                <div class="attachment-item image">
                    <img src="data:${a.type};base64,${a.data}" alt="${escapeHtml(a.name)}">
                    <div class="attachment-remove" data-id="${a.id}">✕</div>
                </div>
            `;
        } else {
            return `
                <div class="attachment-item" title="${escapeHtml(a.name)}">
                    📝 <span class="attachment-name">${escapeHtml(a.name)}</span>
                    <div class="attachment-remove" data-id="${a.id}">✕</div>
                </div>
            `;
        }
    }).join('');
}

// ─── Project Management ──────────────────────
function renderProjectSelect() {
    dom.projectSelect.innerHTML = state.projects.map(p => 
        `<option value="${p.id}" ${p.id === state.activeProjectId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
    ).join('');
}

function switchProject(projectId) {
    if (state.activeProjectId === projectId) return;
    state.activeProjectId = projectId;
    state.activeChatId = null;
    saveState();
    renderProjectSelect();
    renderChatList();
    showWelcome();
}

function getActiveProject() {
    return state.projects.find(p => p.id === state.activeProjectId) || state.projects[0];
}

function createProject(name) {
    const proj = {
        id: crypto.randomUUID(),
        name: name,
        systemPrompt: '',
        documents: [],
        createdAt: Date.now()
    };
    state.projects.push(proj);
    saveState();
    switchProject(proj.id);
    return proj;
}

function deleteProject(id) {
    if (id === 'general') {
        alert("No puedes eliminar el Workspace General.");
        return;
    }
    state.projects = state.projects.filter(p => p.id !== id);
    // Eliminar chats huerfanos
    state.chats = state.chats.filter(c => c.projectId !== id);
    
    if (state.activeProjectId === id) {
        switchProject('general');
    } else {
        saveState();
        renderProjectSelect();
        renderChatList();
    }
}

// ─── Chat Management ────────────────────────
function createChat() {
    const chat = {
        id: crypto.randomUUID(),
        projectId: state.activeProjectId,
        title: 'Nueva conversación',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    state.chats.unshift(chat);
    state.activeChatId = chat.id;
    saveState();
    renderChatList();
    showChat();
    renderMessages();
    dom.messageInput.focus();
    closeSidebar();
    return chat;
}

function deleteChat(chatId) {
    state.chats = state.chats.filter(c => c.id !== chatId);
    if (state.activeChatId === chatId) {
        state.activeChatId = null;
        showWelcome();
    }
    saveState();
    renderChatList();
}

function switchChat(chatId) {
    state.activeChatId = chatId;
    renderChatList();
    showChat();
    renderMessages();
    closeSidebar();
}

function getActiveChat() {
    return state.chats.find(c => c.id === state.activeChatId);
}

function generateTitle(message) {
    // Simple title from first message
    const text = message.replace(/[#*`]/g, '').trim();
    return text.length > 45 ? text.substring(0, 45) + '...' : text;
}

// ─── UI Switching ───────────────────────────
function showWelcome() {
    dom.welcomeScreen.style.display = 'flex';
    dom.messagesContainer.classList.remove('active');
}

function showChat() {
    dom.welcomeScreen.style.display = 'none';
    dom.messagesContainer.classList.add('active');
}

// ─── Render Chat List ───────────────────────
function renderChatList() {
    const searchTerm = dom.searchChats.value.toLowerCase();
    
    // Filter chats by Active Project AND search term
    const projectChats = state.chats.filter(c => c.projectId === state.activeProjectId);
    const filteredChats = projectChats.filter(c =>
        c.title.toLowerCase().includes(searchTerm)
    );

    if (filteredChats.length === 0) {
        dom.chatList.innerHTML = `
            <div class="empty-chats">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <p>Sin conversaciones aún</p>
            </div>
        `;
        return;
    }

    dom.chatList.innerHTML = filteredChats.map(chat => `
        <div class="chat-item ${chat.id === state.activeChatId ? 'active' : ''}" data-id="${chat.id}">
            <div class="chat-item-text">
                <div class="chat-item-title">${escapeHtml(chat.title)}</div>
                <div class="chat-item-date">${formatDate(chat.updatedAt)}</div>
            </div>
            <div class="chat-item-actions">
                <button class="btn-icon move-chat-btn" data-id="${chat.id}" title="Mover a otro Proyecto">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                </button>
                <button class="btn-icon delete-chat-btn" data-id="${chat.id}" title="Eliminar">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');

    // Bind chat item clicks
    dom.chatList.querySelectorAll('.chat-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.delete-chat-btn')) return;
            switchChat(item.dataset.id);
        });
    });

    dom.chatList.querySelectorAll('.delete-chat-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            showDeleteModal(btn.dataset.id);
        });
    });

    dom.chatList.querySelectorAll('.move-chat-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            showMoveModal(btn.dataset.id);
        });
    });
}

// ─── Render Messages ────────────────────────
function renderMessages() {
    const chat = getActiveChat();
    if (!chat) return;

    dom.messagesScroll.innerHTML = chat.messages.map((msg, idx) =>
        renderMessage(msg, idx)
    ).join('');

    // Process code blocks
    processCodeBlocks();
    scrollToBottom();
}

function renderMessage(msg, idx) {
    const isUser = msg.role === 'user';
    const avatarContent = isUser 
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' 
        : '<img src="favicon.png" style="width: 22px; height: 22px; border-radius: 4px; object-fit: contain;">';
    const senderName = isUser ? 'Tú' : 'wIA';

    let contentHtml = '';

    if (msg.thinking && state.settings.thinkingMode) {
        const thinkingRendered = renderMarkdown(msg.thinking);
        contentHtml += `
            <div class="thinking-block">
                <div class="thinking-header" data-idx="${idx}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <path d="m9 18 6-6-6-6"/>
                    </svg>
                    Razonamiento
                </div>
                <div class="thinking-content" data-idx="${idx}">${thinkingRendered}</div>
            </div>
        `;
    }

    let displayContent = msg.content || '';
    if (isUser) {
        const attachIndex = displayContent.indexOf('\n\n--- Archivo adjunto:');
        if (attachIndex !== -1) {
            displayContent = displayContent.substring(0, attachIndex);
        }
    }

    if (msg.attachedDocs && msg.attachedDocs.length > 0) {
        contentHtml += `<div style="display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap;">`;
        msg.attachedDocs.forEach(docName => {
            contentHtml += `<span style="background:var(--bg-tertiary); padding:4px 8px; border-radius:4px; font-size:0.75rem; color:var(--text-secondary); border: 1px solid var(--border-subtle);"><svg style="display:inline; width:12px; height:12px; margin-right:4px;" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>${escapeHtml(docName)}</span>`;
        });
        contentHtml += `</div>`;
    }

    if (msg.images && msg.images.length > 0) {
        contentHtml += `<div style="display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap;">`;
        msg.images.forEach(imgB64 => {
            const mimeType = imgB64.startsWith('/') ? 'image/jpeg' : (imgB64.startsWith('iVB') ? 'image/png' : 'image/jpeg');
            contentHtml += `<img src="data:${mimeType};base64,${imgB64}" style="max-height: 120px; border-radius: 8px; border: 1px solid var(--border-subtle); object-fit: contain;">`;
        });
        contentHtml += `</div>`;
    }

    const isError = !isUser && displayContent.includes('⚠️');
    
    if (isError) {
        contentHtml = `
            <div class="error-message-card">
                <div class="error-header">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <span>Fallo de Conexión</span>
                </div>
                <div class="error-body">
                    ${renderMarkdown(displayContent)}
                </div>
                <div class="error-footer" style="display: flex; justify-content: flex-end; margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 12px;">
                    <button class="btn-retry" onclick="retryMessage(${idx})">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
                        Reintentar ahora
                    </button>
                </div>
            </div>
        `;
    } else {
        contentHtml += isUser ? `<p style="white-space: pre-wrap;">${escapeHtml(displayContent)}</p>` : renderMarkdown(displayContent);
    }

    let metricsHtml = '';
    if (!isUser && msg.metrics && Object.keys(msg.metrics).length > 0) {
        let tps = msg.metrics.tps || 'N/A';
        if (msg.metrics.eval_count && msg.metrics.eval_duration) {
            tps = (msg.metrics.eval_count / (msg.metrics.eval_duration / 1e9)).toFixed(2);
        }
        metricsHtml = `<span class="metrics-btn" onclick="showMetricsModal(${idx})" title="Geek Info">⏱️ ${tps} T/s</span>`;
    }

    return `
        <div class="message ${msg.role} ${isError ? 'message-error' : ''}" id="msg-${idx}">
            <div class="message-inner">
                <div class="message-avatar">${avatarContent}</div>
                <div class="message-body">
                    <div class="message-sender">${metricsHtml}</div>
                    <div class="message-content">
                        ${contentHtml}
                        ${msg.isProposal ? `
                        <div class="proposal-actions">
                            <button class="btn-primary apply-proposal-btn" onclick="applyProposal(${idx})" title="Usar este prompt mejorado">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>
                                Usar este prompt
                            </button>
                        </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function showMetricsModal(idx) {
    const chat = getActiveChat();
    if (!chat) return;
    const msg = chat.messages[idx];
    if (!msg) return;
    
    const modal = document.getElementById('metricsModal');
    const bodyEl = document.getElementById('metricsBody');
    if (!modal || !bodyEl) return;

    const provName = msg.provider ? (getProviderDef(msg.provider)?.name || msg.provider) : 'Actual';
    const modelUsed = msg.model || 'Desconocido';

    let html = `<ul style="list-style: none; padding: 0; font-size: 0.85rem; color: var(--text-secondary); line-height: 1.6;">`;
    
    // 1. Neurona & Entorno
    html += `<li style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px dashed var(--border-subtle);">
        <div style="font-size: 0.7rem; text-transform: uppercase; color: var(--accent-secondary); font-weight: 800; letter-spacing: 1px; margin-bottom: 6px;">Neurona & Entorno</div>
        <div style="display: flex; flex-direction: column; gap: 4px;">
            <div><strong style="color:var(--text-primary)">Plataforma:</strong> ${escapeHtml(provName)}</div>
            <div><strong style="color:var(--text-primary)">Modelo:</strong> <code style="font-size: 0.75rem; background: var(--bg-tertiary); padding: 2px 4px; border-radius: 4px; color: var(--accent-primary); border: 1px solid var(--border-subtle);">${escapeHtml(modelUsed)}</code></div>
        </div>
    </li>`;

    // 2. Configuración Creativa
    if (msg.params) {
        html += `<li style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px dashed var(--border-subtle);">
            <div style="font-size: 0.7rem; text-transform: uppercase; color: var(--accent-secondary); font-weight: 800; letter-spacing: 1px; margin-bottom: 6px;">Configuración Creativa</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div style="background: var(--bg-tertiary); padding: 6px; border-radius: 6px; text-align: center;">
                    <div style="font-size: 0.65rem; color: var(--text-tertiary);">Temp</div>
                    <div style="font-weight: 600; color: var(--text-primary);">${msg.params.temperature}</div>
                </div>
                <div style="background: var(--bg-tertiary); padding: 6px; border-radius: 6px; text-align: center;">
                    <div style="font-size: 0.65rem; color: var(--text-tertiary);">Top-P</div>
                    <div style="font-weight: 600; color: var(--text-primary);">${msg.params.topP}</div>
                </div>
                <div style="background: var(--bg-tertiary); padding: 6px; border-radius: 6px; text-align: center;">
                    <div style="font-size: 0.65rem; color: var(--text-tertiary);">Top-K</div>
                    <div style="font-weight: 600; color: var(--text-primary);">${msg.params.topK}</div>
                </div>
                <div style="background: var(--bg-tertiary); padding: 6px; border-radius: 6px; text-align: center;">
                    <div style="font-size: 0.65rem; color: var(--text-tertiary);">Max Tkn</div>
                    <div style="font-weight: 600; color: var(--text-primary);">${msg.params.maxTokens}</div>
                </div>
            </div>
        </li>`;
    }

    // 3. Telemetría de Red
    if (msg.metrics && Object.keys(msg.metrics).length > 0) {
        html += `<div style="font-size: 0.7rem; text-transform: uppercase; color: var(--accent-secondary); font-weight: 800; letter-spacing: 1px; margin-bottom: 6px;">Telemetría de Red</div>`;
        for(const [k, v] of Object.entries(msg.metrics)) {
            if (k === 'tps') continue;
            let displayVal = v;
            // Escalar nanosegundos a segundos para humanos si la clave termina en _duration
            if (typeof v === 'number' && k.toLowerCase().includes('duration')) {
                displayVal = (v / 1e9).toFixed(2) + 's';
            }
            html += `<li style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 2px;">
                <span style="color: var(--text-tertiary);">${escapeHtml(k)}:</span>
                <span style="color: var(--text-primary); font-family: monospace;">${escapeHtml(String(displayVal))}</span>
            </li>`;
        }
        
        const tps = msg.metrics.tps || (msg.metrics.eval_count && msg.metrics.eval_duration ? (msg.metrics.eval_count / (msg.metrics.eval_duration / 1e9)).toFixed(2) : null);
        if (tps) {
            html += `<div style="margin-top: 12px; background: var(--accent-primary); padding: 8px; border-radius: 8px; color: white; display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 0.7rem; font-weight: 700; text-transform: uppercase;">Velocidad Real</span>
                <span style="font-weight: 800; font-size: 1rem;">${tps} <small style="font-weight: 400; font-size: 0.7rem;">tokens/s</small></span>
            </div>`;
        }
    } else {
        html += `<li style="color: var(--text-tertiary); font-style: italic; text-align: center; padding: 10px;">Telemetría no grabada para este mensaje.</li>`;
    }
    
    html += `</ul>`;
    
    const titleEl = modal.querySelector('h2');
    if (titleEl) titleEl.textContent = 'Analítica de Mensaje';
    bodyEl.innerHTML = html;
    modal.classList.remove('hidden');
}

window.showMetricsModal = showMetricsModal;

window.retryMessage = (idx) => {
    const chat = getActiveChat();
    if (!chat) return;
    
    // Solo reintentar si es un mensaje del asistente (el error)
    if (chat.messages[idx] && chat.messages[idx].role === 'assistant') {
        // Eliminar el mensaje fallido
        chat.messages.splice(idx, 1);
        saveState();
        renderActiveChat();
        
        // Reintentar sin añadir nuevo mensaje de usuario
        sendMessage(null, 'RETRY_LAST');
    }
};

function renderMarkdown(text) {
    if (!text) return '';
    try {
        marked.setOptions({
            highlight: function(code, lang) {
                if (lang && hljs.getLanguage(lang)) {
                    return hljs.highlight(code, { language: lang }).value;
                }
                return hljs.highlightAuto(code).value;
            },
            breaks: true,
            gfm: true,
        });
        return marked.parse(text);
    } catch (e) {
        return escapeHtml(text);
    }
}

function processCodeBlocks() {
    dom.messagesScroll.querySelectorAll('pre code').forEach((block) => {
        const pre = block.parentElement;
        if (pre.querySelector('.code-block-header')) return;

        const classes = block.className || '';
        const langMatch = classes.match(/language-(\w+)/);
        const lang = langMatch ? langMatch[1] : 'code';

        const header = document.createElement('div');
        header.className = 'code-block-header';
        header.innerHTML = `
            <span class="code-block-lang">${lang}</span>
            <button class="code-copy-btn" title="Copiar código">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <rect width="14" height="14" x="8" y="8" rx="2"/>
                    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                </svg>
                Copiar
            </button>
        `;

        pre.insertBefore(header, block);

        header.querySelector('.code-copy-btn').addEventListener('click', () => {
            const code = block.textContent;
            navigator.clipboard.writeText(code).then(() => {
                const btn = header.querySelector('.code-copy-btn');
                btn.classList.add('copied');
                btn.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <path d="M20 6 9 17l-5-5"/>
                    </svg>
                    ¡Copiado!
                `;
                setTimeout(() => {
                    btn.classList.remove('copied');
                    btn.innerHTML = `
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                            <rect width="14" height="14" x="8" y="8" rx="2"/>
                            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                        </svg>
                        Copiar
                    `;
                }, 2000);
            });
        });
    });
}

async function improvePrompt() {
    const originalText = dom.messageInput.value.trim();
    if (!originalText || state.isStreaming) return;

    dom.improvePromptBtn.classList.add('active-optimization');
    dom.improvePromptBtn.disabled = true;

    // Immediate feedback: Ensure there's a chat and show loading
    let chat = getActiveChat();
    if (!chat) chat = createChat();

    const placeholderIdx = chat.messages.length;
    chat.messages.push({
        role: 'assistant',
        content: '_Optimizando prompt..._ ⚡',
        isOptimizing: true,
        createdAt: Date.now()
    });
    
    showChat();
    renderMessages();
    scrollToBottom();

    try {
        const systemInstruction = "Actúa como un experto en ingeniería de prompts. Tu tarea es reescribir y mejorar el siguiente mensaje del usuario para obtener la mejor respuesta posible de un modelo de IA. Hazlo más claro, detallado y profesional, pero manteniendo la intención original. Devuelve ÚNICAMENTE el prompt mejorado, sin introducciones ni explicaciones adicionales.";
        
        const provType = getProviderDef(state.settings.provider).type;
        const headers = getAuthHeaders();
        let url, payload, optimizedText;
        
        if (provType === 'ollama') {
            url = `${state.settings.ollamaUrl}/api/chat`;
            payload = {
                model: state.settings.model,
                messages: [
                    { role: 'system', content: systemInstruction },
                    { role: 'user', content: originalText }
                ],
                stream: false,
                options: { temperature: 0.4, num_predict: 500 }
            };
            const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            const data = await response.json();
            optimizedText = data.message?.content?.trim();
            
        } else if (provType === 'openai') {
            url = `${state.settings.ollamaUrl}/chat/completions`;
            payload = {
                model: state.settings.model,
                messages: [
                    { role: 'system', content: systemInstruction },
                    { role: 'user', content: originalText }
                ],
                stream: false,
                temperature: 0.4,
                max_tokens: 500
            };
            const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            const data = await response.json();
            optimizedText = data.choices?.[0]?.message?.content?.trim();
            
        } else if (provType === 'gemini') {
            const apiKey = state.settings.apiKey;
            url = `${state.settings.ollamaUrl}/models/${state.settings.model}:generateContent?key=${apiKey}`;
            payload = {
                system_instruction: { parts: [{ text: systemInstruction }] },
                contents: [{ role: 'user', parts: [{ text: originalText }] }],
                generationConfig: { temperature: 0.4, maxOutputTokens: 500 }
            };
            const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            const data = await response.json();
            optimizedText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            
        } else if (provType === 'anthropic') {
            url = `${state.settings.ollamaUrl}/messages`;
            payload = {
                model: state.settings.model,
                system: systemInstruction,
                messages: [{ role: 'user', content: originalText }],
                max_tokens: 500,
                temperature: 0.4
            };
            const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            const data = await response.json();
            optimizedText = data.content?.[0]?.text?.trim();
        }

        if (optimizedText) {
            chat.messages[placeholderIdx] = {
                role: 'assistant',
                content: optimizedText,
                isProposal: true,
                createdAt: Date.now()
            };
        } else {
            throw new Error('Respuesta vacía del modelo');
        }
    } catch (e) {
        console.error("Optimization failed:", e);
        chat.messages[placeholderIdx] = {
            role: 'assistant',
            content: `⚠️ **Error al optimizar**: ${e.message}. Asegúrate de que ${getProviderDef(state.settings.provider).name} está funcionando correctamente.`,
            createdAt: Date.now()
        };
    } finally {
        chat.updatedAt = Date.now();
        saveState();
        renderMessages();
        scrollToBottom();
        dom.improvePromptBtn.classList.remove('active-optimization');
        dom.improvePromptBtn.disabled = false;
    }
}

window.applyProposal = (idx) => {
    const chat = getActiveChat();
    if (!chat || !chat.messages[idx]) return;
    
    const text = chat.messages[idx].content;
    dom.messageInput.value = text;
    dom.messageInput.focus();
    autoResizeTextarea();
    updateSendButton();
    
    // Smooth scroll to input
    dom.messageInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

// ─── Streaming Chat ─────────────────────────
async function sendMessage(content, autoSendBody = null) {
    if (state.isStreaming) return;

    let isRetry = autoSendBody === 'RETRY_LAST';
    let reqImages = [];
    let promptAttachments = '';
    let attachedDocsNames = [];

    if (!autoSendBody && !isRetry) {
        for (const att of state.attachments) {
            if (att.isImage) {
                reqImages.push(att.data);
            } else {
                attachedDocsNames.push(att.name);
                promptAttachments += `\n\n--- Archivo adjunto: ${att.name} ---\n${att.data}\n`;
            }
        }
        
        if (promptAttachments) content = `${content}${promptAttachments}`;
        if (!content.trim() && reqImages.length === 0) return;

        state.attachments = [];
        renderAttachmentPreview();
    }

    let chat = getActiveChat();
    if (!chat) {
        chat = createChat();
    }

    if (!autoSendBody && !isRetry) {
        if (chat.messages.length === 0) {
            const cleanTitleSource = content.indexOf('\n\n--- Archivo adjunto:') !== -1 ? content.substring(0, content.indexOf('\n\n--- Archivo adjunto:')) : content;
            chat.title = generateTitle(cleanTitleSource || 'Documento adjunto');
            renderChatList();
        }

        const userMsg = { role: 'user', content: content.trim() };
        if (reqImages.length > 0) userMsg.images = reqImages;
        if (attachedDocsNames.length > 0) userMsg.attachedDocs = attachedDocsNames;
        
        chat.messages.push(userMsg);
        chat.updatedAt = Date.now();
        saveState();

        showChat();
        renderMessages();
    }

    dom.messageInput.value = '';
    autoResizeTextarea();
    updateSendButton();

    const assistantMsg = { 
        role: 'assistant', 
        content: '', 
        thinking: '',
        provider: state.settings.provider,
        model: state.settings.model,
        params: {
            temperature: state.settings.temperature,
            topP: state.settings.topP || 0.9,
            topK: state.settings.topK || 40,
            maxTokens: state.settings.maxTokens || 4096
        }
    };
    chat.messages.push(assistantMsg);
    const msgIdx = chat.messages.length - 1;

    appendTypingMessage(msgIdx);

    state.isStreaming = true;
    state.abortController = new AbortController();
    dom.sendBtn.classList.add('hidden');
    dom.stopBtn.classList.remove('hidden');

    const provType = getProviderDef(state.settings.provider).type;
    
    try {
        const headers = getAuthHeaders();
        // Solo usar autoSendBody si es un array de mensajes (para el optimizador de prompts u otros)
        // Si es un simple flag 'RETRY_LAST', reconstruir desde el historial.
        let messages = (autoSendBody && Array.isArray(autoSendBody)) ? autoSendBody : buildApiMessages(chat);
        
        const reader_decoder = { reader: null, decoder: new TextDecoder() };
        let buffer = '';
        let isInThinking = false;
        let thinkingText = '';
        let responseText = '';
        let pendingToolCall = null;
        let partialToolCallArgs = '';
        const startTime = Date.now();
        
        // ── Build request based on provider type ──
        if (provType === 'ollama') {
            // Ollama native streaming
            let reqBody = {
                model: state.settings.model,
                messages: messages,
                stream: true,
                options: {
                    temperature: parseFloat(state.settings.temperature),
                    top_p: parseFloat(state.settings.topP || 0.9),
                    top_k: parseInt(state.settings.topK || 40)
                }
            };
            
            if (dom.toolInternet.classList.contains('active') && state.capabilities.includes('tools')) {
                reqBody.tools = [buildWikipediaTool()];
            }
            
            const response = await fetch(`${state.settings.ollamaUrl}/api/chat`, {
                method: 'POST', headers, body: JSON.stringify(reqBody),
                signal: state.abortController.signal,
            });
            if (!response.ok) throw new Error(`Error: ${response.status} ${response.statusText}`);
            
            reader_decoder.reader = response.body.getReader();
            
            while (true) {
                const { done, value } = await reader_decoder.reader.read();
                if (done) break;
                buffer += reader_decoder.decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const json = JSON.parse(line);
                        if (json.done && json.total_duration) {
                            assistantMsg.metrics = {
                                total_duration: json.total_duration,
                                load_duration: json.load_duration,
                                prompt_eval_count: json.prompt_eval_count,
                                eval_count: json.eval_count,
                                eval_duration: json.eval_duration
                            };
                        }
                        if (json.message?.tool_calls) pendingToolCall = json.message.tool_calls;
                        const token = json.message?.content || '';
                        if (token) {
                            processStreamToken(token, assistantMsg, msgIdx, { isInThinking, thinkingText, responseText });
                            isInThinking = streamState.isInThinking;
                            thinkingText = streamState.thinkingText;
                            responseText = streamState.responseText;
                        }
                    } catch(e) {}
                }
            }
            
        } else if (provType === 'openai') {
            // OpenAI-compatible streaming (LMStudio, Groq, OpenRouter, OpenAI)
            // Map images for OpenAI vision format
            if (!autoSendBody) {
                messages = messages.map(m => {
                    if (m.images && m.images.length > 0) {
                        const contentArr = [{ type: "text", text: m.content || "Imagen adjunta:" }];
                        m.images.forEach(imgBase64 => {
                            const mimeType = imgBase64.startsWith('/') ? 'image/jpeg' : (imgBase64.startsWith('iVB') ? 'image/png' : 'image/jpeg');
                            contentArr.push({ type: "image_url", image_url: { url: `data:${mimeType};base64,${imgBase64}` } });
                        });
                        const newM = { ...m, content: contentArr };
                        delete newM.images;
                        return newM;
                    }
                    return m;
                });
            }
            
            let maxTok = parseInt(state.settings.maxTokens || 4096);
            // Cap max_tokens for Groq (hard limit usually 8192 for output tokens)
            if (state.settings.provider === 'groq' && maxTok > 8192) {
                maxTok = 8192;
            }

            let reqBody = {
                model: state.settings.model,
                messages: messages,
                stream: true,
                temperature: parseFloat(state.settings.temperature),
                top_p: parseFloat(state.settings.topP || 0.9),
                max_tokens: maxTok
            };
            
            // Add top_k only for providers that definitely support it (Ollama, Claude, Gemini)
            // Removed groq as it rejects the property
            if (['ollama', 'claude', 'gemini'].includes(state.settings.provider)) {
                reqBody.top_k = parseInt(state.settings.topK || 40);
            }
            
            // Only include stream_options if exactly OpenAI (many others fail or rate-limit on this)
            if (state.settings.provider === 'openai') {
                reqBody.stream_options = { include_usage: true };
            }
            
            if (dom.toolInternet.classList.contains('active') && state.capabilities.includes('tools')) {
                reqBody.tools = [buildWikipediaTool()];
            }
            
            const response = await fetch(`${state.settings.ollamaUrl}/chat/completions`, {
                method: 'POST', headers, body: JSON.stringify(reqBody),
                signal: state.abortController.signal,
            });
            
            if (!response.ok) {
                let errorDetail = response.statusText;
                try {
                    const errorJson = await response.json();
                    // OpenRouter/Groq/OpenAI error nesting variants
                    errorDetail = errorJson.error?.message || errorJson.message || (errorJson.error && typeof errorJson.error === 'string' ? errorJson.error : errorDetail);
                } catch(e) {}
                throw new Error(`${response.status}: ${errorDetail}`);
            }
            
            reader_decoder.reader = response.body.getReader();
            
            while (true) {
                const { done, value } = await reader_decoder.reader.read();
                if (done) break;
                buffer += reader_decoder.decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;
                    const jsonStr = trimmed.substring(6);
                    if (jsonStr === '[DONE]') continue;
                    try {
                        const json = JSON.parse(jsonStr);
                        if (json.usage) {
                            assistantMsg.metrics = {
                                prompt_eval_count: json.usage.prompt_tokens,
                                eval_count: json.usage.completion_tokens,
                                total_tokens: json.usage.total_tokens,
                                total_time_ms: Date.now() - startTime
                            };
                            if (assistantMsg.metrics.eval_count && assistantMsg.metrics.total_time_ms > 0) {
                                assistantMsg.metrics.tps = (assistantMsg.metrics.eval_count / (assistantMsg.metrics.total_time_ms / 1000)).toFixed(2);
                            }
                        }
                        const delta = json.choices?.[0]?.delta || {};
                        const toolCallsData = delta.tool_calls;
                        if (toolCallsData && toolCallsData.length > 0) {
                            if (!pendingToolCall) {
                                pendingToolCall = [{ function: { name: toolCallsData[0].function.name, arguments: "" } }];
                            } else if (toolCallsData[0].function?.arguments) {
                                partialToolCallArgs += toolCallsData[0].function.arguments;
                            }
                        }
                        if (json.choices?.[0]?.finish_reason === 'tool_calls' && pendingToolCall) {
                            pendingToolCall[0].function.arguments = partialToolCallArgs || '{}';
                            pendingToolCall[0].function.arguments = JSON.parse(pendingToolCall[0].function.arguments);
                        }
                        const token = delta.content || '';
                        if (token) {
                            processStreamToken(token, assistantMsg, msgIdx, { isInThinking, thinkingText, responseText });
                            isInThinking = streamState.isInThinking;
                            thinkingText = streamState.thinkingText;
                            responseText = streamState.responseText;
                        }
                    } catch(e) {}
                }
            }
            
        } else if (provType === 'gemini') {
            // Google Gemini streaming
            const apiKey = state.settings.apiKey;
            const geminiMessages = buildGeminiMessages(chat);
            
            let reqBody = {
                contents: geminiMessages.contents,
                generationConfig: {
                    temperature: parseFloat(state.settings.temperature),
                    topP: parseFloat(state.settings.topP || 0.9),
                    topK: parseInt(state.settings.topK || 40),
                    maxOutputTokens: parseInt(state.settings.maxTokens || 4096)
                }
            };
            if (geminiMessages.systemInstruction) {
                reqBody.system_instruction = geminiMessages.systemInstruction;
            }
            
            const response = await fetch(
                `${state.settings.ollamaUrl}/models/${state.settings.model}:streamGenerateContent?alt=sse&key=${apiKey}`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reqBody), signal: state.abortController.signal }
            );
            if (!response.ok) throw new Error(`Error: ${response.status} ${response.statusText}`);
            
            reader_decoder.reader = response.body.getReader();
            
            while (true) {
                const { done, value } = await reader_decoder.reader.read();
                if (done) break;
                buffer += reader_decoder.decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;
                    const jsonStr = trimmed.substring(6);
                    try {
                        const json = JSON.parse(jsonStr);
                        // Gemini thinking via thought field
                        const parts = json.candidates?.[0]?.content?.parts || [];
                        for (const part of parts) {
                            if (part.thought) {
                                thinkingText += part.text || '';
                                assistantMsg.thinking = thinkingText;
                                updateStreamingMessage(msgIdx, assistantMsg);
                            } else if (part.text) {
                                responseText += part.text;
                                assistantMsg.content = responseText;
                                updateStreamingMessage(msgIdx, assistantMsg);
                            }
                        }
                        // Usage metrics
                        if (json.usageMetadata) {
                            assistantMsg.metrics = {
                                prompt_eval_count: json.usageMetadata.promptTokenCount,
                                eval_count: json.usageMetadata.candidatesTokenCount,
                                total_tokens: json.usageMetadata.totalTokenCount,
                                total_time_ms: Date.now() - startTime
                            };
                            if (assistantMsg.metrics.eval_count && assistantMsg.metrics.total_time_ms > 0) {
                                assistantMsg.metrics.tps = (assistantMsg.metrics.eval_count / (assistantMsg.metrics.total_time_ms / 1000)).toFixed(2);
                            }
                        }
                    } catch(e) {}
                }
            }
            
        } else if (provType === 'anthropic') {
            // Anthropic Messages API streaming
            const anthropicData = buildAnthropicMessages(chat);
            
            let reqBody = {
                model: state.settings.model,
                messages: anthropicData.messages,
                max_tokens: parseInt(state.settings.maxTokens || 8192),
                stream: true,
                temperature: parseFloat(state.settings.temperature),
                top_p: parseFloat(state.settings.topP || 0.9),
                top_k: parseInt(state.settings.topK || 40)
            };
            if (anthropicData.system) {
                reqBody.system = anthropicData.system;
            }
            
            const response = await fetch(`${state.settings.ollamaUrl}/messages`, {
                method: 'POST', headers, body: JSON.stringify(reqBody),
                signal: state.abortController.signal,
            });
            if (!response.ok) throw new Error(`Error: ${response.status} ${response.statusText}`);
            
            reader_decoder.reader = response.body.getReader();
            let currentBlockType = null;
            
            while (true) {
                const { done, value } = await reader_decoder.reader.read();
                if (done) break;
                buffer += reader_decoder.decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;
                    const jsonStr = trimmed.substring(6);
                    try {
                        const json = JSON.parse(jsonStr);
                        
                        if (json.type === 'content_block_start') {
                            currentBlockType = json.content_block?.type || 'text';
                        } else if (json.type === 'content_block_delta') {
                            const delta = json.delta || {};
                            if (delta.type === 'thinking_delta') {
                                thinkingText += delta.thinking || '';
                                assistantMsg.thinking = thinkingText;
                                updateStreamingMessage(msgIdx, assistantMsg);
                            } else if (delta.type === 'text_delta') {
                                responseText += delta.text || '';
                                assistantMsg.content = responseText;
                                updateStreamingMessage(msgIdx, assistantMsg);
                            }
                        } else if (json.type === 'message_delta') {
                            if (json.usage) {
                                assistantMsg.metrics = {
                                    eval_count: json.usage.output_tokens,
                                    total_time_ms: Date.now() - startTime
                                };
                                if (assistantMsg.metrics.eval_count && assistantMsg.metrics.total_time_ms > 0) {
                                    assistantMsg.metrics.tps = (assistantMsg.metrics.eval_count / (assistantMsg.metrics.total_time_ms / 1000)).toFixed(2);
                                }
                            }
                        } else if (json.type === 'message_start' && json.message?.usage) {
                            assistantMsg.metrics = assistantMsg.metrics || {};
                            assistantMsg.metrics.prompt_eval_count = json.message.usage.input_tokens;
                        }
                    } catch(e) {}
                }
            }
        }
        
        // Tool Call Proxy Logic (Ollama & OpenAI)
        if (pendingToolCall && pendingToolCall.length > 0) {
            state.isStreaming = false;
            
            assistantMsg.content = "*(Buscando en Internet...)*\n\n";
            assistantMsg.tool_calls = pendingToolCall;
            updateStreamingMessage(msgIdx, assistantMsg);
            
            const tool = pendingToolCall[0];
            let searchResult = "No results.";
            
            if (tool.function.name === 'search_wikipedia') {
                try {
                    const q = encodeURIComponent(tool.function.arguments.query);
                    const wpRes = await fetch(`https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&utf8=&format=json&origin=*`);
                    const wpData = await wpRes.json();
                    if (wpData.query && wpData.query.search.length > 0) {
                        searchResult = wpData.query.search.slice(0, 3).map(s => s.snippet.replace(/<[^>]+>/g, '')).join('\\n\\n');
                    } else {
                        searchResult = "Empty results.";
                    }
                } catch(e) {
                    searchResult = "Error connecting to Wikipedia.";
                }
            }
            
            const toolMsg = { role: 'tool', content: searchResult };
            chat.messages.push(toolMsg);
            
            const loopMessages = buildApiMessages(chat);
            return sendMessage('', loopMessages);
        }
        
    } catch (e) {
        if (e.name === 'AbortError') {
            assistantMsg.content += '\n\n*[Generación detenida]*';
        } else {
            console.error('Chat error:', e);
            const provName = getProviderDef(state.settings.provider).name;
            assistantMsg.content = `⚠️ **Error de conexión con ${provName}**\n\n\`${e.message}\`\n\nVerifica que el proveedor está configurado correctamente y que la API Key (si aplica) es válida.`;
        }
        updateStreamingMessage(msgIdx, assistantMsg);
    } finally {
        state.isStreaming = false;
        state.abortController = null;
        dom.stopBtn.classList.add('hidden');
        dom.sendBtn.classList.remove('hidden');
        chat.updatedAt = Date.now();
        saveState();
        renderChatList();
        renderMessages();
    }
}

// ─── Stream token processor (shared state) ──
const streamState = { isInThinking: false, thinkingText: '', responseText: '' };

function processStreamToken(token, assistantMsg, msgIdx, ctx) {
    streamState.isInThinking = ctx.isInThinking;
    streamState.thinkingText = ctx.thinkingText;
    streamState.responseText = ctx.responseText;
    
    if (token.includes('<|think|>') || token.includes('<think>')) {
        streamState.isInThinking = true;
        return;
    }
    if (token.includes('<|/think|>') || token.includes('</think>')) {
        streamState.isInThinking = false;
        return;
    }
    
    if (streamState.isInThinking) {
        streamState.thinkingText += token;
        assistantMsg.thinking = streamState.thinkingText;
    } else {
        streamState.responseText += token;
        assistantMsg.content = streamState.responseText;
    }
    updateStreamingMessage(msgIdx, assistantMsg);
}

function buildWikipediaTool() {
    return {
        type: "function",
        function: {
            name: "search_wikipedia",
            description: "Busca información y artículos reales recientes en Wikipedia.",
            parameters: {
                type: "object",
                properties: { query: { type: "string", description: "El término o pregunta exacta a buscar." } },
                required: ["query"]
            }
        }
    };
}

// ─── Message builders per provider type ─────
function buildApiMessages(chat) {
    const provType = getProviderDef(state.settings.provider).type;
    
    // For Gemini and Anthropic, use their specific builders during streaming
    // This function is used for Ollama & OpenAI-compatible
    const messages = [];
    const proj = state.projects.find(p => p.id === chat.projectId) || getActiveProject();
    
    let combinedSystem = '';
    if (state.settings.systemPrompt.trim()) combinedSystem += state.settings.systemPrompt + '\n\n';
    if (proj.systemPrompt && proj.systemPrompt.trim()) combinedSystem += `[INSTRUCCIONES DEL PROYECTO]: ${proj.systemPrompt}\n\n`;
    
    if (proj.documents && proj.documents.length > 0) {
        combinedSystem += '[BASE DE CONOCIMIENTO PERMANENTE DEL PROYECTO]:\n';
        proj.documents.forEach(doc => {
            combinedSystem += `\n--- Archivo Base: ${doc.name} ---\n${doc.data}\n`;
        });
        combinedSystem += '\nUtiliza la información estricta de esta Base de Conocimiento si aplica.\n\n';
    }
    
    if (combinedSystem.trim()) {
        messages.push({ role: 'system', content: combinedSystem.trim() });
    }
    
    for (const msg of chat.messages) {
        if (msg.role === 'assistant' && msg.content === '' && msg.thinking === '' && !msg.tool_calls) continue;
        const apiMsg = { role: msg.role, content: msg.content };
        if (msg.images) apiMsg.images = msg.images;
        if (msg.tool_calls) apiMsg.tool_calls = msg.tool_calls;
        messages.push(apiMsg);
    }
    return messages;
}

function buildGeminiMessages(chat) {
    const proj = state.projects.find(p => p.id === chat.projectId) || getActiveProject();
    
    let systemText = '';
    if (state.settings.systemPrompt.trim()) systemText += state.settings.systemPrompt + '\n\n';
    if (proj.systemPrompt && proj.systemPrompt.trim()) systemText += `[INSTRUCCIONES DEL PROYECTO]: ${proj.systemPrompt}\n\n`;
    if (proj.documents && proj.documents.length > 0) {
        systemText += '[BASE DE CONOCIMIENTO]:\n';
        proj.documents.forEach(doc => { systemText += `\n--- ${doc.name} ---\n${doc.data}\n`; });
    }
    
    const contents = [];
    for (const msg of chat.messages) {
        if (msg.role === 'assistant' && msg.content === '' && msg.thinking === '') continue;
        if (msg.role === 'system' || msg.role === 'tool') continue;
        
        const role = msg.role === 'assistant' ? 'model' : 'user';
        const parts = [];
        
        if (msg.images && msg.images.length > 0) {
            msg.images.forEach(imgBase64 => {
                const mimeType = imgBase64.startsWith('/') ? 'image/jpeg' : 'image/png';
                parts.push({ inline_data: { mime_type: mimeType, data: imgBase64 } });
            });
        }
        parts.push({ text: msg.content || '' });
        contents.push({ role, parts });
    }
    
    return {
        systemInstruction: systemText.trim() ? { parts: [{ text: systemText.trim() }] } : null,
        contents
    };
}

function buildAnthropicMessages(chat) {
    const proj = state.projects.find(p => p.id === chat.projectId) || getActiveProject();
    
    let systemText = '';
    if (state.settings.systemPrompt.trim()) systemText += state.settings.systemPrompt + '\n\n';
    if (proj.systemPrompt && proj.systemPrompt.trim()) systemText += `[INSTRUCCIONES DEL PROYECTO]: ${proj.systemPrompt}\n\n`;
    if (proj.documents && proj.documents.length > 0) {
        systemText += '[BASE DE CONOCIMIENTO]:\n';
        proj.documents.forEach(doc => { systemText += `\n--- ${doc.name} ---\n${doc.data}\n`; });
    }
    
    const messages = [];
    for (const msg of chat.messages) {
        if (msg.role === 'system' || msg.role === 'tool') continue;
        if (msg.role === 'assistant' && msg.content === '' && msg.thinking === '') continue;
        
        const role = msg.role; // 'user' or 'assistant'
        const content = [];
        
        if (msg.images && msg.images.length > 0) {
            msg.images.forEach(imgBase64 => {
                const mimeType = imgBase64.startsWith('/') ? 'image/jpeg' : 'image/png';
                content.push({ type: 'image', source: { type: 'base64', media_type: mimeType, data: imgBase64 } });
            });
        }
        content.push({ type: 'text', text: msg.content || '' });
        messages.push({ role, content });
    }
    
    // Anthropic requires alternating user/assistant. Ensure first message is user.
    if (messages.length > 0 && messages[0].role !== 'user') {
        messages.unshift({ role: 'user', content: [{ type: 'text', text: '.' }] });
    }
    
    return {
        system: systemText.trim() || undefined,
        messages
    };
}

function appendTypingMessage(idx) {
    const avatarContent = '<img src="favicon.png" style="width: 22px; height: 22px; border-radius: 4px; object-fit: contain;">';
    const html = `
        <div class="message assistant" id="msg-${idx}">
            <div class="message-inner">
                <div class="message-avatar">${avatarContent}</div>
                <div class="message-body">
                    <div class="message-sender"></div>
                    <div class="message-content">
                            <span></span><span></span><span></span>
                    </div>
                </div>
            </div>
        </div>
    `;
    dom.messagesScroll.insertAdjacentHTML('beforeend', html);
    scrollToBottom();
}

function updateStreamingMessage(idx, msg) {
    const msgEl = document.getElementById(`msg-${idx}`);
    if (!msgEl) return;

    const contentEl = msgEl.querySelector('.message-content');
    let html = '';

    if (msg.thinking && state.settings.thinkingMode) {
        html += `
            <div class="thinking-block">
                <div class="thinking-header open">
                    ${state.isStreaming && !msg.content ? '<div class="thinking-spinner"></div>' : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 18 6-6-6-6"/></svg>`}
                    Razonamiento
                </div>
                <div class="thinking-content open">${renderMarkdown(msg.thinking)}</div>
            </div>
        `;
    }

    if (msg.content) {
        html += renderMarkdown(msg.content);
    } else if (state.isStreaming && !msg.thinking) {
        html += `<div class="typing-indicator"><span></span><span></span><span></span></div>`;
    }

    contentEl.innerHTML = html;
    processCodeBlocks();
    scrollToBottom();
}

function stopStreaming() {
    if (state.abortController) {
        state.abortController.abort();
    }
}

// ─── Event Bindings ─────────────────────────
function bindEvents() {
    // Send message
    dom.sendBtn.addEventListener('click', () => {
        sendMessage(dom.messageInput.value);
    });

    dom.messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!dom.sendBtn.disabled) {
                sendMessage(dom.messageInput.value);
            }
        }
    });

    dom.messageInput.addEventListener('input', () => {
        autoResizeTextarea();
        updateSendButton();
    });

    // Stop streaming
    dom.stopBtn.addEventListener('click', stopStreaming);

    // New chat
    if(dom.mobileNewChat) dom.mobileNewChat.addEventListener('click', createChat);
    if(dom.desktopNewChatToggle) dom.desktopNewChatToggle.addEventListener('click', createChat);

    // Search chats
    dom.searchChats.addEventListener('input', renderChatList);

    // Welcome cards
    $$('.welcome-card').forEach(card => {
        card.addEventListener('click', () => {
            const prompt = card.dataset.prompt;
            dom.messageInput.value = prompt;
            autoResizeTextarea();
            updateSendButton();
            dom.messageInput.focus();
        });
    });

    // Settings Modal
    dom.menuBtn.addEventListener('click', toggleSidebar); // in mobile side? wait...

    dom.providerSelect?.addEventListener('change', (e) => {
        // Save current provider config before switching
        saveCurrentProviderConfig();
        
        // Switch to new provider
        state.settings.provider = e.target.value;
        syncProviderToState();
        
        // Update UI with new provider's config
        dom.ollamaUrl.value = state.settings.ollamaUrl;
        if (dom.apiKeyInput) dom.apiKeyInput.value = state.settings.apiKey || '';
        dom.modelSelect.innerHTML = `<option value="${state.settings.model}" selected>${state.settings.model}</option>`;
        
        updateProviderUI();
        saveState();
        checkProviderStatus();
    });
    
    // API Key toggle visibility
    dom.apiKeyToggle?.addEventListener('click', () => {
        const input = dom.apiKeyInput;
        if (input) {
            input.type = input.type === 'password' ? 'text' : 'password';
        }
    });

    $('#settingsBtn').addEventListener('click', () => {
        applySettingsToUI();
        dom.settingsModal.classList.remove('hidden');
    });

    $('#closeSettings').addEventListener('click', () => {
        dom.settingsModal.classList.add('hidden');
    });

    if (dom.refreshModels) {
        dom.refreshModels.addEventListener('click', () => {
            const originalText = dom.refreshModels.textContent;
            dom.refreshModels.textContent = '🔄 Cargando...';
            checkProviderStatus().finally(() => {
                dom.refreshModels.textContent = originalText;
            });
        });
    }

    if (dom.themeSelect) {
        dom.themeSelect.addEventListener('change', () => {
            document.documentElement.setAttribute('data-theme', dom.themeSelect.value);
        });
    }

    dom.temperature.addEventListener('input', () => {
        dom.tempValue.textContent = dom.temperature.value;
    });
    dom.topP?.addEventListener('input', () => {
        dom.topPValue.textContent = dom.topP.value;
    });
    dom.topK?.addEventListener('input', () => {
        dom.topKValue.textContent = dom.topK.value;
    });
    dom.maxTokens?.addEventListener('input', () => {
        dom.maxTokensValue.textContent = dom.maxTokens.value;
    });

    if ($('#btnFilterFree')) {
        $('#btnFilterFree').addEventListener('click', (e) => {
            e.currentTarget.classList.toggle('active');
            if (state.rawModels) populateModels(state.rawModels);
        });
    }

    if (dom.memorizeIpBtn && typeof SecureGate !== 'undefined') {
        dom.memorizeIpBtn.addEventListener('click', () => {
            if (SecureGate.addCurrentIpToWhitelist()) {
                renderIpWhitelist();
            }
        });
    }

    if (dom.modelSearchInput) {
        dom.modelSearchInput.addEventListener('input', () => {
            if (state.rawModels) populateModels(state.rawModels);
        });
    }

    $('#saveSettings').addEventListener('click', () => {
        state.settings.ollamaUrl = dom.ollamaUrl.value.replace(/\/+$/, '');
        if (dom.themeSelect) state.settings.theme = dom.themeSelect.value;
        state.settings.model = dom.modelSelect.value;
        state.settings.temperature = parseFloat(dom.temperature.value);
        state.settings.topP = parseFloat(dom.topP?.value || 0.9);
        state.settings.topK = parseInt(dom.topK?.value || 40);
        state.settings.maxTokens = parseInt(dom.maxTokens?.value || 4096);
        state.settings.systemPrompt = dom.systemPrompt.value;
        state.settings.thinkingMode = dom.thinkingMode.checked;
        state.settings.apiKey = dom.apiKeyInput?.value || '';
        saveState();
        applySettingsToUI();
        dom.settingsModal.classList.add('hidden');
        checkProviderStatus();
    });

    $('#resetSettings').addEventListener('click', () => {
        const defaultProvider = 'ollama';
        state.settings.provider = defaultProvider;
        state.settings.ollamaUrl = PROVIDERS[defaultProvider].defaultUrl;
        state.settings.model = PROVIDERS[defaultProvider].defaultModel;
        state.settings.apiKey = '';
        state.settings.theme = 'dark';
        state.settings.temperature = 0.7;
        state.settings.systemPrompt = `# System Prompt: Asistente IA Experto

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
*Última actualización: 10/04/2026*`;
        state.settings.thinkingMode = true;
        state.settings.topP = 0.9;
        state.settings.topK = 40;
        state.settings.maxTokens = 4096;
        // Reset providerConfigs to defaults
        for (const [key, prov] of Object.entries(PROVIDERS)) {
            state.settings.providerConfigs[key] = { url: prov.defaultUrl, model: prov.defaultModel, apiKey: '' };
        }
        applySettingsToUI();
    });

    $('#hardResetBtn')?.addEventListener('click', () => {
        if (confirm('⚠️ ¿Estás completamente seguro de que quieres BORRAR de fábrica wIA?')) {
            localStorage.removeItem('antigravity_projects');
            localStorage.removeItem('antigravity_settings');
            location.reload();
        }
    });

    // Delete modal
    let chatToDelete = null;

    window.showDeleteModal = (chatId) => {
        chatToDelete = chatId;
        dom.deleteModal.classList.remove('hidden');
    };

    $('#confirmDelete').addEventListener('click', () => {
        if (chatToDelete) {
            deleteChat(chatToDelete);
            chatToDelete = null;
        }
        dom.deleteModal.classList.add('hidden');
    });

    $$('.close-delete-modal').forEach(btn => {
        btn.addEventListener('click', () => {
            dom.deleteModal.classList.add('hidden');
            chatToDelete = null;
        });
    });

    // Close modals on overlay click
    [dom.settingsModal, dom.deleteModal, dom.moveModal, dom.privacyModal].forEach(modal => {
        if(modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.classList.add('hidden');
            });
        }
    });

    // Improve Prompt
    dom.improvePromptBtn?.addEventListener('click', improvePrompt);

    // Privacy Modal
    dom.openPrivacy?.addEventListener('click', (e) => {
        e.preventDefault();
        dom.privacyModal.classList.remove('hidden');
    });

    [dom.closePrivacy, dom.closePrivacyBtn].forEach(btn => {
        btn?.addEventListener('click', () => {
            dom.privacyModal.classList.add('hidden');
        });
    });

    // Toolbar events
    dom.sidebarNewChatBtn?.addEventListener('click', () => {
        createChat();
        dom.messageInput.focus();
    });
    
    dom.attachBtn.addEventListener('click', () => dom.fileUpload.click());
    dom.fileUpload.addEventListener('change', (e) => handleFiles(e.target.files));
    dom.attachmentPreview.addEventListener('click', (e) => {
        if (e.target.classList.contains('attachment-remove')) {
            removeAttachment(e.target.dataset.id);
        }
    });

    dom.toolInternet.addEventListener('click', () => {
        dom.toolInternet.classList.toggle('active');
    });

    dom.toolThinking.addEventListener('click', () => {
        dom.toolThinking.classList.toggle('active');
        state.settings.thinkingMode = dom.toolThinking.classList.contains('active');
        dom.thinkingMode.checked = state.settings.thinkingMode;
        saveState();
    });

    // Project Settings Modal
    dom.projectSelect.addEventListener('change', (e) => {
        switchProject(e.target.value);
    });

    dom.newProjectBtn.addEventListener('click', () => {
        const name = prompt("Nombre del Nuevo Proyecto (Workspace):", "Nuevo Proyecto");
        if (name && name.trim()) {
            createProject(name.trim());
        }
    });

    dom.projectSettingsBtn.addEventListener('click', () => {
        const proj = getActiveProject();
        dom.projectName.value = proj.name;
        dom.projectPrompt.value = proj.systemPrompt || '';
        if (proj.id === 'general') {
            dom.projectName.disabled = true;
            dom.deleteProjectBtn.style.display = 'none';
        } else {
            dom.projectName.disabled = false;
            dom.deleteProjectBtn.style.display = 'block';
        }
        renderProjectDocList();
        dom.projectModal.classList.remove('hidden');
    });

    [dom.closeProjectModal, dom.closeProjectModal2].forEach(btn => {
        btn.addEventListener('click', () => dom.projectModal.classList.add('hidden'));
    });

    dom.saveProjectBtn.addEventListener('click', () => {
        const proj = getActiveProject();
        if (proj.id !== 'general') proj.name = dom.projectName.value.trim() || proj.name;
        proj.systemPrompt = dom.projectPrompt.value.trim();
        saveState();
        renderProjectSelect();
        dom.projectModal.classList.add('hidden');
    });

    dom.deleteProjectBtn.addEventListener('click', () => {
        if (confirm(`¿Estás seguro de que quieres eliminar el proyecto ${getActiveProject().name} y TODOS sus chats contenidos?`)) {
            deleteProject(state.activeProjectId);
            dom.projectModal.classList.add('hidden');
        }
    });

    // Project Documents (Knowledge Base)
    dom.attachProjectDocsBtn.addEventListener('click', () => dom.projectFileUpload.click());
    dom.projectFileUpload.addEventListener('change', (e) => handleProjectFiles(e.target.files));

    // Move Modal Logics
    let chatToMove = null;

    window.showMoveModal = (chatId) => {
        chatToMove = chatId;
        const currentChat = state.chats.find(c => c.id === chatId);
        dom.moveProjectSelect.innerHTML = state.projects.map(p => 
            `<option value="${p.id}" ${p.id === currentChat.projectId ? 'disabled' : ''}>${escapeHtml(p.name)} ${p.id === currentChat.projectId ? '(Actual)' : ''}</option>`
        ).join('');
        dom.moveModal.classList.remove('hidden');
    };

    $('#confirmMove')?.addEventListener('click', () => {
        const targetProjId = dom.moveProjectSelect?.value;
        if (chatToMove && targetProjId) {
            const c = state.chats.find(c => c.id === chatToMove);
            if (c && c.projectId !== targetProjId) {
                c.projectId = targetProjId;
                saveState();
                if (state.activeChatId === chatToMove) {
                    state.activeChatId = null;
                    dom.welcomeScreen.classList.remove('hidden');
                    dom.messagesContainer.classList.add('hidden');
                }
                renderChatList();
            }
        }
        dom.moveModal.classList.add('hidden');
        chatToMove = null;
    });

    $$('.close-move-modal').forEach(btn => {
        btn.addEventListener('click', () => {
            dom.moveModal.classList.add('hidden');
            chatToMove = null;
        });
    });

    // Mobile sidebar
    dom.menuBtn.addEventListener('click', toggleSidebar);

    // Desktop Sidebar Toggles (Dual)
    const collapseBtn = $('#sidebarCollapseBtn');
    if (collapseBtn) {
        collapseBtn.addEventListener('click', () => {
            dom.sidebar.classList.add('collapsed');
            document.body.classList.add('sidebar-collapsed');
        });
    }

    const desktopToggle = $('#desktopSidebarToggle');
    if (desktopToggle) {
        desktopToggle.addEventListener('click', () => {
            dom.sidebar.classList.remove('collapsed');
            document.body.classList.remove('sidebar-collapsed');
        });
    }

    // Thinking block toggle (event delegation)
    dom.messagesScroll.addEventListener('click', (e) => {
        const header = e.target.closest('.thinking-header');
        if (header) {
            header.classList.toggle('open');
            const content = header.nextElementSibling;
            if (content) content.classList.toggle('open');
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + N = New chat
        if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
            e.preventDefault();
            createChat();
        }
        // Escape = close modals
        if (e.key === 'Escape') {
            dom.settingsModal.classList.add('hidden');
            dom.deleteModal.classList.add('hidden');
            closeSidebar();
        }
    });
}

// ─── Mobile Sidebar ─────────────────────────
function toggleSidebar() {
    dom.sidebar.classList.toggle('open');
    let overlay = document.querySelector('.sidebar-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', closeSidebar);
    }
    overlay.classList.toggle('active');
}

function closeSidebar() {
    dom.sidebar.classList.remove('open');
    const overlay = document.querySelector('.sidebar-overlay');
    if (overlay) overlay.classList.remove('active');
}

// ─── Helpers ────────────────────────────────
function autoResizeTextarea() {
    const ta = dom.messageInput;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
    const count = ta.value.length;
    dom.charCount.textContent = count > 0 ? `${count}` : '';
}

function updateSendButton() {
    dom.sendBtn.disabled = !dom.messageInput.value.trim() || state.isStreaming;
}

function scrollToBottom() {
    requestAnimationFrame(() => {
        dom.messagesScroll.scrollTop = dom.messagesScroll.scrollHeight;
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Ahora';
    if (minutes < 60) return `Hace ${minutes} min`;
    if (hours < 24) return `Hace ${hours}h`;
    if (days < 7) return `Hace ${days}d`;
    return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

// ─── Start ──────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    if (typeof SecureGate !== 'undefined') {
        SecureGate.init(() => init());
    } else {
        init();
    }
});
