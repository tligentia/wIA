/* ============================================================
   wIA Service Worker — shell offline + PWA instalable
   ------------------------------------------------------------
   Estrategia conservadora para no interferir con la inferencia:
   - Solo intercepta GET del propio origen (+ los 2 CDN precacheados).
   - NUNCA toca /cors-proxy, las APIs de proveedores ni los modelos de
     Hugging Face (esos ya los cachea Transformers.js por su cuenta).
   - Navegación: network-first con fallback a index.html (arranque offline).
   - Estáticos: stale-while-revalidate (instantáneo y se actualiza en 2º plano,
     así los nuevos despliegues se recogen en la siguiente carga).
   ============================================================ */
const CACHE = 'wia-shell-v1';

// Rutas relativas: la app puede servirse en la raíz o bajo un subpath (portal).
// Todo el shell es del mismo origen (marked/highlight/pdf viven en lib/).
const CORE = [
    './', './index.html', './styles.css',
    './js/01-core.js', './js/02-state.js', './js/03-webgpu.js', './js/04-providers.js',
    './js/05-workspace.js', './js/06-chat.js', './js/07-ui.js', './js/08-anon.js',
    './js/09-i18n.js', './js/10-docs.js',
    './lib/marked.min.js', './lib/highlight.min.js', './lib/highlight-github-dark.min.css',
    './lib/anonimae-engine.js', './lib/anonimae-rules.json',
    './lib/pdf.min.js', './Plantilla/Version.js',
    './secure-gate.js', './webgpu-worker.js', './agents.json',
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
