/* ============================================================
   wIA Service Worker — shell offline + PWA instalable
   ------------------------------------------------------------
   Estrategia conservadora para no interferir con la inferencia:
   - Solo intercepta GET del propio origen (todo el shell es local: marked,
     highlight y pdf.js viven en lib/, no en un CDN).
   - NUNCA toca /cors-proxy, las APIs de proveedores ni los modelos de
     Hugging Face (esos ya los cachea Transformers.js por su cuenta).
   - Navegación: network-first con fallback a index.html (arranque offline).
   - Estáticos: stale-while-revalidate (instantáneo y se actualiza en 2º plano,
     así los nuevos despliegues se recogen en la siguiente carga).
   ============================================================ */
const CACHE = 'wia-shell-v2610.AJ';

// Rutas relativas: la app puede servirse en la raíz o bajo un subpath (portal).
// Todo el shell es del mismo origen (marked/highlight/pdf viven en lib/).
const CORE = [
    './', './index.html', './styles.css',
    './js/main.js?v=2610.AJ', './js/01-core.js?v=2610.AJ', './js/02-state.js?v=2610.AJ', './js/03-webgpu.js?v=2610.AJ', './js/04-providers.js?v=2610.AJ',
    './js/05-workspace.js?v=2610.AJ', './js/06-chat.js?v=2610.AJ', './js/07-ui.js?v=2610.AJ', './js/08-anon.js?v=2610.AJ',
    './js/09-i18n.js?v=2610.AJ', './js/10-docs.js?v=2610.AJ', './js/11-rag.js?v=2610.AJ', './js/12-pwa.js?v=2610.AJ',
    './lang/es.json', './lang/en.json',
    './lang/docs/es.json', './lang/docs/en.json',
    './lang/legal/es.json', './lang/legal/en.json',
    './lib/marked.min.js', './lib/highlight.min.js', './lib/highlight-github-dark.min.css',
    './lib/anonimae-engine.js', './lib/anonimae-rules.json',
    // transformers.min.js (868 KB) SÍ se precachea, y por una razón concreta: el
    // worker lo carga con import() y Chrome no pasa por el service worker el
    // módulo de entrada que importa un worker, así que el handler de fetch nunca
    // llega a guardarlo. Sin precacheo, la inferencia local no funcionaría
    // offline por mucho que el resto del runtime sí quedara cacheado.
    './lib/transformers.min.js',
    // El binario WebGPU (lib/ort/*, ~21 MB) NO se precachea: penalizaría la
    // instalación a todo el mundo, incluido quien solo usa motores cloud. Lo pide
    // onnxruntime por fetch/WebAssembly, que sí atraviesa el service worker, así
    // que el handler lo guarda la primera vez que se usa WebGPU y a partir de ahí
    // la inferencia local funciona sin conexión.
    // pdf.worker.min.js (1 MB) NO se precachea: pdf.js solo lo pide al abrir un
    // PDF, y cargarlo en la instalación penalizaba a todos —incluido quien nunca
    // adjunta uno— con 1 MB de descarga. El handler de fetch lo guarda en la
    // misma caché la primera vez que se usa, así que el offline con PDF sigue
    // funcionando a partir de entonces.
    './lib/pdf.min.js', './Plantilla/Version.js',
    './secure-gate.js', './portal-loader.js', './webgpu-worker.js', './agents.json', './webgpu-models.json',
    './lib/fonts/inter-latin.woff2', './lib/fonts/jetbrains-mono-latin.woff2',
    './manifest.webmanifest', './favicon.png', './icon-192.png', './icon-512.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        // Best-effort: en un subpath alguna ruta podría no resolver; no debe
        // impedir la instalación del resto del shell.
        await Promise.allSettled(CORE.map((u) => cache.add(u)));
        self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return; // las APIs son POST: no se tocan

    const url = new URL(req.url);
    if (url.pathname.startsWith('/cors-proxy')) return; // proxy: nunca cachear
    if (url.origin !== self.location.origin) return; // HF, proveedores, fuentes: directo a red

    // Navegación (documento): red primero, y si no hay conexión, el shell.
    if (req.mode === 'navigate') {
        event.respondWith((async () => {
            try {
                return await fetch(req);
            } catch (_) {
                const cache = await caches.open(CACHE);
                return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
            }
        })());
        return;
    }

    // Estáticos: stale-while-revalidate.
    event.respondWith((async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(req);
        const network = fetch(req).then((res) => {
            if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
            return res;
        }).catch(() => null);
        return cached || (await network) || Response.error();
    })());
});
