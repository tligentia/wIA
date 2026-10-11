/**
 * test-slash — en el selector de prompts (`/`), Intro lanza el prompt y Tab lo inserta.
 *
 * Uso: npm run test:slash
 */
import { createChatHarness, streamOf, settle } from './harness-chat.mjs';

let failures = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failures++;
};

const sent = [];
const h = createChatHarness({
    handler: async (url, opts) => {
        if (!url.includes('/api/chat')) throw new Error('sin red');
        sent.push(JSON.parse(opts.body).messages.filter((m) => m.role === 'user').map((m) => m.content));
        return streamOf([JSON.stringify({ message: { content: 'ok' }, done: true })]);
    },
});
h.run(`state.settings.provider='ollama'; state.settings.model='m'; state.settings.ollamaUrl='http://localhost:1';
       state.settings.incognitoMode=true; state.incognitoSessionActive=true;`);
const setup = () => h.run(`
    slashState.active = true; slashState.level = 'prompts'; slashState.selectedIndex = 0;
    slashState.items = [{ type: 'prompt', id: 'p1', content: 'Resume este texto en 3 puntos' }, { type: 'category', id: 'c1', name: 'Cat' }];
    dom.messageInput.value = '/res';`);
const key = (k) => h.run(`handleSlashKeydown({ key: '${k}', preventDefault() { this.prevented = true; }, shiftKey: false })`);

console.log('1. Intro lanza el prompt directamente\n');
setup(); key('Enter'); await settle(400);
check('se envía el contenido del prompt', sent.length >= 1 && sent[0].includes('Resume este texto en 3 puntos'), JSON.stringify(sent[0]));
check('la caja queda vacía', h.run('dom.messageInput.value') === '');
check('el selector se cierra', h.run('slashState.active') === false);
check('queda la respuesta en el chat', /ok/.test(h.run('getActiveChat().messages.map(m => m.content).join("|")')));

console.log('\n2. Tab solo inserta, para editar antes\n');
sent.length = 0;
setup(); key('Tab'); await settle(200);
check('el texto queda en la caja', h.run('dom.messageInput.value') === 'Resume este texto en 3 puntos');
check('no se envía nada', sent.length === 0);
check('el selector se cierra', h.run('slashState.active') === false);

console.log('\n3. En una categoría, Intro la abre (no envía)\n');
sent.length = 0;
h.run(`slashState.active = true; slashState.level = 'categories'; slashState.selectedIndex = 1;
       slashState.items = [{ type: 'prompt', id: 'p1', content: 'x' }, { type: 'category', id: 'c1', name: 'Cat' }]; dom.messageInput.value = '/';
       renderSlashPrompts = () => {};`);
key('Enter'); await settle(150);
check('abre la categoría', h.run('slashState.level') === 'prompts' && h.run('slashState.selectedCategoryId') === 'c1');
check('sin enviar nada', sent.length === 0);

console.log('\n4. Un clic sigue insertando (no envía por sorpresa)\n');
setup();
h.run('selectSlashItem(0)'); await settle(150);
check('inserta sin enviar', h.run('dom.messageInput.value') === 'Resume este texto en 3 puntos' && sent.length === 0);

if (failures) { console.error(`\n✖ ${failures} comprobaciones fallidas.`); process.exit(1); }
console.log('\n✔ Selector de prompts correcto.');
process.exit(0);
