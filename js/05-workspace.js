/* ============================================
   wIA — 05-workspace.js
   PDF, documentos de proyecto, adjuntos, proyectos, chats y listado lateral
   (Scripts clásicos cargados en orden desde index.html;
   comparten el ámbito global igual que el antiguo app.js)
   ============================================ */

// ─── PDF Parsing Logic ──────────────────────
if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
}

async function extractTextFromPDF(file) {
    if (!window.pdfjsLib) return "PDF.js no está cargado.";
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            fullText += textContent.items.map(item => item.str).join(' ') + '\n';
        }
        return fullText;
    } catch(e) {
        console.error("Error reading PDF:", e);
        return "Error extrayendo texto del PDF: " + e.message;
    }
}

// ─── Project Documents Logic ──────────────────
async function persistProjectDocument(proj, documentEntry) {
    proj.documents.push(documentEntry);
    const saved = await saveStateNow({ notifyOnError: false });
    if (!saved) {
        proj.documents = proj.documents.filter(doc => doc.id !== documentEntry.id);
        renderProjectDocList();
        showPersistenceAlert(`No se pudo guardar el documento "${documentEntry.name}" en el navegador. El archivo no se ha añadido de forma persistente.`);
        return false;
    }
    renderProjectDocList();
    return true;
}

async function handleProjectFiles(files) {
    const proj = getEditingProject();
    if (!files.length) return;
    
    for (const file of files) {
        if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
            const textData = await extractTextFromPDF(file);
            await persistProjectDocument(proj, {
                id: crypto.randomUUID(),
                name: file.name,
                type: 'text/plain',
                data: textData
            });
        } else {
            const reader = new FileReader();
            reader.onload = (e) => {
                persistProjectDocument(proj, {
                    id: crypto.randomUUID(),
                    name: file.name,
                    type: file.type,
                    data: e.target.result
                });
            };
            reader.readAsText(file);
        }
    }
    dom.projectFileUpload.value = '';
}

function renderProjectDocList() {
    const proj = getEditingProject();
    if (!dom.projectDocList) return;
    dom.projectDocList.innerHTML = proj.documents.map(d => `
        <div class="attachment-item" style="max-width: 100%; justify-content: space-between;">
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">📝 ${escapeHtml(d.name)}</span>
            <button class="btn-icon" onclick="removeProjectDoc('${d.id}')" style="width:20px;height:20px;color:var(--danger)">✕</button>
        </div>
    `).join('');
}

window.removeProjectDoc = (id) => {
    const proj = getEditingProject();
    proj.documents = proj.documents.filter(d => d.id !== id);
    saveState();
    renderProjectDocList();
};

// ─── Attachments Logic ──────────────────────
async function handleFiles(files) {
    if (!files.length) return;
    
    for (const file of files) {
        if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
            const textData = await extractTextFromPDF(file);
            state.attachments.push({
                id: crypto.randomUUID(),
                name: file.name,
                type: 'application/pdf',
                isImage: false,
                data: textData
            });
            renderAttachmentPreview();
            continue;
        }

        const isImage = file.type.startsWith('image/');
        if (isImage && !state.capabilities.includes('vision') && !supportsWebGPUImageAssist()) {
            alert(`El modelo seleccionado (${state.settings.model}) no soporta imágenes.`);
            continue;
        }
        
        const reader = new FileReader();
        reader.onload = (e) => {
            const data = e.target.result;
            state.attachments.push({
                id: crypto.randomUUID(),
                name: file.name,
                type: file.type,
                isImage: isImage,
                data: isImage ? data.split(',')[1] : data
            });
            renderAttachmentPreview();
        };
        
        if (isImage) {
            reader.readAsDataURL(file);
        } else {
            reader.readAsText(file);
        }
    }
    dom.fileUpload.value = '';
}

function removeAttachment(id) {
    state.attachments = state.attachments.filter(a => a.id !== id);
    renderAttachmentPreview();
}

function renderAttachmentPreview() {
    if (state.attachments.length === 0) {
        dom.attachmentPreview.classList.add('hidden');
        dom.attachmentPreview.innerHTML = '';
        return;
    }
    
    dom.attachmentPreview.classList.remove('hidden');
    dom.attachmentPreview.innerHTML = state.attachments.map(a => {
        if (a.isImage) {
            return `
                <div class="attachment-item image">
                    <img src="data:${a.type};base64,${a.data}" alt="${escapeHtml(a.name)}">
                    <div class="attachment-remove" data-id="${a.id}">✕</div>
                </div>
            `;
        } else {
            return `
                <div class="attachment-item" title="${escapeHtml(a.name)}">
                    📝 <span class="attachment-name">${escapeHtml(a.name)}</span>
                    <div class="attachment-remove" data-id="${a.id}">✕</div>
                </div>
            `;
        }
    }).join('');
}

// ─── Project / Agent Management ──────────────
// Un "Agente" es un Proyecto enriquecido: además de systemPrompt y documentos,
// puede fijar identidad (emoji, descripción), motor propio (proveedor, modelo,
// temperatura) e iniciadores de conversación para la pantalla de bienvenida.

const DEFAULT_WELCOME_STARTERS = [
    { icon: '🚀', title: 'Explorar capacidades', prompt: 'Explícame qué puedes hacer y cuáles son tus capacidades' },
    { icon: '💻', title: 'Escribir código', prompt: 'Ayúdame a escribir código Python para un web scraper con asyncio' },
    { icon: '🧠', title: 'Analizar ideas', prompt: 'Ayúdame a analizar los pros y contras de una decisión importante' },
    { icon: '✍️', title: 'Redacción y traducción', prompt: 'Ayúdame a redactar un texto profesional multiidioma' },
];

function renderProjectSelect() {
    dom.projectSelect.innerHTML = state.projects.map(p =>
        `<option value="${p.id}" ${p.id === state.activeProjectId ? 'selected' : ''}>${escapeHtml(`${p.emoji || ''} ${p.name}`.trim())}</option>`
    ).join('');
}

/**
 * applyAgentEngine — si el proyecto/agente define motor propio, cambia la
 * configuración activa (proveedor, modelo, temperatura) igual que haría el
 * usuario desde ajustes. Sin motor definido, no toca nada (modo Global).
 */
function applyAgentEngine(proj) {
    if (!proj) return;
    const wantsProvider = proj.agentProvider && PROVIDERS[proj.agentProvider];
    if (!wantsProvider && !proj.agentModel && typeof proj.agentTemperature !== 'number') return;

    saveCurrentProviderConfig();
    if (wantsProvider) {
        state.settings.provider = proj.agentProvider;
        syncProviderToState();
    }
    if (proj.agentModel) state.settings.model = proj.agentModel;
    if (typeof proj.agentTemperature === 'number' && !Number.isNaN(proj.agentTemperature)) {
        state.settings.temperature = proj.agentTemperature;
    }
    saveState();
    applySettingsToUI();
    updateStatusMeta();
    checkProviderStatus();
}

function switchProject(projectId) {
    if (state.activeProjectId === projectId) return;
    state.activeProjectId = projectId;
    state.activeChatId = null;
    saveState();
    renderProjectSelect();
    renderChatList();
    applyAgentEngine(getActiveProject());
    renderWelcomeStarters();
    showWelcome();
}

/**
 * renderWelcomeStarters — adapta la pantalla de bienvenida al agente activo:
 * identidad (emoji, nombre, descripción) e iniciadores propios; con un
 * proyecto "plano" restaura los genéricos de wIA.
 */
function renderWelcomeStarters() {
    const proj = getActiveProject();
    const container = document.querySelector('.welcome-cards');
    const titleEl = document.querySelector('.welcome-title');
    const subtitleEl = document.querySelector('.welcome-subtitle');
    if (!container) return;

    const agentStarters = (proj?.starters || []).filter(s => s && s.prompt);
    const isAgent = proj && proj.id !== 'general' && (agentStarters.length > 0 || proj.emoji || proj.description);
    const starters = agentStarters.length > 0 ? agentStarters.slice(0, 4) : DEFAULT_WELCOME_STARTERS;

    if (titleEl) titleEl.textContent = isAgent ? `${proj.emoji || '🤖'} ${proj.name}` : 'wIA';
    if (subtitleEl) {
        subtitleEl.innerHTML = isAgent
            ? escapeHtml(proj.description || 'Agente personalizado')
            : 'Tu hub de IA multimotor — <strong>Local y Cloud</strong>';
    }

    container.innerHTML = starters.map(s => `
        <button class="welcome-card" data-prompt="${escapeHtml(s.prompt)}">
            <div class="welcome-card-icon">${escapeHtml(s.icon || '💬')}</div>
            <div class="welcome-card-text">
                <strong>${escapeHtml(s.title || s.prompt.slice(0, 40))}</strong>
                <span>${escapeHtml(s.title ? s.prompt.slice(0, 60) : '')}</span>
            </div>
        </button>
    `).join('');
}

function getAgentEngineLabel(proj) {
    if (!proj?.agentProvider && !proj?.agentModel) return 'Motor global';
    const provName = proj.agentProvider ? (PROVIDERS[proj.agentProvider]?.name || proj.agentProvider) : '';
    const modelLabel = proj.agentModel ? getCompactModelLabel(proj.agentModel, proj.agentProvider || state.settings.provider) : '';
    return [provName, modelLabel].filter(Boolean).join(' · ');
}

function renderAgentsGallery() {
    const grid = document.getElementById('agentsGrid');
    if (!grid) return;
    grid.innerHTML = state.projects.map(p => {
        const active = p.id === state.activeProjectId;
        const docsCount = (p.documents || []).length;
        return `
            <div class="agent-card ${active ? 'active' : ''}" data-agent-id="${p.id}" role="button" tabindex="0">
                <div class="agent-card-emoji">${escapeHtml(p.emoji || (p.id === 'general' ? '🏠' : '🤖'))}</div>
                <div class="agent-card-body">
                    <div class="agent-card-name">${escapeHtml(p.name)}${active ? ' · <span style="color:var(--accent-secondary)">activo</span>' : ''}</div>
                    <div class="agent-card-desc">${escapeHtml(p.description || p.systemPrompt || 'Sin descripción')}</div>
                    <div class="agent-card-meta">
                        <span class="agent-chip engine">${escapeHtml(getAgentEngineLabel(p))}</span>
                        ${docsCount > 0 ? `<span class="agent-chip">📄 ${docsCount} doc${docsCount === 1 ? '' : 's'}</span>` : ''}
                        ${(p.starters || []).filter(s => s?.prompt).length > 0 ? '<span class="agent-chip">⚡ iniciadores</span>' : ''}
                    </div>
                </div>
                <button class="agent-card-edit" data-edit-agent="${p.id}" title="Editar agente">✏️</button>
            </div>
        `;
    }).join('');
}

function getActiveProject() {
    return state.projects.find(p => p.id === state.activeProjectId) || state.projects[0];
}

/**
 * getEditingProject — proyecto abierto en el modal de edición. Puede ser
 * distinto del activo (la galería permite editar cualquier agente).
 */
function getEditingProject() {
    return state.projects.find(p => p.id === state.editingProjectId) || getActiveProject();
}

function renderStartersEditor(proj) {
    if (!dom.projectStartersEditor) return;
    const starters = proj.starters || [];
    dom.projectStartersEditor.innerHTML = [0, 1, 2, 3].map(i => {
        const s = starters[i] || {};
        return `
            <div class="starter-row">
                <input type="text" class="setting-input starter-icon" data-starter-icon="${i}" maxlength="4"
                    placeholder="💬" value="${escapeHtml(s.icon || '')}">
                <input type="text" class="setting-input starter-title" data-starter-title="${i}"
                    placeholder="Título" value="${escapeHtml(s.title || '')}">
                <input type="text" class="setting-input starter-prompt" data-starter-prompt="${i}"
                    placeholder="Prompt que se enviará al pulsar" value="${escapeHtml(s.prompt || '')}">
            </div>
        `;
    }).join('');
}

function openProjectEditor(projectId) {
    const proj = state.projects.find(p => p.id === projectId);
    if (!proj) return;
    state.editingProjectId = projectId;

    dom.projectName.value = proj.name;
    dom.projectPrompt.value = proj.systemPrompt || '';
    dom.projectEmoji.value = proj.emoji || '';
    dom.projectDescription.value = proj.description || '';
    dom.projectModel.value = proj.agentModel || '';
    dom.projectTemperature.value = typeof proj.agentTemperature === 'number' ? proj.agentTemperature : '';

    dom.projectProvider.innerHTML = '<option value="">— Global (ajustes generales) —</option>' +
        Object.entries(PROVIDERS).map(([id, def]) =>
            `<option value="${id}" ${proj.agentProvider === id ? 'selected' : ''}>${def.icon} ${def.name}</option>`
        ).join('');

    renderStartersEditor(proj);

    if (proj.id === 'general') {
        dom.projectName.disabled = true;
        dom.deleteProjectBtn.style.display = 'none';
    } else {
        dom.projectName.disabled = false;
        dom.deleteProjectBtn.style.display = 'block';
    }
    renderProjectDocList();
    dom.projectModal.classList.remove('hidden');
}

function createProject(name) {
    const proj = {
        id: crypto.randomUUID(),
        name: name,
        systemPrompt: '',
        documents: [],
        createdAt: Date.now()
    };
    state.projects.push(proj);
    saveState();
    switchProject(proj.id);
    return proj;
}

function deleteProject(id) {
    if (id === 'general') {
        alert("No puedes eliminar el Workspace General.");
        return;
    }
    state.projects = state.projects.filter(p => p.id !== id);
    // Eliminar chats huerfanos
    state.chats = state.chats.filter(c => c.projectId !== id);
    
    if (state.activeProjectId === id) {
        switchProject('general');
    } else {
        saveState();
        renderProjectSelect();
        renderChatList();
    }
}

// ─── Chat Management ────────────────────────
function createChat(options = {}) {
    const { showWelcomeScreen = false } = options;
    const chat = {
        id: crypto.randomUUID(),
        projectId: state.activeProjectId,
        title: 'Nueva conversación',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        starred: false,
    };
    state.chats.unshift(chat);
    state.activeChatId = chat.id;
    state.attachments = [];
    renderAttachmentPreview();
    dom.messageInput.value = '';
    autoResizeTextarea();
    updateSendButton();
    saveState();
    renderChatList();
    if (showWelcomeScreen) {
        showWelcome();
    } else {
        showChat();
        renderMessages();
        dom.messageInput.focus();
    }
    closeSidebar();
    return chat;
}

function createChatFromUI() {
    createChat({ showWelcomeScreen: true });
}

function toggleFavorite(chatId) {
    const chat = state.chats.find(c => c.id === chatId);
    if (!chat) return;
    chat.starred = !chat.starred;
    saveState();
    renderChatList();
}

function deleteChat(chatId) {
    state.chats = state.chats.filter(c => c.id !== chatId);
    if (state.activeChatId === chatId) {
        state.activeChatId = null;
        showWelcome();
    }
    saveState();
    renderChatList();
}

function switchChat(chatId) {
    state.activeChatId = chatId;
    renderChatList();
    showChat();
    renderMessages();
    closeSidebar();
}

function getActiveChat() {
    return state.chats.find(c => c.id === state.activeChatId);
}

function generateTitle(message) {
    // Simple title from first message
    const text = message.replace(/[#*`]/g, '').trim();
    return text.length > 45 ? text.substring(0, 45) + '...' : text;
}

// ─── UI Switching ───────────────────────────
function showWelcome() {
    dom.welcomeScreen.style.display = 'flex';
    dom.messagesContainer.classList.remove('active');
}

function showChat() {
    dom.welcomeScreen.style.display = 'none';
    dom.messagesContainer.classList.add('active');
}

// ─── Render Chat List ───────────────────────
function buildChatItemHtml(chat) {
    const isStarred = !!chat.starred;
    return `
        <div class="chat-item ${chat.id === state.activeChatId ? 'active' : ''} ${isStarred ? 'starred' : ''}" data-id="${chat.id}">
            <div class="chat-item-text">
                <div class="chat-item-title">${escapeHtml(chat.title)}</div>
                <div class="chat-item-date">${formatDate(chat.updatedAt)}</div>
            </div>
            <div class="chat-item-actions">
                <button class="btn-icon star-chat-btn ${isStarred ? 'star-active' : ''}" data-id="${chat.id}" title="${isStarred ? 'Quitar de favoritos' : 'Añadir a favoritos'}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="${isStarred ? 'var(--star-color)' : 'none'}" stroke="${isStarred ? 'var(--star-color)' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                    </svg>
                </button>
                <button class="btn-icon export-chat-btn" data-id="${chat.id}" title="Exportar">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                </button>
                <button class="btn-icon move-chat-btn" data-id="${chat.id}" title="Mover a otro Proyecto">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                </button>
                <button class="btn-icon delete-chat-btn" data-id="${chat.id}" title="Eliminar">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            </div>
        </div>
    `;
}

function renderChatList() {
    if (isConversationPersistenceDisabled()) {
        dom.chatList.innerHTML = `
            <div class="empty-chats">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M12 2 4 6v6c0 5 3.4 9.4 8 10 4.6-.6 8-5 8-10V6l-8-4Z"/>
                    <path d="M9 12h6"/>
                </svg>
                <p>Modo Incógnito activo</p>
                <span style="font-size: 0.74rem; color: var(--text-tertiary); line-height: 1.5; text-align: center;">
                    El historial lateral se oculta mientras esta sesión privada esté activa.
                </span>
            </div>
        `;
        return;
    }

    const searchTerm = dom.searchChats.value.toLowerCase();
    
    // Filter chats by Active Project AND search term
    const projectChats = state.chats.filter(c => c.projectId === state.activeProjectId);
    const filteredChats = projectChats.filter(c =>
        c.title.toLowerCase().includes(searchTerm)
    ).sort((a, b) => b.updatedAt - a.updatedAt);

    if (filteredChats.length === 0) {
        dom.chatList.innerHTML = `
            <div class="empty-chats">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <p>Sin conversaciones aún</p>
            </div>
        `;
        return;
    }

    // ── Favourites Section ──────────────────────
    const starredChats = filteredChats.filter(c => c.starred);
    let html = '';

    if (starredChats.length > 0) {
        html += `
            <details class="chat-group chat-group-starred" open>
                <summary class="chat-group-header chat-group-header-starred">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--star-color)" stroke="var(--star-color)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                    </svg>
                    Favoritos
                </summary>
                ${starredChats.map(chat => buildChatItemHtml(chat)).join('')}
            </details>
        `;
    }

    // ── Time Groups ─────────────────────────────
    const nonStarred = filteredChats.filter(c => !c.starred);

    const groups = {
        'Hoy': [],
        'Ayer': [],
        'Esta semana': [],
        'Mes pasado': [],
        'Anteriores': []
    };

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    const lastWeek = today - 86400000 * 7;
    const lastMonth = today - 86400000 * 30;

    nonStarred.forEach(chat => {
        const d = chat.updatedAt;
        if (d >= today) groups['Hoy'].push(chat);
        else if (d >= yesterday) groups['Ayer'].push(chat);
        else if (d >= lastWeek) groups['Esta semana'].push(chat);
        else if (d >= lastMonth) groups['Mes pasado'].push(chat);
        else groups['Anteriores'].push(chat);
    });

    for (const [title, chats] of Object.entries(groups)) {
        if (chats.length === 0) continue;
        const isOpen = (title === 'Hoy' || title === 'Ayer' || title === 'Esta semana');
        html += `
            <details class="chat-group" ${isOpen ? 'open' : ''}>
                <summary class="chat-group-header">${title}</summary>
                ${chats.map(chat => buildChatItemHtml(chat)).join('')}
            </details>
        `;
    }
    dom.chatList.innerHTML = html;

    // Bind chat item clicks
    dom.chatList.querySelectorAll('.chat-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.delete-chat-btn') || e.target.closest('.star-chat-btn') ||
                e.target.closest('.move-chat-btn') || e.target.closest('.export-chat-btn')) return;
            switchChat(item.dataset.id);
        });
    });

    dom.chatList.querySelectorAll('.star-chat-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavorite(btn.dataset.id);
        });
    });

    dom.chatList.querySelectorAll('.delete-chat-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            showDeleteModal(btn.dataset.id);
        });
    });

    dom.chatList.querySelectorAll('.move-chat-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            showMoveModal(btn.dataset.id);
        });
    });

    dom.chatList.querySelectorAll('.export-chat-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            exportChat(btn.dataset.id);
        });
    });
}

