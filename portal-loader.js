/* wIA — portal-loader.js
   Carga la barra de navegación del portal Tligent SOLO si existe junto a la app
   (../portal-nav.js). Fuera del portal ese fichero no está: antes el navegador
   pedía un script inexistente en cada arranque y registraba un 404.
   Debe ser un fichero externo porque la CSP prohíbe scripts en línea. */
(function () {
    'use strict';
    // Solo tiene sentido dentro de un portal: la app vive en un subdirectorio y la
    // barra está un nivel por encima. En la raíz del dominio (o en file://) no hay
    // «..» al que subir, y sondearlo dejaría un 404 en la consola de cada arranque.
    var dir = location.pathname.replace(/[^\/]*$/, '');
    if (location.protocol === 'file:' || dir === '/' || dir === '') return;
    fetch('../portal-nav.js', { method: 'HEAD', cache: 'no-cache' }).then(function (res) {
        var type = res.headers.get('content-type') || '';
        if (!res.ok || !/javascript|ecmascript/i.test(type)) return;
        var el = document.createElement('script');
        el.src = '../portal-nav.js';
        el.setAttribute('data-app-id', 'wia');
        el.setAttribute('data-apps-url', '../apps.json');
        el.setAttribute('data-portal-href', '../index.html');
        document.body.appendChild(el);
    }).catch(function () { /* file:// o sin portal: nada que cargar */ });
})();
