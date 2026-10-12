/* >>> imports (generado por scripts/gen-modules.mjs: no editar a mano) >>> */
// El primer import es el del módulo anterior: así se evalúan en orden (ver scripts/gen-modules.mjs).
import {
    renderAnonTypesPanel, updateAnonButtonUI,
} from './08-anon.js?v=2610.AI';
import {
    loadLocalJson,
} from './01-core.js?v=2610.AI';
import {
    saveState, state,
} from './02-state.js?v=2610.AI';
import {
    renderWebGPUMonitor,
} from './03-webgpu.js?v=2610.AI';
import {
    renderChatList, renderWelcomeStarters,
} from './05-workspace.js?v=2610.AI';
import {
    renderMessages,
} from './06-chat.js?v=2610.AI';
import {
    renderDocs, renderLegal,
} from './10-docs.js?v=2610.AI';
/* <<< imports <<< */

/* ============================================
   wIA — 09-i18n.js
   Internacionalización (Español / Inglés)
   --------------------------------------------
   - Detecta el idioma del navegador (en → inglés; resto → español).
   - El ajuste manual (Experiencia → Idioma) se memoriza y tiene prioridad.
   - Traduce el DOM por atributos:
       data-i18n       → textContent
       data-i18n-html  → innerHTML (permite <strong>, <code>…)
       data-i18n-title → atributo title (tooltip)
       data-i18n-ph    → atributo placeholder
   (Script clásico: comparte ámbito global con el resto de módulos.)
   ============================================ */

const I18N_SUPPORTED = ['es', 'en'];

// Las cadenas viven en ficheros externos (lang/es.json, lang/en.json) y se
// cargan con fetch al arrancar. Así se pueden editar sin tocar el código.
// Arranca vacío: hasta que loadTranslations() resuelve, applyI18n no sobrescribe
// el texto que ya trae el HTML (español por defecto), así que la app nunca se ve
// con las claves en crudo aunque la carga falle.
const I18N_STRINGS = { es: {}, en: {} };
let _i18nLoaded = null;

// Descarga los diccionarios una sola vez (idempotente). Rutas relativas para
// funcionar tanto en la raíz como bajo un subpath del portal; el service worker
// las precachea para el arranque offline.
function loadTranslations() {
    if (_i18nLoaded) return _i18nLoaded;
    _i18nLoaded = Promise.all(I18N_SUPPORTED.map(async (lang) => {
        try {
            const dict = await loadLocalJson(`lang/${lang}.json`);
            if (!dict) throw new Error('no disponible');
            I18N_STRINGS[lang] = dict;
        } catch (e) {
            console.warn(`[i18n] No se pudo cargar lang/${lang}.json:`, e);
        }
    })).then(() => I18N_STRINGS);
    return _i18nLoaded;
}

function detectBrowserLanguage() {
    try {
        const langs = navigator.languages && navigator.languages.length
            ? navigator.languages : [navigator.language || 'es'];
        for (const l of langs) {
            const code = String(l).toLowerCase();
            if (code.startsWith('en')) return 'en';
            if (code.startsWith('es')) return 'es';
        }
    } catch (e) { /* sin acceso al idioma */ }
    return 'es';
}

// Idioma efectivo: el ajuste manual gana; 'auto' (o vacío) usa la detección.
function getLang() {
    const pref = state?.settings?.language || 'auto';
    if (I18N_SUPPORTED.includes(pref)) return pref;
    return detectBrowserLanguage();
}

function t(key, fallback = '') {
    const lang = getLang();
    const dict = I18N_STRINGS[lang] || I18N_STRINGS.es;
    if (dict && dict[key] !== undefined) return dict[key];
    const es = I18N_STRINGS.es;
    return (es && es[key] !== undefined) ? es[key] : (fallback || key);
}

// Recorre el DOM aplicando las traducciones marcadas por atributos.
function applyI18n(root = document) {
    const lang = getLang();
    document.documentElement.setAttribute('lang', lang);
    root.querySelectorAll('[data-i18n]').forEach(el => {
        const v = t(el.dataset.i18n, null);
        if (v !== null && v !== el.dataset.i18n) el.textContent = v;
    });
    root.querySelectorAll('[data-i18n-html]').forEach(el => {
        const v = t(el.dataset.i18nHtml, null);
        if (v !== null && v !== el.dataset.i18nHtml) el.innerHTML = v;
    });
    root.querySelectorAll('[data-i18n-title]').forEach(el => {
        const v = t(el.dataset.i18nTitle, null);
        if (v !== null && v !== el.dataset.i18nTitle) {
            el.setAttribute('title', v);
            // Los botones de solo icono llevan aria-label = title: deben traducirse a la vez.
            if (el.hasAttribute('aria-label')) el.setAttribute('aria-label', v);
        }
    });
    root.querySelectorAll('[data-i18n-ph]').forEach(el => {
        const v = t(el.dataset.i18nPh, null);
        if (v !== null && v !== el.dataset.i18nPh) el.setAttribute('placeholder', v);
    });
}

// Cambia el idioma, lo memoriza y refresca todo lo que depende de él.
function setLanguage(lang) {
    state.settings.language = I18N_SUPPORTED.includes(lang) ? lang : 'auto';
    saveState();
    refreshLocalizedUI();
}

// Marca la bandera activa en todos los selectores de la cabecera.
function updateLangSwitchUI() {
    const pref = state?.settings?.language || 'auto';
    document.querySelectorAll('.lang-switch .lang-opt').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === pref);
    });
}

// Enlaza los clics de los selectores de idioma (delegación, una sola vez).
let _langSwitchBound = false;
function bindLangSwitch() {
    if (_langSwitchBound) return;
    _langSwitchBound = true;
    document.addEventListener('click', (e) => {
        const opt = e.target.closest('.lang-switch .lang-opt');
        if (!opt) return;
        e.preventDefault();
        if (typeof setLanguage === 'function') setLanguage(opt.dataset.lang);
    });
}

function refreshLocalizedUI() {
    applyI18n();
    updateLangSwitchUI();
    // Partes generadas por JS que contienen texto traducible.
    try { if (typeof renderDocs === 'function') renderDocs(); } catch (e) {}
    try { if (typeof renderLegal === 'function') renderLegal(); } catch (e) {}
    try { if (typeof renderWelcomeStarters === 'function') renderWelcomeStarters(); } catch (e) {}
    try { if (typeof renderChatList === 'function') renderChatList(); } catch (e) {}
    // force: los mensajes llevan textos traducidos (tarjeta de error, insignias)
    // que no forman parte de su firma de render.
    try { if (typeof renderMessages === 'function' && state.activeChatId) renderMessages({ force: true }); } catch (e) {}
    try { if (typeof renderAnonTypesPanel === 'function') renderAnonTypesPanel(); } catch (e) {}
    try { if (typeof updateAnonButtonUI === 'function') updateAnonButtonUI(); } catch (e) {}
    try { if (typeof renderWebGPUMonitor === 'function') renderWebGPUMonitor(); } catch (e) {}
    const sel = document.getElementById('languageSelect');
    if (sel) sel.value = state.settings.language || 'auto';
}

/* >>> exports (generado por scripts/gen-modules.mjs: no editar a mano) >>> */
export {
    loadTranslations, getLang, t, setLanguage, bindLangSwitch, refreshLocalizedUI,
};
/* <<< exports <<< */
