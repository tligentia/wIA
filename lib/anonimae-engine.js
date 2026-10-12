/**
 * AnonimAE Client-Side Autonomous Detection & Placeholder Engines
 * Implements regex patterns matching and dictionary lookups, matching the Node.js backend.
 *
 * Copia mantenida en wIA. Cambios respecto al motor original (2026-10):
 *  · los diccionarios de nombres, apellidos y organizaciones solo casan con la
 *    palabra en Mayúscula inicial o en MAYÚSCULAS («Dolores», no «dolores de
 *    cabeza»; «Meta», no «mi meta»);
 *  · diccionario de apellidos: un apellido conocido arrastra el nombre que lleva
 *    delante y los apellidos que le siguen;
 *  · la extensión de un nombre se detiene en palabras que no son de un nombre
 *    («CON», «DNI»…) y tiene tope, para no tragarse una frase en mayúsculas;
 *  · un mismo dato escrito con otro formato («612345678» / «612 345 678») recibe
 *    el mismo marcador;
 *  · `restore` deshace los marcadores aunque el modelo los devuelva en otra caja
 *    o escapados como Markdown;
 *  · los diccionarios casan sin distinguir tildes («Jesus» = «Jesús», «Garcia» =
 *    «García»): a mano casi nadie las pone;
 *  · un nombre no se extiende a través de un salto de línea: «Partes\nLaura
 *    Fernández» ya no arrastra «Partes»;
 *  · los diccionarios se consultan por palabra (Set) y no con una alternación de
 *    miles de ramas: el coste ya no crece con el tamaño del diccionario;
 *  · `rules.customTerms`: términos propios del usuario ({text, type}), que se
 *    anonimizan siempre (sin distinguir mayúsculas ni tildes) y ganan los empates.
 */

const NAME_LETTERS_UP = 'A-ZÁÉÍÓÚÜÑÏÇÀÈÒ';
const NAME_LETTERS_LOW = 'a-záéíóúüñïçàèò';

// Pliega las vocales con tilde o diéresis a la vocal simple (1 carácter ↔ 1 carácter, así
// que las posiciones del texto plegado valen para el original). La ñ y la ç se conservan.
const ACCENT_FOLD = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', à: 'a', è: 'e', ò: 'o',
  Á: 'A', É: 'E', Í: 'I', Ó: 'O', Ú: 'U', Ü: 'U', À: 'A', È: 'E', Ò: 'O' };
function foldAccents(text) {
  return String(text).replace(/[áéíóúüàèòÁÉÍÓÚÜÀÈÒ]/g, (c) => ACCENT_FOLD[c]);
}

// Palabras que pueden ir en mayúscula tras un nombre y NO forman parte de él.
const NAME_STOPWORDS = new Set([
  'con', 'dni', 'nie', 'nif', 'cif', 'en', 'por', 'para', 'sin', 'que', 'el', 'la', 'los', 'las',
  'un', 'una', 'su', 'sus', 'al', 'a', 'e', 'o', 'u', 'ni', 'se', 'es', 'ha', 'ya', 'no', 'sí', 'si',
  'como', 'cuando', 'donde', 'calle', 'avenida', 'avda', 'plaza', 'paseo', 'tel', 'teléfono',
  'telefono', 'email', 'correo', 'domicilio', 'nacido', 'nacida', 'vecino', 'vecina', 'mayor',
  'titular', 'pasaporte', 'iban', 'cuenta', 'expediente', 'procedimiento', 'autos', 'diligencias',
  'señor', 'señora', 'don', 'doña', 'dr', 'dra', 'sr', 'sra', 'srta', 'contra', 'desde', 'hasta',
  'según', 'segun', 'entre', 'sobre', 'tras', 'ante', 'bajo', 'hola', 'estimado', 'estimada',
  'querido', 'querida', 'paciente', 'cliente', 'doctor', 'doctora', 'letrado', 'letrada',
  'abogado', 'abogada', 'juez', 'jueza', 'profesor', 'profesora', 'director', 'directora',
  'hoy', 'ayer', 'mañana', 'gracias', 'saludos', 'atentamente', 'asunto', 'fecha', 'firma',
]);

// Categoría de marcador de cada tipo de término propio ([Nombre_001], [Empresa_001]…).
const CUSTOM_TERM_TYPES = { nombre: 'Nombre', empresa: 'Empresa', direccion: 'Direccion', dato: 'Dato' };

// Nombres de pila que también son palabras comunes («rosa», «luz», «mar»…): en
// minúscula NO cuentan como nombre; solo con mayúscula inicial o en MAYÚSCULAS.
const COMMON_WORD_NAMES = new Set([
  'rosa', 'luz', 'sol', 'paz', 'mar', 'pilar', 'mercedes', 'angeles', 'nieves', 'amparo', 'consuelo',
  'esperanza', 'dolores', 'victoria', 'gloria', 'salud', 'caridad', 'cruz', 'estrella', 'rocio',
  'alba', 'aurora', 'blanca', 'flor', 'candela', 'socorro', 'remedios', 'milagros', 'soledad',
  'concepcion', 'encarnacion', 'asuncion', 'trinidad', 'fe', 'marina', 'violeta', 'azucena',
  'margarita', 'jazmin', 'olivia', 'perla', 'ines', 'clara', 'lola', 'sagrario', 'iris', 'maximo',
  'amor', 'ramon', 'jordi', 'andres', 'pau', 'pol', 'abel', 'adan', 'cesar', 'felix', 'noel', 'rey',
]);

// Cuántas palabras de nombre se añaden como mucho al nombre encontrado.
const MAX_NAME_EXTRA_WORDS = 4;

function extendSpanishName(text, start, initialEnd, rules = null) {
  let currentEnd = initialEnd;
  // Matches spaces, optional particles (de, del, de la, de los, y), and captures the capitalized word (supporting dieresis, cedillas, grave accents)
  const surnameRegex = new RegExp(`^(?:[ \\t]+(?:de[ \\t]+la[ \\t]+|de[ \\t]+los[ \\t]+|de[ \\t]+|del[ \\t]+|y[ \\t]+)?([${NAME_LETTERS_UP}][${NAME_LETTERS_UP}${NAME_LETTERS_LOW}-]+))`);

  const firstWord = text.substring(start, initialEnd).trim();
  const isAllCaps = firstWord === firstWord.toUpperCase() && new RegExp(`[${NAME_LETTERS_UP}]`).test(firstWord);

  let added = 0;
  while (added < MAX_NAME_EXTRA_WORDS) {
    const remainingText = text.substring(currentEnd);
    const match = remainingText.match(surnameRegex);
    if (!match) break;
    const surnameWord = match[1];

    // «CON», «DNI», «Calle»…: ahí termina el nombre.
    if (NAME_STOPWORDS.has(surnameWord.toLowerCase())) break;

    // If it's a known organization, stop extending!
    if (rules && rules.dictionaries && rules.dictionaries.organizaciones) {
      const orgs = rules.dictionaries.organizaciones;
      if (orgs.some(org => org.toLowerCase() === surnameWord.toLowerCase())) break;
    }

    // If it's in all-caps and >= 3 characters (e.g. ACME, BBVA), it's likely an organization, stop!
    // But do not stop if the name itself was all-caps (indicating uppercase context)
    if (!isAllCaps && surnameWord === surnameWord.toUpperCase() && surnameWord.length >= 3) break;

    currentEnd += match[0].length;
    added++;
  }
  return currentEnd;
}

// Retrocede desde un apellido para incluir el nombre de pila que lleva delante
// («Marta» en «Marta Gutiérrez»), como mucho dos palabras con mayúscula inicial.
function extendNameBackwards(text, start) {
  const wordBefore = new RegExp(`([${NAME_LETTERS_UP}][${NAME_LETTERS_UP}${NAME_LETTERS_LOW}-]+)[ \\t]+$`);
  let currentStart = start;
  for (let i = 0; i < 2; i++) {
    const match = text.substring(0, currentStart).match(wordBefore);
    if (!match || NAME_STOPWORDS.has(match[1].toLowerCase())) break;
    currentStart -= match[0].length;
  }
  return currentStart;
}

class LocalDetectionEngine {
  constructor(rulesJson) {
    this.rules = rulesJson || { entities: [], dictionaries: {} };
    this._dictRegexCache = {};
  }

  // Índice por diccionario: las palabras sueltas van a un Set (consulta O(1) por
  // palabra del texto) y las que llevan espacios o signos, a una alternación.
  _dictionaryIndex(dictKey, words) {
    if (this._dictRegexCache[dictKey]) return this._dictRegexCache[dictKey];
    const boundary = `a-zA-Z0-9${NAME_LETTERS_LOW}${NAME_LETTERS_UP}`;
    const singles = new Set();
    const multi = [];
    for (const raw of words) {
      const w = foldAccents(String(raw || '').trim());
      if (!w) continue;
      if (new RegExp(`[^${boundary}]`).test(w)) multi.push(w.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
      else singles.add(w.toLowerCase());
    }
    multi.sort((x, y) => y.length - x.length);
    const multiRegex = multi.length
      ? new RegExp(`(?<=^|[^${boundary}])(?:${multi.join('|')})(?=$|[^${boundary}])`, 'gi')
      : null;
    return (this._dictRegexCache[dictKey] = {
      singles, multiRegex,
      tokenRegex: new RegExp(`[${boundary}]+`, 'g'),
    });
  }

  // Posiciones {index, length} de las palabras del diccionario en el texto plegado.
  _dictionaryMatches(dictKey, words, folded) {
    const idx = this._dictionaryIndex(dictKey, words);
    const found = [];
    idx.tokenRegex.lastIndex = 0;
    let t;
    while ((t = idx.tokenRegex.exec(folded)) !== null) {
      if (idx.singles.has(t[0].toLowerCase())) found.push({ index: t.index, length: t[0].length });
    }
    if (idx.multiRegex) {
      idx.multiRegex.lastIndex = 0;
      let m;
      while ((m = idx.multiRegex.exec(folded)) !== null) {
        if (m.index === idx.multiRegex.lastIndex) idx.multiRegex.lastIndex++;
        found.push({ index: m.index, length: m[0].length });
      }
    }
    return found;
  }

  /**
   * Nombres escritos a mano sin mayúsculas («marta rodríguez pérez») o con ellas
   * a medias («Marta rodríguez pérez»). Las mayúsculas son lo que evita mutilar
   * texto normal, así que aquí se pide más: una racha de palabras seguidas (con
   * «de», «del», «de la», «y» entre medias) que empiece por un nombre de pila del
   * diccionario —que no sea además una palabra común— y siga con nombres o
   * apellidos del diccionario, al menos dos palabras en total. Solo se devuelve
   * lo que no estaría cubierto por la detección normal (rachas con minúsculas).
   */
  _lowercaseNameRuns(text, folded) {
    const dicts = this.rules.dictionaries || {};
    if (!Array.isArray(dicts.nombres) || !Array.isArray(dicts.apellidos)) return [];
    const nombres = this._dictionaryIndex('nombres', dicts.nombres).singles;
    const apellidos = this._dictionaryIndex('apellidos', dicts.apellidos).singles;
    if (!this._foldedStopwords) this._foldedStopwords = new Set([...NAME_STOPWORDS].map(w => foldAccents(w).toLowerCase()));
    const stop = this._foldedStopwords;

    const tokens = [];
    const re = new RegExp(`[a-zA-Z${NAME_LETTERS_LOW}${NAME_LETTERS_UP}]+`, 'g');
    let m;
    while ((m = re.exec(folded)) !== null) tokens.push({ w: m[0].toLowerCase(), s: m.index, e: m.index + m[0].length });

    const isUpper = (tok) => { const c = text.charAt(tok.s); return c !== c.toLowerCase(); };
    const gapOk = (a, b) => /^[ \t]+$/.test(folded.slice(a.e, b.s));
    const isPerson = (tok) => (nombres.has(tok.w) || apellidos.has(tok.w)) && !stop.has(tok.w);
    const out = [];

    for (let i = 0; i < tokens.length; i++) {
      const first = tokens[i];
      if (!nombres.has(first.w) || stop.has(first.w)) continue;
      if (!isUpper(first) && COMMON_WORD_NAMES.has(first.w)) continue;
      const part = [first];
      let j = i;
      while (part.length < 5 && j + 1 < tokens.length) {
        let k = j + 1;
        if (!gapOk(tokens[j], tokens[k])) break;
        // partícula(s): «de», «del», «de la», «de los», «y»
        let q = k;
        const w = tokens[q].w;
        if (w === 'de' && q + 1 < tokens.length && (tokens[q + 1].w === 'la' || tokens[q + 1].w === 'los') && gapOk(tokens[q], tokens[q + 1])) q += 1;
        if (['de', 'del', 'y'].includes(w) || q !== k) {
          if (q + 1 >= tokens.length || !gapOk(tokens[q], tokens[q + 1])) break;
          q += 1;
        } else q = k;
        if (!isPerson(tokens[q])) break;
        part.push(tokens[q]);
        j = q;
      }
      if (part.length < 2) continue;
      const last = part[part.length - 1];
      // Solo si hay minúsculas: las rachas con mayúscula ya las resuelve la detección normal.
      const hasLower = part.some(tok => !isUpper(tok));
      if (!hasLower) { i = tokens.indexOf(last); continue; }
      out.push({
        id: 'nombre', name: 'Nombre', placeholder: 'Nombre',
        text: text.substring(first.s, last.e), start: first.s, end: last.e,
      });
      i = tokens.indexOf(last);
    }
    return out;
  }

  // Términos propios del usuario: una expresión por categoría de marcador.
  _customTermMatches(text, folded) {
    const terms = Array.isArray(this.rules.customTerms) ? this.rules.customTerms : [];
    if (!terms.length) return [];
    if (!this._customIndex) {
      const boundary = `a-zA-Z0-9${NAME_LETTERS_LOW}${NAME_LETTERS_UP}`;
      const byType = new Map();
      for (const t of terms) {
        const raw = foldAccents(String((t && t.text) || '').trim());
        if (raw.length < 2) continue;
        const placeholder = CUSTOM_TERM_TYPES[t.type] || CUSTOM_TERM_TYPES.dato;
        const pattern = raw.split(/\s+/).map(w => w.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')).join('[ \\t]+');
        if (!byType.has(placeholder)) byType.set(placeholder, []);
        byType.get(placeholder).push(pattern);
      }
      this._customIndex = [...byType].map(([placeholder, patterns]) => ({
        placeholder,
        regex: new RegExp(`(?<=^|[^${boundary}])(?:${patterns.sort((x, y) => y.length - x.length).join('|')})(?=$|[^${boundary}])`, 'gi'),
      }));
    }
    const out = [];
    for (const { placeholder, regex } of this._customIndex) {
      regex.lastIndex = 0;
      let m;
      while ((m = regex.exec(folded)) !== null) {
        if (m.index === regex.lastIndex) regex.lastIndex++;
        out.push({
          id: 'termino_propio', name: 'Término propio', placeholder,
          text: text.substring(m.index, m.index + m[0].length),
          start: m.index, end: m.index + m[0].length,
        });
      }
    }
    return out;
  }

  /**
   * Scans text to find all sensitive entities based on active rules.
   * Handles both regex patterns and dictionary matching.
   * Resolves overlaps (longest-match-first strategy).
   * @param {string} text
   * @returns {Array<Object>} Found entities
   */
  detect(text) {
    if (!text) return [];

    const matches = [];
    // Texto sin tildes (mismas posiciones que el original) para diccionarios y términos propios.
    const folded = foldAccents(text);

    // 1. Process Regex Rules
    if (this.rules.entities) {
      for (const entity of this.rules.entities) {
        if (entity.type === 'regex' && entity.patterns) {
          for (const patternStr of entity.patterns) {
            try {
              const flags = entity.caseSensitive ? 'g' : 'gi';
              const regex = new RegExp(patternStr, flags);
              let match;
              while ((match = regex.exec(text)) !== null) {
                // Avoid infinite loops for zero-width matches
                if (match.index === regex.lastIndex) {
                  regex.lastIndex++;
                }

                // Custom validation for passport rule to prevent matching common short words case-insensitively
                if (entity.id === 'pasaporte') {
                  const val = match[0];
                  const hasDigit = /\d/.test(val);
                  const hasLetter = /[a-zA-Z]/.test(val);
                  if (val.length < 6 || !hasDigit || !hasLetter) {
                    continue; // Skip false positive
                  }
                }

                const rawText = match[0];
                const leadingWhitespace = rawText.match(/^\s+/)?.[0].length || 0;
                const trailingWhitespace = rawText.match(/\s+$/)?.[0].length || 0;
                const cleanText = rawText.slice(leadingWhitespace, rawText.length - trailingWhitespace);
                if (!cleanText) continue;

                matches.push({
                  id: entity.id,
                  name: entity.name,
                  placeholder: entity.placeholder,
                  text: cleanText,
                  start: match.index + leadingWhitespace,
                  end: match.index + rawText.length - trailingWhitespace
                });
              }
            } catch (e) {
              console.error(`Invalid regex pattern for entity ${entity.id}: ${patternStr}`, e);
            }
          }
        }
      }
    }

    // 1b. Términos propios del usuario (van antes que los diccionarios: ganan los empates).
    matches.push(...this._customTermMatches(text, folded));

    // 2. Process Dictionary Rules
    if (this.rules.dictionaries) {
      for (const [dictKey, words] of Object.entries(this.rules.dictionaries)) {
        if (!Array.isArray(words)) continue;

        let friendlyName = dictKey.charAt(0).toUpperCase() + dictKey.slice(1);
        let placeholderType = 'Dict';
        let entityId = `dict_${dictKey}`;

        const isPersonDict = dictKey === 'nombres' || dictKey === 'apellidos';
        if (isPersonDict) {
          friendlyName = 'Nombre';
          placeholderType = 'Nombre';
          entityId = 'nombre';
        } else if (dictKey === 'organizaciones') {
          friendlyName = 'Organización';
          placeholderType = 'Empresa';
          entityId = 'organizacion';
        }
        // Nombres propios: solo con Mayúscula inicial (o todo en MAYÚSCULAS).
        const requireCapital = isPersonDict || dictKey === 'organizaciones';

        // Se busca sobre el texto sin tildes (mismas posiciones que el original).
        for (const found of this._dictionaryMatches(dictKey, words, folded)) {
          if (requireCapital) {
            const first = text.charAt(found.index);
            if (first === first.toLowerCase()) continue;
          }

          let finalStart = found.index;
          let finalEnd = found.index + found.length;

          if (dictKey === 'nombres') {
            // 1. Backwards Initial Resolution (e.g. "B GERDA" -> captures "B ")
            const precedingText = text.substring(0, finalStart);
            const initialRegex = /(?:^|[^a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑÏïçÇ])([A-ZÁÉÍÓÚÜÏÇÀÈÒ]\.?[ \t]+)$/;
            const initialMatch = precedingText.match(initialRegex);
            if (initialMatch) {
              finalStart -= initialMatch[1].length;
            }
          } else if (dictKey === 'apellidos') {
            finalStart = extendNameBackwards(text, finalStart);
          }
          if (isPersonDict) {
            // Forwards Surname Look-ahead Extension (e.g. "GERDA" -> extends over "HEIDER GREÏNER")
            finalEnd = extendSpanishName(text, finalStart, finalEnd, this.rules);
          }

          matches.push({
            id: entityId,
            name: friendlyName,
            placeholder: placeholderType,
            text: text.substring(finalStart, finalEnd),
            start: finalStart,
            end: finalEnd
          });
        }
      }
    }

    // 2b. Nombres escritos (en parte) en minúscula: racha de nombre + apellidos.
    matches.push(...this._lowercaseNameRuns(text, folded));

    // 3. Resolve Overlaps (Longest match wins, tie breaks with earlier start)
    matches.sort((a, b) => {
      if (a.start !== b.start) {
        return a.start - b.start;
      }
      return (b.end - b.start) - (a.end - a.start);
    });

    const nonOverlappingMatches = [];
    let lastActiveEnd = -1;

    for (const current of matches) {
      if (current.start >= lastActiveEnd) {
        // No overlap
        nonOverlappingMatches.push(current);
        lastActiveEnd = current.end;
      }
    }

    return nonOverlappingMatches;
  }
}

// Categorías cuyo valor es un identificador: espacios, puntos y guiones son
// formato, no contenido («612 345 678» y «612345678» son el mismo teléfono).
const IDENTIFIER_CATEGORIES = new Set(['telefono', 'dni', 'iban', 'tarjeta', 'segsocial', 'cif', 'fax', 'matricula']);

class LocalPlaceholderEngine {
  /**
   * Clave con la que se reconoce un valor ya visto dentro de una categoría.
   */
  static keyFor(category, value) {
    // Sin tildes: «José» y «Jose» (o «Galáctica» y «GALACTICA») son el mismo dato.
    const normalized = foldAccents(String(value ?? '').trim().toLowerCase()).replace(/\s+/g, ' ');
    return IDENTIFIER_CATEGORIES.has(String(category || '').toLowerCase())
      ? normalized.replace(/[\s.\-]/g, '')
      : normalized;
  }

  /** Categoría de un marcador: «[Telefono_001]» → «Telefono». */
  static categoryOf(placeholder) {
    return String(placeholder || '').match(/^\[(.+)_\d+\]$/)?.[1] || '';
  }

  /**
   * Replaces detected entities in text with consistent placeholders and produces the mapping.
   * @param {string} text Original input text
   * @param {Array<Object>} entities List of non-overlapping detected entities
   * @returns {Object} { anonymizedText: string, mapping: Object }
   */
  static process(text, entities, state = null) {
    if (!text) return { anonymizedText: '', mapping: {} };
    if (!entities || entities.length === 0) return { anonymizedText: text, mapping: state ? state.placeholderToValue : {} };

    const counters = state ? state.counters : {};
    const valueToPlaceholder = state ? state.valueToPlaceholder : new Map();
    const placeholderToValue = state ? state.placeholderToValue : {};
    const keyOf = (entity) => LocalPlaceholderEngine.keyFor(entity.placeholder || 'Entity', entity.text);

    // Sort entities descending by start index to replace from right to left
    const sortedEntitiesDesc = [...entities].sort((a, b) => b.start - a.start);

    // Establish consistent placeholders in ascending order first
    const sortedEntitiesAsc = [...entities].sort((a, b) => a.start - b.start);
    for (const entity of sortedEntitiesAsc) {
      const originalValue = entity.text;
      const key = keyOf(entity);

      if (!valueToPlaceholder.has(key)) {
        const category = entity.placeholder || 'Entity';
        counters[category] = (counters[category] || 0) + 1;

        const padNum = String(counters[category]).padStart(3, '0');
        const placeholder = `[${category}_${padNum}]`;

        valueToPlaceholder.set(key, placeholder);
        placeholderToValue[placeholder] = originalValue;
      }
    }

    // Replace in text using descending order
    let anonymizedText = text;
    for (const entity of sortedEntitiesDesc) {
      const placeholder = valueToPlaceholder.get(keyOf(entity));

      if (placeholder) {
        anonymizedText =
          anonymizedText.substring(0, entity.start) +
          placeholder +
          anonymizedText.substring(entity.end);
      }
    }

    return {
      anonymizedText,
      mapping: placeholderToValue
    };
  }

  /**
   * Deshace los marcadores de un texto con el mapa dado.
   *
   * Los modelos no siempre devuelven el marcador tal cual: lo pasan a
   * mayúsculas («[NOMBRE_001]»), le meten espacios o lo escapan como Markdown
   * («\[Nombre\_001\]»). Se aceptan esas variantes; un marcador que no está en
   * el mapa se deja como está.
   */
  static restore(text, mapping) {
    if (!text || !mapping || text.indexOf('[') === -1) return text;
    const byLower = {};
    for (const [placeholder, value] of Object.entries(mapping)) byLower[placeholder.toLowerCase()] = value;
    return text.replace(/\\?\[\s*([A-Za-zÁÉÍÓÚÑáéíóúñ]+)\\?_(\d{3,})\s*\\?\]/g, (whole, category, number) => {
      const value = byLower[`[${category}_${number}]`.toLowerCase()];
      return value !== undefined ? value : whole;
    });
  }
}

// Expose globally for standard (non-module) script environments like content scripts
if (typeof globalThis !== 'undefined') {
  globalThis.LocalDetectionEngine = LocalDetectionEngine;
  globalThis.LocalPlaceholderEngine = LocalPlaceholderEngine;
} else if (typeof window !== 'undefined') {
  window.LocalDetectionEngine = LocalDetectionEngine;
  window.LocalPlaceholderEngine = LocalPlaceholderEngine;
} else if (typeof self !== 'undefined') {
  self.LocalDetectionEngine = LocalDetectionEngine;
  self.LocalPlaceholderEngine = LocalPlaceholderEngine;
}
