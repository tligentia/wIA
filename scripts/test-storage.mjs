/**
 * test-storage — cifrado del historial en IndexedDB.
 *
 * Comprueba que chats y proyectos se guardan cifrados, que el historial en
 * texto plano de versiones anteriores se sigue leyendo (y se marca para
 * reescribirse cifrado) y que una clave perdida se detecta en vez de
 * confundirse con "no hay datos".
 *
 * Usa la WebCrypto real de Node, así que valida el cifrado de verdad.
 *
 * Uso: npm run test:storage
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';

const root = process.cwd();
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const noopEl = () => ({
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, removeAttribute() {}, addEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    style: {}, dataset: {}, textContent: '', innerHTML: '', value: '',
});

const alerts = [];
const sandbox = {
    document: {
        querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
        createElement: () => noopEl(), addEventListener() {},
        documentElement: { setAttribute() {} },
        body: { classList: { toggle() {}, add() {}, remove() {} } },
        head: { appendChild() {} }, hidden: false,
    },
    navigator: { userAgent: 'node', languages: ['es'], maxTouchPoints: 0, storage: null },
    console: { ...console, warn() {}, error() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => Date.now() },
    crypto: webcrypto,
    localStorage: { _d: new Map(), getItem(k) { return this._d.get(k) ?? null; }, setItem(k, v) { this._d.set(k, v); }, removeItem(k) { this._d.delete(k); } },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    requestIdleCallback: (fn) => setTimeout(fn, 0),
    indexedDB: { open: () => ({}) },
    fetch: () => Promise.reject(new Error('sin red')),
    TextEncoder, TextDecoder,
    Uint8Array, ArrayBuffer, JSON, Array, Object, Promise, Error, Date, Math, String, Number, Boolean,
    alert: (m) => alerts.push(m),
    AbortSignal: globalThis.AbortSignal,
    DOMParser: class { parseFromString() { return { body: { querySelectorAll: () => [], innerHTML: '' } }; } },
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.location = { protocol: 'https:', host: 'wia.test', origin: 'https://wia.test', hostname: 'wia.test' };
sandbox.window.matchMedia = () => ({ matches: false, addEventListener() {} });
createContext(sandbox);

runInContext(read('js/01-core.js'), sandbox, { filename: '01-core.js' });
runInContext(read('js/02-state.js'), sandbox, { filename: '02-state.js' });

// IndexedDB en memoria: idbStore es un objeto, así que se le sustituyen los
// métodos sin tocar el binding const.
runInContext(`
    globalThis.__store = new Map();
    idbStore.get = async (k) => __store.get(k);
    idbStore.set = async (k, v) => { __store.set(k, v); return true; };
    idbStore.del = async (k) => { __store.delete(k); return true; };
    applySettingsToUI = () => {};
    renderAttachmentPreview = () => {}; renderProjectSelect = () => {};
    renderChatList = () => {}; showWelcome = () => {}; checkProviderStatus = () => Promise.resolve();
`, sandbox);

let failures = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failures++;
};
const run = (expr) => runInContext(expr, sandbox);

const SECRETO = 'Reunión con Marta sobre el expediente 44/2026';

// ── 1. Ida y vuelta del cifrado ──────────────────────────────────────
{
    const record = await run(`secretVault.encryptRecord([{ id: 'c1', title: ${JSON.stringify(SECRETO)} }])`);
    check('el registro cifrado está marcado como v1', record.__wiaEnc === 'v1', String(record.__wiaEnc));
    check('el cifrado es binario, no base64', record.data instanceof ArrayBuffer || ArrayBuffer.isView(record.data),
        Object.prototype.toString.call(record.data));

    const bytes = Buffer.from(record.data);
    check('el texto sensible NO aparece en el binario', !bytes.includes(Buffer.from(SECRETO, 'utf8')));

    sandbox.__rec = record;
    const back = await run('secretVault.decryptRecord(__rec)');
    check('descifra al valor original', back.value?.[0]?.title === SECRETO, back.value?.[0]?.title);
    check('se reconoce como ya cifrado', back.wasEncrypted === true);
}

// ── 2. Historial heredado en texto plano ─────────────────────────────
{
    sandbox.__legacy = [{ id: 'viejo', title: 'chat antiguo' }];
    const back = await run('secretVault.decryptRecord(__legacy)');
    check('lee el historial antiguo sin cifrar', back.value?.[0]?.id === 'viejo');
    check('lo marca para reescribirlo cifrado', back.wasEncrypted === false);
}

// ── 3. persistConversationsToIdb guarda cifrado de verdad ────────────
{
    run(`
        state.chats = [{ id: 'c9', projectId: 'general', title: ${JSON.stringify(SECRETO)}, messages: [{ role: 'user', content: ${JSON.stringify(SECRETO)} }] }];
        state.projects = [{ id: 'general', name: 'General', systemPrompt: '', documents: [] }];
    `);
    await run('persistConversationsToIdb({ notifyOnError: false })');

    const stored = run('__store.get("chats")');
    check('lo almacenado va cifrado', stored?.__wiaEnc === 'v1', String(stored?.__wiaEnc));
    const raw = JSON.stringify(Array.from(Buffer.from(stored.data)));
    check('el contenido del chat no es legible en IndexedDB',
        !Buffer.from(stored.data).includes(Buffer.from(SECRETO, 'utf8')) && raw.length > 0);

    // Y se recupera intacto
    sandbox.__stored = stored;
    const back = await run('secretVault.decryptRecord(__stored)');
    check('el chat se recupera íntegro', back.value?.[0]?.messages?.[0]?.content === SECRETO);
}

// ── 4. Clave perdida: se detecta, no se confunde con "sin datos" ─────
{
    const stored = run('__store.get("chats")');
    sandbox.__otherKeyRecord = stored;
    // Se fuerza una clave nueva, como si el navegador hubiera borrado la anterior.
    run('secretVault._keyPromise = null; __store.delete("wia-secret-key");');
    const back = await run('secretVault.decryptRecord(__otherKeyRecord)');
    check('con la clave perdida marca el registro como ilegible', back.unreadable === true);
    check('no devuelve un historial vacío silenciosamente', back.value === null);
}

// ── 5. Contexto sin WebCrypto: degrada pero sigue funcionando ────────
{
    run(`secretVault.available = () => false; secretVault._keyPromise = null;`);
    const record = await run(`secretVault.encryptRecord([{ id: 'x', title: 'sin cripto' }])`);
    check('sin WebCrypto marca el registro como plano', record.__wiaEnc === 'plain', String(record.__wiaEnc));
    sandbox.__plain = record;
    const back = await run('secretVault.decryptRecord(__plain)');
    check('y se sigue leyendo', back.value?.[0]?.title === 'sin cripto');
    check('marcándolo para cifrarlo cuando se pueda', back.wasEncrypted === false);
}

console.log(failures === 0 ? '\n✔ Cifrado del historial correcto.' : `\n✖ ${failures} fallo(s).`);
process.exitCode = failures === 0 ? 0 : 1;
