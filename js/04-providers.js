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
    return new Error(`${response.status}: ${detail}`);
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

    if (providerId === 'ollama') {
        items.push(
            ['1. Comprueba Ollama', `Confirma que Ollama está abierto y responde en ${escapeHtml(endpoint)}. Una conexión rechazada no es un error CORS.`],
            ['2. Autoriza el origen de wIA', 'Si Ollama responde fuera de wIA pero el navegador lo bloquea, configura OLLAMA_ORIGINS y reinicia completamente Ollama.<code class="connection-help-command">launchctl setenv OLLAMA_ORIGINS "*"</code><code class="connection-help-command">[System.Environment]::SetEnvironmentVariable(\'OLLAMA_ORIGINS\', \'*\', \'User\')</code>'],
            ['3. Reintenta', 'Vuelve a wIA después de reiniciar Ollama. Si continúa, revisa que la URL y el puerto sean correctos.']
        );
    } else if (providerId === 'lmstudio') {
        items.push(
            ['1. Inicia el servidor local', 'En LM Studio abre Developer/Local Server, carga un modelo y arranca el servidor.'],
            ['2. Revisa el endpoint y CORS', `La URL suele terminar en /v1 (actual: ${escapeHtml(endpoint)}). Habilita las peticiones desde navegador en la configuración del servidor.`]
        );
    } else if (providerId === 'ollama_remote') {
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

    const probeJsonEndpoint = async (url) => {
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
    priority.forEach(id => {
        state.providerAvailability[id] = {
            status: results[id] ? 'available' : 'unavailable',
            detail: results[id] ? 'Disponible' : (id === 'webgpu' && webgpuMode === 'wasm' ? 'Solo WASM' : 'No detectado'),
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
            
        } else if (provType === 'gemini') {
            // Gemini REST API
            const apiKey = state.settings.apiKey;
            if (!apiKey) throw new Error('API Key requerida');
            const url = `${baseUrl}/models?key=${encodeURIComponent(apiKey)}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
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
            
            // Scan Cache Storage
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

    if (['openai', 'gemini', 'anthropic'].includes(provType) || providerId === 'lmstudio') {
        state.capabilities = inferred;
        updateToolbarVisibility();
        return;
    }

    try {
        const res = await fetch(`${state.settings.ollamaUrl}/api/show`, {
            method: 'POST',
            body: JSON.stringify({ name: modelName })
        });
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

    if (providerId === 'gemini' || providerId === 'openai' || providerId === 'nvidia' || providerId === 'openrouter' || providerId === 'groq' || providerId === 'claude' || providerId === 'lmstudio') {
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
        alert('Pega un repo válido de Hugging Face o una URL completa, por ejemplo: onnx-community/Qwen2.5-Coder-7B-Instruct');
        return false;
    }

    const current = getWebGPUCustomModels();
    const alreadyExists = WEBGPU_MODELS.some(m => m.id === modelId) || current.some(m => m.id === modelId);
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
    if (!confirm(`¿Quitar «${def.label || modelId}» de tus modelos añadidos manualmente?\n\nSe eliminará del catálogo y se borrarán sus archivos de la caché del navegador. No afecta al repositorio original en Hugging Face.`)) {
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
        webgpuState.cachedModelIds = await getCachedWebGPUModels();
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
        active = true;
        const chatLabel = chatDef?.label || state.settings.model;
        if (chatDef?.omnimodal) {
            tip = `Visión omnimodal activa · ${chatLabel} recibe la imagen y responde directamente.`;
        } else {
            const assist = getVisionAssistDef();
            tip = `Cadena visual activa · ${assist.label} analiza tus imágenes → ${chatLabel} responde.`;
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
    const star = `<button class="model-card-star ${isFav ? 'on' : ''}" title="${isFav ? 'Quitar de favoritos' : 'Marcar como favorito'}" onclick="event.stopPropagation(); toggleFavoriteModel('${escapeHtml(m.name)}')">${isFav ? '★' : '☆'}</button>`;
    // Los modelos añadidos a mano se pueden quitar del catálogo
    const removeBtn = m.custom
        ? `<button class="model-card-remove" title="Quitar este modelo añadido manualmente" onclick="event.stopPropagation(); removeManualWebGPUModel('${escapeHtml(m.name)}')">🗑️</button>`
        : '';
    const repoLink = m.repoUrl ? `<a href="${m.repoUrl}" target="_blank" rel="noopener noreferrer" class="model-card-link" title="Abrir ficha del modelo">Ver ficha</a>` : '';

    // Badge de estado (prioridad: en uso como asistente > cargado > caché > probado)
    let statusBadge = '';
    if (isWebGPU) {
        const isLoaded = webgpuState.loadedModelId === m.name;
        const isCached = webgpuState.cachedModelIds && webgpuState.cachedModelIds.has(m.name);
        if (isVisionAssist && isActive) statusBadge = '<span class="model-status-badge loaded" title="Es el asistente visual que describe tus imágenes adjuntas">👁 En uso</span>';
        else if (isLoaded) statusBadge = '<span class="model-status-badge loaded" title="Modelo cargado en memoria">● Cargado</span>';
        else if (isCached) statusBadge = `<span class="model-status-badge cached" title="Guardado en la caché del navegador">💾 En caché <button class="model-card-delete-cache-btn" onclick="event.stopPropagation(); deleteWebGPUModelCache('${escapeHtml(m.name)}')" title="Borrar de la caché">🗑️</button></span>`;
        else if (m.verified) statusBadge = '<span class="model-status-badge verified" title="Probado: carga e infiere correctamente en WebGPU">✅ Probado</span>';
        else statusBadge = '<span class="model-status-badge untested" title="Sin verificar: puede tardar o no funcionar en tu equipo">⚠️ Sin verificar</span>';
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
        card.addEventListener('click', () => {
            const modelId = card.dataset.model;
            if (!modelId) return;
            if (card.dataset.disabled === 'true') {
                alert('Este modelo ya está identificado y catalogado, pero todavía no está habilitado para el chat WebGPU actual.');
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

    // Model manager button visibility
    const prov = getProviderDef(state.settings.provider);
    if (dom.manageModelsBtn) {
        dom.manageModelsBtn.style.display = (prov.type === 'ollama') ? 'inline-block' : 'none';
    }
}

// ─── Model Management Logic ──────────────────
async function openModelManager() {
    dom.modelManagerModal.classList.remove('hidden');
    renderManagedModelList();
}

async function renderManagedModelList() {
    const prov = getProviderDef(state.settings.provider);
    if (prov.type !== 'ollama') return;

    dom.managedModelList.innerHTML = '<p style="text-align: center; color: var(--text-tertiary); padding: 20px;">Cargando modelos locales...</p>';

    try {
        const headers = getAuthHeaders();
        const res = await fetch(`${state.settings.ollamaUrl}/api/tags`, { headers });
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
                        <span class="model-item-size">${sizeGB} GB — ${m.details?.parameter_size || 'N/A'}</span>
                    </div>
                    <button class="btn-icon remove-model-btn" onclick="deleteModel('${m.name}')" title="Eliminar modelo">
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
                ${needsDiagnosis ? '<button type="button" class="btn-secondary" onclick="document.getElementById(\'corsErrorModal\').classList.remove(\'hidden\')" style="margin-top:10px;">Ver diagnóstico</button>' : ''}
            </div>
        `;
    }
}

async function deleteModel(name) {
    if (!confirm(`¿Estás seguro de que quieres eliminar el modelo "${name}"? Esta acción liberará espacio en disco pero no se puede deshacer.`)) return;

    try {
        const headers = getAuthHeaders();
        const res = await fetch(`${state.settings.ollamaUrl}/api/delete`, {
            method: 'DELETE',
            headers,
            body: JSON.stringify({ name })
        });
        if (!res.ok) throw new Error('Fallo al eliminar el modelo');
        
        renderManagedModelList();
        checkProviderStatus(); // Refresh global catalogue
    } catch (e) {
        alert(`Error: ${e.message}`);
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
