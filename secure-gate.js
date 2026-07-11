/* ============================================================
   SecureGate — Local Privacy Lock
   Browser-side interface lock for shared devices
   ============================================================ */

const SecureGate = (() => {
    const CONFIG_KEY = 'wia_privacy_lock_config';
    const SESSION_KEY = 'wia_privacy_lock_unlocked';
    const HASH_SALT = 'wia-privacy-lock-v2604-bu';

    let onUnlockCallback = null;

    function getConfig() {
        try {
            const raw = localStorage.getItem(CONFIG_KEY);
            return raw ? JSON.parse(raw) : { enabled: false, pinHash: '' };
        } catch {
            return { enabled: false, pinHash: '' };
        }
    }

    function saveConfig(config) {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    }

    function clearSession() {
        sessionStorage.removeItem(SESSION_KEY);
    }

    function setUnlocked() {
        sessionStorage.setItem(SESSION_KEY, 'true');
    }

    function isUnlocked() {
        return sessionStorage.getItem(SESSION_KEY) === 'true';
    }

    async function sha256(text) {
        const data = new TextEncoder().encode(`${HASH_SALT}:${text}`);
        const digest = await crypto.subtle.digest('SHA-256', data);
        return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    function validatePin(pin) {
        return /^\d{4,12}$/.test(pin);
    }

    async function configure({ enabled, pin }) {
        const current = getConfig();
        const next = {
            enabled: !!enabled,
            pinHash: current.pinHash || ''
        };

        if (pin) {
            if (!validatePin(pin)) {
                throw new Error('El PIN del bloqueo local debe tener entre 4 y 12 dígitos.');
            }
            next.pinHash = await sha256(pin);
        }

        if (next.enabled && !next.pinHash) {
            throw new Error('Para activar el bloqueo local necesitas definir primero un PIN.');
        }

        saveConfig(next);
        if (!next.enabled) clearSession();
        return next;
    }

    function ensureOverlayStyles() {
        if (document.getElementById('secureGateInlineStyles')) return;
        const style = document.createElement('style');
        style.id = 'secureGateInlineStyles';
        style.textContent = `
            #secureGateOverlay {
                position: fixed;
                inset: 0;
                z-index: 99999;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 24px;
                background: radial-gradient(circle at top, rgba(124, 58, 237, 0.18), rgba(10, 10, 15, 0.96) 48%), rgba(10, 10, 15, 0.96);
                backdrop-filter: blur(18px);
            }
            .sg-panel {
                width: min(100%, 420px);
                padding: 28px;
                border-radius: 20px;
                border: 1px solid rgba(255, 255, 255, 0.08);
                background: rgba(17, 17, 24, 0.96);
                box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
                color: #f0f0f5;
            }
            .sg-title {
                margin: 0 0 10px;
                font-size: 1.15rem;
                font-weight: 800;
                letter-spacing: 0.04em;
                text-transform: uppercase;
            }
            .sg-copy {
                margin: 0 0 18px;
                color: #9898a8;
                line-height: 1.55;
                font-size: 0.9rem;
            }
            .sg-input {
                width: 100%;
                padding: 14px 16px;
                border-radius: 12px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                background: rgba(255, 255, 255, 0.03);
                color: #f0f0f5;
                font-size: 1rem;
                letter-spacing: 0.2em;
                outline: none;
            }
            .sg-input:focus {
                border-color: rgba(124, 58, 237, 0.9);
                box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.14);
            }
            .sg-actions {
                display: flex;
                gap: 10px;
                margin-top: 14px;
            }
            .sg-btn {
                flex: 1;
                border: none;
                border-radius: 12px;
                padding: 12px 14px;
                font-weight: 700;
                cursor: pointer;
            }
            .sg-btn-primary {
                background: #7c3aed;
                color: white;
            }
            .sg-btn-secondary {
                background: rgba(255, 255, 255, 0.06);
                color: #f0f0f5;
            }
            .sg-error {
                min-height: 20px;
                margin-top: 12px;
                color: #f87171;
                font-size: 0.82rem;
            }
        `;
        document.head.appendChild(style);
    }

    function removeOverlay() {
        document.getElementById('secureGateOverlay')?.remove();
    }

    function renderGate(config) {
        ensureOverlayStyles();
        removeOverlay();

        const overlay = document.createElement('div');
        overlay.id = 'secureGateOverlay';
        overlay.innerHTML = `
            <div class="sg-panel">
                <h1 class="sg-title">Bloqueo local de privacidad</h1>
                <p class="sg-copy">Introduce tu PIN para desbloquear esta interfaz en este navegador. Este bloqueo evita accesos casuales en el dispositivo, pero no sustituye autenticación de servidor.</p>
                <input class="sg-input" id="sgPinInput" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN de 4-12 dígitos">
                <div class="sg-actions">
                    <button class="sg-btn sg-btn-secondary" id="sgClearBtn" type="button">Borrar</button>
                    <button class="sg-btn sg-btn-primary" id="sgUnlockBtn" type="button">Desbloquear</button>
                </div>
                <div class="sg-error" id="sgError"></div>
            </div>
        `;

        document.body.appendChild(overlay);

        const input = document.getElementById('sgPinInput');
        const errorEl = document.getElementById('sgError');

        async function unlock() {
            const pin = input.value.trim();
            const hash = await sha256(pin);
            if (hash !== config.pinHash) {
                errorEl.textContent = 'PIN incorrecto.';
                input.value = '';
                input.focus();
                return;
            }

            setUnlocked();
            removeOverlay();
            onUnlockCallback?.();
        }

        document.getElementById('sgClearBtn').addEventListener('click', () => {
            input.value = '';
            errorEl.textContent = '';
            input.focus();
        });
        document.getElementById('sgUnlockBtn').addEventListener('click', unlock);
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') unlock();
        });
        input.focus();
    }

    function init(onUnlock) {
        onUnlockCallback = onUnlock;
        const config = getConfig();

        if (!config.enabled || !config.pinHash) {
            clearSession();
            onUnlock();
            return;
        }

        if (isUnlocked()) {
            onUnlock();
            return;
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => renderGate(config), { once: true });
            return;
        }

        renderGate(config);
    }

    return {
        init,
        configure,
        getConfig,
        clearSession
    };
})();

window.SecureGate = SecureGate;
