// ==========================================================================
// EXTENSION POPUP CONTROLLER - AnonimAE
// ==========================================================================

// Global state for domain lists
let interceptedDomains = [];
let excludedDomains = [];
let currentActiveDomain = '';
const THEME_STORAGE_KEY = 'themePreference';
const DEFAULT_THEME = 'system';
const THEME_SEQUENCE = ['system', 'dark', 'light'];
const THEME_META = {
  system: {
    label: 'Sistema',
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"></rect><path d="M8 20h8"></path><path d="M12 16v4"></path></svg>'
  },
  dark: {
    label: 'Oscuro',
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A8 8 0 1 1 11.2 3 6.3 6.3 0 0 0 21 12.8z"></path></svg>'
  },
  light: {
    label: 'Claro',
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg>'
  }
};
const LOCAL_PROFILES_STORAGE_KEY = 'localDetectionProfiles';
const ACTIVE_PROFILE_STORAGE_KEY = 'activeDetectionProfile';
const ENTITY_TOGGLES_STORAGE_KEY = 'consoleEntityToggles';
const AI_ENGINE_STORAGE_KEY = 'aiEnginePreference';
const AI_PROVIDER_CONFIGS_STORAGE_KEY = 'aiProviderConfigs';
const DEFAULT_AI_ENGINE = 'none';
const DEFAULT_LOCAL_PROFILES = [
  {
    id: 'rules-core',
    name: 'Reglas PRO',
    builtin: true,
    description: 'Motor local base con regex, diccionarios y cifrado AES-GCM.'
  },
  {
    id: 'legal-es',
    name: 'Jurídico ES',
    builtin: true,
    description: 'Perfil local orientado a autos, diligencias, DNIs, IBAN y datos personales.'
  },
  {
    id: 'enterprise-es',
    name: 'Empresa ES',
    builtin: true,
    description: 'Perfil local para prompts corporativos con personas, empresas, emails y teléfonos.'
  }
];
const AI_ENGINE_OPTIONS = [
  {
    id: 'none',
    label: 'DLP local',
    compactLabel: 'Local',
    type: 'local',
    auth: 'none',
    defaultUrl: '',
    defaultModel: 'Reglas PRO',
    chip: 'Local',
    status: 'Reglas locales activas. Sin envío a modelos.'
  },
  {
    id: 'webgpu-local',
    label: 'WebGPU local',
    compactLabel: 'WebGPU',
    type: 'webgpu',
    auth: 'none',
    defaultUrl: '',
    defaultModel: 'onnx-community/Llama-3.2-1B-Instruct',
    chip: 'WebGPU',
    status: 'Preparado para IA local; reglas activas como respaldo.'
  },
  {
    id: 'ollama-local',
    label: 'Ollama local',
    compactLabel: 'Ollama',
    type: 'ollama',
    auth: 'none',
    defaultUrl: 'http://localhost:11434',
    defaultModel: 'llama3.1',
    chip: 'Local',
    status: 'Conector local para Ollama tras anonimizar.'
  },
  {
    id: 'lmstudio-local',
    label: 'LM Studio',
    compactLabel: 'LM Studio',
    type: 'openai',
    auth: 'none',
    defaultUrl: 'http://localhost:1234/v1',
    defaultModel: '',
    chip: 'Local',
    status: 'Endpoint local compatible con OpenAI.'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    compactLabel: 'OpenRouter',
    type: 'openai',
    auth: 'apikey',
    defaultUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'google/gemma-3-27b-it',
    chip: 'Cloud',
    status: 'Proveedor cloud configurable con DLP previo.'
  },
  {
    id: 'groq',
    label: 'Groq',
    compactLabel: 'Groq',
    type: 'openai',
    auth: 'apikey',
    defaultUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    chip: 'Cloud',
    status: 'Proveedor cloud rápido con API key local.'
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    compactLabel: 'Gemini',
    type: 'gemini',
    auth: 'apikey',
    defaultUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
    chip: 'Cloud',
    status: 'Proveedor Gemini configurable.'
  },
  {
    id: 'claude',
    label: 'Claude',
    compactLabel: 'Claude',
    type: 'anthropic',
    auth: 'apikey',
    defaultUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-20250514',
    chip: 'Cloud',
    status: 'Proveedor Anthropic configurable.'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    compactLabel: 'OpenAI',
    type: 'openai',
    auth: 'apikey',
    defaultUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1',
    chip: 'Cloud',
    status: 'Proveedor OpenAI configurable.'
  }
];
const systemThemeQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function normalizeThemePreference(value) {
  return ['system', 'dark', 'light'].includes(value) ? value : DEFAULT_THEME;
}

function getNextThemePreference(value) {
  const current = normalizeThemePreference(value);
  const index = THEME_SEQUENCE.indexOf(current);
  return THEME_SEQUENCE[(index + 1) % THEME_SEQUENCE.length];
}

function renderThemeControls(preference) {
  const normalized = normalizeThemePreference(preference);
  const meta = THEME_META[normalized] || THEME_META.system;

  document.querySelectorAll('.theme-option').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.themeOption === normalized);
  });

  document.querySelectorAll('[data-theme-cycle]').forEach((btn) => {
    btn.dataset.themeCurrent = normalized;
    btn.title = `Tema: ${meta.label}`;
    btn.setAttribute('aria-label', `Tema actual: ${meta.label}. Cambiar tema.`);
    btn.innerHTML = `<span class="theme-cycle-icon">${meta.icon}</span><span class="theme-cycle-label">${meta.label}</span>`;
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeProfileId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function normalizeAiEnginePreference(value) {
  return AI_ENGINE_OPTIONS.some((option) => option.id === value) ? value : DEFAULT_AI_ENGINE;
}

function uniqueProfiles(profiles) {
  const seen = new Set();
  return (Array.isArray(profiles) ? profiles : []).filter((profile) => {
    if (!profile || typeof profile !== 'object') return false;
    const id = normalizeProfileId(profile.id);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    profile.id = id;
    profile.name = String(profile.name || id).trim().slice(0, 80);
    profile.description = String(profile.description || 'Perfil local personalizado.').trim().slice(0, 180);
    return true;
  });
}

function getProfileRulePreset(profileId) {
  if (profileId === 'legal-es') {
    return ['email', 'telefono', 'fax', 'dni', 'iban', 'tarjeta', 'juridico', 'diligencias', 'codigo_postal', 'pasaporte', 'nombre', 'organizacion', 'direccion'];
  }
  if (profileId === 'enterprise-es') {
    return ['email', 'telefono', 'iban', 'tarjeta', 'nombre', 'organizacion', 'direccion', 'codigo_postal'];
  }
  return null;
}

function buildProfileTogglePreset(profileId, rules) {
  const preset = getProfileRulePreset(profileId);
  const entities = ((rules && rules.entities) || []).map((entity) => entity.id).filter(Boolean);
  if (!preset || entities.length === 0) return null;

  return entities.reduce((next, entityId) => {
    next[entityId] = preset.includes(entityId);
    return next;
  }, {});
}

function getAiEngineOption(value) {
  const normalized = normalizeAiEnginePreference(value);
  return AI_ENGINE_OPTIONS.find((option) => option.id === normalized) || AI_ENGINE_OPTIONS[0];
}

function applyThemePreference(preference) {
  const normalized = normalizeThemePreference(preference);
  document.documentElement.dataset.theme = normalized;
  renderThemeControls(normalized);
}

async function initThemePreference() {
  const data = await chrome.storage.local.get([THEME_STORAGE_KEY]);
  const preference = normalizeThemePreference(data[THEME_STORAGE_KEY]);

  if (!data[THEME_STORAGE_KEY]) {
    await chrome.storage.local.set({ [THEME_STORAGE_KEY]: DEFAULT_THEME });
  }

  applyThemePreference(preference);
}

document.addEventListener('DOMContentLoaded', async () => {
  displayExtensionVersion();
  await initThemePreference();
  // Load saved configurations and domains
  await loadSettings();
  await loadEnginePreferences();
  await loadDomains();
  
  await checkAutonomousEngineHealth();
  await renderQuickMetrics();

  // Query active tab domain
  await queryActiveTabDomain();

  // Setup tab switcher navigation
  initTabNavigation();

  // Setup event listeners
  initEventListeners();
});

/**
 * Loads configurations securely from Chrome Extension storage
 */
async function loadSettings() {
  try {
    const data = await chrome.storage.local.get(['masterPassword', 'autoProtect']);
    
    // Set default values if not defined
    if (data.masterPassword !== undefined) {
      document.getElementById('master-password').value = data.masterPassword;
    }
    
    if (data.autoProtect !== undefined) {
      document.getElementById('auto-protect-toggle').checked = data.autoProtect;
      await updateToolbarIcon(data.autoProtect);
    } else {
      document.getElementById('auto-protect-toggle').checked = true;
      await chrome.storage.local.set({ autoProtect: true });
      await updateToolbarIcon(true);
    }
  } catch (err) {
    console.error('Failed to load storage settings:', err);
  }
}

async function getLocalProfiles() {
  const data = await chrome.storage.local.get([LOCAL_PROFILES_STORAGE_KEY]);
  const stored = Array.isArray(data[LOCAL_PROFILES_STORAGE_KEY]) ? data[LOCAL_PROFILES_STORAGE_KEY] : [];
  const builtins = DEFAULT_LOCAL_PROFILES.map((profile) => ({ ...profile }));
  const custom = stored.filter((profile) => !DEFAULT_LOCAL_PROFILES.some((item) => item.id === profile.id));
  return uniqueProfiles([...builtins, ...custom]);
}

async function loadEnginePreferences() {
  const profileSelect = document.getElementById('select-anonymization-engine');
  const aiSelect = document.getElementById('select-ai-engine');
  if (!profileSelect || !aiSelect) return;

  const profiles = await getLocalProfiles();
  const data = await chrome.storage.local.get([ACTIVE_PROFILE_STORAGE_KEY, AI_ENGINE_STORAGE_KEY]);
  const requestedProfile = normalizeProfileId(data[ACTIVE_PROFILE_STORAGE_KEY]);
  const activeProfileId = profiles.some((profile) => profile.id === requestedProfile)
    ? requestedProfile
    : DEFAULT_LOCAL_PROFILES[0].id;
  const aiEngine = normalizeAiEnginePreference(data[AI_ENGINE_STORAGE_KEY]);

  profileSelect.innerHTML = profiles
    .map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)}</option>`)
    .join('');
  aiSelect.innerHTML = AI_ENGINE_OPTIONS
    .map((option) => `<option value="${escapeHtml(option.id)}">${escapeHtml(option.label)}</option>`)
    .join('');
  profileSelect.value = activeProfileId;
  aiSelect.value = aiEngine;
  renderEngineSummary(activeProfileId, aiEngine);

  const updates = {};
  if (data[ACTIVE_PROFILE_STORAGE_KEY] !== activeProfileId) updates[ACTIVE_PROFILE_STORAGE_KEY] = activeProfileId;
  if (data[AI_ENGINE_STORAGE_KEY] !== aiEngine) updates[AI_ENGINE_STORAGE_KEY] = aiEngine;
  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
}

function renderEngineSummary(profileId, aiEngine) {
  const chip = document.getElementById('engine-mode-chip');
  const status = document.getElementById('engine-status-line');
  const profile = DEFAULT_LOCAL_PROFILES.find((item) => item.id === profileId);
  const aiOption = getAiEngineOption(aiEngine);

  if (chip) chip.textContent = aiOption.chip;
  if (status) {
    const profileName = profile ? profile.name : 'Perfil personalizado';
    status.textContent = `${profileName}. ${aiOption.status}`;
  }
}

async function persistActiveEngineProfile(profileId) {
  const normalizedProfile = normalizeProfileId(profileId) || DEFAULT_LOCAL_PROFILES[0].id;
  const updates = { [ACTIVE_PROFILE_STORAGE_KEY]: normalizedProfile };

  try {
    const rulesData = await chrome.storage.local.get(['cachedRules']);
    const toggles = buildProfileTogglePreset(normalizedProfile, rulesData.cachedRules);
    if (toggles) updates[ENTITY_TOGGLES_STORAGE_KEY] = toggles;
  } catch (err) {
    console.warn('No se pudo preparar el preset del perfil local:', err);
  }

  await chrome.storage.local.set(updates);
}

/**
 * Loads intercepted and excluded domains lists from storage
 */
async function loadDomains() {
  try {
    const data = await chrome.storage.local.get(['interceptedDomains', 'excludedDomains']);
    
    // 1. Intercepted Domains
    if (data.interceptedDomains !== undefined && Array.isArray(data.interceptedDomains)) {
      interceptedDomains = data.interceptedDomains;
    } else {
      // Default AI seed list
      interceptedDomains = [
        'chatgpt.com',
        'claude.ai',
        'deepseek.com',
        'gemini.google.com',
        'copilot.microsoft.com',
        'perplexity.ai',
        'poe.com',
        'huggingface.co',
        'groq.com',
        'mistral.ai'
      ];
      await chrome.storage.local.set({ interceptedDomains });
    }

    // 2. Excluded Domains
    if (data.excludedDomains !== undefined && Array.isArray(data.excludedDomains)) {
      excludedDomains = data.excludedDomains;
    } else {
      excludedDomains = [];
      await chrome.storage.local.set({ excludedDomains });
    }

    renderDomainsList();
    renderExcludedList();
  } catch (err) {
    console.error('Failed to load domains data:', err);
  }
}

/**
 * Validates the autonomous browser engine and local rules bundle.
 */
async function checkAutonomousEngineHealth() {
  const statusEl = document.getElementById('connection-status');
  const accelEl = document.getElementById('hardware-acc');

  try {
    const rulesUrl = chrome.runtime.getURL('lib/default_rules.json');
    const response = await fetch(rulesUrl);
    if (!response.ok) throw new Error('Rules unavailable');
    const rulesData = await response.json();
    await chrome.storage.local.set({ cachedRules: rulesData });

    statusEl.textContent = 'Listo';
    statusEl.className = 'badge badge-online';
    accelEl.textContent = 'Reglas, AES y archivos listos en local.';

  } catch (err) {
    statusEl.textContent = 'Revisar';
    statusEl.className = 'badge badge-offline';
    accelEl.textContent = 'No se cargaron las reglas locales.';
  }
}

async function renderQuickMetrics() {
  try {
    const allStore = await chrome.storage.local.get(null);
    const mapCount = Object.keys(allStore).filter((key) => key.startsWith('map_')).length;
    const logs = allStore.offlineAuditLogs || [];
    const rules = allStore.cachedRules || {};

    const mapEl = document.getElementById('map-count');
    const logEl = document.getElementById('log-count');
    const rulesEl = document.getElementById('rules-count');

    if (mapEl) mapEl.textContent = mapCount;
    if (logEl) logEl.textContent = logs.length;
    if (rulesEl) rulesEl.textContent = (rules.entities || []).length;
  } catch (err) {
    console.error('Failed to render local metrics:', err);
  }
}

/**
 * Switch tabs navigation panel dynamically
 */
function initTabNavigation() {
  const tabButtons = document.querySelectorAll('.tab-btn[data-tab]');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      
      // Toggle active states on buttons
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Toggle active states on contents
      tabContents.forEach(content => {
        if (content.id === targetTab) {
          content.classList.add('active');
        } else {
          content.classList.remove('active');
        }
      });
    });
  });
}

/**
 * Resolves the active tab's domain to allow one-click dynamic interception
 */
async function queryActiveTabDomain() {
  const domainLabel = document.getElementById('current-tab-domain');
  const actionButton = document.getElementById('btn-toggle-current-site');
  const excludeButton = document.getElementById('btn-exclude-current-site');

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
      domainLabel.textContent = 'Sin pestaña';
      return;
    }

    const urlStr = tabs[0].url;
    if (!urlStr) {
      domainLabel.textContent = 'Página vacía';
      return;
    }

    // Parse domain
    const url = new URL(urlStr);
    const host = url.hostname.toLowerCase().trim();

    // Check if it is a standard web page (ignore browser internal pages)
    if (!['http:', 'https:'].includes(url.protocol) || host === 'localhost' || host === '127.0.0.1') {
      domainLabel.textContent = 'Página del Sistema';
      actionButton.disabled = true;
      actionButton.textContent = 'No disponible';
      if (excludeButton) {
        excludeButton.disabled = true;
        excludeButton.textContent = 'No disponible';
      }
      return;
    }

    currentActiveDomain = host;
    domainLabel.textContent = currentActiveDomain;
    actionButton.disabled = false;
    if (excludeButton) excludeButton.disabled = false;

    updateActiveTabButtonState();
  } catch (err) {
    console.error('Failed to parse active tab:', err);
    domainLabel.textContent = 'Error al detectar';
  }
}

/**
 * Updates button labels/colors based on current protection and exclusion status
 */
function updateActiveTabButtonState() {
  const actionButton = document.getElementById('btn-toggle-current-site');
  const excludeButton = document.getElementById('btn-exclude-current-site');
  if (!currentActiveDomain) return;

  const isProtected = interceptedDomains.some(dom => 
    currentActiveDomain === dom || currentActiveDomain.endsWith('.' + dom)
  );

  const isExcluded = excludedDomains.some(dom =>
    currentActiveDomain === dom || currentActiveDomain.endsWith('.' + dom)
  );

  if (isProtected) {
    actionButton.textContent = 'Quitar protección';
    actionButton.className = 'btn btn-add-site btn-remove';
    if (excludeButton) {
      excludeButton.textContent = 'Excluir sitio';
      excludeButton.className = 'btn btn-secondary';
    }
  } else if (isExcluded) {
    actionButton.textContent = 'Proteger sitio';
    actionButton.className = 'btn btn-add-site';
    if (excludeButton) {
      excludeButton.textContent = 'Quitar exclusión';
      excludeButton.className = 'btn btn-secondary is-active';
    }
  } else {
    actionButton.textContent = 'Proteger sitio';
    actionButton.className = 'btn btn-add-site';
    if (excludeButton) {
      excludeButton.textContent = 'Excluir sitio';
      excludeButton.className = 'btn btn-secondary';
    }
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes[THEME_STORAGE_KEY]) {
    applyThemePreference(changes[THEME_STORAGE_KEY].newValue);
  }

  if (changes[LOCAL_PROFILES_STORAGE_KEY] || changes[ACTIVE_PROFILE_STORAGE_KEY] || changes[AI_ENGINE_STORAGE_KEY]) {
    loadEnginePreferences().catch((err) => console.error('Failed to sync engine preferences:', err));
  }
});

/**
 * Renders list of protected domains with dynamic removal buttons
 */
function renderDomainsList() {
  const container = document.getElementById('domains-list-container');
  if (!container) return;

  if (interceptedDomains.length === 0) {
    container.innerHTML = `<div class="empty-list-message">Sin sitios protegidos.</div>`;
    return;
  }

  let html = '';
  const sorted = [...interceptedDomains].sort();
  sorted.forEach(dom => {
    const safeDomain = escapeHtml(dom);
    html += `
      <div class="domain-item">
        <span class="domain-name" title="${safeDomain}">${safeDomain}</span>
        <button class="btn-remove-domain" data-domain="${safeDomain}" title="Quitar sitio" aria-label="Quitar ${safeDomain}">×</button>
      </div>
    `;
  });

  container.innerHTML = html;

  // Bind trash icon click event
  const removeButtons = container.querySelectorAll('.btn-remove-domain');
  removeButtons.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const domainToRemove = btn.getAttribute('data-domain');
      await removeDomain(domainToRemove);
    });
  });
}

/**
 * Renders list of excluded domains with dynamic removal buttons
 */
function renderExcludedList() {
  const container = document.getElementById('excluded-list-container');
  if (!container) return;

  if (excludedDomains.length === 0) {
    container.innerHTML = `<div class="empty-list-message">Sin sitios excluidos.</div>`;
    return;
  }

  let html = '';
  const sorted = [...excludedDomains].sort();
  sorted.forEach(dom => {
    const safeDomain = escapeHtml(dom);
    html += `
      <div class="domain-item" style="border-left: 2px solid var(--accent-rose);">
        <span class="domain-name" title="${safeDomain}">${safeDomain}</span>
        <button class="btn-remove-domain btn-remove-domain-danger" data-domain="${safeDomain}" title="Quitar de excluidos" aria-label="Quitar ${safeDomain} de excluidos">×</button>
      </div>
    `;
  });

  container.innerHTML = html;

  // Bind trash icon click event
  const removeButtons = container.querySelectorAll('.btn-remove-domain');
  removeButtons.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const domainToRemove = btn.getAttribute('data-domain');
      await removeExcludedDomain(domainToRemove);
    });
  });
}

/**
 * Adds a new custom domain to storage lists
 */
async function addDomain(newDomain) {
  const clean = newDomain.toLowerCase().trim().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
  if (!clean || clean.length < 3 || !clean.includes('.')) {
    alert('Introduce un formato de dominio web válido (ej. miactual-ia.com)');
    return;
  }

  // Remove from excluded list if it was present
  excludedDomains = excludedDomains.filter(dom => dom !== clean);
  await chrome.storage.local.set({ excludedDomains });

  if (interceptedDomains.includes(clean)) {
    alert('Este sitio ya se encuentra protegido.');
    return;
  }

  interceptedDomains.push(clean);
  await chrome.storage.local.set({ interceptedDomains });
  
  renderDomainsList();
  renderExcludedList();
  updateActiveTabButtonState();
}

/**
 * Removes domain from interception allowed lists
 */
async function removeDomain(domainName) {
  interceptedDomains = interceptedDomains.filter(dom => dom !== domainName);
  await chrome.storage.local.set({ interceptedDomains });

  renderDomainsList();
  updateActiveTabButtonState();
}

/**
 * Removes domain from excluded lists
 */
async function removeExcludedDomain(domainName) {
  excludedDomains = excludedDomains.filter(dom => dom !== domainName);
  await chrome.storage.local.set({ excludedDomains });

  renderExcludedList();
  updateActiveTabButtonState();
}

/**
 * Configures actions and button event click listeners
 */
function initEventListeners() {
  const autoProtectToggle = document.getElementById('auto-protect-toggle');
  const passInput = document.getElementById('master-password');
  const profileSelect = document.getElementById('select-anonymization-engine');
  const aiSelect = document.getElementById('select-ai-engine');

  // Persist the main interception switch immediately so closing the popup cannot lose the state.
  autoProtectToggle.addEventListener('change', async () => {
    try {
      await chrome.storage.local.set({ autoProtect: autoProtectToggle.checked });
      await updateToolbarIcon(autoProtectToggle.checked);
      await notifyActiveTabAutoProtect(autoProtectToggle.checked);
    } catch (err) {
      console.error('Failed to persist auto protection state:', err);
    }
  });

  document.querySelectorAll('.theme-option').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const preference = normalizeThemePreference(btn.dataset.themeOption);
      applyThemePreference(preference);
      await chrome.storage.local.set({ [THEME_STORAGE_KEY]: preference });
    });
  });

  document.querySelectorAll('[data-theme-cycle]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const preference = getNextThemePreference(btn.dataset.themeCurrent);
      applyThemePreference(preference);
      await chrome.storage.local.set({ [THEME_STORAGE_KEY]: preference });
    });
  });

  if (profileSelect) {
    profileSelect.addEventListener('change', async () => {
      await persistActiveEngineProfile(profileSelect.value);
      renderEngineSummary(profileSelect.value, aiSelect ? aiSelect.value : DEFAULT_AI_ENGINE);
    });
  }

  if (aiSelect) {
    aiSelect.addEventListener('change', async () => {
      const preference = normalizeAiEnginePreference(aiSelect.value);
      aiSelect.value = preference;
      renderEngineSummary(profileSelect ? profileSelect.value : DEFAULT_LOCAL_PROFILES[0].id, preference);
      await chrome.storage.local.set({ [AI_ENGINE_STORAGE_KEY]: preference });
    });
  }

  const persistMasterPassword = debounce(async () => {
    try {
      await chrome.storage.local.set({ masterPassword: passInput.value });
      await renderQuickMetrics();
    } catch (err) {
      console.error('Failed to autosave master password:', err);
    }
  }, 250);

  passInput.addEventListener('input', persistMasterPassword);

  // Save Settings (Password & Auto-Protect toggles)
  const btnSave = document.getElementById('btn-save-settings');
  btnSave.addEventListener('click', async () => {
    const masterPassword = document.getElementById('master-password').value;
    const autoProtect = autoProtectToggle.checked;
    const activeProfile = normalizeProfileId(profileSelect ? profileSelect.value : DEFAULT_LOCAL_PROFILES[0].id) || DEFAULT_LOCAL_PROFILES[0].id;
    const aiEngine = normalizeAiEnginePreference(aiSelect ? aiSelect.value : DEFAULT_AI_ENGINE);

    btnSave.textContent = 'Guardando...';
    btnSave.disabled = true;

    try {
      await chrome.storage.local.set({ masterPassword, autoProtect, [AI_ENGINE_STORAGE_KEY]: aiEngine });
      await persistActiveEngineProfile(activeProfile);
      await updateToolbarIcon(autoProtect);
      await notifyActiveTabAutoProtect(autoProtect);
      await renderQuickMetrics();
      
      btnSave.textContent = 'Guardado';
      btnSave.style.background = '#22c55e';
      
      setTimeout(() => {
        btnSave.textContent = 'Guardar';
        btnSave.style.background = 'var(--accent-primary)';
        btnSave.disabled = false;
      }, 1500);
    } catch (err) {
      console.error('Failed to save settings:', err);
      btnSave.textContent = 'Error';
      btnSave.disabled = false;
    }
  });

  // Open internal autonomous dashboard.
  const btnOpenDashboard = document.getElementById('btn-open-dashboard');
  if (btnOpenDashboard) {
    btnOpenDashboard.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
    });
  }

  const btnOpenDashboardSettings = document.getElementById('btn-open-dashboard-settings');
  if (btnOpenDashboardSettings) {
    btnOpenDashboardSettings.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html#tab-settings') });
    });
  }

  // Toggle current active web page
  const btnToggleCurrent = document.getElementById('btn-toggle-current-site');
  btnToggleCurrent.addEventListener('click', async () => {
    if (!currentActiveDomain) return;

    const isProtected = interceptedDomains.some(dom => 
      currentActiveDomain === dom || currentActiveDomain.endsWith('.' + dom)
    );

    if (isProtected) {
      const matchedDomain = interceptedDomains.find(dom => 
        currentActiveDomain === dom || currentActiveDomain.endsWith('.' + dom)
      );
      await removeDomain(matchedDomain || currentActiveDomain);
    } else {
      await addDomain(currentActiveDomain);
    }
  });

  // Toggle current active web page exclusion
  const btnExcludeCurrent = document.getElementById('btn-exclude-current-site');
  if (btnExcludeCurrent) {
    btnExcludeCurrent.addEventListener('click', async () => {
      if (!currentActiveDomain) return;

      const isExcluded = excludedDomains.some(dom =>
        currentActiveDomain === dom || currentActiveDomain.endsWith('.' + dom)
      );

      if (isExcluded) {
        // Remove from excluded list
        const matchedDomain = excludedDomains.find(dom =>
          currentActiveDomain === dom || currentActiveDomain.endsWith('.' + dom)
        );
        await removeExcludedDomain(matchedDomain || currentActiveDomain);
      } else {
        // Add to excluded list, removing from protected if it was protected
        const matchedProtected = interceptedDomains.find(dom =>
          currentActiveDomain === dom || currentActiveDomain.endsWith('.' + dom)
        );
        if (matchedProtected) {
          await removeDomain(matchedProtected);
        }

        excludedDomains.push(currentActiveDomain);
        await chrome.storage.local.set({ excludedDomains });
        renderExcludedList();
        updateActiveTabButtonState();
      }
    });
  }

  // Manual domains adder plus button click
  const btnAddManual = document.getElementById('btn-add-manual-domain');
  const inputNewDomain = document.getElementById('input-new-domain');
  btnAddManual.addEventListener('click', async () => {
    const val = inputNewDomain.value;
    if (val) {
      await addDomain(val);
      inputNewDomain.value = '';
    }
  });

  // Bind Enter key on manual domains adder input
  inputNewDomain.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const val = inputNewDomain.value;
      if (val) {
        await addDomain(val);
        inputNewDomain.value = '';
      }
    }
  });

  // Password hide/show view eye toggle
  const btnToggle = document.getElementById('btn-toggle-view');
  
  btnToggle.addEventListener('click', () => {
    if (passInput.type === 'password') {
      passInput.type = 'text';
      btnToggle.textContent = 'Ocultar';
    } else {
      passInput.type = 'password';
      btnToggle.textContent = 'Ver';
    }
  });
}

function displayExtensionVersion() {
  try {
    const manifest = chrome.runtime.getManifest();
    const versionEl = document.getElementById('extension-version-tag');
    if (versionEl) {
      versionEl.textContent = manifest.version_name || `V${manifest.version}`;
    }
  } catch (err) {
    console.error('Failed to load extension version:', err);
  }
}

async function notifyActiveTabAutoProtect(enabled) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || !tab.id || !tab.url) return;

    const url = new URL(tab.url);
    if (!['http:', 'https:'].includes(url.protocol)) return;

    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'ANONIMAE_AUTO_PROTECT_CHANGED',
        enabled
      });
      return;
    } catch (messageErr) {
      if (enabled || !chrome.scripting || !chrome.scripting.executeScript) return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        document.querySelectorAll('.anoni-dlp-shield-btn, .animae-inline-shield-btn, #anoni-activation-dialog, #anoni-dialog-styles, #animae-shield-btn-styles').forEach((node) => {
          node.remove();
        });

        document.querySelectorAll('[data-shield-injected="true"], [data-animae-shield-injected="true"]').forEach((node) => {
          delete node.dataset.shieldInjected;
          delete node.dataset.animaeShieldInjected;
        });
      }
    });
  } catch (err) {
    console.error('Failed to notify active tab about protection state:', err);
  }
}

async function updateToolbarIcon(enabled) {
  if (!chrome.action || !chrome.action.setIcon) return;

  const iconPath = enabled === false
    ? {
        16: 'icons/icon-pro-disabled-16.png',
        48: 'icons/icon-pro-disabled-48.png',
        128: 'icons/icon-pro-disabled-128.png'
      }
    : {
        16: 'icons/icon-pro-16.png',
        48: 'icons/icon-pro-48.png',
        128: 'icons/icon-pro-128.png'
      };

  await chrome.action.setIcon({ path: iconPath });
  await chrome.action.setTitle({
    title: enabled === false
      ? 'AnonimAE - Protección automática desactivada'
      : 'AnonimAE - Protección automática activa'
  });
}
