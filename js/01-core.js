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
    vision:       { label: '👁 Visión', shortLabel: 'Visión', cls: 'tag-vision' },
    thinking:     { label: '🧠 Thinking', shortLabel: 'Thinking', cls: 'tag-thinking' },
    coding:       { label: '💻 Código', shortLabel: 'Código', cls: 'tag-coding' },
    tools:        { label: '🧰 Tools', shortLabel: 'Tools', cls: 'tag-tools' },
    multilingual: { label: '🌍 Multiidioma', shortLabel: 'Multiidioma', cls: 'tag-multilingual' },
    fast:         { label: '⚡ Ligero', shortLabel: 'Ligero', cls: 'tag-fast' },
    large:        { label: '💎 Grande', shortLabel: 'Grande', cls: 'tag-large' },
    free:         { label: '🆓 Gratis', shortLabel: 'Gratis', cls: 'tag-free' },
    experimental: { label: '🧪 Experimental', shortLabel: 'Experimental', cls: 'tag-experimental' },
};

const MODEL_FILTER_ORDER = ['vision', 'thinking', 'coding', 'tools', 'multilingual', 'fast', 'large', 'free', 'experimental'];

// ─── WebGPU Curated Model Catalog ───────────
// Curated list of browser-friendly models. Vision-capable entries are
// surfaced for discovery/filtering but disabled until multimodal runtime support lands.
const WEBGPU_MODELS = [
    {
        id: 'HuggingFaceTB/SmolLM2-360M-Instruct',
        label: 'SmolLM2 360M',
        size: '~250 MB',
        sizeBytes: 250,
        tier: 'quick',
        dtype: 'q4f16',
        context: 8192,
        capabilities: ['fast'],
        desc: 'La opción más ligera para validar el flujo WebGPU y respuestas rápidas.',
        repoUrl: 'https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct'
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
        desc: 'Muy equilibrado para chat general en equipos modestos.',
        repoUrl: 'https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct'
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
        desc: 'Compacto y multilingüe. Muy útil para tareas simples y prompts cortos.',
        repoUrl: 'https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct'
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
        desc: 'Versión muy ligera enfocada a código y autocompletado local.',
        repoUrl: 'https://huggingface.co/onnx-community/Qwen2.5-Coder-0.5B-ONNX'
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
        desc: 'Contexto amplio y muy buen comportamiento para instrucciones sencillas.',
        repoUrl: 'https://huggingface.co/onnx-community/Llama-3.2-1B-Instruct-ONNX'
    },
    {
        id: 'onnx-community/Qwen2.5-1.5B-Instruct',
        label: 'Qwen 2.5 1.5B',
        size: '~1.0 GB',
        sizeBytes: 1000,
        tier: 'optional',
        dtype: 'q4f16',
        context: 32768,
        capabilities: ['multilingual'],
        desc: 'Salto notable en calidad manteniendo un consumo razonable.',
        repoUrl: 'https://huggingface.co/onnx-community/Qwen2.5-1.5B-Instruct'
    },
    {
        id: 'onnx-community/Qwen2.5-Coder-1.5B-Instruct',
        label: 'Qwen 2.5 Coder 1.5B',
        size: '~1.4 GB',
        sizeBytes: 1400,
        tier: 'optional',
        dtype: 'q4f16',
        context: 32768,
        capabilities: ['coding', 'multilingual'],
        desc: 'Muy buena opción para programación local con coste moderado.',
        repoUrl: 'https://huggingface.co/onnx-community/Qwen2.5-Coder-1.5B-Instruct'
    },
    {
        id: 'onnx-community/Qwen2.5-Math-1.5B-Instruct',
        label: 'Qwen 2.5 Math 1.5B',
        size: '~1.4 GB',
        sizeBytes: 1400,
        tier: 'optional',
        dtype: 'q4f16',
        context: 32768,
        capabilities: ['thinking', 'multilingual'],
        desc: 'Especializado en razonamiento y resolución paso a paso.',
        repoUrl: 'https://huggingface.co/onnx-community/Qwen2.5-Math-1.5B-Instruct'
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
        desc: 'Más consistente en seguimiento de instrucciones y contexto largo.',
        repoUrl: 'https://huggingface.co/onnx-community/Llama-3.2-3B-Instruct-ONNX'
    },
    {
        id: 'webgpu/Phi-4-mini-instruct-ONNX-GQA',
        label: 'Phi-4 Mini',
        size: '~2.2 GB',
        sizeBytes: 2200,
        tier: 'optional',
        dtype: 'q4f16',
        fallbackDtypes: ['q4'],
        context: 131072,
        capabilities: ['thinking', 'coding'],
        desc: 'Muy potente para razonamiento y tareas técnicas en local. Si la variante q4f16 falla, la app intenta degradar automáticamente a q4 para mejorar compatibilidad.',
        repoUrl: 'https://huggingface.co/webgpu/Phi-4-mini-instruct-ONNX-GQA'
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
        desc: 'El mejor equilibrio actual del catálogo para código en navegador.',
        repoUrl: 'https://huggingface.co/onnx-community/Qwen2.5-Coder-3B-Instruct'
    },
    {
        id: 'onnx-community/Apertus-8B-Instruct-2509-ONNX',
        label: 'Apertus 8B',
        size: '~5.4 GB',
        sizeBytes: 5400,
        tier: 'large',
        dtype: 'q4f16',
        context: 131072,
        capabilities: ['thinking', 'large'],
        desc: 'Modelo grande y muy capaz para equipos con GPU y memoria suficientes.',
        repoUrl: 'https://huggingface.co/onnx-community/Apertus-8B-Instruct-2509-ONNX'
    },
    {
        id: 'onnx-community/Qwen2-VL-2B-Instruct',
        label: 'Qwen2 VL 2B',
        size: '~2.8 GB',
        sizeBytes: 2800,
        tier: 'optional',
        dtype: 'q4f16',
        context: 32768,
        capabilities: ['vision', 'multilingual', 'experimental'],
        desc: 'Modelo multimodal de vision. Se intenta usar en chat VLM y, si falla, la app degrada automaticamente al analisis visual local.',
        repoUrl: 'https://huggingface.co/onnx-community/Qwen2-VL-2B-Instruct',
        experimental: true
    },
    {
        id: 'onnx-community/Phi-3.5-vision-instruct',
        label: 'Phi 3.5 Vision',
        size: '~4.2 GB',
        sizeBytes: 4200,
        tier: 'large',
        dtype: 'q4f16',
        context: 8192,
        capabilities: ['vision', 'thinking', 'experimental', 'large'],
        desc: 'Entrada multimodal avanzada. Se intenta usar en chat VLM y, si falla, la app degrada automaticamente al analisis visual local.',
        repoUrl: 'https://huggingface.co/onnx-community/Phi-3.5-vision-instruct',
        experimental: true
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
        desc: 'Modelo de razonamiento (R1) destilado de 1.5B. Escribe su cadena de pensamiento antes de responder.',
        repoUrl: 'https://huggingface.co/onnx-community/DeepSeek-R1-Distill-Qwen-1.5B-ONNX'
    }
    // Nota: DeepSeek-R1-Distill-Qwen-7B-ONNX y DeepSeek-R1-Distill-Llama-8B-ONNX
    // se retiraron del catálogo: los repos pasaron a "gated" en Hugging Face
    // (401 sin autenticación), por lo que fallaban para cualquier usuario.
];

const WEBGPU_IMAGE_ASSIST = {
    id: 'Xenova/vit-gpt2-image-captioning',
    task: 'image-to-text',
    label: 'Asistente visual local',
    desc: 'Convierte imágenes en descripciones locales para usarlas como contexto en el chat WebGPU.'
};

const WEBGPU_TEXT_FALLBACK_MODEL = 'HuggingFaceTB/SmolLM2-1.7B-Instruct';
const WEBGPU_PROGRESS_UI_MIN_INTERVAL_MS = 180;
const WEBGPU_PROGRESS_UI_MIN_DELTA_PCT = 2;

