/* ============================================
   wIA — WebGPU Inference Worker
   Ejecuta Transformers.js fuera del hilo principal para que la UI
   siga fluida durante la carga y la generación de modelos locales.

   Protocolo (mensajes con `id` reciben respuesta con el mismo `id`):
     → {id, type:'probe'}                                → {id, type:'done', device, fp16}
     → {id, type:'prime'}                                → {id, type:'done', device, fp16, primed}
     → {id, type:'load', modelId, task, dtypeCandidates} → {id, type:'progress', ...}* + {id, type:'done', dtype, device}
     → {id, type:'generate', input, options}             → {id, type:'token', text}* + {id, type:'done', result, tokenCount}
         (options.do_sample:false → respuesta determinista, sin streaming útil: la usa el anonimizador)
     → {id, type:'caption', images:[{dataUrl,name}]}     → {id, type:'progress', ...}* + {id, type:'done', captions}
     → {type:'interrupt'}                                → corta generación y marca carga como cancelada
     → {type:'dispose'}                                  → libera el pipeline activo
   Errores: {id, type:'error', message, name}
   ============================================ */

// Runtime auto-alojado con respaldo al CDN. Réplica de la lógica de
// js/01-core.js (el worker no comparte ámbito con la app): manténlas
// sincronizadas al subir de versión.
const TRANSFORMERS_VERSION = '3.8.1';
const TRANSFORMERS_CDN_BASE = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}/dist/`;
const TRANSFORMERS_CDN_URL = `${TRANSFORMERS_CDN_BASE}transformers.min.js`;
// self.location es la URL del propio worker (raíz del despliegue), así que las
// rutas relativas funcionan igual bajo un subpath.
const TRANSFORMERS_LOCAL_URL = new URL('lib/transformers.min.js', self.location.href).href;
const ORT_LOCAL_DIR = new URL('lib/ort/', self.location.href).href;
const ORT_WASM_FILE = 'ort-wasm-simd-threaded.jsep.wasm';
const ORT_MJS_FILE = 'ort-wasm-simd-threaded.jsep.mjs';

// expectJsMime: un servidor que no conozca .mjs lo sirve como octet-stream y,
// con nosniff, el navegador no lo ejecuta como módulo. Eso cuenta como «no
// disponible» para que actúe el respaldo al CDN.
async function urlIsAvailable(url, expectJsMime = false) {
    try {
        const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
        if (!res.ok) return false;
        if (expectJsMime) {
            const type = (res.headers.get('content-type') || '').toLowerCase();
            if (!/javascript|ecmascript/.test(type)) return false;
        }
        return true;
    } catch (e) {
        return false;
    }
}

let transformersSources = null;
async function resolveSources() {
    if (transformersSources) return transformersSources;
    const [moduleOk, wasmOk, mjsOk] = await Promise.all([
        urlIsAvailable(TRANSFORMERS_LOCAL_URL, true),
        urlIsAvailable(ORT_LOCAL_DIR + ORT_WASM_FILE),
        urlIsAvailable(ORT_LOCAL_DIR + ORT_MJS_FILE, true),
    ]);
    const ortOk = wasmOk && mjsOk;
    transformersSources = {
        moduleUrl: moduleOk ? TRANSFORMERS_LOCAL_URL : TRANSFORMERS_CDN_URL,
        wasmPaths: ortOk ? ORT_LOCAL_DIR : TRANSFORMERS_CDN_BASE,
        origin: moduleOk && ortOk ? 'local' : (moduleOk || ortOk ? 'mixto' : 'cdn'),
    };
    return transformersSources;
}

const workerState = {
    hf: null,
    pipe: null,
    loadedModelId: null,
    loadedTask: null,
    assistPipe: null,
    assistModelId: null,
    stopper: null,
    cancelRequested: false,
    device: null,
    fp16: null,
};

async function getHF() {
    if (!workerState.hf) {
        const src = await resolveSources();
        let hf;
        try {
            hf = await import(src.moduleUrl);
        } catch (e) {
            if (src.moduleUrl === TRANSFORMERS_CDN_URL) throw e;
            // La copia local existe pero no se pudo ejecutar (MIME, corrupción…).
            transformersSources = { moduleUrl: TRANSFORMERS_CDN_URL, wasmPaths: TRANSFORMERS_CDN_BASE, origin: 'cdn' };
            hf = await import(TRANSFORMERS_CDN_URL);
        }
        const { env } = hf;
        env.allowLocalModels = false;
        env.allowRemoteModels = true;
        env.useBrowserCache = true;
        env.remoteHost = 'https://huggingface.co';
        env.remotePathTemplate = '{model}/resolve/{revision}';
        // Acelera onnxruntime: máximo de hilos WASM si hay aislamiento de origen
        // (SharedArrayBuffer), y SIMD. Mejora init y ops en CPU.
        try {
            const wasm = env?.backends?.onnx?.wasm;
            if (wasm) {
                const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
                wasm.numThreads = isolated ? Math.max(1, Math.min(self.navigator?.hardwareConcurrency || 4, 8)) : 1;
                wasm.simd = true;
                // Explícito siempre: con el módulo servido desde lib/, el valor
                // por defecto buscaría los .wasm junto a él.
                if (transformersSources?.wasmPaths) wasm.wasmPaths = transformersSources.wasmPaths;
            }
        } catch (e) { /* best-effort */ }
        workerState.hf = hf;
    }
    return workerState.hf;
}

async function detectDevice() {
    if (workerState.device !== null) {
        return { device: workerState.device, fp16: workerState.fp16 };
    }
    try {
        if (!self.navigator?.gpu) {
            workerState.device = 'wasm';
            workerState.fp16 = false;
        } else {
            const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
                || await navigator.gpu.requestAdapter();
            workerState.device = adapter ? 'webgpu' : 'wasm';
            workerState.fp16 = !!adapter?.features?.has('shader-f16');
        }
    } catch (e) {
        workerState.device = 'wasm';
        workerState.fp16 = false;
    }
    return { device: workerState.device, fp16: workerState.fp16 };
}

// Igual que adaptDtypesToDevice en la app: las variantes *f16 requieren
// WebGPU con shader-f16.
function adaptDtypes(dtypeCandidates, device, fp16) {
    if (device === 'webgpu' && fp16) return dtypeCandidates;
    const degraded = { q4f16: 'q4', fp16: 'fp32', q8f16: 'q8' };
    return Array.from(new Set(dtypeCandidates.map(d => degraded[d] || d)));
}

function errorMessage(error) {
    if (!error) return 'Error desconocido';
    if (typeof error.message === 'string' && error.message.trim()) return error.message.trim();
    const text = String(error);
    return text && text !== '[object Object]' ? text : 'Error desconocido sin mensaje';
}

function looksLikeRuntimeInitFailure(error) {
    const detail = errorMessage(error).toLowerCase();
    return /^\d+$/.test(errorMessage(error)) ||
        detail.includes('device lost') ||
        detail.includes('out of memory') ||
        detail.includes('oom') ||
        detail.includes('allocate') ||
        detail.includes('allocation') ||
        detail.includes('failed to create') ||
        detail.includes('webgpu') ||
        detail.includes('onnxruntime') ||
        // El repo no publica esa cuantización: otra variante puede existir.
        detail.includes('could not locate file');
}

// Solo campos clonables y relevantes del evento de progreso de Transformers.js
function pickProgressFields(progress) {
    const { status, file, loaded, total, progress: pct, name } = progress || {};
    return { status, file, loaded, total, progress: pct, name };
}

async function handleLoad(msg) {
    const { id, modelId, task, dtypeCandidates } = msg;
    workerState.cancelRequested = false;

    // El import del runtime (~20 MB) y la detección de adaptador son
    // independientes: en paralelo se solapa el coste en vez de encadenarlo.
    const [hf, dev] = await Promise.all([getHF(), detectDevice()]);
    const { device, fp16 } = dev;
    const candidates = adaptDtypes(dtypeCandidates && dtypeCandidates.length ? dtypeCandidates : ['q4f16'], device, fp16);

    if (workerState.loadedModelId === modelId && workerState.loadedTask === task && workerState.pipe) {
        postMessage({ id, type: 'done', dtype: null, device, alreadyLoaded: true });
        return;
    }

    // Libera el modelo anterior antes de cargar otro (evita OOM acumulativo)
    if (workerState.pipe && typeof workerState.pipe.dispose === 'function') {
        try { await workerState.pipe.dispose(); } catch (e) { /* mejor continuar */ }
    }
    workerState.pipe = null;
    workerState.loadedModelId = null;
    workerState.loadedTask = null;

    let pipe = null;
    let lastError = null;
    let usedDtype = null;

    for (let i = 0; i < candidates.length; i++) {
        const dtype = candidates[i];
        try {
            if (i > 0) {
                postMessage({
                    id, type: 'progress',
                    status: 'init',
                    retryingWithDtype: dtype,
                    previousError: errorMessage(lastError)
                });
            }
            pipe = await hf.pipeline(task, modelId, {
                device,
                dtype,
                progress_callback: (progress) => {
                    if (workerState.cancelRequested) return;
                    postMessage({ id, type: 'progress', ...pickProgressFields(progress), dtype });
                }
            });
            usedDtype = dtype;
            break;
        } catch (err) {
            lastError = err;
            const isLastAttempt = i === candidates.length - 1;
            if (isLastAttempt || !looksLikeRuntimeInitFailure(err)) throw err;
        }
    }
    if (!pipe && lastError) throw lastError;

    if (workerState.cancelRequested) {
        if (typeof pipe?.dispose === 'function') { try { await pipe.dispose(); } catch (e) {} }
        const abortErr = new Error('Carga cancelada por el usuario.');
        abortErr.name = 'AbortError';
        throw abortErr;
    }

    workerState.pipe = pipe;
    workerState.loadedModelId = modelId;
    workerState.loadedTask = task;
    postMessage({ id, type: 'done', dtype: usedDtype, device });
}

async function handleGenerate(msg) {
    const { id, input, options } = msg;
    const hf = await getHF();
    const pipe = workerState.pipe;
    if (!pipe) throw new Error('No hay ningún modelo cargado en el worker.');

    let tokenCount = 0;

    // do_sample:false (voraz, sin temperatura) es para tareas de extracción que
    // piden una respuesta repetible; el chat siempre muestrea.
    const sample = options?.do_sample !== false;
    const generationOptions = {
        max_new_tokens: options?.max_new_tokens || 2048,
        repetition_penalty: options?.repetition_penalty ?? 1.1,
        do_sample: sample,
    };
    if (sample) {
        generationOptions.temperature = options?.temperature ?? 0.7;
        generationOptions.top_p = options?.top_p ?? 0.9;
    }

    if (hf.TextStreamer && pipe.tokenizer) {
        generationOptions.streamer = new hf.TextStreamer(pipe.tokenizer, {
            skip_prompt: true,
            skip_special_tokens: true,
            callback_function: (text) => {
                // `n` permite a la UI mostrar el número de tokens en vivo
                if (text) postMessage({ id, type: 'token', text, n: tokenCount });
            },
            token_callback_function: () => { tokenCount++; }
        });
    }

    workerState.stopper = hf.InterruptableStoppingCriteria ? new hf.InterruptableStoppingCriteria() : null;
    if (workerState.stopper) generationOptions.stopping_criteria = workerState.stopper;

    let promptInput = input.messages;
    if (Array.isArray(input.images) && input.images.length > 0) {
        const rawImages = await Promise.all(input.images.map(u => hf.RawImage.fromURL(u)));
        promptInput = { text: input.messages, images: rawImages };
    }

    const result = await pipe(promptInput, generationOptions);
    workerState.stopper = null;
    postMessage({ id, type: 'done', result: serializeResult(result), tokenCount });
}

// El resultado del pipeline puede contener tensores no clonables: se reduce a
// las formas de texto que la app sabe interpretar (extractGeneratedText).
function serializeResult(result) {
    try {
        return JSON.parse(JSON.stringify(result, (key, value) => {
            if (typeof value === 'bigint') return Number(value);
            if (value && typeof value === 'object' && (ArrayBuffer.isView(value) || value instanceof ArrayBuffer)) return undefined;
            return value;
        }));
    } catch (e) {
        return null;
    }
}

async function handleCaption(msg) {
    const { id, images } = msg;
    const [hf, dev] = await Promise.all([getHF(), detectDevice()]);
    const { device, fp16 } = dev;

    if (!workerState.assistPipe || workerState.assistModelId !== msg.assistModelId) {
        // Igual que handleLoad: respetar el dtype del catálogo (q4/q8…). Sin
        // esto, en WebGPU el pipeline usa fp32 por defecto y descarga una
        // variante mucho más pesada del modelo de visión, duplicando la
        // descarga respecto a la ruta inline.
        const candidates = adaptDtypes(
            msg.dtypeCandidates && msg.dtypeCandidates.length ? msg.dtypeCandidates : ['q4'],
            device, fp16
        );
        const progress_callback = (progress) => {
            postMessage({ id, type: 'progress', ...pickProgressFields(progress) });
        };
        let assistPipe = null;
        let lastError = null;
        for (let i = 0; i < candidates.length; i++) {
            try {
                assistPipe = await hf.pipeline(msg.assistTask || 'image-to-text', msg.assistModelId, {
                    device, dtype: candidates[i], progress_callback
                });
                break;
            } catch (err) {
                lastError = err;
                if (i === candidates.length - 1 || !looksLikeRuntimeInitFailure(err)) throw err;
            }
        }
        if (!assistPipe && lastError) throw lastError;
        workerState.assistPipe = assistPipe;
        workerState.assistModelId = msg.assistModelId;
    }

    const captions = [];
    for (let i = 0; i < images.length; i++) {
        postMessage({ id, type: 'progress', status: 'progress', file: images[i].name || `imagen_${i + 1}`, loaded: i, total: images.length });
        const rawImage = await hf.RawImage.fromURL(images[i].dataUrl);
        const output = await workerState.assistPipe(rawImage);
        const first = Array.isArray(output) ? output[0] : output;
        const caption = (first?.generated_text || first?.text || '').trim();
        captions.push({ name: images[i].name, caption: caption || 'No se pudo extraer una descripcion util de la imagen.' });
    }
    postMessage({ id, type: 'done', captions });
}

self.onmessage = async (event) => {
    const msg = event.data || {};
    try {
        if (msg.type === 'probe') {
            const { device, fp16 } = await detectDevice();
            postMessage({ id: msg.id, type: 'done', device, fp16 });
        } else if (msg.type === 'prime') {
            // Adelanta el coste FIJO de cualquier carga —importar el runtime de
            // Transformers.js y sus binarios WASM, y negociar el adaptador— sin
            // saber todavía qué modelo se usará. Cuando llega el primer mensaje,
            // solo queda descargar los pesos.
            const [, dev] = await Promise.all([getHF(), detectDevice()]);
            postMessage({ id: msg.id, type: 'done', device: dev.device, fp16: dev.fp16, primed: true });
        } else if (msg.type === 'load') {
            await handleLoad(msg);
        } else if (msg.type === 'generate') {
            await handleGenerate(msg);
        } else if (msg.type === 'caption') {
            await handleCaption(msg);
        } else if (msg.type === 'interrupt') {
            workerState.cancelRequested = true;
            console.warn('[webgpu-worker] interrupt recibido · stopper presente:', !!workerState.stopper);
            workerState.stopper?.interrupt?.();
        } else if (msg.type === 'dispose') {
            if (workerState.pipe && typeof workerState.pipe.dispose === 'function') {
                try { await workerState.pipe.dispose(); } catch (e) {}
            }
            workerState.pipe = null;
            workerState.loadedModelId = null;
            workerState.loadedTask = null;
        }
    } catch (e) {
        postMessage({ id: msg.id, type: 'error', message: errorMessage(e), name: e?.name || 'Error' });
    }
};
