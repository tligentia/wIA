/* >>> imports (generado por scripts/gen-modules.mjs: no editar a mano) >>> */
// El primer import es el del módulo anterior: así se evalúan en orden (ver scripts/gen-modules.mjs).
import {
    getLang,
} from './09-i18n.js?v=2610.AJ';
import {
    escapeHtml, loadLocalJson,
} from './01-core.js?v=2610.AJ';
/* <<< imports <<< */

/* ============================================
   wIA — 10-docs.js
   Documentación integrada, bilingüe (ES / EN).
   --------------------------------------------
   El contenido vive en ficheros externos (lang/docs/es.json y
   lang/docs/en.json) igual que las cadenas de interfaz: así se puede editar y
   traducir sin tocar el código. Se cargan con fetch la primera vez que hace
   falta y quedan en memoria; el service worker los precachea para el offline.
   (Van en lang/docs/ y no en lang/ porque check-i18n.js descubre los idiomas
   de la interfaz por los ficheros lang/*.json.)

   Formato de cada fichero:
     { "_lang": "es", "footNote": "…", "sections": [ {id, title, html}, … ] }

   Alimenta el panel Ajustes → Documentación y el PDF descargable.
   ============================================ */

// Caché en memoria por idioma: null = sin cargar; [] = intentado y fallido.
const DOCS_CONTENT = { es: null, en: null };
const _docsFootNote = { es: '', en: '' };
const _docsLoading = {};

/**
 * loadDocs — descarga (una sola vez por idioma) el paquete de documentación.
 * Idempotente y silencioso: si falla, renderDocs lo dice en pantalla en vez de
 * dejar el panel vacío sin explicación.
 */
function loadDocs(lang) {
    if (DOCS_CONTENT[lang]) return Promise.resolve(DOCS_CONTENT[lang]);
    if (_docsLoading[lang]) return _docsLoading[lang];
    _docsLoading[lang] = (async () => {
        try {
            const pack = await loadLocalJson(`lang/docs/${lang}.json`);
            if (!pack) throw new Error('no disponible');
            DOCS_CONTENT[lang] = Array.isArray(pack.sections) ? pack.sections : [];
            _docsFootNote[lang] = pack.footNote || '';
        } catch (e) {
            console.warn(`[docs] No se pudo cargar lang/docs/${lang}.json:`, e);
            DOCS_CONTENT[lang] = [];
        }
        return DOCS_CONTENT[lang];
    })();
    return _docsLoading[lang];
}

// Renderiza índice + cuerpo de la documentación en el idioma activo.
function renderDocs() {
    const toc = document.getElementById('docsToc');
    const body = document.getElementById('docsBody');
    if (!toc || !body) return;
    const lang = (typeof getLang === 'function') ? getLang() : 'es';
    const sections = DOCS_CONTENT[lang];

    // Aún sin cargar: pide el paquete y vuelve a pintar cuando llegue.
    if (sections === null) {
        loadDocs(lang).then(() => renderDocs());
        return;
    }

    if (sections.length === 0) {
        toc.innerHTML = '';
        body.innerHTML = `<p class="doc-footer-note">${lang === 'en'
            ? 'The documentation could not be loaded. Check your connection and try again.'
            : 'No se pudo cargar la documentación. Comprueba tu conexión y vuelve a intentarlo.'}</p>`;
        return;
    }

    toc.innerHTML = sections.map((s, i) =>
        `<a href="#${s.id}" data-doc-target="${s.id}">${i + 1} · ${escapeHtml(s.title)}</a>`
    ).join('');

    body.innerHTML = sections.map((s, i) => `
        <article class="doc-block${s.id === 'doc-autoria' ? ' doc-author-block' : ''}" id="${s.id}">
            <h2>${i + 1} · ${escapeHtml(s.title)}</h2>
            ${s.html}
        </article>`).join('') + `<p class="doc-footer-note">${_docsFootNote[lang] || ''}</p>`;
}

// ─── Información legal ──────────────────────
// Aviso legal, privacidad, cookies y cumplimiento: viven en lang/legal/<idioma>.json
// (mismo patrón que la documentación) y se muestran en el modal #privacyModal.
// Se pueden enlazar con #legal/<sección>: aviso-legal, privacidad, cookies o cumplimiento.
const LEGAL_IDS = ['aviso-legal', 'privacidad', 'cookies', 'cumplimiento'];
const LEGAL_HASH = '#legal/';
const LEGAL_CONTENT = { es: null, en: null };   // null = sin cargar; {} = intentado y fallido
const _legalLoading = {};
let _legalSection = LEGAL_IDS[0];

function loadLegal(lang) {
    if (LEGAL_CONTENT[lang]) return Promise.resolve(LEGAL_CONTENT[lang]);
    if (_legalLoading[lang]) return _legalLoading[lang];
    _legalLoading[lang] = (async () => {
        try {
            const pack = await loadLocalJson(`lang/legal/${lang}.json`);
            if (!pack || !Array.isArray(pack.sections)) throw new Error('no disponible');
            LEGAL_CONTENT[lang] = pack;
        } catch (e) {
            console.warn(`[legal] No se pudo cargar lang/legal/${lang}.json:`, e);
            LEGAL_CONTENT[lang] = {};
        }
        return LEGAL_CONTENT[lang];
    })();
    return _legalLoading[lang];
}

function isLegalOpen() {
    const modal = document.getElementById('privacyModal');
    return !!modal && !modal.classList.contains('hidden');
}

function renderLegal() {
    const content = document.getElementById('legalContent');
    const tabs = document.getElementById('legalTabs');
    if (!content || !tabs) return;
    const lang = (typeof getLang === 'function') ? getLang() : 'es';
    const pack = LEGAL_CONTENT[lang];
    if (pack === null) {
        loadLegal(lang).then(() => { if (isLegalOpen()) renderLegal(); });
        return;
    }
    const ui = pack.ui || {};
    const set = (id, value) => { const el = document.getElementById(id); if (el && value !== undefined) el.textContent = value; };
    set('legalEyebrow', ui.eyebrow);
    set('privacyModalTitle', ui.title);

    // El disclaimer se renueva con el idioma; si el paquete no cargó, queda el texto fijo del HTML.
    if (pack.disclaimer) {
        set('legalDisclaimerTitle', pack.disclaimer.title);
        const body = document.getElementById('legalDisclaimerBody');
        if (body && pack.disclaimer.html) body.innerHTML = pack.disclaimer.html;
    }

    if (!pack.sections || !pack.sections.length) {
        tabs.replaceChildren();
        content.textContent = ui.loadError || (lang === 'en'
            ? 'The legal information could not be loaded. Check your connection and try again.'
            : 'No se pudo cargar la información legal. Comprueba tu conexión y vuelve a intentarlo.');
        return;
    }

    const current = pack.sections.find(sec => sec.id === _legalSection) || pack.sections[0];
    tabs.setAttribute('aria-label', ui.navLabel || tabs.getAttribute('aria-label') || '');
    tabs.innerHTML = pack.sections.map(sec => `
        <button type="button" class="legal-tab${sec.id === current.id ? ' active' : ''}" role="tab"
                aria-selected="${sec.id === current.id}" data-legal-section="${escapeHtml(sec.id)}">${escapeHtml(sec.short || sec.title)}</button>`).join('');
    content.innerHTML = `<h3 class="legal-section-title">${escapeHtml(current.title)}</h3>${current.html}`;
    set('legalUpdated', pack.updated ? `${ui.updatedLabel || 'Última actualización'}: ${pack.updated}` : '');
}

function openLegal(section) {
    const modal = document.getElementById('privacyModal');
    if (!modal) return;
    if (LEGAL_IDS.includes(section)) _legalSection = section;
    modal.classList.remove('hidden');
    renderLegal();
    document.getElementById('legalBody')?.scrollTo({ top: 0 });
    try { history.replaceState(null, '', `${location.pathname}${location.search}${LEGAL_HASH}${_legalSection}`); } catch (_) {}
    document.getElementById('closePrivacy')?.focus();
}

function closeLegal() {
    document.getElementById('privacyModal')?.classList.add('hidden');
    // Se limpia la marca para que recargar no vuelva a abrirlo.
    if (location.hash.startsWith(LEGAL_HASH)) {
        try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
    }
}

function legalSectionFromHash() {
    if (!location.hash.startsWith(LEGAL_HASH)) return null;
    const id = location.hash.slice(LEGAL_HASH.length);
    return LEGAL_IDS.includes(id) ? id : null;
}

function bindLegal() {
    const modal = document.getElementById('privacyModal');
    if (!modal) return;
    document.getElementById('openPrivacy')?.addEventListener('click', (e) => { e.preventDefault(); openLegal(); });
    document.getElementById('closePrivacy')?.addEventListener('click', closeLegal);
    document.getElementById('closePrivacyBtn')?.addEventListener('click', closeLegal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeLegal(); });
    document.getElementById('legalTabs')?.addEventListener('click', (e) => {
        const tab = e.target.closest('[data-legal-section]');
        if (!tab) return;
        openLegal(tab.dataset.legalSection);
    });
    window.addEventListener('hashchange', () => {
        const id = legalSectionFromHash();
        if (id) openLegal(id);
    });
    const initial = legalSectionFromHash();
    if (initial) openLegal(initial);
}
bindLegal();

/* >>> exports (generado por scripts/gen-modules.mjs: no editar a mano) >>> */
export {
    renderDocs, renderLegal,
};
/* <<< exports <<< */
