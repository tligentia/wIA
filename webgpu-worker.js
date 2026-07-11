/* ============================================
   wIA — WebGPU Inference Worker
   Ejecuta Transformers.js fuera del hilo principal para que la UI
   siga fluida durante la carga y la generación de modelos locales.

   Protocolo (mensajes con `id` reciben respuesta con el mismo `id`):
     → {id, type:'probe'}                                → {id, type:'done', device, fp16}
     → {id, type:'load', modelId, task, dtypeCandidates} → {id, type:'progress', ...}* + {id, type:'done', dtype, device}
     → {id, type:'generate', input, options}             → {id, type:'token', text}* + {id, type:'done', text, tokenCount}
     → {id, type:'caption', images:[{dataUrl,name}]}     → {id, type:'progress', ...}* + {id, type:'done', captions}
     → {type:'interrupt'}                                → corta generación y marca carga como cancelada
     → {type:'dispose'}                                  → libera el pipeline activo
   Errores: {id, type:'error', message, name}
   ============================================ */

const TRANSFORMERS_CDN_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';

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
        const hf = await import(TRANSFORMERS_CDN_URL);
        const { env } = hf;
        env.allowLocalModels = false;
        env.allowRemoteModels = true;
        env.useBrowserCache = true;
        env.remoteHost = 'https://huggingface.co';
        env.remotePathTemplate = '{model}/resolve/{revision}';
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
        detail.includes('onnxruntime');
}

// Solo campos clonables y relevantes del evento de progreso de Transformers.js
function pickProgressFields(progress) {
    const { status, file, loaded, total, progress: pct, name } = progress || {};
    return { status, file, loaded, total, progress: pct, name };
}

async function handleLoad(msg) {
    const { id, modelId, task, dtypeCandidates } = msg;
    workerState.cancelRequested = false;

    const hf = await getHF();
    const { device, fp16 } = await detectDevice();
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

    const generationOptions = {
        max_new_tokens: options?.max_new_tokens || 2048,
        temperature: options?.temperature ?? 0.7,
        top_p: options?.top_p ?? 0.9,
        repetition_penalty: 1.1,
        do_sample: true,
    };

    if (hf.TextStreamer && pipe.tokenizer) {
        generationOptions.streamer = new hf.TextStreamer(pipe.tokenizer, {
            skip_prompt: true,
            skip_special_tokens: true,
            callback_function: (text) => {
                if (text) postMessage({ id, type: 'token', text });
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
    const hf = await getHF();
    const { device } = await detectDevice();

    if (!workerState.assistPipe || workerState.assistModelId !== msg.assistModelId) {
        workerState.assistPipe = await hf.pipeline(msg.assistTask || 'image-to-text', msg.assistModelId, {
            device,
            progress_callback: (progress) => {
                postMessage({ id, type: 'progress', ...pickProgressFields(progress) });
            }
        });
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
        } else if (msg.type === 'load') {
            await handleLoad(msg);
        } else if (msg.type === 'generate') {
            await handleGenerate(msg);
        } else if (msg.type === 'caption') {
            await handleCaption(msg);
        } else if (msg.type === 'interrupt') {
            workerState.cancelRequested = true;
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
