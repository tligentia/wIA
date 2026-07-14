/**
 * AnonimAE Client-Side Autonomous Detection & Placeholder Engines
 * Implements regex patterns matching and dictionary lookups, matching the Node.js backend.
 */

function extendSpanishName(text, start, initialEnd, rules = null) {
  let currentEnd = initialEnd;
  // Matches spaces, optional particles (de, del, de la, de los, y), and captures the capitalized word (supporting dieresis, cedillas, grave accents)
  const surnameRegex = /^(?:\s+(?:de\s+la\s+|de\s+los\s+|de\s+|del\s+|y\s+)?([A-ZÁÉÍÓÚÜÏÇÀÈÒ][A-ZÁÉÍÓÚÜÏÇÀÈÒa-záéíóúüñïçàèò-]+))/;
  
  const firstWord = text.substring(start, initialEnd).trim();
  const isAllCaps = firstWord === firstWord.toUpperCase() && /[A-ZÁÉÍÓÚÜÏÇÀÈÒ]/.test(firstWord);

  while (true) {
    const remainingText = text.substring(currentEnd);
    const match = remainingText.match(surnameRegex);
    if (match) {
      const surnameWord = match[1];
      
      // If it's a known organization, stop extending!
      if (rules && rules.dictionaries && rules.dictionaries.organizaciones) {
        const orgs = rules.dictionaries.organizaciones;
        if (orgs.some(org => org.toLowerCase() === surnameWord.toLowerCase())) {
          break;
        }
      }
      
      // If it's in all-caps and >= 3 characters (e.g. ACME, BBVA), it's likely an organization, stop!
      // But do not stop if the name itself was all-caps (indicating uppercase context)
      if (!isAllCaps && surnameWord === surnameWord.toUpperCase() && surnameWord.length >= 3) {
        break;
      }
      
      currentEnd += match[0].length;
    } else {
      break;
    }
  }
  return currentEnd;
}

class LocalDetectionEngine {
  constructor(rulesJson) {
    this.rules = rulesJson || { entities: [], dictionaries: {} };
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

    // 2. Process Dictionary Rules
    if (this.rules.dictionaries) {
      for (const [dictKey, words] of Object.entries(this.rules.dictionaries)) {
        if (!Array.isArray(words)) continue;
        
        let friendlyName = dictKey.charAt(0).toUpperCase() + dictKey.slice(1);
        let placeholderType = 'Dict';
        let entityId = `dict_${dictKey}`;

        if (dictKey === 'nombres') {
          friendlyName = 'Nombre';
          placeholderType = 'Nombre';
          entityId = 'nombre';
        } else if (dictKey === 'organizaciones') {
          friendlyName = 'Organización';
          placeholderType = 'Empresa';
          entityId = 'organizacion';
        }

        for (const word of words) {
          if (!word || word.trim() === '') continue;
          
          const escapedWord = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          const regex = new RegExp(`(?<=^|[^a-zA-Z0-9áéíóúüñïçàèòÁÉÍÓÚÜÑÏÇÀÈÒ])${escapedWord}(?=$|[^a-zA-Z0-9áéíóúüñïçàèòÁÉÍÓÚÜÑÏÇÀÈÒ])`, 'gi');
          
          let match;
          while ((match = regex.exec(text)) !== null) {
            if (match.index === regex.lastIndex) {
              regex.lastIndex++;
            }
            
            let finalStart = match.index;
            let finalEnd = match.index + match[0].length;
            
            if (dictKey === 'nombres') {
              // 1. Backwards Initial Resolution (e.g. "B GERDA" -> captures "B ")
              const precedingText = text.substring(0, finalStart);
              const initialRegex = /(?:^|[^a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑÏïçÇ])([A-ZÁÉÍÓÚÜÏÇÀÈÒ]\.?\s+)$/;
              const initialMatch = precedingText.match(initialRegex);
              if (initialMatch) {
                finalStart -= initialMatch[1].length;
              }
              
              // 2. Forwards Surname Look-ahead Extension (e.g. "GERDA" -> extends over "HEIDER GREÏNER")
              finalEnd = extendSpanishName(text, finalStart, finalEnd, this.rules);
            }
            
            const matchedText = text.substring(finalStart, finalEnd);

            matches.push({
              id: entityId,
              name: friendlyName,
              placeholder: placeholderType,
              text: matchedText,
              start: finalStart,
              end: finalEnd
            });
          }
        }
      }
    }

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

class LocalPlaceholderEngine {
  /**
   * Replaces detected entities in text with consistent placeholders and produces the mapping.
   * @param {string} text Original input text
   * @param {Array<Object>} entities List of non-overlapping detected entities
   * @returns {Object} { anonymizedText: string, mapping: Object }
   */
  static process(text, entities, state = null) {
    if (!text) return { anonymizedText: '', mapping: {} };
    if (!entities || entities.length === 0) return { anonymizedText: text, mapping: {} };

    const counters = state ? state.counters : {};
    const valueToPlaceholder = state ? state.valueToPlaceholder : new Map();
    const placeholderToValue = state ? state.placeholderToValue : {};

    // Sort entities descending by start index to replace from right to left
    const sortedEntitiesDesc = [...entities].sort((a, b) => b.start - a.start);
    
    // Establish consistent placeholders in ascending order first
    const sortedEntitiesAsc = [...entities].sort((a, b) => a.start - b.start);
    for (const entity of sortedEntitiesAsc) {
      const originalValue = entity.text;
      const normalizedValue = originalValue.trim();
      const key = normalizedValue.toLowerCase();

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
      const key = entity.text.trim().toLowerCase();
      const placeholder = valueToPlaceholder.get(key);
      
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
