/**
 * check-syntax — comprueba que todos los ficheros JS parsean.
 *
 * La app son scripts clásicos cargados en orden con ámbito global compartido:
 * un error de sintaxis en cualquiera de ellos aborta ese fichero y deja las
 * variables globales que define sin crear, con lo que la app arranca a medias y
 * falla con un `ReferenceError` lejano y difícil de rastrear. Vale la pena
 * atajarlo antes de desplegar.
 *
 * Uso: npm run check:syntax
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();

const targets = [
    ...readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js')).map((f) => join('js', f)),
    ...readdirSync(join(root, 'scripts')).filter((f) => /\.m?js$/.test(f)).map((f) => join('scripts', f)),
    'secure-gate.js',
    'server.js',
    'sw.js',
    'webgpu-worker.js',
    join('lib', 'anonimae-engine.js'),
    join('Plantilla', 'Version.js'),
];

let failures = 0;
for (const rel of targets) {
    const abs = resolve(root, rel);
    try {
        statSync(abs);
    } catch {
        console.error(`FALTA  ${rel}`);
        failures++;
        continue;
    }
    try {
        execFileSync(process.execPath, ['--check', abs], { stdio: 'pipe' });
        console.log(`OK     ${rel}`);
    } catch (e) {
        console.error(`ERROR  ${rel}`);
        console.error(String(e.stderr || e.message).trim().split('\n').slice(0, 6).join('\n'));
        failures++;
    }
}

// El JSON también: un diccionario o un catálogo mal formado rompe el arranque.
for (const rel of ['agents.json', 'manifest.webmanifest', 'vercel.json', 'package.json',
                   join('lang', 'es.json'), join('lang', 'en.json'), join('lib', 'anonimae-rules.json')]) {
    try {
        JSON.parse(readFileSync(resolve(root, rel), 'utf8'));
        console.log(`OK     ${rel}`);
    } catch (e) {
        console.error(`ERROR  ${rel} — ${e.message}`);
        failures++;
    }
}

console.log(failures === 0 ? '\n✔ Sintaxis correcta en todos los ficheros.' : `\n✖ ${failures} fichero(s) con problemas.`);
process.exitCode = failures === 0 ? 0 : 1;
