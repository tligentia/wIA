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
    try { webgpuWorker.dispose(); webgpuWorker.shutdown(); } catch (e) {}
    webgpuState.pipeline = null;
    webgpuState.loadedModelId = null;
    webgpuState.loadedTask = null;
    webgpuState.imageAssistPipeline = null;
    webgpuState.imageAssistModelId = null;
    webgpuState.isLoading = false;
    webgpuState.executionMode = null;
    dom.statusText.textContent = '🧹 Memoria liberada';
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
    clearInterval(_webgpuMonitorTimer);
    _webgpuMonitorTimer = setInterval(renderWebGPUMonitor, 2000);
}

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
        dom.statusText.textContent = 'Preparando...';
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
                            dom.statusText.textContent = 'Instalando...';
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
                            dom.statusText.textContent = 'Inicializando...';
                            if (onProgress) onProgress(97, { ...progressWithMeta, status: 'initializing', file: progress.file || 'Levantando pipeline local' });
                        } else if (progress.status === 'init') {
                            clearTimeout(_shaderTimer);
                            clearInterval(_shaderInterval);
                            dom.statusText.textContent = 'Preparando...';
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

        dom.statusText.textContent = 'Inicializando pipeline...';
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
        dom.statusText.textContent = 'Listo';
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

    const pipe = await pipeline(assist.task, assist.id, {
        device,
        progress_callback: (progress) => {
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
        }
    });

    webgpuState.imageAssistPipeline = pipe;
    webgpuState.imageAssistModelId = assist.id;
    return pipe;
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
            dom.statusText.textContent = 'Instalando...';
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
            dom.statusText.textContent = 'Inicializando...';
            if (onProgress) onProgress(97, { ...progressWithMeta, status: 'initializing', file: progress.file || 'Levantando pipeline local' });
        } else if (progress.status === 'init') {
            clearTimers();
            dom.statusText.textContent = 'Preparando...';
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
        dom.statusText.textContent = 'Preparando...';
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

        dom.statusText.textContent = 'Inicializando pipeline...';
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
        dom.statusText.textContent = 'Listo';
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
                temperature: parseFloat(state.settings.temperature || 0.7),
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
async function loadWebGPUModel(modelId, onProgress, task = 'text-generation') {
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

async function runWebGPUGeneration(pipe, promptInput, assistantMsg, msgIdx) {
    if (pipe && pipe.__worker) {
        return runWebGPUGenerationViaWorker(pipe, promptInput, assistantMsg, msgIdx);
    }
    return runWebGPUGenerationInline(pipe, promptInput, assistantMsg, msgIdx);
}

async function analyzeImagesForWebGPU(imageMetaList = [], onProgress) {
    if (webgpuState.executionMode === 'worker' && !webgpuWorker.broken) {
        return analyzeImagesForWebGPUViaWorker(imageMetaList, onProgress);
    }
    return analyzeImagesForWebGPUInline(imageMetaList, onProgress);
}

