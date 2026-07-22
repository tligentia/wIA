/* ============================================
   wIA — 01-core.js
   Interceptor CORS, utilidades, saneado HTML, registro de proveedores y catálogo WebGPU
   (Scripts clásicos cargados en orden desde index.html;
   comparten el ámbito global igual que el antiguo app.js)
   ============================================ */

/* ============================================
   wIA — Application Logic
   Multi-Engine AI Chat Interface (Dynamic Versioning Enabled)
   ============================================ */

// ─── Global CORS Proxy Interceptor ───────────
(function() {
    const originalFetch = window.fetch;

    // El proxy /cors-proxy solo existe cuando la app se sirve con server.js.
    // En hosting estático (Netlify, GitHub Pages, Apache...) no está: se detecta
    // una única vez con un health-check y, si falta, las peticiones van directas
    // (los proveedores cloud principales soportan CORS desde navegador).
    let proxyProbe = null;
    function corsProxyAvailable() {
        if (!proxyProbe) {
            if (window.location.protocol === 'file:') {
                proxyProbe = Promise.resolve(false);
            } else {
                proxyProbe = originalFetch.call(window, '/cors-proxy?health=1', { method: 'GET' })
                    .then(res => res.status === 204)
                    .catch(() => false);
            }
        }
        return proxyProbe;
    }

    window.fetch = async function(input, init) {
        let url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : (input && input.url));

        if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
            try {
                const urlObj = new URL(url);
                const isSameOrigin = urlObj.host === window.location.host;
                const isWikipedia = urlObj.hostname.endsWith('wikipedia.org');

                let shouldProxy = !isSameOrigin && !isWikipedia;

                if (shouldProxy) {
                    // Hugging Face (y sus CDNs) sirven cabeceras CORS correctas en todos
                    // sus endpoints, así que no necesitan proxy. Además, HF responde a
                    // /resolve/<file> con un 307 y una Location RELATIVA
                    // (/api/resolve-cache/...): si esa respuesta pasa por /cors-proxy,
                    // el navegador resuelve la redirección contra este origen y la
                    // carga de modelos WebGPU falla con "Could not locate file".
                    const isHuggingFace = urlObj.hostname.endsWith('huggingface.co') ||
                                          urlObj.hostname.endsWith('hf.co') ||
                                          urlObj.hostname.endsWith('amazonaws.com') ||
                                          urlObj.hostname.includes('cdn-lfs') ||
                                          urlObj.hostname.endsWith('jsdelivr.net');
                    if (isHuggingFace) {
                        shouldProxy = false;
                    }
                }

                if (shouldProxy && await corsProxyAvailable()) {
                    const proxyUrl = `/cors-proxy?url=${encodeURIComponent(url)}`;
                    if (input instanceof Request) {
                        input = new Request(proxyUrl, input);
                    } else {
                        input = proxyUrl;
                    }
                }
            } catch (e) {
                console.error('Error in fetch proxy wrapper:', e);
            }
        }
        return originalFetch.call(this, input, init);
    };
})();


// ─── Performance Utilities ──────────────────

/**
 * debounce — delays fn execution until `ms` ms after the last call.
 * Used for search input and localStorage saves.
 */
function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/**
 * escapeHtml — reuses a single, persistent div node instead of creating
 * a new DOM element on every call (hot path during streaming).
 */
const _escapeDiv = document.createElement('div');
function escapeHtml(text) {
    _escapeDiv.textContent = text;
    return _escapeDiv.innerHTML;
}

const MARKDOWN_ALLOWED_TAGS = new Set([
    'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'hr', 'li', 'ol', 'p', 'pre', 'span', 'strong', 'table', 'tbody', 'td', 'th',
    'thead', 'tr', 'ul'
]);
const MARKDOWN_DROP_CONTENT_TAGS = new Set([
    'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea',
    'select', 'option', 'link', 'meta', 'base'
]);

function sanitizeRenderedHtml(html) {
    if (!html) return '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    [...doc.body.querySelectorAll('*')].forEach((node) => {
        const tag = node.tagName.toLowerCase();

        if (MARKDOWN_DROP_CONTENT_TAGS.has(tag)) {
            node.remove();
            return;
        }

        if (!MARKDOWN_ALLOWED_TAGS.has(tag)) {
            node.replaceWith(document.createTextNode(node.textContent || ''));
            return;
        }

        [...node.attributes].forEach((attr) => {
            const name = attr.name.toLowerCase();

            if (name.startsWith('on') || name === 'style' || name === 'srcdoc') {
                node.removeAttribute(attr.name);
                return;
            }

            if (tag === 'a' && name === 'href') {
                const href = (attr.value || '').trim();
                if (!/^(https?:|mailto:|tel:|#)/i.test(href)) {
                    node.removeAttribute('href');
                } else {
                    node.setAttribute('target', '_blank');
                    node.setAttribute('rel', 'noopener noreferrer');
                }
                return;
            }

            if (name === 'class') return;
            if (tag === 'a' && (name === 'target' || name === 'rel' || name === 'title')) return;

            node.removeAttribute(attr.name);
        });
    });

    return doc.body.innerHTML;
}

// ─── Provider Registry ──────────────────────
const PROVIDERS = {
    ollama:        { name: 'Ollama (Local)',     type: 'ollama',     auth: 'none',             defaultUrl: 'http://localhost:11434',                                  defaultModel: 'gemma4:e4b',                icon: '🟢' },
    ollama_remote: { name: 'Ollama (Remoto)',    type: 'ollama',     auth: 'optional_bearer',  defaultUrl: '',                                                        defaultModel: 'gemma4',                    icon: '🌐' },
    ollama_cloud:  { name: 'Ollama Cloud',      type: 'ollama',     auth: 'apikey',           defaultUrl: 'https://ollama.com',                            defaultModel: 'qwen3-vl:235b-instruct',    icon: '☁️' },
    lmstudio:      { name: 'LM Studio',          type: 'openai',     auth: 'none',             defaultUrl: 'http://localhost:1234/v1',                                 defaultModel: '',                          icon: '💻' },
    groq:          { name: 'Groq',               type: 'openai',     auth: 'apikey',           defaultUrl: 'https://api.groq.com/openai/v1',                          defaultModel: 'llama-3.3-70b-versatile',   icon: '⚡' },
    openrouter:    { name: 'OpenRouter',          type: 'openai',     auth: 'apikey',           defaultUrl: 'https://openrouter.ai/api/v1',                            defaultModel: 'google/gemma-3-27b-it',     icon: '🔀' },
    gemini:        { name: 'Google Gemini',       type: 'gemini',     auth: 'apikey',           defaultUrl: 'https://generativelanguage.googleapis.com/v1beta',        defaultModel: 'gemini-2.5-flash',          icon: '✨' },
    claude:        { name: 'Claude (Anthropic)',  type: 'anthropic',  auth: 'apikey',           defaultUrl: 'https://api.anthropic.com/v1',                            defaultModel: 'claude-sonnet-5',           icon: '🟣' },
    openai:        { name: 'OpenAI',              type: 'openai',     auth: 'apikey',           defaultUrl: 'https://api.openai.com/v1',                               defaultModel: 'gpt-4.1',                   icon: '🤖' },
    nvidia:        { name: 'Nvidia Integrate',    type: 'openai',     auth: 'apikey',           defaultUrl: 'https://integrate.api.nvidia.com/v1',                     defaultModel: 'meta/llama-3.3-70b-instruct', icon: '🟢' },
    webgpu:        { name: 'WebGPU (Browser)',    type: 'webgpu',     auth: 'none',             defaultUrl: '',                                                        defaultModel: 'onnx-community/Llama-3.2-1B-Instruct-ONNX', icon: '🧠' },
};

// ─── Model Function Metadata ────────────────
const MODEL_FUNCTION_DEFS = {
    omnimodal:    { label: '◉ Omnimodal', shortLabel: 'Omnimodal', cls: 'tag-omnimodal' },
    medical:      { label: '⚕ Imagen médica', shortLabel: 'Imagen médica', cls: 'tag-medical' },
    vision:       { label: '👁 Visión', shortLabel: 'Visión', cls: 'tag-vision' },
    thinking:     { label: '🧠 Thinking', shortLabel: 'Thinking', cls: 'tag-thinking' },
    coding:       { label: '💻 Código', shortLabel: 'Código', cls: 'tag-coding' },
    tools:        { label: '🧰 Tools', shortLabel: 'Tools', cls: 'tag-tools' },
    multilingual: { label: '🌍 Multiidioma', shortLabel: 'Multiidioma', cls: 'tag-multilingual' },
    fast:         { label: '⚡ Ligero', shortLabel: 'Ligero', cls: 'tag-fast' },
    large:        { label: '💎 Grande', shortLabel: 'Grande', cls: 'tag-large' },
    free:         { label: '🆓 Gratis', shortLabel: 'Gratis', cls: 'tag-free' },
    uncensored:   { label: '🔓 Sin censura', shortLabel: 'Sin censura', cls: 'tag-uncensored' },
    experimental: { label: '🧪 Experimental', shortLabel: 'Experimental', cls: 'tag-experimental' },
};

const MODEL_FILTER_ORDER = ['omnimodal', 'medical', 'vision', 'thinking', 'coding', 'tools', 'multilingual', 'fast', 'large', 'free', 'uncensored', 'experimental'];

// Marcas habituales de modelos sin alineamiento/censura en HF, Ollama y
// OpenRouter. Se detectan por el nombre del repo/modelo.
const UNCENSORED_NAME_HINTS = [
    'uncensored', 'abliterated', 'ablated', 'unfiltered', 'unaligned',
    'dolphin', 'nsfw', 'lewd', 'toxic-dpo', 'unlocked', 'decensored',
];

// ─── WebGPU Curated Model Catalog ───────────
// Catálogo curado de modelos que corren en el navegador. El campo `verified`
// indica que se cargó e infirió realmente en WebGPU (probado el 2026-07-14,
// Transformers.js 3.8.1). Los que fallaban se retiraron — ver nota al final.
const WEBGPU_MODELS = [
    // ── Ligeros y rápidos (verificados) ──────────────────────
    {
        id: 'onnx-community/SmolLM2-135M-Instruct-ONNX-MHA',
        label: 'SmolLM2 135M',
        size: '~140 MB',
        sizeBytes: 140,
        tier: 'quick',
        dtype: 'q4f16',
        context: 8192,
        capabilities: ['fast'],
        verified: true,
        desc: 'El modelo más liviano del catálogo. Ideal para arrancar y probar WebGPU en segundos.',
        repoUrl: 'https://huggingface.co/onnx-community/SmolLM2-135M-Instruct-ONNX-MHA'
    },
    {
        id: 'HuggingFaceTB/SmolLM2-360M-Instruct',
        label: 'SmolLM2 360M',
        size: '~250 MB',
        sizeBytes: 250,
        tier: 'quick',
        dtype: 'q4f16',
        context: 8192,
        capabilities: ['fast'],
        verified: true,
        desc: 'Muy ligero y rápido para respuestas cortas y validación del flujo local.',
        repoUrl: 'https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct'
    },
    {
        id: 'onnx-community/Qwen2.5-0.5B-Instruct',
        label: 'Qwen 2.5 0.5B',
        size: '~400 MB',
        sizeBytes: 400,
        tier: 'quick',
        dtype: 'q4f16',
        context: 32768,
        capabilities: ['fast', 'multilingual'],
        verified: true,
        desc: 'Muy ligero (~400 MB) y multilingüe, con contexto amplio (32K). Buena opción si buscas la carga más rápida.',
        repoUrl: 'https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct'
    },
    {
        id: 'onnx-community/granite-4.0-350m-ONNX-web',
        label: 'Granite 4.0 350M',
        size: '~450 MB',
        sizeBytes: 450,
        tier: 'quick',
        dtype: 'q4f16',
        context: 32768,
        capabilities: ['fast', 'multilingual'],
        verified: true,
        desc: 'Modelo compacto de IBM Granite, variante optimizada para navegador (-web).',
        repoUrl: 'https://huggingface.co/onnx-community/granite-4.0-350m-ONNX-web'
    },
    {
        id: 'onnx-community/Qwen2.5-Coder-0.5B-ONNX',
        label: 'Qwen 2.5 Coder 0.5B',
        size: '~550 MB',
        sizeBytes: 550,
        tier: 'quick',
        dtype: 'q4f16',
        context: 32768,
        capabilities: ['fast', 'coding', 'multilingual'],
        verified: true,
        desc: 'Versión muy ligera enfocada a código y autocompletado local.',
        repoUrl: 'https://huggingface.co/onnx-community/Qwen2.5-Coder-0.5B-ONNX'
    },
    {
        id: 'onnx-community/Qwen3-0.6B-ONNX',
        label: 'Qwen 3 0.6B',
        size: '~600 MB',
        sizeBytes: 600,
        tier: 'quick',
        dtype: 'q4f16',
        context: 32768,
        capabilities: ['fast', 'thinking', 'multilingual'],
        verified: true,
        desc: 'Última generación Qwen 3 en formato mínimo. Buen razonamiento para su tamaño.',
        repoUrl: 'https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX'
    },
    // Sin censura (abliterated): requieren dtype q4 — con q4f16 el runtime
    // falla al crear la sesión ("Type (tensor(float16))").
    {
        id: 'onnx-community/Qwen2.5-0.5B-Instruct-abliterated-v3-ONNX',
        label: 'Qwen 2.5 0.5B Abliterated v3',
        size: '~500 MB',
        sizeBytes: 500,
        tier: 'uncensored',
        dtype: 'q4',
        context: 32768,
        capabilities: ['fast', 'multilingual', 'uncensored'],
        verified: true,
        desc: 'Qwen 2.5 sin alineamiento (abliterated v3): responde sin los rechazos habituales. Úsalo con criterio.',
        repoUrl: 'https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct-abliterated-v3-ONNX'
    },
    {
        id: 'onnx-community/Qwen2.5-0.5B-Instruct-abliterated-ONNX',
        label: 'Qwen 2.5 0.5B Abliterated',
        size: '~500 MB',
        sizeBytes: 500,
        tier: 'uncensored',
        dtype: 'q4',
        context: 32768,
        capabilities: ['fast', 'multilingual', 'uncensored'],
        desc: 'Primera versión abliterated de Qwen 2.5 0.5B, sin filtros de rechazo. Úsalo con criterio.',
        verified: true,
        repoUrl: 'https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct-abliterated-ONNX'
    },
    {
        id: 'onnx-community/Llama-3.2-1B-Instruct-ONNX',
        label: 'Llama 3.2 1B',
        size: '~700 MB',
        sizeBytes: 700,
        tier: 'quick',
        dtype: 'q4f16',
        context: 131072,
        capabilities: ['fast'],
        verified: true,
        recommended: true,
        desc: 'Modelo por defecto recomendado: muy buen comportamiento para instrucciones y contexto amplio (128K). Algo más pesado (~700 MB) pero de mayor calidad.',
        repoUrl: 'https://huggingface.co/onnx-community/Llama-3.2-1B-Instruct-ONNX'
    },
    {
        id: 'HuggingFaceTB/SmolLM2-1.7B-Instruct',
        label: 'SmolLM2 1.7B',
        size: '~1.0 GB',
        sizeBytes: 1000,
        tier: 'quick',
        dtype: 'q4f16',
        context: 8192,
        capabilities: ['fast'],
        verified: true,
        desc: 'Muy equilibrado para chat general en equipos modestos.',
        repoUrl: 'https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct'
    },
    // ── Equilibrados / capaces (verificados) ─────────────────
    {
        id: 'onnx-community/Qwen2.5-Coder-1.5B-Instruct',
        label: 'Qwen 2.5 Coder 1.5B',
        size: '~1.4 GB',
        sizeBytes: 1400,
        tier: 'optional',
        dtype: 'q4f16',
        context: 32768,
        capabilities: ['coding', 'multilingual'],
        verified: true,
        desc: 'Muy buena opción para programación local con coste moderado.',
        repoUrl: 'https://huggingface.co/onnx-community/Qwen2.5-Coder-1.5B-Instruct'
    },
    {
        id: 'onnx-community/DeepSeek-R1-Distill-Qwen-1.5B-ONNX',
        label: 'DeepSeek R1 Qwen 1.5B',
        size: '~1.6 GB',
        sizeBytes: 1600,
        tier: 'optional',
        dtype: 'q4f16',
        context: 32768,
        capabilities: ['thinking', 'multilingual'],
        verified: true,
        desc: 'Modelo de razonamiento (R1) destilado de 1.5B. Escribe su cadena de pensamiento antes de responder.',
        repoUrl: 'https://huggingface.co/onnx-community/DeepSeek-R1-Distill-Qwen-1.5B-ONNX'
    },
    {
        id: 'onnx-community/Qwen2.5-Coder-3B-Instruct',
        label: 'Qwen 2.5 Coder 3B',
        size: '~2.1 GB',
        sizeBytes: 2100,
        tier: 'optional',
        dtype: 'q4f16',
        context: 32768,
        capabilities: ['coding', 'multilingual'],
        verified: true,
        desc: 'El mejor equilibrio del catálogo para código en navegador.',
        repoUrl: 'https://huggingface.co/onnx-community/Qwen2.5-Coder-3B-Instruct'
    },
    {
        id: 'onnx-community/Llama-3.2-3B-Instruct-ONNX',
        label: 'Llama 3.2 3B',
        size: '~2.4 GB',
        sizeBytes: 2400,
        tier: 'optional',
        dtype: 'q4f16',
        context: 131072,
        capabilities: ['thinking'],
        verified: true,
        desc: 'Más consistente en seguimiento de instrucciones y contexto largo.',
        repoUrl: 'https://huggingface.co/onnx-community/Llama-3.2-3B-Instruct-ONNX'
    },
    // ── Grande / exigente (sin verificar: descarga OK pero la
    //    compilación de kernels tardó demasiado en el test) ──
    {
        id: 'webgpu/Phi-4-mini-instruct-ONNX-GQA',
        label: 'Phi-4 Mini',
        size: '~2.2 GB',
        sizeBytes: 2200,
        tier: 'large',
        dtype: 'q4f16',
        fallbackDtypes: ['q4'],
        context: 131072,
        capabilities: ['thinking', 'coding', 'large'],
        verified: false,
        desc: 'Potente para razonamiento y tareas técnicas, pero pesado: la compilación de kernels puede tardar varios minutos la primera vez. Requiere un equipo con GPU holgada.',
        repoUrl: 'https://huggingface.co/webgpu/Phi-4-mini-instruct-ONNX-GQA'
    },
    // ── ◉ Omnimodal: modelos que ven y responden directamente ──
    //    El mismo modelo recibe imagen + texto y genera la respuesta final.
    //    Requieren AutoModelForVision2Seq; el pipeline genérico
    //    image-text-to-text no existe en Transformers.js 3.8.1.
    {
        id: 'HuggingFaceTB/SmolVLM-256M-Instruct',
        label: 'SmolVLM 256M Omnimodal',
        size: '~210 MB',
        sizeBytes: 210,
        tier: 'omnimodal',
        omnimodal: true,
        engine: 'vlm',
        context: 8192,
        capabilities: ['omnimodal', 'vision', 'thinking'],
        verified: true,
        recommended: true,
        desc: 'VLM ultracompacto: recibe imagen y pregunta en el mismo contexto y responde directamente. Recomendado para equipos modestos.',
        repoUrl: 'https://huggingface.co/HuggingFaceTB/SmolVLM-256M-Instruct'
    },
    {
        id: 'HuggingFaceTB/SmolVLM-500M-Instruct',
        label: 'SmolVLM 500M Omnimodal',
        size: '~390 MB',
        sizeBytes: 390,
        tier: 'omnimodal',
        omnimodal: true,
        engine: 'vlm',
        context: 8192,
        capabilities: ['omnimodal', 'vision', 'thinking'],
        verified: false,
        desc: 'Más capaz para comprensión visual y preguntas concretas. Tiene demo WebGPU oficial, pero aún no se ha probado en este equipo.',
        repoUrl: 'https://huggingface.co/HuggingFaceTB/SmolVLM-500M-Instruct'
    },
    // ── ⚕ Imagen médica: modelos compatibles con Transformers.js ──
    // DINOv2 X-Ray es un encoder radiológico (no clasifica patologías). SigLIP
    // aporta clasificación zero-shot orientativa para reconocer modalidad y
    // anatomía, pero no fue entrenado como dispositivo diagnóstico.
    {
        id: 'onnx-community/dinov2-base-xray-224-ONNX',
        label: 'DINOv2 Base X-Ray 224',
        size: '~50 MB',
        sizeBytes: 50,
        tier: 'medical',
        visionAssist: true,
        engine: 'medical-embedding',
        task: 'image-feature-extraction',
        dtype: 'q4f16',
        fallbackDtypes: ['q4'],
        context: 0,
        capabilities: ['medical', 'vision', 'fast'],
        verified: true,
        desc: 'Encoder de Stanford AIMI especializado en radiografías. Extrae una firma visual para comparación o RAG; no genera diagnósticos ni nombres de patologías.',
        repoUrl: 'https://huggingface.co/onnx-community/dinov2-base-xray-224-ONNX'
    },
    {
        id: 'tligent-ia/wound-classifier-onnx',
        label: 'Clasificador de Heridas',
        size: '~83 MB',
        sizeBytes: 83,
        tier: 'medical',
        visionAssist: true,
        engine: 'wound-classify',
        task: 'image-classification',
        dtype: 'q8',
        context: 0,
        capabilities: ['medical', 'vision'],
        verified: true,
        recommended: true,
        desc: 'Reconoce el tipo de herida en una foto: abrasión, hematoma, quemadura, corte, laceración, herida diabética/venosa/quirúrgica, úlcera por presión o piel normal. Orientativo, no sustituye valoración médica.',
        repoUrl: 'https://huggingface.co/tligent-ia/wound-classifier-onnx'
    },
    {
        id: 'Xenova/siglip-base-patch16-224',
        label: 'SigLIP Medical Zero-Shot',
        size: '~153 MB',
        sizeBytes: 153,
        tier: 'medical',
        visionAssist: true,
        engine: 'medical-zero-shot',
        task: 'zero-shot-image-classification',
        dtype: 'q4f16',
        fallbackDtypes: ['q4'],
        context: 0,
        capabilities: ['medical', 'vision'],
        verified: true,
        desc: 'Clasificación visual zero-shot para orientar modalidad y región anatómica. Es un modelo generalista: sus resultados médicos son exploratorios, no diagnósticos.',
        repoUrl: 'https://huggingface.co/Xenova/siglip-base-patch16-224'
    },
    // ── 👁 Visión: asistentes de imagen (verificados) ────────
    //    Estos modelos analizan la imagen adjunta y producen texto que se
    //    inyecta como contexto del modelo de chat (la "cadena visión → chat").
    //    Cada uno declara un `engine` según cómo se ejecuta en Transformers.js:
    //      · 'caption'   → pipeline image-to-text (descripción/OCR simple)
    //      · 'florence2' → Florence-2 multitarea (descripción detallada + OCR)
    //      · 'vlm'       → reservado para un VLM auxiliar que razone sobre la imagen
    //    El pipeline conversacional 'image-text-to-text' no existe en el
    //    runtime, pero los VLM SÍ funcionan cargando su clase de modelo.
    {
        id: 'onnx-community/Florence-2-base-ft',
        label: 'Florence-2 (visión avanzada)',
        size: '~450 MB',
        sizeBytes: 450,
        tier: 'vision',
        visionAssist: true,
        engine: 'florence2',
        context: 0,
        capabilities: ['vision', 'coding'],
        verified: true,
        recommended: true,
        desc: 'Modelo de visión avanzado de Microsoft: descripción detallada de la escena + lectura de texto (OCR) en la misma pasada. El mejor asistente visual del catálogo.',
        repoUrl: 'https://huggingface.co/onnx-community/Florence-2-base-ft'
    },
    {
        id: 'Xenova/vit-gpt2-image-captioning',
        label: 'ViT-GPT2 Captioning',
        size: '~250 MB',
        sizeBytes: 250,
        tier: 'vision',
        visionAssist: true,
        engine: 'caption',
        task: 'image-to-text',
        context: 0,
        capabilities: ['vision', 'fast'],
        verified: true,
        desc: 'Describe en una frase el contenido general de la imagen. Ligero y rápido.',
        repoUrl: 'https://huggingface.co/Xenova/vit-gpt2-image-captioning'
    },
    {
        id: 'onnx-community/distilvit-ONNX',
        label: 'DistilViT Captioning',
        size: '~230 MB',
        sizeBytes: 230,
        tier: 'vision',
        visionAssist: true,
        engine: 'caption',
        task: 'image-to-text',
        context: 0,
        capabilities: ['vision', 'fast'],
        verified: true,
        desc: 'Descripción de imágenes ligera (destilada, de Mozilla). Alternativa rápida al captioner por defecto.',
        repoUrl: 'https://huggingface.co/onnx-community/distilvit-ONNX'
    },
    {
        id: 'Xenova/trocr-small-printed',
        label: 'TrOCR Texto impreso',
        size: '~130 MB',
        sizeBytes: 130,
        tier: 'vision',
        visionAssist: true,
        engine: 'caption',
        task: 'image-to-text',
        context: 0,
        capabilities: ['vision', 'fast'],
        verified: true,
        desc: 'OCR: extrae el texto impreso de una imagen (capturas, documentos, carteles).',
        repoUrl: 'https://huggingface.co/Xenova/trocr-small-printed'
    },
    {
        id: 'Xenova/trocr-small-handwritten',
        label: 'TrOCR Manuscrito',
        size: '~130 MB',
        sizeBytes: 130,
        tier: 'vision',
        visionAssist: true,
        engine: 'caption',
        task: 'image-to-text',
        context: 0,
        capabilities: ['vision', 'fast'],
        verified: true,
        desc: 'OCR especializado en texto escrito a mano (notas, formularios rellenados).',
        repoUrl: 'https://huggingface.co/Xenova/trocr-small-handwritten'
    }
    // Búsqueda ampliada de 2026-07-15 (Transformers.js 3.8.1). Probados y NO añadidos:
    // · Qwen3-0.6B-heretic-abliterated-uncensored-ONNX, gemma-3-270m-ONNX,
    //   distil-qwen3-0.6b-text2sql-ONNX y Carbon-500M-ONNX → cargan con q4
    //   pero su tokenizer no trae chat template (son modelos base, no chat).
    // · Qwen2.5-1.5B-abliterated-ONNX y Qwen3-0.6b-heretic-ONNX → faltan
    //   ficheros en el repo ("Could not locate file").
    // · Apertus v1.1 (0.5B / 1.5B) → "Unsupported model type: apertus", igual
    //   que el 8B: la arquitectura no existe en Transformers.js.
    // · Dolphin3.0-Qwen2.5-1.5B-ONNX y Huihui-Qwen3.5-abliterated → sin ONNX
    //   q4/q4f16 publicado.
    //
    // Probados el 2026-07-14 (Transformers.js 3.8.1) y NO añadidos:
    // · Chat VLM (image-text-to-text): no existe el pipeline ni en 3.8.1 ni en
    //   4.2.0 → Qwen2-VL-2B y Phi-3.5-vision siguen fuera.
    // · CLIP/SigLIP (zero-shot-image-classification) y DETR/YOLOS
    //   (object-detection) cargan bien, pero no producen una descripción
    //   textual para el chat sin etiquetas candidatas o post-proceso.
    // · Xenova/mobileclip_s0 y onnx-community/manga-ocr-base-ONNX → faltan
    //   ficheros en el repo (model.onnx / tokenizer.json).
    //
    // Retirados tras probarlos uno a uno (2026-07-14, Transformers.js 3.8.1):
    // · Qwen2.5-1.5B-Instruct y Qwen2.5-Math-1.5B → "Aborted()" al inicializar.
    // · Qwen2-VL-2B y Phi-3.5-vision → pipeline 'image-text-to-text' no soportado.
    // · Apertus-8B → "Unsupported model type: apertus".
    // · gemma-3 (270m/1b), LFM2 (350M/700M), Qwen3-1.7B → fallo de runtime al cargar.
    // · DeepSeek-R1 7B/8B → repos pasaron a gated (401).
];

// Asistente visual por defecto (si el usuario no elige otro en el catálogo).
const WEBGPU_IMAGE_ASSIST = {
    id: 'Xenova/vit-gpt2-image-captioning',
    task: 'image-to-text',
    label: 'Asistente visual local',
    desc: 'Convierte imágenes en descripciones locales para usarlas como contexto en el chat WebGPU.'
};

/**
 * getVisionAssistDef — modelo de visión activo. El usuario puede elegir
 * cualquiera del tier 'vision' del catálogo; si no ha elegido ninguno (o el
 * guardado ya no existe), se usa el captioner por defecto.
 */
function getVisionAssistDef() {
    const chosenId = state?.settings?.webgpuVisionModel;
    if (chosenId) {
        const def = WEBGPU_MODELS.find(m => m.id === chosenId && m.visionAssist);
        if (def) return { ...def, task: def.task || 'image-to-text', engine: def.engine || 'caption' };
    }
    return { ...WEBGPU_IMAGE_ASSIST, engine: 'caption' };
}

const WEBGPU_TEXT_FALLBACK_MODEL = 'HuggingFaceTB/SmolLM2-1.7B-Instruct';
const WEBGPU_PROGRESS_UI_MIN_INTERVAL_MS = 180;
const WEBGPU_PROGRESS_UI_MIN_DELTA_PCT = 2;
