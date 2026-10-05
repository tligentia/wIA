/**
 * test-server — pruebas del servidor local y del endurecimiento del proxy CORS.
 *
 * La prueba clave es la del SSRF: sin la comprobación de mismo origen, cualquier
 * web que visitara el usuario podía usar este proxy para leer su red privada.
 *
 * Uso: npm run test:server
 */
import { spawn } from 'node:child_process';

const PORT = 18099;
const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
});
child.stderr.on('data', d => { if (!String(d).includes('Host no permitido')) process.stderr.write('[server] ' + d); });

const wait = ms => new Promise(r => setTimeout(r, ms));
await wait(900);

let failures = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failures++;
};

const base = `http://127.0.0.1:${PORT}`;

// 1. Estático mismo origen (sin Origin) → 200
{
    const r = await fetch(`${base}/index.html`);
    check('estático sirve index.html', r.status === 200, `status ${r.status}`);
    check('estático NO expone ACAO:*', r.headers.get('access-control-allow-origin') === null,
        String(r.headers.get('access-control-allow-origin')));
}

// 2. Health-check del proxy sin Origin → 204
{
    const r = await fetch(`${base}/cors-proxy?health=1`);
    check('health-check del proxy responde 204', r.status === 204, `status ${r.status}`);
}

// 3. Health-check con Origin del propio host → 204
{
    const r = await fetch(`${base}/cors-proxy?health=1`, { headers: { Origin: `http://127.0.0.1:${PORT}` } });
    check('proxy acepta Origin del mismo host', r.status === 204, `status ${r.status}`);
}

// 4. Origen ajeno → 403 (este es el SSRF que se cierra)
{
    const r = await fetch(`${base}/cors-proxy?url=${encodeURIComponent('http://192.168.1.1/')}`, {
        headers: { Origin: 'https://evil.example' },
    });
    check('proxy RECHAZA origen ajeno (SSRF cerrado)', r.status === 403, `status ${r.status}`);
    check('respuesta 403 sin ACAO', r.headers.get('access-control-allow-origin') === null,
        String(r.headers.get('access-control-allow-origin')));
}

// 5. Preflight cross-origin → 403
{
    const r = await fetch(`${base}/cors-proxy`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
    check('preflight cross-origin rechazado', r.status === 403, `status ${r.status}`);
}

// 6. Destino no permitido, con origen válido → 403 de allowlist
{
    const r = await fetch(`${base}/cors-proxy?url=${encodeURIComponent('https://example.com/')}`, {
        headers: { Origin: `http://127.0.0.1:${PORT}` },
    });
    check('allowlist de destinos sigue activa', r.status === 403, `status ${r.status}`);
}

// 7. Traversal con ruta cruda (fetch normalizaría el ../ antes de enviarlo)
{
    const net = await import('node:net');
    const status = await new Promise((resolve) => {
        const sock = net.connect(PORT, '127.0.0.1', () => {
            sock.write('GET /../../server.js HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
        });
        let buf = '';
        sock.on('data', d => { buf += d; });
        sock.on('close', () => resolve(Number((buf.match(/^HTTP\/1\.\d (\d{3})/) || [])[1]) || 0));
        sock.on('error', () => resolve(0));
    });
    check('no sirve fuera de la raíz', status === 403 || status === 404, `status ${status}`);
}

// ─── Peticiones con cabeceras que fetch() no deja fijar (Host, Sec-Fetch-*) ───
const http = await import('node:http');
const rawRequest = (port, path, headers = {}, { abortAfterMs = 0 } = {}) => new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
        let body = '';
        res.on('data', d => { body += d; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
        res.on('error', () => resolve({ status: res.statusCode, headers: res.headers, body, aborted: true }));
        if (abortAfterMs) setTimeout(() => req.destroy(), abortAfterMs);
    });
    req.on('error', () => resolve({ status: 0, headers: {}, body: '' }));
    req.end();
});
const raw = (path, headers, opts) => rawRequest(PORT, path, headers, opts);

// 8. Ficheros privados de la raíz: no se sirven (y sin delatar que existen)
{
    for (const p of ['/.gitignore', '/.github/workflows/ci.yml', '/.claude/launch.json', '/%2egitignore',
        '/server.js', '/SERVER.JS', '/scripts/csp-policy.mjs', '/package.json', '/README.md', '/LICENSE']) {
        const r = await raw(p);
        check(`no sirve ${p}`, r.status === 404, `status ${r.status}`);
    }
    for (const p of ['/js/01-core.js', '/Plantilla/Version.js', '/lang/es.json', '/lib/ort/ort-wasm-simd-threaded.jsep.mjs']) {
        const r = await raw(p);
        check(`sigue sirviendo ${p}`, r.status === 200, `status ${r.status}`);
    }
    const bad = await raw('/%E0%A4%A');
    check('ruta mal codificada → 400, sin caerse', bad.status === 400, `status ${bad.status}`);
}

// 9. DNS rebinding: el Host delata al dominio ajeno aunque no haya Origin
{
    const evil = `evil.example:${PORT}`;
    let r = await raw('/cors-proxy?health=1', { Host: evil });
    check('proxy RECHAZA Host ajeno sin Origin (rebinding)', r.status === 403, `status ${r.status}`);
    r = await raw('/cors-proxy?health=1', { Host: evil, Origin: `http://${evil}` });
    check('proxy RECHAZA Host y Origin ajenos que coinciden', r.status === 403, `status ${r.status}`);
    r = await raw('/cors-proxy?health=1', { Origin: 'https://evil.example', 'X-Forwarded-Host': 'evil.example' });
    check('X-Forwarded-Host no se atiende sin TRUST_PROXY', r.status === 403, `status ${r.status}`);
    r = await raw('/cors-proxy?health=1', { Host: `localhost:${PORT}` });
    check('proxy acepta Host localhost', r.status === 204, `status ${r.status}`);
    r = await raw('/cors-proxy?health=1', { Host: `192.168.1.20:${PORT}`, Origin: `http://192.168.1.20:${PORT}` });
    check('proxy acepta una IP literal de la LAN', r.status === 204, `status ${r.status}`);
    r = await raw('/index.html', { Host: evil });
    check('los estáticos no dependen del Host', r.status === 200, `status ${r.status}`);
}

// 10. Sec-Fetch-Site: solo las llamadas de la propia app
{
    let r = await raw('/cors-proxy?health=1', { 'Sec-Fetch-Site': 'same-origin' });
    check('Sec-Fetch-Site same-origin pasa', r.status === 204, `status ${r.status}`);
    r = await raw('/cors-proxy?health=1', { 'Sec-Fetch-Site': 'cross-site' });
    check('GET cross-site sin Origin (p. ej. <img>) rechazado', r.status === 403, `status ${r.status}`);
    r = await raw('/cors-proxy?health=1', { 'Sec-Fetch-Site': 'none' });
    check('navegación directa al proxy rechazada', r.status === 403, `status ${r.status}`);
}

// 11. Respuestas proxificadas: contenido ajeno neutralizado, aborto propagado
{
    const UP = PORT + 1;
    let upstreamClosed = false;
    const upstream = http.createServer((q, s) => {
        if (q.url === '/stream') {
            s.writeHead(200, { 'Content-Type': 'text/event-stream' });
            const timer = setInterval(() => s.write('data: x\n\n'), 50);
            s.on('close', () => { clearInterval(timer); upstreamClosed = true; });
            return;
        }
        if (q.url === '/reset') {
            s.writeHead(200, { 'Content-Type': 'text/plain' });
            s.write('parcial');
            setTimeout(() => s.socket.destroy(), 50);
            return;
        }
        s.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'sid=1', 'Access-Control-Allow-Origin': '*' });
        s.end('<script>alert(1)</script>');
    });
    await new Promise(r => upstream.listen(UP, '127.0.0.1', r));
    const via = (p) => `/cors-proxy?url=${encodeURIComponent(`http://127.0.0.1:${UP}${p}`)}`;

    let r = await raw(via('/page.html'));
    check('el proxy sigue reenviando el cuerpo', r.status === 200 && r.body.includes('alert(1)'), `status ${r.status}`);
    check('HTML ajeno sale con CSP sandbox', /(^|;\s*)sandbox/.test(r.headers['content-security-policy'] || ''),
        String(r.headers['content-security-policy']));
    check('y con nosniff', r.headers['x-content-type-options'] === 'nosniff', String(r.headers['x-content-type-options']));
    check('no reenvía Set-Cookie del destino', r.headers['set-cookie'] === undefined, String(r.headers['set-cookie']));
    check('ni su ACAO', r.headers['access-control-allow-origin'] === undefined, String(r.headers['access-control-allow-origin']));

    await raw(via('/stream'), {}, { abortAfterMs: 250 });
    for (let i = 0; i < 20 && !upstreamClosed; i++) await wait(100);
    check('al abortar el cliente se corta la petición al motor', upstreamClosed);

    await raw(via('/reset'));
    await wait(200);
    r = await raw('/cors-proxy?health=1');
    check('un corte del destino a mitad no tumba el servidor', r.status === 204, `status ${r.status}`);

    r = await raw(`/cors-proxy?url=${encodeURIComponent('http://127.0.0.1:1/')}`);
    check('destino inalcanzable → 502', r.status === 502, `status ${r.status}`);

    await new Promise(r => upstream.close(r));
}

// 11b. Acceso directo al anonimizador
{
    let r = await raw('/anon');
    check('/anon sirve la app', r.status === 200 && /<title>/.test(r.body) && /text\/html/.test(r.headers['content-type'] || ''), `status ${r.status}`);
    check('y con sus cabeceras de seguridad', !!r.headers['content-security-policy']);
    r = await raw('/anon/');
    check('/anon/ redirige a /anon (rutas relativas)', r.status === 302 && r.headers.location === '/anon', `${r.status} ${r.headers.location}`);
    r = await raw('/anonimo');
    check('una ruta parecida no se confunde', r.status === 404, `status ${r.status}`);
}

// 12. Despliegue con dominio propio tras un proxy inverso
{
    const PORT2 = PORT + 2;
    const child2 = spawn(process.execPath, ['server.js'], {
        cwd: process.cwd(),
        env: { ...process.env, PORT: String(PORT2), HOST: '127.0.0.1', ALLOWED_HOSTS: 'wia.example', TRUST_PROXY: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    child2.stderr.on('data', d => { if (!String(d).includes('Host no permitido')) process.stderr.write('[server2] ' + d); });
    await wait(900);
    let r = await rawRequest(PORT2, '/cors-proxy?health=1', { Host: 'wia.example' });
    check('ALLOWED_HOSTS admite el dominio declarado', r.status === 204, `status ${r.status}`);
    r = await rawRequest(PORT2, '/cors-proxy?health=1', { 'X-Forwarded-Host': 'wia.example', Origin: 'https://wia.example' });
    check('con TRUST_PROXY se atiende X-Forwarded-Host', r.status === 204, `status ${r.status}`);
    r = await rawRequest(PORT2, '/cors-proxy?health=1', { Host: 'otro.example' });
    check('y sigue rechazando dominios no declarados', r.status === 403, `status ${r.status}`);
    child2.kill();
}

child.kill();
await wait(200);
console.log(failures === 0 ? '\nTodo correcto.' : `\n${failures} fallo(s).`);
process.exitCode = failures === 0 ? 0 : 1;
