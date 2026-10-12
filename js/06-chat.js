/* >>> imports (generado por scripts/gen-modules.mjs: no editar a mano) >>> */
// El primer import es el del módulo anterior: así se evalúan en orden (ver scripts/gen-modules.mjs).
import {
    createChat, generateTitle, getActiveChat, getActiveProject, renderAttachmentPreview,
    renderChatList, showChat,
} from './05-workspace.js?v=2610.AB';
import {
    CHARS_PER_TOKEN, CONTEXT_SAFETY_MARGIN_TOKENS, MOBILE_SAFE_WEBGPU_MODEL, WEBGPU_MODELS,
    WEBGPU_PROGRESS_UI_MIN_DELTA_PCT, WEBGPU_PROGRESS_UI_MIN_INTERVAL_MS,
    WEBGPU_TEXT_FALLBACK_MODEL, announce, escapeHtml, estimateTokenCount, getProviderBaseId,
    getVisionAssistDef, importTransformers, isHeavyForMobile, isMobileDevice, notify,
    sanitizeRenderedHtml, tr, trf,
} from './01-core.js?v=2610.AB';
import {
    applySettingsToUI, dom, formatTokens, getActiveProviderConfig, getAuthHeaders,
    getCompactModelLabel, getCompactProviderLabel, getProviderDef, saveCurrentProviderConfig,
    saveState, state, syncProviderToState, updateInputDisclaimer,
} from './02-state.js?v=2610.AB';
import {
    WEBGPU_LOOP_STOP_NOTE, analyzeImagesForWebGPU, applyWebGPUStreamedText, checkWebGPUSupport,
    formatWoundResult, loadDinoMedicalVisionModel, loadFlorence2VisionModel,
    loadVLMVisionModel, loadWebGPUImageAssistPipeline, loadWebGPUModel, loadWoundClassifier,
    maybeStopRepetitionLoop, runDinoMedicalEmbedding, runFlorence2Analysis, runVLMAnalysis,
    runWebGPUGeneration, runWoundClassify, splitWebGPUThinking, updateGenerationStatus,
    webgpuState, webgpuWorker,
} from './03-webgpu.js?v=2610.AB';
import {
    FAILOVER_MAX_HOPS, checkProviderStatus, classifyEngineFailure, describeChatFailure,
    getEngineCooldown, getFailoverCandidates, getWebGPUCustomModels, markEngineFailure,
    markEngineSuccess, parseRetryAfter, providerHttpError, recordWebGPUModelReport,
    withEngineOverride,
} from './04-providers.js?v=2610.AB';
import {
    autoResizeTextarea, autoTitleChat, scrollToBottom, updateSendButton,
} from './07-ui.js?v=2610.AB';
import {
    anonChatState, anonymizeHistoryText, anonymizeOutgoingText, anonymizeTextSync,
    deanonymizeForDisplay, ensureAnonReady, listAnonItems, persistAnonVault, restoreAnonText,
} from './08-anon.js?v=2610.AB';
import {
    t,
} from './09-i18n.js?v=2610.AB';
import {
    formatRagContext, prepareRagContext,
} from './11-rag.js?v=2610.AB';
/* <<< imports <<< */

/* ============================================
   wIA — 06-chat.js
   Render de mensajes, streaming multi-protocolo y builders por proveedor
   (Scripts clásicos cargados en orden desde index.html;
   comparten el ámbito global igual que el antiguo app.js)
   ============================================ */

// ─── Render Messages ────────────────────────

/**
 * isThinkingBlockOpen — estado del desplegable de razonamiento de un mensaje.
 * El clic del usuario (msg.thinkingOpen) manda siempre; sin preferencia,
 * se muestra abierto solo mientras el modelo razona en vivo (aún sin
 * respuesta) y se colapsa automáticamente en cuanto empieza la respuesta.
 */
function isThinkingBlockOpen(msg) {
    if (typeof msg.thinkingOpen === 'boolean') return msg.thinkingOpen;
    return state.isStreaming && !msg.content;
}

/**
 * renderThinkingBlockHtml — bloque colapsable de razonamiento, compartido por
 * el render estático y el de streaming para que el estado no se pierda entre
 * repintados.
 */
function renderThinkingBlockHtml(msg, idx) {
    if (!msg.thinking || !state.settings.thinkingMode) return '';
    const open = isThinkingBlockOpen(msg) ? ' open' : '';
    const live = state.isStreaming && !msg.content;
    const icon = live
        ? '<div class="thinking-spinner"></div>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 18 6-6-6-6"/></svg>';
    const label = live ? 'Razonando…' : 'Razonamiento';
    return `
        <div class="thinking-block">
            <div class="thinking-header${open}" data-idx="${idx}">
                ${icon}
                ${label}
            </div>
            <div class="thinking-content${open}" data-idx="${idx}">${renderMarkdown(msg.thinking)}</div>
        </div>
    `;
}

// ─── Render incremental ─────────────────────
// renderMessages se llama tras CADA turno, y antes reconstruía el innerHTML de
// toda la conversación: en un chat largo eso significa reparsear cientos de
// mensajes, rehacer el resaltado de sintaxis de todos los bloques de código y
// perder la selección de texto del usuario, cada vez. Ahora se compara una
// firma por mensaje y solo se toca lo que ha cambiado.

/** Contador para forzar repintado cuando cambia algo externo al mensaje. */
let _renderEpoch = 0;
function invalidateMessageRender() { _renderEpoch++; }

/** Hash corto y estable de una cadena (djb2). */
function hashString(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}

/**
 * messageSignature — resume TODO lo que influye en el HTML de un mensaje.
 * Si se añade un dato nuevo a renderMessage hay que reflejarlo aquí, o el
 * cambio no se repintará.
 */
function messageSignature(msg, idx) {
    const parts = JSON.stringify([
        _renderEpoch, idx, msg.role,
        msg.content || '', msg.thinking || '',
        msg.thinkingOpen ?? null,
        state.settings.thinkingMode ? 1 : 0,
        // isThinkingBlockOpen y el indicador de escritura dependen del estado de
        // streaming, pero solo mientras el mensaje aún no tiene contenido.
        (!msg.content && state.isStreaming) ? 1 : 0,
        msg.loading?.active ? [msg.loading.phase, msg.loading.progress, msg.loading.file, msg.loading.detail, msg.loading.note] : 0,
        msg.metrics ? [msg.metrics.tps ?? null, msg.metrics.eval_count ?? null, msg.metrics.eval_duration ?? null] : 0,
        msg.bookmarked ? 1 : 0,
        msg.anonCount || 0,
        msg.contextTrim ? [msg.contextTrim.droppedMessages, msg.contextTrim.docsTruncated, msg.contextTrim.docsIncluded, msg.contextTrim.docsTotal, msg.contextTrim.mode, msg.contextTrim.chunksUsed] : 0,
        msg.isProposal ? 1 : 0,
        (msg.images || []).length,
        (msg.attachedDocs || []),
        msg.provider || '', msg.model || '',
        msg.routing ? [msg.routing.via, msg.routing.attempts] : 0,
        msg.failover?.hops ? msg.failover.hops.map(h => `${h.provider}:${h.kind}`).join(',') : 0,
    ]);
    // Se añade la longitud: dos contenidos distintos con el mismo hash de 32
    // bits tendrían que coincidir además en tamaño para pasar desapercibidos.
    return `${hashString(parts)}-${parts.length.toString(36)}`;
}

/**
 * renderMessages — pinta la conversación activa.
 * @param {{force?: boolean}} options `force` reconstruye entero (cambio de
 *        idioma, hidratación del mapa de anonimización…).
 */
function renderMessages(options = {}) {
    const chat = getActiveChat();
    if (!chat) return;

    const scroll = dom.messagesScroll;
    const messages = chat.messages;

    // Cambiar de chat siempre reconstruye: los índices ya no significan lo mismo.
    if (options.force || scroll.dataset.chatId !== chat.id) {
        scroll.dataset.chatId = chat.id;
        scroll.innerHTML = messages.map((msg, idx) => renderMessage(msg, idx)).join('');
        processCodeBlocks();
        scrollToBottom();
        return;
    }

    // Sobrantes: mensajes borrados (editar, regenerar, reintentar).
    const nodes = [...scroll.children];
    for (let i = nodes.length - 1; i >= messages.length; i--) nodes[i].remove();

    const touched = [];
    for (let i = 0; i < messages.length; i++) {
        const signature = messageSignature(messages[i], i);
        const existing = nodes[i];
        if (existing && existing.dataset.sig === signature) continue;

        const html = renderMessage(messages[i], i);
        if (existing) {
            const holder = document.createElement('div');
            holder.innerHTML = html;
            const fresh = holder.firstElementChild;
            existing.replaceWith(fresh);
            touched.push(fresh);
        } else {
            scroll.insertAdjacentHTML('beforeend', html);
            touched.push(scroll.lastElementChild);
        }
    }

    // El resaltado de sintaxis solo se aplica a lo nuevo, no a todo el hilo.
    touched.forEach(el => el && processCodeBlocks(el));
    // Sin cambios no se desplaza: así no se le arranca la vista al usuario que
    // está leyendo más arriba mientras un repintado no aporta nada.
    if (touched.length) scrollToBottom();
}

function renderMessage(msg, idx) {
    const isUser = msg.role === 'user';
    const avatarContent = isUser 
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' 
        : '<img src="favicon.png" style="width: 22px; height: 22px; border-radius: 4px; object-fit: contain;">';
    const senderName = isUser ? 'Tú' : 'wIA';

    let contentHtml = '';

    contentHtml += renderThinkingBlockHtml(msg, idx);

    if (msg.loading?.active) {
        contentHtml += renderLoadingState(msg.loading);
    }

    // Aviso de recorte de contexto: el usuario debe saber que el modelo NO ha
    // visto toda la conversación o toda la base de conocimiento, porque explica
    // respuestas que parecen olvidar lo hablado antes.
    if (!isUser && msg.contextTrim) {
        const trim = msg.contextTrim;

        // RAG no es un recorte forzoso sino una selección deliberada: se muestra
        // como información (🔎), no como advertencia.
        if (trim.mode === 'rag' && trim.chunksUsed > 0) {
            contentHtml += `<div class="context-rag-badge" title="En vez de mandar los documentos enteros, se han buscado y enviado los fragmentos más relacionados con tu pregunta. Así cabe más conversación en el contexto del modelo.">🔎 ${trim.chunksUsed} extracto${trim.chunksUsed === 1 ? '' : 's'} de ${trim.docsIncluded} documento${trim.docsIncluded === 1 ? '' : 's'}</div>`;
        }

        const parts = [];
        if (trim.droppedMessages > 0) {
            parts.push(`${trim.droppedMessages} mensaje${trim.droppedMessages === 1 ? '' : 's'} antiguo${trim.droppedMessages === 1 ? '' : 's'} fuera de contexto`);
        }
        if (trim.docsTruncated) {
            parts.push(`base de conocimiento recortada (${trim.docsIncluded}/${trim.docsTotal})`);
        }
        if (parts.length) {
            contentHtml += `<div class="context-trim-badge" title="La conversación supera la ventana de contexto de este modelo (${formatTokens(getModelContextWindow())} tokens). Se ha enviado lo más reciente. Para conservar todo el hilo, usa un modelo con más contexto o empieza un chat nuevo.">✂️ ${escapeHtml(parts.join(' · '))}</div>`;
        }
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
        // Fallback rápido: alternativas basadas en éxitos recientes + favoritos.
        const _fbCands = (typeof getFallbackCandidates === 'function')
            ? getFallbackCandidates(msg.provider, msg.model, 4) : [];
        let fallbackHtml = '';
        if (_fbCands.length) {
            const btns = _fbCands.map(c => {
                const provLabel = getCompactProviderLabel(c.provider);
                const modelLabel = getCompactModelLabel(c.model, c.provider);
                const icon = getProviderDef(c.provider)?.icon || '⚡';
                // El motor y el modelo viajan en data-*, no interpolados en una
                // cadena JS: ya no hay que escapar comillas a mano.
                return `<button class="error-fallback-btn" data-msg-action="fallback" data-idx="${idx}" data-provider="${escapeHtml(c.provider)}" data-model="${escapeHtml(c.model)}" title="Reintentar con ${escapeHtml(provLabel)} · ${escapeHtml(modelLabel)}"><span class="efb-icon">${icon}</span> ${escapeHtml(modelLabel)}<span class="efb-prov">${escapeHtml(provLabel)}</span></button>`;
            }).join('');
            fallbackHtml = `
                <div class="error-fallback">
                    <span class="error-fallback-label">${(typeof t === 'function' ? t('error.fallback') : '⚡ Continuar con otro modelo (favoritos / usados con éxito):')}</span>
                    <div class="error-fallback-btns">${btns}</div>
                </div>`;
        }
        contentHtml += `
            <div class="error-message-card">
                <div class="error-header">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <span>${(typeof t === 'function' ? t('error.title') : 'Fallo de Conexión')}</span>
                </div>
                <div class="error-body">
                    ${renderMarkdown(displayContent)}
                </div>
                ${fallbackHtml}
                <div class="error-footer" style="display: flex; justify-content: flex-end; margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 12px;">
                    <button class="btn-retry" data-msg-action="retry" data-idx="${idx}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
                        ${(typeof t === 'function' ? t('error.retry') : 'Reintentar ahora')}
                    </button>
                </div>
            </div>
        `;
    } else {
        if (isUser && typeof deanonymizeForDisplay === 'function') {
            displayContent = deanonymizeForDisplay(displayContent);
        }
        if (isUser && msg.anonCount > 0) {
            const _anonLabel = (typeof t === 'function')
                ? t(msg.anonCount === 1 ? 'anon.badge.one' : 'anon.badge.many')
                : `dato${msg.anonCount === 1 ? '' : 's'} sensible${msg.anonCount === 1 ? '' : 's'} protegido${msg.anonCount === 1 ? '' : 's'}`;
            const _anonTitle = (typeof t === 'function') ? t('anon.badge.title') : '';
            const _anonItems = (typeof listAnonItems === 'function') ? listAnonItems(msg.content, getActiveChat()) : [];
            if (_anonItems.length) {
                // Desplegable nativo: abre/cierra con clic o teclado sin JS propio.
                const rows = _anonItems.map(it => `<li><code class="anon-ph">${escapeHtml(it.placeholder)}</code><span class="anon-arrow" aria-hidden="true">→</span><span class="anon-val">${escapeHtml(it.value)}</span></li>`).join('');
                contentHtml += `
                    <details class="anon-details">
                        <summary class="anon-badge" title="${escapeHtml(_anonTitle)}">
                            <span>🕶️ ${msg.anonCount} ${escapeHtml(_anonLabel)}</span>
                            <svg class="anon-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                        </summary>
                        <ul class="anon-list">${rows}</ul>
                    </details>`;
            } else {
                contentHtml += `<div class="anon-badge" title="${escapeHtml(_anonTitle)}">🕶️ ${msg.anonCount} ${escapeHtml(_anonLabel)}</div>`;
            }
        }
        contentHtml += isUser ? `<p style="white-space: pre-wrap;">${escapeHtml(displayContent)}</p>` : renderMarkdown(displayContent);
    }

    let metricsHtml = '';
    if (!isUser && msg.metrics && Object.keys(msg.metrics).length > 0) {
        let tps = msg.metrics.tps || 'N/A';
        if (msg.metrics.eval_count && msg.metrics.eval_duration) {
            tps = (msg.metrics.eval_count / (msg.metrics.eval_duration / 1e9)).toFixed(2);
        }
        metricsHtml = `<span class="metrics-btn" data-msg-action="metrics" data-idx="${idx}" role="button" tabindex="0" title="Geek Info">⏱️ ${tps} T/s</span>`;
    }

    // Qué motor contestó de verdad: la pasarela (X-Routed-Via) y/o el failover.
    let routingHtml = '';
    if (!isUser && msg.routing?.via) {
        const detail = msg.routing.attempts > 0
            ? trf('chat.routing.fellOver', 'La pasarela saltó {n} vez/veces antes de contestar: {trail}', { n: msg.routing.attempts, trail: msg.routing.trail || '' })
            : tr('chat.routing.via', 'Proveedor que ha servido esta respuesta a través de la pasarela');
        routingHtml += `<span class="routing-chip" title="${escapeHtml(detail)}">↪ ${escapeHtml(msg.routing.via)}</span>`;
    }
    if (!isUser && msg.failover?.hops?.length) {
        const skipped = msg.failover.hops.map(h => h.kind === 'cooldown'
            ? `${h.provider} (${tr('chat.failover.paused', 'en pausa')})`
            : `${h.provider}${h.status ? ` (${h.status})` : ` (${h.kind})`}`).join(' → ');
        routingHtml += `<span class="routing-chip failover" title="${escapeHtml(tr('chat.failover.badgeTitle', 'Failover automático: se saltaron estos motores antes de contestar'))}: ${escapeHtml(skipped)}">🔁 ${escapeHtml(trf('chat.failover.badge', 'Failover desde {name}', { name: msg.failover.hops[0].provider }))}</span>`;
    }

    // Message action buttons
    const isBookmarked = msg.bookmarked ? 'bookmarked' : '';
    let actionsHtml = '';
    if (isUser) {
        actionsHtml = `
            <div class="message-actions">
                <button class="msg-action-btn msg-save-prompt-btn" data-msg-action="save-prompt" data-idx="${idx}" title="Guardar como prompt">➕</button>
                <button class="msg-action-btn" data-msg-action="edit" data-idx="${idx}" title="Editar mensaje">✏️ Editar</button>
                <button class="msg-action-btn ${isBookmarked}" data-msg-action="bookmark" data-idx="${idx}" title="Marcar">⭐</button>
            </div>`;
    } else if (!isError) {
        actionsHtml = `
            <div class="message-actions">
                <button class="msg-action-btn" data-msg-action="copy" data-idx="${idx}" title="Copiar respuesta">📋 Copiar</button>
                <button class="msg-action-btn" data-msg-action="regenerate" data-idx="${idx}" title="Regenerar">🔄 Regenerar</button>
                <button class="msg-action-btn ${isBookmarked}" data-msg-action="bookmark" data-idx="${idx}" title="Marcar">⭐</button>
            </div>`;
    }

    return `
        <div class="message ${msg.role} ${isError ? 'message-error' : ''}" id="msg-${idx}" data-sig="${messageSignature(msg, idx)}">
            <div class="message-inner">
                <div class="message-avatar">${avatarContent}</div>
                <div class="message-body">
                    <div class="message-sender">${routingHtml}${metricsHtml}</div>
                    <div class="message-content">
                        ${contentHtml}
                        ${msg.isProposal ? `
                        <div class="proposal-actions">
                            <button class="btn-primary apply-proposal-btn" data-msg-action="apply-proposal" data-idx="${idx}" title="Usar este prompt mejorado">
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

    // Enrutado: motor real y saltos (pasarela y/o failover de wIA)
    if (msg.routing?.via || msg.failover?.hops?.length) {
        html += `<div style="font-size: 0.7rem; text-transform: uppercase; color: var(--accent-secondary); font-weight: 800; letter-spacing: 1px; margin-bottom: 6px;">${escapeHtml(tr('chat.routing.title', 'Enrutado'))}</div>`;
        const row = (k, v) => `<li style="display: flex; justify-content: space-between; gap: 12px; font-size: 0.8rem; margin-bottom: 2px;">
                <span style="color: var(--text-tertiary);">${escapeHtml(k)}:</span>
                <span style="color: var(--text-primary); font-family: monospace; text-align: right; word-break: break-all;">${escapeHtml(String(v))}</span>
            </li>`;
        if (msg.routing?.via) html += row('x-routed-via', msg.routing.via);
        if (msg.routing?.attempts) html += row('x-fallback-attempts', msg.routing.attempts);
        if (msg.routing?.trail) html += row('x-fallback-trail', msg.routing.trail);
        (msg.failover?.hops || []).forEach((h, n) => {
            html += row(`${tr('chat.failover.hop', 'salto')} ${n + 1}`, `${h.provider}${h.model ? ' · ' + h.model : ''} → ${h.kind}${h.status ? ' ' + h.status : ''}`);
        });
        html += `<div style="margin-bottom: 12px;"></div>`;
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

// ─── Enrutado de la pasarela y failover automático ────
/**
 * captureGatewayRouting — una pasarela (FreeLLMAPI) contesta qué proveedor ha
 * servido la petición en «X-Routed-Via» y, si tuvo que saltar, en
 * «X-Fallback-Attempts/Trail». Sin esto el mensaje solo decía «auto».
 *
 * Las cabeceras personalizadas solo son legibles si la petición pasa por el
 * proxy local (mismo origen) o la pasarela las expone por CORS; si no, no hay
 * nada que leer y el mensaje queda como estaba. Es texto de un tercero: se
 * acota y se escapa al pintarlo.
 */
function captureGatewayRouting(response, assistantMsg) {
    const get = (name) => {
        try { return String(response.headers?.get?.(name) || '').trim().slice(0, 240); } catch (_) { return ''; }
    };
    const via = get('x-routed-via');
    if (!via) return;
    const attempts = parseInt(get('x-fallback-attempts'), 10);
    assistantMsg.routing = { via, attempts: Number.isFinite(attempts) ? attempts : 0, trail: get('x-fallback-trail') };
}

// Un envío contra un solo motor. Va aparte para poder repetirlo con otro.
async function sendToEngine(chat, assistantMsg, msgIdx, autoSendBody) {
    const provType = getProviderDef(state.settings.provider).type;
    const headers = getAuthHeaders();
    // Solo usar autoSendBody si es un array de mensajes (para el optimizador de prompts u otros)
    // Si es un simple flag 'RETRY_LAST', reconstruir desde el historial.
    const messages = (autoSendBody && Array.isArray(autoSendBody)) ? autoSendBody : buildApiMessages(chat);
    const startTime = Date.now();
    let pendingToolCall = null;

    // ── Petición según el protocolo del motor ──
    if (provType === 'ollama') pendingToolCall = await streamOllama(chat, assistantMsg, msgIdx, headers, messages);
    else if (provType === 'openai') pendingToolCall = await streamOpenAI(chat, assistantMsg, msgIdx, headers, messages, autoSendBody, startTime);
    else if (provType === 'gemini') await streamGemini(chat, assistantMsg, msgIdx, headers, startTime);
    else if (provType === 'anthropic') await streamAnthropic(chat, assistantMsg, msgIdx, headers, messages, startTime);
    return pendingToolCall;
}

/**
 * sendWithFailover — envía con el motor elegido y, si el usuario lo ha
 * activado, prueba con otros del mismo tipo (local/cloud) cuando este falla por
 * cupo, caída o credenciales ANTES de emitir texto. Ver getFailoverCandidates
 * en 04-providers.js para lo que nunca hace.
 *
 * Deja en el mensaje `failover` (qué motores se saltaron y por qué) y cambia
 * `provider`/`model` al que contestó de verdad.
 */
async function sendWithFailover(chat, assistantMsg, msgIdx, autoSendBody) {
    const primary = { provider: state.settings.provider, model: state.settings.model };
    // Un cuerpo ya construido (continuación de una herramienta, optimizador) está
    // formateado para el protocolo de este motor: no se traslada a otro.
    const enabled = state.settings.autoFailover === true && !Array.isArray(autoSendBody);
    const tried = [primary.provider];
    const hops = [];
    let target = null;

    // Si el motor elegido está en pausa por un fallo reciente, se ahorra el golpe.
    if (enabled && getEngineCooldown(primary.provider, primary.model) > 0) {
        const alt = getFailoverCandidates(primary.provider, { exclude: tried })[0];
        if (alt) {
            hops.push({ provider: primary.provider, model: primary.model, kind: 'cooldown', status: 0 });
            tried.push(alt.provider);
            target = alt;
        }
    }

    for (;;) {
        const current = target || primary;
        if (target) {
            assistantMsg.provider = target.provider;
            assistantMsg.model = target.model;
            setMessageLoadingState(assistantMsg, {
                phase: 'initializing',
                detail: trf('chat.failover.trying', 'Probando con {name}…', { name: getProviderDef(target.provider).name }),
            });
            updateStreamingMessage(msgIdx, assistantMsg);
        }
        try {
            const result = target
                ? await withEngineOverride(target.provider, target.model, () => sendToEngine(chat, assistantMsg, msgIdx, autoSendBody))
                : await sendToEngine(chat, assistantMsg, msgIdx, autoSendBody);
            markEngineSuccess(current.provider, current.model);
            clearMessageLoadingState(assistantMsg);
            if (hops.length) assistantMsg.failover = { hops };
            return result;
        } catch (e) {
            if (e?.name === 'AbortError' || state.abortController?.signal?.aborted) throw e;
            const failure = classifyEngineFailure(e);
            markEngineFailure(current.provider, current.model, failure);
            hops.push({ provider: current.provider, model: current.model, kind: failure.kind, status: failure.status });
            // Con texto ya recibido no se reintenta: se mezclarían dos respuestas.
            const started = !!(assistantMsg.content || assistantMsg.thinking);
            const next = (enabled && failure.retryable && !started && hops.length <= FAILOVER_MAX_HOPS)
                ? getFailoverCandidates(primary.provider, { exclude: tried })[0]
                : null;
            if (!next) {
                clearMessageLoadingState(assistantMsg);
                if (hops.length > 1 || target) assistantMsg.failover = { hops };
                e.failoverHops = hops.length > 1 ? hops : [];
                throw e;
            }
            tried.push(next.provider);
            target = next;
        }
    }
}

// ─── Fallback rápido: registrar éxitos y ofrecer alternativas ────
// Registra un motor+modelo que ha respondido con éxito (recientes primero,
// deduplicado, máx. 10). Alimenta el fallback rápido de la tarjeta de error.
function recordModelSuccess(provider, model) {
    if (!provider || !model) return;
    const hist = Array.isArray(state.settings.modelSuccessHistory) ? state.settings.modelSuccessHistory : [];
    const filtered = hist.filter(e => !(e.provider === provider && e.model === model));
    state.settings.modelSuccessHistory = [{ provider, model }, ...filtered].slice(0, 10);
}

// Llamar al terminar una generación: si fue bien, la anota como éxito.
function noteGenerationOutcome(msg) {
    if (!msg || msg.role !== 'assistant') return;
    const c = msg.content || '';
    const ok = c.trim() && !c.includes('⚠️') && !c.includes('[Generación detenida]') && !c.includes('[Operación detenida');
    if (ok) recordModelSuccess(msg.provider || state.settings.provider, msg.model || state.settings.model);
    // Un modelo WebGPU que ha generado una respuesta queda «probado aquí».
    const provider = msg.provider || state.settings.provider;
    if (ok && typeof recordWebGPUModelReport === 'function' && getProviderDef(provider).type === 'webgpu') {
        recordWebGPUModelReport(msg.model || state.settings.model, 'ok');
    }
}

// Construye alternativas para reintentar: éxitos recientes + favoritos, y
// siempre WebGPU local (gratis, sin créditos) como red de seguridad. Excluye el
// que acaba de fallar y los motores cloud sin API key configurada.
function getFallbackCandidates(excludeProvider, excludeModel, limit = 4) {
    const seen = new Set();
    const out = [];
    const usable = (provider) => {
        const def = getProviderDef(provider);
        if (!def) return false;
        if (def.auth === 'apikey') {
            const pc = state.settings.providerConfigs?.[provider];
            return !!(pc && pc.apiKey); // sin clave no sirve como fallback inmediato
        }
        return true; // webgpu / ollama / lmstudio no requieren clave
    };
    const add = (provider, model) => {
        if (!provider || !model) return;
        if (provider === excludeProvider && model === excludeModel) return;
        const key = `${provider}:${model}`;
        if (seen.has(key)) return;
        if (!usable(provider)) return;
        seen.add(key);
        out.push({ provider, model });
    };
    (state.settings.modelSuccessHistory || []).forEach(e => add(e.provider, e.model));
    (state.settings.favoriteModels || []).forEach(fav => {
        const i = fav.indexOf(':');
        if (i > 0) add(fav.slice(0, i), fav.slice(i + 1));
    });
    // Red de seguridad: WebGPU local siempre disponible (salvo que sea el que falló).
    add('webgpu', 'onnx-community/Qwen2.5-0.5B-Instruct');
    return out.slice(0, limit);
}

// Cambia a otro motor+modelo y reintenta el mensaje fallido.
window.fallbackToModel = async (idx, provider, model) => {
    const chat = getActiveChat();
    if (!chat || state.isStreaming) return;
    if (!(chat.messages[idx] && chat.messages[idx].role === 'assistant')) return;
    state.settings.provider = provider;
    syncProviderToState();
    state.settings.model = model;
    saveCurrentProviderConfig();
    saveState();
    if (typeof applySettingsToUI === 'function') applySettingsToUI();
    // Hay que ESPERAR a la comprobación: su lógica de «el modelo no está en el
    // catálogo → usa el primero» puede reescribir state.settings.model. Lanzada
    // sin await, esa reescritura caía en mitad del reintento y se acababa
    // generando con un modelo distinto del que eligió el usuario.
    if (typeof checkProviderStatus === 'function') {
        try { await checkProviderStatus(); } catch (e) { /* el reintento decidirá */ }
        // La comprobación puede haber caído a otro modelo; restauramos el elegido.
        if (state.settings.model !== model) {
            state.settings.model = model;
            getActiveProviderConfig().model = model;
        }
    }
    chat.messages.splice(idx, 1);
    saveState();
    renderMessages();
    sendMessage(null, 'RETRY_LAST');
};

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
    // 🕶️ Restaura los valores reales solo para la visualización local.
    if (typeof deanonymizeForDisplay === 'function') text = deanonymizeForDisplay(text);
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
                <button class="loading-card-copy-btn" type="button" data-msg-action="copy-url" data-url="${escapeHtml(loading.sourceUrl)}" title="Copiar URL de carga">📋</button>
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
                <button class="loading-card-copy-btn" type="button" data-msg-action="copy-url" data-url="${escapeHtml(loading.sourceUrl)}" title="Copiar URL de carga">📋</button>
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

async function getWebGPURawImages(imageMetaList, forceInline = false) {
    // En modo worker las imágenes viajan como data-URLs y es el worker quien
    // las convierte a RawImage dentro de su contexto.
    if (!forceInline && webgpuState.executionMode === 'worker' && !webgpuWorker.broken) {
        return imageMetaList.map(img =>
            `data:${img.mimeType || inferMimeTypeFromBase64(img.data)};base64,${img.data}`);
    }
    const hf = webgpuState.hfModule || await importTransformers();
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
    // La cadena de análisis de imagen se puede desactivar con su conmutador.
    return providerId === 'webgpu' && state.settings.visionChainEnabled !== false;
}

function formatWebGPUImageAssistContext(imageCaptions = []) {
    if (!Array.isArray(imageCaptions) || imageCaptions.length === 0) return '';
    const medical = getVisionAssistDef()?.capabilities?.includes('medical');
    const lines = imageCaptions.map((item, idx) => {
        const prefix = `[Imagen ${idx + 1}${item.name ? ` · ${item.name}` : ''}]`;
        return `${prefix} ${item.caption}`.trim();
    });
    const title = medical
        ? 'Análisis visual médico local (orientativo; no es un diagnóstico)'
        : 'Análisis visual local';
    return `\n\n--- ${title} ---\n${lines.join('\n')}\n--- Fin del análisis visual ---\n`;
}

const MEDICAL_ZERO_SHOT_LABELS = [
    'a chest X-ray',
    'a bone or joint X-ray',
    'a dental X-ray',
    'a CT scan',
    'an MRI scan',
    'an ultrasound image',
    'a retinal fundus photograph',
    'a dermatology clinical photograph',
    'a histopathology microscopy image',
    'an endoscopy image',
    'an electrocardiogram trace',
    'a medical document or report',
    'a non-medical photograph'
];

function formatMedicalZeroShot(output = []) {
    const rows = (Array.isArray(output) ? output : [])
        .filter(item => item?.label && Number.isFinite(Number(item.score)))
        .slice(0, 5)
        .map(item => `${item.label}: ${(Number(item.score) * 100).toFixed(1)}%`);
    if (rows.length === 0) return 'SigLIP no produjo coincidencias interpretables.';
    return `Clasificación zero-shot orientativa de modalidad/contenido: ${rows.join(' · ')}. Modelo generalista; no usar estas puntuaciones para diagnosticar.`;
}

function formatMedicalEmbedding(output) {
    const tensor = output?.pooler_output || output?.last_hidden_state || output;
    const dims = Array.isArray(tensor?.dims) ? tensor.dims.join(' × ') : 'desconocidas';
    const values = tensor?.data;
    let norm = null;
    if (values?.length) {
        let sum = 0;
        for (let i = 0; i < values.length; i++) sum += Number(values[i]) ** 2;
        norm = Math.sqrt(sum);
    }
    return `Firma radiológica DINOv2 extraída correctamente (dimensiones ${dims}${Number.isFinite(norm) ? `; norma ${norm.toFixed(3)}` : ''}). Sirve para similitud/RAG con radiografías de referencia; por sí sola no clasifica patologías ni emite diagnósticos.`;
}

async function analyzeImagesForWebGPUInline(imageMetaList = [], onProgress, userPrompt = '') {
    const normalized = normalizeImageMeta(imageMetaList);
    if (normalized.length === 0) return [];

    const assist = getVisionAssistDef();
    const engine = assist.engine || 'caption';
    // getWebGPURawImages puede devolver data-URLs en modo worker; aquí forzamos
    // RawImage reales porque los motores de visión corren inline.
    const dataUrls = normalized.map(img => `data:${img.mimeType || inferMimeTypeFromBase64(img.data)};base64,${img.data}`);
    const hf = webgpuState.hfModule || await importTransformers();
    webgpuState.hfModule = hf;
    const rawImages = await Promise.all(dataUrls.map(u => hf.RawImage.fromURL(u)));

    const results = [];
    const emitProgress = (i) => onProgress && onProgress(Math.round((i / rawImages.length) * 100), {
        status: 'progress', file: normalized[i]?.name || `imagen_${i + 1}`
    });

    if (engine === 'florence2') {
        const bundle = await loadFlorence2VisionModel(onProgress);
        for (let i = 0; i < rawImages.length; i++) {
            emitProgress(i);
            const caption = await runFlorence2Analysis(bundle, rawImages[i]);
            results.push({ name: normalized[i].name, caption: caption || 'No se pudo analizar la imagen.' });
        }
    } else if (engine === 'vlm') {
        const bundle = await loadVLMVisionModel(onProgress);
        for (let i = 0; i < rawImages.length; i++) {
            emitProgress(i);
            const caption = await runVLMAnalysis(bundle, rawImages[i], userPrompt);
            results.push({ name: normalized[i].name, caption: caption || 'No se pudo analizar la imagen.' });
        }
    } else if (engine === 'medical-zero-shot') {
        const pipe = await loadWebGPUImageAssistPipeline(onProgress);
        for (let i = 0; i < rawImages.length; i++) {
            emitProgress(i);
            const output = await pipe(rawImages[i], MEDICAL_ZERO_SHOT_LABELS, {
                hypothesis_template: 'This medical image is {}.'
            });
            results.push({ name: normalized[i].name, caption: formatMedicalZeroShot(output) });
        }
    } else if (engine === 'medical-embedding') {
        const bundle = await loadDinoMedicalVisionModel(onProgress);
        for (let i = 0; i < rawImages.length; i++) {
            emitProgress(i);
            const output = await runDinoMedicalEmbedding(bundle, rawImages[i]);
            results.push({ name: normalized[i].name, caption: formatMedicalEmbedding(output) });
        }
    } else if (engine === 'wound-classify') {
        const bundle = await loadWoundClassifier(onProgress);
        for (let i = 0; i < rawImages.length; i++) {
            emitProgress(i);
            const output = await runWoundClassify(bundle, rawImages[i]);
            results.push({ name: normalized[i].name, caption: formatWoundResult(output) });
        }
    } else {
        const pipe = await loadWebGPUImageAssistPipeline(onProgress);
        for (let i = 0; i < rawImages.length; i++) {
            emitProgress(i);
            const output = await pipe(rawImages[i]);
            const caption = extractGeneratedText(output).trim();
            results.push({ name: normalized[i].name, caption: caption || 'No se pudo extraer una descripcion util de la imagen.' });
        }
    }

    if (onProgress) onProgress(100, { status: 'ready', file: `${normalized.length} imagen(es)` });
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
        temperature: parseFloat(state.settings.temperature ?? 0.8),
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
                applyWebGPUStreamedText(assistantMsg, fullResponse);
                updateStreamingMessage(msgIdx, assistantMsg);
                updateGenerationStatus(tokenCount, startTime);
                maybeStopRepetitionLoop(assistantMsg, fullResponse);
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
        // Referencia para el detector de bucles de repetición
        webgpuState.activeStopper = stopper;
    }

    let result;
    try {
        result = await pipe(promptInput, generationOptions);
    } finally {
        webgpuState.activeStopper = null;
    }
    const finalText = extractGeneratedText(result);
    if (finalText) fullResponse = finalText;

    const elapsed = Date.now() - startTime;
    const parts = splitWebGPUThinking(fullResponse);
    let text = parts.content || (parts.thinking ? '*(El modelo solo generó razonamiento)*' : '*(Sin respuesta generada)*');
    if (assistantMsg._loopStopped) text += WEBGPU_LOOP_STOP_NOTE;
    return {
        text,
        thinking: parts.thinking,
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
    return !!modelDef?.omnimodal;
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

    // Los modelos de navegador son los que menos contexto tienen (8K en varios
    // del catálogo), así que aquí el recorte es especialmente necesario: sin él
    // el modelo empieza a divagar sin que nada lo explique. Se recolecta primero
    // y se recorta al final, para no romper el emparejamiento con las imágenes.
    const budget = getPromptTokenBudget() - estimateTokenCount(systemContent);
    const entries = [];

    for (const msg of chat.messages) {
        if (msg.role === 'assistant' && !msg.content) continue;
        if (msg.role === 'tool') continue;

        if (useVision && msg.role === 'user') {
            const normalizedImages = normalizeImageMeta(msg.imageMeta, msg.images || []);
            if (normalizedImages.length > 0) {
                const content = normalizedImages.map(() => ({ type: 'image' }));
                const text = (msg.content || '').trim();
                content.push({
                    type: 'text',
                    text: text || 'Describe la imagen y responde a la petición del usuario.'
                });

                entries.push({
                    value: { role: msg.role, content },
                    // Las imágenes se guardan JUNTO al turno, no en una lista
                    // aparte: si el recorte descarta este mensaje, sus imágenes
                    // se van con él y no queda un `{type:'image'}` huérfano
                    // apuntando a un tensor que ya no se envía.
                    images: normalizedImages,
                    tokens: estimateTokenCount(text) + normalizedImages.length * 300
                });
                continue;
            }
        }

        if (!useVision && msg.role === 'user' && Array.isArray(msg.imageCaptions) && msg.imageCaptions.length > 0) {
            const withCaptions = `${msg.content || ''}${formatWebGPUImageAssistContext(msg.imageCaptions)}`;
            entries.push({
                value: { role: msg.role, content: withCaptions },
                tokens: estimateTokenCount(withCaptions)
            });
            continue;
        }

        entries.push({
            value: { role: msg.role, content: msg.content || '' },
            tokens: estimateTokenCount(msg.content)
        });
    }

    const { kept, dropped } = applyHistoryBudget(entries, budget);
    kept.forEach(entry => {
        conversationHistory.push(entry.value);
        (entry.images || []).forEach(img => imageMetaList.push(img));
    });
    noteContextTrim(chat, { droppedMessages: dropped, docsIncluded: 0, docsTotal: 0, docsTruncated: false });

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
    let originalText = dom.messageInput.value.trim();
    if (!originalText || state.isStreaming) return;

    // Red de seguridad: esta función solo habla HTTP con el proveedor y no tiene
    // rama WebGPU. El botón ya se oculta con ese motor; si aun así llegara aquí,
    // más vale un aviso claro que un «Respuesta vacía del modelo».
    if (getProviderDef(state.settings.provider).type === 'webgpu') {
        notify(trf('dlg.improve.noWebgpu', '«Mejorar prompt» todavía no está disponible con el motor WebGPU local. Cambia a otro motor para usarlo.'), 'info');
        return;
    }

    dom.improvePromptBtn.classList.add('active-optimization');
    dom.improvePromptBtn.disabled = true;

    // Immediate feedback: Ensure there's a chat and show loading
    let chat = getActiveChat();
    if (!chat) chat = createChat();

    // 🕶️ El texto a mejorar sale hacia el proveedor igual que un mensaje: con
    // la anonimización activa se envía con marcadores y la propuesta se
    // muestra ya restaurada (el render deshace los marcadores del chat).
    if (state.settings.anonymizeOutgoing && typeof anonymizeOutgoingText === 'function') {
        const anonRes = await anonymizeOutgoingText(originalText, chat);
        if (anonRes.ok === false) {
            dom.improvePromptBtn.classList.remove('active-optimization');
            dom.improvePromptBtn.disabled = false;
            alert(tr('anon.unavailable', 'La anonimización está activa pero no se ha podido preparar (no se cargaron las reglas). El mensaje NO se ha enviado. Reinténtalo o desactiva 🕶️ para enviarlo sin anonimizar.'));
            return;
        }
        originalText = anonRes.text;
    }

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
        // Es una llamada no-streaming y corta: si el motor no contesta, el botón
        // no puede quedarse deshabilitado para siempre.
        const improveSignal = AbortSignal.timeout(30000);
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
            const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: improveSignal });
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
            const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: improveSignal });
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            const data = await response.json();
            optimizedText = data.choices?.[0]?.message?.content?.trim();
            
        } else if (provType === 'gemini') {
            url = `${state.settings.ollamaUrl}/models/${state.settings.model}:generateContent`;
            payload = {
                system_instruction: { parts: [{ text: systemInstruction }] },
                contents: [{ role: 'user', parts: [{ text: originalText }] }],
                generationConfig: { temperature: 0.4, maxOutputTokens: 500 }
            };
            const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: improveSignal });
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
            const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: improveSignal });
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
    
    // Con 🕶️ la propuesta se guardó con marcadores: a la caja vuelve con los
    // datos reales, y al enviarla se anonimiza otra vez con el mismo mapa.
    const raw = chat.messages[idx].content;
    const text = typeof restoreAnonText === 'function' ? restoreAnonText(raw, chat) : raw;
    dom.messageInput.value = text;
    dom.messageInput.focus();
    autoResizeTextarea();
    updateSendButton();
    
    // Smooth scroll to input
    dom.messageInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

// ─── Streaming Chat ─────────────────────────
// ─── Un turno por protocolo ──────────────────
// sendMessage prepara el turno (anonimización, adjuntos, RAG) y reparte el
// trabajo: cada protocolo vive en su función, con su propio estado de streaming.
// Las de Ollama y OpenAI devuelven la llamada a herramienta pendiente, si la hay.

/** runWebGPUTurn — turno completo con un modelo local en el navegador (carga, visión, generación). */
async function runWebGPUTurn(chat, assistantMsg, msgIdx) {
    // Salvaguarda móvil: antes de cargar un modelo grande que podría agotar
    // la memoria del teléfono, ofrece cambiar a un ligero. Una vez por sesión.
    if (typeof isMobileDevice === 'function' && isMobileDevice()
        && typeof isHeavyForMobile === 'function' && isHeavyForMobile(state.settings.model)
        && !state._mobileHeavyAck) {
        const heavyDef = WEBGPU_MODELS.find(m => m.id === state.settings.model);
        const lightDef = WEBGPU_MODELS.find(m => m.id === MOBILE_SAFE_WEBGPU_MODEL);
        const _tr = (k, fb) => (typeof t === 'function' ? t(k, fb) : fb);
        const useLight = confirm(
            _tr('mobile.heavy.warn', '⚠️ En el móvil, «{model}» ({size}) puede agotar la memoria y cerrar la pestaña.')
                .replace('{model}', heavyDef?.label || state.settings.model)
                .replace('{size}', heavyDef?.size || 'grande') + '\n\n' +
            _tr('mobile.heavy.ask', '¿Usar en su lugar un modelo ligero recomendado ({light})?')
                .replace('{light}', lightDef?.label || 'Qwen 2.5 0.5B') + '\n\n' +
            _tr('mobile.heavy.hint', 'Aceptar = usar el ligero · Cancelar = continuar con el grande.')
        );
        if (useLight) {
            state.settings.model = MOBILE_SAFE_WEBGPU_MODEL;
            getActiveProviderConfig().model = MOBILE_SAFE_WEBGPU_MODEL;
            assistantMsg.model = MOBILE_SAFE_WEBGPU_MODEL;
            saveState();
            if (typeof applySettingsToUI === 'function') applySettingsToUI();
        } else {
            state._mobileHeavyAck = true; // no volver a preguntar esta sesión
        }
    }
    // Fuera del try: el catch de más abajo también lo necesita (para anotar el fallo del modelo).
    const modelId = state.settings.model;
    try {
        const support = await checkWebGPUSupport();
        const modelDef = WEBGPU_MODELS.find(m => m.id === modelId);
        const modelLabel = modelDef?.label || modelId;
        const deviceLabel = support === 'webgpu' ? 'WebGPU' : 'WASM / CPU';
        const useVisionTask = !!modelDef?.omnimodal;
        const pipelineTask = useVisionTask ? 'omnimodal' : 'text-generation';
        dom.statusDot.className = 'status-dot loading';
        dom.statusText.textContent = (typeof t==='function'?t('status.initializing'):'Inicializando...');
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
        dom.statusText.textContent = (typeof t==='function'?t('status.localInference'):'🧠 Inferencia local');
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

        // Build conversation context.
        // Se usa el mismo constructor que el resto de motores: además de
        // presupuestar el tamaño, incorpora la BASE DE CONOCIMIENTO del
        // proyecto, que en la rama WebGPU no se estaba enviando nunca (los
        // documentos adjuntos a un agente se ignoraban en silencio al usar
        // un modelo local).
        const systemContent = buildSystemContext(chat, getPromptTokenBudget()).text;

        if (!useVisionTask && supportsWebGPUImageAssist() && imageAssistMessages.length > 0) {
            setMessageLoadingState(assistantMsg, {
                phase: 'initializing',
                detail: `Analizando ${imageAssistMessages.reduce((sum, msg) => sum + normalizeImageMeta(msg.imageMeta, msg.images || []).length, 0)} imagen(es) con ${getVisionAssistDef().label}.`,
                modelLabel,
                deviceLabel,
                sourceUrl: buildWebGPURepoUrl(getVisionAssistDef().id),
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
                        sourceUrl: progress.sourceUrl || buildWebGPURepoUrl(getVisionAssistDef().id),
                        progress: pct,
                        progressLabel: 'Vision',
                        file: progress.file || '',
                        note: `Modelo auxiliar: ${getVisionAssistDef().id}`
                    });
                    updateStreamingMessage(msgIdx, assistantMsg);
                }, msg.content || '');
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
                    rawImages = await getWebGPURawImages(imageMetaList, true);
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
                            sourceUrl: progress.sourceUrl || buildWebGPURepoUrl(getVisionAssistDef().id),
                            progress: pct,
                            progressLabel: 'Fallback',
                            file: progress.file || '',
                            note: `Modelo auxiliar: ${getVisionAssistDef().id}`
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

                // Guarda: loadWebGPUModel devuelve null si hay otra carga en
                // curso (guarda isLoading). Sin esto, runWebGPUGeneration(null)
                // reventaría al leer .__omnimodal/.__worker sobre null.
                if (!fallbackPipe) throw new Error('No se pudo inicializar el modelo de reserva WebGPU (otra carga en curso).');

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
        if (generationOutcome?.thinking) {
            assistantMsg.thinking = generationOutcome.thinking;
        }
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
            // Queda anotado junto al modelo: la próxima vez la tarjeta dice
            // que aquí falló y por qué (un corte de red no cuenta como fallo
            // del modelo).
            if (typeof recordWebGPUModelReport === 'function' && !/network|fetch|failed to load/i.test(errorDetail)) {
                recordWebGPUModelReport(modelId, 'fail', errorDetail);
            }
            
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
        noteGenerationOutcome(assistantMsg);
        announce(tr('sr.done', 'Respuesta completada.'));
        chat.updatedAt = Date.now();
        saveState();
        renderChatList();
        renderMessages();
    }
}

async function streamOllama(chat, assistantMsg, msgIdx, headers, messages) {
    const reader_decoder = { reader: null, decoder: new TextDecoder() };
    let buffer = '';
    let isInThinking = false;
    let thinkingText = '';
    let responseText = '';
    let pendingToolCall = null;

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
        
        if (dom.toolInternet.classList.contains('active') && state.capabilities.includes('tools') && (state._toolRounds || 0) < MAX_TOOL_ROUNDS) {
            reqBody.tools = [buildWikipediaTool()];
        }
        
        const response = await fetch(`${state.settings.ollamaUrl}/api/chat`, {
            method: 'POST', headers, body: JSON.stringify(reqBody),
            signal: state.abortController.signal,
        });
        if (!response.ok) throw await providerHttpError(response);
        
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
        

    return pendingToolCall;
}

async function streamOpenAI(chat, assistantMsg, msgIdx, headers, messages, autoSendBody, startTime) {
    const reader_decoder = { reader: null, decoder: new TextDecoder() };
    let buffer = '';
    let isInThinking = false;
    let thinkingText = '';
    let responseText = '';
    let pendingToolCall = null;
    let partialToolCallArgs = '';

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
        
        // El dialecto de OpenAI exige que la llamada a herramienta lleve `id`,
        // `type` y los argumentos como TEXTO JSON, y que su respuesta cite ese
        // id. Sin esto la segunda vuelta (tras buscar en Internet) se rechaza
        // con un 400 en OpenAI, Groq, OpenRouter…
        messages = messages.map(m => {
            if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
                return { ...m, tool_calls: m.tool_calls.map((tc, i) => ({
                    id: tc.id || `call_${i}`,
                    type: 'function',
                    function: {
                        name: tc.function?.name,
                        arguments: typeof tc.function?.arguments === 'string'
                            ? tc.function.arguments
                            : JSON.stringify(tc.function?.arguments || {}),
                    },
                })) };
            }
            if (m.role === 'tool') return { ...m, tool_call_id: m.tool_call_id || 'call_0' };
            return m;
        });

        let maxTok = parseInt(state.settings.maxTokens || 4096);
        // Cap max_tokens for Groq (hard limit usually 8192 for output tokens)
        if (getProviderBaseId(state.settings.provider) === 'groq' && maxTok > 8192) {
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
        if (getProviderBaseId(state.settings.provider) === 'openai') {
            reqBody.stream_options = { include_usage: true };
        }
        
        if (dom.toolInternet.classList.contains('active') && state.capabilities.includes('tools') && (state._toolRounds || 0) < MAX_TOOL_ROUNDS) {
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
            const httpError = new Error(`${response.status}: ${errorDetail}`);
            httpError.status = response.status;
            httpError.retryAfterMs = parseRetryAfter(response.headers?.get?.('retry-after'));
            throw httpError;
        }
        captureGatewayRouting(response, assistantMsg);
        
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
                            pendingToolCall = [{ id: toolCallsData[0].id, function: { name: toolCallsData[0].function.name, arguments: "" } }];
                        }
                        if (toolCallsData[0].function?.arguments) {
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
        

    return pendingToolCall;
}

async function streamGemini(chat, assistantMsg, msgIdx, headers, startTime) {
    const reader_decoder = { reader: null, decoder: new TextDecoder() };
    let buffer = '';
    let thinkingText = '';
    let responseText = '';

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
            `${state.settings.ollamaUrl}/models/${state.settings.model}:streamGenerateContent?alt=sse`,
            { method: 'POST', headers, body: JSON.stringify(reqBody), signal: state.abortController.signal }
        );
        if (!response.ok) throw await providerHttpError(response);
        
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
        
}

async function streamAnthropic(chat, assistantMsg, msgIdx, headers, messages, startTime) {
    const reader_decoder = { reader: null, decoder: new TextDecoder() };
    let buffer = '';
    let thinkingText = '';
    let responseText = '';

        // Anthropic Messages API streaming
        const anthropicData = buildAnthropicMessages(chat);
        
        // Sin top_k: Anthropic lo reserva para casos avanzados y desaconseja
        // combinarlo con top_p; además los modelos con razonamiento extendido
        // rechazan la petición si llegan los tres muestreadores a la vez.
        let reqBody = {
            model: state.settings.model,
            messages: anthropicData.messages,
            max_tokens: parseInt(state.settings.maxTokens || 8192),
            stream: true,
            temperature: parseFloat(state.settings.temperature),
            top_p: parseFloat(state.settings.topP || 0.9)
        };
        if (anthropicData.system) {
            reqBody.system = anthropicData.system;
        }
        
        const response = await fetch(`${state.settings.ollamaUrl}/messages`, {
            method: 'POST', headers, body: JSON.stringify(reqBody),
            signal: state.abortController.signal,
        });
        if (!response.ok) throw await providerHttpError(response);
        
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

// Tope de vueltas de herramienta por turno: sin él, un modelo que insiste en
// buscar encadenaría búsquedas sin fin.
const MAX_TOOL_ROUNDS = 3;

async function sendMessage(content, autoSendBody = null) {
    // La continuación tras una llamada a herramienta se lanza desde dentro de la
    // propia generación, con isStreaming todavía activo: es la única re-entrada
    // legítima. El resto de llamadas con una generación en curso se ignoran.
    const isToolFollowUp = state._toolFollowUp === true;
    state._toolFollowUp = false;
    if (state.isStreaming && !isToolFollowUp) return;
    if (!isToolFollowUp) state._toolRounds = 0;

    let isRetry = autoSendBody === 'RETRY_LAST';

    // 🕶️ Con la anonimización activa no se envía nada si el anonimizador no
    // está listo. Se comprueba aquí, antes de vaciar adjuntos y caja de texto,
    // para que un fallo no cueste lo que el usuario había escrito.
    if (state.settings.anonymizeOutgoing && typeof ensureAnonReady === 'function') {
        const anonChat = getActiveChat() || createChat();
        if (!(await ensureAnonReady(anonChat))) {
            alert(tr('anon.unavailable', 'La anonimización está activa pero no se ha podido preparar (no se cargaron las reglas). El mensaje NO se ha enviado. Reinténtalo o desactiva 🕶️ para enviarlo sin anonimizar.'));
            return;
        }
    }

    let reqImages = [];
    let promptAttachments = '';
    let attachedDocsNames = [];

    // Las imágenes no se pueden anonimizar (un DNI fotografiado viaja tal cual).
    // Con 🕶️ activo se pide confirmación antes de enviarlas; si se cancela no se
    // toca nada: ni adjuntos ni texto.
    if (!autoSendBody && !isRetry && state.settings.anonymizeOutgoing
        && state.attachments.some(a => a.isImage)
        && state.settings.provider !== 'webgpu'
        && !confirm(tr('anon.imagesWarn', 'La anonimización solo actúa sobre texto: las imágenes adjuntas se enviarán SIN anonimizar y pueden contener datos personales. ¿Enviarlas de todos modos?'))) {
        return;
    }

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

        // 🕶️ DLP local: con la anonimización activa, los datos sensibles se
        // sustituyen por placeholders ANTES de guardarse y enviarse; el mapa
        // reversible queda cifrado en el chat y solo se restaura en pantalla.
        let anonCount = 0;
        if (state.settings.anonymizeOutgoing && content.trim() && typeof anonymizeOutgoingText === 'function') {
            const anonRes = await anonymizeOutgoingText(content, chat);
            if (anonRes.ok === false) {
                // Fallo al sustituir: se devuelve el texto a la caja y no se envía.
                dom.messageInput.value = content;
                autoResizeTextarea();
                updateSendButton();
                alert(tr('anon.unavailable', 'La anonimización está activa pero no se ha podido preparar (no se cargaron las reglas). El mensaje NO se ha enviado. Reinténtalo o desactiva 🕶️ para enviarlo sin anonimizar.'));
                return;
            }
            content = anonRes.text;
            anonCount = anonRes.count;
        }

        const userMsg = { role: 'user', content: content.trim() };
        if (anonCount > 0) userMsg.anonCount = anonCount;
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
    if (!isToolFollowUp) announce(tr('sr.generating', 'Generando respuesta…'));
    dom.sendBtn.classList.add('hidden');
    dom.stopBtn.classList.remove('hidden');

    const provType = getProviderDef(state.settings.provider).type;

    // ── Recuperación sobre los documentos del proyecto (RAG) ─────────────────
    // Va aquí, antes de bifurcar por motor, porque los cuatro constructores de
    // mensajes son síncronos: el resultado se deja en state._ragContext y
    // buildSystemContext lo recoge. Si falla, se sigue con el recorte de
    // siempre; nunca debe impedir enviar el mensaje.
    if (typeof prepareRagContext === 'function') {
        const lastUserMessage = [...chat.messages].reverse().find(m => m.role === 'user');
        const queryText = (lastUserMessage?.content || '').split('\n\n--- Archivo adjunto:')[0];
        try {
            await prepareRagContext(chat, queryText, {
                onProgress: (pct, info) => {
                    setMessageLoadingState(assistantMsg, {
                        phase: 'initializing',
                        detail: 'Preparando la base de conocimiento del proyecto para buscar en ella.',
                        progress: pct,
                        progressLabel: 'Indexando',
                        file: info?.file || '',
                        note: 'Solo la primera vez por documento: después las búsquedas son instantáneas. Todo ocurre en tu navegador.'
                    });
                    updateStreamingMessage(msgIdx, assistantMsg);
                }
            });
        } catch (e) {
            console.warn('[RAG] omitido en este envío:', e);
        }
        clearMessageLoadingState(assistantMsg);
    }

    // ── WebGPU Branch ────────────────────────────────────────────────────────
    if (provType === 'webgpu') {
        return runWebGPUTurn(chat, assistantMsg, msgIdx);
    }
    // ── End WebGPU Branch ────────────────────────────────────────────────────

    // Marca de relevo: la pone la rama de llamada a herramienta para que el
    // `finally` deje el cierre del streaming a la continuación encadenada.
    let handedOffToToolFollowUp = false;

    try {
        const pendingToolCall = await sendWithFailover(chat, assistantMsg, msgIdx, autoSendBody);

        // Tool Call Proxy Logic (Ollama & OpenAI)
        if (pendingToolCall && pendingToolCall.length > 0) {
            const tool = pendingToolCall[0];
            const searchQuery = tool.function.arguments?.query || '';
            assistantMsg.content = `*(🌐 Buscando en Internet: "${searchQuery}"...)*\n\n`;
            assistantMsg.tool_calls = pendingToolCall;
            updateStreamingMessage(msgIdx, assistantMsg);

            let searchResult = "No results.";
            if (tool.function.name === 'search_web' || tool.function.name === 'search_wikipedia') {
                searchResult = await runWebSearch(searchQuery);
            }

            // Si el usuario pulsó «Detener» mientras se buscaba, no se continúa.
            if (state.abortController?.signal?.aborted) {
                throw new DOMException('Generación detenida por el usuario.', 'AbortError');
            }

            const toolMsg = { role: 'tool', content: searchResult };
            if (tool.id) toolMsg.tool_call_id = tool.id;
            chat.messages.push(toolMsg);

            // La segunda vuelta se marca para que el `finally` de ESTA llamada no
            // toque el estado de streaming: en una función async, `return promesa`
            // dentro de un try ejecuta el finally ANTES de que la promesa se
            // resuelva. Antes eso ponía isStreaming=false y devolvía el botón de
            // enviar mientras la continuación seguía generando, permitiendo lanzar
            // dos generaciones en paralelo.
            handedOffToToolFollowUp = true;
            state._toolRounds = (state._toolRounds || 0) + 1;
            state._toolFollowUp = true;
            const loopMessages = buildApiMessages(chat);
            return sendMessage('', loopMessages);
        }

    } catch (e) {
        if (e.name === 'AbortError') {
            assistantMsg.content += '\n\n*[Generación detenida]*';
        } else {
            console.error('Chat error:', e);
            const provName = getProviderDef(state.settings.provider).name;
            assistantMsg.content = describeChatFailure(e, provName, e.failoverHops || []);
        }
        updateStreamingMessage(msgIdx, assistantMsg);
    } finally {
        // Si hemos encadenado una segunda vuelta por una llamada a herramienta,
        // el cierre lo hará esa llamada: aquí no se toca nada o dejaríamos la UI
        // desbloqueada con una generación todavía en curso.
        if (!handedOffToToolFollowUp) {
            state.isStreaming = false;
            state.abortController = null;
            dom.stopBtn.classList.add('hidden');
            dom.sendBtn.classList.remove('hidden');
            noteGenerationOutcome(assistantMsg);
            announce(tr('sr.done', 'Respuesta completada.'));
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
    // Primer texto recibido: el aviso «probando con otro motor» ya no aplica.
    if (assistantMsg.loading) clearMessageLoadingState(assistantMsg);
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
            name: "search_web",
            description: "Busca información actual en Internet (web y Wikipedia). Úsala cuando necesites datos recientes, hechos verificables o información que no conoces.",
            parameters: {
                type: "object",
                properties: { query: { type: "string", description: "El término o pregunta exacta a buscar en Internet." } },
                required: ["query"]
            }
        }
    };
}

/**
 * runWebSearch — búsqueda web real desde el navegador con degradación por
 * capas para que devuelva algo útil en el mayor número de casos:
 *   1) Resultados web reales de DuckDuckGo Lite (títulos + extractos + enlaces).
 *      Necesita el proxy CORS (server.js/Plesk); el fetch global lo enruta solo.
 *   2) DuckDuckGo Instant Answer (definiciones, respuestas directas, abstracts).
 *   3) Wikipedia en español y, si no hay resultados, en inglés.
 * Combina lo que consiga cada capa para que el modelo lo cite.
 */
async function runWebSearch(query) {
    const q = encodeURIComponent(query);
    const parts = [];

    // 1) Resultados web reales vía DuckDuckGo Lite (solo con proxy disponible).
    try {
        const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${q}`, {
            signal: AbortSignal.timeout(9000),
            headers: { 'Accept': 'text/html' }
        });
        if (res.ok) {
            const html = await res.text();
            const results = parseDuckDuckGoLite(html).slice(0, 5);
            if (results.length) {
                parts.push('Resultados web:\n' + results.map(r =>
                    `• ${r.title}${r.snippet ? ` — ${r.snippet}` : ''}${r.url ? `\n  ${r.url}` : ''}`
                ).join('\n'));
            }
        }
    } catch (e) { /* sin proxy o bloqueado: seguimos con las otras capas */ }

    // 2) DuckDuckGo Instant Answer (hechos, definiciones, respuestas directas).
    try {
        const r = await fetch(`https://api.duckduckgo.com/?q=${q}&format=json&no_html=1&skip_disambig=1`, { signal: AbortSignal.timeout(8000) });
        const d = await r.json();
        if (d.AbstractText) parts.push(`${d.Heading ? d.Heading + ': ' : ''}${d.AbstractText}${d.AbstractURL ? ` (${d.AbstractURL})` : ''}`);
        else if (d.Answer) parts.push(String(d.Answer));
        else if (d.Definition) parts.push(`${d.Definition}${d.DefinitionURL ? ` (${d.DefinitionURL})` : ''}`);
        const related = (d.RelatedTopics || []).filter(t => t.Text).slice(0, 3).map(t => `• ${t.Text}`);
        if (related.length) parts.push(related.join('\n'));
    } catch (e) { /* DDG puede fallar/CORS; seguimos con Wikipedia */ }

    // 3) Wikipedia (fuente enciclopédica con CORS abierto): español y, si no
    //    devuelve nada, inglés. Funciona incluso en hosting estático sin proxy.
    for (const lang of ['es', 'en']) {
        try {
            const wpRes = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&srlimit=3&utf8=&format=json&origin=*`, { signal: AbortSignal.timeout(8000) });
            const wpData = await wpRes.json();
            const hits = wpData?.query?.search || [];
            if (hits.length) {
                parts.push(`De Wikipedia${lang === 'en' ? ' (EN)' : ''}:\n` + hits.map(s => `• ${s.title}: ${s.snippet.replace(/<[^>]+>/g, '')}`).join('\n'));
                break; // basta con el primer idioma que responda
            }
        } catch (e) { /* red bloqueada; probamos el siguiente idioma */ }
    }

    return parts.length ? parts.join('\n\n') : 'No se encontraron resultados en Internet para esa búsqueda.';
}

/**
 * parseDuckDuckGoLite — extrae {title, url, snippet} del HTML de la versión
 * Lite de DuckDuckGo. Los enlaces reales van envueltos en un redirector
 * (/l/?uddg=<url-codificada>), del que se recupera la URL de destino.
 */
function parseDuckDuckGoLite(html) {
    const out = [];
    try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const links = doc.querySelectorAll('a.result-link');
        const snippets = doc.querySelectorAll('.result-snippet');
        links.forEach((a, i) => {
            let url = a.getAttribute('href') || '';
            const m = url.match(/[?&]uddg=([^&]+)/);
            if (m) { try { url = decodeURIComponent(m[1]); } catch (_) {} }
            else if (url.startsWith('//')) url = 'https:' + url;
            const title = (a.textContent || '').trim();
            const snippet = (snippets[i]?.textContent || '').trim().replace(/\s+/g, ' ');
            if (title) out.push({ title, url, snippet });
        });
    } catch (e) { /* HTML inesperado: devolvemos lo que haya */ }
    return out;
}

// ─── Presupuesto de contexto ────────────────
// Antes se enviaba SIEMPRE el historial completo más todos los documentos del
// proyecto íntegros. En cuanto la conversación crecía —o el proyecto tenía una
// base de conocimiento de cierto tamaño— se desbordaba la ventana del modelo:
// unos proveedores devolvían un 400 críptico y otros truncaban por su cuenta
// (perdiendo justo el principio, que es donde vive el system prompt). Ahora se
// calcula un presupuesto y se recorta de forma explícita y visible.

/** Ventana de contexto del modelo activo, en tokens. */
function getModelContextWindow() {
    const providerId = state.settings.provider;
    const modelId = state.settings.model;

    if (providerId === 'webgpu') {
        const def = WEBGPU_MODELS.find(m => m.id === modelId)
            || (typeof getWebGPUCustomModels === 'function' ? getWebGPUCustomModels().find(m => m.id === modelId) : null);
        return Number(def?.context) > 0 ? Number(def.context) : 8192;
    }

    const meta = (state.rawModels || []).find(m => m.name === modelId || m.id === modelId);
    const ctx = Number(meta?.context ?? meta?.context_length);
    // Sin metadatos fiables se asume 8K: pasarse por abajo degrada la calidad,
    // pasarse por arriba rompe la petición. Se prefiere lo primero.
    return Number.isFinite(ctx) && ctx > 0 ? ctx : 8192;
}

/** Tokens disponibles para el prompt, dejando sitio para la respuesta. */
function getPromptTokenBudget() {
    const context = getModelContextWindow();
    const reserveForAnswer = parseInt(state.settings.maxTokens || 4096) || 4096;
    return Math.max(1024, context - reserveForAnswer - CONTEXT_SAFETY_MARGIN_TOKENS);
}

// Como mucho la mitad del presupuesto se gasta en la base de conocimiento: el
// resto tiene que quedar para el system prompt y la conversación real.
const PROJECT_DOCS_BUDGET_RATIO = 0.5;

/**
 * buildSystemContext — system prompt global + del proyecto + base de
 * conocimiento, recortada al presupuesto. Compartida por los cuatro
 * constructores (antes cada uno duplicaba esta lógica con textos distintos).
 */
/**
 * buildSystemContext — contexto de sistema listo para enviar.
 *
 * Con 🕶️ activo también se anonimiza: el prompt de sistema, los documentos
 * del proyecto y los fragmentos RAG llevan los mismos datos personales que un
 * adjunto, y antes salían tal cual aunque el mensaje del usuario fuese
 * protegido. Usa el mapa del chat, así que un mismo dato tiene el mismo
 * marcador en el documento y en la conversación.
 */
function buildSystemContext(chat, budget) {
    const system = buildSystemContextRaw(chat, budget);
    if (!state.settings.anonymizeOutgoing || !system?.text || typeof anonymizeTextSync !== 'function') return system;
    const res = anonymizeTextSync(system.text, chat);
    if (res.count && typeof persistAnonVault === 'function') persistAnonVault(chat, anonChatState[chat.id]);
    return { ...system, text: res.text, anonCount: res.count };
}

function buildSystemContextRaw(chat, budget) {
    const proj = state.projects.find(p => p.id === chat.projectId) || getActiveProject();
    let text = '';
    if (state.settings.systemPrompt?.trim()) text += state.settings.systemPrompt.trim() + '\n\n';
    if (proj?.systemPrompt?.trim()) text += `[INSTRUCCIONES DEL PROYECTO]: ${proj.systemPrompt.trim()}\n\n`;

    const docs = (proj?.documents || []).filter(d => d?.data);
    if (docs.length === 0) return { text: text.trim(), docsIncluded: 0, docsTotal: 0, docsTruncated: false };

    // Si la recuperación por similitud ha encontrado fragmentos para esta
    // consulta, se envían ESOS en vez de los documentos enteros. Es la
    // diferencia entre gastar el contexto en lo que viene al caso o en las
    // primeras páginas de cada archivo. prepareRagContext lo deja preparado
    // antes de construir los mensajes (aquí no se puede esperar a nada async).
    const rag = state._ragContext;
    if (rag && rag.projectId === proj.id && rag.chunks?.length && typeof formatRagContext === 'function') {
        return {
            text: (text + formatRagContext(rag)).trim(),
            docsIncluded: rag.docsMatched,
            docsTotal: rag.docsTotal,
            docsTruncated: false,
            mode: 'rag',
            chunksUsed: rag.chunks.length,
        };
    }

    const docsBudget = Math.max(
        256,
        Math.floor(budget * PROJECT_DOCS_BUDGET_RATIO) - estimateTokenCount(text)
    );

    let used = 0;
    let docsIncluded = 0;
    let docsTruncated = false;
    let docsText = '';

    for (const doc of docs) {
        const header = `\n--- Archivo Base: ${doc.name} ---\n`;
        const remaining = docsBudget - used - estimateTokenCount(header);
        if (remaining <= 64) { docsTruncated = true; break; }

        const body = String(doc.data);
        const bodyTokens = estimateTokenCount(body);
        if (bodyTokens <= remaining) {
            docsText += `${header}${body}\n`;
            used += estimateTokenCount(header) + bodyTokens;
        } else {
            // Cabe un trozo: se incluye recortado y se dice explícitamente, para
            // que el modelo no dé por completo lo que no lo está.
            const slice = body.slice(0, Math.floor(remaining * CHARS_PER_TOKEN));
            docsText += `${header}${slice}\n[…documento recortado por límite de contexto…]\n`;
            used = docsBudget;
            docsTruncated = true;
        }
        docsIncluded++;
    }

    if (docsIncluded > 0) {
        text += '[BASE DE CONOCIMIENTO DEL PROYECTO]:\n' + docsText;
        if (docsTruncated || docsIncluded < docs.length) {
            text += `\n[Aviso: se han incluido ${docsIncluded} de ${docs.length} documentos, recortados para caber en el contexto del modelo.]\n`;
        }
        text += '\nUtiliza la información de esta base de conocimiento cuando aplique.\n\n';
    }

    return {
        text: text.trim(),
        docsIncluded,
        docsTotal: docs.length,
        docsTruncated: docsTruncated || docsIncluded < docs.length,
    };
}

/**
 * applyHistoryBudget — se queda con los mensajes más recientes que caben.
 *
 * Recorta por el principio (lo más antiguo) y nunca elimina el último turno del
 * usuario, aunque por sí solo desborde: en ese caso el proveedor dará un error
 * comprensible, que es mejor que enviar una conversación sin la pregunta.
 * Devuelve además cuántos se descartaron para poder avisar en la interfaz.
 */
function applyHistoryBudget(entries, budget) {
    // El último turno es intocable: la pregunta del usuario y todo lo que cuelga de
    // ella (la llamada a una herramienta y su resultado). Conservar solo el último
    // mensaje enviaba un resultado de búsqueda SIN la pregunta ni la llamada que
    // lo originó, y el modelo respondía a ciegas o el proveedor rechazaba la petición.
    let lastUser = -1;
    for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].value?.role === 'user') { lastUser = i; break; }
    }
    const mustKeepFrom = lastUser >= 0 ? lastUser : entries.length - 1;

    let used = 0;
    const kept = [];
    for (let i = entries.length - 1; i >= 0; i--) {
        const cost = entries[i].tokens;
        if (i < mustKeepFrom && kept.length > 0 && used + cost > budget) break;
        kept.unshift(entries[i]);
        used += cost;
    }
    return { kept, dropped: entries.length - kept.length, used };
}

/** Extrae de buildSystemContext lo que hay que enseñar al usuario. */
function describeSystemContext(system) {
    return {
        docsIncluded: system.docsIncluded,
        docsTotal: system.docsTotal,
        docsTruncated: system.docsTruncated,
        mode: system.mode || 'full',
        chunksUsed: system.chunksUsed || 0,
    };
}

/** Deja constancia del recorte en el mensaje en curso para poder mostrarlo. */
function noteContextTrim(chat, info) {
    const last = chat?.messages?.[chat.messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    if (info.droppedMessages > 0 || info.docsTruncated || info.mode === 'rag') last.contextTrim = info;
    else delete last.contextTrim;
}

// Texto de un mensaje del historial tal como debe SALIR hacia el motor. Con 🕶️
// activo es obligatorio anonimizarlo: si el módulo no está, se corta el envío en
// vez de mandarlo sin tratar.
function outgoingHistoryText(text, chat) {
    if (!state.settings.anonymizeOutgoing) return text;
    if (typeof anonymizeHistoryText !== 'function') throw new Error('anonimizador no disponible');
    return anonymizeHistoryText(text, chat);
}

// ─── Message builders per provider type ─────
function buildApiMessages(chat) {
    // For Gemini and Anthropic, use their specific builders during streaming
    // This function is used for Ollama & OpenAI-compatible
    const messages = [];
    const budget = getPromptTokenBudget();
    const system = buildSystemContext(chat, budget);

    if (system.text) {
        messages.push({ role: 'system', content: system.text });
    }

    const historyBudget = budget - estimateTokenCount(system.text);
    const entries = [];
    for (const msg of chat.messages) {
        if (msg.role === 'assistant' && msg.content === '' && msg.thinking === '' && !msg.tool_calls) continue;
        const apiMsg = { role: msg.role, content: outgoingHistoryText(msg.content, chat) };
        if (msg.images) apiMsg.images = msg.images;
        if (msg.tool_calls) apiMsg.tool_calls = msg.tool_calls;
        if (msg.tool_call_id) apiMsg.tool_call_id = msg.tool_call_id;
        entries.push({ value: apiMsg, tokens: estimateTokenCount(apiMsg.content) });
    }

    const { kept, dropped } = applyHistoryBudget(entries, historyBudget);
    kept.forEach(e => messages.push(e.value));
    noteContextTrim(chat, { droppedMessages: dropped, ...describeSystemContext(system) });
    return messages;
}

function buildGeminiMessages(chat) {
    const budget = getPromptTokenBudget();
    const system = buildSystemContext(chat, budget);
    const historyBudget = budget - estimateTokenCount(system.text);

    const entries = [];
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
        const safeText = outgoingHistoryText(msg.content || '', chat);
        parts.push({ text: safeText });
        entries.push({ value: { role, parts }, tokens: estimateTokenCount(safeText) });
    }

    const { kept, dropped } = applyHistoryBudget(entries, historyBudget);
    noteContextTrim(chat, { droppedMessages: dropped, ...describeSystemContext(system) });

    return {
        systemInstruction: system.text ? { parts: [{ text: system.text }] } : null,
        contents: kept.map(e => e.value)
    };
}

function buildAnthropicMessages(chat) {
    const budget = getPromptTokenBudget();
    const system = buildSystemContext(chat, budget);
    const historyBudget = budget - estimateTokenCount(system.text);

    const entries = [];
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
        const safeText = outgoingHistoryText(msg.content || '', chat);
        content.push({ type: 'text', text: safeText });
        entries.push({ value: { role, content }, tokens: estimateTokenCount(safeText) });
    }

    const { kept, dropped } = applyHistoryBudget(entries, historyBudget);
    noteContextTrim(chat, { droppedMessages: dropped, ...describeSystemContext(system) });
    const messages = kept.map(e => e.value);

    // Anthropic requires alternating user/assistant. Ensure first message is user.
    // El recorte del historial puede haber dejado una respuesta del asistente en
    // primera posición, así que esta comprobación es ahora imprescindible.
    if (messages.length > 0 && messages[0].role !== 'user') {
        messages.unshift({ role: 'user', content: [{ type: 'text', text: '.' }] });
    }

    return {
        system: system.text || undefined,
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

        html += renderThinkingBlockHtml(msg, idx);

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
        // Rescate: si el worker no atiende la interrupción (GPU bloqueada,
        // proceso muerto), se fuerza su reinicio para liberar la UI. El
        // siguiente uso lo recrea automáticamente.
        setTimeout(() => {
            if (webgpuWorker.pending.size > 0 && state.abortController?.signal?.aborted) {
                console.warn('[WebGPU] el worker no respondió a la cancelación; reiniciándolo');
                webgpuWorker.shutdown();
            }
        }, 4000);
    }
}

/* >>> exports (generado por scripts/gen-modules.mjs: no editar a mano) >>> */
export {
    hashString, renderMessages, showMetricsModal, clearMessageLoadingState,
    inferMimeTypeFromBase64, normalizeImageMeta, supportsWebGPUImageAssist,
    analyzeImagesForWebGPUInline, extractGeneratedText, runWebGPUGenerationInline,
    shouldEmitWebGPUProgress, estimateInstallProgress, buildWebGPURepoUrl, formatErrorDetail,
    improvePrompt, sendMessage, getPromptTokenBudget, PROJECT_DOCS_BUDGET_RATIO,
    updateStreamingMessage, stopStreaming,
};
/* <<< exports <<< */
