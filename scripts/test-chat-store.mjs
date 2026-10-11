/**
 * test-chat-store — conversaciones por registro y varias pestañas a la vez.
 *
 * Por qué: todo el historial era UN registro cifrado. Cada guardado reescribía
 * todas las conversaciones (imágenes incluidas) y dos pestañas abiertas se
 * pisaban: la que guardaba la última borraba lo que había hecho la otra.
 *
 * Uso: npm run test:chat-store
 */
import { createChatHarness } from './harness-chat.mjs';

let failures = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failures++;
};
const wait = (ms = 80) => new Promise(r => setTimeout(r, ms));

// IndexedDB compartido por todas las pestañas del "navegador" + canal entre ellas
const mem = new Map();
const hub = new Set();
class FakeChannel {
    constructor() { this.onmessage = null; hub.add(this); }
    postMessage(data) { for (const c of hub) if (c !== this && c.onmessage) setTimeout(() => c.onmessage({ data: structuredClone(data) }), 0); }
    close() { hub.delete(this); }
}

function tab(name) {
    const writes = [];
    const h = createChatHarness({ handler: async () => { throw new Error('sin red'); }, extra: { BroadcastChannel: FakeChannel, structuredClone } });
    h.sandbox.__mem = mem; h.sandbox.__writes = writes;
    h.run(`idbStore.get = async (k) => __mem.get(k);
           idbStore.set = async (k, v) => { __mem.set(k, v); return true; };
           idbStore.del = async (k) => { __mem.delete(k); return true; };
           idbStore.keys = async () => [...__mem.keys()];
           idbStore.batch = async (ops) => { __writes.push(ops.map(o => o[0] + ':' + o[1])); for (const [op, k, v] of ops) { if (op === 'set') __mem.set(k, v); else __mem.delete(k); } return true; };
           renderChatList = () => {}; renderProjectSelect = () => {}; renderMessages = () => {}; showWelcome = () => {};
           applyPostResetUI = () => {}; applySettingsToUI = () => {};`);
    h.run('state.settings.incognitoMode = false; state.incognitoSessionActive = false;');
    return { name, h, writes, ids: () => h.run('state.chats.map(c => c.id)'), titles: () => h.run('state.chats.map(c => c.title)') };
}
const chatDef = (id, title, text = 'hola') => `{ id: '${id}', projectId: 'general', title: '${title}', messages: [{ role: 'user', content: '${text}' }], createdAt: 1, updatedAt: 1 }`;

console.log('1. Cada chat es su propio registro, cifrado\n');
const A = tab('A');
await A.h.run('loadState()');
A.h.run(`state.chats = [${chatDef('c1', 'Uno', 'secreto-uno')}, ${chatDef('c2', 'Dos', 'secreto-dos')}];`);
check('guardar escribe sin errores', await A.h.run('saveStateNow()') === true);
check('hay un registro por chat', mem.has('chat:c1') && mem.has('chat:c2') && !mem.has('chat-index'), [...mem.keys()].filter(k => k !== 'wia-secret-key').join(','));
check('el registro antiguo único no se crea', !mem.has('chats'));
const dump = JSON.stringify(mem.get('chat:c1'), (k, v) => v instanceof Uint8Array || v instanceof ArrayBuffer ? 'bin' : v);
check('los registros están cifrados', !dump.includes('secreto-uno') && mem.get('chat:c1').__wiaEnc === 'v1');

console.log('\n2. Solo se escribe lo que cambió\n');
A.writes.length = 0;
A.h.run(`state.chats[0].messages.push({ role: 'assistant', content: 'nuevo' }); state.chats[0].updatedAt = 2;`);
await A.h.run('saveStateNow()');
const w = A.writes.flat();
check('un cambio en un chat reescribe solo ese chat', w.includes('set:chat:c1') && !w.includes('set:chat:c2'), w.join(' '));
check('sin cambios no se escribe nada', (A.writes.length = 0, await A.h.run('saveStateNow()'), A.writes.flat().length === 0), A.writes.flat().join(' '));
check('cambios en un chat NO activo también se detectan (renombrar)', (() => { A.h.run(`state.chats[1].title = 'Dos bis'`); return true; })() && (await A.h.run('saveStateNow()'), A.writes.flat().includes('set:chat:c2')));

console.log('\n3. Una segunda pestaña ve lo mismo y se mantiene al día\n');
const B = tab('B');
await B.h.run('loadState()');
check('B carga los dos chats', JSON.stringify(B.ids().sort()) === '["c1","c2"]', JSON.stringify(B.ids()));
A.h.run(`state.chats[0].messages.push({ role: 'user', content: 'desde A' }); state.chats[0].updatedAt = 3;`);
await A.h.run('saveStateNow()'); await wait();
check('lo que escribe A aparece en B', B.h.run('state.chats[0].messages.length') === 3);

console.log('\n4. Dos pestañas, dos chats nuevos: no se pisan\n');
A.h.run(`state.chats.unshift(${chatDef('cA', 'De A')});`);
B.h.run(`state.chats.unshift(${chatDef('cB', 'De B')});`);
await Promise.all([A.h.run('saveStateNow()'), B.h.run('saveStateNow()')]);
await wait(150);
const onDisk = A.h.run(`1`) && [...mem.keys()].filter(k => k.startsWith('chat:')).sort();
check('en disco están los cuatro', onDisk.join(',') === 'chat:c1,chat:c2,chat:cA,chat:cB', onDisk.join(','));
check('A ve el de B', A.ids().includes('cB') && A.ids().includes('cA'), JSON.stringify(A.ids()));
check('B ve el de A', B.ids().includes('cA') && B.ids().includes('cB'), JSON.stringify(B.ids()));

console.log('\n5. Borrar en una pestaña se refleja en la otra\n');
A.h.run(`state.chats = state.chats.filter(c => c.id !== 'c2');`);
await A.h.run('saveStateNow()'); await wait();
check('el registro se borra del disco', !mem.has('chat:c2'));
check('B deja de mostrarlo', !B.ids().includes('c2'), JSON.stringify(B.ids()));

console.log('\n6. Mientras B genera una respuesta, su chat activo no se pisa\n');
B.h.run(`state.activeChatId = 'c1'; state.isStreaming = true; state.chats.find(c => c.id === 'c1').messages.push({ role: 'assistant', content: 'a medias de B' });`);
A.h.run(`state.chats.find(c => c.id === 'c1').messages.push({ role: 'user', content: 'otro de A' }); state.chats.find(c => c.id === 'c1').updatedAt = 9;`);
await A.h.run('saveStateNow()'); await wait();
check('B conserva su respuesta en curso', B.h.run(`state.chats.find(c => c.id === 'c1').messages.some(m => m.content === 'a medias de B')`));
B.h.run('state.isStreaming = false');

console.log('\n7. Migración desde el registro único antiguo\n');
mem.clear();
const L = tab('L');
// El historial antiguo: un solo registro 'chats' (y 'projects'), con la clave de la bóveda de esta pestaña
await L.h.run(`(async () => {
    idbStore.set('chats', await secretVault.encryptRecord([${chatDef('v1', 'Vieja 1', 'texto-viejo')}, ${chatDef('v2', 'Vieja 2')}]));
    idbStore.set('projects', await secretVault.encryptRecord([{ id: 'general', name: 'General', systemPrompt: '', documents: [] }]));
})()`);
await L.h.run('loadState()'); await wait(200);
check('se leen los dos chats antiguos', JSON.stringify(L.ids().sort()) === '["v1","v2"]', JSON.stringify(L.ids()));
check('se reescriben por chat', mem.has('chat:v1') && mem.has('chat:v2'));
check('y el registro único antiguo desaparece', !mem.has('chats'));

console.log('\n8. Un chat ilegible no se pierde ni se sobrescribe\n');
const raw = mem.get('chat:v2');
mem.set('chat:v2', { __wiaEnc: 'v1', iv: raw.iv, data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]).buffer });
const U = tab('U');
await U.h.run('loadState()');
check('se carga el que sí se puede leer', JSON.stringify(U.ids()) === '["v1"]', JSON.stringify(U.ids()));
U.h.run(`state.chats[0].title = 'Cambiado'`);
await U.h.run('saveStateNow()');
check('el registro ilegible sigue en disco, intacto', mem.has('chat:v2') && mem.get('chat:v2').data.byteLength === 17);
check('y se sigue conservando al guardar otros cambios', (U.h.run(`state.chats[0].title = 'Otra vez'`), await U.h.run('saveStateNow()'), mem.has('chat:v2')));

console.log('\n9. Vaciar el historial\n');
await U.h.run('purgeConversationStore()');
check('no queda ningún registro de conversaciones', [...mem.keys()].every(k => !k.startsWith('chat') && k !== 'projects'), [...mem.keys()].join(','));

if (failures) { console.error(`\n✖ ${failures} comprobaciones fallidas.`); process.exit(1); }
console.log('\n✔ Almacén de conversaciones correcto.');
process.exit(0);
