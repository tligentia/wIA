/**
 * test-render — render incremental de mensajes.
 *
 * Comprueba que un turno nuevo solo añade su nodo (sin rehacer el hilo entero),
 * que editar o borrar mensajes se refleja, y que los casos que NO cambian los
 * datos del mensaje pero sí lo que se ve (idioma, desanonimización) se repintan
 * con `force`.
 *
 * Usa un DOM mínimo propio: lo que se verifica es la lógica de reconciliación,
 * no el motor de renderizado del navegador.
 *
 * Uso: npm run test:render
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { resolve } from 'node:path';
import { classicSource } from './lib/generated-blocks.mjs';

const root = process.cwd();
const read = (p) => classicSource(readFileSync, resolve(root, p));

// ── DOM mínimo con soporte de hijos, dataset y insertAdjacentHTML ──
// Los nodos guardan de dónde salieron para poder contar reconstrucciones.
let nodeSeq = 0;
class El {
    constructor(tag = 'div') {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.dataset = {};
        this.uid = ++nodeSeq;          // cambia si el nodo se recrea
        this._html = '';
        this.style = {};
        this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
    }
    get firstElementChild() { return this.children[0] || null; }
    get lastElementChild() { return this.children[this.children.length - 1] || null; }
    set innerHTML(html) { this.children = parseMessages(html); this._html = html; }
    get innerHTML() { return this._html; }
    insertAdjacentHTML(pos, html) {
        const nodes = parseMessages(html);
        if (pos === 'beforeend') this.children.push(...nodes);
        else this.children.unshift(...nodes);
    }
    replaceWith(node) {
        const parent = this._parent;
        if (!parent) return;
        parent.children[parent.children.indexOf(this)] = node;
        node._parent = parent;
    }
    remove() {
        const parent = this._parent;
        if (parent) parent.children.splice(parent.children.indexOf(this), 1);
    }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    setAttribute() {} removeAttribute() {} addEventListener() {}
}

// Extrae un nodo por cada `<div class="message …" id="msg-N" data-sig="…">`.
function parseMessages(html) {
    const out = [];
    for (const m of String(html).matchAll(/<div class="message [^"]*" id="msg-(\d+)" data-sig="([^"]+)"/g)) {
        const el = new El('div');
        el.dataset.idx = m[1];
        el.dataset.sig = m[2];
        out.push(el);
    }
    return out;
}

const scroll = new El('div');
const origSetter = Object.getOwnPropertyDescriptor(El.prototype, 'innerHTML').set;
Object.defineProperty(scroll, 'innerHTML', {
    set(html) { origSetter.call(this, html); this.children.forEach(c => { c._parent = this; }); scroll._fullRebuilds++; },
    get() { return this._html; },
});
scroll._fullRebuilds = 0;
const origInsert = scroll.insertAdjacentHTML.bind(scroll);
scroll.insertAdjacentHTML = (pos, html) => { origInsert(pos, html); scroll.children.forEach(c => { c._parent = scroll; }); };

const sandbox = {
    document: {
        querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
        createElement: () => { const e = new El(); return e; },
        addEventListener() {}, documentElement: { setAttribute() {} },
        body: { classList: { toggle() {}, add() {}, remove() {} } }, head: { appendChild() {} }, hidden: false,
    },
    navigator: { userAgent: 'node', languages: ['es'], maxTouchPoints: 0, clipboard: {} },
    console: { ...console, warn() {}, error() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => Date.now() },
    crypto: { randomUUID: () => 'id', subtle: null, getRandomValues: (a) => a },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    indexedDB: { open: () => ({}) },
    requestAnimationFrame: (fn) => fn(),
    requestIdleCallback: (fn) => fn(),
    fetch: () => Promise.reject(new Error('sin red')),
    TextEncoder, TextDecoder, AbortSignal: globalThis.AbortSignal,
    DOMParser: class { parseFromString() { return { body: { querySelectorAll: () => [], innerHTML: '' } }; } },
    marked: { parse: (t) => `<p>${t}</p>`, setOptions() {} },
};
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
sandbox.window.location = { protocol: 'https:', host: 'x', origin: 'https://x', hostname: 'x' };
sandbox.window.matchMedia = () => ({ matches: false, addEventListener() {} });
createContext(sandbox);

for (const f of ['js/01-core.js', 'js/02-state.js', 'js/03-webgpu.js', 'js/04-providers.js',
                 'js/05-workspace.js', 'js/06-chat.js', 'js/09-i18n.js']) {
    runInContext(read(f), sandbox, { filename: f });
}

sandbox.__scroll = scroll;
runInContext(`
    dom.messagesScroll = __scroll;
    processCodeBlocks = () => { globalThis.__codeRuns = (globalThis.__codeRuns || 0) + 1; };
    scrollToBottom = () => {};
    saveState = () => true;
    sanitizeRenderedHtml = (h) => h;
    __chat = { id: 'chat-1', projectId: 'general', messages: [] };
    getActiveChat = () => __chat;
    state.activeChatId = 'chat-1';
`, sandbox);

let failures = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failures++;
};
const run = (e) => runInContext(e, sandbox);
const uids = () => scroll.children.map(c => c.uid);

// ── 1. Primer render ─────────────────────────────────────────────────
run(`__chat.messages = [
    { role: 'user', content: 'hola' },
    { role: 'assistant', content: 'buenas' },
]; renderMessages();`);
check('pinta los mensajes iniciales', scroll.children.length === 2, `${scroll.children.length} nodos`);
const rebuildsTrasInicio = scroll._fullRebuilds;

// ── 2. Un turno nuevo NO reconstruye el hilo ─────────────────────────
{
    const antes = uids();
    run(`__chat.messages.push({ role: 'user', content: '¿y esto?' }); renderMessages();`);
    const despues = uids();
    check('el turno nuevo se añade', scroll.children.length === 3, `${scroll.children.length} nodos`);
    check('los mensajes anteriores NO se recrean',
        despues[0] === antes[0] && despues[1] === antes[1],
        `antes=${antes.join(',')} despues=${despues.join(',')}`);
    check('no hubo reconstrucción completa', scroll._fullRebuilds === rebuildsTrasInicio,
        `${scroll._fullRebuilds} vs ${rebuildsTrasInicio}`);
}

// ── 3. Render sin cambios: no toca nada ──────────────────────────────
{
    const antes = uids();
    const codeAntes = run('__codeRuns');
    run('renderMessages();');
    check('un render sin cambios no recrea nodos', uids().join() === antes.join());
    check('ni vuelve a resaltar el código', run('__codeRuns') === codeAntes,
        `${run('__codeRuns')} vs ${codeAntes}`);
}

// ── 4. Editar un mensaje solo repinta ese ────────────────────────────
{
    const antes = uids();
    run(`__chat.messages[1].content = 'buenas, corregido'; renderMessages();`);
    const despues = uids();
    check('el mensaje editado se recrea', despues[1] !== antes[1]);
    check('los demás se conservan', despues[0] === antes[0] && despues[2] === antes[2],
        `antes=${antes.join(',')} despues=${despues.join(',')}`);
}

// ── 5. Marcar favorito cambia la firma ───────────────────────────────
{
    const antes = uids();
    run(`__chat.messages[0].bookmarked = true; renderMessages();`);
    check('marcar favorito repinta ese mensaje', uids()[0] !== antes[0]);
}

// ── 6. Borrar mensajes elimina sus nodos ─────────────────────────────
{
    run(`__chat.messages.splice(1); renderMessages();`);
    check('al borrar quedan solo los vigentes', scroll.children.length === 1, `${scroll.children.length} nodos`);
}

// ── 7. Cambiar de chat fuerza reconstrucción ─────────────────────────
{
    const antes = scroll._fullRebuilds;
    run(`__chat = { id: 'chat-2', projectId: 'general', messages: [{ role: 'user', content: 'otro chat' }] };
         state.activeChatId = 'chat-2'; renderMessages();`);
    check('cambiar de chat reconstruye entero', scroll._fullRebuilds === antes + 1,
        `${scroll._fullRebuilds} vs ${antes}`);
    check('y muestra el chat nuevo', scroll.children.length === 1);
}

// ── 8. force repinta aunque los datos no cambien ─────────────────────
{
    const antes = uids();
    run('renderMessages({ force: true });');
    check('force reconstruye pese a firmas idénticas', uids()[0] !== antes[0],
        `antes=${antes.join(',')} despues=${uids().join(',')}`);
}

// ── 9. El estado de streaming afecta solo al mensaje sin contenido ───
{
    run(`__chat.messages = [
        { role: 'user', content: 'pregunta' },
        { role: 'assistant', content: '' },
    ]; state.isStreaming = false; renderMessages({ force: true });`);
    const antes = uids();
    run('state.isStreaming = true; renderMessages();');
    const despues = uids();
    check('el mensaje en curso se repinta al empezar a emitir', despues[1] !== antes[1]);
    check('el mensaje ya completo no se toca', despues[0] === antes[0],
        `antes=${antes.join(',')} despues=${despues.join(',')}`);
    run('state.isStreaming = false;');
}

// ── 10. La firma cubre los campos que se pintan ──────────────────────
{
    const campos = [
        ['contenido', `__chat.messages[0].content = 'cambiado'`],
        ['razonamiento', `__chat.messages[0].thinking = 'pensando'`],
        ['insignia de anonimización', `__chat.messages[0].anonCount = 2`],
        ['aviso de recorte de contexto', `__chat.messages[0].contextTrim = { droppedMessages: 3, docsTruncated: false, docsIncluded: 0, docsTotal: 0 }`],
        ['métricas', `__chat.messages[0].metrics = { tps: '12.3' }`],
        ['propuesta de prompt', `__chat.messages[0].isProposal = true`],
    ];
    let todos = true;
    const detalles = [];
    for (const [nombre, mutacion] of campos) {
        run('renderMessages({ force: true });');
        const antes = uids()[0];
        run(`${mutacion}; renderMessages();`);
        if (uids()[0] === antes) { todos = false; detalles.push(nombre); }
    }
    check('todo lo que se pinta está en la firma', todos,
        detalles.length ? `no detectado: ${detalles.join(', ')}` : '6 campos comprobados');
}

console.log(failures === 0 ? '\n✔ Render incremental correcto.' : `\n✖ ${failures} fallo(s).`);
process.exitCode = failures === 0 ? 0 : 1;
