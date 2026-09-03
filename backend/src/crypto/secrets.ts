import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function deriveKey(encryptionKeyBase64: string): Buffer {
  const key = Buffer.from(encryptionKeyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY muss 32 Bytes (base64-kodiert) sein, ist aber ${key.length} Bytes — mit \`openssl rand -base64 32\` erzeugen.`,
    );
  }
  return key;
}

/**
 * Verschlüsselt einen Klartext-String für die Ablage in *_enc-DB-Feldern
 * (ChurchTools-Passwort, Login-Token, Webhook-Secrets). Format: base64(iv):base64(authTag):base64(ciphertext).
 */
export function encryptSecret(plaintext: string, encryptionKeyBase64: string): string {
  const key = deriveKey(encryptionKeyBase64);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptSecret(encoded: string, encryptionKeyBase64: string): string {
  const key = deriveKey(encryptionKeyBase64);
  const [ivB64, authTagB64, ciphertextB64] = encoded.split(':');
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error('Ungültiges Secret-Format — erwartet iv:authTag:ciphertext (je base64)');
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, 'base64')), decipher.final()]);
  return plaintext.toString('utf8');
}
