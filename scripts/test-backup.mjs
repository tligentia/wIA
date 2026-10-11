/**
 * test-backup — la copia de seguridad se puede restaurar en OTRO navegador.
 *
 * Por qué: el mapa de marcadores de cada chat (DNI, nombres… reales) se cifraba
 * con una clave no exportable de ESTE navegador. Una copia restaurada en otro
 * equipo conservaba los chats pero perdía para siempre la forma de revertir los
 * marcadores. Ahora la copia protegida con contraseña lleva los mapas dentro de
 * un sobre PBKDF2 + AES-GCM, y sin contraseña no los lleva.
 *
 * Uso: npm run test:backup
 */
import { createChatHarness } from './harness-chat.mjs';

let failures = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failures++;
};

/** Un "navegador": su propia bóveda (clave AES distinta) y su propio IndexedDB en memoria. */
function browser() {
    const h = createChatHarness({ handler: async () => { throw new Error('sin red'); } });
    const alerts = [];
    h.sandbox.alert = (m) => alerts.push(String(m));
    h.sandbox.confirm = () => true;
    let lastBlob = null;
    h.sandbox.URL = class extends URL {
        static createObjectURL(b) { lastBlob = b; return 'blob:test'; }
        static revokeObjectURL() {}
    };
    h.run(`(() => { const mem = new Map(); idbStore.get = async (k) => mem.get(k); idbStore.set = async (k, v) => { mem.set(k, v); return true; }; idbStore.del = async (k) => { mem.delete(k); return true; }; })()`);
    h.run('state.settings.incognitoMode = true; state.incognitoSessionActive = true;');
    return { h, alerts, blob: () => lastBlob };
}

const SECRET = 'juan.perez@example.com';

console.log('1. Sobre cifrado con contraseña\n');
{
    const { h } = browser();
    const env = await h.run(`backupCrypto.seal({ hola: 'mundo', secreto: '${SECRET}' }, 'una-clave-larga-1')`);
    const text = JSON.stringify(env);
    check('el sobre no contiene el contenido en claro', !text.includes(SECRET) && !text.includes('mundo'));
    check('declara su tipo y su KDF', env._type === 'wia-backup-enc' && env.kdf === 'PBKDF2-SHA256' && env.iterations >= 600000);
    const back = await h.run(`(async () => backupCrypto.open(${JSON.stringify(env)}, 'una-clave-larga-1'))()`);
    check('con la contraseña correcta se recupera', back.secreto === SECRET);
    let err = '';
    try { await h.run(`(async () => backupCrypto.open(${JSON.stringify(env)}, 'otra-clave'))()`); } catch (e) { err = e.message; }
    check('con otra contraseña falla', err === 'bad-passphrase', err);
    const tampered = { ...env, data: env.data.slice(0, -4) + (env.data.endsWith('AAAA') ? 'BBBB' : 'AAAA') };
    err = '';
    try { await h.run(`(async () => backupCrypto.open(${JSON.stringify(tampered)}, 'una-clave-larga-1'))()`); } catch (e) { err = e.message; }
    check('un fichero alterado se detecta', err === 'bad-passphrase', err);
    err = '';
    try { await h.run(`(async () => backupCrypto.open(${JSON.stringify({ ...env, iterations: 900000000 })}, 'x'))()`); } catch (e) { err = e.message; }
    check('un fichero ajeno no puede exigir un coste de CPU desmesurado', err === 'bad-envelope', err);
}

console.log('\n2. Restaurar en otro navegador\n');
{
    const A = browser();
    // Navegador A: un chat con anonimización y su mapa cifrado con la clave de A
    A.h.run(`secretVault.encrypt(JSON.stringify({ counters: { Email: 1 }, map: { '[Email_001]': '${SECRET}' } })).then(v => {
        state.projects = [{ id: 'general', name: 'General', systemPrompt: '', documents: [] }];
        state.chats = [{ id: 'c1', projectId: 'general', title: 'Prueba', messages: [{ role: 'user', content: 'Escribe a [Email_001]' }], anonVault: v }];
    })`);
    await new Promise(r => setTimeout(r, 100));

    // Con contraseña
    A.h.run(`askPassphrase = async () => 'clave-segura-123';`);
    await A.h.run('exportFullBackup()');
    const file = await A.blob().text();
    const parsed = JSON.parse(file);
    check('la copia con contraseña sale cifrada', parsed._type === 'wia-backup-enc');
    check('y no deja ver chats ni datos reales', !file.includes(SECRET) && !file.includes('Prueba') && !file.includes('Email_001'));

    // Navegador B: otra clave de bóveda
    const B = browser();
    B.h.run(`askPassphrase = async () => 'clave-segura-123';`);
    await B.h.run(`importFullBackup(${JSON.stringify(file)})`);
    check('B restaura el chat', B.h.run('state.chats.length') === 1 && B.h.run('state.chats[0].title') === 'Prueba');
    const dec = await B.h.run(`(async () => { const c = state.chats[0]; return c.anonVault ? secretVault.decrypt(c.anonVault) : ''; })()`);
    check('B puede descifrar el mapa con SU clave', dec.includes(SECRET), dec.slice(0, 60));
    const shown = await B.h.run(`(async () => { const c = state.chats[0]; await ensureAnonState(c); return restoreAnonText('Escribe a [Email_001]', c); })()`);
    check('y revertir el marcador al dato real', shown === `Escribe a ${SECRET}`, shown);

    // Contraseña equivocada al importar: reintenta y se rinde si se cancela
    const C = browser();
    C.h.sandbox.__answers = ['mal', null];
    C.h.run(`askPassphrase = async () => __answers[${'0'}] === undefined ? null : __answers.shift();`);
    await C.h.run(`importFullBackup(${JSON.stringify(file)})`);
    check('con contraseña errónea no se restaura nada', C.h.run('state.chats.length') === 0);

    // Sin contraseña: la copia sale en claro pero SIN mapas ni vaults
    A.h.run(`askPassphrase = async () => '';`);
    await A.h.run('exportFullBackup()');
    const plain = await A.blob().text();
    check('sin contraseña no se incluye el mapa de marcadores', !plain.includes(SECRET) && !plain.includes('anonMaps') && !plain.includes('anonVault'));
    check('y se avisa de ello', A.alerts.some(m => /SIN los mapas/.test(m)), A.alerts.join('|').slice(0, 80));

    // Cancelar no descarga nada
    A.h.run(`askPassphrase = async () => null;`);
    const before = A.blob();
    await A.h.run('exportFullBackup()');
    check('cancelar el diálogo no exporta', A.blob() === before);

    // Copia antigua en claro (sin el nuevo formato) sigue restaurándose
    const D = browser();
    const legacy = { _type: 'wia-backup', projects: [{ id: 'general', name: 'General', systemPrompt: '', documents: [] }], chats: [{ id: 'x', title: 'Vieja', messages: [] }], settings: {} };
    await D.h.run(`importFullBackup(${JSON.stringify(JSON.stringify(legacy))})`);
    check('las copias antiguas en claro siguen funcionando', D.h.run('state.chats.length') === 1 && D.h.run('state.chats[0].title') === 'Vieja');
}

if (failures) { console.error(`\n✖ ${failures} comprobaciones fallidas.`); process.exit(1); }
console.log('\n✔ Copia de seguridad portable correcta.');
process.exit(0);
