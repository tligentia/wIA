/* >>> imports (generado por scripts/gen-modules.mjs: no editar a mano) >>> */
// El primer import es el del módulo anterior: así se evalúan en orden (ver scripts/gen-modules.mjs).
import './10-docs.js?v=2610.AM';
import {
    estimateTokenCount, importTransformers, tr,
} from './01-core.js?v=2610.AM';
import {
    dom, idbStore, saveState, secretVault, state,
} from './02-state.js?v=2610.AM';
import {
    configureOnnxRuntime, webgpuState,
} from './03-webgpu.js?v=2610.AM';
import {
    getActiveProject,
} from './05-workspace.js?v=2610.AM';
import {
    PROJECT_DOCS_BUDGET_RATIO, getPromptTokenBudget, hashString,
} from './06-chat.js?v=2610.AM';
/* <<< imports <<< */

/* ============================================
   wIA — 11-rag.js
   Recuperación por similitud (RAG) sobre los documentos del proyecto
   --------------------------------------------
   Antes, la base de conocimiento de un proyecto se inyectaba ENTERA en el
   system prompt de cada mensaje: con dos o tres documentos se comía la ventana
   de contexto, y a partir de cierto tamaño simplemente no cabía y se recortaba
   a ciegas por el principio.

   Aquí los documentos se trocean, se convierten en vectores con un modelo de
   embeddings que corre en el propio navegador, y en cada consulta se recuperan
   solo los fragmentos que de verdad tienen que ver con lo que se pregunta.
   Nada sale del dispositivo: el índice vive cifrado en IndexedDB junto al resto.

   (Script clásico: comparte ámbito global con el resto de módulos.)
   ============================================ */

// Modelos de embeddings, por orden de preferencia. Se prueba el siguiente si
// uno no está disponible en Hugging Face o falla al cargar.
// · e5-small es multilingüe (la app es ES/EN) y exige prefijos distintos para
//   la consulta y para los pasajes; omitirlos degrada bastante los resultados.
// · MiniLM es el respaldo ligero: cinco veces más pequeño, pensado para inglés,
//   pero suficiente para no quedarse sin RAG en un equipo modesto.
// `minScore` es propio de cada modelo y NO es intercambiable: los E5 tienen una
// similitud de base altísima (dos textos sin relación ya rondan 0,70), mientras
// que en MiniLM lo no relacionado se queda por debajo de 0,20. Un umbral único
// dejaría pasar cualquier cosa en uno o lo filtraría todo en el otro.
const RAG_MODELS = [
    {
        id: 'Xenova/multilingual-e5-small',
        label: 'Multilingual E5 Small',
        size: '~120 MB',
        queryPrefix: 'query: ',
        passagePrefix: 'passage: ',
        minScore: 0.78,
    },
    {
        id: 'Xenova/all-MiniLM-L6-v2',
        label: 'All-MiniLM L6',
        size: '~25 MB',
        queryPrefix: '',
        passagePrefix: '',
        minScore: 0.25,
    },
];

// Trozos de ~1200 caracteres (≈340 tokens) con solape: el solape evita que una
// frase que cae justo en la costura pierda su contexto y deje de recuperarse.
const RAG_CHUNK_CHARS = 1200;
const RAG_CHUNK_OVERLAP = 180;
const RAG_MIN_CHUNK_CHARS = 80;
// Documentos por debajo de este tamaño no se indexan: caben enteros y montar un
// índice para ellos solo añade latencia y una descarga de modelo innecesaria.
const RAG_MIN_DOC_CHARS = 2500;
const RAG_MAX_CHUNKS_PER_QUERY = 12;
// Umbral de respaldo si el modelo activo no declara el suyo.
const RAG_MIN_SCORE = 0.25;
const RAG_INDEX_KEY = 'rag-index';

const ragState = {
    pipeline: null,
    modelId: null,
    modelDef: null,
    loading: null,      // promesa de carga en curso (coalescencia)
    index: null,        // { modelId, docs: { [docId]: {...} } }
    indexLoaded: false,
    lastError: null,
};

// ─── Troceado ────────────────────────────────
/**
 * chunkText — parte el texto en fragmentos solapados respetando, cuando puede,
 * los límites de párrafo o de frase para no cortar ideas por la mitad.
 */
function chunkText(text) {
    const clean = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!clean) return [];
    if (clean.length <= RAG_CHUNK_CHARS) return [{ text: clean, pos: 0 }];

    const chunks = [];
    let start = 0;

    while (start < clean.length) {
        let end = Math.min(start + RAG_CHUNK_CHARS, clean.length);

        if (end < clean.length) {
            // Se busca un corte limpio en el último tercio del fragmento:
            // primero fin de párrafo, luego fin de frase, luego espacio.
            const window = clean.slice(start, end);
            const floor = Math.floor(RAG_CHUNK_CHARS * 0.6);
            const breakAt = Math.max(
                window.lastIndexOf('\n\n'),
                window.lastIndexOf('\n'),
                window.lastIndexOf('. '),
                window.lastIndexOf('; ')
            );
            if (breakAt > floor) end = start + breakAt + 1;
        }

        const piece = clean.slice(start, end).trim();
        if (piece.length >= RAG_MIN_CHUNK_CHARS || chunks.length === 0) {
            chunks.push({ text: piece, pos: start });
        }

        if (end >= clean.length) break;
        start = Math.max(end - RAG_CHUNK_OVERLAP, start + 1);
    }

    return chunks;
}

// ─── Vectores ────────────────────────────────
// Los vectores se guardan cuantizados a int8. Vienen normalizados (norma 1), así
// que cada componente cabe en [-127, 127] sin pérdida apreciable para ordenar
// por similitud, y el índice ocupa la cuarta parte que en float32.
function quantizeVector(vector) {
    const out = new Array(vector.length);
    for (let i = 0; i < vector.length; i++) {
        out[i] = Math.max(-127, Math.min(127, Math.round(vector[i] * 127)));
    }
    return out;
}

/**
 * dotQuantized — producto escalar entre un vector de consulta en float y uno
 * cuantizado. Como ambos están normalizados, equivale al coseno.
 */
function dotQuantized(queryVector, quantized) {
    let sum = 0;
    const n = Math.min(queryVector.length, quantized.length);
    for (let i = 0; i < n; i++) sum += queryVector[i] * quantized[i];
    return sum / 127;
}

function hashDocument(doc) {
    const source = `${doc.name || ''}:${String(doc.data || '')}`;
    // hashString vive en 06-chat.js; se resuelve en tiempo de llamada.
    return `${typeof hashString === 'function' ? hashString(source) : source.length}-${source.length.toString(36)}`;
}

// ─── Modelo de embeddings ────────────────────
async function loadRagPipeline(onProgress) {
    if (ragState.pipeline) return ragState.pipeline;
    if (ragState.loading) return ragState.loading;

    ragState.loading = (async () => {
        const hf = webgpuState.hfModule || await importTransformers();
        webgpuState.hfModule = hf;
        const { pipeline, env } = hf;
        env.allowLocalModels = false;
        env.allowRemoteModels = true;
        env.useBrowserCache = true;
        env.remoteHost = 'https://huggingface.co';
        env.remotePathTemplate = '{model}/resolve/{revision}';
        if (typeof configureOnnxRuntime === 'function') configureOnnxRuntime(env);

        // WASM a propósito: el modelo de chat suele tener ocupada la GPU y un
        // encoder pequeño va sobrado en CPU. Así indexar no compite con generar.
        let lastError = null;
        for (const modelDef of RAG_MODELS) {
            try {
                const pipe = await pipeline('feature-extraction', modelDef.id, {
                    device: 'wasm',
                    dtype: 'q8',
                    progress_callback: (progress) => {
                        if (!onProgress) return;
                        if (progress.status === 'progress' && progress.total) {
                            onProgress(Math.round((progress.loaded / progress.total) * 100), {
                                ...progress,
                                sourceUrl: `https://huggingface.co/${modelDef.id}`,
                            });
                        }
                    },
                });
                ragState.pipeline = pipe;
                ragState.modelId = modelDef.id;
                ragState.modelDef = modelDef;
                ragState.lastError = null;
                return pipe;
            } catch (error) {
                lastError = error;
                console.warn(`[RAG] no se pudo cargar ${modelDef.id}; probando el siguiente.`, error);
            }
        }
        throw lastError || new Error('No hay ningún modelo de embeddings disponible.');
    })();

    try {
        return await ragState.loading;
    } finally {
        ragState.loading = null;
    }
}

async function embedTexts(texts, onProgress) {
    const pipe = await loadRagPipeline(onProgress);
    const vectors = [];
    // De uno en uno y cediendo el hilo: con lotes grandes el navegador se queda
    // sin repintar y la barra de progreso no avanza aunque el trabajo sí.
    for (let i = 0; i < texts.length; i++) {
        const output = await pipe(texts[i], { pooling: 'mean', normalize: true });
        vectors.push(Array.from(output.data));
        if (onProgress && (i % 4 === 0 || i === texts.length - 1)) {
            onProgress(Math.round(((i + 1) / texts.length) * 100), {
                status: 'embedding',
                file: `Fragmento ${i + 1} de ${texts.length}`,
            });
        }
        if (i % 8 === 7) await new Promise(resolve => setTimeout(resolve, 0));
    }
    return vectors;
}

// ─── Persistencia del índice ─────────────────
async function loadRagIndex() {
    if (ragState.indexLoaded) return ragState.index;
    try {
        const record = await idbStore.get(RAG_INDEX_KEY);
        const { value } = await secretVault.decryptRecord(record);
        ragState.index = (value && typeof value === 'object' && value.docs) ? value : null;
    } catch (e) {
        console.warn('[RAG] no se pudo leer el índice guardado:', e);
        ragState.index = null;
    }
    ragState.indexLoaded = true;
    return ragState.index;
}

async function saveRagIndex() {
    if (!ragState.index) return;
    // El índice contiene el texto literal de los documentos: se cifra igual que
    // los chats, no tendría sentido proteger unos y dejar el otro en claro.
    try {
        await idbStore.set(RAG_INDEX_KEY, await secretVault.encryptRecord(ragState.index));
    } catch (e) {
        console.warn('[RAG] no se pudo guardar el índice:', e);
    }
}

async function clearRagIndex() {
    ragState.index = null;
    ragState.indexLoaded = true;
    try { await idbStore.del(RAG_INDEX_KEY); } catch (e) {}
}
window.clearRagIndex = clearRagIndex;

// ─── Indexado ────────────────────────────────
function ragEligibleDocuments(project) {
    return (project?.documents || []).filter(doc => String(doc?.data || '').length >= RAG_MIN_DOC_CHARS);
}

/**
 * ensureProjectIndexed — deja el índice al día para un proyecto.
 * Solo procesa lo que falta o ha cambiado (comparando el hash del documento) y
 * elimina las entradas de documentos borrados, así que es seguro llamarlo
 * cuantas veces haga falta.
 */
async function ensureProjectIndexed(project, onProgress) {
    const docs = ragEligibleDocuments(project);
    if (docs.length === 0) return { indexed: 0, skipped: true };

    await loadRagIndex();
    if (!ragState.index) ragState.index = { modelId: null, docs: {} };

    // Cambiar de modelo invalida todos los vectores: no son comparables.
    const pipe = await loadRagPipeline(onProgress);
    if (ragState.index.modelId && ragState.index.modelId !== ragState.modelId) {
        console.log('[RAG] el modelo de embeddings ha cambiado; se reconstruye el índice.');
        ragState.index = { modelId: ragState.modelId, docs: {} };
    }
    ragState.index.modelId = ragState.modelId;

    const validIds = new Set(docs.map(d => d.id));
    // Documentos que ya no existen en el proyecto
    for (const docId of Object.keys(ragState.index.docs)) {
        const entry = ragState.index.docs[docId];
        if (entry.projectId === project.id && !validIds.has(docId)) delete ragState.index.docs[docId];
    }

    const pending = docs.filter(doc => {
        const entry = ragState.index.docs[doc.id];
        return !entry || entry.hash !== hashDocument(doc);
    });

    if (pending.length === 0) return { indexed: 0, upToDate: true };

    let done = 0;
    for (const doc of pending) {
        const chunks = chunkText(doc.data);
        if (chunks.length === 0) continue;
        const texts = chunks.map(c => `${ragState.modelDef.passagePrefix}${c.text}`);
        const vectors = await embedTexts(texts, (pct, info) => {
            if (!onProgress) return;
            onProgress(Math.round(((done + pct / 100) / pending.length) * 100), {
                ...info,
                file: `${doc.name} · ${info?.file || ''}`.trim(),
            });
        });

        ragState.index.docs[doc.id] = {
            projectId: project.id,
            name: doc.name,
            hash: hashDocument(doc),
            chunks: chunks.map(c => c.text),
            vectors: vectors.map(quantizeVector),
        };
        done++;
    }

    await saveRagIndex();
    return { indexed: done, total: pending.length };
}

// ─── Recuperación ────────────────────────────
/**
 * retrieveRelevantChunks — fragmentos más parecidos a la consulta, hasta
 * agotar el presupuesto de tokens disponible.
 */
async function retrieveRelevantChunks(query, project, tokenBudget) {
    if (!query || !query.trim()) return [];
    await loadRagIndex();
    if (!ragState.index?.docs) return [];

    const entries = Object.entries(ragState.index.docs)
        .filter(([, entry]) => entry.projectId === project.id);
    if (entries.length === 0) return [];

    const pipe = await loadRagPipeline();
    const output = await pipe(`${ragState.modelDef.queryPrefix}${query.trim()}`, { pooling: 'mean', normalize: true });
    const queryVector = Array.from(output.data);

    const minScore = Number.isFinite(ragState.modelDef?.minScore) ? ragState.modelDef.minScore : RAG_MIN_SCORE;
    const scored = [];
    for (const [, entry] of entries) {
        for (let i = 0; i < entry.vectors.length; i++) {
            const score = dotQuantized(queryVector, entry.vectors[i]);
            if (score >= minScore) {
                scored.push({ score, text: entry.chunks[i], docName: entry.name });
            }
        }
    }

    scored.sort((a, b) => b.score - a.score);

    const selected = [];
    let used = 0;
    for (const candidate of scored.slice(0, RAG_MAX_CHUNKS_PER_QUERY * 3)) {
        const cost = estimateTokenCount(candidate.text) + 16; // + cabecera del fragmento
        if (used + cost > tokenBudget) continue;
        selected.push(candidate);
        used += cost;
        if (selected.length >= RAG_MAX_CHUNKS_PER_QUERY) break;
    }
    return selected;
}

// ─── Integración con el envío de mensajes ────
function isRagEnabled() {
    return state.settings.ragEnabled !== false;
}

/**
 * prepareRagContext — punto de entrada desde sendMessage.
 *
 * Deja el resultado en `state._ragContext` porque los cuatro constructores de
 * mensajes (buildApiMessages, Gemini, Anthropic, WebGPU) son SÍNCRONOS y la
 * recuperación no lo es. Ante cualquier problema no se rompe el envío: se
 * limpia el contexto y buildSystemContext vuelve al recorte por tamaño de
 * siempre.
 */
async function prepareRagContext(chat, queryText, hooks = {}) {
    state._ragContext = null;
    if (!isRagEnabled()) return null;

    const project = state.projects.find(p => p.id === chat.projectId) || getActiveProject();
    const eligible = ragEligibleDocuments(project);
    if (eligible.length === 0) return null;
    if (!queryText || !queryText.trim()) return null;

    const budget = Math.floor(getPromptTokenBudget() * PROJECT_DOCS_BUDGET_RATIO);
    if (budget <= 0) return null;

    try {
        await ensureProjectIndexed(project, hooks.onProgress);
        const chunks = await retrieveRelevantChunks(queryText, project, budget);
        if (chunks.length === 0) return null;

        state._ragContext = {
            chatId: chat.id,
            projectId: project.id,
            chunks,
            docsTotal: (project.documents || []).length,
            docsMatched: new Set(chunks.map(c => c.docName)).size,
        };
        return state._ragContext;
    } catch (e) {
        // Sin RAG la app sigue funcionando exactamente como antes.
        console.warn('[RAG] recuperación no disponible; se usará el recorte por tamaño:', e);
        ragState.lastError = e;
        state._ragContext = null;
        return null;
    }
}

/**
 * formatRagContext — bloque de texto que se inyecta en el system prompt.
 * Se nombra el documento de origen para que el modelo pueda citarlo, y se dice
 * explícitamente que son extractos: si no, tiende a asumir que ha visto el
 * documento completo y afirma cosas sobre lo que no está.
 */
function formatRagContext(ragContext) {
    if (!ragContext?.chunks?.length) return '';
    const blocks = ragContext.chunks
        .map((c, i) => `\n--- Extracto ${i + 1} · ${c.docName} ---\n${c.text}\n`)
        .join('');
    return `[EXTRACTOS RELEVANTES DE LA BASE DE CONOCIMIENTO]:\n`
        + `Se han seleccionado automáticamente los fragmentos más relacionados con la pregunta `
        + `(${ragContext.chunks.length} de ${ragContext.docsTotal} documento(s)). `
        + `Son EXTRACTOS, no los documentos completos: si la respuesta requiere información que no aparece aquí, dilo en vez de suponerla.\n`
        + blocks + '\n';
}

// ─── Interfaz: estado del índice y reconstrucción ────
/**
 * renderRagIndexStatus — resume en Ajustes qué hay indexado del proyecto activo
 * y por qué (o por qué no). Sin esto, RAG es una caja negra: el usuario no sabe
 * si sus documentos se están usando ni por qué unos sí y otros no.
 */
async function renderRagIndexStatus() {
    const el = dom.ragIndexStatus;
    if (!el) return;

    const project = typeof getActiveProject === 'function' ? getActiveProject() : null;
    const allDocs = (project?.documents || []).length;

    if (!isRagEnabled()) { el.textContent = tr('rag.status.off', 'Desactivado: se envían los documentos completos.'); return; }
    if (allDocs === 0) { el.textContent = tr('rag.status.noDocs', 'Este proyecto no tiene documentos.'); return; }

    const eligible = ragEligibleDocuments(project);
    if (eligible.length === 0) {
        el.textContent = tr('rag.status.smallDocs', 'Los documentos son pequeños y caben enteros: no hace falta indexarlos.');
        return;
    }

    await loadRagIndex();
    const indexed = Object.values(ragState.index?.docs || {}).filter(d => d.projectId === project.id);
    const chunks = indexed.reduce((sum, d) => sum + (d.chunks?.length || 0), 0);

    if (indexed.length === 0) {
        el.textContent = tr('rag.status.pending', 'Se indexará en tu próximo mensaje ({n} documento(s)).')
            .replace('{n}', String(eligible.length));
        return;
    }
    el.textContent = tr('rag.status.ready', '{docs} documento(s) indexados en {chunks} fragmentos.')
        .replace('{docs}', String(indexed.length))
        .replace('{chunks}', String(chunks));
}
window.renderRagIndexStatus = renderRagIndexStatus;

/** Borra el índice y lo reconstruye para el proyecto activo. */
async function rebuildRagIndex() {
    const project = typeof getActiveProject === 'function' ? getActiveProject() : null;
    const eligible = ragEligibleDocuments(project);
    if (!project || eligible.length === 0) {
        alert(tr('rag.alert.nothing', 'Este proyecto no tiene documentos que necesiten índice.'));
        return;
    }

    const button = dom.ragReindexBtn;
    const original = button?.textContent;
    if (button) { button.disabled = true; button.textContent = tr('rag.reindexing', 'Indexando…'); }

    try {
        await clearRagIndex();
        await ensureProjectIndexed(project, (pct, info) => {
            if (dom.ragIndexStatus) {
                dom.ragIndexStatus.textContent = `${pct}% · ${info?.file || ''}`.trim();
            }
        });
        await renderRagIndexStatus();
    } catch (e) {
        console.warn('[RAG] no se pudo reconstruir el índice:', e);
        if (dom.ragIndexStatus) {
            dom.ragIndexStatus.textContent = tr('rag.status.error', 'No se pudo construir el índice: {msg}')
                .replace('{msg}', e?.message || String(e));
        }
    } finally {
        if (button) { button.disabled = false; button.textContent = original || tr('rag.reindex', 'Reconstruir índice'); }
    }
}

(function bindRagUI() {
    dom.ragEnabledToggle?.addEventListener('change', (event) => {
        state.settings.ragEnabled = event.target.checked;
        saveState();
        renderRagIndexStatus();
    });
    dom.ragReindexBtn?.addEventListener('click', rebuildRagIndex);
})();

window.prepareRagContext = prepareRagContext;
window.ensureProjectIndexed = ensureProjectIndexed;
window.rebuildRagIndex = rebuildRagIndex;

/* >>> exports (generado por scripts/gen-modules.mjs: no editar a mano) >>> */
export {
    prepareRagContext, formatRagContext, renderRagIndexStatus,
};
/* <<< exports <<< */
