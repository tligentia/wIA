import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

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

export class DetectionEngine {
  constructor(configPath) {
    this.configPath = configPath || path.join(process.cwd(), 'config', 'rules.yaml');
    this.rules = { entities: [], dictionaries: {} };
    this.loadRules();
  }

  /**
   * Loads entity and dictionary rules from YAML config
   */
  loadRules() {
    try {
      if (fs.existsSync(this.configPath)) {
        const fileContent = fs.readFileSync(this.configPath, 'utf8');
        const parsed = YAML.parse(fileContent);
        if (parsed) {
          this.rules.entities = parsed.entities || [];
          this.rules.dictionaries = parsed.dictionaries || {};
        }
      }
    } catch (error) {
      console.error('Failed to load rules.yaml:', error);
    }
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
    for (const entity of this.rules.entities) {
      if (entity.type === 'regex' && entity.patterns) {
        for (const patternStr of entity.patterns) {
          try {
            // Compile pattern. Since we parse from YAML, double escapes are loaded as literals.
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

              matches.push({
                id: entity.id,
                name: entity.name,
                placeholder: entity.placeholder,
                text: match[0],
                start: match.index,
                end: match.index + match[0].length
              });
            }
          } catch (e) {
            console.error(`Invalid regex pattern for entity ${entity.id}: ${patternStr}`, e);
          }
        }
      }
    }

    // 2. Process Dictionary Rules
    if (this.rules.dictionaries) {
      for (const [dictKey, words] of Object.entries(this.rules.dictionaries)) {
        if (!Array.isArray(words)) continue;
        
        // Define standard placeholders based on dictionary type
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
          
          // Match whole words case-insensitively using unicode-aware boundary checks if possible.
          // For Spanish accents, diereses, and cedillas, standard \b fails on boundaries that have accents.
          // Escaping word to prevent regex injection
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
    // Sort matches: first by starting index ascending, then by length descending
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
      } else {
        // Overlap detected. We discard 'current' because the array is sorted such that:
        // - We prefer earlier starting matches.
        // - If they start at the same index, we prefer the longer match (sorted by length desc).
        // - If a match starts after another match but before its end, it's a sub-segment overlap,
        //   and since the previous match started earlier and is already active, we prioritize the earlier/larger one.
      }
    }

    // Sort final result by start index for convenience
    return nonOverlappingMatches.sort((a, b) => a.start - b.start);
  }
}
