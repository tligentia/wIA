/* >>> imports (generado por scripts/gen-modules.mjs: no editar a mano) >>> */
// El primer import es el del módulo anterior: así se evalúan en orden (ver scripts/gen-modules.mjs).
import './11-rag.js?v=2610.AP';
/* <<< imports <<< */

/* ============================================
   wIA — 12-pwa.js
   Registro del service worker (arranque offline).
   --------------------------------------------
   Antes esto era un <script> en línea al final de index.html. Se ha sacado a un
   fichero para que la Content-Security-Policy pueda prohibir 'unsafe-inline' en
   script-src: mientras quede un solo script incrustado en el HTML, esa
   directiva no se puede activar y una inyección de HTML sigue siendo ejecución
   de código.
   (Script clásico: comparte ámbito global con el resto de módulos.)
   ============================================ */

if ('serviceWorker' in navigator) {
    // Ruta relativa: la app funciona en la raíz o bajo un subpath del portal.
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .catch((e) => console.warn('SW no registrado:', e));
    });
}
