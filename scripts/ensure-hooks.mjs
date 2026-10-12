/**
 * ensure-hooks — activa los hooks de git del repositorio (.githooks/).
 *
 * `core.hooksPath` es configuración local de cada clon: no viaja con el
 * repositorio. Se ejecuta como `pretest`/`prestart` para que cualquier clon
 * que arranque o pruebe la app quede con el hook de pre-commit (que avanza la
 * versión en cada commit) sin acordarse de `npm run hooks:install`.
 * Silencioso y sin fallos: fuera de git no hace nada.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

try {
    if (!existsSync(resolve('.githooks/pre-commit'))) process.exit(0);
    const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    git('rev-parse', '--is-inside-work-tree');
    let current = '';
    try { current = git('config', '--get', 'core.hooksPath'); } catch { /* sin configurar */ }
    if (current !== '.githooks') {
        git('config', 'core.hooksPath', '.githooks');
        console.log('Hooks de git activados (.githooks): la versión avanzará en cada commit.');
    }
} catch { /* no es un repositorio git o no hay git */ }
