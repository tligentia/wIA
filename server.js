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
    'api.mistral.ai',
    'api.cerebras.ai',
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

// Nombres de host por los que se acepta servir el proxy, además de localhost y
// de cualquier IP literal. Imprescindible detrás de un proxy inverso con dominio
// propio: ALLOWED_HOSTS="wia.midominio.com,otro.dominio.com".
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || '')
    .split(',').map(h => h.trim().toLowerCase()).filter(Boolean);

// X-Forwarded-Host lo puede escribir cualquier cliente. Solo se atiende si quien
// despliega declara que hay un proxy inverso delante (TRUST_PROXY=1) que lo fija.
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || '');

function requestHost(req) {
    const forwarded = TRUST_PROXY ? String(req.headers['x-forwarded-host'] || '').split(',')[0].trim() : '';
    return String(forwarded || req.headers.host || '').toLowerCase();
}

// "host:puerto" → nombre de host sin puerto (respeta los corchetes de IPv6).
function hostnameOf(host) {
    const ipv6 = host.match(/^(\[[^\]]+\])(?::\d+)?$/);
    return ipv6 ? ipv6[1] : host.replace(/:\d+$/, '');
}

/**
 * isAllowedHost — corta el DNS rebinding.
 *
 * Una web ajena puede apuntar su propio dominio a 127.0.0.1 y, desde ahí,
 * llamar a este servidor "en mismo origen": el navegador no envía `Origin` (o
 * envía uno que coincide con el `Host`), así que la comprobación de origen no
 * lo detecta. Lo que delata el ataque es el `Host`, que lleva el dominio del
 * atacante. Por eso solo se aceptan:
 *   · localhost y las IP literales — una IP no se puede "rebindear": si el Host
 *     es una IP, la página se cargó de verdad desde esa dirección;
 *   · los nombres declarados en ALLOWED_HOSTS.
 */
function isAllowedHost(host) {
    const name = hostnameOf(host);
    if (!name) return false;
    if (name === 'localhost') return true;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name) || /^\[[0-9a-f:.]+\]$/.test(name)) return true;
    return ALLOWED_HOSTS.includes(name);
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
 * Tres barreras, de la más fiable a la más antigua:
 *  1. `Host` permitido (ver isAllowedHost): frena el DNS rebinding.
 *  2. `Sec-Fetch-Site`: el navegador lo fija y la página no puede falsearlo.
 *     La app llama al proxy con fetch() desde su propio origen, así que
 *     cualquier otro valor —`cross-site` de un <img> o un enlace en una web
 *     ajena, `none` de una URL pegada en la barra— no es la app. Los GET sin
 *     CORS no llevan `Origin`, y esta cabecera es lo único que los distingue.
 *     Si falta (navegador antiguo, página servida por http en la LAN, curl) se
 *     pasa a la tercera.
 *  3. `Origin`, cuando viene, debe coincidir con el `Host`.
 */
function isSameOriginRequest(req) {
    const host = requestHost(req);
    if (!isAllowedHost(host)) return false;

    const fetchSite = req.headers['sec-fetch-site'];
    if (fetchSite && fetchSite !== 'same-origin') return false;

    const origin = req.headers.origin;
    if (!origin) return true;
    try {
        return new URL(origin).host.toLowerCase() === host;
    } catch (_) {
        return false;
    }
}

/**
 * isPublicPath — qué ficheros de la carpeta se pueden servir.
 *
 * El servidor arranca en la raíz del repositorio, donde conviven la app y
 * cosas que nunca deben salir por HTTP: `.env.local` (credenciales), `.git/`
 * (historial y configuración), `.claude/`, `.vercel/`… Se rechaza todo lo que
 * cuelgue de un nombre oculto y lo que no es parte de la app en ejecución
 * (la misma lista que .vercelignore excluye del despliegue estático).
 */
const PRIVATE_TOP_LEVEL = new Set([
    'server.js', 'scripts', 'node_modules',
    'package.json', 'package-lock.json', 'readme.md', 'license',
]);

function isPublicPath(relPath) {
    const segments = relPath.split(/[\\/]+/).filter(Boolean);
    if (segments.some(seg => seg.startsWith('.'))) return false;
    // Windows ignora puntos y espacios finales: «server.js.» abre server.js.
    const top = (segments[0] || '').toLowerCase().replace(/[. ]+$/, '');
    return !PRIVATE_TOP_LEVEL.has(top);
}

// Sin datos durante este tiempo se da por muerta la conexión con el destino.
// Generoso a propósito: un motor local puede tardar minutos en cargar el modelo
// antes de emitir el primer token.
const PROXY_IDLE_TIMEOUT_MS = parseInt(process.env.PROXY_TIMEOUT_MS || '600000', 10);

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
    'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net blob: 'wasm-unsafe-eval'; worker-src 'self' blob:; child-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src *; manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; object-src 'none'",
};

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    // .mjs es imprescindible: onnxruntime carga su backend de WebGPU importando
    // lib/ort/*.mjs como módulo. Con `nosniff`, el navegador se niega a ejecutar
    // un módulo servido como application/octet-stream («Failed to fetch
    // dynamically imported module») y WebGPU se queda sin backend.
    '.mjs': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.onnx': 'application/octet-stream',
    '.wasm': 'application/wasm',
};

// Hosts rechazados ya avisados en el log (acotado: lo escribe el cliente).
const warnedHosts = new Set();

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
            const host = requestHost(req);
            const hostRejected = !isAllowedHost(host);
            // Un despliegue con dominio propio cae aquí hasta que se declara el
            // dominio: se avisa una vez en el log, porque en el navegador solo
            // se nota que el proxy "no está".
            if (hostRejected && warnedHosts.size < 20 && !warnedHosts.has(host)) {
                warnedHosts.add(host);
                console.warn(`[cors-proxy] Host no permitido: «${host}». Si es tu dominio, arranca con ALLOWED_HOSTS="${hostnameOf(host)}".`);
            }
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end(hostRejected
                ? 'Forbidden: host no permitido para el proxy (ver ALLOWED_HOSTS).'
                : 'Forbidden: el proxy solo atiende peticiones del propio origen.');
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
                // El contenido es de un tercero pero sale por ESTE origen. Si un
                // navegador lo abriese como documento, su HTML ejecutaría script
                // con acceso al almacenamiento de la app (claves incluidas). Con
                // `sandbox` queda en un origen opaco y sin script; fetch() —que
                // es como lo consume la app— ignora la CSP de la respuesta.
                responseHeaders['content-security-policy'] = "sandbox; default-src 'none'";
                responseHeaders['x-content-type-options'] = 'nosniff';
                // Una cookie del destino se guardaría para el origen de la app.
                delete responseHeaders['set-cookie'];

                res.writeHead(proxyRes.statusCode, responseHeaders);
                proxyRes.on('error', () => res.destroy());
                proxyRes.pipe(res, { end: true });
            });

            // Si el navegador corta (botón «Detener», pestaña cerrada), se corta
            // también la petición al motor. Sin esto el destino seguía generando
            // —y facturando tokens u ocupando la GPU— hacia un socket sin lector.
            res.on('close', () => {
                if (!res.writableFinished) proxyReq.destroy();
            });

            proxyReq.setTimeout(PROXY_IDLE_TIMEOUT_MS, () => {
                proxyReq.destroy(new Error('el destino no responde (timeout)'));
            });

            proxyReq.on('error', (err) => {
                // Con la respuesta ya empezada no se puede cambiar el estado:
                // solo queda cerrar para que el cliente vea el corte.
                if (res.headersSent) {
                    res.destroy();
                    return;
                }
                res.writeHead(502, { 'Content-Type': 'text/plain' });
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
    let relPath;
    try {
        relPath = decodeURIComponent(req.url.split('?')[0]);
    } catch (_) {
        relPath = null;
    }
    if (relPath === null || relPath.includes('\0')) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Bad Request');
        return;
    }
    let filePath = path.join(__dirname, relPath === '/' ? 'index.html' : relPath);

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

    // Dentro de la raíz, pero no todo es público. Se responde 404 —no 403—
    // para no confirmar qué ficheros privados existen.
    if (!isPublicPath(path.relative(__dirname, filePath))) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
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
