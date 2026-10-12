// wIA Version Definition
const VERSION_YEAR = 26;
const VERSION_MONTH = 10;
const VERSION_SEQUENCE = 'AI';

const APP_VERSION = `v${VERSION_YEAR}${String(VERSION_MONTH).padStart(2, '0')}.${VERSION_SEQUENCE}`;
// Cómo se muestra junto al logo (mismo formato que SiMuDeFi: V26.10AD).
const APP_VERSION_LABEL = `V${VERSION_YEAR}.${String(VERSION_MONTH).padStart(2, '0')}${VERSION_SEQUENCE}`;

if (typeof window !== 'undefined') {
    window.VERSION_YEAR = VERSION_YEAR;
    window.VERSION_MONTH = VERSION_MONTH;
    window.VERSION_SEQUENCE = VERSION_SEQUENCE;
    window.APP_VERSION = APP_VERSION;
    window.APP_VERSION_LABEL = APP_VERSION_LABEL;
}
