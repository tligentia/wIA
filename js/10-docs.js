/* >>> imports (generado por scripts/gen-modules.mjs: no editar a mano) >>> */
// El primer import es el del módulo anterior: así se evalúan en orden (ver scripts/gen-modules.mjs).
import {
    getLang,
} from './09-i18n.js?v=2610.AD';
import {
    escapeHtml, loadLocalJson,
} from './01-core.js?v=2610.AD';
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

/* >>> exports (generado por scripts/gen-modules.mjs: no editar a mano) >>> */
export {
    renderDocs,
};
/* <<< exports <<< */
