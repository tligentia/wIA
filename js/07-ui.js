/* >>> imports (generado por scripts/gen-modules.mjs: no editar a mano) >>> */
// El primer import es el del módulo anterior: así se evalúan en orden (ver scripts/gen-modules.mjs).
import {
    improvePrompt, renderMessages, sendMessage, showMetricsModal, stopStreaming,
} from './06-chat.js?v=2610.AF';
import {
    PROVIDERS, WEBGPU_MODELS, applyProviderNames, debounce, escapeHtml, getDefaultProviderName,
    isCloneableProvider, isCustomProvider, notify, tr, trf,
} from './01-core.js?v=2610.AF';
import {
    $, $$, applyImportedSettings, applyPostResetUI, applySettingsToUI, applyTheme,
    backupCrypto, chatStore, cloneProvider, deleteCustomProvider, describeDroppedKeys, dom,
    getActiveProviderConfig, getAuthHeaders, getOrderedProviderEntries, getProviderDef, init,
    isConversationPersistenceDisabled, markProviderUsed, purgeConversationStore,
    renameProvider, renderProviderOptions, resetProjectsAndChatsState,
    saveCurrentProviderConfig, saveState, saveStateNow, secretVault, settingsWithoutSecrets,
    state, syncProviderToState, updateApiKeyFormatHint, updateModelContextIndicator,
    updateProviderUI, updateProviderUrlSuggestion, updateStatusMeta,
} from './02-state.js?v=2610.AF';
import {
    loadWebGPUModel, releaseWebGPUMemory, renderVisionChain, renderWebGPUMonitor,
    scheduleWebGPUPriming, warmUpActiveWebGPUModel, webgpuState, webgpuWorker,
} from './03-webgpu.js?v=2610.AF';
import {
    addManualWebGPUModel, checkProviderStatus, discoverWebGPUModels, getEngineCooldown,
    openModelManager, populateModels, prepareModelPanelForProvider, pullModel,
    setConnectionValidationFeedback, startProviderOAuth, updateVisionIndicator,
} from './04-providers.js?v=2610.AF';
import {
    applyAgentEngine, clearOrderQueue, createChatFromUI, createProject, deleteChat,
    deleteProject, duplicateProject, exportAgentToFile, findInstalledCatalogAgent,
    getActiveChat, getEditingProject, handleFiles, handleProjectFiles, installAgentDefinition,
    openProjectEditor, removeAttachment, removeOrder, renderAgentCatalog, renderAgentsGallery,
    renderChatList, renderOrderQueue, renderProjectSelect, renderWelcomeStarters,
    runOrderQueue, runSingleOrder, switchChat, switchProject, tryQueueOrder,
} from './05-workspace.js?v=2610.AF';
import {
    anonChatState, anonymizeHistoryText, renderAnonTypesPanel, restoreAnonText,
} from './08-anon.js?v=2610.AF';
import {
    setLanguage,
} from './09-i18n.js?v=2610.AF';
/* <<< imports <<< */

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

// ─── Delegación de manejadores ──────────────
// La app no usa NI UN atributo on*: todos los manejadores se enlazan aquí por
// delegación. Eso permite servir una Content-Security-Policy sin
// 'unsafe-inline' en script-src —que es lo que convierte una inyección de HTML
// en ejecución de código— y elimina de paso la fragilidad de interpolar datos
// del usuario dentro de una cadena JavaScript.

/** Abrir y cerrar diálogos: data-close-modal / data-open-modal. */
function bindModalDelegation() {
    document.addEventListener('click', (event) => {
        const closeId = event.target.closest('[data-close-modal]')?.dataset.closeModal;
        if (closeId) {
            document.getElementById(closeId)?.classList.add('hidden');
            return;
        }
        const openId = event.target.closest('[data-open-modal]')?.dataset.openModal;
        if (openId) document.getElementById(openId)?.classList.remove('hidden');
    });
}

/** Acciones sobre los mensajes del chat (copiar, reintentar, marcar…). */
function bindMessageActionDelegation() {
    if (!dom.messagesScroll) return;

    const runAction = (button) => {
        const action = button.dataset.msgAction;
        const idx = Number.parseInt(button.dataset.idx, 10);
        switch (action) {
            case 'copy':           copyFullResponse(idx, button); break;
            case 'download-md':    downloadResponseMarkdown(idx); break;
            case 'anon-copy':      copyAnonymizedText(idx, button); break;
            case 'anon-download':  downloadAnonymizedText(idx); break;
            case 'regenerate':     regenerateResponse(idx); break;
            case 'edit':           editMessage(idx); break;
            case 'bookmark':       toggleBookmark(idx); break;
            case 'save-prompt':    saveMessageAsPrompt(idx); break;
            case 'metrics':        showMetricsModal(idx); break;
            case 'retry':          retryMessage(idx); break;
            case 'apply-proposal': applyProposal(idx); break;
            case 'fallback':       fallbackToModel(idx, button.dataset.provider, button.dataset.model); break;
            case 'copy-url':       copyText(button.dataset.url, button); break;
        }
    };

    dom.messagesScroll.addEventListener('click', (event) => {
        const button = event.target.closest('[data-msg-action]');
        if (!button) return;
        event.stopPropagation();
        runAction(button);
    });

    // La chapa de métricas es un <span>: sin esto no sería accesible por teclado.
    dom.messagesScroll.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const button = event.target.closest('[data-msg-action][role="button"]');
        if (!button) return;
        event.preventDefault();
        runAction(button);
    });
}

/** Quitar documentos de la base de conocimiento del proyecto. */
function bindProjectDocDelegation() {
    dom.projectDocList?.addEventListener('click', (event) => {
        const id = event.target.closest('[data-remove-doc]')?.dataset.removeDoc;
        if (id) removeProjectDoc(id);
    });
}

// ─── Event Bindings ─────────────────────────
function bindEvents() {
    bindModalDelegation();
    bindMessageActionDelegation();
    bindProjectDocDelegation();

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

    // Escalonado del precalentado WebGPU, de menos a más compromiso:
    //   · foco en la caja  → runtime (barato, unos MB, sin tocar el modelo)
    //   · empieza a teclear → modelo completo en segundo plano
    // Al enfocar aún no sabemos si va a escribir, así que solo se adelanta lo
    // que sirve para cualquier modelo; la descarga de pesos espera a que haya
    // intención real.
    dom.messageInput.addEventListener('focus', () => {
        if (typeof scheduleWebGPUPriming === 'function') scheduleWebGPUPriming();
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
        dom.modelSelect.innerHTML = `<option value="${escapeHtml(state.settings.model)}" selected>${escapeHtml(state.settings.model)}</option>`;
        
        updateProviderUI();
        renderProviderOptions();
        updateStatusMeta();
        saveState();
        // Al elegir WebGPU se adelanta el runtime: mientras el usuario termina
        // de configurar, el coste fijo de la primera carga ya se está pagando.
        if (typeof scheduleWebGPUPriming === 'function') scheduleWebGPUPriming();
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

    // ─── Clonar / renombrar / eliminar conexiones ───
    // El diálogo es propio de la app (#engineCopyModal). prompt()/confirm() no
    // valen aquí: el navegador los ignora SIN avisar cuando la página va dentro
    // de un iframe sin allow-modals (el portal) o si el usuario marcó alguna vez
    // «impedir que esta página cree más diálogos», y el botón parecía muerto.
    let engineCopyMode = null;   // 'clone' | 'rename' | 'delete'
    let engineCopyTarget = null;

    function closeEngineCopyModal() {
        engineCopyMode = null;
        engineCopyTarget = null;
        dom.engineCopyModal?.classList.add('hidden');
    }

    function openEngineCopyModal(mode, providerId) {
        if (!dom.engineCopyModal) return;
        engineCopyMode = mode;
        engineCopyTarget = providerId;
        const name = getProviderDef(providerId).name;
        const asksName = mode !== 'delete';

        if (dom.engineCopyTitle) {
            dom.engineCopyTitle.textContent = mode === 'clone'
                ? tr('engine.clone.action', 'Duplicar conexión')
                : (mode === 'rename' ? tr('engine.rename.action', 'Renombrar motor')
                                     : tr('engine.delete.action', 'Eliminar copia'));
        }
        if (dom.engineCopyMessage) {
            const template = mode === 'clone'
                ? tr('engine.clone.intro', 'Se creará una conexión nueva partiendo de «{name}», con su misma URL, credencial y modelo. Podrás cambiarlos sin afectar al original.')
                : (mode === 'rename'
                    ? (isCustomProvider(providerId)
                        ? tr('engine.rename.introCopy', 'Cambia el nombre con el que aparece «{name}» en la lista de motores.')
                        : tr('engine.rename.intro', 'Cambia el nombre con el que aparece «{name}» en la lista de motores. Déjalo vacío para recuperar el nombre de fábrica.'))
                    : tr('engine.delete.confirm', '¿Eliminar la copia «{name}»? Se borrarán su URL, su credencial y su modelo memorizados. Los motores de serie no se tocan.'));
            dom.engineCopyMessage.textContent = template.replace('{name}', name);
        }
        if (dom.engineCopyName) {
            dom.engineCopyName.value = mode === 'clone' ? `${name} 2` : name;
            dom.engineCopyName.placeholder = mode === 'rename' && !isCustomProvider(providerId)
                ? getDefaultProviderName(providerId)
                : '';
            dom.engineCopyName.hidden = !asksName;
        }
        if (dom.engineCopyNameLabel) dom.engineCopyNameLabel.hidden = !asksName;
        if (dom.engineCopyConfirm) {
            dom.engineCopyConfirm.textContent = mode === 'delete'
                ? tr('engine.delete.action', 'Eliminar copia')
                : tr('engine.copy.confirm', 'Aceptar');
            dom.engineCopyConfirm.className = mode === 'delete' ? 'btn-danger' : 'btn-primary';
        }

        dom.engineCopyModal.classList.remove('hidden');
        if (asksName) {
            dom.engineCopyName?.focus();
            dom.engineCopyName?.select();
        } else {
            dom.engineCopyConfirm?.focus();
        }
    }

    // Refresca los controles de Ajustes tras cambiar de motor activo.
    function refreshConnectionPanel({ revalidate = true } = {}) {
        prepareModelPanelForProvider(state.settings.provider);
        if (dom.ollamaUrl) dom.ollamaUrl.value = state.settings.ollamaUrl;
        if (dom.apiKeyInput) dom.apiKeyInput.value = state.settings.apiKey || '';
        if (dom.modelSelect) {
            const model = state.settings.model || '';
            dom.modelSelect.innerHTML = `<option value="${escapeHtml(model)}" selected>${escapeHtml(model)}</option>`;
        }
        updateProviderUI();
        renderProviderOptions();
        updateStatusMeta();
        saveState();
        if (revalidate) validateCurrentProviderConnection({ persist: false });
    }

    function applyEngineCopyModal() {
        const mode = engineCopyMode;
        const providerId = engineCopyTarget;
        const name = dom.engineCopyName?.value || '';
        if (!mode || !providerId) return;

        if (mode === 'clone') {
            // Se guarda la config del origen ANTES de clonar: lo que el usuario
            // tenga escrito en URL/clave sin guardar debe viajar a la copia.
            saveCurrentProviderConfig();
            const newId = cloneProvider(providerId, name);
            if (!newId) return;
            closeEngineCopyModal();
            // Se salta directamente a la copia: es lo que va a editar a
            // continuación, y el original queda intacto.
            state.settings.provider = newId;
            syncProviderToState();
            refreshConnectionPanel();
            return;
        }

        if (mode === 'rename') {
            // renameProvider acepta también los motores de serie, y con el
            // nombre vacío les devuelve el de fábrica.
            if (!renameProvider(providerId, name)) return;
            closeEngineCopyModal();
            renderProviderOptions();
            updateProviderUI();
            updateStatusMeta();
            saveState();
            return;
        }

        deleteCustomProvider(providerId);
        closeEngineCopyModal();
        refreshConnectionPanel();
    }

    dom.providerCloneBtn?.addEventListener('click', () => {
        const sourceId = state.settings.provider;
        if (!isCloneableProvider(sourceId)) return;
        openEngineCopyModal('clone', sourceId);
    });

    dom.providerRenameBtn?.addEventListener('click', () => {
        openEngineCopyModal('rename', state.settings.provider);
    });

    dom.providerDeleteBtn?.addEventListener('click', () => {
        if (!isCustomProvider(state.settings.provider)) return;
        openEngineCopyModal('delete', state.settings.provider);
    });

    dom.engineCopyConfirm?.addEventListener('click', applyEngineCopyModal);
    dom.engineCopyName?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        applyEngineCopyModal();
    });
    $$('.close-engine-copy-modal').forEach(btn => btn.addEventListener('click', closeEngineCopyModal));
    dom.engineCopyModal?.addEventListener('click', (event) => {
        if (event.target === dom.engineCopyModal) closeEngineCopyModal();
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

    dom.apiKeyInput?.addEventListener('input', () => {
        markConnectionValidationPending();
        updateApiKeyFormatHint();
    });
    dom.ollamaUrl?.addEventListener('input', () => {
        markConnectionValidationPending();
        updateApiKeyFormatHint();
        // La propuesta aparece o desaparece según se aleje o vuelva al oficial.
        updateProviderUrlSuggestion();
    });

    dom.providerOauthBtn?.addEventListener('click', async () => {
        // Lo escrito sin guardar (URL, modelo) se persiste antes de salir: la
        // navegación al proveedor recarga la app entera al volver.
        saveCurrentProviderConfig();
        saveState();
        await startProviderOAuth(state.settings.provider);
    });

    dom.providerUrlSuggestBtn?.addEventListener('click', () => {
        const official = getProviderDef(state.settings.provider).defaultUrl || '';
        if (!official || !dom.ollamaUrl) return;
        dom.ollamaUrl.value = official;
        state.settings.ollamaUrl = official;
        saveCurrentProviderConfig();
        markConnectionValidationPending();
        updateProviderUrlSuggestion();
        updateApiKeyFormatHint();
        dom.ollamaUrl.focus();
        saveState();
    });

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
            // Sin API keys, igual que la copia de seguridad completa: el
            // fichero acaba en Descargas, en un correo o en un chat, y las
            // claves no deben viajar en claro con él.
            const data = JSON.stringify(settingsWithoutSecrets(state.settings), null, 2);
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
                        const droppedKeys = applyImportedSettings(importedSettings);
                        state.incognitoSessionActive = !!state.settings.incognitoMode || state.incognitoSessionActive;
                        saveState();
                        applySettingsToUI();
                        checkProviderStatus();
                        const notice = describeDroppedKeys(droppedKeys);
                        alert(tr('import.settingsRestored', 'Ajustes restaurados. Tus API keys guardadas se conservan.') + (notice ? '\n\n' + notice : ''));
                    } else {
                        notify(trf('dlg.settings.invalid', 'El archivo no parece contener ajustes válidos de wIA.'), 'error');
                    }
                } catch (err) {
                    notify(trf('dlg.settings.readError', 'Error al leer el archivo de configuración: {p0}', { p0: err.message }), 'error');
                }
            };
            reader.readAsText(file);
            dom.importSettingsFile.value = '';
        });
    }

    // ─── Copia de seguridad COMPLETA (proyectos, agentes, chats, ajustes) ───
    if (dom.exportAllBtn) {
        dom.exportAllBtn.addEventListener('click', () => exportFullBackup().catch(err => notify(trf('dlg.backup.exportError', 'Error al exportar: {p0}', { p0: err.message }), 'error')));
    }

    if (dom.importAllBtn) {
        dom.importAllBtn.addEventListener('click', () => dom.importAllFile.click());
        dom.importAllFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                importFullBackup(ev.target.result).catch(err => notify(trf('dlg.backup.readError', 'Error al leer la copia de seguridad: {p0}', { p0: err.message }), 'error'));
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
        // Debounce: cada pulsación reconstruye toda la rejilla de tarjetas
        // (el catálogo de OpenRouter pasa de 300 modelos).
        dom.modelSearchInput.addEventListener('input', debounce(() => {
            if (state.rawModels) populateModels(state.rawModels);
        }, 180));
    }

    dom.webgpuAddModelBtn?.addEventListener('click', () => {
        if (!addManualWebGPUModel(dom.webgpuManualModelInput?.value || '')) return;
        if (dom.webgpuManualModelInput) dom.webgpuManualModelInput.value = '';
        checkProviderStatus();
    });

    dom.webgpuDiscoverBtn?.addEventListener('click', () => discoverWebGPUModels());

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
        if (!loaded && !webgpuState.isLoading) { notify(trf('dlg.webgpu.noneLoaded', 'No hay ningún modelo cargado en memoria ahora mismo.'), 'info'); return; }
        releaseWebGPUMemory();
    });

    document.getElementById('webgpuPrepareBtn')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const modelId = state.settings.model;
        const modelDef = WEBGPU_MODELS.find(m => m.id === modelId);
        if (!modelDef) { notify(trf('dlg.webgpu.pickFirst', 'Selecciona primero un modelo WebGPU.'), 'info'); return; }
        if (webgpuState.loadedModelId === modelId) { notify(trf('dlg.webgpu.alreadyLoaded', 'El modelo ya está cargado y listo.'), 'info'); return; }
        if (webgpuState.isLoading) { notify(trf('dlg.webgpu.loading', 'Ya hay una carga en curso.'), 'info'); return; }
        const original = btn.textContent;
        btn.disabled = true; btn.textContent = '⏳ Preparando…';
        try {
            const task = modelDef.task || 'text-generation';
            await loadWebGPUModel(modelId, () => { try { renderWebGPUMonitor(); } catch (err) {} }, task);
            renderWebGPUMonitor();
        } catch (err) {
            console.warn('[WebGPU] preparar modelo falló:', err);
            notify(trf('dlg.webgpu.prepareError', 'No se pudo preparar el modelo: {p0}', { p0: (err?.message || err) }), 'error');
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
                notify(e.message, 'error');
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
        // Los motores vuelven a llamarse como de fábrica; las copias creadas por
        // el usuario NO se borran aquí (para eso está su propio botón eliminar).
        state.settings.providerNames = {};
        applyProviderNames(state.settings.providerNames);
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
        if (!confirm(trf('dlg.history.confirmClear', '⚠️ ¿Seguro que quieres borrar todo el historial, chats, proyectos y documentos persistentes? Tus ajustes se conservarán.'))) return;

        resetProjectsAndChatsState();
        localStorage.removeItem('antigravity_chats');
        localStorage.removeItem('antigravity_projects');
        purgeConversationStore().then(() => saveState());
        applyPostResetUI({ preserveSettings: true });
        notify(trf('dlg.history.cleared', 'Historial limpiado. Tus ajustes se han conservado.'), 'info');
    });

    $('#factoryResetBtn')?.addEventListener('click', async () => {
        if (!confirm(trf('dlg.factory.confirm', '⚠️ ¿Estás completamente seguro de que quieres restaurar wIA de fábrica? Se borrarán historial, proyectos y ajustes.'))) return;

        localStorage.removeItem('antigravity_chats');
        localStorage.removeItem('antigravity_projects');
        localStorage.removeItem('antigravity_settings');
        await purgeConversationStore(); // si IDB falla, el reload sigue adelante
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
        proj.agentAnonymize = !!dom.projectAnonymize?.checked;
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
        if (confirm(trf('dlg.project.confirmDelete', '¿Estás seguro de que quieres eliminar el agente/proyecto {p0} y TODOS sus chats contenidos?', { p0: proj.name }))) {
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
                const extra = warnings.length ? trf('dlg.agent.warnings', '\n\nAvisos:\n· {p0}', { p0: warnings.join('\n· ') }) : '';
                notify(trf('dlg.agent.imported', 'Agente «{p0}» importado y activado.', { p0: project.name }) + extra, 'info');
            } catch (err) {
                notify(trf('dlg.agent.importError', 'No se pudo importar el agente: {p0}', { p0: err.message }), 'error');
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
        // Ya instalado: se activa el que hay en vez de crear un duplicado.
        const existing = findInstalledCatalogAgent(def);
        if (existing) {
            switchProject(existing.id);
            renderAgentsGallery();
            dom.agentsModal.classList.add('hidden');
            return;
        }
        const { project } = installAgentDefinition(def, { activate: false });
        project.catalogName = def.name;
        saveState();
        switchProject(project.id);
        dom.agentsModal.classList.add('hidden');
        notify(trf('dlg.agent.installed', 'Agente «{p0}» instalado desde el catálogo y activado.', { p0: project.name }), 'info');
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
        const dupBtn = e.target.closest('[data-duplicate-agent]');
        if (dupBtn) {
            e.stopPropagation();
            const copy = duplicateProject(dupBtn.dataset.duplicateAgent);
            if (copy) openProjectEditor(copy.id);
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
            `<option value="${escapeHtml(p.id)}" ${p.id === currentChat.projectId ? 'disabled' : ''}>${escapeHtml(p.name)} ${p.id === currentChat.projectId ? '(Actual)' : ''}</option>`
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

// ─── Accesibilidad: etiquetas, foco en diálogos ─────────────────────────
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const visibleFocusables = (root) => [...root.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement);

function initA11y() {
    // 1) Botones de solo icono creados dinámicamente: su nombre accesible es su title.
    const labelIconButtons = (root) => {
        const list = root.matches?.('button[title]:not([aria-label])') ? [root] : [];
        root.querySelectorAll?.('button[title]:not([aria-label])').forEach(b => list.push(b));
        for (const b of list) {
            if ((b.textContent || '').replace(/[\s\W_]/g, '').length <= 2) b.setAttribute('aria-label', b.getAttribute('title'));
        }
    };
    labelIconButtons(document.body);
    new MutationObserver((muts) => {
        for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) labelIconButtons(n);
    }).observe(document.body, { childList: true, subtree: true });

    // 2) Diálogos: al abrir, el foco entra; al cerrar, vuelve a donde estaba.
    const previousFocus = new WeakMap();
    const watch = (overlay) => {
        new MutationObserver(() => {
            const open = !overlay.classList.contains('hidden');
            if (open && !overlay._wiaOpen) {
                overlay._wiaOpen = true;
                previousFocus.set(overlay, document.activeElement);
                const target = visibleFocusables(overlay).find(el => !el.matches('.close-btn, [aria-label="Cerrar"]')) || overlay.querySelector('.modal');
                if (target) { if (!target.hasAttribute('tabindex') && target.classList.contains('modal')) target.tabIndex = -1; target.focus?.(); }
            } else if (!open && overlay._wiaOpen) {
                overlay._wiaOpen = false;
                const prev = previousFocus.get(overlay);
                if (prev && document.contains(prev)) prev.focus?.();
            }
        }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
    };
    document.querySelectorAll('.modal-overlay').forEach(watch);

    // 3) Tab no sale del diálogo abierto; Escape lo cierra (si no lo hace ya otro manejador).
    document.addEventListener('keydown', (e) => {
        // Con varios diálogos apilados, el activo es el que contiene el foco (si no,
        // el último abierto): un Escape cierra UNO, no todos.
        const openOnes = [...document.querySelectorAll('.modal-overlay:not(.hidden)')];
        const open = openOnes.find(o => o.contains(document.activeElement)) || openOnes.pop();
        if (!open) return;
        if (e.key === 'Tab') {
            const items = visibleFocusables(open);
            if (!items.length) { e.preventDefault(); return; }
            const first = items[0], last = items[items.length - 1];
            if (e.shiftKey && (document.activeElement === first || !open.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && (document.activeElement === last || !open.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
        } else if (e.key === 'Escape') {
            // Otros manejadores (ajustes, borrado, gestor de modelos) cierran los suyos; para el resto:
            setTimeout(() => {
                if (open.classList.contains('hidden') || !document.contains(open)) return;
                (open.querySelector('[class*="close-"], .modal-header .btn-icon, [data-close-modal]') || open.querySelector('.btn-secondary'))?.click();
            }, 0);
        }
    });
}

// ─── Start ──────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    try { initA11y(); } catch (e) { console.warn('[a11y] no se pudo iniciar:', e); }
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
    const text = responseTextForExport(chat, chat.messages[idx]);
    navigator.clipboard.writeText(text).then(() => {
        btn.classList.add('copied-feedback');
        const orig = btn.innerHTML;
        btn.innerHTML = '✅ Copiado';
        setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied-feedback'); }, 2000);
    });
};

/**
 * responseTextForExport — el texto de una respuesta tal como se ve en pantalla.
 * Con 🕶️ activo el modelo contesta con marcadores ([Nombre_001]) y solo se
 * restauran al pintar; copiar o descargar sin restaurarlos entregaría
 * marcadores en vez de los datos del propio usuario.
 */
function responseTextForExport(chat, msg) {
    const raw = msg.content || '';
    return typeof restoreAnonText === 'function' ? restoreAnonText(raw, chat) : raw;
}

/** Nombre de fichero seguro a partir del título del chat. */
function chatFileStem(chat) {
    const title = String(chat?.title || 'chat').replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, '').trim().replace(/\s+/g, '_');
    return `wIA_${title.substring(0, 40) || 'chat'}`;
}

/** Entrega `text` al usuario como descarga de un fichero. */
function downloadTextFile(text, filename, mime = 'text/plain') {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================
//  FEATURE: descargar la respuesta como .md
// ============================================
window.downloadResponseMarkdown = function(idx) {
    const chat = getActiveChat();
    const msg = chat?.messages[idx];
    if (!msg) return;
    const text = responseTextForExport(chat, msg);
    if (!text.trim()) return;
    downloadTextFile(text, `${chatFileStem(chat)}_respuesta_${Date.now()}.md`, 'text/markdown');
};

// ============================================
//  FEATURE: texto anonimizado (copiar / descargar)
//  El contenido guardado del mensaje del usuario ES el texto anonimizado:
//  lo que se envió a la IA, con marcadores en lugar de los datos reales.
// ============================================
window.copyAnonymizedText = function(idx, btn) {
    const chat = getActiveChat();
    const text = chat?.messages[idx]?.content || '';
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        const orig = btn.innerHTML;
        btn.classList.add('copied-feedback');
        btn.textContent = tr('anon.text.copied', '✅ Copiado');
        setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied-feedback'); }, 2000);
    });
};

window.downloadAnonymizedText = function(idx) {
    const chat = getActiveChat();
    const text = chat?.messages[idx]?.content || '';
    if (!text) return;
    downloadTextFile(text, `${chatFileStem(chat)}_anonimizado_${Date.now()}.txt`, 'text/plain');
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

// ─── Copias de seguridad: contraseña, exportar, restaurar ───────────────

/**
 * askPassphrase — diálogo propio para pedir una contraseña sin mostrarla.
 * Devuelve el texto, '' si se elige «sin contraseña» (solo con allowSkip) o
 * null si se cancela.
 */
function askPassphrase({ title, message, confirmField = false, allowSkip = false }) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        const box = document.createElement('div');
        box.className = 'modal modal-small';
        const mk = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text) el.textContent = text; return el; };
        const header = mk('div', 'modal-header');
        header.appendChild(mk('h2', '', title));
        const body = mk('div', 'modal-body');
        const msg = mk('p', 'setting-help-text', message);
        const pass1 = mk('input', 'setting-input'); pass1.type = 'password'; pass1.autocomplete = 'new-password';
        pass1.placeholder = tr('backup.pass.placeholder', 'Contraseña');
        pass1.setAttribute('aria-label', pass1.placeholder);
        const pass2 = confirmField ? mk('input', 'setting-input') : null;
        if (pass2) {
            pass2.type = 'password'; pass2.autocomplete = 'new-password';
            pass2.placeholder = tr('backup.pass.repeat', 'Repite la contraseña');
            pass2.setAttribute('aria-label', pass2.placeholder);
            pass2.style.marginTop = '8px';
        }
        const err = mk('div', 'setting-help-text'); err.style.color = 'var(--danger)'; err.setAttribute('role', 'alert');
        const actions = mk('div', 'modal-actions');
        actions.style.cssText = 'margin-top:16px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;';
        const bCancel = mk('button', 'btn-secondary', tr('backup.pass.cancel', 'Cancelar'));
        const bSkip = allowSkip ? mk('button', 'btn-secondary', tr('backup.pass.skip', 'Sin contraseña')) : null;
        const bOk = mk('button', 'btn-primary', tr('backup.pass.ok', 'Aceptar'));
        [bCancel, bSkip, bOk].forEach(b => { if (b) { b.type = 'button'; actions.appendChild(b); } });
        body.append(msg, pass1, ...(pass2 ? [pass2] : []), err, actions);
        box.append(header, body);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        pass1.focus();

        const done = (v) => { overlay.remove(); resolve(v); };
        const submit = () => {
            const v = pass1.value;
            if (!v) { err.textContent = tr('backup.pass.empty', 'Escribe una contraseña.'); return; }
            if (confirmField) {
                if (v.length < 8) { err.textContent = tr('backup.pass.short', 'Usa al menos 8 caracteres.'); return; }
                if (v !== pass2.value) { err.textContent = tr('backup.pass.mismatch', 'Las contraseñas no coinciden.'); return; }
            }
            done(v);
        };
        bOk.addEventListener('click', submit);
        bCancel.addEventListener('click', () => done(null));
        if (bSkip) bSkip.addEventListener('click', () => done(''));
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submit();
            else if (e.key === 'Escape') { e.stopPropagation(); done(null); }
        });
    });
}

/**
 * exportFullBackup — descarga todos los datos. Si algún chat usa
 * anonimización, su mapa de marcadores (datos reales) viaja DENTRO del fichero
 * para poder revertirlos en otro navegador, y por eso solo se incluye cifrado
 * con contraseña. Sin contraseña la copia sale igualmente, pero sin esos mapas.
 */
async function exportFullBackup() {
    const anonMaps = {};
    for (const chat of state.chats) {
        if (!chat.anonVault) continue;
        try {
            const dec = await secretVault.decrypt(chat.anonVault);
            if (dec) anonMaps[chat.id] = JSON.parse(dec);
        } catch (_) { /* mapa ilegible: esa conversación no podrá revertirse */ }
    }
    const hasMaps = Object.keys(anonMaps).length > 0;

    let passphrase = '';
    if (backupCrypto.available()) {
        passphrase = await askPassphrase({
            title: tr('backup.pass.exportTitle', 'Proteger la copia'),
            message: hasMaps
                ? tr('backup.pass.exportMaps', 'Algunos chats usan anonimización. Con contraseña, la copia incluye los datos reales para poder restaurarlos en otro navegador. Sin contraseña, esos datos NO se incluyen y los marcadores no podrán revertirse fuera de este navegador.')
                : tr('backup.pass.exportMsg', 'Puedes cifrar la copia con una contraseña. Guárdala: si la pierdes, no hay forma de recuperar el contenido.'),
            confirmField: true,
            allowSkip: true,
        });
        if (passphrase === null) return;
    } else if (hasMaps) {
        alert(tr('backup.noCrypto', 'Esta página no está en un contexto seguro (HTTPS o localhost): no se puede cifrar la copia. Saldrá sin los mapas de anonimización.'));
    }

    const includeMaps = hasMaps && !!passphrase;
    const backup = {
        _type: 'wia-backup',
        _version: window.APP_VERSION || '',
        _exportedAt: new Date().toISOString(),
        _note: 'API keys excluidas por seguridad; vuelve a introducirlas tras importar.',
        projects: state.projects,
        // El `anonVault` va cifrado con la clave de ESTE navegador: fuera de él es
        // ilegible, así que se sustituye por el mapa (solo dentro de un sobre cifrado).
        chats: state.chats.map(({ anonVault, ...rest }) => rest),
        activeProjectId: state.activeProjectId,
        orderQueue: state.orderQueue || [],
        settings: settingsWithoutSecrets(state.settings),
    };
    if (includeMaps) backup.anonMaps = anonMaps;

    const stamp = new Date().toISOString().slice(0, 10);
    const out = passphrase
        ? await backupCrypto.seal(backup, passphrase, { _version: backup._version, _exportedAt: backup._exportedAt })
        : backup;
    const blob = new Blob([JSON.stringify(out, null, passphrase ? 0 : 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wIA_backup_${stamp}${passphrase ? '.cifrada' : ''}.json`;
    a.click();
    URL.revokeObjectURL(url);
    if (hasMaps && !includeMaps) {
        alert(tr('backup.mapsOmitted', 'Copia descargada SIN los mapas de anonimización: los marcadores ([Nombre_001]…) no podrán revertirse fuera de este navegador.'));
    }
}

/** importFullBackup — restaura una copia (cifrada o no) tras confirmar. */
async function importFullBackup(text) {
    let data = JSON.parse(text);
    if (data && data._type === 'wia-backup-enc') {
        if (!backupCrypto.available()) {
            alert(tr('backup.noCrypto.import', 'Para abrir una copia cifrada hace falta HTTPS o localhost.'));
            return;
        }
        let opened = null;
        let message = tr('backup.pass.importMsg', 'Esta copia está cifrada. Escribe su contraseña.');
        while (!opened) {
            const pass = await askPassphrase({ title: tr('backup.pass.importTitle', 'Copia cifrada'), message });
            if (pass === null) return;
            try { opened = await backupCrypto.open(data, pass); }
            catch (e) {
                if (e.message === 'bad-envelope') { alert(tr('backup.bad', 'El archivo de copia cifrada no es válido.')); return; }
                message = tr('backup.pass.wrong', 'Contraseña incorrecta, o el archivo está dañado. Inténtalo de nuevo.');
            }
        }
        data = opened;
    }
    if (!data || data._type !== 'wia-backup' || !Array.isArray(data.projects) || !Array.isArray(data.chats)) {
        notify(trf('dlg.backup.notBackup', 'El archivo no parece una copia de seguridad completa de wIA.'), 'error');
        return;
    }
    // Lo que viene en un fichero es dato ajeno: se descarta lo que no tenga la
    // forma mínima (ids de texto, mensajes en lista) en vez de dejar que rompa la
    // interfaz o se cuele en atributos HTML.
    const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
    data.projects = data.projects.filter(p => isObj(p) && typeof p.id === 'string' && p.id && typeof p.name === 'string')
        .map(p => ({ ...p, documents: Array.isArray(p.documents) ? p.documents.filter(d => isObj(d) && typeof d.id === 'string') : [] }));
    data.chats = data.chats.filter(c => isObj(c) && typeof c.id === 'string' && c.id && Array.isArray(c.messages))
        .map(c => ({ ...c, title: typeof c.title === 'string' ? c.title : 'Conversación', messages: c.messages.filter(m => isObj(m) && typeof m.role === 'string') }));
    if (!data.projects.some(p => p.id === 'general')) data.projects.unshift({ id: 'general', name: 'General', systemPrompt: '', documents: [] });
    const n = data.projects.length + data.chats.length;
    if (!confirm(trf('dlg.backup.confirmReplace', 'Esto REEMPLAZARÁ tus proyectos, agentes y chats actuales por los del archivo ({p0} proyectos, {p1} chats). Tus API keys se conservan. ¿Continuar?', { p0: data.projects.length, p1: data.chats.length }))) return;

    state.projects = data.projects;
    state.chats = data.chats;
    state.chats.forEach(c => { if (!c.projectId) c.projectId = 'general'; });

    // Mapas de anonimización: se vuelven a cifrar con la clave de ESTE navegador.
    // El estado en memoria de los chats anteriores deja de valer.
    for (const k of Object.keys(anonChatState)) delete anonChatState[k];
    let restoredMaps = 0;
    if (data.anonMaps && typeof data.anonMaps === 'object') {
        for (const chat of state.chats) {
            const map = data.anonMaps[chat.id];
            if (map && typeof map === 'object') {
                chat.anonVault = await secretVault.encrypt(JSON.stringify(map));
                restoredMaps++;
            }
        }
    }

    // Conserva las API keys actuales (el backup no las incluye),
    // salvo las de motores a los que el fichero cambia la URL.
    const droppedKeys = data.settings ? applyImportedSettings(data.settings) : [];
    if (data.activeProjectId && state.projects.find(p => p.id === data.activeProjectId)) {
        state.activeProjectId = data.activeProjectId;
    } else if (!state.projects.find(p => p.id === state.activeProjectId)) {
        state.activeProjectId = state.projects[0]?.id || 'general';
    }
    if (Array.isArray(data.orderQueue)) state.orderQueue = data.orderQueue;
    chatStore.projectsLocked = false; // el usuario ha elegido qué conservar
    await saveStateNow({ full: true });
    applySettingsToUI();
    renderProjectSelect();
    renderChatList();
    if (typeof renderOrderQueue === 'function') renderOrderQueue();
    // force: los chats se han sustituido en bloque; un chat
    // restaurado puede conservar el mismo id y contenido distinto.
    if (typeof renderMessages === 'function') renderMessages({ force: true });
    const notice = describeDroppedKeys(droppedKeys);
    notify(trf('dlg.backup.restored', 'Copia de seguridad restaurada: {p0} elementos. Recuerda revisar tus API keys en Ajustes.', { p0: n })
        + (restoredMaps ? '\n\n' + trf('dlg.backup.mapsRestored', '🕶️ Se han restaurado los mapas de anonimización de {p0} chat(s).', { p0: restoredMaps }) : '')
        + (notice ? '\n\n' + notice : ''), 'info');
}

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
                notify(trf('dlg.chat.importInvalid', 'Error al importar: archivo JSON inválido'), 'error');
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
    // Un error («⚠️ …») no resume la conversación: no se gasta otra petición en titularla.
    if (assistantMsg.content.startsWith('⚠️')) return;
    
    // Mark to prevent re-running
    chat.autoTitled = true;
    
    const providerDef = getProviderDef(state.settings.provider);
    if (!providerDef) return;
    // Titular es accesorio: si el motor acaba de fallar (y la respuesta vino de
    // otro por el failover), no se le manda otra petición que fallará igual.
    if (typeof getEngineCooldown === 'function' && getEngineCooldown(state.settings.provider, state.settings.model) > 0) return;
    
    // El título también viaja al motor: con 🕶️ activo, igual que el resto.
    let titleUser = userMsg.content;
    let titleAssistant = assistantMsg.content;
    if (state.settings.anonymizeOutgoing) {
        try {
            titleUser = anonymizeHistoryText(titleUser, chat);
            titleAssistant = anonymizeHistoryText(titleAssistant, chat);
        } catch (_) { return; } // sin anonimizador, mejor sin título automático
    }
    const titlePrompt = `Genera un título muy breve (máximo 6 palabras) que resuma esta conversación. Responde SOLO con el título, sin comillas ni puntuación extra.\n\nUsuario: ${titleUser.substring(0, 200)}\nAsistente: ${titleAssistant.substring(0, 200)}`;
    
    try {
        const type = providerDef.type;
        const url = state.settings.ollamaUrl;
        const headers = getAuthHeaders();
        let title = '';
        
        // Titular es accesorio: con timeout para que un motor lento no deje una
        // petición colgada indefinidamente en segundo plano.
        const signal = AbortSignal.timeout(12000);
        if (type === 'ollama') {
            const res = await fetch(`${url}/api/chat`, {
                method: 'POST', headers, signal,
                body: JSON.stringify({ model: state.settings.model, messages: [{ role: 'user', content: titlePrompt }], stream: false, options: { num_predict: 20 } })
            });
            const data = await res.json();
            title = data.message?.content?.trim() || '';
        } else if (type === 'openai') {
            const res = await fetch(`${url}/chat/completions`, {
                method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, signal,
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
        html += `<button class="pm-cat-item ${active}" data-cat-id="${escapeHtml(cat.id)}">
            <span class="pm-cat-icon">${escapeHtml(cat.icon)}</span>
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
        html += `<div class="pm-prompt-card" data-prompt-id="${escapeHtml(p.id)}">
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
            if (!confirm(trf('dlg.prompt.confirmDelete', '¿Eliminar este prompt?'))) return;
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
        if (!title || !content) return notify(trf('dlg.prompt.required', 'Título y contenido son obligatorios.'), 'error');

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
    if (!title || !content) return notify(trf('dlg.prompt.required', 'Título y contenido son obligatorios.'), 'error');

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
    } else if (val.startsWith('@') && getAgentSlashMatches(val.slice(1)).length) {
        hideSlashDropdown();
        showAgentSlashDropdown(val.slice(1)); // @ → cambiar de agente
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

// Agentes cuyo nombre o descripción casan con lo escrito tras «@». Si nada
// casa no se abre el desplegable: «@usuario hola» es un mensaje normal.
function getAgentSlashMatches(query) {
    const q = String(query || '').toLowerCase().trim();
    const normalize = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    return state.projects.filter(p => !q || normalize(p.name).includes(normalize(q)) || normalize(p.description).includes(normalize(q)));
}

function showAgentSlashDropdown(query) {
    modelSlashState.active = true;
    modelSlashState.mode = 'agents';
    modelSlashState.selectedIndex = 0;
    modelSlashState.items = getAgentSlashMatches(query).map(p => ({
        type: 'agent', id: p.id, name: p.name, icon: p.emoji || (p.id === 'general' ? '🏠' : '🤖'), desc: p.description || '',
    }));
    let html = `<div class="slash-dropdown-heading">${escapeHtml(tr('agent.switch.heading', '🤖 Cambiar de agente'))}</div>`;
    html += modelSlashState.items.map((item, i) => `<button class="slash-item ${i === modelSlashState.selectedIndex ? 'active' : ''}" data-idx="${i}">
            <span class="slash-item-icon">${escapeHtml(item.icon)}</span>
            <div class="slash-item-info">
                <div class="slash-item-title">${escapeHtml(item.name)}${item.id === state.activeProjectId ? ` <span class="slash-current">· ${escapeHtml(tr('agent.switch.current', 'actual'))}</span>` : ''}</div>
                ${item.desc ? `<div class="slash-item-desc">${escapeHtml(item.desc)}</div>` : ''}
            </div>
        </button>`).join('');
    dom.modelSlashDropdownList.innerHTML = html;
    bindModelSlashItemClicks();
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
        dom.slashDropdownList.innerHTML = `<div class="slash-empty">No se encontraron categorías para "/${escapeHtml(query)}"</div>`;
        return;
    }

    dom.slashDropdownList.innerHTML = slashState.items.map((item, i) => {
        const count = promptLibrary.prompts.filter(p => p.categoryId === item.id).length;
        return `<button class="slash-item ${i === slashState.selectedIndex ? 'active' : ''}" data-idx="${i}">
            <span class="slash-item-icon">${escapeHtml(item.icon)}</span>
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
        dom.modelSlashDropdownList.innerHTML = `<div class="slash-empty">No se encontraron motores para "///${escapeHtml(query)}"</div>`;
        return;
    }
    let html = `<div class="slash-dropdown-heading">⚙️ Elegir motor de IA · luego // para elegir modelo</div>`;
    html += modelSlashState.items.map((item, i) => {
        const isCurrent = item.id === state.settings.provider;
        return `<button class="slash-item ${i === modelSlashState.selectedIndex ? 'active' : ''}" data-idx="${i}">
            <span class="slash-item-icon">${escapeHtml(item.icon)}</span>
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

/**
 * selectSlashItem — elige un elemento del selector `/`.
 * Con `send`, un prompt se LANZA directamente (Intro); sin él, solo se inserta en
 * la caja para editarlo antes de enviar (Tab o clic).
 */
function selectSlashItem(idx, { send = false } = {}) {
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
        hideSlashDropdown();
        if (send) {
            // Misma ruta que el botón de enviar: sendMessage vacía la caja y adjunta lo pendiente.
            dom.messageInput.value = '';
            autoResizeTextarea();
            updateSendButton();
            sendMessage(item.content);
            return;
        }
        dom.messageInput.value = item.content;
        autoResizeTextarea();
        updateSendButton();
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
    } else if (item.type === 'agent') {
        // Cambia de agente (@): con su motor, sus iniciadores y sus chats.
        dom.messageInput.value = '';
        autoResizeTextarea();
        updateSendButton();
        hideModelSlashDropdown();
        switchProject(item.id);
        dom.messageInput.focus();
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
            // Intro lanza el prompt directamente; en una categoría, la abre.
            if (slashState.items.length > 0) {
                e.preventDefault();
                selectSlashItem(slashState.selectedIndex, { send: true });
            }
        } else if (e.key === 'Tab') {
            // Tab solo inserta el prompt, para editarlo antes de enviarlo.
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

/* >>> exports (generado por scripts/gen-modules.mjs: no editar a mano) >>> */
export {
    openSettings, showConnectionValidationResult, bindEvents, closeSidebar, autoResizeTextarea,
    updateSendButton, scrollToBottom, formatDate, autoTitleChat, loadPromptLibrary,
    bindSlashCommandEvents,
};
/* <<< exports <<< */
