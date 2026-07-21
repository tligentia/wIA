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
    // Add CORS headers to all responses
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // CORS Proxy endpoint
    // Format: /cors-proxy?url=https://integrate.api.nvidia.com/v1/...
    if (req.url.startsWith('/cors-proxy')) {
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
            
            // Remove browser headers that would cause issues on the destination server
            delete headers.host;
            delete headers.origin;
            delete headers.referer;
            delete headers.connection;

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
                responseHeaders['Access-Control-Allow-Origin'] = '*';
                responseHeaders['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS, PUT, PATCH, DELETE';
                responseHeaders['Access-Control-Allow-Headers'] = '*';

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
    
    // Security check: ensure filePath is within __dirname
    if (!filePath.startsWith(__dirname)) {
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

        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
    });
});

server.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
});
