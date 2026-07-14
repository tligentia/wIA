import AdmZip from 'adm-zip';
import * as XLSX from 'xlsx';
import { PlaceholderEngine } from './placeholder.js';

export class DocumentProcessor {
  /**
   * Helper to run entity detection with active enabled-toggles filters and blend AI entities.
   */
  static runDetection(text, detectionEngine, enabledEntities, aiEntities = null) {
    let detected = detectionEngine.detect(text);
    if (enabledEntities && Array.isArray(enabledEntities)) {
      detected = detected.filter(d => enabledEntities.includes(d.id));
    }

    if (aiEntities && Array.isArray(aiEntities)) {
      aiEntities.forEach(ai => {
        let start = ai.start;
        let end = ai.end;
        
        // Fallback to indexOf search if indices are missing or mismatched for this segment
        if (start === undefined || start === -1 || text.substring(start, end) !== ai.text) {
          start = text.indexOf(ai.text);
          if (start !== -1) {
            end = start + ai.text.length;
          }
        }

        if (start !== -1) {
          const overlap = detected.some(d => (start >= d.start && start < d.end) || (d.start >= start && d.start < end));
          if (!overlap && (!enabledEntities || enabledEntities.includes(ai.id))) {
            detected.push({
              id: ai.id,
              name: ai.name || ai.id.toUpperCase(),
              text: ai.text,
              start: start,
              end: end
            });
          }
        }
      });
      detected.sort((a, b) => a.start - b.start);
    }
    return detected;
  }

  /**
   * Unified entry point to anonymize a document based on its file extension.
   * Supports both plaintext and binary format buffers.
   * @param {string|Buffer} content Raw string content of the document or Buffer for binary
   * @param {string} extension File extension
   * @param {Object} detectionEngine Instance of DetectionEngine
   * @param {Array<string>} enabledEntities List of active rules to filter
   * @param {Array<Object>} aiEntities List of entities pre-detected by WebGPU AI models
   * @returns {Object} { anonymizedContent: string, mapping: Object, detectedIds: Array, isBinaryOut: boolean }
   */
  static async anonymize(content, extension, detectionEngine, enabledEntities = null, aiEntities = null) {
    const ext = extension.toLowerCase().replace('.', '');
    
    const sharedState = {
      counters: {},
      valueToPlaceholder: new Map(),
      placeholderToValue: {}
    };

    // If content is base64 string, decode it to buffer for binary formats
    const isBinary = ['docx', 'xlsx', 'xls', 'pdf'].includes(ext);
    const buffer = isBinary && typeof content === 'string' 
      ? Buffer.from(content, 'base64') 
      : content;

    switch (ext) {
      case 'docx':
        return this.anonymizeDOCX(buffer, detectionEngine, enabledEntities, sharedState);
      case 'xlsx':
      case 'xls':
        return this.anonymizeXLSX(buffer, detectionEngine, enabledEntities, sharedState);
      case 'pdf':
        return await this.anonymizePDF(buffer, detectionEngine, enabledEntities, sharedState, aiEntities);
      case 'json':
        return this.anonymizeJSON(content, detectionEngine, enabledEntities, sharedState, aiEntities);
      case 'csv':
        return this.anonymizeCSV(content, detectionEngine, enabledEntities, sharedState, aiEntities);
      case 'html':
      case 'htm':
      case 'xml':
        return this.anonymizeXMLHTML(content, detectionEngine, enabledEntities, sharedState, aiEntities);
      case 'md':
      case 'markdown':
      case 'txt':
      default:
        return this.anonymizeText(content, detectionEngine, enabledEntities, sharedState, aiEntities);
    }
  }

  /**
   * Unified entry point to de-anonymize a document.
   */
  static deanonymize(content, extension, mapping) {
    const ext = (extension || 'txt').toLowerCase().replace('.', '');
    
    // Clear new and old style ANON_REF footers if present
    let cleanContent = content;
    if (typeof content === 'string') {
      cleanContent = content
        .replace(/\n\n\[Referencia:\s*[a-f0-9\-]{36}\][\s\S]*/gi, '')
        .replace(/\n\n# ANON_REF:\s*[a-f0-9\-]{36}[\s\S]*/gi, '');
    }

    if (ext === 'docx') {
      try {
        const buffer = typeof cleanContent === 'string' ? Buffer.from(cleanContent, 'base64') : cleanContent;
        const zip = new AdmZip(buffer);
        const zipEntries = zip.getEntries();
        const placeholders = Object.keys(mapping).sort((a, b) => b.length - a.length);

        for (const entry of zipEntries) {
          if (entry.entryName.startsWith('word/') && entry.entryName.endsWith('.xml')) {
            let xmlContent = entry.getData().toString('utf8');
            for (const token of placeholders) {
              xmlContent = xmlContent.replaceAll(token, mapping[token]);
            }
            zip.updateFile(entry, Buffer.from(xmlContent, 'utf8'));
          }
        }
        return zip.toBuffer().toString('base64');
      } catch (e) {
        console.error('DOCX de-anonymization failed:', e);
        throw e;
      }
    }

    if (ext === 'xlsx' || ext === 'xls') {
      try {
        const buffer = typeof cleanContent === 'string' ? Buffer.from(cleanContent, 'base64') : cleanContent;
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const placeholders = Object.keys(mapping).sort((a, b) => b.length - a.length);

        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          if (!sheet) continue;

          for (const [cellRef, cell] of Object.entries(sheet)) {
            if (cellRef.startsWith('!')) continue;

            if (cell && cell.t === 's' && typeof cell.v === 'string') {
              let val = cell.v;
              for (const token of placeholders) {
                val = val.replaceAll(token, mapping[token]);
              }
              cell.v = val;
              if (cell.w) {
                let wVal = cell.w;
                for (const token of placeholders) {
                  wVal = wVal.replaceAll(token, mapping[token]);
                }
                cell.w = wVal;
              }
            }
          }
        }
        const outBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        return outBuffer.toString('base64');
      } catch (e) {
        console.error('XLSX de-anonymization failed:', e);
        throw e;
      }
    }

    // Default string text fallback
    let restored = typeof cleanContent === 'string' ? cleanContent : cleanContent.toString('utf8');
    const placeholders = Object.keys(mapping).sort((a, b) => b.length - a.length);
    for (const token of placeholders) {
      restored = restored.replaceAll(token, mapping[token]);
    }
    return restored;
  }

  // ==========================================
  // BINARY DOCX PROCESSOR
  // ==========================================
  static anonymizeDOCX(buffer, detectionEngine, enabledEntities, sharedState) {
    try {
      const zip = new AdmZip(buffer);
      const zipEntries = zip.getEntries();
      const detectedIds = [];

      for (const entry of zipEntries) {
        // Scan all document XML chunks (body, headers, footers, footnotes)
        if (entry.entryName.startsWith('word/') && entry.entryName.endsWith('.xml')) {
          const xmlContent = entry.getData().toString('utf8');
          
          // Anonymize tag-safely
          const { anonymizedContent, detectedIds: fileDetected } = 
            this.anonymizeXMLHTML(xmlContent, detectionEngine, enabledEntities, sharedState);
          
          fileDetected.forEach(id => detectedIds.push(id));
          
          zip.updateFile(entry, Buffer.from(anonymizedContent, 'utf8'));
        }
      }

      const outBuffer = zip.toBuffer();
      return {
        anonymizedContent: outBuffer.toString('base64'),
        mapping: sharedState.placeholderToValue,
        detectedIds,
        isBinaryOut: true
      };
    } catch (e) {
      console.error('DOCX anonymization failed:', e);
      throw e;
    }
  }

  // ==========================================
  // BINARY XLSX PROCESSOR
  // ==========================================
  static anonymizeXLSX(buffer, detectionEngine, enabledEntities, sharedState) {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const detectedIds = [];

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;

        for (const [cellRef, cell] of Object.entries(sheet)) {
          if (cellRef.startsWith('!')) continue;

          if (cell && cell.t === 's' && typeof cell.v === 'string') {
            const originalVal = cell.v;
            
            const detected = this.runDetection(originalVal, detectionEngine, enabledEntities);
            detected.forEach(d => detectedIds.push(d.id));
            
            const { anonymizedText } = PlaceholderEngine.process(originalVal, detected, sharedState);
            
            cell.v = anonymizedText;
            if (cell.w) {
              cell.w = anonymizedText;
            }
          }
        }
      }

      const outBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      return {
        anonymizedContent: outBuffer.toString('base64'),
        mapping: sharedState.placeholderToValue,
        detectedIds,
        isBinaryOut: true
      };
    } catch (e) {
      console.error('XLSX anonymization failed:', e);
      throw e;
    }
  }

  // ==========================================
  // BINARY PDF PROCESSOR (TEXT EXTRACTOR)
  // ==========================================
  static async anonymizePDF(buffer, detectionEngine, enabledEntities, sharedState, aiEntities = null) {
    if (process.env.VERCEL) {
      throw new Error('Server-side PDF extraction is disabled on Vercel. Use the browser extension PDF processor for PDF anonymization.');
    }

    let parser;
    try {
      const pdfParseModule = await import('pdf-parse');
      const { PDFParse } = pdfParseModule.default ?? pdfParseModule;
      parser = new PDFParse({ data: buffer });
      const pdfData = await parser.getText();
      const extractedText = pdfData.text || '';
      
      const detected = this.runDetection(extractedText, detectionEngine, enabledEntities, aiEntities);
      const detectedIds = detected.map(d => d.id);
      
      const { anonymizedText } = PlaceholderEngine.process(extractedText, detected, sharedState);
      
      return {
        anonymizedContent: anonymizedText,
        mapping: sharedState.placeholderToValue,
        detectedIds,
        isBinaryOut: false
      };
    } catch (e) {
      console.error('PDF text extraction failed:', e);
      throw e;
    } finally {
      if (parser && typeof parser.destroy === 'function') {
        await parser.destroy();
      }
    }
  }

  // ==========================================
  // TEXT & MARKDOWN PROCESSOR
  // ==========================================
  static anonymizeText(content, detectionEngine, enabledEntities, sharedState, aiEntities = null) {
    const detected = this.runDetection(content, detectionEngine, enabledEntities, aiEntities);
    const detectedIds = detected.map(d => d.id);
    const { anonymizedText, mapping } = PlaceholderEngine.process(content, detected, sharedState);
    return { anonymizedContent: anonymizedText, mapping, detectedIds };
  }

  // ==========================================
  // JSON PROCESSOR
  // ==========================================
  static anonymizeJSON(content, detectionEngine, enabledEntities, sharedState, aiEntities = null) {
    try {
      const obj = JSON.parse(content);
      const detectedIds = [];

      const traverse = (node) => {
        if (typeof node === 'string') {
          const detected = this.runDetection(node, detectionEngine, enabledEntities, aiEntities);
          detected.forEach(d => detectedIds.push(d.id));
          const { anonymizedText } = PlaceholderEngine.process(node, detected, sharedState);
          return anonymizedText;
        } else if (Array.isArray(node)) {
          return node.map(item => traverse(item));
        } else if (typeof node === 'object' && node !== null) {
          const newObj = {};
          for (const [key, val] of Object.entries(node)) {
            newObj[key] = traverse(val);
          }
          return newObj;
        }
        return node;
      };

      const anonymizedObj = traverse(obj);
      return {
        anonymizedContent: JSON.stringify(anonymizedObj, null, 2),
        mapping: sharedState.placeholderToValue,
        detectedIds
      };
    } catch (e) {
      console.error('JSON parsing failed inside processor, falling back to raw text', e);
      return this.anonymizeText(content, detectionEngine, enabledEntities, sharedState);
    }
  }

  // ==========================================
  // CSV PROCESSOR
  // ==========================================
  static anonymizeCSV(content, detectionEngine, enabledEntities, sharedState, aiEntities = null) {
    try {
      const firstLine = content.split('\n')[0] || '';
      const separator = firstLine.includes(';') ? ';' : ',';

      const lines = content.split(/\r?\n/);
      const anonymizedLines = [];
      const detectedIds = [];

      for (const line of lines) {
        if (line.trim() === '') {
          anonymizedLines.push('');
          continue;
        }

        const cells = line.split(separator);
        const anonymizedCells = cells.map(cell => {
          let cleanCell = cell.trim();
          let hasQuotes = false;
          if (cleanCell.startsWith('"') && cleanCell.endsWith('"')) {
            cleanCell = cleanCell.slice(1, -1);
            hasQuotes = true;
          }

          const detected = this.runDetection(cleanCell, detectionEngine, enabledEntities, aiEntities);
          detected.forEach(d => detectedIds.push(d.id));
          const { anonymizedText } = PlaceholderEngine.process(cleanCell, detected, sharedState);

          return hasQuotes ? `"${anonymizedText}"` : anonymizedText;
        });

        anonymizedLines.push(anonymizedCells.join(separator));
      }

      return {
        anonymizedContent: anonymizedLines.join('\n'),
        mapping: sharedState.placeholderToValue,
        detectedIds
      };
    } catch (e) {
      console.error('CSV processing failed, falling back to raw text', e);
      return this.anonymizeText(content, detectionEngine, enabledEntities, sharedState);
    }
  }

  // ==========================================
  // XML & HTML TAG-SAFE STATE MACHINE PROCESSOR
  // ==========================================
  static anonymizeXMLHTML(content, detectionEngine, enabledEntities, sharedState, aiEntities = null) {
    try {
      let result = '';
      let i = 0;
      const length = content.length;
      const detectedIds = [];
      
      let inTag = false;
      let textBuffer = '';
      let skipContent = false;

      while (i < length) {
        const char = content[i];

        if (char === '<') {
          if (textBuffer.length > 0) {
            if (skipContent) {
              result += textBuffer;
            } else {
              const detected = this.runDetection(textBuffer, detectionEngine, enabledEntities, aiEntities);
              detected.forEach(d => detectedIds.push(d.id));
              const { anonymizedText } = PlaceholderEngine.process(textBuffer, detected, sharedState);
              result += anonymizedText;
            }
            textBuffer = '';
          }
          inTag = true;
          result += char;
        } else if (char === '>') {
          inTag = false;
          result += char;
          
          const lastTagMatch = result.match(/<(\/)?([a-zA-Z0-9]+)[^>]*>$/);
          if (lastTagMatch) {
            const isClosing = !!lastTagMatch[1];
            const tagName = lastTagMatch[2].toLowerCase();
            
            if (tagName === 'script' || tagName === 'style') {
              skipContent = !isClosing;
            }
          }
        } else {
          if (inTag) {
            result += char;
          } else {
            textBuffer += char;
          }
        }
        i++;
      }

      if (textBuffer.length > 0) {
        if (skipContent) {
          result += textBuffer;
        } else {
          const detected = this.runDetection(textBuffer, detectionEngine, enabledEntities, aiEntities);
          detected.forEach(d => detectedIds.push(d.id));
          const { anonymizedText } = PlaceholderEngine.process(textBuffer, detected, sharedState);
          result += anonymizedText;
        }
      }

      return {
        anonymizedContent: result,
        mapping: sharedState.placeholderToValue,
        detectedIds
      };
    } catch (e) {
      console.error('XML/HTML tag-safe parsing failed, falling back to raw text', e);
      return this.anonymizeText(content, detectionEngine, enabledEntities, sharedState);
    }
  }
}
