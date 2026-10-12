/**
 * test-file-limits — el tope de 10 MB por archivo y el aviso claro al superarlo.
 *
 * Mismo límite en: adjunto del chat, documento de proyecto, ventana del
 * anonimizador y documentos de agentes importados. Al superarlo no se añade nada
 * y el aviso dice qué archivo, cuánto pesa y cuál es el límite.
 *
 * Uso: npm run test:limits
 */
import { createChatHarness, settle } from './harness-chat.mjs';

let failures = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failures++;
};
const MB = 1048576;

const h = createChatHarness({ handler: async () => { throw new Error('sin red'); } });
h.run(`globalThis.__notices = []; notify = (m, k) => { globalThis.__notices.push({ m: String(m), k }); };
       window.pdfjsLib = null;`);
const lastNotice = () => JSON.parse(h.run('JSON.stringify(globalThis.__notices[globalThis.__notices.length - 1] || null)'));
const fakeFile = (name, size, type = 'text/plain', text = 'hola') => ({ name, size, type, arrayBuffer: async () => new ArrayBuffer(0), _text: text });

console.log('1. El límite es de 10 MB\n');
check('MAX_FILE_BYTES vale 10 MB', Number(h.run('MAX_FILE_BYTES')) === 10 * MB);
check('adjunto, documento de proyecto, anonimizador y agentes usan el mismo tope',
    h.run('[MAX_TEXT_ATTACHMENT_BYTES, MAX_PROJECT_DOC_BYTES, ANON_FILE_MAX_BYTES, AGENT_MAX_DOC_BYTES].every(n => n === MAX_FILE_BYTES)') === true);

console.log('\n2. Al superarlo, se avisa con claridad\n');
{
    const big = fakeFile('informe.txt', 12.3 * MB);
    h.run(`globalThis.__r = rejectOversize(${JSON.stringify(big)}, 'attach')`);
    const n = lastNotice();
    check('rejectOversize rechaza y avisa como error', h.run('globalThis.__r') === true && n?.k === 'error');
    check('el aviso nombra el archivo, su peso y el límite', /informe\.txt/.test(n.m) && /12\.3 MB/.test(n.m) && /10\.0 MB/.test(n.m), n.m.replace(/\n/g, ' '));
    check('y dice que no se ha adjuntado', /No se ha adjuntado/.test(n.m));

    h.run(`globalThis.__r = rejectOversize(${JSON.stringify(big)}, 'doc')`);
    const d = lastNotice();
    check('para un documento de proyecto, también', /No se ha añadido/.test(d.m) && /por documento/.test(d.m), d.m);

    h.run(`globalThis.__r = rejectOversize({ name: 'libro.pdf', size: 1000 }, 'doc', ${11 * MB}, true)`);
    const p = lastNotice();
    check('si el PDF cabe pero su texto no, lo dice', /texto extraído de «libro\.pdf»/.test(p.m) && /11\.0 MB/.test(p.m), p.m);

    h.run(`globalThis.__r = rejectOversize({ name: 'ok.txt', size: 10 * 1048576 }, 'attach')`);
    check('justo en el límite (10 MB) se admite', h.run('globalThis.__r') === false);
}

console.log('\n3. El adjunto no entra\n');
{
    h.run(`state.attachments = []; globalThis.__n0 = globalThis.__notices.length;`);
    await h.run(`handleFiles([${JSON.stringify(fakeFile('enorme.txt', 11 * MB))}])`);
    check('un texto de 11 MB no se adjunta', h.run('state.attachments.length') === 0);
    check('y se avisa', h.run('globalThis.__notices.length') > h.run('globalThis.__n0'));
    h.run(`state.attachments = []; globalThis.__n0 = globalThis.__notices.length;`);
    await h.run(`handleFiles([${JSON.stringify(fakeFile('libro.pdf', 11 * MB, 'application/pdf'))}])`);
    check('un PDF de 11 MB tampoco (antes no tenía tope)', h.run('state.attachments.length') === 0 && h.run('globalThis.__notices.length') > h.run('globalThis.__n0'));
}

console.log('\n4. Ventana del anonimizador\n');
{
    const msg = await h.run(`loadAnonToolFile(${JSON.stringify(fakeFile('contrato.txt', 11 * MB))})`);
    check('un archivo de 11 MB devuelve el aviso, con nombre, peso y límite',
        /contrato\.txt/.test(msg) && /11\.0 MB/.test(msg) && /10\.0 MB/.test(msg), msg);
}

console.log('\n5. Agentes importados\n');
{
    const big = 'x'.repeat(10 * MB + 5);
    const r = JSON.parse(h.run(`JSON.stringify(buildAgentFromDefinition({ name: 'A', documents: [{ name: 'grande.txt', data: ${JSON.stringify(big)} }, { name: 'ok.txt', data: 'hola' }] }).warnings)`));
    check('un documento de agente por encima de 10 MB se omite y se dice cuál y por qué',
        r.length === 1 && /grande\.txt/.test(r[0]) && /10\.1 MB/.test(r[0]) && /límite es 10\.0 MB/.test(r[0]), r.join(' | '));
}

await settle();
if (failures) { console.error(`\n✖ ${failures} comprobaciones fallidas.`); process.exit(1); }
console.log('\n✔ Límites de archivo correctos.');
process.exit(0);
