/**
 * test-anon-history — con 🕶️ activo NADA sale en claro hacia el motor.
 *
 * Por qué: solo se anonimizaban el mensaje nuevo y el contexto de sistema. Lo
 * escrito antes de activar el modo (o los datos reales que devolviera el modelo)
 * se reenviaba tal cual en cada petición. Aquí se comprueba el cuerpo REAL que
 * llega a cada tipo de motor.
 *
 * Uso: npm run test:anon-history
 */
import { createChatHarness, streamOf, settle, withTimeout } from './harness-chat.mjs';

let failures = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failures++;
};

const SECRET_MAIL = 'juan.perez@example.com';
const SECRET_DNI = '12345678Z';
const NEW_MAIL = 'maria.lopez@example.org';

async function scenario(provider, endpoint, reply) {
    const calls = [];
    const h = createChatHarness({
        handler: async (url, opts) => {
            if (!url.includes(endpoint)) throw new Error('sin red');
            calls.push(JSON.parse(opts.body || '{}'));
            return streamOf(reply);
        },
    });
    h.run('secretVault.available = () => false'); // sin cifrado: lo que se prueba es el contenido enviado
    h.run(`state.settings.provider='${provider}'; state.settings.model='m'; state.settings.ollamaUrl='http://localhost:1/v1';
           state.settings.apiKey='k'; state.settings.incognitoMode=true; state.incognitoSessionActive=true;
           const c=createChat();
           c.messages.push({role:'user',content:'Mi correo es ${SECRET_MAIL} y mi DNI ${SECRET_DNI}'},
                           {role:'assistant',content:'Anotado: ${SECRET_MAIL}.'});
           state.settings.anonymizeOutgoing=true;`);
    const result = await withTimeout(h.run(`sendMessage('Escribe a ${NEW_MAIL} por favor')`));
    await settle();
    return { result, body: JSON.stringify(calls[0] || {}), h };
}

const cases = [
    ['ollama', '/api/chat', [JSON.stringify({ message: { content: 'ok' }, done: true })]],
    ['openai', '/chat/completions', ['data: ' + JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }), 'data: [DONE]']],
];
for (const [provider, endpoint, reply] of cases) {
    console.log(`\n${provider}\n`);
    const r = await scenario(provider, endpoint, reply);
    check('el envío termina', r.result === 'resolved', r.result);
    check('el historial anterior no lleva el email real', !r.body.includes(SECRET_MAIL));
    check('ni el DNI real', !r.body.includes(SECRET_DNI));
    check('ni el email del mensaje nuevo', !r.body.includes(NEW_MAIL));
    check('hay marcadores en su lugar', /\[Email_\d+\]/.test(r.body) && /\[DNI_\d+\]|\[Dni_\d+\]/i.test(r.body));
    const mails = new Set(r.body.match(/\[Email_\d+\]/g) || []);
    check('cada dato distinto tiene su marcador (2 emails → 2 marcadores)', mails.size === 2, [...mails].join(','));
}

console.log('\nsin anonimizador listo no se envía nada en claro\n');
{
    const calls = [];
    const h = createChatHarness({
        handler: async (url, opts) => {
            if (url.includes('/api/chat')) { calls.push(1); return streamOf([JSON.stringify({ message: { content: 'ok' }, done: true })]); }
            throw new Error('sin red');
        },
    });
    h.run(`state.settings.provider='ollama'; state.settings.model='m'; state.settings.ollamaUrl='http://localhost:1';
           state.settings.incognitoMode=true; state.incognitoSessionActive=true; state.settings.anonymizeOutgoing=true;
           _anonRulesPromise = Promise.resolve(null);`); // las reglas "no cargan"
    await withTimeout(h.run(`sendMessage('hola ${SECRET_MAIL}')`));
    await settle();
    check('no hay ninguna petición al motor', calls.length === 0, `peticiones: ${calls.length}`);
}

if (failures) { console.error(`\n✖ ${failures} comprobaciones fallidas.`); process.exit(1); }
console.log('\n✔ Anonimización del historial correcta.');
process.exit(0);
