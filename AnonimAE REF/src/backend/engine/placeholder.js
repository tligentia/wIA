export class PlaceholderEngine {
  /**
   * Replaces detected entities in text with consistent placeholders and produces the mapping.
   * @param {string} text Original input text
   * @param {Array<Object>} entities List of non-overlapping detected entities
   * @returns {Object} { anonymizedText: string, mapping: Object }
   */
  static process(text, entities, state = null) {
    if (!text) return { anonymizedText: '', mapping: {} };
    if (!entities || entities.length === 0) return { anonymizedText: text, mapping: {} };

    // Grouping count of placeholders to ensure standard numbering (e.g. [Nombre_001], [Nombre_002])
    const counters = state ? state.counters : {};
    const valueToPlaceholder = state ? state.valueToPlaceholder : new Map();
    const placeholderToValue = state ? state.placeholderToValue : {};

    // We build the substitutions array from right to left (descending order of start index)
    // to avoid shifting character indices while altering the string.
    const sortedEntitiesDesc = [...entities].sort((a, b) => b.start - a.start);
    
    // First pass (forward order) to establish consistent placeholders
    const sortedEntitiesAsc = [...entities].sort((a, b) => a.start - b.start);
    for (const entity of sortedEntitiesAsc) {
      const originalValue = entity.text;
      const normalizedValue = originalValue.trim(); // Match ignoring surrounding whitespace variation
      const key = normalizedValue.toLowerCase(); // Case-insensitive consistency

      if (!valueToPlaceholder.has(key)) {
        // Increment category counter
        const category = entity.placeholder || 'Entity';
        counters[category] = (counters[category] || 0) + 1;
        
        // Zero pad to 3 digits (e.g. 001, 002)
        const padNum = String(counters[category]).padStart(3, '0');
        const placeholder = `[${category}_${padNum}]`;
        
        valueToPlaceholder.set(key, placeholder);
        placeholderToValue[placeholder] = originalValue; // Keep exact casing of first match for de-anonymization
      }
    }

    // Second pass (reverse order) to replace in text
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
