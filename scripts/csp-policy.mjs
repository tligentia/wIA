/**
 * csp-policy — fuente ÚNICA de la Content-Security-Policy de wIA.
 *
 * La app se despliega en tres sitios distintos (server.js en local/Plesk,
 * Apache vía .htaccess y Vercel vía vercel.json) más el propio index.html.
 * Mantener cuatro copias de la política a mano garantiza que se desincronicen,
 * así que se declara aquí y `npm run check:csp` verifica que las cuatro copias
 * coinciden literalmente.
 *
 * Decisiones que no son obvias:
 *
 * · script-src NO lleva 'unsafe-inline'. Ese es el objetivo de todo el trabajo
 *   de quitar los atributos on* y los <script> incrustados: sin él, inyectar
 *   HTML deja de poder ejecutar código.
 * · 'wasm-unsafe-eval' sí es necesario: onnxruntime-web compila WebAssembly, y
 *   sin esta palabra clave la inferencia local no arranca. Permite WASM, no
 *   eval() de JavaScript.
 * · cdn.jsdelivr.net está en script-src porque Transformers.js se carga con un
 *   import() dinámico desde ese CDN.
 * · worker-src incluye blob: porque onnxruntime crea sus hilos como workers a
 *   partir de blobs; sin ello se cae a un solo hilo o falla.
 * · script-src TAMBIÉN necesita blob:, y no es lo mismo que lo anterior: aparte
 *   de los workers, onnxruntime-web carga su backend de WebGPU (JSEP) con un
 *   import() dinámico de un módulo blob:, y los import() los rige script-src, no
 *   worker-src. Sin blob: aquí la inferencia local moría con «no available
 *   backend found. ERR: [webgpu] Failed to fetch dynamically imported module:
 *   blob:…». Un blob: solo lo puede crear código del propio origen, así que el
 *   margen que abre es pequeño frente a dejar WebGPU inservible.
 * · connect-src es abierto a propósito: el usuario configura la URL de su motor
 *   (Ollama en su LAN, un proxy propio, cualquier proveedor cloud). Restringirlo
 *   a una lista rompería la función principal de la app.
 * · style-src lleva 'unsafe-inline' porque el HTML usa atributos style= por todas
 *   partes. Es un riesgo muy menor comparado con el de scripts.
 */
export const CSP_POLICY = [
    "default-src 'self'",
    "script-src 'self' https://cdn.jsdelivr.net blob: 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    "connect-src *",
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
].join('; ');
