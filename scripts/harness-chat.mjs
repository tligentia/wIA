/**
 * harness-chat — entorno compartido por las pruebas que ejecutan sendMessage.
 *
 * Carga TODOS los scripts de la app en un contexto vm con un DOM mínimo y un
 * `fetch` que sirve los JSON locales y delega lo demás en `handler`. Así se
 * prueba el flujo real de envío (no una copia suya).
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import { classicSource } from './lib/generated-blocks.mjs';

const root = process.cwd();
const read = (p) => classicSource(readFileSync, resolve(root, p));

export function createChatHarness({ handler, activeSelectors = [], extra = {} }) {
    const active = new Set(activeSelectors);
    const mkEl = (sel = '') => ({
        classList: { add() {}, remove() {}, toggle() {}, contains: (c) => c === 'active' && active.has(sel) },
        setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
        addEventListener() {}, removeEventListener() {}, appendChild() {}, append() {}, insertBefore() {}, remove() {},
        insertAdjacentHTML() {}, scrollIntoView() {}, focus() {}, blur() {}, click() {},
        querySelector: () => mkEl(), querySelectorAll: () => [], closest: () => null,
        style: { setProperty() {} }, dataset: {}, textContent: '', innerHTML: '', value: '',
        children: [], options: [], scrollTop: 0, scrollHeight: 0, clientHeight: 0, offsetHeight: 0,
        checked: false, disabled: false,
    });
    const sandbox = {
        document: {
            querySelector: (s) => mkEl(s), querySelectorAll: () => [], getElementById: (id) => mkEl('#' + id),
            createElement: () => mkEl(), createTextNode: () => ({}), addEventListener() {}, readyState: 'complete',
            documentElement: { setAttribute() {}, lang: 'es', style: { setProperty() {} }, classList: { toggle() {}, add() {}, remove() {} } },
            body: { classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, appendChild() {} },
            head: { appendChild() {} }, hidden: false,
        },
        navigator: { userAgent: 'node', languages: ['es'], maxTouchPoints: 0, platform: 'Linux', storage: null },
        console: { ...console, warn() {}, error() {}, log() {} },
        setTimeout, clearTimeout, setInterval, clearInterval,
        performance: { now: () => Date.now(), memory: null },
        crypto: { randomUUID: () => webcrypto.randomUUID(), subtle: webcrypto.subtle, getRandomValues: (a) => webcrypto.getRandomValues(a) },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        indexedDB: { open: () => ({}) },
        requestAnimationFrame: (fn) => setTimeout(fn, 0), requestIdleCallback: (fn) => setTimeout(fn, 0),
        AbortController, AbortSignal, TextEncoder, TextDecoder, Blob, URL, URLSearchParams, DOMException,
        Worker: class { postMessage() {} terminate() {} },
        DOMParser: class { parseFromString() { return { body: { querySelectorAll: () => [], innerHTML: '' }, querySelectorAll: () => [] }; } },
        atob: (s) => Buffer.from(s, 'base64').toString('binary'), btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
        alert() {}, confirm: () => true,
        ...extra,
    };
    sandbox.fetch = async (url, opts = {}) => {
        url = String(url);
        if (!/^[a-z]+:/i.test(url)) {
            try { const j = JSON.parse(read(url.split('?')[0])); return { ok: true, status: 200, json: async () => j }; } catch (_) { /* no es un JSON local */ }
        }
        return handler(url, opts);
    };
    sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
    sandbox.window.location = { protocol: 'https:', host: 'wia.test', origin: 'https://wia.test', hostname: 'wia.test', pathname: '/', search: '', hash: '' };
    sandbox.window.matchMedia = () => ({ matches: false, addEventListener() {} });
    sandbox.window.addEventListener = () => {};
    createContext(sandbox);
    for (const f of ['Plantilla/Version.js', 'lib/anonimae-engine.js', 'secure-gate.js',
        'js/01-core.js', 'js/02-state.js', 'js/03-webgpu.js', 'js/04-providers.js', 'js/05-workspace.js',
        'js/06-chat.js', 'js/07-ui.js', 'js/08-anon.js', 'js/09-i18n.js', 'js/10-docs.js', 'js/11-rag.js', 'js/12-pwa.js']) {
        // WIA_STRICT=1: los módulos de la app se ejecutan en modo estricto en el navegador;
        // así se comprueba también en las pruebas (asignaciones a globales no declaradas, etc.).
        runInContext((process.env.WIA_STRICT ? "'use strict';\n" : '') + read(f), sandbox, { filename: f });
    }
    return { run: (expr) => runInContext(expr, sandbox), sandbox };
}

/** Respuesta en streaming (una línea por trozo) al estilo fetch. */
export function streamOf(lines) {
    const enc = new TextEncoder();
    let i = 0;
    return {
        ok: true, status: 200, statusText: 'OK',
        body: { getReader: () => ({ read: async () => (i < lines.length ? { done: false, value: enc.encode(lines[i++] + '\n') } : { done: true }) }) },
    };
}

export const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));
export function withTimeout(promise, ms = 8000) {
    return Promise.race([promise.then(() => 'resolved', (e) => 'rejected: ' + e.message), new Promise((r) => setTimeout(() => r('TIMEOUT'), ms))]);
}
