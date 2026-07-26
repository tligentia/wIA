import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Bajo Plesk/Passenger (o cualquier PaaS) el puerto lo inyecta el entorno.
const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '127.0.0.1';

// El proxy CORS solo reenvía a hosts conocidos de proveedores de IA (más los
// que se añadan vía CORS_PROXY_ALLOW="host1,host2"). Sin esta lista sería un
// open relay si el puerto queda expuesto a la red.
const PROXY_ALLOWED_HOSTS = [
    'api.groq.com',
    'openrouter.ai',
    'generativelanguage.googleapis.com',
    'api.anthropic.com',
    'api.openai.com',
    'integrate.api.nvidia.com',
    'ollama.com',
    'huggingface.co',
    'hf.co',
    'duckduckgo.com',
    'wikipedia.org',
    ...(process.env.CORS_PROXY_ALLOW || '').split(',').map(h => h.trim()).filter(Boolean),
];

function isPrivateHostname(hostname) {
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') return true;
    if (hostname.endsWith('.local') || hostname.endsWith('.lan')) return true;
    // Rangos RFC1918 — motores locales (Ollama/LM Studio) en la red del usuario
    return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
}

function isProxyTargetAllowed(targetUrl) {
    const hostname = targetUrl.hostname;
    if (isPrivateHostname(hostname)) return true;
    return PROXY_ALLOWED_HOSTS.some(allowed =>
        hostname === allowed || hostname.endsWith(`.${allowed}`)
    );
}

/**
 * isSameOriginRequest — el proxy SOLO debe atender a la propia app.
 *
 * Sin esta comprobación, cualquier página web que el usuario visite podía
 * hacer fetch('http://127.0.0.1:8080/cors-proxy?url=http://192.168.1.1/…') y
 * LEER la respuesta (el proxy devolvía Access-Control-Allow-Origin: *), lo que
 * convertía este servidor local en un SSRF de lectura hacia la red privada del
 * usuario mientras estuviera arrancado.
 *
 * El navegador añade `Origin` a toda petición cross-origin y a cualquier
 * petición no-GET/HEAD; solo las GET del mismo origen lo omiten. Por eso
 * "sin Origin" es seguro, y "con Origin" exige que coincida con este host.
 */
function isSameOriginRequest(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
    if (!host) return false;
    try {
        return new URL(origin).host.toLowerCase() === host;
    } catch (_) {
        return false;
    }
}

// Cabeceras de seguridad + aislamiento de origen cruzado. COOP+COEP habilitan
// crossOriginIsolated → SharedArrayBuffer → WASM multihilo (onnxruntime-web más
// rápido). credentialless no exige CORP a terceros (fuentes/CDN cargan igual).
const SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
    // Ver scripts/csp-policy.mjs — mantener sincronizado (npm run check:csp)
    'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; worker-src 'self' blob:; child-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src *; manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; object-src 'none'",
};

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.onnx': 'application/octet-stream',
    '.wasm': 'application/wasm',
};

const server = http.createServer((req, res) => {
    // Nada de `Access-Control-Allow-Origin: *`: la app consume este servidor
    // desde su propio origen, así que no necesita CORS y abrirlo a cualquier
    // origen convertía el proxy en un relay legible desde webs de terceros.
    const sameOrigin = isSameOriginRequest(req);

    if (req.method === 'OPTIONS') {
        // Un preflight solo llega si alguien intenta usarnos cross-origin.
        res.writeHead(sameOrigin ? 204 : 403);
        res.end();
        return;
    }

    // CORS Proxy endpoint
    // Format: /cors-proxy?url=https://integrate.api.nvidia.com/v1/...
    if (req.url.startsWith('/cors-proxy')) {
        if (!sameOrigin) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Forbidden: el proxy solo atiende peticiones del propio origen.');
            return;
        }
        const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);

        // Health-check: la app lo usa para saber si el proxy existe
        // (en hosting estático esta ruta devuelve 404 y la app va directa).
        if (parsedUrl.searchParams.has('health')) {
            res.writeHead(204);
            res.end();
            return;
        }

        const targetUrlStr = parsedUrl.searchParams.get('url');

        if (!targetUrlStr) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Missing url parameter');
            return;
        }

        try {
            const targetUrl = new URL(targetUrlStr);

            if (!isProxyTargetAllowed(targetUrl)) {
                res.writeHead(403, { 'Content-Type': 'text/plain' });
                res.end(`Proxy target not allowed: ${targetUrl.hostname}. Añádelo con CORS_PROXY_ALLOW.`);
                return;
            }
            const headers = { ...req.headers };
            
            // Remove browser headers that would cause issues on the destination server.
            // `cookie` se elimina además por seguridad: son cookies de ESTE origen
            // y no deben viajar a un tercero.
            delete headers.host;
            delete headers.origin;
            delete headers.referer;
            delete headers.connection;
            delete headers.cookie;

            const client = targetUrl.protocol === 'https:' ? https : http;

            const proxyReq = client.request({
                hostname: targetUrl.hostname,
                port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
                path: targetUrl.pathname + targetUrl.search,
                method: req.method,
                headers: headers
            }, (proxyRes) => {
                const responseHeaders = { ...proxyRes.headers };
                // Rewrite redirects so they keep flowing through the proxy.
                // A relative Location (e.g. Hugging Face's /api/resolve-cache/...)
                // would otherwise be resolved by the browser against this origin.
                if (responseHeaders.location) {
                    try {
                        const absoluteLocation = new URL(responseHeaders.location, targetUrl).toString();
                        responseHeaders.location = `/cors-proxy?url=${encodeURIComponent(absoluteLocation)}`;
                    } catch (_) { /* leave Location untouched if it cannot be parsed */ }
                }
                // La respuesta se sirve al mismo origen: no se añaden cabeceras
                // CORS, y se descartan las que traiga el destino para que no
                // reabran el acceso a orígenes ajenos.
                delete responseHeaders['access-control-allow-origin'];
                delete responseHeaders['access-control-allow-credentials'];

                res.writeHead(proxyRes.statusCode, responseHeaders);
                proxyRes.pipe(res, { end: true });
            });

            proxyReq.on('error', (err) => {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(`Proxy Error: ${err.message}`);
            });

            req.pipe(proxyReq, { end: true });
        } catch (e) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end(`Invalid target URL: ${e.message}`);
        }
        return;
    }

    // Static file serving
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url.split('?')[0]);

    // Security check: ensure filePath is within __dirname. Comparar contra
    // `__dirname + separador` evita que un directorio HERMANO con el mismo
    // prefijo (p. ej. «…/wIA-otro») supere el startsWith y sirva ficheros
    // fuera de la raíz.
    const rootWithSep = __dirname.endsWith(path.sep) ? __dirname : __dirname + path.sep;
    if (filePath !== __dirname && !filePath.startsWith(rootWithSep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        const headers = { 'Content-Type': contentType, ...SECURITY_HEADERS };
        // El service worker no debe cachearse en el navegador o los despliegues
        // nuevos tardarían en propagarse.
        if (filePath.endsWith('sw.js')) headers['Cache-Control'] = 'no-cache';

        res.writeHead(200, headers);
        fs.createReadStream(filePath).pipe(res);
    });
});

server.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
});
