/**
 * AnonimAE Client-Side Crypto Engine
 * Uses Web Crypto API (crypto.subtle) to perform secure, high-performance local encryption/decryption.
 * Aligns payload structure with the Node.js backend.
 */

// Hex utility helpers since Buffer is not native in browsers
function bufferToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += ('0' + bytes[i].toString(16)).slice(-2);
  }
  return hex;
}

function hexToUint8Array(hexString) {
  if (hexString.length % 2 !== 0) {
    throw new Error('Invalid hex string');
  }
  const numPairs = hexString.length / 2;
  const arr = new Uint8Array(numPairs);
  for (let i = 0; i < numPairs; i++) {
    arr[i] = parseInt(hexString.substr(i * 2, 2), 16);
  }
  return arr;
}

/**
 * Derives a cryptographic AES-GCM 256-bit key from a string password and a salt using PBKDF2.
 */
async function deriveKey(password, saltUint8) {
  const enc = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  
  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltUint8,
      iterations: 100000,
      hash: 'SHA-256'
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

const LocalCrypto = {
  /**
   * Encrypts a mapping object using AES-256-GCM.
   * @param {Object} mapping Plaintext mapping object
   * @param {string} password Master password for key derivation
   * @returns {Promise<Object>} { iv: string, authTag: string, salt: string, encryptedData: string }
   */
  encrypt: async function(mapping, password) {
    if (!password) {
      throw new Error('Encryption password is required');
    }

    const plaintext = JSON.stringify(mapping);
    const plaintextBytes = new TextEncoder().encode(plaintext);

    // Generate high-entropy salt (16 bytes) and IV (12 bytes)
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Derive key
    const key = await deriveKey(password, salt);

    // Encrypt. Web Crypto appends the 16-byte authentication tag at the end of the ciphertext buffer.
    const encryptedBuffer = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      plaintextBytes
    );

    const encryptedBytes = new Uint8Array(encryptedBuffer);
    
    // Separate ciphertext and 16-byte authentication tag
    const ciphertextBytes = encryptedBytes.slice(0, -16);
    const authTagBytes = encryptedBytes.slice(-16);

    return {
      iv: bufferToHex(iv),
      authTag: bufferToHex(authTagBytes),
      salt: bufferToHex(salt),
      encryptedData: bufferToHex(ciphertextBytes)
    };
  },

  /**
   * Decrypts an encrypted mapping payload back to an object.
   * @param {Object} payload { iv: string, authTag: string, salt: string, encryptedData: string }
   * @param {string} password Master password
   * @returns {Promise<Object>} Original mapping object
   */
  decrypt: async function(payload, password) {
    if (!password) {
      throw new Error('Decryption password is required');
    }

    const salt = hexToUint8Array(payload.salt);
    const iv = hexToUint8Array(payload.iv);
    const authTag = hexToUint8Array(payload.authTag);
    const ciphertext = hexToUint8Array(payload.encryptedData);

    // Reconstruct the unified Web Crypto ciphertext buffer (ciphertext + authTag)
    const unifiedBuffer = new Uint8Array(ciphertext.length + authTag.length);
    unifiedBuffer.set(ciphertext, 0);
    unifiedBuffer.set(authTag, ciphertext.length);

    // Derive key
    const key = await deriveKey(password, salt);

    // Decrypt
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      unifiedBuffer
    );

    const plaintext = new TextDecoder().decode(decryptedBuffer);
    return JSON.parse(plaintext);
  }
};

// Expose globally for standard (non-module) script environments like content scripts
if (typeof globalThis !== 'undefined') {
  globalThis.LocalCrypto = LocalCrypto;
} else if (typeof window !== 'undefined') {
  window.LocalCrypto = LocalCrypto;
} else if (typeof self !== 'undefined') {
  self.LocalCrypto = LocalCrypto;
}
