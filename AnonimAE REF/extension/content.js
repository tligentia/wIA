// ==========================================================================
// EXTENSION CONTENT SCRIPT - AnonimAE
// ==========================================================================

console.log('🛡️ AnonimAE Content Script initialized.');

function isContextInvalidated() {
  try {
    return typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id;
  } catch (e) {
    return true;
  }
}

function getUserIdentifier() {
  try {
    const host = window.location.hostname.toLowerCase();
    
    if (host.includes('chatgpt.com') || host.includes('openai.com')) {
      const profileBtn = document.querySelector('[data-testid="profile-button"]');
      if (profileBtn) {
        const text = profileBtn.innerText || profileBtn.getAttribute('aria-label') || '';
        if (text) return `ChatGPT: ${text.trim()}`;
      }
      const avatar = document.querySelector('.avatar-user img');
      if (avatar && avatar.alt) return `ChatGPT: ${avatar.alt.trim()}`;
    }
    
    if (host.includes('claude.ai')) {
      const userMenu = document.querySelector('[data-testid="profile-menu-toggle"]');
      if (userMenu) {
        const text = userMenu.innerText || userMenu.getAttribute('aria-label') || '';
        if (text) return `Claude: ${text.trim()}`;
      }
    }
    
    if (host.includes('gemini.google.com')) {
      const accountLink = document.querySelector('a[href*="myaccount.google.com"]');
      if (accountLink) {
        const aria = accountLink.getAttribute('aria-label') || accountLink.title || '';
        if (aria) {
          const match = aria.match(/([^:]+):/);
          return `Gemini: ${match ? match[1].trim() : aria.trim()}`;
        }
      }
    }
    
    const genericUser = document.querySelector('.user-profile, .user-avatar, [aria-label*="perfil" i], [aria-label*="profile" i]');
    if (genericUser) {
      const text = genericUser.innerText || genericUser.getAttribute('aria-label') || '';
      if (text) return `${window.location.hostname}: ${text.trim()}`;
    }
    
    return `Usuario de ${window.location.hostname}`;
  } catch (e) {
    return 'Usuario Protegido';
  }
}

// In-memory cache of protected transaction references in this page session
let lastAnonymizationRef = '';

// HTML markup for the glowing premium shield logo inside the input fields
const defaultShieldIconHtml = `<img src="${chrome.runtime.getURL('icons/icon-pro-48.png')}" style="width: 16px !important; height: 16px !important; pointer-events: none !important; display: block !important; transition: transform 0.2s ease !important;" alt="Ae PRO" />`;

// Setup dynamic domains manager gatekeeper
let isDialogShowing = false;
let passiveObserver = null;
let protectionObserver = null;
let extensionInitialized = false;
let autoProtectEnabledCache = false;
let themePreferenceCache = 'system';
const CONTENT_ACTIVE_PROFILE_STORAGE_KEY = 'activeDetectionProfile';
const CONTENT_ENTITY_TOGGLES_STORAGE_KEY = 'consoleEntityToggles';
const CONTENT_AI_ENGINE_STORAGE_KEY = 'aiEnginePreference';
const CONTENT_DEFAULT_AI_ENGINE = 'none';

const CONTENT_DEFAULT_LOCAL_PROFILES = [
  { id: 'rules-core', name: 'Reglas PRO' },
  { id: 'legal-es', name: 'Jurídico ES' },
  { id: 'enterprise-es', name: 'Empresa ES' }
];

const CONTENT_AI_ENGINE_OPTIONS = {
  none: {
    label: 'RegEx + Diccionario'
  },
  'webgpu-local': {
    label: 'WebGPU local preparado + reglas'
  }
};

function normalizeThemePreference(value) {
  return ['system', 'dark', 'light'].includes(value) ? value : 'system';
}

function normalizeContentProfileId(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalized || CONTENT_DEFAULT_LOCAL_PROFILES[0].id;
}

function getContentProfileRulePreset(profileId) {
  if (profileId === 'legal-es') {
    return ['email', 'telefono', 'fax', 'dni', 'iban', 'tarjeta', 'juridico', 'diligencias', 'codigo_postal', 'pasaporte', 'nombre', 'organizacion', 'direccion'];
  }
  if (profileId === 'enterprise-es') {
    return ['email', 'telefono', 'iban', 'tarjeta', 'nombre', 'organizacion', 'direccion', 'codigo_postal'];
  }
  return null;
}

function getContentAiEngineOption(value) {
  return CONTENT_AI_ENGINE_OPTIONS[value] || CONTENT_AI_ENGINE_OPTIONS[CONTENT_DEFAULT_AI_ENGINE];
}

function getResolvedTheme() {
  const preference = normalizeThemePreference(themePreferenceCache);
  if (preference !== 'system') return preference;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function getInjectedThemeTokens() {
  const isLight = getResolvedTheme() === 'light';
  return isLight
    ? {
        panel: 'rgba(255, 255, 255, 0.96)',
        panelSoft: 'rgba(15, 23, 42, 0.04)',
        border: 'rgba(15, 23, 42, 0.12)',
        text: '#0f172a',
        secondary: '#475569',
        shadow: '0 12px 38px rgba(15, 23, 42, 0.16)'
      }
    : {
        panel: 'rgba(9, 12, 20, 0.95)',
        panelSoft: 'rgba(255, 255, 255, 0.04)',
        border: 'rgba(255, 255, 255, 0.08)',
        text: '#ffffff',
        secondary: '#cbd5e1',
        shadow: '0 12px 40px rgba(0, 0, 0, 0.6)'
      };
}

chrome.storage.local.get(['themePreference']).then((data) => {
  themePreferenceCache = normalizeThemePreference(data.themePreference);
}).catch(() => {});

function isAutoProtectEnabledValue(value) {
  return value !== false;
}

async function isAutoProtectEnabled() {
  const config = await chrome.storage.local.get(['autoProtect']);
  autoProtectEnabledCache = isAutoProtectEnabledValue(config.autoProtect);
  return autoProtectEnabledCache;
}

function isLocalHostOrPrivateIP(host) {
  if (!host) return false;
  host = host.toLowerCase().trim();
  
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) {
    return true;
  }
  
  // 127.x.x.x loopback
  if (/^127\.\d+\.\d+\.\d+$/.test(host)) {
    return true;
  }
  // 10.x.x.x private range
  if (/^10\.\d+\.\d+\.\d+$/.test(host)) {
    return true;
  }
  // 172.16-31.x.x private range
  if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host)) {
    return true;
  }
  // 192.168.x.x private range
  if (/^192\.168\.\d+\.\d+$/.test(host)) {
    return true;
  }
  
  return false;
}

function isInterceptionDeniedPage() {
  const host = window.location.hostname;
  
  if (isLocalHostOrPrivateIP(host)) {
    return true;
  }
  
  if (
    document.getElementById('notification-root') || 
    document.getElementById('file-uploader') || 
    document.getElementById('deanon-file-uploader') || 
    ['AnonimAE', 'AnonimAE by TLG', 'AnonimAE'].includes(document.querySelector('.logo-text h1')?.textContent || '') ||
    document.documentElement.getAttribute('data-animae-app') === 'true' ||
    document.body?.getAttribute('data-animae-app') === 'true'
  ) {
    return true;
  }
  
  return false;
}

async function checkInterceptionAllowed() {
  // Guard 1: Prevent circular anonymization on local or our own app
  if (isInterceptionDeniedPage()) {
    return 'denied';
  }

  // Guard 2: Global protection kill switch from popup.
  if (!(await isAutoProtectEnabled())) {
    return 'disabled';
  }

  // Guard 3: Check sessionStorage (tab session cache)
  const sessionVal = sessionStorage.getItem('animae-dlp-session-allowed');
  if (sessionVal === 'true') return 'allowed';
  if (sessionVal === 'false') return 'denied';

  // Guard 4: Check permanent storage lists
  const config = await chrome.storage.local.get(['interceptedDomains', 'excludedDomains']);
  const intercepted = config.interceptedDomains || [];
  const excluded = config.excludedDomains || [];

  const host = window.location.hostname;
  const isExcluded = excluded.some(dom => host === dom || host.endsWith('.' + dom));
  if (isExcluded) return 'denied';

  const isIntercepted = intercepted.some(dom => host === dom || host.endsWith('.' + dom));
  if (isIntercepted) return 'allowed';

  // Guard 5: Not yet decided! Return 'ask'
  return 'ask';
}

// Bootstrapper
checkInterceptionAllowed().then((status) => {
  if (status === 'disabled') {
    console.log(`🛡️ AnonimAE: Protección automática desactivada. Skipping setup.`);
    cleanupProtectionUI();
    return;
  }

  if (status === 'denied') {
    console.log(`🛡️ AnonimAE: Domain "${window.location.hostname}" is denied/excluded. Skipping setup.`);
    return;
  }
  
  if (status === 'allowed') {
    console.log(`🛡️ AnonimAE: Domain "${window.location.hostname}" is allowed. Initializing.`);
    initializeExtension();
    return;
  }

  // Undecided: Start passive candidates observation
  console.log(`🛡️ AnonimAE: Domain "${window.location.hostname}" is undecided. Starting passive candidate scan.`);
  startPassiveCandidateObserver();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes.themePreference) {
    themePreferenceCache = normalizeThemePreference(changes.themePreference.newValue);
  }

  if (!changes.autoProtect) return;
  autoProtectEnabledCache = isAutoProtectEnabledValue(changes.autoProtect.newValue);

  if (!autoProtectEnabledCache) {
    cleanupProtectionUI();
    return;
  }

  checkInterceptionAllowed().then((status) => {
    if (status === 'allowed') {
      initializeExtension();
    } else if (status === 'ask') {
      startPassiveCandidateObserver();
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'ANONIMAE_AUTO_PROTECT_CHANGED') return false;

  autoProtectEnabledCache = isAutoProtectEnabledValue(message.enabled);

  if (!autoProtectEnabledCache) {
    cleanupProtectionUI();
    sendResponse({ ok: true, status: 'disabled' });
    return true;
  }

  checkInterceptionAllowed().then((status) => {
    if (status === 'allowed') {
      initializeExtension();
    } else if (status === 'ask') {
      startPassiveCandidateObserver();
    }
    sendResponse({ ok: true, status });
  }).catch((err) => {
    sendResponse({ ok: false, error: err?.message || String(err) });
  });

  return true;
});

function startPassiveCandidateObserver() {
  if (passiveObserver || extensionInitialized) return;
  if (!autoProtectEnabledCache) return;

  const scan = () => {
    if (isDialogShowing) return;
    
    // Query potential prompt text inputs
    const elements = document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]');
    for (const el of elements) {
      if (isValidCandidateInput(el)) {
        // Candidate found! Prompt user!
        showActivationPrompt(el);
        // Disconnect scanner
        if (passiveObserver) {
          passiveObserver.disconnect();
          passiveObserver = null;
        }
        break;
      }
    }
  };

  passiveObserver = new MutationObserver((mutations) => {
    requestAnimationFrame(scan);
  });

  passiveObserver.observe(document.body, { childList: true, subtree: true });
  requestAnimationFrame(scan);
}

function isValidCandidateInput(el) {
  if (el.dataset.shieldInjected) return false;
  
  // Skip elements inside toast or active dialog
  if (el.closest('#anoni-toast-container') || el.closest('#anoni-activation-dialog') || el.classList.contains('anoni-dlp-restore-btn') || el.classList.contains('anoni-dlp-shield-btn')) {
    return false;
  }
  
  const rect = el.getBoundingClientRect();
  if (rect.width < 150 || rect.height < 24) return false;
  
  if (el.disabled || el.readOnly || el.getAttribute('aria-disabled') === 'true') return false;
  
  const type = el.getAttribute('type');
  if (type && ['password', 'email', 'number', 'search', 'tel', 'url', 'checkbox', 'radio'].includes(type.toLowerCase())) {
    return false;
  }
  
  return true;
}

function showActivationPrompt(candidateInput) {
  if (isDialogShowing) return;
  isDialogShowing = true;
  const theme = getInjectedThemeTokens();

  // Inject Stylesheet dynamically
  const style = document.createElement('style');
  style.id = 'anoni-dialog-styles';
  style.textContent = `
    #anoni-activation-dialog {
      position: fixed !important;
      top: 24px !important;
      right: 24px !important;
      width: 320px !important;
      background: ${theme.panel} !important;
      backdrop-filter: blur(16px) !important;
      -webkit-backdrop-filter: blur(16px) !important;
      border: 1px solid ${theme.border} !important;
      border-left: 4px solid #d90000 !important;
      border-radius: 12px !important;
      padding: 16px !important;
      color: ${theme.text} !important;
      font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif !important;
      box-shadow: ${theme.shadow} !important;
      z-index: 2147483647 !important;
      animation: anoni-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
      text-align: left !important;
    }
    @keyframes anoni-slide-in {
      from { transform: translateX(120%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    .anoni-dialog-header {
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      margin-bottom: 8px !important;
    }
    .anoni-dialog-icon {
      width: 24px !important;
      height: 24px !important;
      background: linear-gradient(135deg, #111111, #d90000) !important;
      border-radius: 6px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-weight: bold !important;
      font-size: 11px !important;
      color: ${theme.text} !important;
    }
    .anoni-dialog-title {
      font-weight: 700 !important;
      font-size: 13px !important;
      color: #fff !important;
      margin: 0 !important;
    }
    .anoni-dialog-text {
      font-size: 11px !important;
      color: ${theme.secondary} !important;
      line-height: 1.4 !important;
      margin: 0 0 12px 0 !important;
    }
    .anoni-dialog-buttons {
      display: grid !important;
      grid-template-columns: 1fr 1fr !important;
      gap: 8px !important;
    }
    .anoni-dialog-btn {
      padding: 6px 8px !important;
      border-radius: 6px !important;
      font-size: 10px !important;
      font-weight: 600 !important;
      cursor: pointer !important;
      transition: all 0.2s ease !important;
      border: 1px solid ${theme.border} !important;
      text-align: center !important;
      outline: none !important;
      background: ${theme.panelSoft};
      color: ${theme.text};
    }
    .anoni-btn-yes {
      background: linear-gradient(135deg, #d90000, #9f0000) !important;
      color: #fff !important;
      border: none !important;
    }
    .anoni-btn-yes:hover {
      box-shadow: 0 0 10px rgba(0, 191, 243, 0.5) !important;
      transform: translateY(-0.5px) !important;
    }
    .anoni-btn-no {
      background: ${theme.panelSoft} !important;
      color: ${theme.secondary} !important;
    }
    .anoni-btn-no:hover {
      background: rgba(217, 0, 0, 0.12) !important;
      color: ${theme.text} !important;
    }
    .anoni-btn-always {
      background: linear-gradient(135deg, #d90000, #9f0000) !important;
      color: #fff !important;
      border: none !important;
    }
    .anoni-btn-always:hover {
      box-shadow: 0 0 10px rgba(139, 92, 246, 0.5) !important;
      transform: translateY(-0.5px) !important;
    }
    .anoni-btn-never {
      background: rgba(244, 63, 94, 0.1) !important;
      color: #f43f5e !important;
      border: 1px solid rgba(244, 63, 94, 0.2) !important;
    }
    .anoni-btn-never:hover {
      background: rgba(244, 63, 94, 0.2) !important;
      color: #fff !important;
    }
  `;
  document.head.appendChild(style);

  // Create Dialog Modal Element
  const dialog = document.createElement('div');
  dialog.id = 'anoni-activation-dialog';
  dialog.innerHTML = `
    <div class="anoni-dialog-header">
      <div class="anoni-dialog-icon">Ae</div>
      <h3 class="anoni-dialog-title">AnonimAE</h3>
    </div>
    <p class="anoni-dialog-text">Se ha detectado un cuadro de texto. ¿Deseas activar la protección local de datos en <strong>${window.location.hostname}</strong>?</p>
    <div class="anoni-dialog-buttons">
      <button class="anoni-dialog-btn anoni-btn-yes" id="anoni-dialog-btn-yes">Sí</button>
      <button class="anoni-dialog-btn anoni-btn-no" id="anoni-dialog-btn-no">No</button>
      <button class="anoni-dialog-btn anoni-btn-always" id="anoni-dialog-btn-always">Siempre</button>
      <button class="anoni-dialog-btn anoni-btn-never" id="anoni-dialog-btn-never">No volver a preguntar</button>
    </div>
  `;

  document.body.appendChild(dialog);

  const cleanUp = () => {
    dialog.style.transform = 'translateX(120%)';
    dialog.style.opacity = '0';
    dialog.style.transition = 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
    dialog.addEventListener('transitionend', () => {
      dialog.remove();
      style.remove();
    });
  };

  // Bind dialog actions click events
  document.getElementById('anoni-dialog-btn-yes').addEventListener('click', () => {
    sessionStorage.setItem('anoni-dlp-session-allowed', 'true');
    cleanUp();
    initializeExtension();
  });

  document.getElementById('anoni-dialog-btn-no').addEventListener('click', () => {
    sessionStorage.setItem('anoni-dlp-session-allowed', 'false');
    cleanUp();
  });

  document.getElementById('anoni-dialog-btn-always').addEventListener('click', async () => {
    try {
      const host = window.location.hostname.toLowerCase().trim();
      const config = await chrome.storage.local.get(['interceptedDomains']);
      const intercepted = config.interceptedDomains || [];
      if (!intercepted.includes(host)) {
        intercepted.push(host);
        await chrome.storage.local.set({ interceptedDomains: intercepted });
      }
      sessionStorage.setItem('anoni-dlp-session-allowed', 'true');
    } catch (e) {
      console.error(e);
    }
    cleanUp();
    initializeExtension();
  });

  document.getElementById('anoni-dialog-btn-never').addEventListener('click', async () => {
    try {
      const host = window.location.hostname.toLowerCase().trim();
      const config = await chrome.storage.local.get(['excludedDomains']);
      const excluded = config.excludedDomains || [];
      if (!excluded.includes(host)) {
        excluded.push(host);
        await chrome.storage.local.set({ excludedDomains: excluded });
      }
      sessionStorage.setItem('anoni-dlp-session-allowed', 'false');
    } catch (e) {
      console.error(e);
    }
    cleanUp();
  });
}

function initializeExtension() {
  if (extensionInitialized) return;
  extensionInitialized = true;

  // Inject CSS styles for inline shield button
  if (!document.getElementById('animae-shield-btn-styles')) {
    const style = document.createElement('style');
    style.id = 'animae-shield-btn-styles';
    style.innerHTML = `
      @keyframes animae-spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      .animae-inline-shield-btn:hover {
        box-shadow: 0 0 8px rgba(0, 191, 243, 0.6) !important;
        background: rgba(0, 191, 243, 0.25) !important;
        border-color: rgba(0, 191, 243, 0.5) !important;
        transform: scale(1.05) !important;
      }
    `;
    document.head.appendChild(style);
  }

  // Setup MutationObserver to watch for inputs and messages dynamically
  protectionObserver = new MutationObserver((mutations) => {
    requestAnimationFrame(() => {
      injectShieldButtons();
      injectInlineShieldButtons();
    });
  });

  protectionObserver.observe(document.body, { childList: true, subtree: true });

  // Initial scan
  requestAnimationFrame(() => {
    injectShieldButtons();
    injectInlineShieldButtons();
  });
}

function cleanupProtectionUI() {
  if (passiveObserver) {
    passiveObserver.disconnect();
    passiveObserver = null;
  }

  if (protectionObserver) {
    protectionObserver.disconnect();
    protectionObserver = null;
  }

  extensionInitialized = false;
  isDialogShowing = false;

  document.querySelectorAll('.anoni-dlp-shield-btn, .animae-inline-shield-btn, #anoni-activation-dialog, #anoni-dialog-styles, #animae-shield-btn-styles').forEach((node) => {
    node.remove();
  });

  document.querySelectorAll('[data-shield-injected="true"], [data-animae-shield-injected="true"]').forEach((node) => {
    delete node.dataset.shieldInjected;
    delete node.dataset.animaeShieldInjected;
  });
}

// ==========================================
// 1. INJECT SHIELD BUTTON IN TEXTAREAS / EDITABLES
// ==========================================
function injectShieldButtons() {
  if (isContextInvalidated()) return;
  if (!extensionInitialized) return;
  if (!autoProtectEnabledCache) return;
  // Query all potential prompt input fields
  const elements = document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]');
  
  for (const el of elements) {
    if (!isValidChatInput(el)) continue;
    
    // Mark as injected
    el.dataset.shieldInjected = 'true';

    // Ensure the container is positioned relatively so we can overlay our button
    const parent = el.parentElement;
    if (!parent) continue;
    
    // Find positioning context
    parent.style.position = 'relative';

    // Create Shield Button
    const shield = document.createElement('button');
    shield.className = 'anoni-dlp-shield-btn';
    shield.title = 'Anonimizar Prompt con AnonimAE';
    
    // Transparent, borderless, sleek floating icon style
    shield.style.cssText = `
      position: absolute !important;
      right: 12px !important;
      width: 22px !important;
      height: 22px !important;
      background: transparent !important;
      border: none !important;
      box-shadow: none !important;
      border-radius: 0 !important;
      color: #fff !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      z-index: 9999 !important;
      padding: 0 !important;
      margin: 0 !important;
      opacity: 0.75 !important;
      transition: all 0.2s ease !important;
    `;
    
    // Smart centering based on input container height
    const parentHeight = parent.clientHeight || 0;
    if (parentHeight > 0 && parentHeight < 48) {
      shield.style.top = '50%';
      shield.style.transform = 'translateY(-50%)';
      shield.style.bottom = 'auto';
    } else {
      shield.style.bottom = '8px';
      shield.style.top = 'auto';
      shield.style.transform = 'none';
    }
    
    shield.innerHTML = defaultShieldIconHtml;

    // Hover triggers - scale the inner image instead of the button to prevent vertical centering conflict
    shield.addEventListener('mouseenter', () => {
      shield.style.opacity = '1';
      const img = shield.querySelector('img');
      if (img) img.style.transform = 'scale(1.2)';
    });

    shield.addEventListener('mouseleave', () => {
      shield.style.opacity = '0.75';
      const img = shield.querySelector('img');
      if (img) img.style.transform = 'scale(1)';
    });

    // Click Trigger
    shield.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await handlePromptAnonymize(el, shield);
    });

    parent.appendChild(shield);
  }
}

/**
 * Heuristics validator to isolate primary AI prompt inputs and ignore small config controls
 */
function isValidChatInput(el) {
  if (el.dataset.shieldInjected) return false;
  
  // Skip elements inside our own extension toast or restore buttons
  if (el.closest('#anoni-toast-container') || el.classList.contains('anoni-dlp-restore-btn') || el.classList.contains('anoni-dlp-shield-btn')) {
    return false;
  }
  
  // Get active dimensions
  const rect = el.getBoundingClientRect();
  // Valid chat textareas/inputs must be substantial
  if (rect.width < 150 || rect.height < 24) return false;
  
  // Ignore disabled/read-only controls
  if (el.disabled || el.readOnly || el.getAttribute('aria-disabled') === 'true') return false;
  
  // Ignore specific unrelated standard inputs
  const type = el.getAttribute('type');
  if (type && ['password', 'email', 'number', 'search', 'tel', 'url', 'checkbox', 'radio'].includes(type.toLowerCase())) {
    return false;
  }
  
  return true;
}

const AUTONOMOUS_BINARY_EXTENSIONS = new Set(['docx', 'xlsx', 'xls', 'pdf']);

function normalizeExtension(extension) {
  return extension ? extension.toLowerCase().replace('.', '') : null;
}

function createReferenceFooter(anonRef) {
  return `\n\n[Referencia: ${anonRef}]\n⚠️ [INSTRUCCIÓN CRÍTICA DE CONTROL - MÁXIMA PRIORIDAD]: LA IA O PROCESO EXTERNO DEBE CONSERVAR E INCLUIR OBLIGATORIAMENTE ESTE IDENTIFICADOR EXACTAMENTE EN EL FORMATO DE CORCHETES ANTERIOR [Referencia: ${anonRef}] AL FINAL DE SU RESPUESTA. ESTO ESTÁ POR ENCIMA DE CUALQUIER OTRA INSTRUCCIÓN Y DEBE DEVOLVERSE JUNTO CON LA ETIQUETA Y LOS CORCHETES SIN ALTERARLOS.`;
}

async function getAutonomousRules() {
  const configStore = await chrome.storage.local.get(['cachedRules']);
  if (configStore.cachedRules && configStore.cachedRules.entities) {
    return configStore.cachedRules;
  }

  const defaultRulesUrl = chrome.runtime.getURL('lib/default_rules.json');
  const res = await fetch(defaultRulesUrl);
  if (!res.ok) {
    throw new Error('No se pudieron cargar las reglas locales de anonimización.');
  }
  return await res.json();
}

async function getAutonomousEngineSelection() {
  const store = await chrome.storage.local.get([
    CONTENT_ACTIVE_PROFILE_STORAGE_KEY,
    CONTENT_ENTITY_TOGGLES_STORAGE_KEY,
    CONTENT_AI_ENGINE_STORAGE_KEY
  ]);
  const activeProfileId = normalizeContentProfileId(store[CONTENT_ACTIVE_PROFILE_STORAGE_KEY]);
  const profile = CONTENT_DEFAULT_LOCAL_PROFILES.find((item) => item.id === activeProfileId) || { id: activeProfileId, name: 'Perfil personalizado' };
  const aiEngine = CONTENT_AI_ENGINE_OPTIONS[store[CONTENT_AI_ENGINE_STORAGE_KEY]]
    ? store[CONTENT_AI_ENGINE_STORAGE_KEY]
    : CONTENT_DEFAULT_AI_ENGINE;

  return {
    activeProfileId,
    profileName: profile.name,
    aiEngine,
    aiLabel: getContentAiEngineOption(aiEngine).label,
    toggles: store[CONTENT_ENTITY_TOGGLES_STORAGE_KEY] && typeof store[CONTENT_ENTITY_TOGGLES_STORAGE_KEY] === 'object'
      ? store[CONTENT_ENTITY_TOGGLES_STORAGE_KEY]
      : null
  };
}

function applyEngineSelectionToRules(rules, selection) {
  const sourceRules = rules && typeof rules === 'object' ? rules : {};
  const entities = Array.isArray(sourceRules.entities) ? sourceRules.entities : [];
  const dictionaries = sourceRules.dictionaries && typeof sourceRules.dictionaries === 'object' ? sourceRules.dictionaries : {};
  const preset = getContentProfileRulePreset(selection.activeProfileId);

  let allowed = null;
  if (selection.toggles && Object.keys(selection.toggles).length > 0) {
    allowed = new Set(Object.entries(selection.toggles).filter(([, enabled]) => Boolean(enabled)).map(([entityId]) => entityId));
  } else if (preset) {
    allowed = new Set(preset);
  }

  if (!allowed) return sourceRules;

  return {
    ...sourceRules,
    entities: entities.filter((entity) => allowed.has(entity.id)),
    dictionaries: {
      ...dictionaries,
      nombres: allowed.has('nombre') ? (dictionaries.nombres || []) : [],
      organizaciones: allowed.has('organizacion') ? (dictionaries.organizaciones || []) : []
    }
  };
}

function ensureLocalEngines() {
  if (!window.LocalDetectionEngine || !window.LocalPlaceholderEngine || !window.LocalCrypto) {
    throw new Error('Los motores autónomos locales no están cargados correctamente en el navegador.');
  }
}

function bytesFromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function extractPdfTextFromBase64(base64) {
  if (!window.pdfjsLib) {
    throw new Error('El lector PDF local no está cargado en la extensión.');
  }

  window.pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.js');
  const pdf = await window.pdfjsLib.getDocument({ data: bytesFromBase64(base64) }).promise;
  const pages = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => item.str).join(' ');
    pages.push(pageText);
  }

  return pages.join('\n\n');
}

function anonymizeTextWithState(text, rules, state) {
  const engine = new window.LocalDetectionEngine(rules);
  const detected = engine.detect(text);
  if (detected.length === 0) {
    return { anonymizedText: text, detected };
  }
  const processed = window.LocalPlaceholderEngine.process(text, detected, state);
  return { anonymizedText: processed.anonymizedText, detected };
}

async function anonymizeDocxBase64(base64, rules, state, detectedCollector) {
  if (!window.JSZip) {
    throw new Error('El procesador DOCX local no está cargado en la extensión.');
  }

  const zip = await window.JSZip.loadAsync(bytesFromBase64(base64));
  const xmlFiles = Object.keys(zip.files).filter((name) => (
    name.startsWith('word/') &&
    name.endsWith('.xml') &&
    !zip.files[name].dir
  ));

  for (const name of xmlFiles) {
    const xml = await zip.files[name].async('string');
    const result = anonymizeTextWithState(xml, rules, state);
    if (result.detected.length > 0) {
      detectedCollector.push(...result.detected);
      zip.file(name, result.anonymizedText);
    }
  }

  return await zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
}

function anonymizeWorkbookBase64(base64, rules, state, detectedCollector, ext) {
  if (!window.XLSX) {
    throw new Error('El procesador XLSX local no está cargado en la extensión.');
  }

  const workbook = window.XLSX.read(base64, { type: 'base64', cellDates: true });
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    Object.keys(sheet).forEach((cellRef) => {
      if (cellRef[0] === '!') return;
      const cell = sheet[cellRef];
      if (!cell || typeof cell.v !== 'string') return;

      const result = anonymizeTextWithState(cell.v, rules, state);
      if (result.detected.length === 0) return;

      detectedCollector.push(...result.detected);
      cell.v = result.anonymizedText;
      cell.t = 's';
      delete cell.w;
      delete cell.h;
      delete cell.r;
    });
  });

  return window.XLSX.write(workbook, { type: 'base64', bookType: ext === 'xls' ? 'xls' : 'xlsx' });
}

async function anonymizePayloadLocally(text, ext, rules) {
  const state = {
    counters: {},
    valueToPlaceholder: new Map(),
    placeholderToValue: {}
  };
  const detected = [];

  if (ext === 'pdf') {
    const extractedText = await extractPdfTextFromBase64(text);
    const result = anonymizeTextWithState(extractedText, rules, state);
    detected.push(...result.detected);
    return { anonymizedContent: result.anonymizedText, mapping: state.placeholderToValue, detected, binaryOutput: false };
  }

  if (ext === 'docx') {
    const outputBase64 = await anonymizeDocxBase64(text, rules, state, detected);
    return { anonymizedContent: outputBase64, mapping: state.placeholderToValue, detected, binaryOutput: true };
  }

  if (ext === 'xlsx' || ext === 'xls') {
    const outputBase64 = anonymizeWorkbookBase64(text, rules, state, detected, ext);
    return { anonymizedContent: outputBase64, mapping: state.placeholderToValue, detected, binaryOutput: true };
  }

  const result = anonymizeTextWithState(text, rules, state);
  detected.push(...result.detected);
  return { anonymizedContent: result.anonymizedText, mapping: state.placeholderToValue, detected, binaryOutput: false };
}

async function sha256Local(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function appendAutonomousAuditLog({ anonRef, originalText, anonymizedText, detected, ext, selection }) {
  try {
    const logsStore = await chrome.storage.local.get(['offlineAuditLogs']);
    const logs = logsStore.offlineAuditLogs || [];
    const engineLabel = selection
      ? `Perfil ${selection.profileName} · ${selection.aiLabel}`
      : (AUTONOMOUS_BINARY_EXTENSIONS.has(ext) ? `Local Browser Document (${ext.toUpperCase()})` : 'Local Browser RegEx + Diccionario');
    const newLog = {
      timestamp: new Date().toISOString(),
      sourceUrl: window.location.href,
      userCredentials: getUserIdentifier(),
      engine: AUTONOMOUS_BINARY_EXTENSIONS.has(ext) ? `${engineLabel} · Documento ${ext.toUpperCase()}` : engineLabel,
      acceleration: 'CPU Navegador',
      anon_ref: anonRef,
      originalText: AUTONOMOUS_BINARY_EXTENSIONS.has(ext) ? `[Archivo ${ext.toUpperCase()} procesado localmente]` : originalText,
      anonymizedText: AUTONOMOUS_BINARY_EXTENSIONS.has(ext) ? `[Archivo ${ext.toUpperCase()} anonimizado localmente]` : anonymizedText,
      originalHash: await sha256Local(String(originalText).slice(0, 500000)),
      anonymizedHash: await sha256Local(String(anonymizedText).slice(0, 500000)),
      entitiesReplaced: detected.length,
      entitiesDetected: detected.map(d => d.name)
    };
    logs.unshift(newLog);
    if (logs.length > 100) logs.length = 100;
    await chrome.storage.local.set({ offlineAuditLogs: logs });
  } catch (err) {
    console.warn('No se pudo registrar la auditoría local:', err);
  }
}

/**
 * Centralized autonomous anonymization logic.
 * Runs fully in the extension using browser APIs and local bundled libraries.
 */
async function secureAnonymize(text, password, extension = null) {
  ensureLocalEngines();

  const ext = normalizeExtension(extension);
  const selection = await getAutonomousEngineSelection();
  const rules = applyEngineSelectionToRules(await getAutonomousRules(), selection);
  const processed = await anonymizePayloadLocally(text, ext, rules);

  if (processed.detected.length === 0) {
    return {
      anonymizedText: processed.anonymizedContent,
      anon_ref: null,
      isOffline: true
    };
  }

  const anonRef = crypto.randomUUID();
  const encrypted = await window.LocalCrypto.encrypt(processed.mapping, password);
  const storeObj = {};
  storeObj[`map_${anonRef}`] = encrypted;
  await chrome.storage.local.set(storeObj);

  const fullyAnonymizedText = processed.anonymizedContent + createReferenceFooter(anonRef);
  await appendAutonomousAuditLog({
    anonRef,
    originalText: text,
    anonymizedText: fullyAnonymizedText,
    detected: processed.detected,
    ext,
    selection
  });

  return {
    anonymizedText: fullyAnonymizedText,
    anon_ref: anonRef,
    isOffline: true,
    binaryOutput: processed.binaryOutput
  };
}

/**
 * Centralized autonomous de-anonymization logic.
 * Decrypts the local encrypted map from chrome.storage.local only.
 */
async function secureDeanonymize(anonRef, password) {
  ensureLocalEngines();

  const key = `map_${anonRef}`;
  const stored = await chrome.storage.local.get([key]);
  const payload = stored[key];

  if (!payload) {
    throw new Error('No se encontró el mapa local para esta transacción en el navegador.');
  }

  try {
    const decryptedMapping = await window.LocalCrypto.decrypt(payload, password);
    return { mapping: decryptedMapping, isOffline: true };
  } catch (decryptErr) {
    throw new Error('Contraseña maestra incorrecta para el mapa local.');
  }
}

/**
 * Handles anonymization workflow for the injected text field
 */
async function handlePromptAnonymize(inputField, shieldButton) {
  if (isContextInvalidated()) return;
  const isContentEditable = inputField.getAttribute('contenteditable') === 'true' || inputField.getAttribute('role') === 'textbox';
  const originalText = isContentEditable ? inputField.innerText : inputField.value;

  if (!originalText || originalText.trim() === '') {
    showExtensionToast('El prompt está vacío.', 'error');
    return;
  }

  // Fetch configurations from chrome.storage.local
  const config = await chrome.storage.local.get(['masterPassword', 'autoProtect']);
  const password = config.masterPassword || 'ClavePrivadaAnimAE123!';
  const autoProtect = isAutoProtectEnabledValue(config.autoProtect);

  if (!autoProtect) {
    showExtensionToast('La protección automática está desactivada en la extensión.', 'info');
    return;
  }

  // Visual loading state
  shieldButton.innerHTML = '⚡';
  shieldButton.style.borderRadius = '50%';
  shieldButton.style.background = '#d90000';
  shieldButton.style.boxShadow = '0 0 12px rgba(217, 0, 0, 0.7)';

  try {
    const data = await secureAnonymize(originalText, password);
    
    // Save transaction ref in memory to associate replies
    if (data.anon_ref) {
      lastAnonymizationRef = data.anon_ref;
    }

    // Framework-safe (React/Vue) values replacement
    setInputValueReactSafe(inputField, data.anonymizedText);

    if (data.isOffline) {
      showExtensionToast('Protección local autónoma completada (Offline).', 'success');
    } else {
      showExtensionToast('Prompt Protegido con Placeholders Consistentes.', 'success');
    }
    
    shieldButton.innerHTML = '✓';
    shieldButton.style.borderRadius = '50%';
    shieldButton.style.background = '#10b981';
    shieldButton.style.boxShadow = '0 0 12px #10b981';

    setTimeout(() => {
      shieldButton.innerHTML = defaultShieldIconHtml;
      shieldButton.style.background = 'transparent';
      shieldButton.style.boxShadow = 'none';
      shieldButton.style.borderRadius = '0';
    }, 2000);

  } catch (err) {
    showExtensionToast(err.message || 'Error al proteger el prompt.', 'error');
    shieldButton.innerHTML = '❌';
    shieldButton.style.borderRadius = '50%';
    shieldButton.style.background = '#f43f5e';
    shieldButton.style.boxShadow = '0 0 12px #f43f5e';
    
    setTimeout(() => {
      shieldButton.innerHTML = defaultShieldIconHtml;
      shieldButton.style.background = 'transparent';
      shieldButton.style.boxShadow = 'none';
      shieldButton.style.borderRadius = '0';
    }, 2000);
  }
}

/**
 * Framework-safe input/contenteditable content replacement
 * Bypasses React 16+ setter overlays and simulates user input keystrokes securely
 */
function setInputValueReactSafe(inputField, value) {
  const isContentEditable = inputField.getAttribute('contenteditable') === 'true' || inputField.getAttribute('role') === 'textbox';
  
  if (isContentEditable) {
    inputField.focus();
    
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(inputField);
      selection.removeAllRanges();
      selection.addRange(range);
      
      try {
        // Document insertText command updates framework bindings perfectly
        document.execCommand('delete', false);
        document.execCommand('insertText', false, value);
      } catch (err) {
        console.warn('execCommand failed, falling back to direct innerText assignment', err);
        inputField.innerText = value;
      }
    } else {
      inputField.innerText = value;
    }
    
    inputField.dispatchEvent(new Event('input', { bubbles: true }));
    inputField.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    // For normal textareas
    try {
      const prototype = Object.getPrototypeOf(inputField);
      const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set ||
                          Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set ||
                          Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      
      if (valueSetter) {
        valueSetter.call(inputField, value);
      } else {
        inputField.value = value;
      }
    } catch (e) {
      inputField.value = value;
    }
    
    inputField.dispatchEvent(new Event('input', { bubbles: true }));
    inputField.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

// ==========================================
// 2. INJECT DE-ANONYMIZE RESPONSE SHIELD TOGGLE BUTTONS
// ==========================================
function injectInlineShieldButtons() {
  if (isContextInvalidated()) return;
  if (!extensionInitialized) return;
  if (!autoProtectEnabledCache) return;
  
  // Find all elements containing the [Referencia: UUID] footer
  const elements = document.querySelectorAll('p, span, div.markdown, div.message-bubble, div.font-claude-message');
  const refRegex = /\[Referencia:\s*([a-f0-9\-]{36})\]/i;
  
  for (const el of elements) {
    if (el.children.length > 3) continue; // target deepest nodes to avoid breaking main container structures
    if (el.dataset.animaeShieldInjected === 'true') continue;
    
    const text = el.innerText || '';
    const match = text.match(refRegex);
    
    if (match) {
      const anonRef = match[1];
      el.dataset.animaeShieldInjected = 'true';
      
      // Determine the main parent message bubble container
      const messageBubble = el.closest('div.markdown, div.message-bubble, div.font-claude-message, article, div.chat-message, div.talk-block') || el.parentElement || el;
      
      // Mark the message bubble container
      messageBubble.dataset.animaeMessageBubble = 'true';
      messageBubble.dataset.animaeAnonRef = anonRef;
      if (!messageBubble.dataset.animaeState) {
        messageBubble.dataset.animaeState = 'anonymized';
      }
      
      // Attach a single delegated listener if not already done
      if (!messageBubble.dataset.animaeListenerAttached) {
        messageBubble.dataset.animaeListenerAttached = 'true';
        messageBubble.addEventListener('click', async (e) => {
          const btn = e.target.closest('.animae-inline-shield-btn');
          if (btn) {
            e.preventDefault();
            e.stopPropagation();
            await toggleMessageBubbleState(messageBubble, btn);
          }
        });
      }
      
      // Build premium miniature inline shield button HTML to place right inside the reference brackets
      const shieldBtnHtml = `
        <button class="animae-inline-shield-btn" data-ref="${anonRef}" title="Revelar datos originales (Toggle)" style="
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          background: rgba(0, 191, 243, 0.12) !important;
          border: 1px solid rgba(0, 191, 243, 0.35) !important;
          border-radius: 4px !important;
          padding: 1px 5px !important;
          margin-left: 6px !important;
          margin-right: 2px !important;
          cursor: pointer !important;
          vertical-align: middle !important;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
          box-shadow: 0 1px 2px rgba(0,0,0,0.15) !important;
          color: #00bff3 !important;
          font-family: inherit !important;
          font-size: 10px !important;
          font-weight: 600 !important;
          line-height: 1 !important;
        ">
          <img src="${chrome.runtime.getURL('icons/icon-pro-48.png')}" style="
            width: 12px !important;
            height: 12px !important;
            display: inline-block !important;
            vertical-align: middle !important;
            margin-right: 3px !important;
            pointer-events: none !important;
          " alt="Ae" />
          <span style="pointer-events: none !important; font-size: 9px !important; font-family: 'Inter', system-ui, sans-serif !important;">DLP</span>
        </button>
      `;
      
      // Place the button inside the reference bracket block: [Referencia: UUID <button>...]
      const originalHtml = el.innerHTML;
      const replacedHtml = originalHtml.replace(
        /(\[Referencia:\s*[a-f0-9\-]{36})(\])/i,
        `$1${shieldBtnHtml.trim()}$2`
      );
      
      el.innerHTML = replacedHtml;
    }
  }
}

/**
 * High-precision Node Walker to replace placeholder strings inside DOM Text Nodes only,
 * completely preserving all surrounding HTML tags, classes, and styles.
 */
function performMappingReplacements(element, mapping) {
  const walk = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
  let node;
  while (node = walk.nextNode()) {
    if (node.parentElement && (
      node.parentElement.closest('.animae-inline-shield-btn') || 
      node.parentElement.tagName === 'SCRIPT' || 
      node.parentElement.tagName === 'STYLE'
    )) {
      continue;
    }
    
    let text = node.nodeValue;
    let replaced = false;
    for (const [placeholder, originalValue] of Object.entries(mapping)) {
      if (text.includes(placeholder)) {
        text = text.replaceAll(placeholder, originalValue);
        replaced = true;
      }
    }
    if (replaced) {
      node.nodeValue = text;
    }
  }
}

/**
 * Handles the state switching toggle (Anonymized <--> Restored) inside a message bubble container
 */
async function toggleMessageBubbleState(messageBubble, btn) {
  if (isContextInvalidated()) return;
  
  const anonRef = messageBubble.dataset.animaeAnonRef;
  const currentState = messageBubble.dataset.animaeState || 'anonymized';
  
  // Cache the original anonymized HTML (with the shield button inside)
  if (!messageBubble._animaeAnonymizedHTML) {
    messageBubble._animaeAnonymizedHTML = messageBubble.innerHTML;
  }
  
  if (currentState === 'restored') {
    // Switch to ANONYMIZED state
    messageBubble.innerHTML = messageBubble._animaeAnonymizedHTML;
    messageBubble.dataset.animaeState = 'anonymized';
    
    // Find the re-rendered button and style it back
    const activeBtn = messageBubble.querySelector('.animae-inline-shield-btn');
    if (activeBtn) {
      activeBtn.title = 'Revelar datos originales (Toggle)';
      activeBtn.style.background = 'rgba(0, 191, 243, 0.12)';
      activeBtn.style.borderColor = 'rgba(0, 191, 243, 0.35)';
      activeBtn.style.color = '#00bff3';
    }
    
    showExtensionToast('Respuesta protegida (Anónima).', 'info');
    return;
  }
  
  // Switch to RESTORED state
  if (messageBubble._animaeRestoredHTML) {
    messageBubble.innerHTML = messageBubble._animaeRestoredHTML;
    messageBubble.dataset.animaeState = 'restored';
    showExtensionToast('Datos originales revelados.', 'success');
    return;
  }
  
  // First time click: Retrieve password and fetch de-anonymization mapping
  btn.innerHTML = `
    <span style="font-size: 8px; margin-right: 4px; display: inline-block; animation: animae-spin 1s linear infinite;">⚡</span>
    <span>Cargando...</span>
  `;
  btn.style.background = 'rgba(139, 92, 246, 0.2)';
  btn.style.borderColor = 'rgba(139, 92, 246, 0.5)';
  btn.style.color = '#d8b4fe';
  
  try {
    const config = await chrome.storage.local.get(['masterPassword']);
    const password = config.masterPassword || 'ClavePrivadaAnimAE123!';
    
    // Extract the text of the message bubble (excluding the shield button tag content)
    const clone = messageBubble.cloneNode(true);
    const btnInClone = clone.querySelector('.animae-inline-shield-btn');
    if (btnInClone) btnInClone.remove();
    const anonymizedText = clone.innerText;
    
    const data = await secureDeanonymize(anonRef, password, anonymizedText);
    
    if (!data.mapping || Object.keys(data.mapping).length === 0) {
      throw new Error('No se encontraron mapas de datos para esta transacción');
    }
    
    // Clone our current DOM, replace placeholders structure-safely using Node Walker, and cache HTML
    const restoredClone = messageBubble.cloneNode(true);
    performMappingReplacements(restoredClone, data.mapping);
    
    // Update button visual state inside the restored clone
    const restoredBtn = restoredClone.querySelector('.animae-inline-shield-btn');
    if (restoredBtn) {
      restoredBtn.title = 'Mostrar versión protegida (Toggle)';
      restoredBtn.style.background = 'rgba(16, 185, 129, 0.2)' ;
      restoredBtn.style.borderColor = 'rgba(16, 185, 129, 0.5)';
      restoredBtn.style.color = '#10b981';
      restoredBtn.innerHTML = `
        <img src="${chrome.runtime.getURL('icons/icon-pro-48.png')}" style="
          width: 12px;
          height: 12px;
          display: inline-block;
          vertical-align: middle;
          margin-right: 3px;
          pointer-events: none;
        " alt="Ae" />
        <span style="pointer-events: none; font-size: 9px; font-family: 'Inter', system-ui, sans-serif;">Revelado</span>
      `;
    }
    
    // Cache and apply the restored state
    messageBubble._animaeRestoredHTML = restoredClone.innerHTML;
    messageBubble.innerHTML = messageBubble._animaeRestoredHTML;
    messageBubble.dataset.animaeState = 'restored';
    
    showExtensionToast('Datos originales revelados con éxito.', 'success');
    
  } catch (err) {
    showExtensionToast(err.message || 'Error al restaurar valores.', 'error');
    
    // Reset button to error/retry state
    btn.innerHTML = `
      <img src="${chrome.runtime.getURL('icons/icon-pro-48.png')}" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle; margin-right: 3px;" alt="Ae PRO" />
      <span style="font-size: 9px;">Falló</span>
    `;
    btn.style.background = 'rgba(244, 63, 94, 0.15)';
    btn.style.borderColor = 'rgba(244, 63, 94, 0.45)';
    btn.style.color = '#f43f5e';
    
    setTimeout(() => {
      btn.innerHTML = `
        <img src="${chrome.runtime.getURL('icons/icon-pro-48.png')}" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle; margin-right: 3px;" alt="Ae PRO" />
        <span style="font-size: 9px;">DLP</span>
      `;
      btn.style.background = 'rgba(0, 191, 243, 0.12)';
      btn.style.borderColor = 'rgba(0, 191, 243, 0.35)';
      btn.style.color = '#00bff3';
    }, 3000);
  }
}

// ==========================================
// 3. FILE ATTACHMENTS UPLOAD INTERCEPTION
// ==========================================

// Intercept files selected via file upload dialogs (capturing change event)
document.addEventListener('change', async function(e) {
  if (isContextInvalidated()) return;
  if (isInterceptionDeniedPage()) return;
  if (!autoProtectEnabledCache) return;
  const target = e.target;
  if (!target || target.tagName !== 'INPUT' || target.type !== 'file') return;
  
  // Skip if already processing or empty
  if (target.dataset.anoniProcessing || !target.files || target.files.length === 0) return;
  
  // Intercept the upload event entirely
  e.stopImmediatePropagation();
  e.preventDefault();
  
  target.dataset.anoniProcessing = 'true';
  
  try {
    const originalFiles = Array.from(target.files);
    showExtensionToast(`DLP Shield: Analizando ${originalFiles.length} archivo(s)...`, 'info');
    
    const config = await chrome.storage.local.get(['masterPassword', 'autoProtect']);
    const password = config.masterPassword || 'ClavePrivadaAnimAE123!';
    
    const anonymizedFiles = [];
    
    for (const file of originalFiles) {
      const ext = file.name.split('.').pop().toLowerCase();
      const isBinary = ['docx', 'xlsx', 'xls', 'pdf'].includes(ext);
      
      let fileContent;
      if (isBinary) {
        fileContent = await readFileAsBase64(file);
      } else {
        fileContent = await readFileAsText(file);
      }
      
      const data = await secureAnonymize(fileContent, password, ext);
      
      let anonymizedBlob;
      let newFileName = file.name;
      
      if (isBinary) {
        let base64Data = data.anonymizedText;
        let footerIndex = base64Data.indexOf('\n\n[Referencia:');
        if (footerIndex === -1) {
          footerIndex = base64Data.indexOf('\n\n# ANON_REF:');
        }
        if (footerIndex !== -1) {
          base64Data = base64Data.substring(0, footerIndex).trim();
        }
        
        if (ext === 'pdf') {
          // Plaintext PDF text extraction is returned, package as txt
          anonymizedBlob = new Blob([data.anonymizedText], { type: 'text/plain;charset=utf-8' });
          newFileName = file.name.replace(/\.pdf$/i, '_anonimizado.txt');
        } else {
          // Excel or Word Document rebuild
          anonymizedBlob = base64ToBlob(base64Data, file.type || 'application/octet-stream');
        }
      } else {
        // Plaintext files
        anonymizedBlob = new Blob([data.anonymizedText], { type: file.type || 'text/plain;charset=utf-8' });
      }
      
      const anonymizedFile = new File([anonymizedBlob], newFileName, { type: anonymizedBlob.type });
      anonymizedFiles.push(anonymizedFile);
    }
    
    // Inject anonymized file list into the file upload DOM input using DataTransfer
    const dt = new DataTransfer();
    anonymizedFiles.forEach(f => dt.items.add(f));
    target.files = dt.files;
    
    showExtensionToast('¡Archivos protegidos localmente con éxito antes de subir!', 'success');
    
    // Trigger React/Vue bindings to consume anonymized files
    target.dispatchEvent(new Event('change', { bubbles: true }));
    
  } catch (err) {
    showExtensionToast(err.message || 'Error de conexión. Carga cancelada.', 'error');
    // Clear files to block un-anonymized data leak
    target.value = '';
    target.dispatchEvent(new Event('change', { bubbles: true }));
  } finally {
    delete target.dataset.anoniProcessing;
  }
}, true);

// Intercept drag-and-drop file drop events on the document
document.addEventListener('drop', async function(e) {
  if (isContextInvalidated()) return;
  if (isInterceptionDeniedPage()) return;
  if (!autoProtectEnabledCache) return;
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    if (e.target && e.target.dataset.anoniProcessingDrop) return;
    
    e.stopImmediatePropagation();
    e.preventDefault();
    
    const target = e.target;
    target.dataset.anoniProcessingDrop = 'true';
    
    try {
      const originalFiles = Array.from(e.dataTransfer.files);
      showExtensionToast(`Drag Interceptado: Analizando ${originalFiles.length} archivo(s)...`, 'info');
      
      const config = await chrome.storage.local.get(['masterPassword', 'autoProtect']);
      const password = config.masterPassword || 'ClavePrivadaAnimAE123!';
      
      const anonymizedFiles = [];
      
      for (const file of originalFiles) {
        const ext = file.name.split('.').pop().toLowerCase();
        const isBinary = ['docx', 'xlsx', 'xls', 'pdf'].includes(ext);
        
        let fileContent;
        if (isBinary) {
          fileContent = await readFileAsBase64(file);
        } else {
          fileContent = await readFileAsText(file);
        }
        
        const data = await secureAnonymize(fileContent, password, ext);
        
        let anonymizedBlob;
        let newFileName = file.name;
        
        if (isBinary) {
          let base64Data = data.anonymizedText;
          let footerIndex = base64Data.indexOf('\n\n[Referencia:');
          if (footerIndex === -1) {
            footerIndex = base64Data.indexOf('\n\n# ANON_REF:');
          }
          if (footerIndex !== -1) {
            base64Data = base64Data.substring(0, footerIndex).trim();
          }
          
          if (ext === 'pdf') {
            anonymizedBlob = new Blob([data.anonymizedText], { type: 'text/plain;charset=utf-8' });
            newFileName = file.name.replace(/\.pdf$/i, '_anonimizado.txt');
          } else {
            anonymizedBlob = base64ToBlob(base64Data, file.type || 'application/octet-stream');
          }
        } else {
          anonymizedBlob = new Blob([data.anonymizedText], { type: file.type || 'text/plain;charset=utf-8' });
        }
        
        const anonymizedFile = new File([anonymizedBlob], newFileName, { type: anonymizedBlob.type });
        anonymizedFiles.push(anonymizedFile);
      }
      
      showExtensionToast('¡Archivos arrastrados protegidos con éxito!', 'success');
      
      // Dispatch new drop event containing anonymized files to site
      dispatchSyntheticDrop(target, anonymizedFiles);
      
    } catch (err) {
      showExtensionToast(err.message || 'Error de conexión. Drop abortado.', 'error');
    } finally {
      delete target.dataset.anoniProcessingDrop;
    }
  }
}, true);

// ==========================================
// FILE INTERCEPTION HELPERS
// ==========================================

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function base64ToBlob(base64, mimeType = '') {
  const byteCharacters = atob(base64);
  const byteArrays = [];
  
  for (let offset = 0; offset < byteCharacters.length; offset += 512) {
    const slice = byteCharacters.slice(offset, offset + 512);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    byteArrays.push(byteArray);
  }
  
  return new Blob(byteArrays, { type: mimeType });
}

function dispatchSyntheticDrop(target, files) {
  const dt = new DataTransfer();
  files.forEach(f => dt.items.add(f));
  
  const dropEvent = new DragEvent('drop', {
    bubbles: true,
    cancelable: true,
    dataTransfer: dt
  });
  
  target.dispatchEvent(dropEvent);
}

// ==========================================
// 4. INJECTED UTILS: DYNAMIC TOASTS
// ==========================================
function showExtensionToast(message, type = 'info') {
  const theme = getInjectedThemeTokens();
  let container = document.getElementById('anoni-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'anoni-toast-container';
    container.style.cssText = `
      position: fixed !important;
      top: 24px !important;
      right: 24px !important;
      z-index: 100000 !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 10px !important;
    `;
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  
  let leftBorderColor = '#00bff3';
  if (type === 'success') leftBorderColor = '#10b981';
  if (type === 'error') leftBorderColor = '#f43f5e';

  toast.style.cssText = `
    background: ${theme.panel} !important;
    backdrop-filter: blur(12px) !important;
    border: 1px solid ${theme.border} !important;
    border-left: 4px solid ${leftBorderColor} !important;
    border-radius: 8px !important;
    padding: 12px 20px !important;
    color: ${theme.text} !important;
    font-size: 12px !important;
    font-family: 'Inter', sans-serif !important;
    font-weight: 500 !important;
    box-shadow: ${theme.shadow} !important;
    min-width: 250px !important;
    transform: translateX(120%) !important;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
  `;

  toast.textContent = `🛡️ ${message}`;
  container.appendChild(toast);

  // Animate in
  setTimeout(() => {
    toast.style.transform = 'translateX(0)';
  }, 10);

  // Animate out
  setTimeout(() => {
    toast.style.transform = 'translateX(120%)';
    toast.addEventListener('transitionend', () => {
      toast.remove();
    });
  }, 4000);
}
