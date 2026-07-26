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
child.stderr.on('data', d => process.stderr.write('[server] ' + d));

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

child.kill();
await wait(200);
console.log(failures === 0 ? '\nTodo correcto.' : `\n${failures} fallo(s).`);
process.exitCode = failures === 0 ? 0 : 1;
