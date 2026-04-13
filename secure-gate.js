/* ============================================================
   SecureGate — Hybrid Access Control Layer
   IP Whitelist Detection + PIN Authentication
   ============================================================ */

const SecureGate = (() => {
    // ─── Configuration ──────────────────────────
    const MASTER_CODES = ['7887', 'STAR'];
    const HARDCODED_WHITELIST = [
        '88.26.226.92',   // Office
        '83.50.195.12',   // Home
    ];
    const STORAGE_KEY = 'wia_whitelisted_ips';
    const SESSION_KEY = 'secureAccessGateAuthenticated';
    const IP_SERVICES = [
        'https://api.ipify.org?format=json',
        'https://ipapi.co/json/',
        'https://api.seeip.org/jsonip',
    ];

    let currentPublicIp = null;
    let onLoginCallback = null;

    // ─── IP Detection ───────────────────────────
    async function detectPublicIp() {
        for (const service of IP_SERVICES) {
            try {
                const res = await fetch(service, { signal: AbortSignal.timeout(4000) });
                if (!res.ok) continue;
                const data = await res.json();
                const ip = data.ip || data.query || null;
                if (ip && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
                    currentPublicIp = ip;
                    return ip;
                }
            } catch (e) {
                continue;
            }
        }
        return null;
    }

    function getWhitelistedIps() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            return saved ? JSON.parse(saved) : [];
        } catch {
            return [];
        }
    }

    function saveWhitelistedIps(ips) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(ips));
    }

    function addCurrentIpToWhitelist() {
        if (!currentPublicIp) return false;
        const ips = getWhitelistedIps();
        if (!ips.includes(currentPublicIp)) {
            ips.push(currentPublicIp);
            saveWhitelistedIps(ips);
        }
        return true;
    }

    function removeIpFromWhitelist(ip) {
        const ips = getWhitelistedIps().filter(i => i !== ip);
        saveWhitelistedIps(ips);
    }

    function isIpWhitelisted(ip) {
        if (!ip) return false;
        const allWhitelisted = [...HARDCODED_WHITELIST, ...getWhitelistedIps()];
        return allWhitelisted.includes(ip);
    }

    // ─── Session Persistence ────────────────────
    function isSessionAuthenticated() {
        return sessionStorage.getItem(SESSION_KEY) === 'true';
    }

    function setSessionAuthenticated() {
        sessionStorage.setItem(SESSION_KEY, 'true');
    }

    // ─── PIN Keypad Generation ──────────────────
    function generateKeypad() {
        // Required characters for both codes: 7, 8, S, T, A, R
        const requiredChars = ['7', '8', 'S', 'T', 'A', 'R'];
        // Fill remaining 10 slots with random distractor chars
        const distractorPool = '2346BDFHKMNPQUVWXYZ'.split('');
        const distractors = [];
        const usedChars = new Set(requiredChars);
        
        while (distractors.length < 10) {
            const c = distractorPool[Math.floor(Math.random() * distractorPool.length)];
            if (!usedChars.has(c)) {
                usedChars.add(c);
                distractors.push(c);
            }
        }
        
        const allChars = [...requiredChars, ...distractors];
        // Shuffle Fisher-Yates
        for (let i = allChars.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allChars[i], allChars[j]] = [allChars[j], allChars[i]];
        }
        return allChars;
    }

    // ─── Render Security Gate ───────────────────
    function renderGate() {
        const overlay = document.createElement('div');
        overlay.id = 'secureGateOverlay';
        overlay.innerHTML = `
            <div class="sg-container">
                <div class="sg-logo">
                    <div class="sg-logo-circle">
                        <span>GO</span>
                    </div>
                </div>
                <h1 class="sg-title">SEGURIDAD</h1>
                <p class="sg-subtitle">ACCESO RESTRINGIDO</p>
                
                <div class="sg-input-display">
                    <div class="sg-slot" data-idx="0">
                        <span class="sg-dot"></span>
                        <div class="sg-line"></div>
                    </div>
                    <div class="sg-slot" data-idx="1">
                        <span class="sg-dot"></span>
                        <div class="sg-line"></div>
                    </div>
                    <div class="sg-slot" data-idx="2">
                        <span class="sg-dot"></span>
                        <div class="sg-line"></div>
                    </div>
                    <div class="sg-slot" data-idx="3">
                        <span class="sg-dot"></span>
                        <div class="sg-line"></div>
                    </div>
                </div>
                
                <div class="sg-keypad" id="sgKeypad"></div>
                
                <button class="sg-clear-btn" id="sgClearBtn">BORRAR ENTRADA</button>
                
                <p class="sg-ip-info" id="sgIpInfo"></p>
            </div>
        `;
        document.body.appendChild(overlay);

        // Build keypad buttons
        const keypadEl = document.getElementById('sgKeypad');
        const chars = generateKeypad();
        chars.forEach(char => {
            const btn = document.createElement('button');
            btn.className = 'sg-key';
            btn.textContent = char;
            btn.dataset.char = char;
            btn.addEventListener('click', () => handleKeyPress(char));
            keypadEl.appendChild(btn);
        });

        // Clear button
        document.getElementById('sgClearBtn').addEventListener('click', clearInput);

        // Show IP info
        if (currentPublicIp) {
            document.getElementById('sgIpInfo').textContent = `IP: ${currentPublicIp}`;
        }

        // Keyboard support
        document.addEventListener('keydown', handlePhysicalKey);
    }

    let inputBuffer = '';

    function handleKeyPress(char) {
        if (inputBuffer.length >= 4) return;
        inputBuffer += char;
        updateDots();

        if (inputBuffer.length === 4) {
            validateCode();
        }
    }

    function handlePhysicalKey(e) {
        if (!document.getElementById('secureGateOverlay')) return;
        if (e.key === 'Backspace') {
            clearInput();
            return;
        }
        
        // Sólo aceptar caracteres alfanuméricos individuales
        if (e.key.length !== 1 || !/^[A-Za-z0-9]$/.test(e.key)) return;
        
        const char = e.key.toUpperCase();
        
        // Feedback visual si la tecla existe en el teclado aleatorio
        const btn = document.querySelector(`.sg-key[data-char="${char}"]`);
        if (btn) {
            btn.classList.add('sg-key-pressed');
            setTimeout(() => btn.classList.remove('sg-key-pressed'), 150);
        }
        
        // Procesar siempre la pulsación, esté o no en el teclado visual
        handleKeyPress(char);
    }

    function updateDots() {
        const slots = document.querySelectorAll('.sg-slot');
        slots.forEach((slot, i) => {
            const dot = slot.querySelector('.sg-dot');
            const line = slot.querySelector('.sg-line');
            dot.classList.remove('filled', 'error');
            line.classList.remove('filled', 'error');
            if (i < inputBuffer.length) {
                dot.classList.add('filled');
                line.classList.add('filled');
            }
        });
    }

    function clearInput() {
        inputBuffer = '';
        updateDots();
    }

    function validateCode() {
        const code = inputBuffer.toUpperCase();
        if (MASTER_CODES.includes(code) || MASTER_CODES.includes(inputBuffer)) {
            // Success
            setSessionAuthenticated();
            const overlay = document.getElementById('secureGateOverlay');
            if (overlay) {
                overlay.classList.add('sg-success');
                setTimeout(() => {
                    overlay.remove();
                    document.removeEventListener('keydown', handlePhysicalKey);
                    if (onLoginCallback) onLoginCallback();
                }, 400);
            }
        } else {
            // Error — shake
            const dots = document.querySelectorAll('.sg-dot');
            const lines = document.querySelectorAll('.sg-line');
            const container = document.querySelector('.sg-container');
            
            dots.forEach(d => d.classList.add('error'));
            lines.forEach(l => l.classList.add('error'));
            container?.classList.add('sg-shake');
            
            setTimeout(() => {
                container?.classList.remove('sg-shake');
                clearInput();
            }, 800);
        }
    }

    // ─── Main Init ──────────────────────────────
    async function init(onLogin) {
        onLoginCallback = onLogin;

        // 1. Already authenticated this session?
        if (isSessionAuthenticated()) {
            onLogin();
            return;
        }

        // 2. Try IP-based auto-login
        const ip = await detectPublicIp();
        if (ip && isIpWhitelisted(ip)) {
            setSessionAuthenticated();
            onLogin();
            return;
        }

        // 3. Show PIN gate
        renderGate();
    }

    // ─── Public API ─────────────────────────────
    return {
        init,
        getCurrentIp: () => currentPublicIp,
        addCurrentIpToWhitelist,
        removeIpFromWhitelist,
        getWhitelistedIps,
        isIpWhitelisted: () => isIpWhitelisted(currentPublicIp),
        HARDCODED_WHITELIST,
    };
})();
