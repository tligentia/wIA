/**
 * smoke-browser — la app arranca y funciona en un Chrome REAL.
 *
 * Por qué: el resto de pruebas ejecutan los scripts en Node con un DOM de
 * mentira. Eso no ve lo que solo ocurre en un navegador (un script que falla al
 * cargar, la CSP bloqueando algo, el orden de los scripts, el foco de un
 * diálogo) y dejó pasar fallos como una búsqueda web que nunca terminaba.
 *
 * Sin dependencias: habla con Chrome por el protocolo DevTools (CDP) usando el
 * WebSocket nativo de Node 22. Necesita Chrome/Chromium: CHROME_BIN o la ruta
 * habitual del sistema (en ubuntu-latest de GitHub ya viene instalado).
 *
 * Uso: npm run test:smoke
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_PORT = 18211, MOCK_PORT = 18212, CDP_PORT = 18213;

let failures = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failures++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Chrome ────────────────────────────────────────────────────────────────
function findChrome() {
    const candidates = [
        process.env.CHROME_BIN,
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ].filter(Boolean);
    return candidates.find((p) => fs.existsSync(p));
}
const chromeBin = findChrome();
if (!chromeBin) {
    console.error('✖ No se encontró Chrome/Chromium. Define CHROME_BIN con su ruta.');
    process.exit(2);
}

// ── Motor simulado compatible con OpenAI ───────────────────────────────────
// 1ª petición con herramientas → pide una búsqueda; 2ª (ya con el resultado) → responde.
const engineLog = [];
const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', '*');
        if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
        if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'm' }] })); }
        if (!req.url.endsWith('/chat/completions')) { res.writeHead(404); return res.end(); }
        const b = JSON.parse(body || '{}');
        engineLog.push({ roles: b.messages.map((m) => m.role), tools: !!b.tools, toolCalls: b.messages.find((m) => m.tool_calls)?.tool_calls, toolMsg: b.messages.find((m) => m.role === 'tool') });
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const send = (o) => res.write('data: ' + JSON.stringify(o) + '\n\n');
        if (b.tools && !b.messages.some((m) => m.role === 'tool')) {
            send({ choices: [{ delta: { tool_calls: [{ id: 'call_1', function: { name: 'search_web', arguments: '{"query":"capital de Francia"}' } }] } }] });
            send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
        } else {
            send({ choices: [{ delta: { content: 'La capital es ' } }] });
            send({ choices: [{ delta: { content: 'París.' } }] });
        }
        res.write('data: [DONE]\n\n');
        res.end();
    });
});

// ── Arranque ────────────────────────────────────────────────────────────────
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(APP_PORT), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wia-smoke-'));
const chrome = spawn(chromeBin, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox', '--window-size=1280,900', 'about:blank',
], { stdio: 'ignore' });

const cleanup = () => { try { chrome.kill(); } catch (_) {} try { server.kill(); } catch (_) {} try { mock.close(); } catch (_) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {} };
process.on('exit', cleanup);

// ── Cliente CDP mínimo ──────────────────────────────────────────────────────
async function connect() {
    for (let i = 0; i < 60; i++) {
        try {
            const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
            const page = list.find((t) => t.type === 'page');
            if (page) return page.webSocketDebuggerUrl;
        } catch (_) { /* Chrome aún arrancando */ }
        await wait(250);
    }
    throw new Error('Chrome no abrió el puerto de depuración');
}
const ws = new WebSocket(await connect());
await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('CDP: no conecta')); });
let nextId = 1;
const pending = new Map();
const consoleErrors = [], exceptions = [], badRequests = [], requested = [];
ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); return; }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
    if (msg.method === 'Runtime.exceptionThrown') exceptions.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method === 'Network.requestWillBeSent') requested.push(msg.params.request.url);
    if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) badRequests.push(`${msg.params.response.status} ${msg.params.response.url}`);
};
const cdp = (method, params = {}) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
    const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
};

// Los módulos ES ya no dejan sus nombres en el global: la página los importa por URL
// (misma URL = misma instancia que usa la app, con su estado) y usa lo que exportan.
const TOKEN = /src="js\/main\.js\?v=([^"]+)"/.exec(fs.readFileSync('index.html', 'utf8'))?.[1];
const IMPORT_HELPER = `window.__mod = (n) => import('/js/' + n + '.js?v=${TOKEN}');`;

// El servidor tarda un instante en estar listo
for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${APP_PORT}/`)).ok) break; } catch (_) {} await wait(150); }

try {
    await cdp('Runtime.enable'); await cdp('Network.enable'); await cdp('Page.enable');
    // En headless la página no tiene foco de ventana y focus()/activeElement se comportan distinto.
    await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
    await cdp('Page.navigate', { url: `http://127.0.0.1:${APP_PORT}/` });
    for (let i = 0; i < 60; i++) { if (await evaluate(`typeof state !== 'undefined' && !!document.getElementById('settingsBtn')`).catch(() => false)) break; await wait(250); }
    await wait(1500);
    await evaluate(IMPORT_HELPER);

    console.log('1. Arranque\n');
    check('los módulos cargaron y exponen el estado de la app', await evaluate(`(async () => { const m = await __mod('02-state'); const c = await __mod('06-chat'); return typeof m.state === 'object' && typeof m.dom === 'object' && typeof c.sendMessage === 'function'; })()`));
    check('lo interno ya NO se filtra al global (módulos reales)', await evaluate(`typeof window.state === 'undefined' && typeof window.sendMessage === 'undefined' && typeof window.escapeHtml === 'undefined'`));
    check('sin excepciones al arrancar', exceptions.length === 0, exceptions[0]);
    const appErrors = consoleErrors.filter((e) => !/Failed to load resource|frame-ancestors/.test(e));
    check('sin errores de la app en consola', appErrors.length === 0, appErrors[0]);
    // Los 502 de sondear Ollama/LM Studio que no están en marcha son normales; lo demás no.
    const unexpected = badRequests.filter((r) => !/cors-proxy\?url=.*(11434|1234|10531|31415)/.test(r));
    check('sin peticiones fallidas inesperadas', unexpected.length === 0, unexpected.join(' | '));
    check('no se piden recursos de terceros para la interfaz', !requested.some((u) => /googleapis|gstatic/.test(u)), requested.find((u) => /googleapis|gstatic/.test(u)));
    check('el navegador queda aislado (WASM multihilo posible)', await evaluate('self.crossOriginIsolated === true'));
    const loaded = (await evaluate(`performance.getEntriesByType('resource').map(r => [r.name, r.responseEnd])`))
        .filter(([n]) => /\/js\/(main|\d\d-[\w-]+)\.js\?v=/.test(n)).sort((x, y) => x[1] - y[1]).map(([n]) => n);
    check('main + los 12 módulos se cargan por import, con URL versionada', loaded.length === 13 && loaded.every((n) => n.endsWith('?v=' + TOKEN)), `${loaded.length} cargados`);
    // `responseEnd` ordena por descarga, no por evaluación: lo que se comprueba es que la app arranca sin
    // TDZ ni «no definido» (ver 1.), que es la consecuencia de que el orden de evaluación sea el correcto.
    check('Inter y JetBrains Mono se sirven desde lib/fonts/', await evaluate(`(async () => { await document.fonts.ready; return document.fonts.check('16px Inter') && document.fonts.check('14px "JetBrains Mono"') && performance.getEntriesByType('resource').some(r => /lib\\/fonts\\/.*\\.woff2/.test(r.name)); })()`));
    check('hay diálogos declarados y región de estado para lectores de pantalla', await evaluate(`document.querySelectorAll('[role=dialog]').length >= 15 && !!document.getElementById('srStatus')`));

    console.log('\n2. Diálogos accesibles\n');
    const dlg = await evaluate(`(async () => {
        const trigger = document.getElementById('settingsBtn'); trigger.focus(); trigger.click();
        await new Promise(r => setTimeout(r, 150));
        const modal = document.getElementById('settingsModal');
        const focusIn = modal.contains(document.activeElement);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise(r => setTimeout(r, 150));
        return { focusIn, closed: modal.classList.contains('hidden'), back: document.activeElement === trigger, stillOpen: [...document.querySelectorAll('.modal-overlay:not(.hidden)')].map(m => m.id) };
    })()`);
    check('al abrir, el foco entra en el diálogo', dlg.focusIn);
    check('Escape lo cierra', dlg.closed);
    check('y el foco vuelve al botón que lo abrió', dlg.back);
    check('un Escape cierra un solo diálogo (el que tiene el foco)', dlg.stillOpen.includes('webgpuSupportModal') || dlg.stillOpen.length === 0, dlg.stillOpen.join(','));

    console.log('\n3. Un turno de chat completo, con búsqueda web\n');
    await evaluate(`(async () => {
        const { state, syncProviderToState } = await __mod('02-state');
        state.settings.provider = 'lmstudio';
        state.settings.providerConfigs.lmstudio.url = 'http://127.0.0.1:${MOCK_PORT}/v1';
        state.settings.providerConfigs.lmstudio.model = 'm';
        syncProviderToState(); state.settings.model = 'm'; state.capabilities = ['tools'];
        const tool = document.getElementById('toolInternet'); tool.classList.remove('hidden'); tool.classList.add('active');
        state.settings.incognitoMode = true; state.incognitoSessionActive = true;
    })()`);
    const turn = await evaluate(`(async () => {
        const { state } = await __mod('02-state'); const { sendMessage } = await __mod('06-chat'); const { getActiveChat } = await __mod('05-workspace');
        const r = await Promise.race([sendMessage('¿Cuál es la capital de Francia?').then(() => 'resolved'), new Promise(r => setTimeout(() => r('TIMEOUT'), 30000))]);
        await new Promise(r => setTimeout(r, 400));
        const msgs = getActiveChat().messages;
        return { r, streaming: state.isStreaming, last: msgs[msgs.length - 1].content, sendVisible: !document.getElementById('sendBtn').classList.contains('hidden'),
                 shown: [...document.querySelectorAll('.message.assistant')].pop()?.innerText || '' };
    })()`);
    check('el turno termina (no se queda «generando»)', turn.r === 'resolved' && turn.streaming === false, turn.r);
    check('el motor recibió la pregunta, la llamada y su resultado', JSON.stringify(engineLog[1]?.roles) === '["system","user","assistant","tool"]', JSON.stringify(engineLog[1]?.roles));
    check('la llamada a herramienta lleva id y type (formato OpenAI)', engineLog[1]?.toolCalls?.[0]?.id === 'call_1' && engineLog[1].toolCalls[0].type === 'function' && engineLog[1].toolMsg?.tool_call_id === 'call_1');
    check('la respuesta final llega al chat y a la pantalla', turn.last === 'La capital es París.' && /París/.test(turn.shown), turn.last);
    check('el botón de enviar vuelve a estar disponible', turn.sendVisible);

    console.log('\n4. Un error no controlado avisa al usuario\n');
    const crash = await evaluate(`(async () => {
        document.querySelectorAll('#toastRegion .toast').forEach(t => t.remove());
        Promise.reject(new Error('fallo de prueba'));
        await new Promise(r => setTimeout(r, 200));
        const toast = document.querySelector('#toastRegion .toast-error');
        return { n: document.querySelectorAll('#toastRegion .toast-error').length, shown: !!toast, role: toast?.getAttribute('role'), generic: !/fallo de prueba/.test(toast?.textContent || '') };
    })()`);
    check('una promesa rechazada sin catch genera un aviso (role=alert, sin filtrar el detalle técnico)', crash.n === 1 && crash.shown && crash.role === 'alert' && crash.generic, JSON.stringify(crash));

    console.log('\n5. Recorrido: pulsar todos los botones no destructivos\n');
    // Con módulos ES, un import que faltara solo se nota al ejecutar esa ruta
    // («X is not defined»). Pulsar todo lo pulsable ejecuta la mayoría de los manejadores.
    const before = exceptions.length;
    const errorsBefore = consoleErrors.length;
    const walk = await evaluate(`(async () => {
        window.confirm = () => false; window.alert = () => {}; window.prompt = () => null;
        const DENY = /elimin|borrar|delete|reset|restablec|factory|fábrica|limpiar|clear|export|import|descargar|download|pull|oauth|conectar|cerrar sesi|stop|detener|logout|remove|quitar|vaciar|purge/i;
        const sel = 'button, [role=tab], .filter-pill, summary, [data-action], .welcome-card, .agent-card';
        const done = new Set(); let clicked = 0;
        for (let round = 0; round < 3; round++) {
            for (const el of [...document.querySelectorAll(sel)]) {
                if (done.has(el) || !el.isConnected) continue;
                const label = [el.id, el.className, el.textContent, el.title, el.getAttribute('aria-label'), el.dataset?.i18n].join(' ');
                if (DENY.test(label) || el.disabled || el.closest('#toastRegion') || el.type === 'file') continue;
                done.add(el);
                try { el.click(); clicked++; } catch (e) { /* la excepción llega por exceptionThrown */ }
                await new Promise(r => setTimeout(r, 15));
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
            }
        }
        return clicked;
    })()`);
    await wait(300);
    check(`se pulsaron ${walk} controles`, walk >= 60, `pulsados: ${walk}`);
    const newExceptions = exceptions.slice(before);
    check('sin ninguna excepción (ReferenceError, import ausente…)', newExceptions.length === 0, newExceptions.slice(0, 2).join(' | '));
    // «Chat error: …» es un error de conexión YA MANEJADO (la app lo muestra en el chat): al recorrer
    // todo se pulsan selectores de motor que apuntan a servidores que aquí no existen.
    const newConsole = consoleErrors.slice(errorsBefore).filter((e) => !/Failed to load resource|^Chat error:/.test(e));
    check('ni errores de la app en consola', newConsole.length === 0, newConsole.slice(0, 2).join(' | '));
} catch (e) {
    console.error('✖ La prueba se interrumpió:', e.message);
    failures++;
}

cleanup();
if (failures) { console.error(`\n✖ ${failures} comprobaciones fallidas.`); process.exit(1); }
console.log('\n✔ La app funciona en un Chrome real.');
process.exit(0);
