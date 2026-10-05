/**
 * test-import — exportar e importar ajustes sin exponer las API keys.
 *
 * Dos garantías:
 *  · lo que se exporta no lleva claves;
 *  · al importar, una clave guardada solo se conserva si el fichero no cambia
 *    el servidor de ese motor. Sin esto, un fichero de «ajustes» manipulado
 *    redirigía la clave del usuario a un servidor ajeno en el siguiente mensaje.
 *
 * Uso: npm run test:import
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
    TextEncoder, TextDecoder, URL,
    Uint8Array, ArrayBuffer, JSON, Array, Object, Promise, Error, Date, Math, String, Number, Boolean,
    alert() {},
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

let failures = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failures++;
};
// Los objetos cruzan la frontera del sandbox como JSON: así las comparaciones
// no dependen de prototipos de otro realm.
const call = (fn, ...args) => JSON.parse(runInContext(
    `JSON.stringify(${fn}(...${JSON.stringify(args)}))`, sandbox));

const EVIL = 'https://evil.example/v1';
const baseSettings = () => ({
    provider: 'claude',
    ollamaUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-5',
    apiKey: 'sk-ant-SECRETA',
    theme: 'dark',
    providerConfigs: {
        claude: { url: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5', apiKey: 'sk-ant-SECRETA' },
        openai: { url: 'https://api.openai.com/v1', model: 'gpt-4.1', apiKey: 'sk-openai-SECRETA' },
        // Sin `url`: se usa la de fábrica del motor.
        groq: { model: 'llama-3.3-70b-versatile', apiKey: 'gsk-SECRETA' },
        ollama_remote: { url: 'https://ollama.mi-casa.example', model: 'gemma', apiKey: 'tok-casa' },
    },
});

// ── 1. Lo que se exporta no lleva claves ─────────────────────────────
{
    const exported = call('settingsWithoutSecrets', baseSettings());
    check('la exportación no contiene ninguna clave', !JSON.stringify(exported).includes('SECRETA') && !JSON.stringify(exported).includes('tok-casa'));
    check('pero conserva URLs y modelos', exported.providerConfigs.openai.url === 'https://api.openai.com/v1' && exported.model === 'claude-sonnet-5');

    const ui = read('js/07-ui.js');
    const handler = ui.slice(ui.indexOf('dom.exportSettingsBtn.addEventListener'), ui.indexOf('dom.importSettingsBtn.addEventListener'));
    check('«Exportar ajustes» usa settingsWithoutSecrets', /JSON\.stringify\(\s*settingsWithoutSecrets\(state\.settings\)/.test(handler));
    check('y no vuelca state.settings tal cual', !/JSON\.stringify\(\s*state\.settings\b/.test(handler));
    check('«Importar ajustes» pasa por applyImportedSettings', /applyImportedSettings\(importedSettings\)/.test(ui));
    check('la copia completa también', /applyImportedSettings\(data\.settings\)/.test(ui));
}

// ── 2. Ida y vuelta: exportar e importar no borra las claves ─────────
{
    const current = baseSettings();
    const exported = call('settingsWithoutSecrets', current);
    const { settings, droppedKeys } = call('mergeImportedSettings', current, exported);
    check('reimportar la propia exportación conserva todas las claves',
        settings.providerConfigs.claude.apiKey === 'sk-ant-SECRETA'
        && settings.providerConfigs.openai.apiKey === 'sk-openai-SECRETA'
        && settings.providerConfigs.groq.apiKey === 'gsk-SECRETA'
        && settings.providerConfigs.ollama_remote.apiKey === 'tok-casa');
    check('y la del motor activo en el nivel superior', settings.apiKey === 'sk-ant-SECRETA', settings.apiKey);
    check('sin avisos de claves descartadas', droppedKeys.length === 0, droppedKeys.join(','));
}

// ── 3. Fichero manipulado: cambia la URL de un motor con clave ───────
{
    const crafted = { provider: 'claude', providerConfigs: { openai: { url: EVIL, model: 'gpt-4.1', apiKey: '' } } };
    const { settings, droppedKeys } = call('mergeImportedSettings', baseSettings(), crafted);
    check('la URL del fichero se aplica', settings.providerConfigs.openai.url === EVIL);
    check('pero la clave guardada NO viaja con ella', settings.providerConfigs.openai.apiKey === '', settings.providerConfigs.openai.apiKey);
    check('se informa del motor afectado', droppedKeys.length === 1 && droppedKeys[0] === 'openai', droppedKeys.join(','));
    check('los demás motores conservan su clave', settings.providerConfigs.claude.apiKey === 'sk-ant-SECRETA' && settings.providerConfigs.groq.apiKey === 'gsk-SECRETA');
    check('ninguna clave queda junto a la URL ajena', !JSON.stringify(settings.providerConfigs.openai).includes('SECRETA'));
}

// ── 4. El motor usaba la URL de fábrica y el fichero le pone otra ─────
{
    const crafted = { provider: 'claude', providerConfigs: { groq: { url: EVIL } } };
    const { settings, droppedKeys } = call('mergeImportedSettings', baseSettings(), crafted);
    check('cambio desde la URL de fábrica: clave descartada', settings.providerConfigs.groq.apiKey === '' && droppedKeys.includes('groq'));
}

// ── 5. El fichero vacía una URL propia (pasaría a la de fábrica) ─────
{
    const crafted = { provider: 'claude', providerConfigs: { ollama_remote: { url: '' } } };
    const { settings, droppedKeys } = call('mergeImportedSettings', baseSettings(), crafted);
    check('vaciar una URL propia también descarta la clave', settings.providerConfigs.ollama_remote.apiKey === '' && droppedKeys.includes('ollama_remote'));
}

// ── 6. Cambios que NO mueven el servidor ─────────────────────────────
{
    const harmless = { provider: 'claude', providerConfigs: {
        openai: { url: 'https://api.openai.com/v2', model: 'gpt-otro' },   // mismo origen, otra ruta
        groq: { model: 'otro-modelo', temperature: 0.2 },                  // sin URL
    } };
    const { settings, droppedKeys } = call('mergeImportedSettings', baseSettings(), harmless);
    check('misma máquina, otra ruta: la clave se conserva', settings.providerConfigs.openai.apiKey === 'sk-openai-SECRETA');
    check('sin URL en el fichero: la clave se conserva', settings.providerConfigs.groq.apiKey === 'gsk-SECRETA');
    check('y se aplican los demás campos', settings.providerConfigs.openai.model === 'gpt-otro' && settings.providerConfigs.groq.temperature === 0.2);
    check('sin avisos', droppedKeys.length === 0, droppedKeys.join(','));
}

// ── 7. Formato plano (antiguo o escrito a mano) ──────────────────────
{
    // Es el caso más directo del ataque: sin providerConfigs, la versión
    // anterior dejaba la clave del motor activo junto a la URL del fichero.
    const crafted = { provider: 'openai', ollamaUrl: EVIL };
    const { settings, droppedKeys } = call('mergeImportedSettings', baseSettings(), crafted);
    check('formato plano: la URL acaba en el motor indicado', settings.providerConfigs.openai.url === EVIL && settings.ollamaUrl === EVIL);
    check('sin clave en el nivel superior', settings.apiKey === '', settings.apiKey);
    check('ni en la configuración del motor', settings.providerConfigs.openai.apiKey === '');
    check('aviso emitido', droppedKeys.includes('openai'));
    check('la clave del motor que estaba activo sigue en su sitio', settings.providerConfigs.claude.apiKey === 'sk-ant-SECRETA');
}

// ── 8. Una clave que viene en el fichero llega con su propia URL ─────
{
    const legacy = { provider: 'openai', providerConfigs: { openai: { url: 'https://mi-proxy.example/v1', apiKey: 'sk-del-fichero' } } };
    const { settings, droppedKeys } = call('mergeImportedSettings', baseSettings(), legacy);
    check('se adopta el par URL + clave del fichero', settings.providerConfigs.openai.apiKey === 'sk-del-fichero' && settings.apiKey === 'sk-del-fichero');
    check('la clave antigua del usuario no acompaña a esa URL', !JSON.stringify(settings.providerConfigs.openai).includes('SECRETA'));
    check('no cuenta como descarte', droppedKeys.length === 0);

    const raro = { provider: 'claude', providerConfigs: { openai: { url: EVIL, apiKey: { toString: 'x' } } } };
    const r = call('mergeImportedSettings', baseSettings(), raro);
    check('una «clave» que no es texto se ignora', r.settings.providerConfigs.openai.apiKey === '' && r.droppedKeys.includes('openai'));
}

// ── 9. No se muta el estado de partida ───────────────────────────────
{
    sandbox.__cur = baseSettings();
    runInContext(`mergeImportedSettings(__cur, { provider: 'openai', ollamaUrl: ${JSON.stringify(EVIL)} })`, sandbox);
    check('mergeImportedSettings no modifica los ajustes actuales',
        JSON.stringify(sandbox.__cur) === JSON.stringify(baseSettings()));
}

// ── 10. Aplicación sobre el estado vivo ──────────────────────────────
{
    sandbox.__base = baseSettings();
    runInContext('state.settings = { ...state.settings, ...__base }; syncProviderToState();', sandbox);
    const dropped = call('applyImportedSettings', {
        provider: 'ollama_remote~oficina',
        customProviders: [{ id: 'ollama_remote~oficina', baseProvider: 'ollama_remote', name: 'Oficina' }],
        providerConfigs: {
            'ollama_remote~oficina': { url: 'https://ollama.oficina.example', model: 'gemma' },
            openai: { url: EVIL },
        },
    });
    const live = JSON.parse(runInContext('JSON.stringify(state.settings)', sandbox));
    check('el clon que trae el fichero queda registrado', runInContext("!!PROVIDERS['ollama_remote~oficina']", sandbox));
    check('y pasa a ser el motor activo, con su URL', live.provider === 'ollama_remote~oficina' && live.ollamaUrl === 'https://ollama.oficina.example', `${live.provider} ${live.ollamaUrl}`);
    check('el nivel superior no arrastra la clave del motor anterior', live.apiKey === '', live.apiKey);
    check('la clave de OpenAI se descartó en el estado vivo', live.providerConfigs.openai.apiKey === '' && dropped.includes('openai'));
    const notice = call('describeDroppedKeys', dropped);
    check('el aviso nombra el motor afectado', /OpenAI/.test(notice) && !notice.includes('{names}'), notice.slice(0, 60));

    call('applyImportedSettings', { provider: 'motor-inexistente' });
    const after = JSON.parse(runInContext('JSON.stringify(state.settings)', sandbox));
    check('un motor desconocido cae a uno válido', runInContext('!!PROVIDERS[state.settings.provider]', sandbox), after.provider);
}

console.log(failures === 0 ? '\n✔ Importación y exportación de ajustes correctas.' : `\n${failures} fallo(s).`);
process.exitCode = failures === 0 ? 0 : 1;
