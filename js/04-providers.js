/* ============================================
   wIA — 04-providers.js
   Conexión a proveedores, metadatos de modelos y gestión de modelos Ollama
   (Scripts clásicos cargados en orden desde index.html;
   comparten el ámbito global igual que el antiguo app.js)
   ============================================ */

// ─── Backend Connection ──────────────────────
async function checkProviderStatus() {
    dom.statusDot.className = 'status-dot loading';
    dom.statusText.textContent = 'Verificando...';
    updateStatusMeta();
    
    const prov = getProviderDef(state.settings.provider);
    const provType = prov.type;
    
    try {
        let models = [];
        const headers = getAuthHeaders();
        
        if (provType === 'ollama') {
            // Ollama native API
            const url = `${state.settings.ollamaUrl}/api/tags`;
            const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
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
            const url = `${state.settings.ollamaUrl}/models?key=${apiKey}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
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
                const res = await fetch(`${state.settings.ollamaUrl}/models?limit=100`, {
                    headers,
                    signal: AbortSignal.timeout(8000)
                });
                if (!res.ok) {
                    let errorText = res.statusText;
                    try {
                        const errorJson = await res.json();
                        errorText = errorJson.error?.message || errorText;
                    } catch (e) {}
                    throw new Error(`${res.status}: ${errorText}`);
                }
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

            state.rawModels = models;
            populateModels(models);

            // Check if currently selected model is already loaded
            if (webgpuState.loadedModelId === state.settings.model) {
                dom.statusText.textContent = '🧠 Modelo cargado';
            }

            await fetchModelCapabilities(state.settings.model);
            updateInputDisclaimer();
            updateStatusMeta();
            return; // Skip further common logic
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
        updateStatusMeta();
    } catch (e) {
        dom.statusDot.className = 'status-dot offline';
        const isCors = e.message?.includes('Failed to fetch') || e.message?.includes('CORS');
        dom.statusText.textContent = isCors ? 'Error CORS (Configuración req.)' : 'Desconectado';
        dom.improvePromptBtn?.classList.add('hidden');
        
        if (isCors) {
            console.warn('Ollama Connection Error: Possible CORS issue. To fix run instructions in help modal.');
            dom.corsWarningBadge.classList.remove('hidden');
        } else {
            dom.corsWarningBadge.classList.add('hidden');
        }

        if (dom.modelSelect.options.length === 0 || dom.modelSelect.innerHTML.includes('Cargando modelos')) {
            dom.modelSelect.innerHTML = `<option value="${state.settings.model}" selected>${state.settings.model} (Offline)</option>`;
        }
        updateStatusMeta();
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
    if (typeof model?.size === 'number') return model.size;
    if (typeof model?.size_vram === 'number') return model.size_vram / (1024 * 1024);
    const text = String(model?.size || '').toLowerCase();
    const match = text.match(/([\d.]+)\s*(gb|mb)/);
    if (!match) return null;
    const value = parseFloat(match[1]);
    return match[2] === 'gb' ? value * 1024 : value;
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
    if (/(think|reason|reasoning|r1|qwq|o1|o3|deepseek|math)/.test(name)) keys.add('thinking');
    if (/(coder|codex|code|devstral|deepcoder)/.test(name)) keys.add('coding');
    if (/(tool|function|gpt-4\.1|gpt-4o|gemini|claude|llama-3\.3|qwen2\.5|qwen3)/.test(name)) keys.add('tools');
    if (/(qwen|gemma|llama|gemini|claude|ministral|mistral|multilingual)/.test(name)) keys.add('multilingual');
    if (/(tiny|mini|flash|haiku|turbo|360m|0\.5b|1b|1\.5b)/.test(name)) keys.add('fast');
    if (/(7b|8b|11b|70b|72b|405b|large|apertus-8b)/.test(name)) keys.add('large');

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
    const isActive = m.name === currentSelection;
    const isFav = isFavoriteModel(m.name);
    const disabled = m.selectable === false;
    const tags = getModelTags(m);
    const star = `<button class="model-card-star ${isFav ? 'on' : ''}" title="${isFav ? 'Quitar de favoritos' : 'Marcar como favorito'}" onclick="event.stopPropagation(); toggleFavoriteModel('${escapeHtml(m.name)}')">${isFav ? '★' : '☆'}</button>`;
    const repoLink = m.repoUrl ? `<a href="${m.repoUrl}" target="_blank" rel="noopener noreferrer" class="model-card-link" title="Abrir ficha del modelo">Ver ficha</a>` : '';

    // Badge de estado (prioridad: cargado > caché > probado)
    let statusBadge = '';
    if (isWebGPU) {
        const isLoaded = webgpuState.loadedModelId === m.name;
        const isCached = webgpuState.cachedModelIds && webgpuState.cachedModelIds.has(m.name);
        if (isLoaded) statusBadge = '<span class="model-status-badge loaded" title="Modelo cargado en memoria">● Cargado</span>';
        else if (isCached) statusBadge = `<span class="model-status-badge cached" title="Guardado en la caché del navegador">💾 En caché <button class="model-card-delete-cache-btn" onclick="event.stopPropagation(); deleteWebGPUModelCache('${escapeHtml(m.name)}')" title="Borrar de la caché">🗑️</button></span>`;
        else if (m.verified) statusBadge = '<span class="model-status-badge verified" title="Probado: carga e infiere correctamente en WebGPU">✅ Probado</span>';
        else statusBadge = '<span class="model-status-badge untested" title="Sin verificar: puede tardar o no funcionar en tu equipo">⚠️ Sin verificar</span>';
    } else if (isActive) {
        statusBadge = '<span class="model-status-badge loaded">✓ Activo</span>';
    }

    const price = !isWebGPU ? getModelPrice(m) : null;
    const sizeStr = m.size || (m.details?.parameter_size || (m.size_vram ? `${(m.size_vram/(1024*1024*1024)).toFixed(1)} GB` : ''));

    return `<div class="model-card ${isActive ? 'model-card-active' : ''} ${disabled ? 'model-card-disabled' : ''}" data-model="${escapeHtml(m.name)}" data-disabled="${disabled ? 'true' : 'false'}" title="${escapeHtml(m.desc || m.name)}">
        ${star}
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
    if (keys.includes('vision')) return { key: 'vision', label: '👁 Modelos con visión' };
    if (keys.includes('coding')) return { key: 'coding', label: '💻 Modelos para código' };
    if (keys.includes('thinking')) return { key: 'thinking', label: '🧠 Modelos analíticos' };
    if (keys.includes('multilingual')) return { key: 'multilingual', label: '🌍 Modelos multilingües' };
    return { key: 'general', label: '✨ Modelos generales' };
}

function populateModels(models) {
    const modelCardsContainer = document.getElementById('modelCardsContainer');
    if (!modelCardsContainer) return;

    if (!models || models.length === 0) {
        modelCardsContainer.innerHTML = `<div class="model-cards-empty">No hay modelos disponibles</div>`;
        if (dom.modelFunctionFilters) dom.modelFunctionFilters.innerHTML = '';
        // Also reset the hidden select
        dom.modelSelect.innerHTML = `<option value="">No hay modelos</option>`;
        return;
    }

    const isWebGPU = state.settings.provider === 'webgpu';
    state.rawModels = [...models];
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
            { key: 'manual',   label: '🧩 Añadidos manualmente', color: 'tier-manual' },
        ];

        let html = (linksHeader ? `<div class="model-cards-webgpu-header">${linksHeader}</div>` : '') + favHtml;

        tiers.forEach(tier => {
            const tierModels = filtered.filter(m => m.tier === tier.key);
            if (tierModels.length === 0) return;
            const isOpen = tier.key === 'quick' || tier.key === 'optional' || tier.key === 'manual';
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
        ['vision', 'coding', 'thinking', 'multilingual', 'general'].forEach(groupKey => {
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

            // Update hidden select value (used by saveSettings)
            dom.modelSelect.value = modelId;
            // Also store in state immediately for UI feedback
            state.settings.model = modelId;
            getActiveProviderConfig().model = modelId;
            fetchModelCapabilities(modelId);

            // Re-render to update active card
            if (state.rawModels) populateModels(state.rawModels);

            updateInputDisclaimer();
            updateStatusMeta();
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
        const firstSelectable = state.rawModels.find(m => m.selectable !== false) || state.rawModels[0];
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
            const sizeGB = (m.size / (1024 * 1024 * 1024)).toFixed(1);
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
        const isCors = e.message?.includes('Failed to fetch');
        const errorMessage = isCors 
            ? 'Error de Red/CORS: Abre Ollama con OLLAMA_ORIGINS="*" para permitir acceso desde wIA.'
            : e.message;
        
        dom.managedModelList.innerHTML = `
            <div style="text-align: center; color: var(--danger); padding: 20px;">
                <p>${errorMessage}</p>
                ${isCors ? '<p style="font-size: 0.7rem; color: var(--text-tertiary); margin-top: 10px; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px; user-select: all;">env OLLAMA_ORIGINS="*" ollama serve</p>' : ''}
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


