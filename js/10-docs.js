/* ============================================
   wIA — 10-docs.js
   Documentación integrada, bilingüe (ES / EN).
   Se renderiza dinámicamente en el panel Ajustes → Documentación
   y alimenta también el PDF descargable.
   ============================================ */

const DOCS_CONTENT = {
    es: [
        { id: 'doc-intro', title: 'Introducción', html: `
<p><strong>wIA</strong> es un hub de inteligencia artificial multimotor: una única interfaz de chat que conecta con <strong>modelos locales</strong> (en tu ordenador o dentro del navegador) y con los principales <strong>proveedores en la nube</strong>. Es una aplicación web estática (HTML, CSS y JavaScript, sin framework ni servidor propio), pensada para ser rápida, privada y portable.</p>
<ul>
<li><strong>Privacidad primero:</strong> tus chats, proyectos y ajustes viven solo en tu navegador. No hay backend que almacene tus datos.</li>
<li><strong>Multi-motor:</strong> cambia entre motores locales y en la nube sin salir de la conversación.</li>
<li><strong>Sin instalación obligatoria:</strong> funciona abriendo una web; opcionalmente se instala como app (PWA) y funciona sin conexión.</li>
</ul>` },

        { id: 'doc-inicio', title: 'Primeros pasos', html: `
<ol>
<li>Abre wIA en tu navegador (Chrome, Edge o similar recientes recomendados).</li>
<li>Pulsa el icono ⚙️ (arriba a la derecha) para abrir <strong>Ajustes</strong> y, en <em>Conexión</em>, elige el <strong>motor de IA</strong>.</li>
<li>Si el motor lo requiere, introduce su <strong>API Key</strong> o la <strong>URL</strong> del servidor. wIA valida la conexión automáticamente.</li>
<li>Cierra Ajustes, escribe tu mensaje y pulsa <strong>Enter</strong>.</li>
</ol>
<p class="doc-tip">Consejo: si no quieres configurar nada, elige <strong>WebGPU (Browser)</strong>; se ejecuta 100 % dentro de tu navegador, sin claves ni servidores.</p>` },

        { id: 'doc-motores', title: 'Motores de IA', html: `
<p>wIA agrupa los motores en tres familias: <strong>locales en tu equipo</strong>, <strong>dentro del navegador</strong> y <strong>en la nube</strong>.</p>
<table class="doc-table">
<thead><tr><th>Motor</th><th>Tipo</th><th>Acceso</th></tr></thead>
<tbody>
<tr><td>Ollama (Local)</td><td>Local en tu equipo</td><td>Sin credenciales</td></tr>
<tr><td>Ollama (Remoto)</td><td>Servidor Ollama propio</td><td>Bearer opcional</td></tr>
<tr><td>Ollama Cloud</td><td>Nube</td><td>API Key</td></tr>
<tr><td>LM Studio</td><td>Local en tu equipo</td><td>Sin credenciales</td></tr>
<tr><td>Groq</td><td>Nube</td><td>API Key</td></tr>
<tr><td>OpenRouter</td><td>Nube</td><td>API Key</td></tr>
<tr><td>Google Gemini</td><td>Nube</td><td>API Key</td></tr>
<tr><td>Claude (Anthropic)</td><td>Nube</td><td>API Key</td></tr>
<tr><td>OpenAI</td><td>Nube</td><td>API Key</td></tr>
<tr><td>Nvidia Integrate</td><td>Nube</td><td>API Key</td></tr>
<tr><td>WebGPU (Browser)</td><td>Dentro del navegador</td><td>Sin credenciales</td></tr>
</tbody></table>
<p>Cada motor recuerda su propia configuración (modelo, URL, clave y parámetros), así que puedes alternar sin reconfigurar. La conexión se valida al seleccionar el motor y al guardar cambios.</p>
<p><strong>Proxy CORS:</strong> cuando wIA se sirve con su servidor Node incluido (o bajo Plesk), un proxy interno permite alcanzar motores que no admiten llamadas directas desde el navegador. En hosting estático, wIA lo detecta y va directo a los proveedores que sí soportan CORS.</p>` },

        { id: 'doc-webgpu', title: 'Modelos en el navegador (WebGPU)', html: `
<p>El motor <strong>WebGPU (Browser)</strong> ejecuta modelos directamente en la GPU/CPU de tu dispositivo mediante Transformers.js, sin enviar nada a ningún servidor.</p>
<ul>
<li><strong>Requisitos:</strong> navegador con soporte WebGPU (Chrome/Edge recientes). Sin WebGPU, wIA recurre a WASM (más lento).</li>
<li><strong>Descarga y caché:</strong> la primera vez el modelo se descarga desde Hugging Face y queda <strong>cacheado</strong>; después carga al instante y funciona sin conexión.</li>
<li><strong>Cuantización adaptativa:</strong> wIA elige la precisión (q4/q8/fp16) según tu equipo, equilibrando velocidad y calidad.</li>
<li><strong>Web Worker:</strong> la inferencia corre en un hilo aparte para no bloquear la interfaz.</li>
<li><strong>Streaming y cancelación:</strong> las respuestas aparecen token a token y puedes detenerlas.</li>
</ul>
<p class="doc-q">Aceleración de la carga</p>
<ul>
<li><strong>WASM multinúcleo:</strong> gracias al aislamiento de origen, el runtime usa varios hilos (hasta 8) y SIMD, acelerando la inicialización y las operaciones en CPU.</li>
<li><strong>Precarga en segundo plano:</strong> el modelo empieza a descargarse e inicializarse <strong>en cuanto escribes</strong>, de modo que al enviar ya está listo.</li>
<li><strong>Botón «⚡ Preparar modelo»:</strong> en <em>Ajustes → Modelos</em>, descarga e inicializa el modelo bajo demanda.</li>
</ul>
<p class="doc-q">Uso en móvil</p>
<p>En teléfonos la memoria es limitada (sobre todo en iOS, con límites estrictos por pestaña). wIA lo detecta y: arranca con un <strong>modelo ligero</strong> por defecto, muestra un aviso en el panel de WebGPU y, si eliges uno grande, <strong>ofrece cambiar a uno ligero</strong> antes de cargarlo. Para máxima calidad en el móvil, usa un motor cloud.</p>` },

        { id: 'doc-vision', title: 'Visión e imágenes', html: `
<p>wIA puede analizar imágenes que adjuntes con el icono 📎. Según el motor y el modelo dispones de:</p>
<ul>
<li><strong>Modelos multimodales</strong> (nube o WebGPU) que entienden imagen y texto juntos.</li>
<li><strong>Asistentes de visión</strong> en WebGPU: descripción de imágenes, lectura de texto (OCR) y análisis avanzado.</li>
<li><strong>Modelos médicos orientativos:</strong> clasificación visual zero-shot y un <strong>clasificador de heridas</strong> que reconoce el tipo (abrasión, hematoma, quemadura, corte, laceración, herida diabética/venosa/quirúrgica, úlcera por presión o piel normal). <strong>Son orientativos, no diagnósticos:</strong> ante cualquier duda, consulta a un profesional sanitario.</li>
</ul>
<p><strong>Cadena visión → chat:</strong> en <em>Ajustes → Modelos</em> (bajo el selector) puedes combinar un modelo de visión con uno de chat, y <strong>activar o desactivar</strong> la cadena con su conmutador. Cuando hay visión activa, aparece el icono 👁 en la caja de mensaje.</p>` },

        { id: 'doc-agentes', title: 'Agentes', html: `
<p>Los <strong>agentes</strong> son asistentes preconfigurados (al estilo de los GPTs): combinan nombre, icono, descripción, un prompt de sistema propio, opcionalmente un motor/modelo concreto y unos <em>iniciadores</em>.</p>
<ul>
<li>Abre la <strong>galería de agentes</strong> para explorar una selección curada y activarlos con un clic.</li>
<li>Crea los tuyos con su personalidad y base de conocimiento.</li>
<li><strong>Exporta e importa</strong> agentes como JSON para compartirlos o respaldarlos.</li>
</ul>` },

        { id: 'doc-proyectos', title: 'Proyectos y documentos', html: `
<p>Los <strong>proyectos</strong> agrupan chats bajo un contexto común. Cada proyecto puede tener:</p>
<ul>
<li>Un <strong>prompt de sistema</strong> propio que orienta todas sus conversaciones.</li>
<li>Una <strong>base de conocimiento</strong> de documentos (incluye lectura de PDF), disponible como referencia permanente para el modelo.</li>
</ul>
<p>Cambia de proyecto desde el selector superior. El proyecto «General» existe siempre por defecto.</p>` },

        { id: 'doc-chat', title: 'El chat', html: `
<ul>
<li><strong>Enviar:</strong> Enter. <strong>Salto de línea:</strong> Shift + Enter.</li>
<li><strong>Streaming:</strong> la respuesta se escribe en directo; puedes cancelarla.</li>
<li><strong>Razonamiento:</strong> con modelos compatibles, wIA muestra su «pensamiento» separado de la respuesta.</li>
<li><strong>Markdown y código:</strong> con resaltado de sintaxis y botón de copiar.</li>
<li><strong>Adjuntos:</strong> imágenes y documentos con el icono 📎.</li>
<li>Cada chat puede <strong>exportarse</strong> por separado (texto/JSON).</li>
</ul>
<p class="doc-q">Fallback rápido si algo falla</p>
<p>Si un modelo falla o <strong>se agotan los créditos</strong> del proveedor, la tarjeta de error ofrece botones para <strong>continuar al instante con otro modelo</strong>, construidos a partir de los <strong>usados con éxito recientemente</strong> y tus <strong>favoritos</strong>, más <strong>WebGPU local</strong> (gratis, sin créditos) como red de seguridad. Un clic cambia de motor y reintenta el mensaje.</p>` },

        { id: 'doc-selectores', title: 'Selectores rápidos', html: `
<p>Desde la propia caja de mensaje puedes cambiar de prompt, modelo o motor sin abrir Ajustes:</p>
<table class="doc-table">
<thead><tr><th>Escribes</th><th>Qué abre</th></tr></thead>
<tbody>
<tr><td><code>/</code></td><td>Biblioteca de <strong>prompts</strong> guardados</td></tr>
<tr><td><code>//</code></td><td><strong>Modelos</strong> del motor seleccionado</td></tr>
<tr><td><code>///</code></td><td>Elegir el <strong>motor</strong> de IA</td></tr>
<tr><td><code>+</code></td><td>Encola la orden en vez de enviarla</td></tr>
</tbody></table>
<p>Puedes filtrar escribiendo tras el prefijo (por ejemplo <code>//qwen</code> o <code>///groq</code>), navegar con ↑ ↓ y confirmar con Enter. El elemento activo aparece marcado como «· actual».</p>` },

        { id: 'doc-web', title: 'Búsqueda en Internet', html: `
<p>wIA puede consultar Internet para responder con información actual. Cuando la herramienta está disponible, el modelo la usa automáticamente si detecta que necesita datos recientes, y verás el icono correspondiente en la caja de mensaje.</p>
<p>La búsqueda combina varias fuentes con degradación por capas: resultados web reales (vía DuckDuckGo Lite cuando hay proxy), respuestas directas de DuckDuckGo y Wikipedia en español e inglés. Así devuelve algo útil tanto con servidor propio como en hosting estático.</p>` },

        { id: 'doc-cola', title: 'Cola de órdenes', html: `
<p>Si empiezas un mensaje con el prefijo <strong><code>+</code></strong>, en lugar de enviarse se añade a una <strong>cola de órdenes pendientes</strong>. Puedes encolar varias y wIA las ejecuta de forma secuencial. La cola <strong>se conserva entre sesiones</strong> y se incluye en la copia de seguridad completa.</p>` },

        { id: 'doc-anon', title: 'Anonimización de datos (DLP)', html: `
<p>wIA incluye una capa de <strong>protección de datos local</strong>: antes de enviar tu prompt a la IA, sustituye los datos sensibles por <strong>placeholders</strong> consistentes (<code>[Nombre_001]</code>, <code>[DNI_001]</code>…).</p>
<ul>
<li><strong>Activarlo:</strong> con el icono <strong>🕶️</strong> de la caja de mensaje o desde <em>Ajustes → Anonimización</em>.</li>
<li><strong>Reversible y privado:</strong> el mapa de equivalencias se guarda <strong>cifrado por chat</strong> (AES-GCM) y la respuesta se restaura <strong>solo en tu pantalla</strong>. Los valores reales nunca salen del navegador.</li>
<li>Una <strong>insignia</strong> bajo tu mensaje indica cuántos datos se protegieron.</li>
</ul>
<p class="doc-q">Tipos de datos reconocidos</p>
<p>Se detectan más de 20 tipos: correo electrónico, teléfono, DNI/NIE/NIF, CIF, IBAN, tarjeta de crédito, nº de Seguridad Social, pasaporte, dirección física, código postal, matrícula de vehículo, dirección IP, dirección MAC, fechas (posible nacimiento), usuario de red social, claves y tokens de API (incluido JWT), coordenadas GPS, nº de póliza, expedientes y diligencias judiciales, más diccionarios de nombres de persona y organizaciones.</p>
<p class="doc-q">Activar o desactivar tipos</p>
<p>En <em>Ajustes → Anonimización</em> se enumeran todos los tipos con una casilla cada uno, y un interruptor <strong>«Activar todos»</strong>. Desactiva los que no te interesen (por ejemplo fechas o IPs si generan falsos positivos). Tu selección se memoriza.</p>` },

        { id: 'doc-privacidad', title: 'Privacidad y seguridad', html: `
<ul>
<li><strong>Inferencia local:</strong> con WebGPU, LM Studio u Ollama local, tus mensajes no salen de tu equipo.</li>
<li><strong>API keys cifradas:</strong> las claves no se guardan en texto plano. Se cifran con AES-GCM usando una clave no exportable que vive en el navegador.</li>
<li><strong>Bloqueo con PIN:</strong> protege la interfaz en dispositivos compartidos.</li>
<li><strong>Modo incógnito:</strong> desactiva el guardado de la conversación en curso.</li>
<li><strong>Anonimización 🕶️:</strong> ver la sección dedicada.</li>
<li><strong>Cabeceras de seguridad:</strong> el despliegue añade aislamiento de origen y cabeceras que endurecen la app (y habilitan el WASM multihilo).</li>
</ul>
<p>Ten presente que los motores <em>en la nube</em> reciben tus mensajes en sus servidores según sus propias políticas; para máxima privacidad, usa motores locales.</p>` },

        { id: 'doc-backup', title: 'Copias de seguridad', html: `
<p>Tus datos viven en el navegador y podrían borrarse si libera espacio. Desde <em>Ajustes → Datos</em>:</p>
<ul>
<li><strong>Exportar / Importar Ajustes:</strong> solo preferencias y configuración de motores.</li>
<li><strong>Exportar / Importar Todo:</strong> copia integral (proyectos, agentes, chats, cola de órdenes y ajustes) en un único JSON. Las API keys se excluyen por seguridad.</li>
</ul>
<p>wIA solicita además <em>almacenamiento persistente</em> para reducir el riesgo de purga automática. Aun así, exporta una copia de vez en cuando.</p>` },

        { id: 'doc-tema', title: 'Temas e idioma', html: `
<p>En <em>Ajustes → Experiencia</em> puedes personalizar el aspecto y el idioma.</p>
<p class="doc-q">Temas</p>
<ul>
<li><strong>Sistema (Automático)</strong> — por defecto: sigue el modo claro/oscuro de tu sistema operativo.</li>
<li><strong>Tligent (Corporativo)</strong> — fondo blanco, texto negro y acentos rojo/gris de marca.</li>
<li><strong>Oscuro</strong>, <strong>Claro</strong> y <strong>Vanilla</strong> (minimalista).</li>
</ul>
<p class="doc-q">Idioma</p>
<p>wIA está disponible en <strong>español</strong> e <strong>inglés</strong>. Por defecto <strong>detecta el idioma de tu navegador</strong>. Si eliges uno concreto en el selector de idioma, esa elección <strong>se memoriza y tiene prioridad</strong> sobre la detección. La documentación también cambia de idioma.</p>` },

        { id: 'doc-pwa', title: 'Instalación y uso offline', html: `
<p>wIA es una <strong>PWA</strong>: desde un navegador compatible puedes <strong>instalarla</strong> como aplicación. Gracias a su service worker, el «esqueleto» de la app se guarda para <strong>arrancar sin conexión</strong>. Combinado con los modelos WebGPU ya cacheados, puedes chatear con IA <strong>en modo avión</strong>.</p>
<p class="doc-tip">Tras publicar una versión nueva, puede hacer falta recargar una vez para que el service worker sirva la última.</p>` },

        { id: 'doc-atajos', title: 'Atajos de teclado', html: `
<table class="doc-table">
<thead><tr><th>Atajo</th><th>Acción</th></tr></thead>
<tbody>
<tr><td><kbd>Enter</kbd></td><td>Enviar el mensaje</td></tr>
<tr><td><kbd>Shift</kbd> + <kbd>Enter</kbd></td><td>Salto de línea</td></tr>
<tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>N</kbd></td><td>Nuevo chat</td></tr>
<tr><td><kbd>/</kbd> (al inicio)</td><td>Biblioteca de prompts</td></tr>
<tr><td><kbd>/</kbd><kbd>/</kbd> (al inicio)</td><td>Modelos del motor actual</td></tr>
<tr><td><kbd>/</kbd><kbd>/</kbd><kbd>/</kbd> (al inicio)</td><td>Elegir motor de IA</td></tr>
<tr><td><kbd>+</kbd> (al inicio)</td><td>Encolar la orden</td></tr>
<tr><td><kbd>Esc</kbd></td><td>Cerrar ventanas/paneles</td></tr>
<tr><td><kbd>↑</kbd> <kbd>↓</kbd></td><td>Navegar por los selectores</td></tr>
</tbody></table>` },

        { id: 'doc-faq', title: 'Problemas frecuentes', html: `
<p class="doc-q">No conecta con un motor en la nube.</p>
<p>Revisa que la API Key sea válida y la URL correcta. wIA muestra el motivo (credenciales, URL, red o tiempo de espera).</p>
<p class="doc-q">Un modelo WebGPU no carga o va muy lento.</p>
<p>Comprueba que tu navegador tenga WebGPU activo; sin él se usa WASM, más lento. Los modelos grandes tardan en la primera descarga y luego quedan cacheados.</p>
<p class="doc-q">En el móvil se cierra la pestaña al cargar un modelo.</p>
<p>Es falta de memoria. Usa un modelo ligero (hasta ~500 MB) o un motor cloud. wIA te avisa y ofrece cambiar automáticamente.</p>
<p class="doc-q">He perdido mis chats.</p>
<p>El navegador puede haber liberado el almacenamiento. Restaura desde <em>Importar Todo</em> y exporta copias periódicas.</p>
<p class="doc-q">Los resultados de imagen médica, ¿son un diagnóstico?</p>
<p>No. Son estimaciones automáticas orientativas; cualquier decisión clínica corresponde a un profesional sanitario.</p>` },

        { id: 'doc-autoria', title: 'Autoría y licencia', html: `
<div class="doc-author-card">
  <div class="doc-author-avatar" aria-hidden="true">JdP</div>
  <div class="doc-author-info">
    <p class="doc-author-name">Creado por <a href="https://jesus.depablos.es" target="_blank" rel="author noopener">Jesús de Pablos</a></p>
    <p class="doc-author-role">Autor, diseño y desarrollo de wIA</p>
    <p><a class="doc-author-web" href="https://jesus.depablos.es" target="_blank" rel="author noopener">🌐 jesus.depablos.es</a></p>
  </div>
</div>
<p><strong>wIA</strong> es un proyecto <strong>gratuito y de código abierto</strong> ideado, diseñado y desarrollado por <strong>Jesús de Pablos</strong>. Puedes usarlo, estudiarlo, modificarlo y compartirlo libremente bajo licencia <strong>MIT</strong>.</p>
<p>La única condición es <strong>mantener el reconocimiento de autoría</strong>: conserva el aviso de copyright y el crédito a Jesús de Pablos (<a href="https://jesus.depablos.es" target="_blank" rel="author noopener">jesus.depablos.es</a>) en cualquier copia u obra derivada.</p>
<p class="doc-license-note">© 2026 Jesús de Pablos · Licencia MIT · <a href="https://jesus.depablos.es" target="_blank" rel="author noopener">jesus.depablos.es</a></p>` },
    ],

    en: [
        { id: 'doc-intro', title: 'Introduction', html: `
<p><strong>wIA</strong> is a multi-engine AI hub: a single chat interface that connects to <strong>local models</strong> (on your computer or inside the browser) and to the main <strong>cloud providers</strong>. It is a static web app (HTML, CSS and JavaScript, no framework and no backend of its own), designed to be fast, private and portable.</p>
<ul>
<li><strong>Privacy first:</strong> your chats, projects and settings live only in your browser. There is no backend storing your data.</li>
<li><strong>Multi-engine:</strong> switch between local and cloud engines without leaving the conversation.</li>
<li><strong>No mandatory install:</strong> it works by opening a web page; optionally it installs as an app (PWA) and works offline.</li>
</ul>` },

        { id: 'doc-inicio', title: 'Getting started', html: `
<ol>
<li>Open wIA in your browser (recent Chrome, Edge or similar recommended).</li>
<li>Click the ⚙️ icon (top right) to open <strong>Settings</strong> and, under <em>Connection</em>, choose the <strong>AI engine</strong>.</li>
<li>If the engine requires it, enter its <strong>API Key</strong> or server <strong>URL</strong>. wIA validates the connection automatically.</li>
<li>Close Settings, type your message and press <strong>Enter</strong>.</li>
</ol>
<p class="doc-tip">Tip: if you would rather not configure anything, pick <strong>WebGPU (Browser)</strong>; it runs 100% inside your browser, with no keys or servers.</p>` },

        { id: 'doc-motores', title: 'AI engines', html: `
<p>wIA groups engines into three families: <strong>local on your machine</strong>, <strong>inside the browser</strong> and <strong>in the cloud</strong>.</p>
<table class="doc-table">
<thead><tr><th>Engine</th><th>Type</th><th>Access</th></tr></thead>
<tbody>
<tr><td>Ollama (Local)</td><td>Local on your machine</td><td>No credentials</td></tr>
<tr><td>Ollama (Remote)</td><td>Your own Ollama server</td><td>Optional bearer</td></tr>
<tr><td>Ollama Cloud</td><td>Cloud</td><td>API Key</td></tr>
<tr><td>LM Studio</td><td>Local on your machine</td><td>No credentials</td></tr>
<tr><td>Groq</td><td>Cloud</td><td>API Key</td></tr>
<tr><td>OpenRouter</td><td>Cloud</td><td>API Key</td></tr>
<tr><td>Google Gemini</td><td>Cloud</td><td>API Key</td></tr>
<tr><td>Claude (Anthropic)</td><td>Cloud</td><td>API Key</td></tr>
<tr><td>OpenAI</td><td>Cloud</td><td>API Key</td></tr>
<tr><td>Nvidia Integrate</td><td>Cloud</td><td>API Key</td></tr>
<tr><td>WebGPU (Browser)</td><td>Inside the browser</td><td>No credentials</td></tr>
</tbody></table>
<p>Each engine remembers its own configuration (model, URL, key and parameters), so you can switch without reconfiguring. The connection is validated when you select an engine and when you save changes.</p>
<p><strong>CORS proxy:</strong> when wIA is served with its bundled Node server (or under Plesk), an internal proxy reaches engines that do not allow direct browser calls. On static hosting, wIA detects this and goes straight to providers that do support CORS.</p>` },

        { id: 'doc-webgpu', title: 'In-browser models (WebGPU)', html: `
<p>The <strong>WebGPU (Browser)</strong> engine runs models directly on your device's GPU/CPU via Transformers.js, without sending anything to a server.</p>
<ul>
<li><strong>Requirements:</strong> a browser with WebGPU support (recent Chrome/Edge). Without WebGPU, wIA falls back to WASM (slower).</li>
<li><strong>Download and cache:</strong> the first time, the model is downloaded from Hugging Face and <strong>cached</strong>; afterwards it loads instantly and works offline.</li>
<li><strong>Adaptive quantisation:</strong> wIA picks the precision (q4/q8/fp16) based on your hardware, balancing speed and quality.</li>
<li><strong>Web Worker:</strong> inference runs on a separate thread so the interface stays responsive.</li>
<li><strong>Streaming and cancellation:</strong> responses appear token by token and can be stopped.</li>
</ul>
<p class="doc-q">Loading acceleration</p>
<ul>
<li><strong>Multi-threaded WASM:</strong> thanks to cross-origin isolation, the runtime uses several threads (up to 8) plus SIMD, speeding up initialisation and CPU operations.</li>
<li><strong>Background preloading:</strong> the model starts downloading and initialising <strong>as soon as you type</strong>, so it is ready when you hit send.</li>
<li><strong>«⚡ Prepare model» button:</strong> in <em>Settings → Models</em>, downloads and initialises the model on demand.</li>
</ul>
<p class="doc-q">Using it on mobile</p>
<p>Phones have limited memory (especially iOS, with strict per-tab limits). wIA detects this and: starts with a <strong>lightweight model</strong> by default, shows a notice in the WebGPU panel and, if you pick a large one, <strong>offers to switch to a light model</strong> before loading. For maximum quality on the phone, use a cloud engine.</p>` },

        { id: 'doc-vision', title: 'Vision and images', html: `
<p>wIA can analyse images you attach with the 📎 icon. Depending on the engine and model you get:</p>
<ul>
<li><strong>Multimodal models</strong> (cloud or WebGPU) that understand image and text together.</li>
<li><strong>Vision assistants</strong> on WebGPU: image captioning, text reading (OCR) and advanced analysis.</li>
<li><strong>Indicative medical models:</strong> zero-shot visual classification and a <strong>wound classifier</strong> that recognises the type (abrasion, bruise, burn, cut, laceration, diabetic/venous/surgical wound, pressure ulcer or normal skin). <strong>These are indicative, not diagnostic:</strong> when in doubt, consult a healthcare professional.</li>
</ul>
<p><strong>Vision → chat chain:</strong> in <em>Settings → Models</em> (below the selector) you can combine a vision model with a chat model, and <strong>enable or disable</strong> the chain with its switch. When vision is active, the 👁 icon appears in the message box.</p>` },

        { id: 'doc-agentes', title: 'Agents', html: `
<p><strong>Agents</strong> are preconfigured assistants (in the style of GPTs): they combine a name, icon, description, their own system prompt, optionally a specific engine/model, and <em>starters</em>.</p>
<ul>
<li>Open the <strong>agent gallery</strong> to explore a curated selection and activate them with one click.</li>
<li>Create your own with their personality and knowledge base.</li>
<li><strong>Export and import</strong> agents as JSON to share or back them up.</li>
</ul>` },

        { id: 'doc-proyectos', title: 'Projects and documents', html: `
<p><strong>Projects</strong> group chats under a common context. Each project can have:</p>
<ul>
<li>Its own <strong>system prompt</strong> guiding all its conversations.</li>
<li>A <strong>knowledge base</strong> of documents (including PDF reading), available as permanent reference material for the model.</li>
</ul>
<p>Switch projects from the selector at the top. The «General» project always exists by default.</p>` },

        { id: 'doc-chat', title: 'The chat', html: `
<ul>
<li><strong>Send:</strong> Enter. <strong>New line:</strong> Shift + Enter.</li>
<li><strong>Streaming:</strong> the reply is written live; you can cancel it.</li>
<li><strong>Reasoning:</strong> with supported models, wIA shows its «thinking» separately from the answer.</li>
<li><strong>Markdown and code:</strong> with syntax highlighting and a copy button.</li>
<li><strong>Attachments:</strong> images and documents via the 📎 icon.</li>
<li>Each chat can be <strong>exported</strong> individually (text/JSON).</li>
</ul>
<p class="doc-q">Quick fallback when something fails</p>
<p>If a model fails or the provider's <strong>credits run out</strong>, the error card offers buttons to <strong>continue instantly with another model</strong>, built from those <strong>recently used successfully</strong> and your <strong>favourites</strong>, plus <strong>local WebGPU</strong> (free, no credits) as a safety net. One click switches engine and retries the message.</p>` },

        { id: 'doc-selectores', title: 'Quick selectors', html: `
<p>From the message box itself you can switch prompt, model or engine without opening Settings:</p>
<table class="doc-table">
<thead><tr><th>You type</th><th>What opens</th></tr></thead>
<tbody>
<tr><td><code>/</code></td><td>Saved <strong>prompt</strong> library</td></tr>
<tr><td><code>//</code></td><td><strong>Models</strong> of the selected engine</td></tr>
<tr><td><code>///</code></td><td>Choose the AI <strong>engine</strong></td></tr>
<tr><td><code>+</code></td><td>Queues the order instead of sending it</td></tr>
</tbody></table>
<p>You can filter by typing after the prefix (for example <code>//qwen</code> or <code>///groq</code>), navigate with ↑ ↓ and confirm with Enter. The active item is marked as «· current».</p>` },

        { id: 'doc-web', title: 'Web search', html: `
<p>wIA can search the internet to answer with current information. When the tool is available, the model uses it automatically if it detects it needs recent data, and you will see the corresponding icon in the message box.</p>
<p>The search combines several sources with layered fallback: real web results (via DuckDuckGo Lite when a proxy is available), DuckDuckGo instant answers and Wikipedia in Spanish and English. This way it returns something useful both with your own server and on static hosting.</p>` },

        { id: 'doc-cola', title: 'Order queue', html: `
<p>If you start a message with the <strong><code>+</code></strong> prefix, instead of being sent it is added to a <strong>queue of pending orders</strong>. You can queue several and wIA runs them sequentially. The queue <strong>persists between sessions</strong> and is included in the full backup.</p>` },

        { id: 'doc-anon', title: 'Data anonymisation (DLP)', html: `
<p>wIA includes a <strong>local data protection</strong> layer: before sending your prompt to the AI, it replaces sensitive data with consistent <strong>placeholders</strong> (<code>[Nombre_001]</code>, <code>[DNI_001]</code>…).</p>
<ul>
<li><strong>Enable it:</strong> with the <strong>🕶️</strong> icon in the message box or from <em>Settings → Anonymisation</em>.</li>
<li><strong>Reversible and private:</strong> the mapping is stored <strong>encrypted per chat</strong> (AES-GCM) and the reply is restored <strong>only on your screen</strong>. The real values never leave the browser.</li>
<li>A <strong>badge</strong> under your message shows how many items were protected.</li>
</ul>
<p class="doc-q">Recognised data types</p>
<p>Over 20 types are detected: email, phone number, national ID (DNI/NIE/NIF), company tax ID, IBAN, credit card, social security number, passport, physical address, postcode, vehicle plate, IP address, MAC address, dates (possible date of birth), social media handle, API keys and tokens (including JWT), GPS coordinates, policy number, court case and proceedings references, plus dictionaries of personal names and organisations.</p>
<p class="doc-q">Enabling or disabling types</p>
<p>In <em>Settings → Anonymisation</em> all types are listed with a checkbox each, plus an <strong>«Enable all»</strong> switch. Turn off the ones you do not need (for example dates or IPs if they cause false positives). Your selection is remembered.</p>` },

        { id: 'doc-privacidad', title: 'Privacy and security', html: `
<ul>
<li><strong>Local inference:</strong> with WebGPU, LM Studio or local Ollama, your messages never leave your machine.</li>
<li><strong>Encrypted API keys:</strong> keys are not stored in plain text. They are encrypted with AES-GCM using a non-exportable key that lives in the browser.</li>
<li><strong>PIN lock:</strong> protects the interface on shared devices.</li>
<li><strong>Incognito mode:</strong> disables saving of the current conversation.</li>
<li><strong>Anonymisation 🕶️:</strong> see the dedicated section.</li>
<li><strong>Security headers:</strong> the deployment adds cross-origin isolation and headers that harden the app (and enable multi-threaded WASM).</li>
</ul>
<p>Bear in mind that <em>cloud</em> engines receive your messages on their servers under their own policies; for maximum privacy, use local engines.</p>` },

        { id: 'doc-backup', title: 'Backups', html: `
<p>Your data lives in the browser and could be cleared if it frees up space. From <em>Settings → Data</em>:</p>
<ul>
<li><strong>Export / Import Settings:</strong> preferences and engine configuration only.</li>
<li><strong>Export / Import All:</strong> a complete copy (projects, agents, chats, order queue and settings) in a single JSON. API keys are excluded for security.</li>
</ul>
<p>wIA also requests <em>persistent storage</em> to reduce the risk of automatic eviction. Even so, export a copy from time to time.</p>` },

        { id: 'doc-tema', title: 'Themes and language', html: `
<p>In <em>Settings → Experience</em> you can customise the look and the language.</p>
<p class="doc-q">Themes</p>
<ul>
<li><strong>System (Automatic)</strong> — default: follows your operating system's light/dark mode.</li>
<li><strong>Tligent (Corporate)</strong> — white background, black text and red/grey brand accents.</li>
<li><strong>Dark</strong>, <strong>Light</strong> and <strong>Vanilla</strong> (minimalist).</li>
</ul>
<p class="doc-q">Language</p>
<p>wIA is available in <strong>Spanish</strong> and <strong>English</strong>. By default it <strong>detects your browser language</strong>. If you pick a specific one in the language selector, that choice is <strong>remembered and takes priority</strong> over detection. The documentation changes language too.</p>` },

        { id: 'doc-pwa', title: 'Installation and offline use', html: `
<p>wIA is a <strong>PWA</strong>: from a compatible browser you can <strong>install it</strong> as an application. Thanks to its service worker, the app shell is stored so it can <strong>start offline</strong>. Combined with already-cached WebGPU models, you can chat with AI <strong>in flight mode</strong>.</p>
<p class="doc-tip">After a new version is published, you may need to reload once for the service worker to serve the latest one.</p>` },

        { id: 'doc-atajos', title: 'Keyboard shortcuts', html: `
<table class="doc-table">
<thead><tr><th>Shortcut</th><th>Action</th></tr></thead>
<tbody>
<tr><td><kbd>Enter</kbd></td><td>Send the message</td></tr>
<tr><td><kbd>Shift</kbd> + <kbd>Enter</kbd></td><td>New line</td></tr>
<tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>N</kbd></td><td>New chat</td></tr>
<tr><td><kbd>/</kbd> (at the start)</td><td>Prompt library</td></tr>
<tr><td><kbd>/</kbd><kbd>/</kbd> (at the start)</td><td>Models of the current engine</td></tr>
<tr><td><kbd>/</kbd><kbd>/</kbd><kbd>/</kbd> (at the start)</td><td>Choose AI engine</td></tr>
<tr><td><kbd>+</kbd> (at the start)</td><td>Queue the order</td></tr>
<tr><td><kbd>Esc</kbd></td><td>Close dialogs/panels</td></tr>
<tr><td><kbd>↑</kbd> <kbd>↓</kbd></td><td>Navigate the selectors</td></tr>
</tbody></table>` },

        { id: 'doc-faq', title: 'Troubleshooting', html: `
<p class="doc-q">It will not connect to a cloud engine.</p>
<p>Check that the API Key is valid and the URL correct. wIA shows the reason (credentials, URL, network or timeout).</p>
<p class="doc-q">A WebGPU model does not load or is very slow.</p>
<p>Check that your browser has WebGPU enabled; without it, WASM is used, which is slower. Large models take time on the first download and are cached afterwards.</p>
<p class="doc-q">On mobile the tab closes while loading a model.</p>
<p>That is a memory issue. Use a lightweight model (up to ~500 MB) or a cloud engine. wIA warns you and offers to switch automatically.</p>
<p class="doc-q">I lost my chats.</p>
<p>The browser may have cleared storage. Restore from <em>Import All</em> and export copies regularly.</p>
<p class="doc-q">Are the medical image results a diagnosis?</p>
<p>No. They are indicative automatic estimates; any clinical decision belongs to a healthcare professional.</p>` },

        { id: 'doc-autoria', title: 'Authorship and licence', html: `
<div class="doc-author-card">
  <div class="doc-author-avatar" aria-hidden="true">JdP</div>
  <div class="doc-author-info">
    <p class="doc-author-name">Created by <a href="https://jesus.depablos.es" target="_blank" rel="author noopener">Jesús de Pablos</a></p>
    <p class="doc-author-role">Author, design and development of wIA</p>
    <p><a class="doc-author-web" href="https://jesus.depablos.es" target="_blank" rel="author noopener">🌐 jesus.depablos.es</a></p>
  </div>
</div>
<p><strong>wIA</strong> is a <strong>free and open source</strong> project conceived, designed and developed by <strong>Jesús de Pablos</strong>. You may use, study, modify and share it freely under the <strong>MIT</strong> licence.</p>
<p>The only condition is to <strong>keep the attribution</strong>: preserve the copyright notice and the credit to Jesús de Pablos (<a href="https://jesus.depablos.es" target="_blank" rel="author noopener">jesus.depablos.es</a>) in any copy or derivative work.</p>
<p class="doc-license-note">© 2026 Jesús de Pablos · MIT Licence · <a href="https://jesus.depablos.es" target="_blank" rel="author noopener">jesus.depablos.es</a></p>` },
    ]
};

// Renderiza índice + cuerpo de la documentación en el idioma activo.
function renderDocs() {
    const toc = document.getElementById('docsToc');
    const body = document.getElementById('docsBody');
    if (!toc || !body) return;
    const lang = (typeof getLang === 'function') ? getLang() : 'es';
    const sections = DOCS_CONTENT[lang] || DOCS_CONTENT.es;

    toc.innerHTML = sections.map((s, i) =>
        `<a href="#${s.id}" data-doc-target="${s.id}">${i + 1} · ${escapeHtml(s.title)}</a>`
    ).join('');

    const footNote = lang === 'en'
        ? 'wIA — multi-engine AI hub · Created by <a href="https://jesus.depablos.es" target="_blank" rel="author noopener">Jesús de Pablos</a> · © 2026 · MIT Licence.'
        : 'wIA — hub de IA multimotor · Creado por <a href="https://jesus.depablos.es" target="_blank" rel="author noopener">Jesús de Pablos</a> · © 2026 · Licencia MIT.';

    body.innerHTML = sections.map((s, i) => `
        <article class="doc-block${s.id === 'doc-autoria' ? ' doc-author-block' : ''}" id="${s.id}">
            <h2>${i + 1} · ${escapeHtml(s.title)}</h2>
            ${s.html}
        </article>`).join('') + `<p class="doc-footer-note">${footNote}</p>`;
}
