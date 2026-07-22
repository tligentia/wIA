// wIA Version Definition
const VERSION_YEAR = 26;
const VERSION_MONTH = 7;
const VERSION_SEQUENCE = 'AJ';

const APP_VERSION = `v${VERSION_YEAR}${String(VERSION_MONTH).padStart(2, '0')}.${VERSION_SEQUENCE}`;

if (typeof window !== 'undefined') {
    window.VERSION_YEAR = VERSION_YEAR;
    window.VERSION_MONTH = VERSION_MONTH;
    window.VERSION_SEQUENCE = VERSION_SEQUENCE;
    window.APP_VERSION = APP_VERSION;
}
