// ==========================================================================
// EXTENSION BACKGROUND SERVICE WORKER - AnonimAE
// ==========================================================================

const ENABLED_ICON = {
  16: 'icons/icon-pro-16.png',
  48: 'icons/icon-pro-48.png',
  128: 'icons/icon-pro-128.png'
};

const DISABLED_ICON = {
  16: 'icons/icon-pro-disabled-16.png',
  48: 'icons/icon-pro-disabled-48.png',
  128: 'icons/icon-pro-disabled-128.png'
};

const AI_PROVIDER_CONFIGS_STORAGE_KEY = 'aiProviderConfigs';

function isAutoProtectEnabledValue(value) {
  return value !== false;
}

async function updateActionIcon(enabled) {
  const isEnabled = isAutoProtectEnabledValue(enabled);

  await chrome.action.setIcon({
    path: isEnabled ? ENABLED_ICON : DISABLED_ICON
  });

  await chrome.action.setTitle({
    title: isEnabled
      ? 'AnonimAE - Protección automática activa'
      : 'AnonimAE - Protección automática desactivada'
  });
}

async function syncActionIconFromStorage() {
  const data = await chrome.storage.local.get(['autoProtect']);
  await updateActionIcon(data.autoProtect);
}

chrome.runtime.onInstalled.addListener(syncActionIconFromStorage);
chrome.runtime.onStartup.addListener(syncActionIconFromStorage);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.autoProtect) return;
  updateActionIcon(changes.autoProtect.newValue);
});

function isSafeHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_err) {
    return false;
  }
}

async function isCorsBridgeEnabled(providerId) {
  const data = await chrome.storage.local.get([AI_PROVIDER_CONFIGS_STORAGE_KEY]);
  const configs = data[AI_PROVIDER_CONFIGS_STORAGE_KEY] || {};
  return configs[providerId]?.corsMode === 'assisted';
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'animae:corsFetch') return false;

  (async () => {
    const providerId = String(message.providerId || '');
    if (!providerId || !(await isCorsBridgeEnabled(providerId))) {
      throw new Error('CORS asistido no está habilitado para este proveedor.');
    }

    if (!isSafeHttpUrl(message.url)) {
      throw new Error('URL no permitida para CORS asistido.');
    }

    const response = await fetch(message.url, {
      method: message.method || 'GET',
      headers: message.headers || {},
      body: message.body,
      credentials: 'omit',
      cache: 'no-store'
    });

    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    sendResponse({
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      contentType,
      body
    });
  })().catch((err) => {
    sendResponse({
      ok: false,
      status: 0,
      statusText: err.message,
      body: null
    });
  });

  return true;
});

syncActionIconFromStorage();
