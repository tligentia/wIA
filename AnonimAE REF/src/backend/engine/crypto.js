import crypto from 'crypto';

export class CryptoEngine {
  /**
   * Encrypts a mapping object using a user password and AES-256-GCM.
   * @param {Object} mapping Plaintext mapping object
   * @param {string} password Master password for key derivation
   * @returns {Object} { iv: string, authTag: string, salt: string, encryptedData: string }
   */
  static encrypt(mapping, password) {
    if (!password) {
      throw new Error('Encryption password is required');
    }

    // Convert mapping object to string
    const plaintext = JSON.stringify(mapping);

    // Generate high-entropy salt and IV
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);

    // Derive 256-bit key using scrypt (highly resistant to hardware brute forcing)
    // N=16384 (CPU/memory cost), r=8, p=1 (Standard settings)
    const key = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });

    // Initialize AES-256-GCM cipher
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    // Encrypt
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Retrieve authentication tag
    const authTag = cipher.getAuthTag();

    return {
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      salt: salt.toString('hex'),
      encryptedData: encrypted
    };
  }

  /**
   * Decrypts an encrypted mapping payload back to an object.
   * Throws an error if authentication fails (wrong password or altered data).
   * @param {Object} payload { iv: string, authTag: string, salt: string, encryptedData: string }
   * @param {string} password Master password
   * @returns {Object} Original mapping object
   */
  static decrypt(payload, password) {
    if (!password) {
      throw new Error('Decryption password is required');
    }

    const salt = Buffer.from(payload.salt, 'hex');
    const iv = Buffer.from(payload.iv, 'hex');
    const authTag = Buffer.from(payload.authTag, 'hex');
    const encryptedData = payload.encryptedData;

    // Derive key using the exact same salt and parameters
    const key = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });

    // Initialize decipher
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    // Decrypt
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted);
  }
}
