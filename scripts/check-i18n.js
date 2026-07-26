/* ============================================
   wIA — scripts/check-i18n.js
   Valida que todos los diccionarios de lang/*.json:
     1) sean JSON válido,
     2) tengan EXACTAMENTE el mismo conjunto de claves.
   Toma es.json como referencia y reporta, por cada idioma,
   las claves que faltan y las que sobran.
   Uso:  node scripts/check-i18n.js
   Sale con código 1 si hay discrepancias (útil en CI / pre-commit).
   ============================================ */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const LANG_DIR = resolve('lang');
const REFERENCE = 'es'; // idioma base contra el que se comparan los demás

function loadDict(lang) {
  const path = join(LANG_DIR, `${lang}.json`);
  try {
    const dict = JSON.parse(readFileSync(path, 'utf8'));
    if (dict === null || typeof dict !== 'object' || Array.isArray(dict)) {
      throw new Error('el JSON debe ser un objeto de pares clave→texto');
    }
    return dict;
  } catch (e) {
    console.error(`✖ lang/${lang}.json — ${e.message}`);
    process.exit(1);
  }
}

// Descubre los idiomas disponibles a partir de los ficheros lang/*.json.
const langs = readdirSync(LANG_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''));

if (!langs.includes(REFERENCE)) {
  console.error(`✖ Falta el idioma de referencia: lang/${REFERENCE}.json`);
  process.exit(1);
}

const dicts = Object.fromEntries(langs.map((l) => [l, loadDict(l)]));
const refKeys = Object.keys(dicts[REFERENCE]).sort();
const refSet = new Set(refKeys);

let problems = 0;
console.log(`Referencia: lang/${REFERENCE}.json (${refKeys.length} claves)\n`);

for (const lang of langs) {
  if (lang === REFERENCE) continue;
  const keys = new Set(Object.keys(dicts[lang]));
  const missing = refKeys.filter((k) => !keys.has(k));          // están en es, faltan aquí
  const extra = [...keys].filter((k) => !refSet.has(k)).sort();  // sobran respecto a es
  // Cadenas vacías: existen pero sin traducir.
  const empty = refKeys.filter((k) => keys.has(k) && String(dicts[lang][k]).trim() === '');

  if (!missing.length && !extra.length && !empty.length) {
    console.log(`✔ lang/${lang}.json — ${keys.size} claves, en paridad con ${REFERENCE}`);
    continue;
  }
  problems++;
  console.log(`✖ lang/${lang}.json`);
  if (missing.length) console.log(`   Faltan (${missing.length}): ${missing.join(', ')}`);
  if (extra.length)   console.log(`   Sobran (${extra.length}): ${extra.join(', ')}`);
  if (empty.length)   console.log(`   Vacías (${empty.length}): ${empty.join(', ')}`);
}

if (problems) {
  console.error(`\n${problems} idioma(s) con discrepancias. Corrige los JSON de lang/.`);
  process.exit(1);
}
console.log('\nTodos los idiomas están en paridad. ✅');

/* ── Cobertura real ─────────────────────────────────────────────────────────
   La paridad entre los dos JSON no dice nada sobre cuánta interfaz está
   traducida: se puede tener 129 claves idénticas en ambos idiomas y la mitad de
   la aplicación en español fijo. Estas dos comprobaciones miden lo que importa:

   1) Claves declaradas en el HTML/JS que NO existen en el diccionario → el
      usuario vería la clave en crudo o el texto sin traducir. Es un ERROR.
   2) Claves del diccionario que ya nadie usa → ruido que arrastrar. Es un AVISO.
   3) Cuántos nodos del HTML llevan marca de traducción → indicador de avance.
     ────────────────────────────────────────────────────────────────────────── */
const html = readFileSync(resolve('index.html'), 'utf8');
const jsDir = resolve('js');
const jsSources = readdirSync(jsDir)
  .filter((f) => f.endsWith('.js'))
  .map((f) => ({ file: `js/${f}`, code: readFileSync(join(jsDir, f), 'utf8') }));

const usedKeys = new Map(); // clave → orígenes
const addUsed = (key, origin) => {
  if (!usedKeys.has(key)) usedKeys.set(key, new Set());
  usedKeys.get(key).add(origin);
};

// Atributos data-i18n / data-i18n-html / data-i18n-title / data-i18n-ph
let i18nNodes = 0;
for (const m of html.matchAll(/data-i18n(?:-html|-title|-ph)?\s*=\s*"([^"]+)"/g)) {
  addUsed(m[1], 'index.html');
  i18nNodes++;
}
// Llamadas t('clave') en el JS, incluidos los envoltorios locales tr() y _tr().
for (const { file, code } of jsSources) {
  for (const m of code.matchAll(/\b_?tr?\(\s*'([^']+)'/g)) addUsed(m[1], file);
  for (const m of code.matchAll(/\b_?tr?\(\s*"([^"]+)"/g)) addUsed(m[1], file);
}

const undeclared = [...usedKeys.keys()]
  // Solo interesan las cadenas con forma de clave (`grupo.subclave`): el patrón
  // de llamada también captura argumentos sueltos de otras funciones de una letra.
  .filter((k) => /^[a-z][\w]*(\.[\w]+)+$/i.test(k) && !refSet.has(k))
  .sort();

// Para las claves huérfanas se busca el literal en TODO el código fuente, no
// solo en las llamadas reconocidas: muchas se pasan por variable, dentro de un
// ternario o vía un envoltorio, y contarlas como no usadas sería un falso aviso.
const allSource = html + '\n' + jsSources.map((s) => s.code).join('\n');
const unused = refKeys.filter((k) => !usedKeys.has(k) && !allSource.includes(`'${k}'`) && !allSource.includes(`"${k}"`));

// Nodos de texto del HTML sin marcar: aproximación del trabajo pendiente.
const translatableNodes = (html.match(/<(?:h[1-6]|p|span|label|button|summary|option|legend|th)\b/g) || []).length;

console.log('\n── Cobertura ──');
console.log(`Claves en uso: ${usedKeys.size} de ${refKeys.length} declaradas.`);
console.log(`Nodos del HTML con marca de traducción: ${i18nNodes} (de ~${translatableNodes} elementos con texto).`);

if (unused.length) {
  console.log(`\n⚠ Claves declaradas que ya nadie usa (${unused.length}): ${unused.join(', ')}`);
}

if (undeclared.length) {
  console.error(`\n✖ Claves usadas que NO están en lang/${REFERENCE}.json (${undeclared.length}):`);
  for (const key of undeclared) {
    console.error(`   · ${key}  ←  ${[...usedKeys.get(key)].join(', ')}`);
  }
  console.error('\nAñádelas a todos los diccionarios o corrige la referencia.');
  process.exit(1);
}

console.log('\nTodas las claves usadas están declaradas. ✅');

/* ── Documentación (lang/docs/*.json) ───────────────────────────────────────
   El contenido del manual vive fuera del código, igual que las cadenas. Aquí se
   comprueba que los dos idiomas describan LA MISMA documentación: mismas
   secciones, en el mismo orden y sin huecos. Un desajuste significa que alguien
   añadió una sección en un idioma y se olvidó del otro.
   ────────────────────────────────────────────────────────────────────────── */
const DOCS_DIR = join(LANG_DIR, 'docs');
let docsProblems = 0;
const docPacks = {};

for (const lang of langs) {
  const path = join(DOCS_DIR, `${lang}.json`);
  try {
    const pack = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(pack.sections)) throw new Error('falta el array «sections»');
    if (!String(pack.footNote || '').trim()) throw new Error('falta «footNote»');
    const bad = pack.sections.filter((s) => !s || !s.id || !String(s.title || '').trim() || !String(s.html || '').trim());
    if (bad.length) throw new Error(`${bad.length} sección(es) sin id, título o contenido`);
    docPacks[lang] = pack;
  } catch (e) {
    console.error(`✖ lang/docs/${lang}.json — ${e.message}`);
    docsProblems++;
  }
}

if (!docsProblems) {
  const refIds = docPacks[REFERENCE].sections.map((s) => s.id);
  for (const lang of langs) {
    if (lang === REFERENCE) continue;
    const ids = docPacks[lang].sections.map((s) => s.id);
    if (ids.join('|') === refIds.join('|')) {
      console.log(`✔ lang/docs/${lang}.json — ${ids.length} secciones, en paridad con ${REFERENCE}`);
      continue;
    }
    docsProblems++;
    const missing = refIds.filter((id) => !ids.includes(id));
    const extra = ids.filter((id) => !refIds.includes(id));
    console.error(`✖ lang/docs/${lang}.json`);
    if (missing.length) console.error(`   Faltan secciones: ${missing.join(', ')}`);
    if (extra.length) console.error(`   Sobran secciones: ${extra.join(', ')}`);
    if (!missing.length && !extra.length) console.error('   Mismas secciones pero en orden distinto.');
  }
}

if (docsProblems) {
  console.error('\nLa documentación no está en paridad entre idiomas.');
  process.exit(1);
}
console.log('Documentación en paridad entre idiomas. ✅');
