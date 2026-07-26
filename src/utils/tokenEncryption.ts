import crypto from 'crypto';

// ─── Token Encryption/Decryption for at-rest security ──────────────────────
// Uses AES-256-GCM for authenticated encryption.
// TOKEN_ENCRYPTION_KEY must be a 64-char hex string (32 bytes).
// If not set, encryption is disabled and tokens are stored in plaintext
// (development only — production MUST set this).

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

function getEncryptionKey(): Buffer | null {
  const keyHex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!keyHex) return null;

  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
  }
  return key;
}

/**
 * Encrypt a plaintext token. Returns null if encryption is not configured.
 * Output format: base64(iv + authTag + ciphertext)
 */
export function encryptToken(plaintext: string | null): string | null {
  if (!plaintext) return null;

  const key = getEncryptionKey();
  if (!key) return plaintext; // Fallback for dev without key

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Pack: iv + authTag + ciphertext → base64
  const packed = Buffer.concat([iv, authTag, encrypted]);
  return packed.toString('base64');
}

/**
 * Decrypt an encrypted token. Returns null if input is null.
 * Handles both encrypted and plaintext tokens gracefully.
 */
export function decryptToken(encrypted: string | null): string | null {
  if (!encrypted) return null;

  const key = getEncryptionKey();
  if (!key) return encrypted; // Fallback for dev without key

  try {
    const packed = Buffer.from(encrypted, 'base64');

    // Minimum size: 12 (iv) + 16 (authTag) + 1 (ciphertext)
    if (packed.length < 29) return encrypted; // Not encrypted, return as-is

    const iv = packed.subarray(0, IV_LENGTH);
    const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  } catch {
    // If decryption fails, the token was likely stored in plaintext (migration period)
    // Return as-is so existing plaintext tokens still work
    return encrypted;
  }
}

/**
 * Check if encryption is configured (for tests / health checks)
 */
export function isEncryptionConfigured(): boolean {
  return getEncryptionKey() !== null;
}
