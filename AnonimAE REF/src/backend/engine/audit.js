import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export class AuditEngine {
  constructor(dataDir) {
    this.dataDir = dataDir || path.join(process.cwd(), 'src', 'backend', 'data');
    this.filePath = path.join(this.dataDir, 'audit.json');
    this.ensureDirAndFile();
  }

  /**
   * Ensures the data directory and audit.json file exist.
   */
  ensureDirAndFile() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      if (!fs.existsSync(this.filePath)) {
        fs.writeFileSync(this.filePath, JSON.stringify([]), 'utf8');
      }
    } catch (error) {
      console.error('Failed to initialize audit file:', error);
    }
  }

  /**
   * Helper to compute SHA-256 hashes of values for auditable verification.
   */
  static hash(content) {
    if (!content) return '';
    const str = typeof content === 'string' ? content : JSON.stringify(content);
    return crypto.createHash('sha256').update(str).digest('hex');
  }

  logTransaction(originalText, anonymizedText, mapping, entitiesDetected, engine, acceleration, anonRef, sourceUrl, userCredentials) {
    try {
      const records = this.getLogs();

      const newRecord = {
        timestamp: new Date().toISOString(),
        original_hash: AuditEngine.hash(originalText),
        anonymized_hash: AuditEngine.hash(anonymizedText),
        mapping_hash: AuditEngine.hash(mapping),
        entities_detected: Array.from(new Set(entitiesDetected)),
        entities_replaced: Object.keys(mapping).length,
        engine: engine || 'Local RegEx + Dictionaries',
        acceleration: acceleration || 'CPU',
        anon_ref: anonRef,
        source_url: sourceUrl || 'Playground Local',
        user_credentials: userCredentials || 'Usuario Local'
      };

      records.unshift(newRecord); // Keep newest logs at the beginning

      // Save back to file (limit to 500 records for performance)
      const trimmedRecords = records.slice(0, 500);
      fs.writeFileSync(this.filePath, JSON.stringify(trimmedRecords, null, 2), 'utf8');
      return newRecord;
    } catch (error) {
      console.error('Failed to write audit log:', error);
      return null;
    }
  }

  /**
   * Retrieves all logs from local file.
   * @returns {Array} Array of audit logs
   */
  getLogs() {
    try {
      if (fs.existsSync(this.filePath)) {
        const fileContent = fs.readFileSync(this.filePath, 'utf8');
        return JSON.parse(fileContent) || [];
      }
    } catch (e) {
      console.error('Failed to read audit.json:', e);
    }
    return [];
  }
}
