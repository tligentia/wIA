/* ============================================
   wIA — 07-ui.js
   Bindings de eventos, atajos, voz, exportación y arranque
   (Scripts clásicos cargados en orden desde index.html;
   comparten el ámbito global igual que el antiguo app.js)
   ============================================ */

// ─── Event Bindings ─────────────────────────
function bindEvents() {
    // Send message
    dom.sendBtn.addEventListener('click', () => {
        sendMessage(dom.messageInput.value);
    });

    dom.messageInput.addEventListener('keydown', (e) => {
        // Skip send if slash commands are active (slash keydown handles Enter)
        if (e.key === 'Enter' && !e.shiftKey && !(typeof slashState !== 'undefined' && slashState.active)) {
            e.preventDefault();
            if (!dom.sendBtn.disabled) {
                sendMessage(dom.messageInput.value);
            }
        }
    });

    dom.messageInput.addEventListener('input', () => {
        autoResizeTextarea();
        updateSendButton();
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
        saveCurrentProviderConfig();
        
        // Switch to new provider
        state.settings.provider = e.target.value;
        state.modelFeatureFilters = [];
        syncProviderToState();
        
        // Update UI with new provider's config
        dom.ollamaUrl.value = state.settings.ollamaUrl;
        if (dom.apiKeyInput) dom.apiKeyInput.value = state.settings.apiKey || '';
        dom.modelSelect.innerHTML = `<option value="${state.settings.model}" selected>${state.settings.model}</option>`;
        
        updateProviderUI();
        saveState();
        checkProviderStatus();
    });
    
    // API Key toggle visibility
    dom.apiKeyToggle?.addEventListener('click', () => {
        const input = dom.apiKeyInput;
        if (input) {
            input.type = input.type === 'password' ? 'text' : 'password';
        }
    });

    $('#settingsBtn').addEventListener('click', () => {
        applySettingsToUI();
        dom.settingsModal.classList.remove('hidden');
    });

    dom.modelStatus?.addEventListener('click', () => {
        $('#settingsBtn')?.click();
    });

    $('#closeSettings').addEventListener('click', () => {
        dom.settingsModal.classList.add('hidden');
    });

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

    if (dom.refreshModels) {
        dom.refreshModels.addEventListener('click', () => {
            const originalText = dom.refreshModels.textContent;
            dom.refreshModels.textContent = '🔄 Cargando...';
            checkProviderStatus().finally(() => {
                dom.refreshModels.textContent = originalText;
            });
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

    $('#saveSettings').addEventListener('click', async () => {
        state.settings.ollamaUrl = dom.ollamaUrl.value.replace(/\/+$/, '');
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
        state.settings.apiKey = dom.apiKeyInput?.value || '';
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
        state.settings.theme = 'dark';
        state.settings.temperature = 0.7;
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
        dom.agentsModal.classList.remove('hidden');
    });
    dom.closeAgentsModal?.addEventListener('click', () => dom.agentsModal.classList.add('hidden'));

    dom.newAgentBtn?.addEventListener('click', () => {
        const name = prompt('Nombre del nuevo agente:', 'Mi agente');
        if (!name || !name.trim()) return;
        const proj = createProject(name.trim());
        renderAgentsGallery();
        openProjectEditor(proj.id);
    });

    document.getElementById('agentsGrid')?.addEventListener('click', (e) => {
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
    
    dom.copyCorsBtn?.addEventListener('click', () => {
        const cmd = $('#corsCommandText').textContent;
        navigator.clipboard.writeText(cmd).then(() => {
            const originalText = dom.copyCorsBtn.textContent;
            dom.copyCorsBtn.textContent = '¡Copiado!';
            setTimeout(() => dom.copyCorsBtn.textContent = originalText, 2000);
        });
    });

    dom.retryCorsBtn.addEventListener('click', () => {
        dom.corsErrorModal.classList.add('hidden');
        checkProviderStatus();
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

// Model Slash Command State
const modelSlashState = {
    active: false,
    selectedIndex: 0,
    level: 'providers',    // 'providers' | 'models'
    selectedProviderId: null,
    items: []
};

function handleSlashInput() {
    const val = dom.messageInput.value;
    if (state.isStreaming) return;

    if (val.startsWith('//')) {
        hideSlashDropdown(); // Hide prompt dropdown if they type second /
        const query = val.slice(2).toLowerCase().trim();
        showModelSlashDropdown(query);
    } else if (val.startsWith('/')) {
        hideModelSlashDropdown(); // Hide model dropdown if they delete second /
        const query = val.slice(1).toLowerCase().trim();
        showSlashDropdown(query);
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

// Model Dropdown (//)
function showModelSlashDropdown(query) {
    modelSlashState.active = true;
    modelSlashState.selectedIndex = 0;

    if (modelSlashState.level === 'models' && modelSlashState.selectedProviderId) {
        renderModelSlashModels(modelSlashState.selectedProviderId, query);
    } else {
        modelSlashState.level = 'providers';
        renderModelSlashProviders(query);
    }
    dom.modelSlashDropdown.classList.remove('hidden');
}

function hideModelSlashDropdown() {
    modelSlashState.active = false;
    modelSlashState.level = 'providers';
    modelSlashState.selectedProviderId = null;
    modelSlashState.items = [];
    dom.modelSlashDropdown.classList.add('hidden');
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

function renderModelSlashProviders(query) {
    let providers = Object.entries(PROVIDERS).map(([id, def]) => ({ id, ...def }));
    if (query) {
        providers = providers.filter(p => p.name.toLowerCase().includes(query) || p.id.toLowerCase().includes(query));
    }

    modelSlashState.items = providers.map(p => ({ type: 'provider', ...p }));

    if (modelSlashState.items.length === 0) {
        dom.modelSlashDropdownList.innerHTML = `<div class="slash-empty">No se encontraron plataformas para "//${query}"</div>`;
        return;
    }

    dom.modelSlashDropdownList.innerHTML = modelSlashState.items.map((item, i) => {
        return `<button class="slash-item ${i === modelSlashState.selectedIndex ? 'active' : ''}" data-idx="${i}">
            <span class="slash-item-icon">${item.icon}</span>
            <div class="slash-item-info">
                <div class="slash-item-title">${escapeHtml(item.name)}</div>
            </div>
        </button>`;
    }).join('');

    bindModelSlashItemClicks();
}

async function renderModelSlashModels(providerId, query) {
    // We need to fetch/get models for this specific provider
    // This part might take a moment if we need to checkProviderStatus
    const def = PROVIDERS[providerId];
    let models = [];
    
    // If it's the current provider, we already have them in rawModels
    if (state.settings.provider === providerId) {
        models = state.rawModels || [];
    } else {
        // We'll show a "loading" or similar if we can't easily get them without switching
        // For simplicity, let's just trigger a switch or suggest switching
        // OR better: use the defaultModel as one option, and show "Cargar más..."
        models = [
            { name: def.defaultModel, label: `${def.defaultModel} (Predeterminado)` }
        ];
        // If it's WebGPU, we have constants
        if (providerId === 'webgpu') {
            models = WEBGPU_MODELS.map(m => ({ name: m.id, label: m.name }));
        }
    }

    if (query) {
        models = models.filter(m => (m.label || m.name).toLowerCase().includes(query));
    }

    const backItem = { type: 'back', id: '__back__' };
    modelSlashState.items = [backItem, ...models.map(m => ({ type: 'model', id: m.name, label: m.label || m.name, providerId }))];

    let html = `<button class="slash-item slash-item-back ${modelSlashState.selectedIndex === 0 ? 'active' : ''}" data-idx="0">
        <span class="slash-item-icon">←</span>
        <div class="slash-item-info">
            <div class="slash-item-title">Volver a plataformas</div>
        </div>
    </button>`;

    if (models.length === 0) {
        html += `<div class="slash-empty">No se encontraron modelos.</div>`;
    } else {
        modelSlashState.items.slice(1).forEach((item, pi) => {
            const idx = pi + 1;
            html += `<button class="slash-item ${idx === modelSlashState.selectedIndex ? 'active' : ''}" data-idx="${idx}">
                <span class="slash-item-icon">🤖</span>
                <div class="slash-item-info">
                    <div class="slash-item-title">${escapeHtml(item.label)}</div>
                </div>
            </button>`;
        });
    }

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

    if (item.type === 'provider') {
        modelSlashState.level = 'models';
        modelSlashState.selectedProviderId = item.id;
        modelSlashState.selectedIndex = 0;
        dom.messageInput.value = '//';
        renderModelSlashModels(item.id, '');
    } else if (item.type === 'back') {
        modelSlashState.level = 'providers';
        modelSlashState.selectedProviderId = null;
        modelSlashState.selectedIndex = 0;
        dom.messageInput.value = '//';
        renderModelSlashProviders('');
    } else if (item.type === 'model') {
        // Switch provider if needed
        if (state.settings.provider !== item.providerId) {
            saveCurrentProviderConfig();
            state.settings.provider = item.providerId;
            syncProviderToState();
            updateProviderUI();
        }
        
        // Select model
        state.settings.model = item.id;
        getActiveProviderConfig().model = item.id;
        
        // Finalize
        saveState();
        applySettingsToUI();
        checkProviderStatus();
        
        // UI Cleanup
        dom.messageInput.value = '';
        autoResizeTextarea();
        updateSendButton();
        hideModelSlashDropdown();
        dom.messageInput.focus();
        
        // Feedback
        showStatusMeta && showStatusMeta(`IA cambiada a: ${item.label}`);
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
                if (typeof applySettingsToUI === 'function') applySettingsToUI();
                const modal = document.getElementById('settingsModal');
                if (modal) modal.classList.remove('hidden');
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
                if (typeof applySettingsToUI === 'function') applySettingsToUI();
                const modal = document.getElementById('settingsModal');
                if (modal) modal.classList.remove('hidden');
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
