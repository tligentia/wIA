/* ============================================
   wIA — 06-chat.js
   Render de mensajes, streaming multi-protocolo y builders por proveedor
   (Scripts clásicos cargados en orden desde index.html;
   comparten el ámbito global igual que el antiguo app.js)
   ============================================ */

// ─── Render Messages ────────────────────────
function renderMessages() {
    const chat = getActiveChat();
    if (!chat) return;

    dom.messagesScroll.innerHTML = chat.messages.map((msg, idx) =>
        renderMessage(msg, idx)
    ).join('');

    // Process code blocks
    processCodeBlocks();
    scrollToBottom();
}

function renderMessage(msg, idx) {
    const isUser = msg.role === 'user';
    const avatarContent = isUser 
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' 
        : '<img src="favicon.png" style="width: 22px; height: 22px; border-radius: 4px; object-fit: contain;">';
    const senderName = isUser ? 'Tú' : 'wIA';

    let contentHtml = '';

    if (msg.thinking && state.settings.thinkingMode) {
        const thinkingRendered = renderMarkdown(msg.thinking);
        contentHtml += `
            <div class="thinking-block">
                <div class="thinking-header" data-idx="${idx}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <path d="m9 18 6-6-6-6"/>
                    </svg>
                    Razonamiento
                </div>
                <div class="thinking-content" data-idx="${idx}">${thinkingRendered}</div>
            </div>
        `;
    }

    if (msg.loading?.active) {
        contentHtml += renderLoadingState(msg.loading);
    }

    let displayContent = msg.content || '';
    if (isUser) {
        const attachIndex = displayContent.indexOf('\n\n--- Archivo adjunto:');
        if (attachIndex !== -1) {
            displayContent = displayContent.substring(0, attachIndex);
        }
    }

    if (msg.attachedDocs && msg.attachedDocs.length > 0) {
        contentHtml += `<div style="display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap;">`;
        msg.attachedDocs.forEach(docName => {
            contentHtml += `<span style="background:var(--bg-tertiary); padding:4px 8px; border-radius:4px; font-size:0.75rem; color:var(--text-secondary); border: 1px solid var(--border-subtle);"><svg style="display:inline; width:12px; height:12px; margin-right:4px;" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>${escapeHtml(docName)}</span>`;
        });
        contentHtml += `</div>`;
    }

    if (msg.images && msg.images.length > 0) {
        contentHtml += `<div style="display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap;">`;
        msg.images.forEach(imgB64 => {
            const mimeType = imgB64.startsWith('/') ? 'image/jpeg' : (imgB64.startsWith('iVB') ? 'image/png' : 'image/jpeg');
            contentHtml += `<img src="data:${mimeType};base64,${imgB64}" style="max-height: 120px; border-radius: 8px; border: 1px solid var(--border-subtle); object-fit: contain;">`;
        });
        contentHtml += `</div>`;
    }

    const isError = !isUser && displayContent.includes('⚠️');
    
    if (isError) {
        contentHtml += `
            <div class="error-message-card">
                <div class="error-header">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <span>Fallo de Conexión</span>
                </div>
                <div class="error-body">
                    ${renderMarkdown(displayContent)}
                </div>
                <div class="error-footer" style="display: flex; justify-content: flex-end; margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 12px;">
                    <button class="btn-retry" onclick="retryMessage(${idx})">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
                        Reintentar ahora
                    </button>
                </div>
            </div>
        `;
    } else {
        contentHtml += isUser ? `<p style="white-space: pre-wrap;">${escapeHtml(displayContent)}</p>` : renderMarkdown(displayContent);
    }

    let metricsHtml = '';
    if (!isUser && msg.metrics && Object.keys(msg.metrics).length > 0) {
        let tps = msg.metrics.tps || 'N/A';
        if (msg.metrics.eval_count && msg.metrics.eval_duration) {
            tps = (msg.metrics.eval_count / (msg.metrics.eval_duration / 1e9)).toFixed(2);
        }
        metricsHtml = `<span class="metrics-btn" onclick="showMetricsModal(${idx})" title="Geek Info">⏱️ ${tps} T/s</span>`;
    }

    // Message action buttons
    const isBookmarked = msg.bookmarked ? 'bookmarked' : '';
    let actionsHtml = '';
    if (isUser) {
        actionsHtml = `
            <div class="message-actions">
                <button class="msg-action-btn msg-save-prompt-btn" onclick="saveMessageAsPrompt(${idx})" title="Guardar como prompt">➕</button>
                <button class="msg-action-btn" onclick="editMessage(${idx})" title="Editar mensaje">✏️ Editar</button>
                <button class="msg-action-btn ${isBookmarked}" onclick="toggleBookmark(${idx})" title="Marcar">⭐</button>
            </div>`;
    } else if (!isError) {
        actionsHtml = `
            <div class="message-actions">
                <button class="msg-action-btn" onclick="copyFullResponse(${idx}, this)" title="Copiar respuesta">📋 Copiar</button>
                <button class="msg-action-btn" onclick="regenerateResponse(${idx})" title="Regenerar">🔄 Regenerar</button>
                <button class="msg-action-btn ${isBookmarked}" onclick="toggleBookmark(${idx})" title="Marcar">⭐</button>
            </div>`;
    }

    return `
        <div class="message ${msg.role} ${isError ? 'message-error' : ''}" id="msg-${idx}">
            <div class="message-inner">
                <div class="message-avatar">${avatarContent}</div>
                <div class="message-body">
                    <div class="message-sender">${metricsHtml}</div>
                    <div class="message-content">
                        ${contentHtml}
                        ${msg.isProposal ? `
                        <div class="proposal-actions">
                            <button class="btn-primary apply-proposal-btn" onclick="applyProposal(${idx})" title="Usar este prompt mejorado">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>
                                Usar este prompt
                            </button>
                        </div>
                        ` : ''}
                    </div>
                    ${actionsHtml}
                </div>
            </div>
        </div>
    `;
}

function showMetricsModal(idx) {
    const chat = getActiveChat();
    if (!chat) return;
    const msg = chat.messages[idx];
    if (!msg) return;
    
    const modal = document.getElementById('metricsModal');
    const bodyEl = document.getElementById('metricsBody');
    if (!modal || !bodyEl) return;

    const provName = msg.provider ? (getProviderDef(msg.provider)?.name || msg.provider) : 'Actual';
    const modelUsed = msg.model || 'Desconocido';

    let html = `<ul style="list-style: none; padding: 0; font-size: 0.85rem; color: var(--text-secondary); line-height: 1.6;">`;
    
    // 1. Neurona & Entorno
    html += `<li style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px dashed var(--border-subtle);">
        <div style="font-size: 0.7rem; text-transform: uppercase; color: var(--accent-secondary); font-weight: 800; letter-spacing: 1px; margin-bottom: 6px;">Neurona & Entorno</div>
        <div style="display: flex; flex-direction: column; gap: 4px;">
            <div><strong style="color:var(--text-primary)">Plataforma:</strong> ${escapeHtml(provName)}</div>
            <div><strong style="color:var(--text-primary)">Modelo:</strong> <code style="font-size: 0.75rem; background: var(--bg-tertiary); padding: 2px 4px; border-radius: 4px; color: var(--accent-primary); border: 1px solid var(--border-subtle);">${escapeHtml(modelUsed)}</code></div>
        </div>
    </li>`;

    // 2. Configuración Creativa
    if (msg.params) {
        html += `<li style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px dashed var(--border-subtle);">
            <div style="font-size: 0.7rem; text-transform: uppercase; color: var(--accent-secondary); font-weight: 800; letter-spacing: 1px; margin-bottom: 6px;">Configuración Creativa</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div style="background: var(--bg-tertiary); padding: 6px; border-radius: 6px; text-align: center;">
                    <div style="font-size: 0.65rem; color: var(--text-tertiary);">Temp</div>
                    <div style="font-weight: 600; color: var(--text-primary);">${msg.params.temperature}</div>
                </div>
                <div style="background: var(--bg-tertiary); padding: 6px; border-radius: 6px; text-align: center;">
                    <div style="font-size: 0.65rem; color: var(--text-tertiary);">Top-P</div>
                    <div style="font-weight: 600; color: var(--text-primary);">${msg.params.topP}</div>
                </div>
                <div style="background: var(--bg-tertiary); padding: 6px; border-radius: 6px; text-align: center;">
                    <div style="font-size: 0.65rem; color: var(--text-tertiary);">Top-K</div>
                    <div style="font-weight: 600; color: var(--text-primary);">${msg.params.topK}</div>
                </div>
                <div style="background: var(--bg-tertiary); padding: 6px; border-radius: 6px; text-align: center;">
                    <div style="font-size: 0.65rem; color: var(--text-tertiary);">Max Tkn</div>
                    <div style="font-weight: 600; color: var(--text-primary);">${msg.params.maxTokens}</div>
                </div>
            </div>
        </li>`;
    }

    // 3. Telemetría de Red
    if (msg.metrics && Object.keys(msg.metrics).length > 0) {
        html += `<div style="font-size: 0.7rem; text-transform: uppercase; color: var(--accent-secondary); font-weight: 800; letter-spacing: 1px; margin-bottom: 6px;">Telemetría de Red</div>`;
        for(const [k, v] of Object.entries(msg.metrics)) {
            if (k === 'tps') continue;
            let displayVal = v;
            // Escalar nanosegundos a segundos para humanos si la clave termina en _duration
            if (typeof v === 'number' && k.toLowerCase().includes('duration')) {
                displayVal = (v / 1e9).toFixed(2) + 's';
            }
            html += `<li style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 2px;">
                <span style="color: var(--text-tertiary);">${escapeHtml(k)}:</span>
                <span style="color: var(--text-primary); font-family: monospace;">${escapeHtml(String(displayVal))}</span>
            </li>`;
        }
        
        const tps = msg.metrics.tps || (msg.metrics.eval_count && msg.metrics.eval_duration ? (msg.metrics.eval_count / (msg.metrics.eval_duration / 1e9)).toFixed(2) : null);
        if (tps) {
            html += `<div style="margin-top: 12px; background: var(--accent-primary); padding: 8px; border-radius: 8px; color: white; display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 0.7rem; font-weight: 700; text-transform: uppercase;">Velocidad Real</span>
                <span style="font-weight: 800; font-size: 1rem;">${tps} <small style="font-weight: 400; font-size: 0.7rem;">tokens/s</small></span>
            </div>`;
        }
    } else {
        html += `<li style="color: var(--text-tertiary); font-style: italic; text-align: center; padding: 10px;">Telemetría no grabada para este mensaje.</li>`;
    }
    
    html += `</ul>`;
    
    const titleEl = modal.querySelector('h2');
    if (titleEl) titleEl.textContent = 'Analítica de Mensaje';
    bodyEl.innerHTML = html;
    modal.classList.remove('hidden');
}

window.showMetricsModal = showMetricsModal;

window.retryMessage = (idx) => {
    const chat = getActiveChat();
    if (!chat) return;
    
    // Solo reintentar si es un mensaje del asistente (el error)
    if (chat.messages[idx] && chat.messages[idx].role === 'assistant') {
        // Eliminar el mensaje fallido
        chat.messages.splice(idx, 1);
        saveState();
        renderMessages();
        
        // Reintentar sin añadir nuevo mensaje de usuario
        sendMessage(null, 'RETRY_LAST');
    }
};

function renderMarkdown(text) {
    if (!text) return '';
    try {
        return sanitizeRenderedHtml(marked.parse(text));
    } catch (e) {
        return escapeHtml(text);
    }
}

function renderLoadingState(loading) {
    if (!loading?.active) return '';

    const phase = getLoadingPhaseLabel(loading.phase);
    const detail = loading.detail ? `<p class="loading-card-detail">${escapeHtml(loading.detail)}</p>` : '';
    const file = loading.file ? `<div class="loading-card-file">${escapeHtml(loading.file)}</div>` : '';
    const metaHtml = renderLoadingMetaHtml(loading);
    const sourceUrlHtml = loading.sourceUrl
        ? `<div class="loading-card-source">
                <code class="loading-card-url" title="${escapeHtml(loading.sourceUrl)}">${escapeHtml(loading.sourceUrl)}</code>
                <button class="loading-card-copy-btn" type="button" onclick="copyText('${loading.sourceUrl.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}', this)" title="Copiar URL de carga">📋</button>
           </div>`
        : '';
    const percent = Number.isFinite(loading.progress) ? Math.max(0, Math.min(100, loading.progress)) : null;
    const progressHtml = percent !== null
        ? `<div class="loading-card-progress">
                <div class="loading-card-progress-top">
                    <span>${loading.progressLabel ? escapeHtml(loading.progressLabel) : 'Progreso'}</span>
                    <strong>${percent}%</strong>
                </div>
                <div class="loading-card-bar">
                    <div class="loading-card-bar-fill" style="width: ${percent}%;"></div>
                </div>
                ${file}
           </div>`
        : '';

    const stateClass = getLoadingStateClass(loading.phase);

    return `
        <div class="loading-card ${stateClass}">
            <div class="loading-card-header">
                <div class="loading-card-spinner" aria-hidden="true"></div>
                <div>
                    <div class="loading-card-title">${phase}</div>
                    ${detail}
                </div>
            </div>
            ${metaHtml}
            ${sourceUrlHtml}
            ${progressHtml}
        </div>
    `;
}

function getLoadingPhaseLabel(phase) {
    const phaseLabels = {
        preparing: 'Preparando motor local',
        downloading: 'Descargando modelo',
        installing: 'Instalando artefactos locales',
        compiling: 'Compilando kernels WebGPU',
        initializing: 'Inicializando modelo',
        generating: 'Generando respuesta',
        cancelling: 'Cancelando carga',
        cancelled: 'Carga cancelada',
        error: 'Carga interrumpida'
    };
    return phaseLabels[phase] || 'Cargando';
}

function getLoadingStateClass(phase) {
    if (phase === 'cancelled' || phase === 'error') return 'is-muted';
    if (phase === 'generating') return 'is-generating';
    if (phase === 'compiling') return 'is-compiling';
    return '';
}

function renderLoadingMetaHtml(loading) {
    const meta = [];
    if (loading.modelLabel) meta.push(`Modelo: ${loading.modelLabel}`);
    if (loading.deviceLabel) meta.push(`Modo: ${loading.deviceLabel}`);
    if (loading.note) meta.push(loading.note);
    return meta.length ? `<div class="loading-card-meta">${meta.map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : '';
}

function patchStreamingLoadingCard(contentEl, loading) {
    const existingCard = contentEl.querySelector('.loading-card');
    if (!existingCard) {
        contentEl.innerHTML = renderLoadingState(loading);
        return true;
    }

    existingCard.className = `loading-card ${getLoadingStateClass(loading.phase)}`.trim();

    const titleEl = existingCard.querySelector('.loading-card-title');
    if (titleEl) titleEl.textContent = getLoadingPhaseLabel(loading.phase);

    const detailEl = existingCard.querySelector('.loading-card-detail');
    if (loading.detail) {
        if (detailEl) detailEl.textContent = loading.detail;
    } else if (detailEl) {
        detailEl.remove();
    }

    const metaEl = existingCard.querySelector('.loading-card-meta');
    const nextMetaHtml = renderLoadingMetaHtml(loading);
    if (metaEl) {
        if (nextMetaHtml) metaEl.outerHTML = nextMetaHtml;
        else metaEl.remove();
    } else if (nextMetaHtml) {
        existingCard.insertAdjacentHTML('beforeend', nextMetaHtml);
    }

    const sourceEl = existingCard.querySelector('.loading-card-source');
    const nextSourceHtml = loading.sourceUrl
        ? `<div class="loading-card-source">
                <code class="loading-card-url" title="${escapeHtml(loading.sourceUrl)}">${escapeHtml(loading.sourceUrl)}</code>
                <button class="loading-card-copy-btn" type="button" onclick="copyText('${loading.sourceUrl.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}', this)" title="Copiar URL de carga">📋</button>
           </div>`
        : '';
    if (sourceEl) {
        if (nextSourceHtml) sourceEl.outerHTML = nextSourceHtml;
        else sourceEl.remove();
    } else if (nextSourceHtml) {
        existingCard.insertAdjacentHTML('beforeend', nextSourceHtml);
    }

    const progressWrap = existingCard.querySelector('.loading-card-progress');
    const percent = Number.isFinite(loading.progress) ? Math.max(0, Math.min(100, loading.progress)) : null;
    if (percent !== null) {
        if (!progressWrap) {
            existingCard.insertAdjacentHTML('beforeend', `
                <div class="loading-card-progress">
                    <div class="loading-card-progress-top">
                        <span>${loading.progressLabel ? escapeHtml(loading.progressLabel) : 'Progreso'}</span>
                        <strong>${percent}%</strong>
                    </div>
                    <div class="loading-card-bar">
                        <div class="loading-card-bar-fill" style="width: ${percent}%;"></div>
                    </div>
                    ${loading.file ? `<div class="loading-card-file">${escapeHtml(loading.file)}</div>` : ''}
               </div>
            `);
        } else {
            const labelEl = progressWrap.querySelector('.loading-card-progress-top span');
            const valueEl = progressWrap.querySelector('.loading-card-progress-top strong');
            const barFillEl = progressWrap.querySelector('.loading-card-bar-fill');
            const fileEl = progressWrap.querySelector('.loading-card-file');
            if (labelEl) labelEl.textContent = loading.progressLabel || 'Progreso';
            if (valueEl) valueEl.textContent = `${percent}%`;
            if (barFillEl) barFillEl.style.width = `${percent}%`;
            if (loading.file) {
                if (fileEl) fileEl.textContent = loading.file;
                else progressWrap.insertAdjacentHTML('beforeend', `<div class="loading-card-file">${escapeHtml(loading.file)}</div>`);
            } else if (fileEl) {
                fileEl.remove();
            }
        }
    } else if (progressWrap) {
        progressWrap.remove();
    }

    return true;
}

function setMessageLoadingState(msg, partial) {
    msg.loading = {
        ...(msg.loading || {}),
        ...partial,
        active: partial.active !== undefined ? partial.active : true
    };
}

function clearMessageLoadingState(msg) {
    delete msg.loading;
}

function inferMimeTypeFromBase64(base64 = '') {
    if (base64.startsWith('/9j/')) return 'image/jpeg';
    if (base64.startsWith('iVBOR')) return 'image/png';
    if (base64.startsWith('R0lGOD')) return 'image/gif';
    if (base64.startsWith('UklGR')) return 'image/webp';
    return 'image/png';
}

function base64ToBlob(base64, mimeType) {
    const byteCharacters = atob(base64);
    const byteArrays = [];
    for (let offset = 0; offset < byteCharacters.length; offset += 512) {
        const slice = byteCharacters.slice(offset, offset + 512);
        const byteNumbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i++) byteNumbers[i] = slice.charCodeAt(i);
        byteArrays.push(new Uint8Array(byteNumbers));
    }
    return new Blob(byteArrays, { type: mimeType });
}

async function getWebGPURawImages(imageMetaList) {
    // En modo worker las imágenes viajan como data-URLs y es el worker quien
    // las convierte a RawImage dentro de su contexto.
    if (webgpuState.executionMode === 'worker' && !webgpuWorker.broken) {
        return imageMetaList.map(img =>
            `data:${img.mimeType || inferMimeTypeFromBase64(img.data)};base64,${img.data}`);
    }
    const hf = webgpuState.hfModule || await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');
    webgpuState.hfModule = hf;
    const { RawImage } = hf;

    return Promise.all(imageMetaList.map(async (img) => {
        const mimeType = img.mimeType || inferMimeTypeFromBase64(img.data);
        const blob = base64ToBlob(img.data, mimeType);
        return RawImage.fromBlob(blob);
    }));
}

function normalizeImageMeta(imageMetaList = [], fallbackImages = []) {
    if (Array.isArray(imageMetaList) && imageMetaList.length > 0) {
        return imageMetaList.map((img, idx) => ({
            data: img.data || '',
            mimeType: img.mimeType || inferMimeTypeFromBase64(img.data || ''),
            name: img.name || `imagen_${idx + 1}`
        })).filter(img => img.data);
    }
    return (fallbackImages || []).map((base64, idx) => ({
        data: base64,
        mimeType: inferMimeTypeFromBase64(base64),
        name: `imagen_${idx + 1}`
    }));
}

function supportsWebGPUImageAssist(providerId = state.settings.provider) {
    return providerId === 'webgpu';
}

function formatWebGPUImageAssistContext(imageCaptions = []) {
    if (!Array.isArray(imageCaptions) || imageCaptions.length === 0) return '';
    const lines = imageCaptions.map((item, idx) => {
        const prefix = `[Imagen ${idx + 1}${item.name ? ` · ${item.name}` : ''}]`;
        return `${prefix} ${item.caption}`.trim();
    });
    return `\n\n--- Analisis visual local ---\n${lines.join('\n')}\n--- Fin del analisis visual ---\n`;
}

async function analyzeImagesForWebGPUInline(imageMetaList = [], onProgress) {
    const normalized = normalizeImageMeta(imageMetaList);
    if (normalized.length === 0) return [];

    const rawImages = await getWebGPURawImages(normalized);
    const pipe = await loadWebGPUImageAssistPipeline(onProgress);
    const results = [];

    for (let i = 0; i < rawImages.length; i++) {
        if (onProgress) {
            onProgress(Math.round((i / rawImages.length) * 100), {
                status: 'progress',
                file: normalized[i].name || `imagen_${i + 1}`
            });
        }
        const output = await pipe(rawImages[i]);
        const caption = extractGeneratedText(output).trim();
        results.push({
            name: normalized[i].name,
            caption: caption || 'No se pudo extraer una descripcion util de la imagen.'
        });
    }

    if (onProgress) {
        onProgress(100, { status: 'ready', file: `${normalized.length} imagen(es)` });
    }

    return results;
}

function extractGeneratedText(result) {
    if (!result) return '';
    if (typeof result === 'string') return result;
    if (Array.isArray(result)) {
        const first = result[0];
        if (!first) return '';
        const candidate = first.generated_text || first.answer || first.text || '';
        if (typeof candidate === 'string') return candidate;
        if (Array.isArray(candidate)) {
            const lastAssistant = [...candidate].reverse().find(item => item?.role === 'assistant');
            if (lastAssistant?.content) {
                if (typeof lastAssistant.content === 'string') return lastAssistant.content;
                if (Array.isArray(lastAssistant.content)) {
                    return lastAssistant.content
                        .filter(part => part?.type === 'text')
                        .map(part => part.text || '')
                        .join('\n')
                        .trim();
                }
            }
        }
        return '';
    }
    const candidate = result.generated_text || result.answer || result.text || '';
    if (typeof candidate === 'string') return candidate;
    if (Array.isArray(candidate)) {
        return candidate
            .filter(part => part?.type === 'text')
            .map(part => part.text || '')
            .join('\n')
            .trim();
    }
    return '';
}

async function runWebGPUGenerationInline(pipe, promptInput, assistantMsg, msgIdx) {
    const startTime = Date.now();
    let tokenCount = 0;
    let fullResponse = '';

    const hf = webgpuState.hfModule;
    const generationOptions = {
        max_new_tokens: parseInt(state.settings.maxTokens || 2048),
        temperature: parseFloat(state.settings.temperature || 0.7),
        top_p: parseFloat(state.settings.topP || 0.9),
        repetition_penalty: 1.1,
        do_sample: true,
    };

    // Streaming token a token. En Transformers.js v3 `callback_function` dentro
    // de las opciones de generación ya no se invoca: hay que pasar un TextStreamer.
    if (hf?.TextStreamer && pipe?.tokenizer) {
        generationOptions.streamer = new hf.TextStreamer(pipe.tokenizer, {
            skip_prompt: true,
            skip_special_tokens: true,
            callback_function: (textChunk) => {
                if (!textChunk) return;
                fullResponse += textChunk;
                clearMessageLoadingState(assistantMsg);
                assistantMsg.content = fullResponse;
                updateStreamingMessage(msgIdx, assistantMsg);
            },
            token_callback_function: () => { tokenCount++; }
        });
    }

    // Cancelación: el criterio se consulta en cada token, así el botón
    // "detener" corta la generación local en curso.
    if (hf?.InterruptableStoppingCriteria) {
        const stopper = new hf.InterruptableStoppingCriteria();
        const signal = state.abortController?.signal;
        if (signal) {
            if (signal.aborted) stopper.interrupt();
            else signal.addEventListener('abort', () => stopper.interrupt(), { once: true });
        }
        generationOptions.stopping_criteria = stopper;
    }

    const result = await pipe(promptInput, generationOptions);
    const finalText = extractGeneratedText(result);
    if (finalText) fullResponse = finalText;

    const elapsed = Date.now() - startTime;
    return {
        text: fullResponse || '*(Sin respuesta generada)*',
        metrics: tokenCount > 0 && elapsed > 0
            ? {
                eval_count: tokenCount,
                total_time_ms: elapsed,
                tps: (tokenCount / (elapsed / 1000)).toFixed(2)
            }
            : null
    };
}

function isWebGPUVisionModel(modelId = state.settings.model) {
    const modelDef = WEBGPU_MODELS.find(m => m.id === modelId);
    return Array.isArray(modelDef?.capabilities) && modelDef.capabilities.includes('vision');
}

function getWebGPUTextFallbackModelId() {
    const curated = WEBGPU_MODELS.find(m => m.id === WEBGPU_TEXT_FALLBACK_MODEL && !isWebGPUVisionModel(m.id));
    if (curated) return curated.id;
    const firstTextModel = WEBGPU_MODELS.find(m => !isWebGPUVisionModel(m.id));
    return firstTextModel?.id || 'HuggingFaceTB/SmolLM2-360M-Instruct';
}

function shouldEmitWebGPUProgress(prevState, pct, progress) {
    const now = performance.now();
    const isReady = progress?.status === 'ready';
    const isInit = progress?.status === 'init';
    const pctChangedEnough = Math.abs((pct ?? 0) - (prevState.pct ?? -100)) >= WEBGPU_PROGRESS_UI_MIN_DELTA_PCT;
    const timeElapsedEnough = (now - (prevState.ts || 0)) >= WEBGPU_PROGRESS_UI_MIN_INTERVAL_MS;
    const fileChanged = (progress?.file || '') !== (prevState.file || '');

    if (isReady || isInit || fileChanged || pctChangedEnough || timeElapsedEnough) {
        prevState.ts = now;
        prevState.pct = pct ?? prevState.pct;
        prevState.file = progress?.file || '';
        return true;
    }
    return false;
}

function estimateInstallProgress(prevState, file = '') {
    if (file) prevState.completedFiles?.add(file);
    const completedCount = prevState.completedFiles?.size || 0;
    return Math.min(96, 72 + (completedCount * 6));
}

function describeWebGPUProgressStage(progress = {}) {
    const status = progress.status || '';
    const file = (progress.file || '').toLowerCase();

    if (status === 'init') {
        return {
            phase: 'preparing',
            progressLabel: 'Preparando',
            detail: progress.file || 'Preparando runtime local y resolviendo artefactos del modelo.'
        };
    }

    if (status === 'installing') {
        return {
            phase: 'installing',
            progressLabel: 'Instalando',
            detail: progress.file || 'Registrando archivos en caché y montando artefactos locales.'
        };
    }

    if (status === 'compiling') {
        return {
            phase: 'compiling',
            progressLabel: 'Compilando',
            detail: progress.file || 'Compilando kernels WebGPU para el acelerador local.'
        };
    }

    if (status === 'initializing' || status === 'ready') {
        return {
            phase: 'initializing',
            progressLabel: 'Inicializando',
            detail: progress.file || 'Levantando el pipeline y preparando kernels del runtime.'
        };
    }

    if (file.includes('tokenizer') || file.includes('config') || file.includes('processor')) {
        return {
            phase: 'installing',
            progressLabel: 'Instalando',
            detail: `Preparando componente local: ${progress.file || 'artefacto del modelo'}.`
        };
    }

    return {
        phase: 'downloading',
        progressLabel: 'Descarga',
        detail: 'Descargando y cacheando los pesos del modelo.'
    };
}

function buildWebGPURepoUrl(modelId) {
    return `https://huggingface.co/${modelId}`;
}

function buildWebGPULoadUrl(modelId, revision = 'main') {
    return `https://huggingface.co/${modelId}/resolve/${revision}`;
}

function formatErrorDetail(error) {
    if (!error) return 'Error desconocido';
    if (typeof error.message === 'string' && error.message.trim()) return error.message.trim();
    if (typeof error.reason === 'string' && error.reason.trim()) return error.reason.trim();
    if (typeof error.cause === 'string' && error.cause.trim()) return error.cause.trim();
    const text = String(error);
    return text && text !== '[object Object]' ? text : 'Error desconocido sin mensaje';
}

function isOpaqueWebGPUNumericError(detail) {
    return typeof detail === 'string' && /^\d+$/.test(detail.trim());
}

function buildWebGPUConversation(chat, systemContent = '', useVision = false) {
    const conversationHistory = [];
    const imageMetaList = [];

    if (systemContent.trim()) {
        conversationHistory.push({ role: 'system', content: systemContent.trim() });
    }

    for (const msg of chat.messages) {
        if (msg.role === 'assistant' && !msg.content) continue;
        if (msg.role === 'tool') continue;

        if (useVision && msg.role === 'user') {
            const normalizedImages = normalizeImageMeta(msg.imageMeta, msg.images || []);
            if (normalizedImages.length > 0) {
                const content = normalizedImages.map(() => ({ type: 'image' }));
                normalizedImages.forEach(img => imageMetaList.push(img));

                const text = (msg.content || '').trim();
                content.push({
                    type: 'text',
                    text: text || 'Describe la imagen y responde a la petición del usuario.'
                });

                conversationHistory.push({ role: msg.role, content });
                continue;
            }
        }

        if (!useVision && msg.role === 'user' && Array.isArray(msg.imageCaptions) && msg.imageCaptions.length > 0) {
            conversationHistory.push({
                role: msg.role,
                content: `${msg.content || ''}${formatWebGPUImageAssistContext(msg.imageCaptions)}`
            });
            continue;
        }

        conversationHistory.push({ role: msg.role, content: msg.content || '' });
    }

    if (conversationHistory.length > 0) {
        const last = conversationHistory[conversationHistory.length - 1];
        if (last.role === 'assistant' && !last.content) conversationHistory.pop();
    }

    return { conversationHistory, imageMetaList };
}

/**
 * processCodeBlocks — injects language labels + copy buttons into <pre><code> blocks.
 * Accepts an optional `root` element to scope the query (avoids re-scanning all messages
 * during streaming — only the current message container is searched).
 */
function processCodeBlocks(root) {
    const container = root || dom.messagesScroll;
    container.querySelectorAll('pre code').forEach((block) => {
        const pre = block.parentElement;
        if (pre.querySelector('.code-block-header')) return;

        const classes = block.className || '';
        const langMatch = classes.match(/language-(\w+)/);
        const lang = langMatch ? langMatch[1] : 'code';

        // Resaltado de sintaxis sobre el DOM: desde marked v5 la opción
        // `highlight` de setOptions no existe y el parseo ya no colorea.
        if (window.hljs && !block.dataset.highlighted) {
            try {
                hljs.highlightElement(block);
                block.dataset.highlighted = 'yes';
            } catch (e) { /* código incompleto durante streaming */ }
        }

        const header = document.createElement('div');
        header.className = 'code-block-header';
        header.innerHTML = `
            <span class="code-block-lang">${lang}</span>
            <button class="code-copy-btn" title="Copiar código">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <rect width="14" height="14" x="8" y="8" rx="2"/>
                    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                </svg>
                Copiar
            </button>
        `;

        pre.insertBefore(header, block);

        header.querySelector('.code-copy-btn').addEventListener('click', () => {
            const code = block.textContent;
            navigator.clipboard.writeText(code).then(() => {
                const btn = header.querySelector('.code-copy-btn');
                btn.classList.add('copied');
                btn.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <path d="M20 6 9 17l-5-5"/>
                    </svg>
                    ¡Copiado!
                `;
                setTimeout(() => {
                    btn.classList.remove('copied');
                    btn.innerHTML = `
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                            <rect width="14" height="14" x="8" y="8" rx="2"/>
                            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                        </svg>
                        Copiar
                    `;
                }, 2000);
            });
        });
    });
}

async function improvePrompt() {
    const originalText = dom.messageInput.value.trim();
    if (!originalText || state.isStreaming) return;

    dom.improvePromptBtn.classList.add('active-optimization');
    dom.improvePromptBtn.disabled = true;

    // Immediate feedback: Ensure there's a chat and show loading
    let chat = getActiveChat();
    if (!chat) chat = createChat();

    const placeholderIdx = chat.messages.length;
    chat.messages.push({
        role: 'assistant',
        content: '_Optimizando prompt..._ ⚡',
        isOptimizing: true,
        createdAt: Date.now()
    });
    
    showChat();
    renderMessages();
    scrollToBottom();

    try {
        const systemInstruction = "Actúa como un experto en ingeniería de prompts. Tu tarea es reescribir y mejorar el siguiente mensaje del usuario para obtener la mejor respuesta posible de un modelo de IA. Hazlo más claro, detallado y profesional, pero manteniendo la intención original. Devuelve ÚNICAMENTE el prompt mejorado, sin introducciones ni explicaciones adicionales.";
        
        const provType = getProviderDef(state.settings.provider).type;
        const headers = getAuthHeaders();
        let url, payload, optimizedText;
        
        if (provType === 'ollama') {
            url = `${state.settings.ollamaUrl}/api/chat`;
            payload = {
                model: state.settings.model,
                messages: [
                    { role: 'system', content: systemInstruction },
                    { role: 'user', content: originalText }
                ],
                stream: false,
                options: { temperature: 0.4, num_predict: 500 }
            };
            const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            const data = await response.json();
            optimizedText = data.message?.content?.trim();
            
        } else if (provType === 'openai') {
            url = `${state.settings.ollamaUrl}/chat/completions`;
            payload = {
                model: state.settings.model,
                messages: [
                    { role: 'system', content: systemInstruction },
                    { role: 'user', content: originalText }
                ],
                stream: false,
                temperature: 0.4,
                max_tokens: 500
            };
            const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            const data = await response.json();
            optimizedText = data.choices?.[0]?.message?.content?.trim();
            
        } else if (provType === 'gemini') {
            const apiKey = state.settings.apiKey;
            url = `${state.settings.ollamaUrl}/models/${state.settings.model}:generateContent?key=${apiKey}`;
            payload = {
                system_instruction: { parts: [{ text: systemInstruction }] },
                contents: [{ role: 'user', parts: [{ text: originalText }] }],
                generationConfig: { temperature: 0.4, maxOutputTokens: 500 }
            };
            const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            const data = await response.json();
            optimizedText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            
        } else if (provType === 'anthropic') {
            url = `${state.settings.ollamaUrl}/messages`;
            payload = {
                model: state.settings.model,
                system: systemInstruction,
                messages: [{ role: 'user', content: originalText }],
                max_tokens: 500,
                temperature: 0.4
            };
            const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            const data = await response.json();
            optimizedText = data.content?.[0]?.text?.trim();
        }

        if (optimizedText) {
            chat.messages[placeholderIdx] = {
                role: 'assistant',
                content: optimizedText,
                isProposal: true,
                createdAt: Date.now()
            };
        } else {
            throw new Error('Respuesta vacía del modelo');
        }
    } catch (e) {
        console.error("Optimization failed:", e);
        chat.messages[placeholderIdx] = {
            role: 'assistant',
            content: `⚠️ **Error al optimizar**: ${e.message}. Asegúrate de que ${getProviderDef(state.settings.provider).name} está funcionando correctamente.`,
            createdAt: Date.now()
        };
    } finally {
        chat.updatedAt = Date.now();
        saveState();
        renderMessages();
        scrollToBottom();
        dom.improvePromptBtn.classList.remove('active-optimization');
        dom.improvePromptBtn.disabled = false;
    }
}

window.applyProposal = (idx) => {
    const chat = getActiveChat();
    if (!chat || !chat.messages[idx]) return;
    
    const text = chat.messages[idx].content;
    dom.messageInput.value = text;
    dom.messageInput.focus();
    autoResizeTextarea();
    updateSendButton();
    
    // Smooth scroll to input
    dom.messageInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

// ─── Streaming Chat ─────────────────────────
async function sendMessage(content, autoSendBody = null) {
    if (state.isStreaming) return;

    let isRetry = autoSendBody === 'RETRY_LAST';
    let reqImages = [];
    let promptAttachments = '';
    let attachedDocsNames = [];

    if (!autoSendBody && !isRetry) {
        for (const att of state.attachments) {
            if (att.isImage) {
                reqImages.push({
                    data: att.data,
                    mimeType: att.type || inferMimeTypeFromBase64(att.data),
                    name: att.name || 'imagen'
                });
            } else {
                attachedDocsNames.push(att.name);
                promptAttachments += `\n\n--- Archivo adjunto: ${att.name} ---\n${att.data}\n`;
            }
        }
        
        if (promptAttachments) content = `${content}${promptAttachments}`;
        if (!content.trim() && reqImages.length === 0) return;

        state.attachments = [];
        renderAttachmentPreview();
    }

    let chat = getActiveChat();
    if (!chat) {
        chat = createChat();
    }

    if (!autoSendBody && !isRetry) {
        if (chat.messages.length === 0) {
            const cleanTitleSource = content.indexOf('\n\n--- Archivo adjunto:') !== -1 ? content.substring(0, content.indexOf('\n\n--- Archivo adjunto:')) : content;
            chat.title = generateTitle(cleanTitleSource || 'Documento adjunto');
            renderChatList();
        }

        const userMsg = { role: 'user', content: content.trim() };
        if (reqImages.length > 0) {
            userMsg.images = reqImages.map(img => img.data);
            userMsg.imageMeta = reqImages;
        }
        if (attachedDocsNames.length > 0) userMsg.attachedDocs = attachedDocsNames;
        
        chat.messages.push(userMsg);
        chat.updatedAt = Date.now();
        saveState();

        showChat();
        renderMessages();
    }

    dom.messageInput.value = '';
    autoResizeTextarea();
    updateSendButton();

    const assistantMsg = { 
        role: 'assistant', 
        content: '', 
        thinking: '',
        provider: state.settings.provider,
        model: state.settings.model,
        params: {
            temperature: state.settings.temperature,
            topP: state.settings.topP || 0.9,
            topK: state.settings.topK || 40,
            maxTokens: state.settings.maxTokens || 4096
        }
    };
    chat.messages.push(assistantMsg);
    const msgIdx = chat.messages.length - 1;

    appendTypingMessage(msgIdx);

    state.isStreaming = true;
    state.abortController = new AbortController();
    dom.sendBtn.classList.add('hidden');
    dom.stopBtn.classList.remove('hidden');

    const provType = getProviderDef(state.settings.provider).type;

    // ── WebGPU Branch ────────────────────────────────────────────────────────
    if (provType === 'webgpu') {
        try {
            const modelId = state.settings.model;
            const support = await checkWebGPUSupport();
            const modelDef = WEBGPU_MODELS.find(m => m.id === modelId);
            const modelLabel = modelDef?.label || modelId;
            const deviceLabel = support === 'webgpu' ? 'WebGPU' : 'WASM / CPU';
            const useVisionTask = isWebGPUVisionModel(modelId);
            const pipelineTask = useVisionTask ? 'image-text-to-text' : 'text-generation';
            dom.statusDot.className = 'status-dot loading';
            dom.statusText.textContent = 'Inicializando...';
            setMessageLoadingState(assistantMsg, {
                phase: 'preparing',
                detail: `Arrancando ${modelLabel} en tu navegador.`,
                modelLabel,
                deviceLabel,
                sourceUrl: buildWebGPURepoUrl(modelId),
                note: useVisionTask
                    ? 'La primera vez puede tardar: además del modelo, el runtime multimodal debe preparar visión + texto. ⚠️ El modelo en memoria se descartará al salir o recargar la página.'
                    : 'La primera vez puede tardar porque el modelo se descarga y se guarda en caché. ⚠️ El modelo en memoria se descartará al salir o recargar la página.',
                progress: 0,
                progressLabel: 'Preparando',
                file: ''
            });
            updateStreamingMessage(msgIdx, assistantMsg);

            const pipe = await loadWebGPUModel(modelId, (pct, progress) => {
                const stage = describeWebGPUProgressStage(progress);
                const phase = webgpuState.cancelRequested ? 'cancelling' : stage.phase;
                setMessageLoadingState(assistantMsg, {
                    phase,
                    detail: progress.retryingWithDtype
                        ? `La variante principal ha fallado. Reintentando ${modelLabel} con cuantización ${progress.retryingWithDtype} para mejorar compatibilidad.`
                        : `${stage.detail} (${modelLabel}).`,
                    modelLabel,
                    deviceLabel,
                    sourceUrl: progress.sourceUrl || buildWebGPURepoUrl(modelId),
                    progress: pct,
                    progressLabel: stage.progressLabel,
                    file: progress.file || '',
                    note: webgpuState.cancelRequested
                        ? 'La cancelación se aplicará en cuanto termine el paso actual del runtime.'
                        : progress.retryingWithDtype
                            ? `Motivo del reintento: ${progress.previousError || 'fallo opaco del runtime WebGPU'}.`
                        : progress._compileOverdue
                            ? '⚠️ Más de 2 min compilando. Es posible que este modelo sea demasiado grande o complejo para los recursos de tu dispositivo. Considera elegir un modelo más ligero si la carga no se completa.'
                        : progress.status === 'compiling'
                            ? 'Este proceso es intensivo y puede tardar entre 30s y 2 min en modelos grandes. La app no está colgada.'
                        : useVisionTask
                            ? 'Los modelos multimodales suelen descargar más componentes que uno solo de texto. ⚠️ El modelo en memoria se descartará al salir o recargar la página.'
                            : 'Este paso solo suele ocurrir la primera vez o tras limpiar la caché. ⚠️ El modelo en memoria se descartará al salir o recargar la página.'
                });
                updateStreamingMessage(msgIdx, assistantMsg);
            }, pipelineTask);

            if (!pipe) throw new Error('No se pudo inicializar Pipeline WebGPU.');
            if (state.abortController?.signal?.aborted || webgpuState.cancelRequested) {
                throw new DOMException('Carga cancelada por el usuario.', 'AbortError');
            }

            let rawImages = [];
            let imageMetaList = [];
            const imageAssistMessages = chat.messages.filter(msg =>
                msg.role === 'user' &&
                normalizeImageMeta(msg.imageMeta, msg.images || []).length > 0 &&
                (!Array.isArray(msg.imageCaptions) || msg.imageCaptions.length === 0)
            );

            dom.statusDot.className = 'status-dot online';
            dom.statusText.textContent = '🧠 Inferencia local';
            setMessageLoadingState(assistantMsg, {
                phase: 'generating',
                detail: useVisionTask
                    ? `${modelLabel} ya está listo. Preparando imágenes y generando la respuesta localmente.`
                    : `${modelLabel} ya está listo. Generando la respuesta localmente.`,
                modelLabel,
                deviceLabel,
                sourceUrl: buildWebGPURepoUrl(modelId),
                progress: null,
                progressLabel: '',
                file: '',
                note: useVisionTask
                    ? 'La inferencia multimodal sucede en tu navegador; las imágenes no se envían a un servidor.'
                    : 'La inferencia sucede en tu navegador; no se envía el contenido a un servidor.'
            });
            updateStreamingMessage(msgIdx, assistantMsg);

            // Build conversation context
            const proj = state.projects.find(p => p.id === chat.projectId) || getActiveProject();
            let systemContent = state.settings.systemPrompt || '';
            if (proj.systemPrompt?.trim()) systemContent += `\n\n${proj.systemPrompt}`;

            if (!useVisionTask && supportsWebGPUImageAssist() && imageAssistMessages.length > 0) {
                setMessageLoadingState(assistantMsg, {
                    phase: 'initializing',
                    detail: `Analizando ${imageAssistMessages.reduce((sum, msg) => sum + normalizeImageMeta(msg.imageMeta, msg.images || []).length, 0)} imagen(es) con ${WEBGPU_IMAGE_ASSIST.label}.`,
                    modelLabel,
                    deviceLabel,
                    sourceUrl: buildWebGPURepoUrl(WEBGPU_IMAGE_ASSIST.id),
                    progress: 0,
                    progressLabel: 'Vision',
                    file: '',
                    note: 'La imagen se convierte en descripcion local antes de pasarla al modelo de chat.'
                });
                updateStreamingMessage(msgIdx, assistantMsg);

                let processedCount = 0;
                for (const msg of imageAssistMessages) {
                    const normalizedImages = normalizeImageMeta(msg.imageMeta, msg.images || []);
                    msg.imageCaptions = await analyzeImagesForWebGPU(normalizedImages, (pct, progress) => {
                        setMessageLoadingState(assistantMsg, {
                            phase: 'initializing',
                            detail: `Analizando imagenes adjuntas localmente para enriquecer el prompt.`,
                            modelLabel,
                            deviceLabel,
                            sourceUrl: progress.sourceUrl || buildWebGPURepoUrl(WEBGPU_IMAGE_ASSIST.id),
                            progress: pct,
                            progressLabel: 'Vision',
                            file: progress.file || '',
                            note: `Modelo auxiliar: ${WEBGPU_IMAGE_ASSIST.id}`
                        });
                        updateStreamingMessage(msgIdx, assistantMsg);
                    });
                    processedCount += normalizedImages.length;
                }
                if (processedCount > 0) saveState();
            }

            const builtConversation = buildWebGPUConversation(chat, systemContent, useVisionTask);
            let conversationHistory = builtConversation.conversationHistory;
            imageMetaList = builtConversation.imageMetaList;

            let generationOutcome = null;

            if (useVisionTask) {
                try {
                    if (imageMetaList.length > 0) {
                        setMessageLoadingState(assistantMsg, {
                            phase: 'initializing',
                            detail: `Transformando ${imageMetaList.length} imagen${imageMetaList.length === 1 ? '' : 'es'} para ${modelLabel}.`,
                            modelLabel,
                            deviceLabel,
                            sourceUrl: buildWebGPURepoUrl(modelId),
                            progress: null,
                            progressLabel: 'Imagenes',
                            file: '',
                            note: 'Intentando primero el flujo VLM nativo del modelo de vision.'
                        });
                        updateStreamingMessage(msgIdx, assistantMsg);
                        rawImages = await getWebGPURawImages(imageMetaList);
                    }

                    generationOutcome = await runWebGPUGeneration(pipe, {
                        text: conversationHistory,
                        images: rawImages
                    }, assistantMsg, msgIdx);
                } catch (visionError) {
                    const fallbackModelId = getWebGPUTextFallbackModelId();
                    const fallbackModelDef = WEBGPU_MODELS.find(m => m.id === fallbackModelId);
                    const fallbackModelLabel = fallbackModelDef?.label || fallbackModelId;

                    console.warn('[WebGPU] VLM path failed, falling back to local image assist:', visionError);
                    setMessageLoadingState(assistantMsg, {
                        phase: 'initializing',
                        detail: `El flujo VLM ha fallado. Recuperando la conversacion con analisis visual local y ${fallbackModelLabel}.`,
                        modelLabel,
                        deviceLabel,
                        sourceUrl: buildWebGPURepoUrl(fallbackModelId),
                        progress: 0,
                        progressLabel: 'Fallback',
                        file: '',
                        note: 'Se mantiene el chat y la imagen se convertira en contexto textual automaticamente.'
                    });
                    updateStreamingMessage(msgIdx, assistantMsg);

                    let processedCount = 0;
                    for (const msg of imageAssistMessages) {
                        const normalizedImages = normalizeImageMeta(msg.imageMeta, msg.images || []);
                        msg.imageCaptions = await analyzeImagesForWebGPU(normalizedImages, (pct, progress) => {
                            setMessageLoadingState(assistantMsg, {
                                phase: 'initializing',
                                detail: 'Analizando imagenes localmente para recuperar la conversacion.',
                                modelLabel: fallbackModelLabel,
                                deviceLabel,
                                sourceUrl: progress.sourceUrl || buildWebGPURepoUrl(WEBGPU_IMAGE_ASSIST.id),
                                progress: pct,
                                progressLabel: 'Fallback',
                                file: progress.file || '',
                                note: `Modelo auxiliar: ${WEBGPU_IMAGE_ASSIST.id}`
                            });
                            updateStreamingMessage(msgIdx, assistantMsg);
                        });
                        processedCount += normalizedImages.length;
                    }
                    if (processedCount > 0) saveState();

                    const fallbackPipe = await loadWebGPUModel(fallbackModelId, (pct, progress) => {
                        const stage = describeWebGPUProgressStage(progress);
                        const phase = stage.phase;
                        setMessageLoadingState(assistantMsg, {
                            phase,
                            detail: `${stage.detail} (${fallbackModelLabel}).`,
                            modelLabel: fallbackModelLabel,
                            deviceLabel,
                            sourceUrl: progress.sourceUrl || buildWebGPURepoUrl(fallbackModelId),
                            progress: pct,
                            progressLabel: stage.progressLabel,
                            file: progress.file || '',
                            note: 'Fallback automatico tras fallo del modelo de vision.'
                        });
                        updateStreamingMessage(msgIdx, assistantMsg);
                    }, 'text-generation');

                    conversationHistory = buildWebGPUConversation(chat, systemContent, false).conversationHistory;
                    setMessageLoadingState(assistantMsg, {
                        phase: 'generating',
                        detail: `${fallbackModelLabel} esta respondiendo con el analisis visual local como contexto.`,
                        modelLabel: fallbackModelLabel,
                        deviceLabel,
                        sourceUrl: buildWebGPURepoUrl(fallbackModelId),
                        progress: null,
                        progressLabel: '',
                        file: '',
                        note: `Fallback automatico desde ${modelLabel}.`
                    });
                    updateStreamingMessage(msgIdx, assistantMsg);

                    generationOutcome = await runWebGPUGeneration(fallbackPipe, conversationHistory, assistantMsg, msgIdx);
                    assistantMsg.model = fallbackModelId;
                    assistantMsg.fallbackFrom = modelId;
                    assistantMsg.fallbackReason = visionError.message || String(visionError);
                }
            } else {
                generationOutcome = await runWebGPUGeneration(pipe, conversationHistory, assistantMsg, msgIdx);
            }

            assistantMsg.content = generationOutcome?.text || '*(Sin respuesta generada)*';
            clearMessageLoadingState(assistantMsg);
            if (generationOutcome?.metrics) {
                assistantMsg.metrics = generationOutcome.metrics;
            }

            dom.statusText.textContent = '🧠 Modelo listo';
            updateInputDisclaimer();

        } catch (e) {
            if (e.name === 'AbortError' || state.abortController?.signal?.aborted) {
                setMessageLoadingState(assistantMsg, {
                    phase: 'cancelled',
                    detail: 'La carga o generación se ha detenido antes de completarse.',
                    modelLabel: assistantMsg.loading?.modelLabel,
                    deviceLabel: assistantMsg.loading?.deviceLabel,
                    sourceUrl: assistantMsg.loading?.sourceUrl,
                    progress: assistantMsg.loading?.progress ?? null,
                    progressLabel: assistantMsg.loading?.progressLabel || '',
                    file: '',
                    note: webgpuState.isLoading
                        ? 'El navegador puede terminar la descarga actual en segundo plano antes de liberar el proceso.'
                        : 'Puedes volver a intentarlo cuando quieras.'
                });
                if (!assistantMsg.content) assistantMsg.content = '*[Operación detenida por el usuario]*';
            } else {
                console.error('[WebGPU] inference error:', e);
                const errorDetail = formatErrorDetail(e);
                const errStr = errorDetail.toLowerCase();
                
                let errorHtml = `⚠️ **Fallo en motor WebGPU**\nHubo un problema intentando instalar o ejecutar el modelo en tu navegador.\n\n`;
                
                if (errStr.includes('could not locate file') || errStr.includes('config.json') || errStr.includes('/resolve/main/{file}/') || errStr.includes('file not found')) {
                    errorHtml += `> **📦 Repositorio incompatible o incompleto**\n> El navegador ha localizado el repositorio, pero no ha encontrado los archivos esperados por Transformers.js/WebGPU para montar el modelo.\n>\n> 👉 **Solución:** Prueba otro modelo del catálogo marcado como verificado, o revisa que el repositorio manual sea una variante ONNX/Transformers.js compatible.`;
                } else if (errStr.includes('image-to-text') || errStr.includes('rawimage') || errStr.includes('image processor') || errStr.includes('vit-gpt2-image-captioning')) {
                    errorHtml += `> **👁 Fallo en el asistente visual local**\n> La app ha intentado convertir tu imagen en una descripcion local antes de pasarla al modelo de chat, pero ese paso ha fallado.\n>\n> 👉 **Solución:** Reintenta con una imagen mas pequeña o menos compleja. Si persiste, usa un modelo solo texto sin imagen o un proveedor con vision nativa.`;
                } else if (errStr.includes('image-text-to-text') || errStr.includes('qwen2-vl') || errStr.includes('phi-3.5-vision')) {
                    errorHtml += `> **👁 Limitación real del runtime multimodal**\n> Este modelo VLM aparece en el catálogo, pero el chat multimodal tipo Qwen2-VL / Phi-3.5-Vision todavía no encaja bien con el soporte actual de Transformers.js en navegador.\n>\n> 👉 **Solución:** Usa por ahora un modelo solo texto en WebGPU con el asistente visual local, o cambia a un proveedor cloud/local que sí soporte visión conversacional de forma nativa.`;
                } else if (errStr.includes('401') || errStr.includes('403') || errStr.includes('unauthorized') || errStr.includes('access')) {
                    errorHtml += `> **🔒 Acceso Denegado / Modelo no disponible**\n> Este modelo no ha sido encontrado o requiere una API Key de HuggingFace. Es probable que el ID del modelo haya cambiado en el repositorio central.\n>\n> 👉 **Solución:** Vuelve a los ajustes y selecciona otro modelo. Te recomendamos **SmolLM2** o la versión **Coder de Qwen 2.5** que están verificadas.`;
                } else if (errStr.includes('out of memory') || errStr.includes('oom') || errStr.includes('allocate') || errStr.includes('allocation') || errStr.includes('insufficient memory') || errStr.includes('device lost')) {
                    errorHtml += `> **💥 Memoria Insuficiente (OOM)**\n> Tu navegador / tarjeta gráfica se ha quedado sin memoria intentando montar este cerebro en la VRAM local.\n>\n> 👉 **Solución:** Vuelve a los ajustes y elige un modelo más ligero (categoría ⚡ Ligeros). También puedes intentar cerrar pestañas pesadas o reiniciar el navegador.`;
                } else if (isOpaqueWebGPUNumericError(errorDetail)) {
                    errorHtml += `> **🧩 Fallo opaco del runtime WebGPU/ONNX**\n> El motor local ha devuelto un código interno (\`${errorDetail}\`) en vez de un mensaje legible. Esto suele ocurrir al final de la carga cuando la variante descargada no llega a inicializarse bien en tu navegador o tu GPU.\n>\n> 👉 **Solución:** La app ya intenta una variante más ligera cuando puede. Si este fallo persiste, prueba de nuevo con \`Phi-4 Mini\` tras recargar o cambia a \`Qwen 2.5 Coder 1.5B\` / \`SmolLM2 1.7B\`, que son más tolerantes en WebGPU.`;
                } else if (errStr.includes('wasm') || errStr.includes('unsupported') || errStr.includes('adapter')) {
                    errorHtml += `> **🚫 Soporte de Hardware**\n> Parece que el navegador no soporta aceleración por hardware o el fallback de WebAssembly (CPU) está fallando/agotando los recursos.\n>\n> 👉 **Solución:** Comprueba que usas una versión reciente de Chrome/Edge (v113+) y que tienes habilitada la *"Aceleración por hardware"* en sus ajustes.`;
                } else if (errStr.includes('network') || errStr.includes('fetch')) {
                    errorHtml += `> **📶 Error de Red**\n> Hubo un corte de conexión mientras descargábamos los pesos (tensores) de HuggingFace.\n>\n> 👉 **Solución:** Comprueba tu internet y vuelve a darle a reintentar.`;
                } else {
                    errorHtml += `> **Detalle técnico:** \`${errorDetail}\`\n>\n> 👉 **Solución:** Refresca la página, intenta limpiar la caché o usar un modelo más pequeño.`;
                }
                
                setMessageLoadingState(assistantMsg, {
                    phase: 'error',
                    detail: 'La preparación del modelo se interrumpió por un error.',
                    modelLabel: assistantMsg.loading?.modelLabel,
                    deviceLabel: assistantMsg.loading?.deviceLabel,
                    sourceUrl: assistantMsg.loading?.sourceUrl || buildWebGPURepoUrl(modelId),
                    progress: assistantMsg.loading?.progress ?? null,
                    progressLabel: assistantMsg.loading?.progressLabel || '',
                    file: '',
                    note: 'Revisa el mensaje de error y cambia a un modelo más ligero si hace falta.'
                });
                assistantMsg.content = errorHtml;
            }
            updateStreamingMessage(msgIdx, assistantMsg);
        } finally {
            webgpuState.cancelRequested = false;
            state.isStreaming = false;
            state.abortController = null;
            dom.stopBtn.classList.add('hidden');
            dom.sendBtn.classList.remove('hidden');
            chat.updatedAt = Date.now();
            saveState();
            renderChatList();
            renderMessages();
        }
        return;
    }
    // ── End WebGPU Branch ────────────────────────────────────────────────────
    
    try {
        const headers = getAuthHeaders();
        // Solo usar autoSendBody si es un array de mensajes (para el optimizador de prompts u otros)
        // Si es un simple flag 'RETRY_LAST', reconstruir desde el historial.
        let messages = (autoSendBody && Array.isArray(autoSendBody)) ? autoSendBody : buildApiMessages(chat);
        
        const reader_decoder = { reader: null, decoder: new TextDecoder() };
        let buffer = '';
        let isInThinking = false;
        let thinkingText = '';
        let responseText = '';
        let pendingToolCall = null;
        let partialToolCallArgs = '';
        const startTime = Date.now();
        
        // ── Build request based on provider type ──
        if (provType === 'ollama') {
            // Ollama native streaming
            let reqBody = {
                model: state.settings.model,
                messages: messages,
                stream: true,
                options: {
                    temperature: parseFloat(state.settings.temperature),
                    top_p: parseFloat(state.settings.topP || 0.9),
                    top_k: parseInt(state.settings.topK || 40)
                }
            };
            
            if (dom.toolInternet.classList.contains('active') && state.capabilities.includes('tools')) {
                reqBody.tools = [buildWikipediaTool()];
            }
            
            const response = await fetch(`${state.settings.ollamaUrl}/api/chat`, {
                method: 'POST', headers, body: JSON.stringify(reqBody),
                signal: state.abortController.signal,
            });
            if (!response.ok) throw new Error(`Error: ${response.status} ${response.statusText}`);
            
            reader_decoder.reader = response.body.getReader();
            
            while (true) {
                const { done, value } = await reader_decoder.reader.read();
                if (done) break;
                buffer += reader_decoder.decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const json = JSON.parse(line);
                        if (json.done && json.total_duration) {
                            assistantMsg.metrics = {
                                total_duration: json.total_duration,
                                load_duration: json.load_duration,
                                prompt_eval_count: json.prompt_eval_count,
                                eval_count: json.eval_count,
                                eval_duration: json.eval_duration
                            };
                        }
                        if (json.message?.tool_calls) pendingToolCall = json.message.tool_calls;
                        const token = json.message?.content || '';
                        if (token) {
                            processStreamToken(token, assistantMsg, msgIdx, { isInThinking, thinkingText, responseText });
                            isInThinking = streamState.isInThinking;
                            thinkingText = streamState.thinkingText;
                            responseText = streamState.responseText;
                        }
                    } catch(e) {}
                }
            }
            
        } else if (provType === 'openai') {
            // OpenAI-compatible streaming (LMStudio, Groq, OpenRouter, OpenAI)
            // Map images for OpenAI vision format
            if (!autoSendBody) {
                messages = messages.map(m => {
                    if (m.images && m.images.length > 0) {
                        const contentArr = [{ type: "text", text: m.content || "Imagen adjunta:" }];
                        m.images.forEach(imgBase64 => {
                            const mimeType = imgBase64.startsWith('/') ? 'image/jpeg' : (imgBase64.startsWith('iVB') ? 'image/png' : 'image/jpeg');
                            contentArr.push({ type: "image_url", image_url: { url: `data:${mimeType};base64,${imgBase64}` } });
                        });
                        const newM = { ...m, content: contentArr };
                        delete newM.images;
                        return newM;
                    }
                    return m;
                });
            }
            
            let maxTok = parseInt(state.settings.maxTokens || 4096);
            // Cap max_tokens for Groq (hard limit usually 8192 for output tokens)
            if (state.settings.provider === 'groq' && maxTok > 8192) {
                maxTok = 8192;
            }

            let reqBody = {
                model: state.settings.model,
                messages: messages,
                stream: true,
                temperature: parseFloat(state.settings.temperature),
                top_p: parseFloat(state.settings.topP || 0.9),
                max_tokens: maxTok
            };
            
            // Add top_k only for providers that definitely support it (Ollama, Claude, Gemini)
            // Removed groq as it rejects the property
            if (['ollama', 'claude', 'gemini'].includes(state.settings.provider)) {
                reqBody.top_k = parseInt(state.settings.topK || 40);
            }
            
            // Only include stream_options if exactly OpenAI (many others fail or rate-limit on this)
            if (state.settings.provider === 'openai') {
                reqBody.stream_options = { include_usage: true };
            }
            
            if (dom.toolInternet.classList.contains('active') && state.capabilities.includes('tools')) {
                reqBody.tools = [buildWikipediaTool()];
            }
            
            const response = await fetch(`${state.settings.ollamaUrl}/chat/completions`, {
                method: 'POST', headers, body: JSON.stringify(reqBody),
                signal: state.abortController.signal,
            });
            
            if (!response.ok) {
                let errorDetail = response.statusText;
                try {
                    const errorJson = await response.json();
                    // OpenRouter/Groq/OpenAI error nesting variants
                    errorDetail = errorJson.error?.message || errorJson.message || (errorJson.error && typeof errorJson.error === 'string' ? errorJson.error : errorDetail);
                } catch(e) {}
                throw new Error(`${response.status}: ${errorDetail}`);
            }
            
            reader_decoder.reader = response.body.getReader();
            
            while (true) {
                const { done, value } = await reader_decoder.reader.read();
                if (done) break;
                buffer += reader_decoder.decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;
                    const jsonStr = trimmed.substring(6);
                    if (jsonStr === '[DONE]') continue;
                    try {
                        const json = JSON.parse(jsonStr);
                        if (json.usage) {
                            assistantMsg.metrics = {
                                prompt_eval_count: json.usage.prompt_tokens,
                                eval_count: json.usage.completion_tokens,
                                total_tokens: json.usage.total_tokens,
                                total_time_ms: Date.now() - startTime
                            };
                            if (assistantMsg.metrics.eval_count && assistantMsg.metrics.total_time_ms > 0) {
                                assistantMsg.metrics.tps = (assistantMsg.metrics.eval_count / (assistantMsg.metrics.total_time_ms / 1000)).toFixed(2);
                            }
                        }
                        const delta = json.choices?.[0]?.delta || {};
                        const toolCallsData = delta.tool_calls;
                        if (toolCallsData && toolCallsData.length > 0) {
                            if (!pendingToolCall) {
                                pendingToolCall = [{ function: { name: toolCallsData[0].function.name, arguments: "" } }];
                            } else if (toolCallsData[0].function?.arguments) {
                                partialToolCallArgs += toolCallsData[0].function.arguments;
                            }
                        }
                        if (json.choices?.[0]?.finish_reason === 'tool_calls' && pendingToolCall) {
                            pendingToolCall[0].function.arguments = partialToolCallArgs || '{}';
                            pendingToolCall[0].function.arguments = JSON.parse(pendingToolCall[0].function.arguments);
                        }
                        const token = delta.content || '';
                        if (token) {
                            processStreamToken(token, assistantMsg, msgIdx, { isInThinking, thinkingText, responseText });
                            isInThinking = streamState.isInThinking;
                            thinkingText = streamState.thinkingText;
                            responseText = streamState.responseText;
                        }
                    } catch(e) {}
                }
            }
            
        } else if (provType === 'gemini') {
            // Google Gemini streaming
            const apiKey = state.settings.apiKey;
            const geminiMessages = buildGeminiMessages(chat);
            
            let reqBody = {
                contents: geminiMessages.contents,
                generationConfig: {
                    temperature: parseFloat(state.settings.temperature),
                    topP: parseFloat(state.settings.topP || 0.9),
                    topK: parseInt(state.settings.topK || 40),
                    maxOutputTokens: parseInt(state.settings.maxTokens || 4096)
                }
            };
            if (geminiMessages.systemInstruction) {
                reqBody.system_instruction = geminiMessages.systemInstruction;
            }
            
            const response = await fetch(
                `${state.settings.ollamaUrl}/models/${state.settings.model}:streamGenerateContent?alt=sse&key=${apiKey}`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reqBody), signal: state.abortController.signal }
            );
            if (!response.ok) throw new Error(`Error: ${response.status} ${response.statusText}`);
            
            reader_decoder.reader = response.body.getReader();
            
            while (true) {
                const { done, value } = await reader_decoder.reader.read();
                if (done) break;
                buffer += reader_decoder.decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;
                    const jsonStr = trimmed.substring(6);
                    try {
                        const json = JSON.parse(jsonStr);
                        // Gemini thinking via thought field
                        const parts = json.candidates?.[0]?.content?.parts || [];
                        for (const part of parts) {
                            if (part.thought) {
                                thinkingText += part.text || '';
                                assistantMsg.thinking = thinkingText;
                                updateStreamingMessage(msgIdx, assistantMsg);
                            } else if (part.text) {
                                responseText += part.text;
                                assistantMsg.content = responseText;
                                updateStreamingMessage(msgIdx, assistantMsg);
                            }
                        }
                        // Usage metrics
                        if (json.usageMetadata) {
                            assistantMsg.metrics = {
                                prompt_eval_count: json.usageMetadata.promptTokenCount,
                                eval_count: json.usageMetadata.candidatesTokenCount,
                                total_tokens: json.usageMetadata.totalTokenCount,
                                total_time_ms: Date.now() - startTime
                            };
                            if (assistantMsg.metrics.eval_count && assistantMsg.metrics.total_time_ms > 0) {
                                assistantMsg.metrics.tps = (assistantMsg.metrics.eval_count / (assistantMsg.metrics.total_time_ms / 1000)).toFixed(2);
                            }
                        }
                    } catch(e) {}
                }
            }
            
        } else if (provType === 'anthropic') {
            // Anthropic Messages API streaming
            const anthropicData = buildAnthropicMessages(chat);
            
            let reqBody = {
                model: state.settings.model,
                messages: anthropicData.messages,
                max_tokens: parseInt(state.settings.maxTokens || 8192),
                stream: true,
                temperature: parseFloat(state.settings.temperature),
                top_p: parseFloat(state.settings.topP || 0.9),
                top_k: parseInt(state.settings.topK || 40)
            };
            if (anthropicData.system) {
                reqBody.system = anthropicData.system;
            }
            
            const response = await fetch(`${state.settings.ollamaUrl}/messages`, {
                method: 'POST', headers, body: JSON.stringify(reqBody),
                signal: state.abortController.signal,
            });
            if (!response.ok) throw new Error(`Error: ${response.status} ${response.statusText}`);
            
            reader_decoder.reader = response.body.getReader();
            let currentBlockType = null;
            
            while (true) {
                const { done, value } = await reader_decoder.reader.read();
                if (done) break;
                buffer += reader_decoder.decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;
                    const jsonStr = trimmed.substring(6);
                    try {
                        const json = JSON.parse(jsonStr);
                        
                        if (json.type === 'content_block_start') {
                            currentBlockType = json.content_block?.type || 'text';
                        } else if (json.type === 'content_block_delta') {
                            const delta = json.delta || {};
                            if (delta.type === 'thinking_delta') {
                                thinkingText += delta.thinking || '';
                                assistantMsg.thinking = thinkingText;
                                updateStreamingMessage(msgIdx, assistantMsg);
                            } else if (delta.type === 'text_delta') {
                                responseText += delta.text || '';
                                assistantMsg.content = responseText;
                                updateStreamingMessage(msgIdx, assistantMsg);
                            }
                        } else if (json.type === 'message_delta') {
                            if (json.usage) {
                                assistantMsg.metrics = {
                                    eval_count: json.usage.output_tokens,
                                    total_time_ms: Date.now() - startTime
                                };
                                if (assistantMsg.metrics.eval_count && assistantMsg.metrics.total_time_ms > 0) {
                                    assistantMsg.metrics.tps = (assistantMsg.metrics.eval_count / (assistantMsg.metrics.total_time_ms / 1000)).toFixed(2);
                                }
                            }
                        } else if (json.type === 'message_start' && json.message?.usage) {
                            assistantMsg.metrics = assistantMsg.metrics || {};
                            assistantMsg.metrics.prompt_eval_count = json.message.usage.input_tokens;
                        }
                    } catch(e) {}
                }
            }
        }
        
        // Tool Call Proxy Logic (Ollama & OpenAI)
        if (pendingToolCall && pendingToolCall.length > 0) {
            state.isStreaming = false;
            
            assistantMsg.content = "*(Buscando en Internet...)*\n\n";
            assistantMsg.tool_calls = pendingToolCall;
            updateStreamingMessage(msgIdx, assistantMsg);
            
            const tool = pendingToolCall[0];
            let searchResult = "No results.";
            
            if (tool.function.name === 'search_wikipedia') {
                try {
                    const q = encodeURIComponent(tool.function.arguments.query);
                    const wpRes = await fetch(`https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&utf8=&format=json&origin=*`);
                    const wpData = await wpRes.json();
                    if (wpData.query && wpData.query.search.length > 0) {
                        searchResult = wpData.query.search.slice(0, 3).map(s => s.snippet.replace(/<[^>]+>/g, '')).join('\\n\\n');
                    } else {
                        searchResult = "Empty results.";
                    }
                } catch(e) {
                    searchResult = "Error connecting to Wikipedia.";
                }
            }
            
            const toolMsg = { role: 'tool', content: searchResult };
            chat.messages.push(toolMsg);
            
            const loopMessages = buildApiMessages(chat);
            return sendMessage('', loopMessages);
        }
        
    } catch (e) {
        if (e.name === 'AbortError') {
            assistantMsg.content += '\n\n*[Generación detenida]*';
        } else {
            console.error('Chat error:', e);
            const provName = getProviderDef(state.settings.provider).name;
            assistantMsg.content = `⚠️ **Error de conexión con ${provName}**\n\n\`${e.message}\`\n\nVerifica que el proveedor está configurado correctamente y que la API Key (si aplica) es válida.`;
        }
        updateStreamingMessage(msgIdx, assistantMsg);
    } finally {
        state.isStreaming = false;
        state.abortController = null;
        dom.stopBtn.classList.add('hidden');
        dom.sendBtn.classList.remove('hidden');
        chat.updatedAt = Date.now();
        saveState();
        renderChatList();
        renderMessages();
        
        // Auto-generate title after first successful exchange
        if (chat.messages.length >= 2 && !chat.autoTitled && typeof autoTitleChat === 'function') {
            autoTitleChat(chat.id);
        }
    }
}

// ─── Stream token processor (shared state) ──
const streamState = {
    isInThinking: false,
    thinkingText: '',
    responseText: '',
    // Render-batching: tracks whether there's a pending rAF paint
    _dirty: false,
    _pendingMsg: null,
    _pendingIdx: null,
};

/**
 * _flushStreamRender — called via requestAnimationFrame once per frame.
 * Batches all tokens that arrived since the last paint into a single DOM update,
 * capping render rate at ≈60 fps regardless of token speed.
 */
function _flushStreamRender() {
    if (!streamState._dirty) return;
    streamState._dirty = false;
    updateStreamingMessage(streamState._pendingIdx, streamState._pendingMsg);
}

function processStreamToken(token, assistantMsg, msgIdx, ctx) {
    streamState.isInThinking = ctx.isInThinking;
    streamState.thinkingText = ctx.thinkingText;
    streamState.responseText = ctx.responseText;
    
    if (token.includes('<|think|>') || token.includes('<think>')) {
        streamState.isInThinking = true;
        return;
    }
    if (token.includes('<|/think|>') || token.includes('</think>')) {
        streamState.isInThinking = false;
        return;
    }
    
    if (streamState.isInThinking) {
        streamState.thinkingText += token;
        assistantMsg.thinking = streamState.thinkingText;
    } else {
        streamState.responseText += token;
        assistantMsg.content = streamState.responseText;
    }

    // Schedule a batched render — skip if one is already queued this frame
    streamState._pendingMsg = assistantMsg;
    streamState._pendingIdx = msgIdx;
    if (!streamState._dirty) {
        streamState._dirty = true;
        requestAnimationFrame(_flushStreamRender);
    }
}

function buildWikipediaTool() {
    return {
        type: "function",
        function: {
            name: "search_wikipedia",
            description: "Busca información y artículos reales recientes en Wikipedia.",
            parameters: {
                type: "object",
                properties: { query: { type: "string", description: "El término o pregunta exacta a buscar." } },
                required: ["query"]
            }
        }
    };
}

// ─── Message builders per provider type ─────
function buildApiMessages(chat) {
    const provType = getProviderDef(state.settings.provider).type;
    
    // For Gemini and Anthropic, use their specific builders during streaming
    // This function is used for Ollama & OpenAI-compatible
    const messages = [];
    const proj = state.projects.find(p => p.id === chat.projectId) || getActiveProject();
    
    let combinedSystem = '';
    if (state.settings.systemPrompt.trim()) combinedSystem += state.settings.systemPrompt + '\n\n';
    if (proj.systemPrompt && proj.systemPrompt.trim()) combinedSystem += `[INSTRUCCIONES DEL PROYECTO]: ${proj.systemPrompt}\n\n`;
    
    if (proj.documents && proj.documents.length > 0) {
        combinedSystem += '[BASE DE CONOCIMIENTO PERMANENTE DEL PROYECTO]:\n';
        proj.documents.forEach(doc => {
            combinedSystem += `\n--- Archivo Base: ${doc.name} ---\n${doc.data}\n`;
        });
        combinedSystem += '\nUtiliza la información estricta de esta Base de Conocimiento si aplica.\n\n';
    }
    
    if (combinedSystem.trim()) {
        messages.push({ role: 'system', content: combinedSystem.trim() });
    }
    
    for (const msg of chat.messages) {
        if (msg.role === 'assistant' && msg.content === '' && msg.thinking === '' && !msg.tool_calls) continue;
        const apiMsg = { role: msg.role, content: msg.content };
        if (msg.images) apiMsg.images = msg.images;
        if (msg.tool_calls) apiMsg.tool_calls = msg.tool_calls;
        messages.push(apiMsg);
    }
    return messages;
}

function buildGeminiMessages(chat) {
    const proj = state.projects.find(p => p.id === chat.projectId) || getActiveProject();
    
    let systemText = '';
    if (state.settings.systemPrompt.trim()) systemText += state.settings.systemPrompt + '\n\n';
    if (proj.systemPrompt && proj.systemPrompt.trim()) systemText += `[INSTRUCCIONES DEL PROYECTO]: ${proj.systemPrompt}\n\n`;
    if (proj.documents && proj.documents.length > 0) {
        systemText += '[BASE DE CONOCIMIENTO]:\n';
        proj.documents.forEach(doc => { systemText += `\n--- ${doc.name} ---\n${doc.data}\n`; });
    }
    
    const contents = [];
    for (const msg of chat.messages) {
        if (msg.role === 'assistant' && msg.content === '' && msg.thinking === '') continue;
        if (msg.role === 'system' || msg.role === 'tool') continue;
        
        const role = msg.role === 'assistant' ? 'model' : 'user';
        const parts = [];
        
        if (msg.images && msg.images.length > 0) {
            msg.images.forEach(imgBase64 => {
                const mimeType = imgBase64.startsWith('/') ? 'image/jpeg' : 'image/png';
                parts.push({ inline_data: { mime_type: mimeType, data: imgBase64 } });
            });
        }
        parts.push({ text: msg.content || '' });
        contents.push({ role, parts });
    }
    
    return {
        systemInstruction: systemText.trim() ? { parts: [{ text: systemText.trim() }] } : null,
        contents
    };
}

function buildAnthropicMessages(chat) {
    const proj = state.projects.find(p => p.id === chat.projectId) || getActiveProject();
    
    let systemText = '';
    if (state.settings.systemPrompt.trim()) systemText += state.settings.systemPrompt + '\n\n';
    if (proj.systemPrompt && proj.systemPrompt.trim()) systemText += `[INSTRUCCIONES DEL PROYECTO]: ${proj.systemPrompt}\n\n`;
    if (proj.documents && proj.documents.length > 0) {
        systemText += '[BASE DE CONOCIMIENTO]:\n';
        proj.documents.forEach(doc => { systemText += `\n--- ${doc.name} ---\n${doc.data}\n`; });
    }
    
    const messages = [];
    for (const msg of chat.messages) {
        if (msg.role === 'system' || msg.role === 'tool') continue;
        if (msg.role === 'assistant' && msg.content === '' && msg.thinking === '') continue;
        
        const role = msg.role; // 'user' or 'assistant'
        const content = [];
        
        if (msg.images && msg.images.length > 0) {
            msg.images.forEach(imgBase64 => {
                const mimeType = imgBase64.startsWith('/') ? 'image/jpeg' : 'image/png';
                content.push({ type: 'image', source: { type: 'base64', media_type: mimeType, data: imgBase64 } });
            });
        }
        content.push({ type: 'text', text: msg.content || '' });
        messages.push({ role, content });
    }
    
    // Anthropic requires alternating user/assistant. Ensure first message is user.
    if (messages.length > 0 && messages[0].role !== 'user') {
        messages.unshift({ role: 'user', content: [{ type: 'text', text: '.' }] });
    }
    
    return {
        system: systemText.trim() || undefined,
        messages
    };
}

function appendTypingMessage(idx) {
    const avatarContent = '<img src="favicon.png" style="width: 22px; height: 22px; border-radius: 4px; object-fit: contain;">';
    const html = `
        <div class="message assistant" id="msg-${idx}">
            <div class="message-inner">
                <div class="message-avatar">${avatarContent}</div>
                <div class="message-body">
                    <div class="message-sender"></div>
                    <div class="message-content">
                            <span></span><span></span><span></span>
                    </div>
                </div>
            </div>
        </div>
    `;
    dom.messagesScroll.insertAdjacentHTML('beforeend', html);
    scrollToBottom();
}

function updateStreamingMessage(idx, msg) {
    // Coalesce: recuerda la última versión y reutiliza el frame ya programado.
    // (Cancelar y reprogramar el rAF en cada token dejaba el DOM sin pintar
    // durante toda la generación WebGPU: cada token nuevo cancelaba el frame
    // pendiente antes de que llegara a ejecutarse.)
    state.pendingRender = { idx, msg };
    if (state.renderQueue) return;

    const flushRender = () => {
        state.renderQueue = null;
        const { idx, msg } = state.pendingRender;
        const msgEl = document.getElementById(`msg-${idx}`);
        if (!msgEl) return;

        const contentEl = msgEl.querySelector('.message-content');
        if (msg.loading?.active && !msg.content && !msg.thinking) {
            patchStreamingLoadingCard(contentEl, msg.loading);
            return;
        }
        let html = '';

        if (msg.thinking && state.settings.thinkingMode) {
            html += `
                <div class="thinking-block">
                    <div class="thinking-header open">
                        ${state.isStreaming && !msg.content ? '<div class="thinking-spinner"></div>' : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 18 6-6-6-6"/></svg>`}
                        Razonamiento
                    </div>
                    <div class="thinking-content open">${renderMarkdown(msg.thinking)}</div>
                </div>
            `;
        }

        if (msg.loading?.active) {
            html += renderLoadingState(msg.loading);
        }

        if (msg.content) {
            html += renderMarkdown(msg.content);
        } else if (state.isStreaming && !msg.thinking && !msg.loading?.active) {
            html += `<div class="typing-indicator"><span></span><span></span><span></span></div>`;
        }
        
        contentEl.innerHTML = html;
        processCodeBlocks(contentEl);
        scrollToBottom();
    };

    // Con la pestaña oculta, requestAnimationFrame no llega a ejecutarse nunca:
    // se usa un temporizador para que el mensaje siga avanzando en segundo plano.
    state.renderQueue = document.hidden
        ? setTimeout(flushRender, 66)
        : requestAnimationFrame(flushRender);
}

function stopStreaming() {
    if (state.abortController) {
        state.abortController.abort();
    }
    if (state.settings.provider === 'webgpu') {
        // El abort del AbortController ya interrumpe la generación (inline y
        // worker); esto además marca la cancelación de una carga en curso.
        webgpuWorker.interrupt();
        if (webgpuState.isLoading) {
            webgpuState.cancelRequested = true;
            dom.statusDot.className = 'status-dot loading';
            dom.statusText.textContent = 'Cancelando carga...';
        }
    }
}

