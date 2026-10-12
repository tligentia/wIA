/**
 * test-anon — motor de anonimización (lib/anonimae-engine.js + reglas).
 *
 * Tres cosas que no pueden romperse en silencio:
 *  · lo sensible se sustituye (un dato que se escapa es una fuga);
 *  · lo que NO es sensible se deja en paz (un prompt mutilado no sirve);
 *  · la sustitución es reversible con el mapa, aunque el modelo devuelva los
 *    marcadores con otra forma.
 *
 * Uso: npm run test:anon
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const sandbox = { console }; sandbox.globalThis = sandbox; createContext(sandbox);
runInContext(readFileSync('lib/anonimae-engine.js', 'utf8'), sandbox, { filename: 'anonimae-engine.js' });
const rules = JSON.parse(readFileSync('lib/anonimae-rules.json', 'utf8'));
const { LocalDetectionEngine, LocalPlaceholderEngine } = sandbox;
const engine = new LocalDetectionEngine(rules);

let failures = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failures++;
};
const anon = (text, state = null) => LocalPlaceholderEngine.process(text, engine.detect(text), state);
// Debe desaparecer cada dato sensible indicado.
const hides = (name, text, secrets) => {
    const out = anon(text).anonymizedText;
    const leaked = secrets.filter(s => out.includes(s));
    check(name, leaked.length === 0, leaked.length ? `se escapa «${leaked.join('», «')}» → ${out}` : '');
};
// El texto debe salir intacto.
const keeps = (name, text) => {
    const out = anon(text).anonymizedText;
    check(name, out === text, out === text ? '' : out);
};

console.log('1. Todas las reglas compilan\n');
{
    const broken = [];
    for (const e of rules.entities) for (const p of e.patterns || []) { try { new RegExp(p, 'g'); } catch (err) { broken.push(`${e.id}: ${err.message}`); } }
    check('ninguna expresión regular es inválida', broken.length === 0, broken.join(' | '));
}

console.log('\n2. Datos que deben ocultarse\n');
hides('DNI y NIE', 'Mi DNI es 12345678Z y el NIE X1234567L.', ['12345678Z', 'X1234567L']);
hides('DNI con guion, puntos o espacio', 'DNI 12345678-Z, 12.345.678-Z y 12345678 Z.', ['12345678-Z', '12.345.678', '12345678 Z']);
hides('teléfonos españoles', 'Al 612 345 678, +34 612345678, 91 123 45 67 o 0034 600-11-22-33.', ['612 345 678', '612345678', '91 123 45 67', '600-11-22-33']);
hides('teléfono internacional', 'Londres: +44 20 7946 0958.', ['7946', '+44']);
hides('correo', 'Escribe a maria.garcia+facturas@empresa-ejemplo.es.', ['maria.garcia', 'empresa-ejemplo']);
hides('IBAN español con y sin espacios', 'ES91 2100 0418 4502 0005 1332 y ES9121000418450200051332.', ['2100 0418', '21000418']);
hides('IBAN extranjero completo', 'Alemán: DE89 3704 0044 0532 0130 00.', ['3704', '0532', '0130']);
hides('tarjetas Visa, Mastercard y Amex', 'Visa 4111 1111 1111 1111, MC 5500-0000-0000-0004, Amex 3782 822463 10005.', ['4111', '5500', '822463', '10005']);
hides('nombre del diccionario con apellidos', 'Hablé con Juan Pérez García ayer.', ['Juan', 'Pérez', 'García']);
hides('nombre que no está en el diccionario, por su apellido', 'La paciente Marta Gutiérrez Soler firmó.', ['Gutiérrez', 'Soler']);
hides('nombre introducido por un tratamiento', 'También Dña. Rocío Jurado y el Sr. Bermúdez Ochandiano.', ['Rocío', 'Jurado', 'Bermúdez', 'Ochandiano']);
hides('nombre escrito sin tildes (Jesús → Jesus)', 'Procurador:\nJesus de Pinares', ['Jesus', 'Pinares']);
hides('apellidos sin tildes (García → Garcia)', 'Habló con Maria Garcia Lopez.', ['Maria', 'Garcia', 'Lopez']);
hides('fecha en formato ISO', 'Referencia TS-01 | Fecha 2018-03-15 | Versión 1.0', ['2018-03-15']);
hides('fecha con el mes en letras', 'Firmado el 15 de marzo de 2018 en Madrid.', ['15 de marzo de 2018']);
hides('ciudad que cierra una dirección', 'domicilio simulado Calle Luna 23, Madrid. Inicio y firma', ['Luna 23', 'Madrid']);
hides('ciudad con código postal', 'Avenida del Sol 5, 28001 Madrid', ['Sol 5', '28001', 'Madrid']);
keeps('una ciudad suelta no es un dato personal', 'Referencia colectiva: Comercio del Metal de Madrid.');
keeps('«Marco» en un título no es una persona', 'Partes\nMarco y firmas\nReferencia colectiva');
hides('«Marco» con apellido sí es una persona', 'Firma Marco Antonio Ruiz hoy.', ['Marco', 'Ruiz']);
check('la misma fecha en otra grafía recibe el mismo marcador', (() => {
    const out = anon('Inicio 15/03/2018 y copia 2018-03-15, o el 15 de marzo de 2018.').anonymizedText;
    return (out.match(/\[Fecha_001\]/g) || []).length === 3;
})());
hides('nombre completo escrito todo en minúsculas', 'Nombre: marta rodríguez pérez', ['marta', 'rodríguez', 'pérez']);
hides('minúsculas y sin tildes', 'contacto marta rodriguez perez de la oficina', ['marta', 'rodriguez', 'perez']);
hides('mayúscula solo en el nombre de pila', 'Habló con Marta rodríguez pérez ayer.', ['Marta', 'rodríguez', 'pérez']);
hides('apellidos sin mayúscula tras un nombre bien escrito', 'Marta Rodríguez pérez firmó.', ['Marta', 'Rodríguez', 'pérez']);
keeps('un nombre que también es palabra común no se toma en minúscula', 'la rosa blanca y el mar azul, con luz de sol');
keeps('palabras sueltas de los diccionarios en minúscula no son nombres', 'victoria sierra campos flores romero molina vega');
keeps('prosa en minúsculas queda intacta', 'escribe un correo para el cliente diciendo que la reunión es el martes por la tarde');
check('un nombre no se extiende por un salto de línea',
    anon('Partes\nLaura Fernández López firmó.').anonymizedText.startsWith('Partes\n[Nombre_'),
    anon('Partes\nLaura Fernández López firmó.').anonymizedText);
check('ni arrastra la línea siguiente',
    anon('Juan Pérez\nContrato indefinido').anonymizedText === '[Nombre_001]\nContrato indefinido',
    anon('Juan Pérez\nContrato indefinido').anonymizedText);
hides('nombres del diccionario ampliado', 'Hablé con Wenceslao y con Aitor Etxeberria ayer.', ['Wenceslao', 'Aitor', 'Etxeberria']);
hides('nombres extranjeros', 'Escribió Michael Smith y también Giuseppe Rossi.', ['Michael', 'Smith', 'Giuseppe', 'Rossi']);
keeps('palabras comunes que también son apellidos no se tocan', 'Casado con una vecina de Valencia, vive en el Sur.');
hides('nombre en mayúsculas', 'DON ANTONIO LÓPEZ MARTÍNEZ CON DNI 87654321X.', ['ANTONIO', 'LÓPEZ', 'MARTÍNEZ', '87654321X']);
hides('dirección con piso y código postal', 'Vivo en Calle Mayor 12, 3º B, 28013 Madrid.', ['Mayor 12', '3º', '28013']);
hides('expedientes y diligencias', 'Procedimiento Ordinario 123/2024 y Diligencias Previas nº 987/2022.', ['123/2024', '987/2022']);
hides('matrícula, IP y MAC', 'Coche 1234 BCD, servidor 192.168.1.20, MAC 00:1A:2B:3C:4D:5E.', ['1234 BCD', '192.168.1.20', '1A:2B']);
hides('claves de API de los motores', 'Claves sk-proj-abcdefghijklmnop1234, sk-ant-api03-abcdefghijklmnop_qrst-uv, gsk_abcdefghijklmnopqrstuv, nvapi-abcdefghijklmnopqrstuv y AQ.Ab8RN6abcdefghijklmnopqrstuvw.',
    ['abcdefghijklmnop']);
hides('fecha, Seguridad Social y pasaporte', 'Nació el 03/11/1985, NSS 28/12345678/40, pasaporte PAB123456.', ['03/11/1985', '12345678', 'PAB123456']);
hides('CIF con y sin guion', 'CIF B12345678 y A-28123456.', ['B12345678', '28123456']);

console.log('\n3. Texto que NO debe tocarse\n');
keeps('nombres de modelos y versiones', 'Usamos gpt4omini, COVID19, iPhone15, Windows11 y llama3 en q4f16.');
keeps('cifras corrientes', 'En 2024 facturamos 150000 euros, 30000 unidades y el pedido 123456789 llegó tarde.');
keeps('un curso o temporada no es un expediente', 'La temporada 2023/2024 fue buena.');
keeps('nombres comunes en minúscula', 'Tengo dolores de cabeza, mi meta es el pilar del proyecto y un ángel de la guarda.');
keeps('un número seguido de «y» no es un DNI', 'Fueron 12345678 y luego bajaron.');

console.log('\n4. La forma del resultado\n');
{
    const out = anon('DON ANTONIO LÓPEZ MARTÍNEZ CON DNI 87654321X.').anonymizedText;
    check('el nombre no se traga las palabras que le siguen', out === 'DON [Nombre_001] CON DNI [DNI_001].', out);
    const dir = anon('Oficina: Avda. de la Constitución, nº 4 y Paseo de Gracia 43.').anonymizedText;
    check('dos direcciones seguidas conservan la «y» que las une', dir === 'Oficina: [Direccion_001] y [Direccion_002].', dir);
    const tr = anon('El Sr. Bermúdez llamó.').anonymizedText;
    check('el tratamiento se conserva', tr === 'El Sr. [Nombre_001] llamó.', tr);
}

console.log('\n5. Coherencia de los marcadores\n');
{
    const out = anon('Juan llamó desde el 612345678; el 612 345 678 es de Juan.').anonymizedText;
    check('el mismo dato con otro formato recibe el mismo marcador',
        out === '[Nombre_001] llamó desde el [Telefono_001]; el [Telefono_001] es de [Nombre_001].', out);

    // Estado compartido entre mensajes de un mismo chat.
    const state = { counters: {}, valueToPlaceholder: new Map(), placeholderToValue: {} };
    const a = anon('Escribe a ana@ejemplo.es.', state).anonymizedText;
    const b = anon('Otra vez ana@ejemplo.es y luis@ejemplo.es.', state).anonymizedText;
    check('entre mensajes se reutiliza el marcador y se numeran los nuevos',
        a === 'Escribe a [Email_001].' && b === 'Otra vez [Email_001] y [Email_002].', `${a} / ${b}`);
    check('sin entidades, el mapa del chat no se pierde', anon('Nada sensible aquí.', state).mapping === state.placeholderToValue);
}

console.log('\n6. Restauración\n');
{
    const original = 'Juan Pérez (12345678Z) vive en Calle Mayor 12 y su correo es juan@ejemplo.es.';
    const { anonymizedText, mapping } = anon(original);
    check('ida y vuelta devuelve el texto original', LocalPlaceholderEngine.restore(anonymizedText, mapping) === original,
        LocalPlaceholderEngine.restore(anonymizedText, mapping));
    const map = { '[Nombre_001]': 'Juan Pérez', '[Email_001]': 'juan@ejemplo.es' };
    check('acepta el marcador en mayúsculas', LocalPlaceholderEngine.restore('Hola [NOMBRE_001]', map) === 'Hola Juan Pérez');
    check('acepta el marcador escapado como Markdown', LocalPlaceholderEngine.restore('Hola \\[Nombre\\_001\\]', map) === 'Hola Juan Pérez');
    check('acepta espacios dentro de los corchetes', LocalPlaceholderEngine.restore('Hola [ Nombre_001 ]', map) === 'Hola Juan Pérez');
    check('un marcador desconocido se deja como está', LocalPlaceholderEngine.restore('Hola [Nombre_009]', map) === 'Hola [Nombre_009]');
    check('los corchetes normales no se tocan', LocalPlaceholderEngine.restore('lista[0] y [ver nota]', map) === 'lista[0] y [ver nota]');
}

console.log('\n7. Rendimiento\n');
{
    const big = 'Reunión con Marta Gutiérrez Soler (DNI 12345678Z, tel. 612 345 678) en Calle Mayor 12, 28013 Madrid. '.repeat(1500);
    const t0 = performance.now();
    const n = engine.detect(big).length;
    const ms = performance.now() - t0;
    check(`un documento de ${Math.round(big.length / 1024)} KB se analiza en menos de 3 s`, ms < 3000, `${Math.round(ms)} ms, ${n} entidades`);
}

console.log(failures === 0 ? '\n✔ Anonimización correcta.' : `\n✖ ${failures} fallo(s).`);
process.exitCode = failures === 0 ? 0 : 1;
