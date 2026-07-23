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
        if (v !== null && v !== el.dataset.i18nTitle) el.setAttribute('title', v);
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

function refreshLocalizedUI() {
    applyI18n();
    // Partes generadas por JS que contienen texto traducible.
    try { if (typeof renderDocs === 'function') renderDocs(); } catch (e) {}
    try { if (typeof renderWelcomeStarters === 'function') renderWelcomeStarters(); } catch (e) {}
    try { if (typeof renderChatList === 'function') renderChatList(); } catch (e) {}
    try { if (typeof renderAnonTypesPanel === 'function') renderAnonTypesPanel(); } catch (e) {}
    try { if (typeof updateAnonButtonUI === 'function') updateAnonButtonUI(); } catch (e) {}
    try { if (typeof renderWebGPUMonitor === 'function') renderWebGPUMonitor(); } catch (e) {}
    const sel = document.getElementById('languageSelect');
    if (sel) sel.value = state.settings.language || 'auto';
}

// ─── Cadenas de la interfaz ──────────────────
const I18N_STRINGS = {
    es: {
        // Cabecera / pantalla de bienvenida
        'app.tagline': 'Tu hub de IA multimotor —',
        'app.tagline.accent': 'Local y Cloud',
        'welcome.newChat': 'Nuevo chat',
        'header.menu': 'Abrir o cerrar el menú lateral (chats y proyectos)',
        'header.settings': 'Configuración',
        // Caja de mensaje
        'input.placeholder': 'Escribe un mensaje... ( / para prompts)',
        'input.attach': 'Sube archivos (PDF, Markdown, Código) o Imágenes. Su contenido se extraerá localmente y se inyectará como contexto para nutrir a la IA en este mensaje específico.',
        'input.prompts': 'Biblioteca de prompts guardados. También puedes escribir / en el chat.',
        'input.voice': 'Entrada por voz (Web Speech API)',
        'input.send': 'Despacha toda la historia del chat + documentos serializados al Provider activo seleccionado',
        'input.improve': 'Delega a la IA activa la optimización lingüística e intencional de lo que acabas de escribir. Mejorará tu prompt inyectándole claridad antes de que lo envíes.',
        'input.internet': 'Búsqueda en Internet: cuando lo necesite, el modelo consultará la web para responder con datos actuales. Disponible en modelos con soporte de herramientas.',
        // Barra lateral
        'sidebar.search': 'Buscar conversaciones...',
        'sidebar.newProject': 'Nuevo proyecto',
        'chat.favorite': 'Añadir a favoritos',
        'chat.unfavorite': 'Quitar de favoritos',
        'chat.export': 'Exportar',
        'chat.move': 'Mover a otro Proyecto',
        'chat.delete': 'Eliminar',
        // Pie
        'footer.author': 'Creado por',
        'footer.privacy': 'COOKIES Y PRIVACIDAD',
        // Ajustes: navegación
        'settings.title': 'Ajustes',
        'settings.eyebrow': 'PREFERENCIAS DE wIA',
        'nav.connection': 'Conexión', 'nav.connection.sub': 'Motor, URL y acceso',
        'nav.models': 'Modelos', 'nav.models.sub': 'Catálogo y WebGPU',
        'nav.generation': 'Generación', 'nav.generation.sub': 'Creatividad y límites',
        'nav.experience': 'Experiencia', 'nav.experience.sub': 'Tema, idioma y comportamiento',
        'nav.anon': 'Anonimización', 'nav.anon.sub': 'Datos sensibles (DLP)',
        'nav.privacy': 'Privacidad', 'nav.privacy.sub': 'Sesión y bloqueo',
        'nav.data': 'Datos', 'nav.data.sub': 'Copias y limpieza',
        'nav.docs': 'Documentación', 'nav.docs.sub': 'Guía y manual (PDF)',
        // Ajustes: encabezados
        'panel.connection.eyebrow': '01 · CONECTIVIDAD',
        'panel.connection.title': 'Conecta tu motor de IA',
        'panel.connection.desc': 'Elige dónde se ejecuta la inteligencia y configura sus credenciales.',
        'panel.models.eyebrow': '02 · CATÁLOGO',
        'panel.models.title': 'Selecciona el modelo',
        'panel.models.desc': 'Busca, filtra y gestiona los modelos disponibles para el motor activo.',
        'panel.generation.eyebrow': '03 · RESPUESTA',
        'panel.generation.title': 'Controla la generación',
        'panel.generation.desc': 'Ajusta creatividad, diversidad y longitud de las respuestas.',
        'panel.experience.eyebrow': '04 · PERSONALIZACIÓN',
        'panel.experience.title': 'Adapta tu experiencia',
        'panel.experience.desc': 'Define el aspecto de wIA, el idioma y la forma en que debe comportarse el asistente.',
        'panel.anon.eyebrow': '05 · ANONIMIZACIÓN (DLP LOCAL)',
        'panel.anon.title': 'Anonimiza datos sensibles',
        'panel.anon.desc': 'Sustituye los datos sensibles por placeholders antes de enviarlos a la IA. Todo ocurre en tu navegador; los valores reales nunca salen.',
        'panel.privacy.eyebrow': '06 · PROTECCIÓN LOCAL',
        'panel.privacy.title': 'Controla tu privacidad',
        'panel.privacy.desc': 'Decide qué se conserva en el navegador y protege el acceso casual.',
        'panel.data.eyebrow': '07 · ALMACENAMIENTO',
        'panel.data.title': 'Gestiona tus datos',
        'panel.data.desc': 'Crea copias de tus preferencias o limpia el almacenamiento local.',
        'panel.docs.eyebrow': '08 · AYUDA',
        'panel.docs.title': 'Documentación',
        'panel.docs.desc': 'Guía completa de wIA. Usa el índice para navegar o descárgala en PDF.',
        // Ajustes: campos comunes
        'field.engine': 'Motor de IA (Backend)',
        'field.serverUrl': 'URL del Servidor',
        'field.apiKey': 'API Key',
        'field.model': 'Modelo',
        'field.theme': 'Tema Visual',
        'field.language': 'Idioma',
        'field.language.help': 'Se detecta automáticamente según tu navegador. Si eliges uno concreto, se memoriza y tiene prioridad.',
        'field.language.auto': 'Automático (según navegador)',
        'field.systemPrompt': 'System Prompt',
        'field.temperature': 'Temperatura',
        'connection.status': 'Estado de la conexión',
        'connection.validate': 'Validar conexión',
        'connection.check': 'Comprobar WebGPU',
        'connection.idle': 'Sin validar',
        // Anonimización
        'anon.master': '🕶️ Anonimizar datos sensibles al enviar',
        'anon.master.help': 'Al activarlo, DNI/NIE, emails, teléfonos, IBAN, nombres… se sustituyen por placeholders (<code>[Nombre_001]</code>) antes de enviar el prompt. El mapa reversible se guarda cifrado por chat y la respuesta se restaura solo en tu pantalla. También con el icono 🕶️ de la caja de mensaje.',
        'anon.types': 'Tipos de datos que se filtran',
        'anon.selectAll': 'Activar todos',
        'anon.types.help': 'Desactiva los tipos que no quieras anonimizar (p. ej. fechas o IPs si generan falsos positivos).',
        'anon.badge.one': 'dato sensible protegido',
        'anon.badge.many': 'datos sensibles protegidos',
        // Privacidad
        'privacy.incognito': 'Modo Incógnito',
        'privacy.lock': 'Bloqueo local de privacidad al abrir',
        // Datos
        'data.backupSettings': '💾 Copia de Seguridad de Ajustes',
        'data.exportSettings': 'Exportar Ajustes',
        'data.importSettings': 'Importar Ajustes',
        'data.backupAll': '🗄️ Copia de Seguridad Completa',
        'data.exportAll': 'Exportar Todo',
        'data.importAll': 'Importar Todo',
        'data.danger': 'Zona de Peligro',
        'data.clearHistory': 'Limpiar historial',
        'data.factoryReset': 'Reset de fábrica',
        // Documentación
        'docs.downloadPdf': '⬇️ Descargar PDF',
        'docs.version': 'Versión',
        'docs.backToTop': '↑ Índice',
        'docs.tocTitle': 'Índice de la documentación',
        // Botones comunes
        'btn.save': 'Guardar cambios',
        'btn.reset': 'Restablecer',
        'btn.close': 'Cerrar',
        'settings.saveNote': 'Motor y modelo se aplican al seleccionarlos; el resto, al guardar.',
        // Errores / fallback
        'error.title': 'Fallo de Conexión',
        'error.retry': 'Reintentar ahora',
        'error.fallback': '⚡ Continuar con otro modelo (favoritos / usados con éxito):',
    },
    en: {
        'app.tagline': 'Your multi-engine AI hub —',
        'app.tagline.accent': 'Local & Cloud',
        'welcome.newChat': 'New chat',
        'header.menu': 'Open or close the sidebar (chats and projects)',
        'header.settings': 'Settings',
        'input.placeholder': 'Type a message... ( / for prompts)',
        'input.attach': 'Upload files (PDF, Markdown, code) or images. Their content is extracted locally and injected as context for the AI in this specific message.',
        'input.prompts': 'Saved prompt library. You can also type / in the chat.',
        'input.voice': 'Voice input (Web Speech API)',
        'input.send': 'Sends the whole chat history + serialized documents to the selected active provider',
        'input.improve': 'Asks the active AI to optimise the wording and intent of what you just wrote, making your prompt clearer before you send it.',
        'input.internet': 'Web search: when needed, the model will look things up online to answer with current data. Available on models with tool support.',
        'sidebar.search': 'Search conversations...',
        'sidebar.newProject': 'New project',
        'chat.favorite': 'Add to favourites',
        'chat.unfavorite': 'Remove from favourites',
        'chat.export': 'Export',
        'chat.move': 'Move to another Project',
        'chat.delete': 'Delete',
        'footer.author': 'Created by',
        'footer.privacy': 'COOKIES & PRIVACY',
        'settings.title': 'Settings',
        'settings.eyebrow': 'wIA PREFERENCES',
        'nav.connection': 'Connection', 'nav.connection.sub': 'Engine, URL and access',
        'nav.models': 'Models', 'nav.models.sub': 'Catalogue and WebGPU',
        'nav.generation': 'Generation', 'nav.generation.sub': 'Creativity and limits',
        'nav.experience': 'Experience', 'nav.experience.sub': 'Theme, language and behaviour',
        'nav.anon': 'Anonymisation', 'nav.anon.sub': 'Sensitive data (DLP)',
        'nav.privacy': 'Privacy', 'nav.privacy.sub': 'Session and lock',
        'nav.data': 'Data', 'nav.data.sub': 'Backups and cleanup',
        'nav.docs': 'Documentation', 'nav.docs.sub': 'Guide and manual (PDF)',
        'panel.connection.eyebrow': '01 · CONNECTIVITY',
        'panel.connection.title': 'Connect your AI engine',
        'panel.connection.desc': 'Choose where the intelligence runs and configure its credentials.',
        'panel.models.eyebrow': '02 · CATALOGUE',
        'panel.models.title': 'Select the model',
        'panel.models.desc': 'Search, filter and manage the models available for the active engine.',
        'panel.generation.eyebrow': '03 · RESPONSE',
        'panel.generation.title': 'Control the generation',
        'panel.generation.desc': 'Tune creativity, diversity and response length.',
        'panel.experience.eyebrow': '04 · PERSONALISATION',
        'panel.experience.title': 'Tailor your experience',
        'panel.experience.desc': 'Define how wIA looks, its language and how the assistant should behave.',
        'panel.anon.eyebrow': '05 · ANONYMISATION (LOCAL DLP)',
        'panel.anon.title': 'Anonymise sensitive data',
        'panel.anon.desc': 'Replaces sensitive data with placeholders before sending it to the AI. Everything happens in your browser; the real values never leave it.',
        'panel.privacy.eyebrow': '06 · LOCAL PROTECTION',
        'panel.privacy.title': 'Control your privacy',
        'panel.privacy.desc': 'Decide what is kept in the browser and protect against casual access.',
        'panel.data.eyebrow': '07 · STORAGE',
        'panel.data.title': 'Manage your data',
        'panel.data.desc': 'Back up your preferences or clear local storage.',
        'panel.docs.eyebrow': '08 · HELP',
        'panel.docs.title': 'Documentation',
        'panel.docs.desc': 'Complete wIA guide. Use the index to navigate or download it as a PDF.',
        'field.engine': 'AI Engine (Backend)',
        'field.serverUrl': 'Server URL',
        'field.apiKey': 'API Key',
        'field.model': 'Model',
        'field.theme': 'Visual Theme',
        'field.language': 'Language',
        'field.language.help': 'Detected automatically from your browser. If you pick one, it is remembered and takes priority.',
        'field.language.auto': 'Automatic (browser setting)',
        'field.systemPrompt': 'System Prompt',
        'field.temperature': 'Temperature',
        'connection.status': 'Connection status',
        'connection.validate': 'Validate connection',
        'connection.check': 'Check WebGPU',
        'connection.idle': 'Not validated',
        'anon.master': '🕶️ Anonymise sensitive data before sending',
        'anon.master.help': 'When enabled, ID numbers, emails, phone numbers, IBANs, names… are replaced with placeholders (<code>[Nombre_001]</code>) before the prompt is sent. The reversible map is stored encrypted per chat and the reply is restored only on your screen. Also available via the 🕶️ icon in the message box.',
        'anon.types': 'Data types that are filtered',
        'anon.selectAll': 'Enable all',
        'anon.types.help': 'Turn off any types you do not want anonymised (e.g. dates or IPs if they cause false positives).',
        'anon.badge.one': 'sensitive item protected',
        'anon.badge.many': 'sensitive items protected',
        'privacy.incognito': 'Incognito Mode',
        'privacy.lock': 'Local privacy lock on open',
        'data.backupSettings': '💾 Settings Backup',
        'data.exportSettings': 'Export Settings',
        'data.importSettings': 'Import Settings',
        'data.backupAll': '🗄️ Full Backup',
        'data.exportAll': 'Export All',
        'data.importAll': 'Import All',
        'data.danger': 'Danger Zone',
        'data.clearHistory': 'Clear history',
        'data.factoryReset': 'Factory reset',
        'docs.downloadPdf': '⬇️ Download PDF',
        'docs.version': 'Version',
        'docs.backToTop': '↑ Index',
        'docs.tocTitle': 'Documentation index',
        'btn.save': 'Save changes',
        'btn.reset': 'Reset',
        'btn.close': 'Close',
        'settings.saveNote': 'Engine and model apply on selection; everything else on save.',
        'error.title': 'Connection Failure',
        'error.retry': 'Retry now',
        'error.fallback': '⚡ Continue with another model (favourites / previously successful):',
    }
};
