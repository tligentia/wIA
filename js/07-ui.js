/* ============================================
   wIA — 07-ui.js
   Bindings de eventos, atajos, voz, exportación y arranque
   (Scripts clásicos cargados en orden desde index.html;
   comparten el ámbito global igual que el antiguo app.js)
   ============================================ */

// ─── Settings workspace navigation ──────────
let activeSettingsSection = 'connection';

function activateSettingsSection(sectionId, { focusNav = false } = {}) {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;

    const buttons = [...modal.querySelectorAll('[data-settings-section]')];
    const panels = [...modal.querySelectorAll('[data-settings-panel]')];
    const nextButton = buttons.find((button) => button.dataset.settingsSection === sectionId);
    const nextPanel = panels.find((panel) => panel.dataset.settingsPanel === sectionId);
    if (!nextButton || !nextPanel) return;

    activeSettingsSection = sectionId;
    buttons.forEach((button) => {
        const isActive = button === nextButton;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-selected', String(isActive));
        button.tabIndex = isActive ? 0 : -1;
    });
    panels.forEach((panel) => {
        const isActive = panel === nextPanel;
        panel.classList.toggle('active', isActive);
        panel.hidden = !isActive;
    });

    const content = modal.querySelector('.settings-content');
    if (content) content.scrollTop = 0;
    if (focusNav) nextButton.focus();

    // Al entrar en Anonimización, refresca la lista de tipos de datos.
    if (sectionId === 'anon' && typeof renderAnonTypesPanel === 'function') renderAnonTypesPanel();
}

function openSettings(sectionId = activeSettingsSection) {
    applySettingsToUI();
    dom.settingsModal.classList.remove('hidden');
    activateSettingsSection(sectionId);
}

function initSettingsNavigation() {
    const nav = document.querySelector('#settingsModal .settings-nav');
    if (!nav) return;

    nav.addEventListener('click', (event) => {
        const button = event.target.closest('[data-settings-section]');
        if (button) activateSettingsSection(button.dataset.settingsSection);
    });

    nav.addEventListener('keydown', (event) => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        const buttons = [...nav.querySelectorAll('[data-settings-section]')];
        const currentIndex = buttons.findIndex((button) => button.dataset.settingsSection === activeSettingsSection);
        if (currentIndex < 0) return;
        event.preventDefault();
        let nextIndex = currentIndex;
        if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
        if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % buttons.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = buttons.length - 1;
        activateSettingsSection(buttons[nextIndex].dataset.settingsSection, { focusNav: true });
    });

    activateSettingsSection(activeSettingsSection);
}

// ─── Documentación ──────────────────────────
function bindDocsEvents() {
    if (dom.docsVersionTag && window.APP_VERSION) dom.docsVersionTag.textContent = window.APP_VERSION;

    // Índice: desplazamiento suave dentro del contenedor de ajustes.
    if (dom.docsToc) {
        dom.docsToc.addEventListener('click', (event) => {
            const link = event.target.closest('[data-doc-target]');
            if (!link) return;
            event.preventDefault();
            const target = document.getElementById(link.dataset.docTarget);
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }

    if (dom.downloadDocsPdfBtn) {
        dom.downloadDocsPdfBtn.addEventListener('click', downloadDocsPDF);
    }

    // Botón flotante «↑ Índice»: vuelve al principio (donde está el índice).
    if (dom.docsBackTop && dom.settingsContent) {
        dom.docsBackTop.addEventListener('click', () => {
            const el = dom.settingsContent;
            try { el.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { el.scrollTop = 0; }
            // Garantía: si el navegador ignora el desplazamiento suave, salta arriba.
            setTimeout(() => { if (el.scrollTop > 0) el.scrollTop = 0; }, 500);
        });
        // Aparece solo al desplazarse hacia abajo dentro de la documentación.
        const toggleBackTop = () => {
            const onDocs = activeSettingsSection === 'docs';
            const scrolled = dom.settingsContent.scrollTop > 240;
            dom.docsBackTop.classList.toggle('visible', onDocs && scrolled);
        };
        dom.settingsContent.addEventListener('scroll', toggleBackTop, { passive: true });
    }
}

// Genera un PDF de la documentación abriendo el diálogo de impresión sobre un
// documento aislado (iframe): texto seleccionable, sin dependencias externas y
// con estilos propios independientes del tema de la app.
function downloadDocsPDF() {
    if (!dom.docsBody) return;
    const version = window.APP_VERSION || '';
    const printCss = `
        * { box-sizing: border-box; }
        body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; line-height: 1.55; margin: 0; padding: 32px 40px; font-size: 12px; }
        .doc-cover { text-align: center; padding: 60px 0 40px; border-bottom: 2px solid #6d28d9; margin-bottom: 8px; page-break-after: always; }
        .doc-cover h1 { font-size: 56px; color: #6d28d9; margin: 0; letter-spacing: 1px; }
        .doc-cover p { margin: 8px 0 0; color: #555; font-size: 15px; }
        .doc-cover .v { margin-top: 24px; font-size: 12px; color: #888; }
        h2 { font-size: 16px; color: #6d28d9; margin: 22px 0 10px; page-break-after: avoid; }
        p { margin: 0 0 9px; }
        ul, ol { margin: 0 0 11px; padding-left: 22px; }
        li { margin-bottom: 4px; }
        code, kbd { font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.86em; background: #f0f0f4; padding: 1px 5px; border-radius: 3px; }
        kbd { border: 1px solid #ccc; }
        a { color: #6d28d9; text-decoration: none; }
        .doc-block { page-break-inside: auto; }
        .doc-tip { background: #f3f0fc; border-left: 3px solid #6d28d9; padding: 8px 12px; border-radius: 6px; }
        .doc-q { font-weight: 600; margin-top: 12px; }
        table.doc-table { width: 100%; border-collapse: collapse; margin: 4px 0 14px; font-size: 11px; page-break-inside: avoid; }
        table.doc-table th, table.doc-table td { text-align: left; padding: 6px 9px; border: 1px solid #ccc; }
        table.doc-table th { background: #f4f2fb; }
        .doc-footer-note { margin-top: 20px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 10px; color: #888; font-style: italic; }
    `;
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Documentación wIA ${version}</title><style>${printCss}</style></head>`
        + `<body><div class="doc-cover"><h1>wIA</h1><p>Documentación completa</p><p class="v">Versión ${version}</p></div>`
        + dom.docsBody.innerHTML + `</body></html>`;

    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    document.body.appendChild(iframe);

    let printed = false;
    const doPrint = () => {
        if (printed) return;
        printed = true;
        try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
        } catch (e) {
            console.warn('No se pudo abrir el diálogo de impresión:', e);
        }
        setTimeout(() => iframe.remove(), 1500);
    };

    iframe.onload = doPrint;
    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
    // Respaldo por si onload no dispara tras document.write en algún navegador.
    setTimeout(doPrint, 600);
}

let connectionValidationRun = 0;

function syncConnectionDraftToState({ persist = false } = {}) {
    const prov = getProviderDef(state.settings.provider);
    const typedUrl = String(dom.ollamaUrl?.value || '').trim();
    state.settings.ollamaUrl = (typedUrl || prov.defaultUrl || '').replace(/\/+$/, '');
    state.settings.apiKey = String(dom.apiKeyInput?.value || '').trim();
    saveCurrentProviderConfig();
    if (persist) saveState();
}

function markConnectionValidationPending() {
    setConnectionValidationFeedback('pending', 'Cambios pendientes de validar');
}

function showConnectionValidationResult(result) {
    if (result?.stale) return;
    if (!result?.ok) {
        setConnectionValidationFeedback('error', result?.message || 'No se pudo conectar');
        return;
    }

    const count = Number(result.modelCount || 0);
    if (state.settings.provider === 'webgpu') {
        const engine = result.mode === 'webgpu' ? 'WebGPU listo' : 'WASM disponible';
        setConnectionValidationFeedback('success', `${engine} · ${count} modelos`);
        return;
    }

    const modelText = count === 1 ? '1 modelo' : `${count} modelos`;
    setConnectionValidationFeedback('success', `Conexión válida · ${modelText}`);
}

async function validateCurrentProviderConnection({ persist = true } = {}) {
    const runId = ++connectionValidationRun;
    syncConnectionDraftToState({ persist });

    const button = dom.validateConnectionBtn;
    if (button) {
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
    }
    if (dom.validateConnectionLabel) dom.validateConnectionLabel.textContent = 'Validando…';
    setConnectionValidationFeedback('loading', 'Comprobando acceso…');

    const result = await checkProviderStatus({ explicit: true });
    if (runId !== connectionValidationRun) return result;

    showConnectionValidationResult(result);
    if (button) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
    }
    updateProviderUI();
    return result;
}

// ─── Event Bindings ─────────────────────────
function bindEvents() {
    // Send message. Un prompt que empieza por "+" no se envía: se encola como
    // orden pendiente para lanzarla luego (individual o toda la cola).
    dom.sendBtn.addEventListener('click', () => {
        if (tryQueueOrder(dom.messageInput.value)) return;
        sendMessage(dom.messageInput.value);
    });

    dom.messageInput.addEventListener('keydown', (e) => {
        // Skip send if slash commands are active (slash keydown handles Enter)
        if (e.key === 'Enter' && !e.shiftKey && !(typeof slashState !== 'undefined' && slashState.active)) {
            e.preventDefault();
            if (!dom.sendBtn.disabled) {
                if (tryQueueOrder(dom.messageInput.value)) return;
                sendMessage(dom.messageInput.value);
            }
        }
    });

    dom.messageInput.addEventListener('input', () => {
        autoResizeTextarea();
        updateSendButton();
        // Precarga el modelo WebGPU en segundo plano en cuanto el usuario empieza
        // a escribir: la descarga/inicialización avanza mientras redacta, así el
        // envío es (casi) instantáneo. Silencioso e idempotente.
        if (dom.messageInput.value.trim() && typeof warmUpActiveWebGPUModel === 'function') {
            warmUpActiveWebGPUModel();
        }
    });

    // Stop streaming
    dom.stopBtn.addEventListener('click', stopStreaming);

    // New chat
    if(dom.mobileNewChat) dom.mobileNewChat.addEventListener('click', createChatFromUI);
    if(dom.desktopNewChatToggle) dom.desktopNewChatToggle.addEventListener('click', createChatFromUI);

    // Search chats
    dom.searchChats.addEventListener('input', debounce(renderChatList, 250));

    // Welcome cards (delegación: los iniciadores se re-renderizan por agente)
    document.querySelector('.welcome-cards')?.addEventListener('click', (e) => {
        const card = e.target.closest('.welcome-card');
        if (!card) return;
        dom.messageInput.value = card.dataset.prompt || '';
        autoResizeTextarea();
        updateSendButton();
        dom.messageInput.focus();
    });

    // Settings Modal
    dom.menuBtn.addEventListener('click', toggleSidebar); // in mobile side? wait...

    dom.providerSelect?.addEventListener('change', (e) => {
        // Save current provider config before switching
        syncConnectionDraftToState({ persist: true });
        
        // Switch to new provider
        state.settings.provider = e.target.value;
        markProviderUsed(state.settings.provider);
        state.modelFeatureFilters = [];
        syncProviderToState();
        prepareModelPanelForProvider(state.settings.provider);
        
        // Update UI with new provider's config
        dom.ollamaUrl.value = state.settings.ollamaUrl;
        if (dom.apiKeyInput) dom.apiKeyInput.value = state.settings.apiKey || '';
        dom.modelSelect.innerHTML = `<option value="${state.settings.model}" selected>${state.settings.model}</option>`;
        
        updateProviderUI();
        renderProviderOptions();
        updateStatusMeta();
        saveState();
        validateCurrentProviderConnection({ persist: false });
    });

    dom.providerFavoriteBtn?.addEventListener('click', () => {
        const providerId = state.settings.provider;
        const favorites = (Array.isArray(state.settings.favoriteProviders) ? state.settings.favoriteProviders : [])
            .filter(id => PROVIDERS[id]);
        state.settings.favoriteProviders = favorites.includes(providerId)
            ? favorites.filter(id => id !== providerId)
            : [providerId, ...favorites];
        renderProviderOptions();
        saveState();
    });

    document.getElementById('modelEngineChangeBtn')?.addEventListener('click', () => {
        activateSettingsSection('connection', { focusNav: true });
        dom.providerSelect?.focus();
    });
    
    // API Key toggle visibility
    dom.apiKeyToggle?.addEventListener('click', () => {
        const input = dom.apiKeyInput;
        if (input) {
            input.type = input.type === 'password' ? 'text' : 'password';
        }
    });

    dom.validateConnectionBtn?.addEventListener('click', () => {
        validateCurrentProviderConnection();
    });

    dom.apiKeyInput?.addEventListener('input', markConnectionValidationPending);
    dom.ollamaUrl?.addEventListener('input', markConnectionValidationPending);

    [dom.apiKeyInput, dom.ollamaUrl].forEach((input) => {
        input?.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            validateCurrentProviderConnection();
        });
    });

    $('#settingsBtn').addEventListener('click', () => {
        openSettings();
    });

    dom.modelStatus?.addEventListener('click', () => {
        $('#settingsBtn')?.click();
    });

    $('#closeSettings').addEventListener('click', () => {
        dom.settingsModal.classList.add('hidden');
    });

    initSettingsNavigation();

    if (dom.exportSettingsBtn) {
        dom.exportSettingsBtn.addEventListener('click', () => {
            const data = JSON.stringify(state.settings, null, 2);
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `wIA_settings_${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
        });
    }

    if (dom.importSettingsBtn) {
        dom.importSettingsBtn.addEventListener('click', () => {
            dom.importSettingsFile.click();
        });
        dom.importSettingsFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const importedSettings = JSON.parse(ev.target.result);
                    if (importedSettings && importedSettings.provider) {
                        state.settings = { ...state.settings, ...importedSettings };
                        state.incognitoSessionActive = !!state.settings.incognitoMode || state.incognitoSessionActive;
                        saveState();
                        applySettingsToUI();
                        checkProviderStatus();
                        alert('Ajustes restaurados correctamente.');
                    } else {
                        alert('El archivo no parece contener ajustes válidos de wIA.');
                    }
                } catch (err) {
                    alert('Error al leer el archivo de configuración: ' + err.message);
                }
            };
            reader.readAsText(file);
            dom.importSettingsFile.value = '';
        });
    }

    // ─── Copia de seguridad COMPLETA (proyectos, agentes, chats, ajustes) ───
    if (dom.exportAllBtn) {
        dom.exportAllBtn.addEventListener('click', () => {
            const backup = {
                _type: 'wia-backup',
                _version: window.APP_VERSION || '',
                _exportedAt: new Date().toISOString(),
                _note: 'API keys excluidas por seguridad; vuelve a introducirlas tras importar.',
                projects: state.projects,
                chats: state.chats,
                activeProjectId: state.activeProjectId,
                orderQueue: state.orderQueue || [],
                // Ajustes sin las claves API (los agentes viven dentro de projects).
                settings: settingsWithoutSecrets(state.settings),
            };
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const stamp = new Date().toISOString().slice(0, 10);
            a.href = url;
            a.download = `wIA_backup_${stamp}.json`;
            a.click();
            URL.revokeObjectURL(url);
        });
    }

    if (dom.importAllBtn) {
        dom.importAllBtn.addEventListener('click', () => dom.importAllFile.click());
        dom.importAllFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (ev) => {
                try {
                    const data = JSON.parse(ev.target.result);
                    if (!data || data._type !== 'wia-backup' || !Array.isArray(data.projects) || !Array.isArray(data.chats)) {
                        alert('El archivo no parece una copia de seguridad completa de wIA.');
                        return;
                    }
                    const n = data.projects.length + data.chats.length;
                    if (!confirm(`Esto REEMPLAZARÁ tus proyectos, agentes y chats actuales por los del archivo (${data.projects.length} proyectos, ${data.chats.length} chats). Tus API keys se conservan. ¿Continuar?`)) return;
                    state.projects = data.projects;
                    state.chats = data.chats;
                    state.chats.forEach(c => { if (!c.projectId) c.projectId = 'general'; });
                    if (data.settings) {
                        // Conserva las API keys actuales (el backup no las incluye).
                        const keptSecrets = {};
                        forEachSecretSlot(state.settings, (obj, slot) => { keptSecrets[slot] = obj.apiKey; });
                        const merged = { ...state.settings, ...data.settings };
                        if (data.settings.providerConfigs) {
                            merged.providerConfigs = { ...state.settings.providerConfigs, ...data.settings.providerConfigs };
                        }
                        state.settings = merged;
                        forEachSecretSlot(state.settings, (obj, slot) => { if (keptSecrets[slot]) obj.apiKey = keptSecrets[slot]; });
                    }
                    if (data.activeProjectId && state.projects.find(p => p.id === data.activeProjectId)) {
                        state.activeProjectId = data.activeProjectId;
                    } else if (!state.projects.find(p => p.id === state.activeProjectId)) {
                        state.activeProjectId = state.projects[0]?.id || 'general';
                    }
                    if (Array.isArray(data.orderQueue)) state.orderQueue = data.orderQueue;
                    syncProviderToState();
                    await saveStateNow();
                    applySettingsToUI();
                    renderProjectSelect();
                    renderChatList();
                    if (typeof renderOrderQueue === 'function') renderOrderQueue();
                    if (typeof renderMessages === 'function') renderMessages();
                    alert(`Copia de seguridad restaurada: ${n} elementos. Recuerda revisar tus API keys en Ajustes.`);
                } catch (err) {
                    alert('Error al leer la copia de seguridad: ' + err.message);
                }
            };
            reader.readAsText(file);
            dom.importAllFile.value = '';
        });
    }

    bindDocsEvents();

    if (dom.refreshModels) {
        dom.refreshModels.addEventListener('click', () => {
            const originalText = dom.refreshModels.textContent;
            dom.refreshModels.textContent = '🔄 Cargando...';
            syncConnectionDraftToState({ persist: true });
            checkProviderStatus().then(showConnectionValidationResult).finally(() => {
                dom.refreshModels.textContent = originalText;
            });
        });
    }

    if (dom.languageSelect) {
        dom.languageSelect.value = state.settings.language || 'auto';
        dom.languageSelect.addEventListener('change', (e) => {
            if (typeof setLanguage === 'function') setLanguage(e.target.value);
        });
    }

    if (dom.themeSelect) {
        dom.themeSelect.addEventListener('change', () => {
            applyTheme(dom.themeSelect.value);
        });
    }

    dom.temperature.addEventListener('input', () => {
        dom.tempValue.textContent = dom.temperature.value;
    });
    dom.topP?.addEventListener('input', () => {
        dom.topPValue.textContent = dom.topP.value;
    });
    dom.topK?.addEventListener('input', () => {
        dom.topKValue.textContent = dom.topK.value;
    });
    dom.maxTokens?.addEventListener('input', () => {
        dom.maxTokensValue.textContent = dom.maxTokens.value;
    });

    dom.modelFunctionFilters?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-filter-key]');
        if (!btn) return;
        const key = btn.dataset.filterKey;
        if (key === '__clear') {
            state.modelFeatureFilters = [];
            state.modelShowFavoritesOnly = false;
            state.modelShowVerifiedOnly = false;
        } else if (key === '__fav') {
            state.modelShowFavoritesOnly = !state.modelShowFavoritesOnly;
        } else if (key === '__verified') {
            state.modelShowVerifiedOnly = !state.modelShowVerifiedOnly;
        } else if (state.modelFeatureFilters.includes(key)) {
            state.modelFeatureFilters = state.modelFeatureFilters.filter(item => item !== key);
        } else {
            state.modelFeatureFilters = [...state.modelFeatureFilters, key];
        }
        if (state.rawModels) populateModels(state.rawModels);
    });

    if (dom.modelSearchInput) {
        dom.modelSearchInput.addEventListener('input', () => {
            if (state.rawModels) populateModels(state.rawModels);
        });
    }

    dom.webgpuAddModelBtn?.addEventListener('click', () => {
        if (!addManualWebGPUModel(dom.webgpuManualModelInput?.value || '')) return;
        if (dom.webgpuManualModelInput) dom.webgpuManualModelInput.value = '';
        checkProviderStatus();
    });

    dom.webgpuManualModelInput?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        dom.webgpuAddModelBtn?.click();
    });

    // Cadena de visión: conmutador de activación
    document.getElementById('visionChainToggle')?.addEventListener('change', (e) => {
        state.settings.visionChainEnabled = e.target.checked;
        saveState();
        renderVisionChain();
        updateVisionIndicator();
    });

    // Cadena de visión: elegir modelo de visión y modelo de chat
    document.getElementById('visionModelSelect')?.addEventListener('change', (e) => {
        const id = e.target.value;
        const def = WEBGPU_MODELS.find(m => m.id === id);
        // El captioner por defecto se guarda como '' (usa WEBGPU_IMAGE_ASSIST)
        state.settings.webgpuVisionModel = (def && def.id === 'Xenova/vit-gpt2-image-captioning') ? '' : id;
        webgpuState.imageAssistPipeline = null;
        webgpuState.imageAssistModelId = null;
        saveState();
        updateVisionIndicator();
        if (state.rawModels) populateModels(state.rawModels);
    });
    document.getElementById('visionChatSelect')?.addEventListener('change', (e) => {
        const id = e.target.value;
        state.settings.model = id;
        dom.modelSelect.value = id;
        getActiveProviderConfig().model = id;
        saveState();
        updateStatusMeta();
        updateModelContextIndicator();
        updateVisionIndicator();
        renderVisionChain();
        if (state.rawModels) populateModels(state.rawModels);
    });

    document.getElementById('webgpuReleaseBtn')?.addEventListener('click', () => {
        const loaded = webgpuState.loadedModelId || webgpuWorker.loadedModelId;
        if (!loaded && !webgpuState.isLoading) { alert('No hay ningún modelo cargado en memoria ahora mismo.'); return; }
        releaseWebGPUMemory();
    });

    document.getElementById('webgpuPrepareBtn')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const modelId = state.settings.model;
        const modelDef = WEBGPU_MODELS.find(m => m.id === modelId);
        if (!modelDef) { alert('Selecciona primero un modelo WebGPU.'); return; }
        if (webgpuState.loadedModelId === modelId) { alert('El modelo ya está cargado y listo.'); return; }
        if (webgpuState.isLoading) { alert('Ya hay una carga en curso.'); return; }
        const original = btn.textContent;
        btn.disabled = true; btn.textContent = '⏳ Preparando…';
        try {
            const task = modelDef.task || 'text-generation';
            await loadWebGPUModel(modelId, () => { try { renderWebGPUMonitor(); } catch (err) {} }, task);
            renderWebGPUMonitor();
        } catch (err) {
            console.warn('[WebGPU] preparar modelo falló:', err);
            alert('No se pudo preparar el modelo: ' + (err?.message || err));
        } finally {
            btn.disabled = false; btn.textContent = original;
        }
    });

    $('#saveSettings').addEventListener('click', async () => {
        syncConnectionDraftToState();
        if (dom.themeSelect) state.settings.theme = dom.themeSelect.value;
        // Model is read from the hidden select which is synced by populateModels()
        if (dom.modelSelect.value) state.settings.model = dom.modelSelect.value;
        state.settings.temperature = parseFloat(dom.temperature.value);
        state.settings.topP = parseFloat(dom.topP?.value || 0.9);
        state.settings.topK = parseInt(dom.topK?.value || 40);
        state.settings.maxTokens = parseInt(dom.maxTokens?.value || 4096);
        state.settings.systemPrompt = dom.systemPrompt.value;
        state.settings.thinkingMode = dom.thinkingMode.checked;
        const wasPersistenceDisabled = isConversationPersistenceDisabled();
        state.settings.incognitoMode = !!dom.incognitoMode?.checked;
        state.settings.privacyLockEnabled = !!dom.privacyLockEnabled?.checked;
        if (state.settings.incognitoMode || wasPersistenceDisabled) {
            state.incognitoSessionActive = true;
        }
        saveCurrentProviderConfig();
        if (window.SecureGate?.configure) {
            try {
                await window.SecureGate.configure({
                    enabled: state.settings.privacyLockEnabled,
                    pin: dom.privacyLockPin?.value || ''
                });
            } catch (e) {
                alert(e.message);
                return;
            }
        }
        saveState();
        applySettingsToUI();
        dom.settingsModal.classList.add('hidden');
        checkProviderStatus();
    });

    $('#resetSettings').addEventListener('click', () => {
        const defaultProvider = 'ollama';
        state.settings.provider = defaultProvider;
        state.settings.ollamaUrl = PROVIDERS[defaultProvider].defaultUrl;
        state.settings.model = PROVIDERS[defaultProvider].defaultModel;
        state.settings.apiKey = '';
        state.settings.theme = 'light';
        state.settings.temperature = 0.8;
        state.settings.systemPrompt = `# System Prompt: Asistente IA Experto

## Rol y Personalidad
Eres un asistente de IA experto, útil y preciso.  
Mantén un tono profesional, objetivo y técnico.

## Idioma
Responde **siempre** en el mismo idioma que el usuario.

## Estilo de Respuesta
- Prioriza la **concisión** y **claridad técnica**.
- Evita explicaciones innecesarias o redundantes.

## Generación de Código
\`\`\`markdown
Cuando generes código:
- Incluye comentarios explicativos que detallen la lógica y propósito de cada bloque.
- Usa bloques de código Markdown con sintaxis apropiada (ej. \`\`\`python).
- Verifica sintaxis antes de entregar.
\`\`\`

## Manejo de Incertidumbre
- Si algo no está claro, **pide aclaración específica** antes de asumir.
- **No inventes** información ni especules sin base verificable.

## Restricciones de Comportamiento
- ❌ **Evita**: Ser condescendiente, complaciente o seguir la corriente sin fundamento.
- ✅ **Mantén**: Objetividad rigurosa y precisión factual.

---
*Última actualización: 10/04/2026*`;
        state.settings.thinkingMode = true;
        state.settings.incognitoMode = false;
        state.settings.privacyLockEnabled = false;
        state.settings.favoriteProviders = [];
        state.settings.providerUsageHistory = [];
        state.incognitoSessionActive = false;
        state.settings.topP = 0.9;
        state.settings.topK = 40;
        state.settings.maxTokens = 4096;
        // Reset providerConfigs to defaults
        for (const [key, prov] of Object.entries(PROVIDERS)) {
            state.settings.providerConfigs[key] = { url: prov.defaultUrl, model: prov.defaultModel, apiKey: '' };
        }
        window.SecureGate?.configure?.({ enabled: false, pin: '' });
        applySettingsToUI();
    });

    $('#clearHistoryBtn')?.addEventListener('click', () => {
        if (!confirm('⚠️ ¿Seguro que quieres borrar todo el historial, chats, proyectos y documentos persistentes? Tus ajustes se conservarán.')) return;

        resetProjectsAndChatsState();
        localStorage.removeItem('antigravity_chats');
        localStorage.removeItem('antigravity_projects');
        idbStore.del('chats').catch(() => {});
        idbStore.del('projects').catch(() => {});
        saveState();
        applyPostResetUI({ preserveSettings: true });
        alert('Historial limpiado. Tus ajustes se han conservado.');
    });

    $('#factoryResetBtn')?.addEventListener('click', async () => {
        if (!confirm('⚠️ ¿Estás completamente seguro de que quieres restaurar wIA de fábrica? Se borrarán historial, proyectos y ajustes.')) return;

        localStorage.removeItem('antigravity_chats');
        localStorage.removeItem('antigravity_projects');
        localStorage.removeItem('antigravity_settings');
        try {
            await idbStore.del('chats');
            await idbStore.del('projects');
        } catch (e) { /* si IDB falla, el reload sigue adelante */ }
        location.reload();
    });

    // Delete modal
    let chatToDelete = null;

    window.showDeleteModal = (chatId) => {
        chatToDelete = chatId;
        dom.deleteModal.classList.remove('hidden');
    };

    $('#confirmDelete').addEventListener('click', () => {
        if (chatToDelete) {
            deleteChat(chatToDelete);
            chatToDelete = null;
        }
        dom.deleteModal.classList.add('hidden');
    });

    $$('.close-delete-modal').forEach(btn => {
        btn.addEventListener('click', () => {
            dom.deleteModal.classList.add('hidden');
            chatToDelete = null;
        });
    });

    // Close modals on overlay click
    [dom.settingsModal, dom.deleteModal, dom.moveModal, dom.privacyModal].forEach(modal => {
        if(modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.classList.add('hidden');
            });
        }
    });

    // Improve Prompt
    dom.improvePromptBtn?.addEventListener('click', improvePrompt);

    // Privacy Modal
    dom.openPrivacy?.addEventListener('click', (e) => {
        e.preventDefault();
        dom.privacyModal.classList.remove('hidden');
    });

    [dom.closePrivacy, dom.closePrivacyBtn].forEach(btn => {
        btn?.addEventListener('click', () => {
            dom.privacyModal.classList.add('hidden');
        });
    });

    // Toolbar events
    dom.sidebarNewChatBtn?.addEventListener('click', () => {
        createChatFromUI();
    });
    
    dom.attachBtn.addEventListener('click', () => dom.fileUpload.click());
    dom.fileUpload.addEventListener('change', (e) => handleFiles(e.target.files));
    dom.attachmentPreview.addEventListener('click', (e) => {
        if (e.target.classList.contains('attachment-remove')) {
            removeAttachment(e.target.dataset.id);
        }
    });

    dom.toolInternet.addEventListener('click', () => {
        dom.toolInternet.classList.toggle('active');
        state.settings.webSearchEnabled = dom.toolInternet.classList.contains('active');
        saveState();
    });

    // Cola de órdenes (prefijo +)
    document.getElementById('orderQueueRun')?.addEventListener('click', () => runOrderQueue());
    document.getElementById('orderQueueClear')?.addEventListener('click', () => clearOrderQueue());
    document.getElementById('orderQueueList')?.addEventListener('click', (e) => {
        const runId = e.target.closest('[data-order-run]')?.dataset.orderRun;
        if (runId) { runSingleOrder(runId); return; }
        const delId = e.target.closest('[data-order-del]')?.dataset.orderDel;
        if (delId) removeOrder(delId);
    });

    dom.toolThinking.addEventListener('click', () => {
        dom.toolThinking.classList.toggle('active');
        state.settings.thinkingMode = dom.toolThinking.classList.contains('active');
        dom.thinkingMode.checked = state.settings.thinkingMode;
        saveState();
    });

    // Project Settings Modal
    dom.projectSelect.addEventListener('change', (e) => {
        switchProject(e.target.value);
    });

    dom.newProjectBtn.addEventListener('click', () => {
        const name = prompt("Nombre del Nuevo Proyecto (Workspace):", "Nuevo Proyecto");
        if (name && name.trim()) {
            createProject(name.trim());
        }
    });

    dom.projectSettingsBtn.addEventListener('click', () => {
        openProjectEditor(state.activeProjectId);
    });

    [dom.closeProjectModal, dom.closeProjectModal2].forEach(btn => {
        btn.addEventListener('click', () => dom.projectModal.classList.add('hidden'));
    });

    dom.saveProjectBtn.addEventListener('click', () => {
        const proj = getEditingProject();
        if (proj.id !== 'general') proj.name = dom.projectName.value.trim() || proj.name;
        proj.systemPrompt = dom.projectPrompt.value.trim();
        proj.emoji = dom.projectEmoji.value.trim();
        proj.description = dom.projectDescription.value.trim();
        proj.agentProvider = dom.projectProvider.value || '';
        proj.agentModel = dom.projectModel.value.trim();
        const temp = parseFloat(dom.projectTemperature.value);
        proj.agentTemperature = Number.isNaN(temp) ? null : temp;
        proj.starters = [0, 1, 2, 3].map(i => ({
            icon: dom.projectStartersEditor.querySelector(`[data-starter-icon="${i}"]`)?.value.trim() || '',
            title: dom.projectStartersEditor.querySelector(`[data-starter-title="${i}"]`)?.value.trim() || '',
            prompt: dom.projectStartersEditor.querySelector(`[data-starter-prompt="${i}"]`)?.value.trim() || '',
        })).filter(s => s.prompt);

        saveState();
        renderProjectSelect();
        renderAgentsGallery();
        if (proj.id === state.activeProjectId) {
            applyAgentEngine(proj);
            renderWelcomeStarters();
        }
        dom.projectModal.classList.add('hidden');
    });

    dom.deleteProjectBtn.addEventListener('click', () => {
        const proj = getEditingProject();
        if (confirm(`¿Estás seguro de que quieres eliminar el agente/proyecto ${proj.name} y TODOS sus chats contenidos?`)) {
            deleteProject(proj.id);
            renderAgentsGallery();
            dom.projectModal.classList.add('hidden');
        }
    });

    // ── Galería de Agentes ──
    dom.agentsGalleryBtn?.addEventListener('click', () => {
        renderAgentsGallery();
        renderAgentCatalog();
        dom.agentsModal.classList.remove('hidden');
    });
    dom.closeAgentsModal?.addEventListener('click', () => dom.agentsModal.classList.add('hidden'));

    // Importar agente desde fichero
    dom.importAgentBtn?.addEventListener('click', () => dom.importAgentFile.click());
    dom.importAgentFile?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const { project, warnings } = installAgentDefinition(JSON.parse(ev.target.result), { activate: true });
                dom.agentsModal.classList.add('hidden');
                const extra = warnings.length ? `\n\nAvisos:\n· ${warnings.join('\n· ')}` : '';
                alert(`Agente «${project.name}» importado y activado.${extra}`);
            } catch (err) {
                alert('No se pudo importar el agente: ' + err.message);
            }
        };
        reader.readAsText(file);
        dom.importAgentFile.value = '';
    });

    // Instalar desde el catálogo curado
    document.getElementById('agentCatalog')?.addEventListener('click', (e) => {
        const card = e.target.closest('[data-catalog-index]');
        if (!card) return;
        const def = state._agentCatalog?.[parseInt(card.dataset.catalogIndex, 10)];
        if (!def) return;
        const { project } = installAgentDefinition(def, { activate: true });
        dom.agentsModal.classList.add('hidden');
        alert(`Agente «${project.name}» instalado desde el catálogo y activado.`);
    });

    dom.newAgentBtn?.addEventListener('click', () => {
        const name = prompt('Nombre del nuevo agente:', 'Mi agente');
        if (!name || !name.trim()) return;
        const proj = createProject(name.trim());
        renderAgentsGallery();
        openProjectEditor(proj.id);
    });

    document.getElementById('agentsGrid')?.addEventListener('click', (e) => {
        const exportBtn = e.target.closest('[data-export-agent]');
        if (exportBtn) {
            e.stopPropagation();
            exportAgentToFile(exportBtn.dataset.exportAgent);
            return;
        }
        const editBtn = e.target.closest('[data-edit-agent]');
        if (editBtn) {
            e.stopPropagation();
            openProjectEditor(editBtn.dataset.editAgent);
            return;
        }
        const card = e.target.closest('.agent-card');
        if (card) {
            switchProject(card.dataset.agentId);
            renderAgentsGallery();
            dom.agentsModal.classList.add('hidden');
        }
    });

    // Project Documents (Knowledge Base)
    dom.attachProjectDocsBtn.addEventListener('click', () => dom.projectFileUpload.click());
    dom.projectFileUpload.addEventListener('change', (e) => handleProjectFiles(e.target.files));

    // Move Modal Logics
    let chatToMove = null;

    window.showMoveModal = (chatId) => {
        chatToMove = chatId;
        const currentChat = state.chats.find(c => c.id === chatId);
        dom.moveProjectSelect.innerHTML = state.projects.map(p => 
            `<option value="${p.id}" ${p.id === currentChat.projectId ? 'disabled' : ''}>${escapeHtml(p.name)} ${p.id === currentChat.projectId ? '(Actual)' : ''}</option>`
        ).join('');
        dom.moveModal.classList.remove('hidden');
    };

    $('#confirmMove')?.addEventListener('click', () => {
        const targetProjId = dom.moveProjectSelect?.value;
        if (chatToMove && targetProjId) {
            const c = state.chats.find(c => c.id === chatToMove);
            if (c && c.projectId !== targetProjId) {
                c.projectId = targetProjId;
                saveState();
                if (state.activeChatId === chatToMove) {
                    state.activeChatId = null;
                    dom.welcomeScreen.classList.remove('hidden');
                    dom.messagesContainer.classList.add('hidden');
                }
                renderChatList();
            }
        }
        dom.moveModal.classList.add('hidden');
        chatToMove = null;
    });

    $$('.close-move-modal').forEach(btn => {
        btn.addEventListener('click', () => {
            dom.moveModal.classList.add('hidden');
            chatToMove = null;
        });
    });

    // Mobile sidebar
    dom.menuBtn.addEventListener('click', toggleSidebar);

    // Desktop Sidebar Toggles (Dual)
    const collapseBtn = $('#sidebarCollapseBtn');
    if (collapseBtn) {
        collapseBtn.addEventListener('click', () => {
            dom.sidebar.classList.add('collapsed');
            document.body.classList.add('sidebar-collapsed');
        });
    }

    const desktopToggle = $('#desktopSidebarToggle');
    if (desktopToggle) {
        desktopToggle.addEventListener('click', () => {
            dom.sidebar.classList.remove('collapsed');
            document.body.classList.remove('sidebar-collapsed');
        });
    }

    // Thinking block toggle (event delegation)
    dom.messagesScroll.addEventListener('click', (e) => {
        const header = e.target.closest('.thinking-header');
        if (header) {
            const nowOpen = !header.classList.contains('open');
            header.classList.toggle('open', nowOpen);
            const content = header.nextElementSibling;
            if (content) content.classList.toggle('open', nowOpen);
            // Registrar la preferencia en el mensaje: los repintados del
            // streaming la respetan y se persiste con el chat.
            const idx = parseInt(header.dataset.idx, 10);
            const chat = getActiveChat();
            if (chat && Number.isInteger(idx) && chat.messages[idx]) {
                chat.messages[idx].thinkingOpen = nowOpen;
                saveState();
            }
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + N = New chat
        if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
            e.preventDefault();
            createChatFromUI();
        }
        // Escape = close modals
        if (e.key === 'Escape') {
            dom.settingsModal.classList.add('hidden');
            dom.deleteModal.classList.add('hidden');
            dom.modelManagerModal.classList.add('hidden');
            closeSidebar();
        }
    });

    // Model Manager Events
    dom.manageModelsBtn?.addEventListener('click', openModelManager);
    
    [dom.closeModelManager, dom.closeModelManager2].forEach(btn => {
        btn?.addEventListener('click', () => dom.modelManagerModal.classList.add('hidden'));
    });

    dom.pullModelBtn?.addEventListener('click', () => {
        pullModel(dom.pullModelInput.value);
    });

    dom.modelManagerModal?.addEventListener('click', (e) => {
        if (e.target === dom.modelManagerModal) dom.modelManagerModal.classList.add('hidden');
    });

    $$('.suggestion-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            dom.pullModelInput.value = chip.dataset.model;
        });
    });

    // CORS Helper Events
    dom.closeCorsModal?.addEventListener('click', () => dom.corsErrorModal.classList.add('hidden'));
    
    dom.retryCorsBtn.addEventListener('click', () => {
        dom.corsErrorModal.classList.add('hidden');
        validateCurrentProviderConnection();
    });

    dom.corsWarningBadge.addEventListener('click', () => {
        dom.corsErrorModal.classList.remove('hidden');
    });
}

// ─── Mobile Sidebar ─────────────────────────
function toggleSidebar() {
    dom.sidebar.classList.toggle('open');
    let overlay = document.querySelector('.sidebar-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', closeSidebar);
    }
    overlay.classList.toggle('active');
}

function closeSidebar() {
    dom.sidebar.classList.remove('open');
    const overlay = document.querySelector('.sidebar-overlay');
    if (overlay) overlay.classList.remove('active');
}

// ─── Helpers ────────────────────────────────
function autoResizeTextarea() {
    const ta = dom.messageInput;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
    const count = ta.value.length;
    dom.charCount.textContent = count > 0 ? `${count}` : '';
}

function updateSendButton() {
    dom.sendBtn.disabled = !dom.messageInput.value.trim() || state.isStreaming;
}

function scrollToBottom() {
    requestAnimationFrame(() => {
        dom.messagesScroll.scrollTop = dom.messagesScroll.scrollHeight;
    });
}

// escapeHtml is defined at the top of the file using a persistent node (_escapeDiv)
// for O(1) reuse instead of creating a new DOM node on every call.
// The duplicate definition here is removed to avoid shadowing.

function formatDate(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Ahora';
    if (minutes < 60) return `Hace ${minutes} min`;
    if (hours < 24) return `Hace ${hours}h`;
    if (days < 7) return `Hace ${days}d`;
    return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

// ─── Start ──────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    if (window.SecureGate?.init) {
        window.SecureGate.init(init);
    } else {
        init();
    }
});

// Global helpers
window.copyText = function(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
        const original = btn.textContent;
        btn.textContent = '¡Copiado!';
        setTimeout(() => {
            btn.textContent = original;
        }, 2000);
    });
};

// ============================================
//  FEATURE: Copy Full Response
// ============================================
window.copyFullResponse = function(idx, btn) {
    const chat = getActiveChat();
    if (!chat || !chat.messages[idx]) return;
    const msg = chat.messages[idx];
    const text = msg.content || '';
    navigator.clipboard.writeText(text).then(() => {
        btn.classList.add('copied-feedback');
        const orig = btn.innerHTML;
        btn.innerHTML = '✅ Copiado';
        setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied-feedback'); }, 2000);
    });
};

// ============================================
//  FEATURE: Regenerate Response
// ============================================
window.regenerateResponse = function(idx) {
    const chat = getActiveChat();
    if (!chat || state.isStreaming) return;
    
    // Remove the assistant message at idx
    if (chat.messages[idx] && chat.messages[idx].role === 'assistant') {
        chat.messages.splice(idx, 1);
        saveState();
        renderMessages();
        // Re-send using the last user message context
        sendMessage(null, 'RETRY_LAST');
    }
};

// ============================================
//  FEATURE: Edit Sent Messages
// ============================================
window.editMessage = function(idx) {
    const chat = getActiveChat();
    if (!chat || state.isStreaming) return;
    
    const msg = chat.messages[idx];
    if (!msg || msg.role !== 'user') return;
    
    // Extract clean content (remove attachments)
    let content = msg.content || '';
    const attachIdx = content.indexOf('\n\n--- Archivo adjunto:');
    if (attachIdx !== -1) content = content.substring(0, attachIdx);
    
    // Put original text in input
    dom.messageInput.value = content;
    autoResizeTextarea();
    updateSendButton();
    dom.messageInput.focus();
    
    // Remove this message and everything after it
    chat.messages.splice(idx);
    saveState();
    renderMessages();
};

// ============================================
//  FEATURE: Bookmarks
// ============================================
window.toggleBookmark = function(idx) {
    const chat = getActiveChat();
    if (!chat || !chat.messages[idx]) return;
    
    chat.messages[idx].bookmarked = !chat.messages[idx].bookmarked;
    saveState();
    renderMessages();
};

// ============================================
//  FEATURE: Export Chat (JSON + Markdown)
// ============================================
window.exportChat = function(chatId) {
    const chat = state.chats.find(c => c.id === chatId);
    if (!chat) return;
    
    // Generate Markdown export
    let md = `# ${chat.title}\n\n`;
    md += `> Exportado: ${new Date().toLocaleString('es-ES')}\n`;
    md += `> Proyecto: ${state.projects.find(p => p.id === chat.projectId)?.name || 'General'}\n\n---\n\n`;
    
    chat.messages.forEach(msg => {
        if (msg.role === 'user') {
            md += `## 🧑 Usuario\n\n${msg.content}\n\n`;
        } else if (msg.role === 'assistant') {
            md += `## 🤖 wIA\n\n${msg.content}\n\n`;
        }
        md += `---\n\n`;
    });
    
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wIA_${chat.title.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, '').substring(0, 40)}_${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
};

window.exportChatJSON = function(chatId) {
    const chat = state.chats.find(c => c.id === chatId);
    if (!chat) return;
    
    const blob = new Blob([JSON.stringify(chat, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wIA_backup_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
};

window.importChat = function() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const chatData = JSON.parse(ev.target.result);
                if (chatData.messages && chatData.id) {
                    chatData.id = 'imported_' + Date.now();
                    chatData.projectId = state.activeProjectId;
                    state.chats.unshift(chatData);
                    saveState();
                    renderChatList();
                    switchChat(chatData.id);
                }
            } catch (err) {
                alert('Error al importar: archivo JSON inválido');
            }
        };
        reader.readAsText(file);
    };
    input.click();
};

// ============================================
//  FEATURE: Voice Input (Web Speech API)
// ============================================
(function initVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        const voiceBtn = document.getElementById('voiceBtn');
        if (voiceBtn) voiceBtn.style.display = 'none';
        return;
    }
    
    let recognition = null;
    let isListening = false;
    
    document.addEventListener('DOMContentLoaded', () => {
        const voiceBtn = document.getElementById('voiceBtn');
        if (!voiceBtn) return;
        
        voiceBtn.addEventListener('click', () => {
            if (isListening) {
                recognition.stop();
                return;
            }
            
            recognition = new SpeechRecognition();
            recognition.lang = document.documentElement.lang || 'es-ES';
            recognition.continuous = true;
            recognition.interimResults = true;
            
            recognition.onstart = () => {
                isListening = true;
                voiceBtn.classList.add('voice-active');
            };
            
            recognition.onresult = (e) => {
                let finalTranscript = '';
                for (let i = e.resultIndex; i < e.results.length; ++i) {
                    if (e.results[i].isFinal) {
                        finalTranscript += e.results[i][0].transcript;
                    }
                }
                if (finalTranscript) {
                    const ta = document.getElementById('messageInput');
                    if (ta) {
                        ta.value += (ta.value ? ' ' : '') + finalTranscript;
                        ta.dispatchEvent(new Event('input'));
                    }
                }
            };
            
            recognition.onerror = () => {
                isListening = false;
                voiceBtn.classList.remove('voice-active');
            };
            
            recognition.onend = () => {
                isListening = false;
                voiceBtn.classList.remove('voice-active');
            };
            
            recognition.start();
        });
    });
})();

// ============================================
//  FEATURE: Drag & Drop Files
// ============================================
(function initDragDrop() {
    let dragCounter = 0;
    
    document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        const overlay = document.getElementById('dropZoneOverlay');
        if (overlay) overlay.classList.remove('hidden');
    });
    
    document.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            const overlay = document.getElementById('dropZoneOverlay');
            if (overlay) overlay.classList.add('hidden');
        }
    });
    
    document.addEventListener('dragover', (e) => {
        e.preventDefault();
    });
    
    document.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        const overlay = document.getElementById('dropZoneOverlay');
        if (overlay) overlay.classList.add('hidden');
        
        if (e.dataTransfer.files.length > 0 && typeof handleFiles === 'function') {
            handleFiles(e.dataTransfer.files);
        }
    });
})();

// ============================================
//  FEATURE: Token Estimator
// ============================================
(function initTokenEstimator() {
    function estimateTokens(text) {
        // Rough estimation: ~4 chars per token for English, ~3 for Spanish
        if (!text) return 0;
        return Math.ceil(text.length / 3.5);
    }
    
    document.addEventListener('DOMContentLoaded', () => {
        const charCount = document.getElementById('charCount');
        const messageInput = document.getElementById('messageInput');
        if (!charCount || !messageInput) return;
        
        // Create token display element
        const tokenEl = document.createElement('span');
        tokenEl.className = 'token-estimate';
        tokenEl.id = 'tokenEstimate';
        charCount.parentNode.insertBefore(tokenEl, charCount.nextSibling);
        
        messageInput.addEventListener('input', () => {
            const text = messageInput.value;
            if (!text.trim()) {
                tokenEl.innerHTML = '';
                return;
            }
            const tokens = estimateTokens(text);
            tokenEl.innerHTML = `· ~${tokens} tkn`;
        });
    });
})();

// ============================================
//  FEATURE: Auto-Title with AI
// ============================================
async function autoTitleChat(chatId) {
    const chat = state.chats.find(c => c.id === chatId);
    if (!chat || chat.autoTitled || chat.messages.length < 2) return;
    
    // Only after first user+assistant exchange
    const userMsg = chat.messages.find(m => m.role === 'user');
    const assistantMsg = chat.messages.find(m => m.role === 'assistant');
    if (!userMsg || !assistantMsg || !assistantMsg.content) return;
    
    // Mark to prevent re-running
    chat.autoTitled = true;
    
    const providerDef = getProviderDef(state.settings.provider);
    if (!providerDef) return;
    
    const titlePrompt = `Genera un título muy breve (máximo 6 palabras) que resuma esta conversación. Responde SOLO con el título, sin comillas ni puntuación extra.\n\nUsuario: ${userMsg.content.substring(0, 200)}\nAsistente: ${assistantMsg.content.substring(0, 200)}`;
    
    try {
        const type = providerDef.type;
        const url = state.settings.ollamaUrl;
        const headers = getAuthHeaders();
        let title = '';
        
        if (type === 'ollama') {
            const res = await fetch(`${url}/api/chat`, {
                method: 'POST', headers,
                body: JSON.stringify({ model: state.settings.model, messages: [{ role: 'user', content: titlePrompt }], stream: false, options: { num_predict: 20 } })
            });
            const data = await res.json();
            title = data.message?.content?.trim() || '';
        } else if (type === 'openai') {
            const res = await fetch(`${url}/chat/completions`, {
                method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: state.settings.model, messages: [{ role: 'user', content: titlePrompt }], max_tokens: 20 })
            });
            const data = await res.json();
            title = data.choices?.[0]?.message?.content?.trim() || '';
        }
        
        if (title && title.length > 2 && title.length < 80) {
            chat.title = title.replace(/^["']|["']$/g, '').replace(/\.+$/, '');
            saveState();
            renderChatList();
        }
    } catch (e) {
        // Silent fail — keep the truncated title
    }
}

// ============================================
//  FEATURE: Prompt Library & Slash Commands
// ============================================

const PROMPT_STORAGE_KEY = 'antigravity_prompts';

const DEFAULT_PROMPT_CATEGORIES = [
    { id: 'general',  name: 'General',   icon: '📝', builtin: true },
    { id: 'coding',   name: 'Código',    icon: '💻', builtin: true },
    { id: 'writing',  name: 'Escritura', icon: '✍️', builtin: true },
    { id: 'analysis', name: 'Análisis',  icon: '📊', builtin: true },
    { id: 'creative', name: 'Creativo',  icon: '🎨', builtin: true },
];

let promptLibrary = { categories: [], prompts: [] };
let pmActiveCategory = null;
let pmEditingId = null;

// ── Persistence ──────────────────────────────
function loadPromptLibrary() {
    try {
        const raw = localStorage.getItem(PROMPT_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            promptLibrary = {
                categories: Array.isArray(parsed.categories) ? parsed.categories : [...DEFAULT_PROMPT_CATEGORIES],
                prompts: Array.isArray(parsed.prompts) ? parsed.prompts : []
            };
        } else {
            promptLibrary = { categories: [...DEFAULT_PROMPT_CATEGORIES], prompts: [] };
            savePromptLibrary();
        }
    } catch (e) {
        console.warn('[Prompts] Failed to load:', e);
        promptLibrary = { categories: [...DEFAULT_PROMPT_CATEGORIES], prompts: [] };
    }
}

function savePromptLibrary() {
    try {
        localStorage.setItem(PROMPT_STORAGE_KEY, JSON.stringify(promptLibrary));
    } catch (e) {
        console.warn('[Prompts] Failed to save:', e);
    }
}

function generatePromptId() {
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

// ── Prompt Manager Modal ─────────────────────
function openPromptManager(focusCategoryId) {
    loadPromptLibrary();
    pmActiveCategory = focusCategoryId || promptLibrary.categories[0]?.id || 'general';
    pmEditingId = null;
    renderPMCategories();
    renderPMPromptList();
    dom.promptManagerModal.classList.remove('hidden');
}

function closePromptManager() {
    dom.promptManagerModal.classList.add('hidden');
    pmEditingId = null;
}

function renderPMCategories() {
    const cats = promptLibrary.categories;
    let html = '';
    cats.forEach(cat => {
        const count = promptLibrary.prompts.filter(p => p.categoryId === cat.id).length;
        const active = cat.id === pmActiveCategory ? 'active' : '';
        html += `<button class="pm-cat-item ${active}" data-cat-id="${cat.id}">
            <span class="pm-cat-icon">${cat.icon}</span>
            <span>${escapeHtml(cat.name)}</span>
            <span class="pm-cat-count">${count}</span>
        </button>`;
    });
    html += `<div class="pm-cat-actions">
        <button class="pm-add-cat-btn" id="pmAddCatBtn"><span>+</span> <span>Categoría</span></button>
    </div>`;
    dom.pmCategories.innerHTML = html;

    // Bind category clicks
    dom.pmCategories.querySelectorAll('[data-cat-id]').forEach(btn => {
        btn.addEventListener('click', () => {
            pmActiveCategory = btn.dataset.catId;
            pmEditingId = null;
            renderPMCategories();
            renderPMPromptList();
        });
    });

    // Add category
    dom.pmCategories.querySelector('#pmAddCatBtn')?.addEventListener('click', () => {
        const name = prompt('Nombre de la nueva categoría:');
        if (!name?.trim()) return;
        const icon = prompt('Emoji/icono (opcional):', '📁') || '📁';
        const id = 'cat_' + Date.now().toString(36);
        promptLibrary.categories.push({ id, name: name.trim(), icon });
        savePromptLibrary();
        pmActiveCategory = id;
        renderPMCategories();
        renderPMPromptList();
    });
}

function renderPMPromptList() {
    if (pmEditingId === '__new__' || (pmEditingId && pmEditingId !== '__new__')) {
        renderPMForm(pmEditingId === '__new__' ? null : promptLibrary.prompts.find(p => p.id === pmEditingId));
        return;
    }

    const prompts = promptLibrary.prompts.filter(p => p.categoryId === pmActiveCategory);
    if (prompts.length === 0) {
        dom.pmContent.innerHTML = `<div class="pm-empty">No hay prompts en esta categoría.<br>Crea uno con <strong>+ Nuevo</strong> o guarda un mensaje desde el chat con <strong>➕</strong>.</div>`;
        return;
    }

    let html = '';
    prompts.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).forEach(p => {
        html += `<div class="pm-prompt-card" data-prompt-id="${p.id}">
            <div class="pm-prompt-title">${escapeHtml(p.title)}</div>
            <div class="pm-prompt-preview">${escapeHtml(p.content)}</div>
            <div class="pm-prompt-actions">
                <button class="pm-use-btn" data-action="use">▶ Usar</button>
                <button data-action="edit">✏️ Editar</button>
                <button class="pm-del-btn" data-action="delete">🗑 Borrar</button>
            </div>
        </div>`;
    });
    dom.pmContent.innerHTML = html;

    dom.pmContent.querySelectorAll('.pm-prompt-card').forEach(card => {
        const id = card.dataset.promptId;
        card.querySelector('[data-action="use"]')?.addEventListener('click', () => {
            usePromptById(id);
            closePromptManager();
        });
        card.querySelector('[data-action="edit"]')?.addEventListener('click', () => {
            pmEditingId = id;
            renderPMPromptList();
        });
        card.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
            if (!confirm('¿Eliminar este prompt?')) return;
            promptLibrary.prompts = promptLibrary.prompts.filter(p => p.id !== id);
            savePromptLibrary();
            renderPMCategories();
            renderPMPromptList();
        });
    });
}

function renderPMForm(existing) {
    const cats = promptLibrary.categories;
    const catOptions = cats.map(c =>
        `<option value="${c.id}" ${c.id === (existing?.categoryId || pmActiveCategory) ? 'selected' : ''}>${c.icon} ${escapeHtml(c.name)}</option>`
    ).join('');

    dom.pmContent.innerHTML = `
        <div class="pm-form">
            <h3 style="margin:0 0 4px;font-size:0.95rem;color:var(--text-primary);">${existing ? 'Editar Prompt' : 'Nuevo Prompt'}</h3>
            <div class="setting-group">
                <label class="setting-label">Título</label>
                <input type="text" class="setting-input" id="pmFormTitle" value="${existing ? escapeHtml(existing.title) : ''}" placeholder="Nombre descriptivo">
            </div>
            <div class="setting-group">
                <label class="setting-label">Categoría</label>
                <select class="setting-input" id="pmFormCategory">${catOptions}</select>
            </div>
            <div class="setting-group">
                <label class="setting-label">Contenido del prompt</label>
                <textarea class="setting-input" id="pmFormContent" rows="6" style="resize:vertical;font-family:var(--font-mono);font-size:0.82rem;" placeholder="Escribe el prompt aquí...">${existing ? escapeHtml(existing.content) : ''}</textarea>
            </div>
            <div class="pm-form-actions">
                <button class="btn-secondary" id="pmFormCancel">Cancelar</button>
                <button class="btn-primary" id="pmFormSave">${existing ? 'Actualizar' : 'Guardar'}</button>
            </div>
        </div>
    `;

    document.getElementById('pmFormCancel')?.addEventListener('click', () => {
        pmEditingId = null;
        renderPMPromptList();
    });

    document.getElementById('pmFormSave')?.addEventListener('click', () => {
        const title = document.getElementById('pmFormTitle').value.trim();
        const content = document.getElementById('pmFormContent').value.trim();
        const categoryId = document.getElementById('pmFormCategory').value;
        if (!title || !content) return alert('Título y contenido son obligatorios.');

        if (existing) {
            existing.title = title;
            existing.content = content;
            existing.categoryId = categoryId;
            existing.updatedAt = Date.now();
        } else {
            promptLibrary.prompts.push({
                id: generatePromptId(),
                title,
                content,
                categoryId,
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
        }
        savePromptLibrary();
        pmEditingId = null;
        pmActiveCategory = categoryId;
        renderPMCategories();
        renderPMPromptList();
    });

    document.getElementById('pmFormTitle')?.focus();
}

function usePromptById(id) {
    const p = promptLibrary.prompts.find(x => x.id === id);
    if (!p) return;
    dom.messageInput.value = p.content;
    autoResizeTextarea();
    updateSendButton();
    dom.messageInput.focus();
}

// ── Save Message As Prompt ───────────────────
function saveMessageAsPrompt(idx) {
    const chat = getActiveChat();
    if (!chat) return;
    const msg = chat.messages[idx];
    if (!msg || msg.role !== 'user') return;

    loadPromptLibrary();
    const content = msg.content;
    const autoTitle = content.length > 50 ? content.substring(0, 50).trim() + '…' : content;

    dom.savePromptTitle.value = autoTitle;
    dom.savePromptContent.value = content;

    // Populate categories
    dom.savePromptCategory.innerHTML = promptLibrary.categories.map(c =>
        `<option value="${c.id}">${c.icon} ${escapeHtml(c.name)}</option>`
    ).join('');

    dom.savePromptModal.classList.remove('hidden');
    dom.savePromptTitle.focus();
}

window.saveMessageAsPrompt = saveMessageAsPrompt;

function confirmSavePrompt() {
    const title = dom.savePromptTitle.value.trim();
    const content = dom.savePromptContent.value.trim();
    const categoryId = dom.savePromptCategory.value;
    if (!title || !content) return alert('Título y contenido son obligatorios.');

    promptLibrary.prompts.push({
        id: generatePromptId(),
        title,
        content,
        categoryId,
        createdAt: Date.now(),
        updatedAt: Date.now()
    });
    savePromptLibrary();
    dom.savePromptModal.classList.add('hidden');
}

// ── Slash Command System ─────────────────────
const slashState = {
    active: false,
    selectedIndex: 0,
    level: 'categories',    // 'categories' | 'prompts'
    selectedCategoryId: null,
    items: []
};

// Estado del selector rápido: // = modelos del motor actual, /// = elegir motor
const modelSlashState = {
    active: false,
    selectedIndex: 0,
    mode: 'models',        // 'models' (//) | 'engines' (///)
    selectedProviderId: null,
    items: []
};

function handleSlashInput() {
    const val = dom.messageInput.value;
    if (state.isStreaming) return;

    if (val.startsWith('///')) {
        hideSlashDropdown();
        const query = val.slice(3).toLowerCase().trim();
        showEngineSlashDropdown(query);      // /// → elegir el motor
    } else if (val.startsWith('//')) {
        hideSlashDropdown();                 // oculta el de prompts
        const query = val.slice(2).toLowerCase().trim();
        showModelSlashDropdown(query);       // // → modelos del motor actual
    } else if (val.startsWith('/')) {
        hideModelSlashDropdown();            // oculta el de modelos/motores
        const query = val.slice(1).toLowerCase().trim();
        showSlashDropdown(query);            // / → biblioteca de prompts
    } else {
        hideSlashDropdown();
        hideModelSlashDropdown();
    }
}

// Prompt Dropdown (/)
function showSlashDropdown(query) {
    slashState.active = true;
    slashState.selectedIndex = 0;

    if (slashState.level === 'prompts' && slashState.selectedCategoryId) {
        renderSlashPrompts(slashState.selectedCategoryId, query);
    } else {
        slashState.level = 'categories';
        renderSlashCategories(query);
    }
    dom.slashDropdown.classList.remove('hidden');
}

function hideSlashDropdown() {
    slashState.active = false;
    slashState.level = 'categories';
    slashState.selectedCategoryId = null;
    slashState.items = [];
    dom.slashDropdown.classList.add('hidden');
}

// Dropdown de MODELOS del motor actual (//)
function showModelSlashDropdown(query) {
    modelSlashState.active = true;
    modelSlashState.mode = 'models';
    modelSlashState.selectedIndex = 0;
    renderCurrentProviderModels(query);
    dom.modelSlashDropdown.classList.remove('hidden');
}

// Dropdown para ELEGIR EL MOTOR de IA (///)
function showEngineSlashDropdown(query) {
    modelSlashState.active = true;
    modelSlashState.mode = 'engines';
    modelSlashState.selectedIndex = 0;
    renderEngineSlashProviders(query);
    dom.modelSlashDropdown.classList.remove('hidden');
}

function hideModelSlashDropdown() {
    modelSlashState.active = false;
    modelSlashState.mode = 'models';
    modelSlashState.selectedProviderId = null;
    modelSlashState.items = [];
    dom.modelSlashDropdown.classList.add('hidden');
}

// Devuelve la lista de modelos disponibles para un motor concreto.
function getModelsForProvider(providerId) {
    if (providerId === 'webgpu') {
        return (typeof WEBGPU_MODELS !== 'undefined' ? WEBGPU_MODELS : [])
            .map(m => ({ name: m.id, label: m.label || m.name || m.id }));
    }
    if (state.settings.provider === providerId && Array.isArray(state.rawModels) && state.rawModels.length) {
        return state.rawModels.map(m => ({ name: m.name || m.id, label: m.label || m.name || m.id }));
    }
    const def = PROVIDERS[providerId];
    return def?.defaultModel ? [{ name: def.defaultModel, label: `${def.defaultModel} (por defecto)` }] : [];
}

function renderSlashCategories(query) {
    loadPromptLibrary();
    let cats = promptLibrary.categories;
    if (query) {
        cats = cats.filter(c => c.name.toLowerCase().includes(query) || c.id.includes(query));
    }

    slashState.items = cats.map(c => ({ type: 'category', ...c }));

    if (slashState.items.length === 0) {
        dom.slashDropdownList.innerHTML = `<div class="slash-empty">No se encontraron categorías para "/${query}"</div>`;
        return;
    }

    dom.slashDropdownList.innerHTML = slashState.items.map((item, i) => {
        const count = promptLibrary.prompts.filter(p => p.categoryId === item.id).length;
        return `<button class="slash-item ${i === slashState.selectedIndex ? 'active' : ''}" data-idx="${i}">
            <span class="slash-item-icon">${item.icon}</span>
            <div class="slash-item-info">
                <div class="slash-item-title">${escapeHtml(item.name)}</div>
            </div>
            <span class="slash-item-count">${count} prompt${count !== 1 ? 's' : ''}</span>
        </button>`;
    }).join('');

    bindSlashItemClicks();
}

function renderSlashPrompts(categoryId, query) {
    loadPromptLibrary();
    const cat = promptLibrary.categories.find(c => c.id === categoryId);
    let prompts = promptLibrary.prompts.filter(p => p.categoryId === categoryId);
    if (query) {
        prompts = prompts.filter(p =>
            p.title.toLowerCase().includes(query) || p.content.toLowerCase().includes(query)
        );
    }

    const backItem = { type: 'back', id: '__back__' };
    slashState.items = [backItem, ...prompts.map(p => ({ type: 'prompt', ...p }))];

    let html = `<button class="slash-item slash-item-back ${slashState.selectedIndex === 0 ? 'active' : ''}" data-idx="0">
        <span class="slash-item-icon">←</span>
        <div class="slash-item-info">
            <div class="slash-item-title">Volver a categorías</div>
        </div>
    </button>`;

    if (prompts.length === 0) {
        html += `<div class="slash-empty">No hay prompts en ${cat?.icon || ''} ${cat?.name || categoryId}.</div>`;
    } else {
        prompts.forEach((p, pi) => {
            const idx = pi + 1;
            html += `<button class="slash-item ${idx === slashState.selectedIndex ? 'active' : ''}" data-idx="${idx}">
                <span class="slash-item-icon">📄</span>
                <div class="slash-item-info">
                    <div class="slash-item-title">${escapeHtml(p.title)}</div>
                    <div class="slash-item-desc">${escapeHtml(p.content.substring(0, 80))}</div>
                </div>
            </button>`;
        });
    }

    dom.slashDropdownList.innerHTML = html;
    bindSlashItemClicks();
}

// // → modelos del MOTOR ACTUALMENTE SELECCIONADO (un solo nivel).
function renderCurrentProviderModels(query) {
    const providerId = state.settings.provider;
    const def = getProviderDef(providerId);
    let models = getModelsForProvider(providerId);
    if (query) {
        models = models.filter(m => (m.label || m.name).toLowerCase().includes(query));
    }
    modelSlashState.items = models.map(m => ({ type: 'model', id: m.name, label: m.label || m.name, providerId }));

    let html = `<div class="slash-dropdown-heading">${def.icon || '◇'} Modelos de ${escapeHtml(def.name)} · escribe /// para cambiar de motor</div>`;
    if (models.length === 0) {
        html += `<div class="slash-empty">No hay modelos disponibles para ${escapeHtml(def.name)}. Prueba a validar la conexión o usa /// para cambiar de motor.</div>`;
    } else {
        html += modelSlashState.items.map((item, i) => {
            const isCurrent = item.id === state.settings.model;
            return `<button class="slash-item ${i === modelSlashState.selectedIndex ? 'active' : ''}" data-idx="${i}">
                <span class="slash-item-icon">🤖</span>
                <div class="slash-item-info">
                    <div class="slash-item-title">${escapeHtml(item.label)}${isCurrent ? ' <span class="slash-current">· actual</span>' : ''}</div>
                </div>
            </button>`;
        }).join('');
    }
    dom.modelSlashDropdownList.innerHTML = html;
    bindModelSlashItemClicks();
}

// /// → elegir el MOTOR de IA (un solo nivel).
function renderEngineSlashProviders(query) {
    const favorites = Array.isArray(state.settings.favoriteProviders) ? state.settings.favoriteProviders : [];
    let providers = getOrderedProviderEntries().map(([id, def]) => ({
        id, name: def.name, icon: def.icon, favorite: favorites.includes(id),
    }));
    if (query) {
        providers = providers.filter(p => p.name.toLowerCase().includes(query) || p.id.toLowerCase().includes(query));
    }
    // OJO: construir sin propagar la def del motor, que trae su propio `type`
    // (p. ej. 'openai') y sobrescribiría el discriminador 'provider'.
    modelSlashState.items = providers.map(p => ({ type: 'provider', id: p.id, name: p.name, icon: p.icon, favorite: p.favorite }));

    if (modelSlashState.items.length === 0) {
        dom.modelSlashDropdownList.innerHTML = `<div class="slash-empty">No se encontraron motores para "///${query}"</div>`;
        return;
    }
    let html = `<div class="slash-dropdown-heading">⚙️ Elegir motor de IA · luego // para elegir modelo</div>`;
    html += modelSlashState.items.map((item, i) => {
        const isCurrent = item.id === state.settings.provider;
        return `<button class="slash-item ${i === modelSlashState.selectedIndex ? 'active' : ''}" data-idx="${i}">
            <span class="slash-item-icon">${item.icon}</span>
            <div class="slash-item-info">
                <div class="slash-item-title">${item.favorite ? '★ ' : ''}${escapeHtml(item.name)}${isCurrent ? ' <span class="slash-current">· actual</span>' : ''}</div>
            </div>
        </button>`;
    }).join('');
    dom.modelSlashDropdownList.innerHTML = html;
    bindModelSlashItemClicks();
}

function bindSlashItemClicks() {
    dom.slashDropdownList.querySelectorAll('.slash-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx, 10);
            selectSlashItem(idx);
        });
    });
}

function bindModelSlashItemClicks() {
    dom.modelSlashDropdownList.querySelectorAll('.slash-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx, 10);
            selectModelSlashItem(idx);
        });
    });
}

function selectSlashItem(idx) {
    const item = slashState.items[idx];
    if (!item) return;

    if (item.type === 'category') {
        slashState.level = 'prompts';
        slashState.selectedCategoryId = item.id;
        slashState.selectedIndex = 0;
        dom.messageInput.value = '/';
        renderSlashPrompts(item.id, '');
    } else if (item.type === 'back') {
        slashState.level = 'categories';
        slashState.selectedCategoryId = null;
        slashState.selectedIndex = 0;
        dom.messageInput.value = '/';
        renderSlashCategories('');
    } else if (item.type === 'prompt') {
        dom.messageInput.value = item.content;
        autoResizeTextarea();
        updateSendButton();
        hideSlashDropdown();
        dom.messageInput.focus();
    }
}

async function selectModelSlashItem(idx) {
    const item = modelSlashState.items[idx];
    if (!item) return;

    if (item.type === 'model') {
        // Fija el modelo (en su motor; cambia de motor si el ítem trae otro).
        const providerId = item.providerId || state.settings.provider;
        markProviderUsed(providerId);
        if (state.settings.provider !== providerId) {
            saveCurrentProviderConfig();
            state.settings.provider = providerId;
            syncProviderToState();
            updateProviderUI();
        }
        state.settings.model = item.id;
        getActiveProviderConfig().model = item.id;
        saveState();
        applySettingsToUI();
        checkProviderStatus();
        dom.messageInput.value = '';
        autoResizeTextarea();
        updateSendButton();
        hideModelSlashDropdown();
        dom.messageInput.focus();
        showStatusMeta && showStatusMeta(`Modelo: ${item.label}`);
    } else if (item.type === 'provider') {
        // Cambia el motor de IA (/// ).
        markProviderUsed(item.id);
        if (state.settings.provider !== item.id) {
            saveCurrentProviderConfig();
            state.settings.provider = item.id;
            syncProviderToState();
            updateProviderUI();
        }
        saveState();
        applySettingsToUI();
        checkProviderStatus();
        dom.messageInput.value = '';
        autoResizeTextarea();
        updateSendButton();
        hideModelSlashDropdown();
        dom.messageInput.focus();
        showStatusMeta && showStatusMeta(`Motor: ${getProviderDef(item.id).name}`);
    }
}

function handleSlashKeydown(e) {
    if (slashState.active) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            slashState.selectedIndex = Math.min(slashState.selectedIndex + 1, slashState.items.length - 1);
            updateSlashHighlight();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            slashState.selectedIndex = Math.max(slashState.selectedIndex - 1, 0);
            updateSlashHighlight();
        } else if (e.key === 'Enter') {
            if (slashState.items.length > 0) {
                e.preventDefault();
                selectSlashItem(slashState.selectedIndex);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            hideSlashDropdown();
            dom.messageInput.value = '';
        } else if (e.key === 'Backspace' && dom.messageInput.value === '/') {
            hideSlashDropdown();
        }
    } else if (modelSlashState.active) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            modelSlashState.selectedIndex = Math.min(modelSlashState.selectedIndex + 1, modelSlashState.items.length - 1);
            updateModelSlashHighlight();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            modelSlashState.selectedIndex = Math.max(modelSlashState.selectedIndex - 1, 0);
            updateModelSlashHighlight();
        } else if (e.key === 'Enter') {
            if (modelSlashState.items.length > 0) {
                e.preventDefault();
                selectModelSlashItem(modelSlashState.selectedIndex);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            hideModelSlashDropdown();
            dom.messageInput.value = '';
        } else if (e.key === 'Backspace' && dom.messageInput.value === '//') {
            hideModelSlashDropdown();
            dom.messageInput.value = '/';
            handleSlashInput();
        }
    }
}

function updateSlashHighlight() {
    dom.slashDropdownList.querySelectorAll('.slash-item').forEach((el, i) => {
        el.classList.toggle('active', i === slashState.selectedIndex);
    });
    // Scroll active into view
    const active = dom.slashDropdownList.querySelector('.slash-item.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
}

function updateModelSlashHighlight() {
    dom.modelSlashDropdownList.querySelectorAll('.slash-item').forEach((el, i) => {
        el.classList.toggle('active', i === modelSlashState.selectedIndex);
    });
    // Scroll active into view
    const active = dom.modelSlashDropdownList.querySelector('.slash-item.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
}

// ── Prompt Library Event Bindings ────────────
function bindSlashCommandEvents() {
    // Toolbar button opens manager
    dom.promptLibraryBtn?.addEventListener('click', () => openPromptManager());

    // Manager close
    dom.closePromptManager?.addEventListener('click', closePromptManager);
    dom.promptManagerModal?.addEventListener('click', (e) => {
        if (e.target === dom.promptManagerModal) closePromptManager();
    });

    // New prompt button in manager
    dom.newPromptBtn?.addEventListener('click', () => {
        pmEditingId = '__new__';
        renderPMPromptList();
    });

    // Save prompt mini-modal
    dom.closeSavePrompt?.addEventListener('click', () => dom.savePromptModal.classList.add('hidden'));
    dom.cancelSavePrompt?.addEventListener('click', () => dom.savePromptModal.classList.add('hidden'));
    dom.confirmSavePrompt?.addEventListener('click', confirmSavePrompt);
    dom.savePromptModal?.addEventListener('click', (e) => {
        if (e.target === dom.savePromptModal) dom.savePromptModal.classList.add('hidden');
    });

    // Slash commands
    dom.messageInput.addEventListener('input', handleSlashInput);
    dom.messageInput.addEventListener('keydown', handleSlashKeydown);

    // Close slash dropdowns on outside click
    document.addEventListener('click', (e) => {
        if ((slashState.active || modelSlashState.active) && !e.target.closest('.slash-dropdown') && !e.target.closest('#messageInput')) {
            hideSlashDropdown();
            hideModelSlashDropdown();
        }
    });
}

// ============================================
//  FEATURE: Extended Keyboard Shortcuts + Mobile Settings
// ============================================
(function initExtendedBindings() {
    document.addEventListener('DOMContentLoaded', () => {
        // Mobile settings button
        const mobileSettingsBtn = document.getElementById('mobileSettingsBtn');
        if (mobileSettingsBtn) {
            mobileSettingsBtn.addEventListener('click', () => {
                if (typeof openSettings === 'function') openSettings();
            });
        }
        
        // Shortcuts modal bindings
        const closeShortcuts = document.getElementById('closeShortcuts');
        const closeShortcutsBtn = document.getElementById('closeShortcutsBtn');
        const shortcutsModal = document.getElementById('shortcutsModal');
        
        [closeShortcuts, closeShortcutsBtn].forEach(btn => {
            btn?.addEventListener('click', () => shortcutsModal?.classList.add('hidden'));
        });
        
        shortcutsModal?.addEventListener('click', (e) => {
            if (e.target === shortcutsModal) shortcutsModal.classList.add('hidden');
        });
        
        // Extended keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            const ctrl = e.ctrlKey || e.metaKey;
            
            // Ctrl+K — Focus search
            if (ctrl && e.key === 'k') {
                e.preventDefault();
                const search = document.getElementById('searchChats');
                if (search) search.focus();
            }
            
            // Ctrl+, — Open settings
            if (ctrl && e.key === ',') {
                e.preventDefault();
                if (typeof openSettings === 'function') openSettings();
            }
            
            // Ctrl+E — Improve prompt
            if (ctrl && !e.shiftKey && e.key === 'e') {
                e.preventDefault();
                if (typeof improvePrompt === 'function') improvePrompt();
            }
            
            // Ctrl+Shift+E — Export current chat
            if (ctrl && e.shiftKey && e.key === 'E') {
                e.preventDefault();
                if (state.activeChatId) exportChat(state.activeChatId);
            }
            
            // Ctrl+/ — Show shortcuts
            if (ctrl && e.key === '/') {
                e.preventDefault();
                if (shortcutsModal) shortcutsModal.classList.remove('hidden');
            }
            
            // Escape — close shortcuts modal too
            if (e.key === 'Escape') {
                shortcutsModal?.classList.add('hidden');
            }
        });
    });
})();
// wIA Dynamic Version Hook Trigger
