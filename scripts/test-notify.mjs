/**
 * test-notify — avisos no bloqueantes y errores no controlados.
 *
 * Uso: npm run test:notify
 */
import { createChatHarness } from './harness-chat.mjs';

let failures = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failures++;
};

const h = createChatHarness({ handler: async () => { throw new Error('sin red'); } });
const notices = () => h.run('recentNotices.map(n => n.kind + ":" + n.message)');

console.log('1. trf sustituye marcadores\n');
check('sustituye {p0} y {p1}', h.run(`trf('clave.inexistente', 'a {p0} y {p1}', { p0: 1, p1: 'dos' })`) === 'a 1 y dos');
check('el mismo marcador varias veces', h.run(`trf('x.y', '{p0}-{p0}', { p0: 'z' })`) === 'z-z');
check('sin variables devuelve el texto', h.run(`trf('x.y', 'hola')`) === 'hola');
h.run(`I18N_STRINGS.es['k.t'] = 'traducido {p0}'; I18N_STRINGS.en['k.t'] = 'translated {p0}';`);
check('una clave traducida usa la traducción y sustituye', h.run(`trf('k.t', 'fallback {p0}', { p0: 5 })`) === 'traducido 5', h.run(`trf('k.t', 'fallback {p0}', { p0: 5 })`));

console.log('\n2. notify no bloquea y deja rastro\n');
let alerts = 0;
h.sandbox.alert = () => { alerts++; };
h.run(`notify('Hecho', 'info'); notify('Falló', 'error');`);
check('registra los avisos', JSON.stringify(notices()) === '["info:Hecho","error:Falló"]', JSON.stringify(notices()));
check('no usa alert() cuando hay DOM', alerts === 0, `alert llamado ${alerts} veces`);

console.log('\n3. Errores no controlados\n');
h.run(`recentNotices.length = 0; _lastCrashNotice = 0; reportUnhandled(new Error('boom'));`);
check('se avisa al usuario con un mensaje genérico', notices().length === 1 && notices()[0].startsWith('error:'), JSON.stringify(notices()));
check('sin filtrar el detalle técnico al aviso', !notices()[0].includes('boom'));
h.run(`reportUnhandled(new Error('otro'));`);
check('un segundo error seguido no repite el aviso', notices().length === 1);
h.run(`recentNotices.length = 0; _lastCrashNotice = 0; const e = new Error('cancelado'); e.name = 'AbortError'; reportUnhandled(e);`);
check('una cancelación del usuario (AbortError) se ignora', notices().length === 0);
h.run(`reportUnhandled(new Error('ResizeObserver loop completed with undelivered notifications.'));`);
check('el ruido conocido del navegador se ignora', notices().length === 0);

console.log('\n4. announce\n');
let region = { textContent: '' };
h.sandbox.document.getElementById = (id) => (id === 'srStatus' ? region : null);
h.run(`announce('Generando')`);
await new Promise(r => setTimeout(r, 80));
check('escribe en la región de estado', region.textContent === 'Generando', region.textContent);

if (failures) { console.error(`\n✖ ${failures} comprobaciones fallidas.`); process.exit(1); }
console.log('\n✔ Avisos y errores correctos.');
process.exit(0);
