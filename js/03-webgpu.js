/* ============================================
   wIA — 03-webgpu.js
   Runtime WebGPU: caché, soporte, carga inline, worker client y despachadores
   (Scripts clásicos cargados en orden desde index.html;
   comparten el ámbito global igual que el antiguo app.js)
   ============================================ */

// ─── WebGPU State ───────────────────────────
const webgpuState = {
    pipeline: null,           // Loaded transformers.js pipeline
    loadedModelId: null,      // ID of the currently loaded model
    loadedTask: null,         // Active task for the loaded pipeline
    imageAssistPipeline: null,// Auxiliary image-to-text pipeline
    imageAssistModelId: null, // Model ID for image assistance
    hfModule: null,           // Cached transformers.js module
    isLoading: false,         // Prevents concurrent loads
    supported: null,          // null = unknown, 'webgpu' | 'wasm' = detected
    fp16Supported: null,      // shader-f16 disponible en el adaptador
    executionMode: null,      // null = sin decidir, 'worker' | 'inline'
    activeStopper: null,      // StoppingCriteria de la generación inline en curso
    cancelRequested: false,   // Cooperative cancellation during model boot
    cachedModelIds: new Set(),// Set of model IDs currently cached in browser
    adapterInfo: null,        // { vendor, architecture, description } del adaptador
    adapterLimits: null,      // límites relevantes del adaptador (bytes)
};

// ─── Monitor de estado / memoria WebGPU ──────
async function getWebGPUAdapterDetails() {
    if (webgpuState.adapterInfo !== null) {
        return { info: webgpuState.adapterInfo, limits: webgpuState.adapterLimits };
    }
    let info = {}, limits = {};
    try {
        if (navigator.gpu) {
            const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
                || await navigator.gpu.requestAdapter();
            if (adapter) {
                info = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {}) || {};
                limits = {
                    maxBufferSize: adapter.limits?.maxBufferSize || 0,
                    maxStorageBufferBindingSize: adapter.limits?.maxStorageBufferBindingSize || 0,
                };
            }
        }
    } catch (e) { /* sin detalles del adaptador */ }
    webgpuState.adapterInfo = info;
    webgpuState.adapterLimits = limits;
    return { info, limits };
}

/**
 * releaseWebGPUMemory — descarga de memoria el pipeline y el worker de
 * inferencia (dispose + terminate) SIN borrar la caché de disco del navegador.
 * Libera VRAM/RAM sin obligar a redescargar el modelo la próxima vez.
 */
async function releaseWebGPUMemory() {
    if (state.isStreaming) { stopStreaming(); await new Promise(r => setTimeout(r, 300)); }
    try {
        if (webgpuState.pipeline && typeof webgpuState.pipeline.dispose === 'function') {
            await webgpuState.pipeline.dispose();
        }
    } catch (e) { console.warn('[WebGPU] error liberando pipeline inline:', e); }
    try {
        if (webgpuState.imageAssistPipeline && typeof webgpuState.imageAssistPipeline.dispose === 'function') {
            await webgpuState.imageAssistPipeline.dispose();
        }
    } catch (e) { console.warn('[WebGPU] error liberando asistente visual:', e); }
    try { webgpuWorker.dispose(); webgpuWorker.shutdown(); } catch (e) {}
    webgpuState.pipeline = null;
    webgpuState.loadedModelId = null;
    webgpuState.loadedTask = null;
    webgpuState.imageAssistPipeline = null;
    webgpuState.imageAssistModelId = null;
    webgpuState.isLoading = false;
    webgpuState.executionMode = null;
    dom.statusText.textContent = (typeof t==='function'?t('status.memFreed'):'🧹 Memoria liberada');
    if (state.rawModels) populateModels(state.rawModels);
    updateStatusMeta();
    renderWebGPUMonitor();
}
window.releaseWebGPUMemory = releaseWebGPUMemory;

function _fmtBytes(mb) {
    if (!mb || mb <= 0) return '—';
    return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

let _webgpuMonitorTimer = null;

async function renderWebGPUMonitor() {
    const grid = document.getElementById('webgpuMonitorGrid');
    if (!grid) return;
    const panel = document.getElementById('webgpuInfoPanel');
    // Si el panel no está visible, detener el refresco en vivo
    if (!panel || panel.style.display === 'none') {
        clearInterval(_webgpuMonitorTimer); _webgpuMonitorTimer = null;
        return;
    }

    const support = await checkWebGPUSupport();
    const { info, limits } = await getWebGPUAdapterDetails();

    const loadedId = webgpuState.loadedModelId || webgpuWorker.loadedModelId;
    const loadedDef = loadedId ? WEBGPU_MODELS.find(m => m.id === loadedId) : null;
    const modelMB = loadedDef?.sizeBytes || 0;

    // Estado (stress) según la actividad real del runtime
    let stress = 'Inactivo', stressCls = 'idle';
    if (webgpuState.isLoading) { stress = 'Cargando modelo'; stressCls = 'busy'; }
    else if (state.isStreaming) { stress = 'Generando'; stressCls = 'busy'; }
    else if (webgpuWorker.pending && webgpuWorker.pending.size > 0) { stress = 'En cola'; stressCls = 'busy'; }
    else if (loadedId) { stress = 'Listo (modelo en memoria)'; stressCls = 'ready'; }

    // Heap JS (real, solo Chromium)
    const heap = performance?.memory
        ? `${(performance.memory.usedJSHeapSize / 1073741824).toFixed(2)} / ${(performance.memory.jsHeapSizeLimit / 1073741824).toFixed(1)} GB`
        : 'No disponible';

    const deviceLabel = support === 'webgpu'
        ? `🟢 WebGPU activo${webgpuState.fp16Supported ? ' · f16' : ''}`
        : '🟠 WASM (CPU, sin GPU)';
    const adapterLabel = [info.vendor, info.architecture].filter(Boolean).join(' · ') || info.description || (support === 'webgpu' ? 'GPU detectada' : '—');
    const modeLabel = webgpuState.executionMode === 'worker' ? 'Web Worker' : webgpuState.executionMode === 'inline' ? 'Hilo principal' : '—';

    grid.innerHTML = [
        ['Aceleración', deviceLabel],
        ['Adaptador', adapterLabel],
        ['Estado', `<span class="webgpu-stress ${stressCls}">${stress}</span>`],
        ['Ejecución', modeLabel],
        ['Modelo en memoria', loadedId ? `${loadedDef?.label || loadedId} (${loadedDef?.size || _fmtBytes(modelMB)})` : 'Ninguno'],
        ['Modelos en caché', `${webgpuState.cachedModelIds?.size || 0}`],
        ['Buffer máx. GPU', _fmtBytes((limits.maxBufferSize || 0) / 1048576)],
        ['Heap JS del navegador', heap],
    ].map(([k, v]) => `<div class="webgpu-monitor-cell"><span class="wm-k">${k}</span><span class="wm-v">${v}</span></div>`).join('');

    // Barra de ocupación estimada: tamaño del modelo cargado respecto a un
    // presupuesto (RAM del dispositivo si se conoce; si no, 8 GB de referencia).
    const budgetMB = (navigator.deviceMemory ? navigator.deviceMemory * 1024 : 8192);
    const pct = modelMB > 0 ? Math.min(100, Math.round((modelMB / budgetMB) * 100)) : 0;
    const fill = document.getElementById('webgpuGaugeFill');
    const pctEl = document.getElementById('webgpuGaugePct');
    const noteEl = document.getElementById('webgpuGaugeNote');
    if (fill) {
        fill.style.width = `${pct}%`;
        fill.className = 'webgpu-gauge-fill ' + (pct >= 80 ? 'high' : pct >= 45 ? 'mid' : 'low');
    }
    if (pctEl) pctEl.textContent = `${pct}%`;
    if (noteEl) noteEl.textContent = loadedId
        ? `≈ ${_fmtBytes(modelMB)} del presupuesto de ${_fmtBytes(budgetMB)}. Estimación por tamaño del modelo; el navegador no expone el uso real de VRAM.`
        : 'Sin modelo cargado. La ocupación se calcula al cargar uno.';
}

/**
 * startWebGPUMonitor — pinta el monitor y lo refresca en vivo cada 2 s
 * mientras el panel de ajustes WebGPU está a la vista.
 */
function startWebGPUMonitor() {
    renderWebGPUMonitor();
    renderVisionChain();
    clearInterval(_webgpuMonitorTimer);
    _webgpuMonitorTimer = setInterval(renderWebGPUMonitor, 2000);
}

/**
 * renderVisionChain — panel donde el usuario escoge la combinación
 * «modelo de visión → modelo de chat» para las imágenes adjuntas.
 */
function renderVisionChain() {
    const wrap = document.getElementById('visionChain');
    if (!wrap) return;
    if (state.settings.provider !== 'webgpu') { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');

    const visionModels = WEBGPU_MODELS.filter(m => m.visionAssist);
    const chatModels = WEBGPU_MODELS.filter(m => !m.visionAssist);
    const activeVision = getVisionAssistDef().id;
    const selectedChat = WEBGPU_MODELS.find(m => m.id === state.settings.model);
    const isOmnimodal = !!selectedChat?.omnimodal;

    const vSel = document.getElementById('visionModelSelect');
    const cSel = document.getElementById('visionChatSelect');
    const desc = document.getElementById('visionChainDesc');
    const toggle = document.getElementById('visionChainToggle');
    const enabled = state.settings.visionChainEnabled !== false;
    if (toggle) toggle.checked = enabled;
    wrap.classList.toggle('vision-chain-off', !enabled);
    wrap.classList.toggle('omnimodal-active', isOmnimodal);
    if (desc) desc.innerHTML = !enabled
        ? 'Cadena de análisis <b>desactivada</b>: las imágenes que adjuntes no se analizarán con el modelo de visión antes de responder. Actívala con el conmutador.'
        : (isOmnimodal
            ? `<b>${escapeHtml(selectedChat.label)}</b> ve la imagen y responde directamente. El asistente visual queda en espera y solo se usará si cambias a un modelo de texto o si se activa el fallback.`
            : 'La imagen se analiza localmente y su resultado pasa al <b>modelo de chat</b> que redacta la respuesta. Elige la combinación:');
    if (vSel) {
        vSel.innerHTML = visionModels.map(m =>
            `<option value="${escapeHtml(m.id)}" ${m.id === activeVision ? 'selected' : ''}>${escapeHtml(m.label)}${m.recommended ? ' ⭐' : ''}</option>`
        ).join('');
        vSel.disabled = isOmnimodal || !enabled;
    }
    if (cSel) {
        cSel.innerHTML = chatModels.map(m =>
            `<option value="${escapeHtml(m.id)}" ${m.id === state.settings.model ? 'selected' : ''}>${escapeHtml(m.label)}</option>`
        ).join('');
        cSel.disabled = !enabled;
    }
}
window.renderVisionChain = renderVisionChain;

async function getCachedWebGPUModels() {
    const cachedModels = new Set();
    try {
        if (typeof caches === 'undefined') return cachedModels;
        const cacheNames = await caches.keys();
        if (cacheNames.includes('transformers-cache')) {
            const cache = await caches.open('transformers-cache');
            const keys = await cache.keys();
            for (const request of keys) {
                // Decode URI component since metadata files may be routed through the CORS proxy
                const url = decodeURIComponent(request.url);
                // Two URL shapes coexist in the cache: the classic
                // huggingface.co/<org>/<repo>/resolve/... and the newer redirect target
                // huggingface.co/api/resolve-cache/models/<org>/<repo>/...
                const match = url.match(/huggingface\.co\/(?:api\/resolve-cache\/models\/)?([^\/]+\/[^\/]+)/);
                if (match && match[1]) {
                    cachedModels.add(match[1]);
                }
            }
        }
    } catch (e) {
        console.warn('Error checking cache storage:', e);
    }
    return cachedModels;
}

async function deleteWebGPUModelCache(modelId) {
    if (!confirm(`¿Estás seguro de que quieres borrar de la caché de tu navegador los archivos de ${modelId}? Se descargarán de nuevo cuando lo utilices.`)) {
        return false;
    }
    try {
        if (typeof caches === 'undefined') return false;
        const cache = await caches.open('transformers-cache');
        const keys = await cache.keys();
        let deletedCount = 0;
        for (const request of keys) {
            const url = decodeURIComponent(request.url);
            if (url.includes(modelId)) {
                await cache.delete(request);
                deletedCount++;
            }
        }
        console.log(`[WebGPU] Deleted ${deletedCount} cache entries for model ${modelId}`);
        // If the model deleted is the currently loaded model, clear the active state
        if (webgpuState.loadedModelId === modelId) {
            webgpuState.pipeline = null;
            webgpuState.loadedModelId = null;
            webgpuState.loadedTask = null;
        }
        if (webgpuWorker.loadedModelId === modelId) {
            webgpuWorker.dispose();
        }
        // Refresh cache status and UI
        webgpuState.cachedModelIds = await getCachedWebGPUModels();
        if (state.rawModels) populateModels(state.rawModels);
        updateStatusMeta();
        return true;
    } catch (e) {
        console.error('[WebGPU] Failed to delete model cache:', e);
        alert('Error al borrar los archivos de la caché.');
        return false;
    }
}
window.deleteWebGPUModelCache = deleteWebGPUModelCache;

/**
 * checkWebGPUSupport — detects WebGPU availability ('webgpu' or 'wasm').
 * Also records shader-f16 support, needed to pick a compatible dtype.
 */
async function checkWebGPUSupport() {
    if (webgpuState.supported !== null) return webgpuState.supported;
    try {
        if (!navigator.gpu) { webgpuState.supported = 'wasm'; webgpuState.fp16Supported = false; return 'wasm'; }
        // En portátiles con GPU dual, sin powerPreference el navegador puede
        // elegir la integrada de bajo consumo.
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
            || await navigator.gpu.requestAdapter();
        webgpuState.supported = adapter ? 'webgpu' : 'wasm';
        webgpuState.fp16Supported = !!adapter?.features?.has('shader-f16');
    } catch (e) {
        webgpuState.supported = 'wasm';
        webgpuState.fp16Supported = false;
    }
    return webgpuState.supported;
}

/**
 * adaptDtypesToDevice — las variantes *f16 requieren WebGPU con shader-f16;
 * en WASM o GPUs sin f16 fallan con errores opacos, así que se degradan a su
 * equivalente sin f16 manteniendo el orden de preferencia.
 */
function adaptDtypesToDevice(dtypeCandidates, device, fp16Supported) {
    const fp16Ok = device === 'webgpu' && fp16Supported;
    if (fp16Ok) return dtypeCandidates;
    const degraded = { q4f16: 'q4', fp16: 'fp32', q8f16: 'q8' };
    return Array.from(new Set(dtypeCandidates.map(d => degraded[d] || d)));
}

/**
 * configureOnnxRuntime — acelera onnxruntime-web: activa el máximo de hilos
 * WASM (solo si la página tiene aislamiento de origen → SharedArrayBuffer) y
 * SIMD. Multiplica la velocidad de inicialización del grafo y de las ops que
 * caen a WASM (y toda la ruta de respaldo sin WebGPU). Silencioso si algo falta.
 */
function configureOnnxRuntime(env) {
    try {
        const wasm = env?.backends?.onnx?.wasm;
        if (!wasm) return;
        const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
        // Sin aislamiento no hay SharedArrayBuffer: forzar >1 hilo rompería la carga.
        wasm.numThreads = isolated ? Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8)) : 1;
        wasm.simd = true;
    } catch (e) { /* configuración best-effort */ }
}

/**
 * loadWebGPUModelInline — loads a Transformers.js pipeline in the main thread.
 * Ruta de respaldo cuando el Web Worker no está disponible (p. ej. file://).
 * Shows progress in the status bar and returns the pipeline instance.
 */
async function loadWebGPUModelInline(modelId, onProgress, task = 'text-generation') {
    if (webgpuState.loadedModelId === modelId && webgpuState.loadedTask === task && webgpuState.pipeline) {
        return webgpuState.pipeline;
    }
    if (webgpuState.isLoading) return null;
    webgpuState.isLoading = true;
    webgpuState.cancelRequested = false;
    // Libera la VRAM del modelo anterior antes de cargar otro; sin esto,
    // cambiar de modelo acumula pipelines en memoria GPU y acaba en OOM.
    if (webgpuState.pipeline && typeof webgpuState.pipeline.dispose === 'function') {
        try { await webgpuState.pipeline.dispose(); } catch (e) { console.warn('[WebGPU] error liberando pipeline anterior:', e); }
    }
    webgpuState.pipeline = null;
    webgpuState.loadedModelId = null;
    webgpuState.loadedTask = null;

    let _shaderTimer = null;
    let _shaderInterval = null;

    try {
        const progressUiState = { ts: 0, pct: -1, file: '', completedFiles: new Set() };
        // Transformers.js v3 dynamic import from CDN
        const hf = webgpuState.hfModule || await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');
        webgpuState.hfModule = hf;
        const { pipeline, env } = hf;
        if (webgpuState.cancelRequested) throw new DOMException('Carga cancelada por el usuario.', 'AbortError');
        // Configure environment for maximum compatibility
        env.allowLocalModels = false;
        env.allowRemoteModels = true;
        env.useBrowserCache = true;
        env.remoteHost = 'https://huggingface.co';
        // Transformers.js already appends the concrete filename it needs.
        // Keeping only the repo/revision prefix avoids malformed URLs like
        // ".../resolve/main/{file}/config.json" on some model loads.
        env.remotePathTemplate = '{model}/resolve/{revision}';
        configureOnnxRuntime(env);

        const deviceSupport = await checkWebGPUSupport();
        const device = deviceSupport === 'webgpu' ? 'webgpu' : 'wasm';

        const modelDef = WEBGPU_MODELS.find(m => m.id === modelId);
        const dtypeCandidates = adaptDtypesToDevice(
            Array.from(new Set([
                modelDef?.dtype || 'q4f16',
                ...((Array.isArray(modelDef?.fallbackDtypes) ? modelDef.fallbackDtypes : []))
            ])),
            device,
            webgpuState.fp16Supported
        );
        const sourceUrl = buildWebGPURepoUrl(modelId);

        dom.statusDot.className = 'status-dot loading';
        dom.statusText.textContent = (typeof t==='function'?t('status.preparing'):'Preparando...');
        if (onProgress) onProgress(0, { status: 'init', file: 'Preparando runtime local', sourceUrl });

        let pipe = null;
        let lastError = null;

        for (let i = 0; i < dtypeCandidates.length; i++) {
            const dtype = dtypeCandidates[i];
            try {
                if (i > 0 && onProgress) {
                    onProgress(0, {
                        status: 'init',
                        file: `Reintentando con cuantización ${dtype}`,
                        sourceUrl,
                        retryingWithDtype: dtype,
                        previousError: formatErrorDetail(lastError)
                    });
                }

                pipe = await pipeline(task, modelId, {
                    device,
                    dtype,
                    progress_callback: (progress) => {
                        if (webgpuState.cancelRequested) return;
                        const progressWithMeta = { ...progress, sourceUrl, dtype };
                        if (progress.status === 'progress' && progress.total) {
                            clearTimeout(_shaderTimer);
                            clearInterval(_shaderInterval);
                            const pct = Math.round((progress.loaded / progress.total) * 100);
                            if (!shouldEmitWebGPUProgress(progressUiState, pct, progressWithMeta)) return;
                            dom.statusText.textContent = `⬇ ${pct}%`;
                            if (onProgress) onProgress(pct, progressWithMeta);
                        } else if (progress.status === 'done') {
                            const installPct = estimateInstallProgress(progressUiState, progress.file);
                            dom.statusText.textContent = (typeof t==='function'?t('status.installing'):'Instalando...');
                            if (onProgress) onProgress(installPct, { ...progressWithMeta, status: 'installing', file: progress.file || 'Registrando artefactos descargados' });
                            // ── Shader compilation gap detection ──────────────
                            // After the last 'done' event, Transformers.js/ONNX enters WebGPU
                            // shader compilation which emits NO progress callbacks. If no new
                            // progress/done events arrive within 2s, we surface a 'compiling'
                            // phase so the UI doesn't appear frozen.
                            clearTimeout(_shaderTimer);
                            clearInterval(_shaderInterval);
                            _shaderTimer = setTimeout(() => {
                                if (!webgpuState.isLoading || webgpuState.cancelRequested) return;
                                const _t0 = Date.now();
                                const _compileMsg = 'Compilando kernels WebGPU';
                                dom.statusText.textContent = _compileMsg;
                                if (onProgress) onProgress(97, { ...progressWithMeta, status: 'compiling', file: `${_compileMsg} para tu acelerador` });
                                _shaderInterval = setInterval(() => {
                                    if (!webgpuState.isLoading || webgpuState.cancelRequested) { clearInterval(_shaderInterval); return; }
                                    const secs = Math.round((Date.now() - _t0) / 1000);
                                    const timeMsg = `${_compileMsg} — ${secs}s transcurridos`;
                                    dom.statusText.textContent = timeMsg;
                                    if (secs >= 120) {
                                        if (onProgress) onProgress(97, { ...progressWithMeta, status: 'compiling', file: timeMsg, _compileOverdue: true });
                                    } else {
                                        if (onProgress) onProgress(97, { ...progressWithMeta, status: 'compiling', file: timeMsg });
                                    }
                                }, 4000);
                            }, 2000);
                        } else if (progress.status === 'ready') {
                            clearTimeout(_shaderTimer);
                            clearInterval(_shaderInterval);
                            dom.statusText.textContent = (typeof t==='function'?t('status.initializing'):'Inicializando...');
                            if (onProgress) onProgress(97, { ...progressWithMeta, status: 'initializing', file: progress.file || 'Levantando pipeline local' });
                        } else if (progress.status === 'init') {
                            clearTimeout(_shaderTimer);
                            clearInterval(_shaderInterval);
                            dom.statusText.textContent = (typeof t==='function'?t('status.preparing'):'Preparando...');
                            if (onProgress) onProgress(0, progressWithMeta);
                        }
                    }
                });
                break;
            } catch (err) {
                lastError = err;
                const detail = formatErrorDetail(err).toLowerCase();
                const isLastAttempt = i === dtypeCandidates.length - 1;
                const isOpaqueNumericFailure = /^\d+$/.test(formatErrorDetail(err));
                const looksLikeRuntimeInitFailure =
                    isOpaqueNumericFailure ||
                    detail.includes('device lost') ||
                    detail.includes('out of memory') ||
                    detail.includes('oom') ||
                    detail.includes('allocate') ||
                    detail.includes('allocation') ||
                    detail.includes('failed to create') ||
                    detail.includes('webgpu') ||
                    detail.includes('onnxruntime');

                if (isLastAttempt || !looksLikeRuntimeInitFailure) {
                    throw err;
                }
                console.warn(`[WebGPU] dtype '${dtype}' failed for ${modelId}, retrying with a lighter variant...`, err);
            }
        }
        if (!pipe && lastError) throw lastError;
        if (webgpuState.cancelRequested) {
            if (typeof pipe?.dispose === 'function') pipe.dispose();
            throw new DOMException('Carga cancelada por el usuario.', 'AbortError');
        }

        dom.statusText.textContent = (typeof t==='function'?t('status.initPipeline'):'Inicializando pipeline...');
        if (onProgress) {
            onProgress(100, {
                status: 'initializing',
                file: 'Compilando kernels finales y dejando el pipeline listo',
                sourceUrl,
                dtype: dtypeCandidates[0]
            });
        }

        webgpuState.pipeline = pipe;
        webgpuState.loadedModelId = modelId;
        webgpuState.loadedTask = task;
        dom.statusText.textContent = (typeof t==='function'?t('status.ready'):'Listo');
        return pipe;
    } catch (e) {
        console.error('[WebGPU] load error:', e);
        throw e;
    } finally {
        clearTimeout(_shaderTimer);
        clearInterval(_shaderInterval);
        webgpuState.isLoading = false;
    }
}

async function loadWebGPUImageAssistPipeline(onProgress) {
    const assist = getVisionAssistDef();
    if (webgpuState.imageAssistPipeline && webgpuState.imageAssistModelId === assist.id) {
        return webgpuState.imageAssistPipeline;
    }

    const progressUiState = { ts: 0, pct: -1, file: '', completedFiles: new Set() };
    const hf = webgpuState.hfModule || await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');
    webgpuState.hfModule = hf;
    const { pipeline, env } = hf;

    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    env.useBrowserCache = true;
    env.remoteHost = 'https://huggingface.co';
    env.remotePathTemplate = '{model}/resolve/{revision}';

    const deviceSupport = await checkWebGPUSupport();
    const device = deviceSupport === 'webgpu' ? 'webgpu' : 'wasm';
    const sourceUrl = buildWebGPURepoUrl(assist.id);

    const dtypeCandidates = [assist.dtype, ...(assist.fallbackDtypes || [])].filter(Boolean);
    if (dtypeCandidates.length === 0) dtypeCandidates.push(undefined);
    let pipe = null;
    let lastError = null;
    const progressCallback = (progress) => {
            if (!onProgress) return;
            if (progress.status === 'progress' && progress.total) {
                const pct = Math.round((progress.loaded / progress.total) * 100);
                if (!shouldEmitWebGPUProgress(progressUiState, pct, progress)) return;
                onProgress(pct, { ...progress, sourceUrl });
            } else if (progress.status === 'done') {
                onProgress(estimateInstallProgress(progressUiState, progress.file), { ...progress, sourceUrl, status: 'installing', file: progress.file || 'Registrando asistente visual local' });
            } else if (progress.status === 'ready') {
                onProgress(97, { ...progress, sourceUrl, status: 'initializing', file: progress.file || 'Inicializando asistente visual local' });
            } else if (progress.status === 'init') {
                onProgress(0, { ...progress, sourceUrl });
            }
        };
    for (const dtype of dtypeCandidates) {
        try {
            pipe = await pipeline(assist.task, assist.id, {
                device,
                ...(dtype ? { dtype } : {}),
                progress_callback: progressCallback
            });
            break;
        } catch (error) {
            lastError = error;
            console.warn(`[WebGPU] asistente ${assist.id} falló con ${dtype || 'dtype por defecto'}; reintentando.`, error);
        }
    }
    if (!pipe) throw lastError || new Error(`No se pudo cargar ${assist.label}.`);

    webgpuState.imageAssistPipeline = pipe;
    webgpuState.imageAssistModelId = assist.id;
    return pipe;
}

// ─── Motores de visión avanzados (Florence-2 y VLM) ──────────
// Corren inline (no worker) porque usan clases de modelo específicas, no el
// pipeline estándar. El resultado (texto) alimenta la cadena visión → chat.
async function _prepareHfEnv() {
    const hf = webgpuState.hfModule || await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');
    webgpuState.hfModule = hf;
    const { env } = hf;
    env.allowLocalModels = false; env.allowRemoteModels = true; env.useBrowserCache = true;
    env.remoteHost = 'https://huggingface.co'; env.remotePathTemplate = '{model}/resolve/{revision}';
    configureOnnxRuntime(env);
    return hf;
}

function _visionProgressCb(onProgress, sourceUrl) {
    const st = { ts: 0, pct: -1, file: '', completedFiles: new Set() };
    return (progress) => {
        if (!onProgress) return;
        if (progress.status === 'progress' && progress.total) {
            const pct = Math.round((progress.loaded / progress.total) * 100);
            if (!shouldEmitWebGPUProgress(st, pct, progress)) return;
            onProgress(pct, { ...progress, sourceUrl });
        } else if (progress.status === 'done') {
            onProgress(estimateInstallProgress(st, progress.file), { ...progress, sourceUrl, status: 'installing', file: progress.file || 'Registrando modelo de visión' });
        } else if (progress.status === 'ready') {
            onProgress(97, { ...progress, sourceUrl, status: 'initializing', file: 'Inicializando modelo de visión' });
        } else if (progress.status === 'init') {
            onProgress(0, { ...progress, sourceUrl });
        }
    };
}

async function loadFlorence2VisionModel(onProgress) {
    const assist = getVisionAssistDef();
    if (webgpuState.imageAssistPipeline?.__florence2 && webgpuState.imageAssistModelId === assist.id) {
        return webgpuState.imageAssistPipeline;
    }
    const hf = await _prepareHfEnv();
    const device = (await checkWebGPUSupport()) === 'webgpu' ? 'webgpu' : 'wasm';
    const cb = _visionProgressCb(onProgress, buildWebGPURepoUrl(assist.id));
    const model = await hf.Florence2ForConditionalGeneration.from_pretrained(assist.id, {
        dtype: { embed_tokens: 'fp16', vision_encoder: 'fp16', encoder_model: 'q4', decoder_model_merged: 'q4' },
        device, progress_callback: cb
    });
    const processor = await hf.AutoProcessor.from_pretrained(assist.id);
    const bundle = { __florence2: true, model, processor, async dispose() { try { await model.dispose?.(); } catch (e) {} } };
    webgpuState.imageAssistPipeline = bundle;
    webgpuState.imageAssistModelId = assist.id;
    return bundle;
}

async function runFlorence2Analysis(bundle, rawImage) {
    const { model, processor } = bundle;
    const parts = [];
    for (const task of ['<MORE_DETAILED_CAPTION>', '<OCR>']) {
        try {
            const inputs = await processor(rawImage, task);
            const gen = await model.generate({ ...inputs, max_new_tokens: 200, num_beams: 1, do_sample: false });
            const text = processor.batch_decode(gen, { skip_special_tokens: false })[0];
            const parsed = processor.post_process_generation(text, task, rawImage.size);
            const val = parsed[task];
            if (val && String(val).trim()) {
                parts.push(task === '<OCR>' ? `Texto detectado: "${String(val).trim()}"` : String(val).trim());
            }
        } catch (e) { console.warn('[Florence-2] tarea', task, 'falló:', e); }
    }
    return parts.join(' · ');
}

async function loadVLMVisionModel(onProgress) {
    const assist = getVisionAssistDef();
    if (webgpuState.imageAssistPipeline?.__vlm && webgpuState.imageAssistModelId === assist.id) {
        return webgpuState.imageAssistPipeline;
    }
    const hf = await _prepareHfEnv();
    const device = (await checkWebGPUSupport()) === 'webgpu' ? 'webgpu' : 'wasm';
    const cb = _visionProgressCb(onProgress, buildWebGPURepoUrl(assist.id));
    const processor = await hf.AutoProcessor.from_pretrained(assist.id);
    const model = await hf.AutoModelForVision2Seq.from_pretrained(assist.id, {
        dtype: { embed_tokens: 'fp16', vision_encoder: 'q4', decoder_model_merged: 'q4' },
        device, progress_callback: cb
    });
    const bundle = { __vlm: true, model, processor, async dispose() { try { await model.dispose?.(); } catch (e) {} } };
    webgpuState.imageAssistPipeline = bundle;
    webgpuState.imageAssistModelId = assist.id;
    return bundle;
}

async function runVLMAnalysis(bundle, rawImage, question) {
    const { model, processor } = bundle;
    const q = (question || '').trim() || 'Describe la imagen con detalle.';
    const messages = [{ role: 'user', content: [{ type: 'image' }, { type: 'text', text: q }] }];
    const text = processor.apply_chat_template(messages, { add_generation_prompt: true });
    const inputs = await processor(text, [rawImage], { do_image_splitting: false });
    const gen = await model.generate({ ...inputs, max_new_tokens: 160, do_sample: false });
    const decoded = processor.batch_decode(gen, { skip_special_tokens: true })[0] || '';
    // La salida incluye el prompt; nos quedamos con lo posterior a "Assistant:"
    const idx = decoded.lastIndexOf('Assistant:');
    return (idx >= 0 ? decoded.slice(idx + 'Assistant:'.length) : decoded).trim();
}

// El export ONNX de DINOv2 X-Ray declara por error BlipImageProcessor, una
// clase que no existe en Transformers.js 3.8.1. Cargamos el grafo DINO
// directamente y aplicamos el preprocesamiento publicado por el propio repo.
// ── Clasificador de heridas (ONNX propio en HF: tligent-ia/wound-classifier-onnx) ──
async function loadWoundClassifier(onProgress) {
    const assist = getVisionAssistDef();
    if (webgpuState.imageAssistPipeline?.__wound && webgpuState.imageAssistModelId === assist.id) {
        return webgpuState.imageAssistPipeline;
    }
    // Flujo Hugging Face estándar (mismo que el resto de modelos).
    const hf = await _prepareHfEnv();
    const { pipeline } = hf;
    const cb = _visionProgressCb(onProgress, buildWebGPURepoUrl(assist.id));
    // int8 corre en WASM; para un clasificador pequeño es rápido y evita
    // problemas de int8 en WebGPU.
    const pipe = await pipeline('image-classification', assist.id, { dtype: 'q8', device: 'wasm', progress_callback: cb });
    const bundle = { __wound: true, pipe, async dispose() { try { await pipe.dispose?.(); } catch (e) {} } };
    webgpuState.imageAssistPipeline = bundle;
    webgpuState.imageAssistModelId = assist.id;
    return bundle;
}

async function runWoundClassify({ pipe }, rawImage) {
    const res = await pipe(rawImage, { top_k: 5 });
    return res;
}

function formatWoundResult(output = []) {
    const es = {
        'Abrasions': 'Abrasión / rozadura', 'Bruises': 'Hematoma / contusión', 'Burns': 'Quemadura',
        'Cut': 'Corte', 'Diabetic Wounds': 'Herida diabética', 'Laseration': 'Laceración',
        'Normal': 'Piel normal (sin herida aparente)', 'Pressure Wounds': 'Úlcera por presión',
        'Surgical Wounds': 'Herida quirúrgica', 'Venous Wounds': 'Herida venosa'
    };
    const rows = (Array.isArray(output) ? output : [])
        .filter(r => r?.label && Number.isFinite(Number(r.score)))
        .slice(0, 4)
        .map(r => `${es[r.label] || r.label}: ${(Number(r.score) * 100).toFixed(1)}%`);
    if (rows.length === 0) return 'No se pudo clasificar la herida en la imagen.';
    const top = output[0];
    return `Reconocimiento de herida (orientativo): la imagen se parece sobre todo a «${es[top.label] || top.label}» (${(Number(top.score) * 100).toFixed(1)}%). Distribución: ${rows.join(' · ')}. Es una estimación automática, no un diagnóstico: ante cualquier duda, consulta a un profesional sanitario.`;
}

async function loadDinoMedicalVisionModel(onProgress) {
    const assist = getVisionAssistDef();
    if (webgpuState.imageAssistPipeline?.__medicalEmbedding && webgpuState.imageAssistModelId === assist.id) {
        return webgpuState.imageAssistPipeline;
    }
    const hf = await _prepareHfEnv();
    const device = (await checkWebGPUSupport()) === 'webgpu' ? 'webgpu' : 'wasm';
    const cb = _visionProgressCb(onProgress, buildWebGPURepoUrl(assist.id));
    const candidates = [assist.dtype, ...(assist.fallbackDtypes || [])].filter(Boolean);
    let model = null;
    let lastError = null;
    for (const dtype of candidates) {
        try {
            model = await hf.AutoModel.from_pretrained(assist.id, { dtype, device, progress_callback: cb });
            break;
        } catch (error) {
            lastError = error;
            console.warn(`[DINOv2 X-Ray] fallo con ${dtype}; reintentando.`, error);
        }
    }
    if (!model) throw lastError || new Error('No se pudo cargar DINOv2 X-Ray.');
    const bundle = {
        __medicalEmbedding: true,
        model,
        async dispose() { try { await model.dispose?.(); } catch (e) {} }
    };
    webgpuState.imageAssistPipeline = bundle;
    webgpuState.imageAssistModelId = assist.id;
    return bundle;
}

async function runDinoMedicalEmbedding({ model }, rawImage) {
    const hf = webgpuState.hfModule;
    const image = await rawImage.rgb().resize(224, 224);
    const width = 224, height = 224;
    const pixels = new Float32Array(3 * width * height);
    const mean = [0.485, 0.456, 0.406];
    const std = [0.229, 0.224, 0.225];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const source = (y * width + x) * 3;
            for (let channel = 0; channel < 3; channel++) {
                pixels[channel * width * height + y * width + x] =
                    (image.data[source + channel] / 255 - mean[channel]) / std[channel];
            }
        }
    }
    const output = await model({
        pixel_values: new hf.Tensor('float32', pixels, [1, 3, height, width])
    });
    return output.pooler_output || output.last_hidden_state || output;
}

// Omnimodal nativo: imagen + texto -> respuesta final. Este bundle ocupa el
// slot principal del chat y conserva la conversación multimodal completa.
async function loadWebGPUOmnimodalModel(modelId, onProgress) {
    if (webgpuState.pipeline?.__omnimodal && webgpuState.loadedModelId === modelId) return webgpuState.pipeline;
    if (webgpuState.isLoading) return null;
    webgpuState.isLoading = true;
    webgpuState.cancelRequested = false;

    try {
        if (webgpuState.pipeline?.dispose) await webgpuState.pipeline.dispose();
        if (webgpuState.imageAssistPipeline?.dispose) await webgpuState.imageAssistPipeline.dispose();
        try { webgpuWorker.dispose(); webgpuWorker.shutdown(); } catch (e) {}
        webgpuState.pipeline = null;
        webgpuState.imageAssistPipeline = null;
        webgpuState.imageAssistModelId = null;
        webgpuState.loadedModelId = null;
        webgpuState.loadedTask = null;
        webgpuState.executionMode = 'inline';

        const hf = await _prepareHfEnv();
        const device = (await checkWebGPUSupport()) === 'webgpu' ? 'webgpu' : 'wasm';
        const sourceUrl = buildWebGPURepoUrl(modelId);
        const cb = _visionProgressCb(onProgress, sourceUrl);
        const processor = await hf.AutoProcessor.from_pretrained(modelId, { progress_callback: cb });
        const officialDtype = { embed_tokens: 'fp16', vision_encoder: 'q4', decoder_model_merged: 'q4' };
        const safeDtype = { embed_tokens: 'q4', vision_encoder: 'q4', decoder_model_merged: 'q4' };
        const candidates = device === 'webgpu' && webgpuState.fp16Supported ? [officialDtype, safeDtype] : [safeDtype];
        let model = null;
        let lastError = null;

        for (let i = 0; i < candidates.length; i++) {
            try {
                if (i > 0 && onProgress) onProgress(0, {
                    status: 'init', file: 'Reintentando el VLM con cuantización q4 completa', sourceUrl,
                    retryingWithDtype: 'q4', previousError: formatErrorDetail(lastError)
                });
                model = await hf.AutoModelForVision2Seq.from_pretrained(modelId, {
                    dtype: candidates[i], device, progress_callback: cb
                });
                break;
            } catch (error) {
                lastError = error;
            }
        }
        if (!model) throw lastError || new Error('No se pudo cargar el modelo omnimodal.');
        if (webgpuState.cancelRequested) throw new DOMException('Carga cancelada por el usuario.', 'AbortError');

        const bundle = {
            __omnimodal: true,
            model,
            processor,
            async dispose() { try { await model.dispose?.(); } catch (e) {} }
        };
        webgpuState.pipeline = bundle;
        webgpuState.loadedModelId = modelId;
        webgpuState.loadedTask = 'omnimodal';
        return bundle;
    } finally {
        webgpuState.isLoading = false;
    }
}

async function runWebGPUOmnimodalGeneration({ model, processor }, promptInput, assistantMsg, msgIdx) {
    const startTime = Date.now();
    let tokenCount = 0;
    let fullResponse = '';
    const messages = (promptInput?.text || []).map(message => ({
        role: message.role,
        content: Array.isArray(message.content)
            ? message.content
            : [{ type: 'text', text: String(message.content || '') }]
    }));
    const images = promptInput?.images || [];
    const prompt = processor.apply_chat_template(messages, { add_generation_prompt: true });
    const inputs = await processor(prompt, images, { do_image_splitting: false });
    const hf = webgpuState.hfModule;
    const options = {
        ...inputs,
        // Los VLM compactos pueden volverse muy lentos con el límite global de 4K.
        // 1024 conserva respuestas amplias sin bloquear innecesariamente la interfaz.
        max_new_tokens: Math.min(parseInt(state.settings.maxTokens || 512), 1024),
        temperature: parseFloat(state.settings.temperature ?? 0.8),
        top_p: parseFloat(state.settings.topP || 0.9),
        repetition_penalty: 1.1,
        do_sample: parseFloat(state.settings.temperature ?? 0.8) > 0,
    };

    const tokenizer = processor.tokenizer;
    if (hf?.TextStreamer && tokenizer) {
        options.streamer = new hf.TextStreamer(tokenizer, {
            skip_prompt: true,
            skip_special_tokens: true,
            callback_function: chunk => {
                if (!chunk || state.abortController?.signal?.aborted) return;
                fullResponse += chunk;
                clearMessageLoadingState(assistantMsg);
                applyWebGPUStreamedText(assistantMsg, fullResponse);
                updateStreamingMessage(msgIdx, assistantMsg);
                updateGenerationStatus(tokenCount, startTime);
                maybeStopRepetitionLoop(assistantMsg, fullResponse);
            },
            token_callback_function: () => { tokenCount++; }
        });
    }

    if (hf?.InterruptableStoppingCriteria) {
        const stopper = new hf.InterruptableStoppingCriteria();
        const signal = state.abortController?.signal;
        if (signal?.aborted) stopper.interrupt();
        else signal?.addEventListener('abort', () => stopper.interrupt(), { once: true });
        options.stopping_criteria = stopper;
        webgpuState.activeStopper = stopper;
    }

    let generatedIds;
    try {
        generatedIds = await model.generate(options);
    } finally {
        webgpuState.activeStopper = null;
    }
    const inputLength = inputs.input_ids?.dims?.at(-1) || 0;
    const completionIds = inputLength && generatedIds?.slice
        ? generatedIds.slice(null, [inputLength, null])
        : generatedIds;
    const decoded = processor.batch_decode(completionIds, { skip_special_tokens: true })[0] || '';
    if (decoded.trim()) fullResponse = decoded.trim();

    const elapsed = Date.now() - startTime;
    const parts = splitWebGPUThinking(fullResponse);
    let text = parts.content || (parts.thinking ? '*(El modelo solo genero razonamiento)*' : '*(Sin respuesta generada)*');
    if (assistantMsg._loopStopped) text += WEBGPU_LOOP_STOP_NOTE;
    return {
        text,
        thinking: parts.thinking,
        metrics: tokenCount > 0 && elapsed > 0 ? {
            eval_count: tokenCount,
            total_time_ms: elapsed,
            tps: (tokenCount / (elapsed / 1000)).toFixed(2)
        } : null
    };
}

// ─── WebGPU Web Worker Client ────────────────
// La inferencia corre en webgpu-worker.js para no bloquear la UI. Si el worker
// no está disponible (file://, error de carga) o su contexto no alcanza WebGPU
// teniendo la página soporte, se usa la ruta inline en el hilo principal.
const webgpuWorker = {
    instance: null,
    broken: false,
    seq: 0,
    pending: new Map(),        // id → { resolve, reject, onProgress, onToken }
    loadedModelId: null,
    loadedTask: null,

    ensure() {
        if (this.broken) return null;
        if (this.instance) return this.instance;
        try {
            this.instance = new Worker('webgpu-worker.js', { type: 'module' });
            this.instance.onmessage = (e) => this._route(e.data);
            this.instance.onerror = (e) => {
                console.error('[WebGPU worker] error fatal:', e.message || e);
                this._failAll(new Error(e.message || 'El worker de inferencia ha fallado.'));
                this.shutdown(true);
            };
        } catch (e) {
            console.warn('[WebGPU worker] no disponible, usando hilo principal:', e);
            this.broken = true;
            this.instance = null;
        }
        return this.instance;
    },

    _route(data) {
        if (!data || data.id === undefined) return;
        const entry = this.pending.get(data.id);
        if (!entry) return;
        if (data.type === 'progress') {
            entry.onProgress?.(data);
        } else if (data.type === 'token') {
            entry.onToken?.(data.text, data.n);
        } else if (data.type === 'done') {
            this.pending.delete(data.id);
            entry.resolve(data);
        } else if (data.type === 'error') {
            this.pending.delete(data.id);
            const err = new Error(data.message || 'Error en el worker de inferencia');
            err.name = data.name || 'Error';
            entry.reject(err);
        }
    },

    _failAll(error) {
        for (const entry of this.pending.values()) entry.reject(error);
        this.pending.clear();
    },

    call(msg, hooks = {}, timeoutMs = 0) {
        const worker = this.ensure();
        if (!worker) return Promise.reject(new Error('Worker no disponible'));
        const id = ++this.seq;
        return new Promise((resolve, reject) => {
            let timer = null;
            if (timeoutMs > 0) {
                timer = setTimeout(() => {
                    this.pending.delete(id);
                    reject(new Error('Timeout esperando al worker de inferencia'));
                }, timeoutMs);
            }
            this.pending.set(id, {
                resolve: (v) => { clearTimeout(timer); resolve(v); },
                reject: (e) => { clearTimeout(timer); reject(e); },
                onProgress: hooks.onProgress,
                onToken: hooks.onToken,
            });
            worker.postMessage({ ...msg, id });
        });
    },

    interrupt() {
        this.instance?.postMessage({ type: 'interrupt' });
    },

    dispose() {
        this.instance?.postMessage({ type: 'dispose' });
        this.loadedModelId = null;
        this.loadedTask = null;
    },

    shutdown(markBroken = false) {
        // Rechazar lo pendiente ANTES de terminar: si no, cualquier await
        // sobre el worker quedaría colgado para siempre y la UI bloqueada.
        this._failAll(new DOMException('El worker de inferencia se ha reiniciado.', 'AbortError'));
        try { this.instance?.terminate(); } catch (e) {}
        this.instance = null;
        this.loadedModelId = null;
        this.loadedTask = null;
        if (markBroken) this.broken = true;
    },
};

async function decideWebGPUExecutionMode() {
    if (webgpuState.executionMode) return webgpuState.executionMode;
    const mainDevice = await checkWebGPUSupport();
    if (!webgpuWorker.ensure()) {
        webgpuState.executionMode = 'inline';
        return 'inline';
    }
    try {
        const probe = await webgpuWorker.call({ type: 'probe' }, {}, 8000);
        // Si la página tiene WebGPU pero el worker solo alcanza WASM, mejor
        // inferencia rápida en el hilo principal que lenta fuera de él.
        if (mainDevice === 'webgpu' && probe.device !== 'webgpu') {
            webgpuWorker.shutdown(true);
            webgpuState.executionMode = 'inline';
        } else {
            webgpuState.executionMode = 'worker';
        }
    } catch (e) {
        console.warn('[WebGPU worker] probe fallido, usando hilo principal:', e);
        webgpuWorker.shutdown(true);
        webgpuState.executionMode = 'inline';
    }
    console.log(`[WebGPU] modo de ejecución: ${webgpuState.executionMode}`);
    return webgpuState.executionMode;
}

/**
 * createWebGPULoadProgressRouter — mapea los eventos crudos de progreso del
 * pipeline (descarga → instalación → compilación → inicialización) al callback
 * de UI, incluida la detección del hueco de compilación de shaders.
 */
function createWebGPULoadProgressRouter({ onProgress, sourceUrl }) {
    const progressUiState = { ts: 0, pct: -1, file: '', completedFiles: new Set() };
    let shaderTimer = null;
    let shaderInterval = null;
    const clearTimers = () => { clearTimeout(shaderTimer); clearInterval(shaderInterval); };

    const handle = (progress) => {
        if (webgpuState.cancelRequested) return;
        const progressWithMeta = { ...progress, sourceUrl };

        if (progress.retryingWithDtype) {
            clearTimers();
            if (onProgress) onProgress(0, {
                status: 'init',
                file: `Reintentando con cuantización ${progress.retryingWithDtype}`,
                sourceUrl,
                retryingWithDtype: progress.retryingWithDtype,
                previousError: progress.previousError
            });
            return;
        }

        if (progress.status === 'progress' && progress.total) {
            clearTimers();
            const pct = Math.round((progress.loaded / progress.total) * 100);
            if (!shouldEmitWebGPUProgress(progressUiState, pct, progressWithMeta)) return;
            dom.statusText.textContent = `⬇ ${pct}%`;
            if (onProgress) onProgress(pct, progressWithMeta);
        } else if (progress.status === 'done') {
            const installPct = estimateInstallProgress(progressUiState, progress.file);
            dom.statusText.textContent = (typeof t==='function'?t('status.installing'):'Instalando...');
            if (onProgress) onProgress(installPct, { ...progressWithMeta, status: 'installing', file: progress.file || 'Registrando artefactos descargados' });
            // Tras el último 'done', la compilación de shaders no emite eventos:
            // si en 2s no llega nada más, se muestra la fase 'compiling'.
            clearTimers();
            shaderTimer = setTimeout(() => {
                if (!webgpuState.isLoading || webgpuState.cancelRequested) return;
                const t0 = Date.now();
                const compileMsg = 'Compilando kernels WebGPU';
                dom.statusText.textContent = compileMsg;
                if (onProgress) onProgress(97, { ...progressWithMeta, status: 'compiling', file: `${compileMsg} para tu acelerador` });
                shaderInterval = setInterval(() => {
                    if (!webgpuState.isLoading || webgpuState.cancelRequested) { clearInterval(shaderInterval); return; }
                    const secs = Math.round((Date.now() - t0) / 1000);
                    const timeMsg = `${compileMsg} — ${secs}s transcurridos`;
                    dom.statusText.textContent = timeMsg;
                    if (onProgress) onProgress(97, { ...progressWithMeta, status: 'compiling', file: timeMsg, _compileOverdue: secs >= 120 });
                }, 4000);
            }, 2000);
        } else if (progress.status === 'ready') {
            clearTimers();
            dom.statusText.textContent = (typeof t==='function'?t('status.initializing'):'Inicializando...');
            if (onProgress) onProgress(97, { ...progressWithMeta, status: 'initializing', file: progress.file || 'Levantando pipeline local' });
        } else if (progress.status === 'init') {
            clearTimers();
            dom.statusText.textContent = (typeof t==='function'?t('status.preparing'):'Preparando...');
            if (onProgress) onProgress(0, progressWithMeta);
        }
    };

    return { handle, clearTimers };
}

async function loadWebGPUModelViaWorker(modelId, onProgress, task = 'text-generation') {
    if (webgpuWorker.loadedModelId === modelId && webgpuWorker.loadedTask === task) {
        return { __worker: true, modelId, task };
    }
    if (webgpuState.isLoading) return null;
    webgpuState.isLoading = true;
    webgpuState.cancelRequested = false;
    webgpuState.pipeline = null;
    webgpuState.loadedModelId = null;
    webgpuState.loadedTask = null;
    webgpuWorker.loadedModelId = null;
    webgpuWorker.loadedTask = null;

    const sourceUrl = buildWebGPURepoUrl(modelId);
    const router = createWebGPULoadProgressRouter({ onProgress, sourceUrl });

    try {
        const modelDef = WEBGPU_MODELS.find(m => m.id === modelId);
        const dtypeCandidates = Array.from(new Set([
            modelDef?.dtype || 'q4f16',
            ...((Array.isArray(modelDef?.fallbackDtypes) ? modelDef.fallbackDtypes : []))
        ]));

        dom.statusDot.className = 'status-dot loading';
        dom.statusText.textContent = (typeof t==='function'?t('status.preparing'):'Preparando...');
        if (onProgress) onProgress(0, { status: 'init', file: 'Preparando runtime local en segundo plano', sourceUrl });

        await webgpuWorker.call(
            { type: 'load', modelId, task, dtypeCandidates },
            { onProgress: router.handle }
        );

        router.clearTimers();
        if (webgpuState.cancelRequested) {
            webgpuWorker.dispose();
            throw new DOMException('Carga cancelada por el usuario.', 'AbortError');
        }

        dom.statusText.textContent = (typeof t==='function'?t('status.initPipeline'):'Inicializando pipeline...');
        if (onProgress) {
            onProgress(100, {
                status: 'initializing',
                file: 'Compilando kernels finales y dejando el pipeline listo',
                sourceUrl
            });
        }

        const sentinel = { __worker: true, modelId, task };
        webgpuState.pipeline = sentinel;
        webgpuState.loadedModelId = modelId;
        webgpuState.loadedTask = task;
        webgpuWorker.loadedModelId = modelId;
        webgpuWorker.loadedTask = task;
        dom.statusText.textContent = (typeof t==='function'?t('status.ready'):'Listo');
        return sentinel;
    } catch (e) {
        console.error('[WebGPU worker] load error:', e);
        throw e;
    } finally {
        router.clearTimers();
        webgpuState.isLoading = false;
    }
}

/**
 * updateGenerationStatus — pulso de vida en la barra de estado durante la
 * generación local. Sin esto, una respuesta larga muestra un estado estático
 * y parece que la app se ha quedado colgada.
 */
const _genStatusThrottle = { ts: 0 };
function updateGenerationStatus(tokenCount, startTime) {
    const now = performance.now();
    if (now - _genStatusThrottle.ts < 500) return;
    _genStatusThrottle.ts = now;
    const secs = (Date.now() - startTime) / 1000;
    const tps = secs > 0.5 && tokenCount > 0 ? ` · ${(tokenCount / secs).toFixed(1)} t/s` : '';
    dom.statusText.textContent = `✍️ Generando… ${tokenCount} tkn${tps}`;
}

/**
 * detectRepetitionLoop — detecta si la cola del texto generado es un ciclo
 * que se repite literalmente (comportamiento degenerado de modelos pequeños
 * que no emiten fin-de-secuencia). Busca un periodo p tal que los últimos
 * 3 bloques de longitud p sean idénticos.
 */
function detectRepetitionLoop(text) {
    if (!text || text.length < 400) return false;
    const tail = text.slice(-390);
    for (let p = 10; p <= 130; p++) {
        if (tail.length < p * 3) break;
        const a = tail.slice(-p);
        const b = tail.slice(-2 * p, -p);
        if (a !== b) continue;
        const c = tail.slice(-3 * p, -2 * p);
        if (b === c) return true;
    }
    return false;
}

const WEBGPU_LOOP_STOP_NOTE = '\n\n*(Generación detenida automáticamente: el modelo entró en un bucle de repetición.)*';

/**
 * maybeStopRepetitionLoop — si el stream entra en bucle, interrumpe la
 * generación en curso (worker o inline) una sola vez y marca el mensaje.
 */
function maybeStopRepetitionLoop(assistantMsg, fullText) {
    if (assistantMsg._loopStopped) return;
    if (!detectRepetitionLoop(fullText)) return;
    assistantMsg._loopStopped = true;
    console.warn('[WebGPU] bucle de repetición detectado; deteniendo la generación');
    webgpuWorker.interrupt();
    webgpuState.activeStopper?.interrupt?.();
}

/**
 * splitWebGPUThinking — separa la cadena de razonamiento de la respuesta en
 * la salida cruda de modelos locales tipo R1/QwQ, que emiten
 * `<think>…</think>` (o `<|think|>…<|/think|>`) antes de responder. Algunas
 * variantes arrancan ya "pensando" y solo emiten la etiqueta de cierre.
 */
function splitWebGPUThinking(rawText) {
    if (!rawText) return { thinking: '', content: '' };
    const closeMatch = rawText.match(/<\/\|?think\|?>/i);
    if (closeMatch) {
        const thinking = rawText.slice(0, closeMatch.index).replace(/^\s*<\|?think\|?>/i, '');
        const content = rawText.slice(closeMatch.index + closeMatch[0].length);
        return { thinking: thinking.trim(), content: content.replace(/^\s+/, '') };
    }
    const openMatch = rawText.match(/^\s*<\|?think\|?>/i);
    if (openMatch) {
        // Aún dentro del razonamiento (no ha llegado el cierre)
        return { thinking: rawText.slice(openMatch[0].length).trim(), content: '' };
    }
    return { thinking: '', content: rawText };
}

/**
 * applyWebGPUStreamedText — vuelca el texto acumulado del stream en el
 * mensaje, separando razonamiento y respuesta.
 */
function applyWebGPUStreamedText(assistantMsg, rawText) {
    const parts = splitWebGPUThinking(rawText);
    assistantMsg.thinking = parts.thinking;
    assistantMsg.content = parts.content;
    return parts;
}

async function runWebGPUGenerationViaWorker(pipe, promptInput, assistantMsg, msgIdx) {
    const startTime = Date.now();
    let fullResponse = '';

    const signal = state.abortController?.signal;
    const onAbort = () => webgpuWorker.interrupt();
    if (signal) {
        if (signal.aborted) webgpuWorker.interrupt();
        else signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
        const isMultimodal = promptInput && typeof promptInput === 'object' && !Array.isArray(promptInput) && promptInput.text;
        const input = isMultimodal
            ? { messages: promptInput.text, images: promptInput.images || [] }
            : { messages: promptInput };

        const done = await webgpuWorker.call({
            type: 'generate',
            input,
            options: {
                max_new_tokens: parseInt(state.settings.maxTokens || 2048),
                temperature: parseFloat(state.settings.temperature ?? 0.8),
                top_p: parseFloat(state.settings.topP || 0.9),
            }
        }, {
            onToken: (text, tokenCount) => {
                if (!text || state.abortController?.signal?.aborted) return;
                fullResponse += text;
                clearMessageLoadingState(assistantMsg);
                applyWebGPUStreamedText(assistantMsg, fullResponse);
                updateStreamingMessage(msgIdx, assistantMsg);
                if (typeof tokenCount === 'number') updateGenerationStatus(tokenCount, startTime);
                maybeStopRepetitionLoop(assistantMsg, fullResponse);
            }
        });

        const finalText = extractGeneratedText(done.result);
        if (finalText) fullResponse = finalText;
        const tokenCount = done.tokenCount || 0;
        const elapsed = Date.now() - startTime;

        const parts = splitWebGPUThinking(fullResponse);
        let text = parts.content || (parts.thinking ? '*(El modelo solo generó razonamiento)*' : '*(Sin respuesta generada)*');
        if (assistantMsg._loopStopped) text += WEBGPU_LOOP_STOP_NOTE;
        return {
            text,
            thinking: parts.thinking,
            metrics: tokenCount > 0 && elapsed > 0
                ? {
                    eval_count: tokenCount,
                    total_time_ms: elapsed,
                    tps: (tokenCount / (elapsed / 1000)).toFixed(2)
                }
                : null
        };
    } finally {
        signal?.removeEventListener('abort', onAbort);
    }
}

async function analyzeImagesForWebGPUViaWorker(imageMetaList = [], onProgress) {
    const normalized = normalizeImageMeta(imageMetaList);
    if (normalized.length === 0) return [];

    const router = createWebGPULoadProgressRouter({
        onProgress,
        sourceUrl: buildWebGPURepoUrl(getVisionAssistDef().id)
    });
    try {
        const done = await webgpuWorker.call({
            type: 'caption',
            assistModelId: getVisionAssistDef().id,
            assistTask: getVisionAssistDef().task,
            images: normalized.map(img => ({
                dataUrl: `data:${img.mimeType || inferMimeTypeFromBase64(img.data)};base64,${img.data}`,
                name: img.name
            }))
        }, { onProgress: router.handle });

        if (onProgress) onProgress(100, { status: 'ready', file: `${normalized.length} imagen(es)` });
        return done.captions || [];
    } finally {
        router.clearTimers();
    }
}

// ─── WebGPU dispatchers (worker si es posible, inline si no) ─
// Coalescencia de carga: si la precarga en 2º plano y el envío piden el mismo
// modelo a la vez, comparten UNA sola descarga en lugar de competir (lo que
// antes hacía que la segunda recibiera null por la guarda isLoading).
let _webgpuLoadPromise = null;
let _webgpuLoadKey = null;

async function loadWebGPUModel(modelId, onProgress, task = 'text-generation') {
    const key = `${modelId}|${task}`;
    if (_webgpuLoadPromise && _webgpuLoadKey === key) {
        return _webgpuLoadPromise;
    }
    const p = _loadWebGPUModelUncoalesced(modelId, onProgress, task);
    _webgpuLoadPromise = p;
    _webgpuLoadKey = key;
    try {
        return await p;
    } finally {
        if (_webgpuLoadPromise === p) { _webgpuLoadPromise = null; _webgpuLoadKey = null; }
    }
}

async function _loadWebGPUModelUncoalesced(modelId, onProgress, task = 'text-generation') {
    const modelDef = WEBGPU_MODELS.find(m => m.id === modelId);
    if (modelDef?.omnimodal) return loadWebGPUOmnimodalModel(modelId, onProgress);
    const mode = await decideWebGPUExecutionMode();
    if (mode === 'worker') {
        try {
            return await loadWebGPUModelViaWorker(modelId, onProgress, task);
        } catch (e) {
            // Si el propio worker se rompe (no el modelo), reintenta inline
            if (webgpuWorker.broken) {
                console.warn('[WebGPU] worker roto, reintentando en hilo principal');
                webgpuState.executionMode = 'inline';
                return loadWebGPUModelInline(modelId, onProgress, task);
            }
            throw e;
        }
    }
    return loadWebGPUModelInline(modelId, onProgress, task);
}

/**
 * warmUpActiveWebGPUModel — precarga en segundo plano el modelo WebGPU activo
 * (descarga + inicialización) para que, cuando el usuario envíe, ya esté listo.
 * Silencioso: los errores se ignoran (el envío reintentará). No hace nada si el
 * proveedor no es WebGPU, si ya está cargado/cargando, o si es omnimodal.
 */
let _webgpuWarmedFor = null;
async function warmUpActiveWebGPUModel() {
    try {
        if (state.settings.provider !== 'webgpu') return;
        const modelId = state.settings.model;
        if (!modelId) return;
        if (webgpuState.loadedModelId === modelId) return;   // ya cargado
        if (webgpuState.isLoading || _webgpuLoadPromise) return; // ya en curso
        if (_webgpuWarmedFor === modelId) return;            // ya intentado en esta sesión
        const modelDef = WEBGPU_MODELS.find(m => m.id === modelId);
        if (!modelDef) return;
        _webgpuWarmedFor = modelId;
        const task = modelDef.task || 'text-generation';
        await loadWebGPUModel(modelId, () => { try { renderWebGPUMonitor(); } catch (e) {} }, task);
    } catch (e) {
        console.warn('[WebGPU] precarga en segundo plano fallida (se cargará al enviar):', e);
        _webgpuWarmedFor = null; // permite reintentar
    }
}
window.warmUpActiveWebGPUModel = warmUpActiveWebGPUModel;

async function runWebGPUGeneration(pipe, promptInput, assistantMsg, msgIdx) {
    if (pipe?.__omnimodal) {
        return runWebGPUOmnimodalGeneration(pipe, promptInput, assistantMsg, msgIdx);
    }
    if (pipe && pipe.__worker) {
        return runWebGPUGenerationViaWorker(pipe, promptInput, assistantMsg, msgIdx);
    }
    return runWebGPUGenerationInline(pipe, promptInput, assistantMsg, msgIdx);
}

async function analyzeImagesForWebGPU(imageMetaList = [], onProgress, userPrompt = '') {
    const engine = getVisionAssistDef().engine || 'caption';
    // Florence-2 y los VLM usan clases de modelo específicas que el worker de
    // captioning no maneja: se ejecutan siempre inline.
    if (engine === 'caption' && webgpuState.executionMode === 'worker' && !webgpuWorker.broken) {
        return analyzeImagesForWebGPUViaWorker(imageMetaList, onProgress);
    }
    return analyzeImagesForWebGPUInline(imageMetaList, onProgress, userPrompt);
}
