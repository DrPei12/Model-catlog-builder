import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const DEFAULT_ALGORITHM = 'aes-256-gcm';

export function createCredentialVault(options = {}) {
  const secret = String(options.secret || '').trim();
  const keyVersion = options.keyVersion || 'v1';
  const algorithm = options.algorithm || DEFAULT_ALGORITHM;

  if (!secret) {
    throw new Error('Credential vault secret is required.');
  }

  const key = deriveKey(secret);

  return {
    algorithm,
    keyVersion,
    encrypt: (credentials) => encryptCredentials(credentials, key, { algorithm, keyVersion }),
    decrypt: (record) => decryptCredentials(record, key),
  };
}

export function summarizeCredentials(fields = [], credentials = {}) {
  const summary = {};

  for (const field of fields) {
    const rawValue = credentials[field.id];
    const value = rawValue === undefined || rawValue === null ? '' : String(rawValue);
    if (!value.trim()) {
      continue;
    }

    summary[field.id] = {
      label: field.label,
      type: field.type,
      preview: maskValue(field, value),
      fingerprint: fingerprintValue(value),
    };
  }

  return summary;
}

function encryptCredentials(credentials, key, metadata) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(metadata.algorithm, key, iv);
  const plaintext = Buffer.from(JSON.stringify(credentials), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    algorithm: metadata.algorithm,
    keyVersion: metadata.keyVersion,
    encryptedAt: new Date().toISOString(),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
}

function decryptCredentials(record, key) {
  if (!record?.ciphertext || !record?.iv || !record?.authTag) {
    throw new Error('Encrypted credential record is incomplete.');
  }

  const decipher = createDecipheriv(
    record.algorithm || DEFAULT_ALGORITHM,
    key,
    Buffer.from(record.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(record.authTag, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, 'base64')),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString('utf8'));
}

function deriveKey(secret) {
  return createHash('sha256').update(secret, 'utf8').digest();
}

function fingerprintValue(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
}

function maskValue(field, value) {
  const trimmed = value.trim();
  const lowerId = String(field.id || '').toLowerCase();
  const lowerType = String(field.type || '').toLowerCase();

  if (lowerType === 'password' || lowerId.includes('key') || lowerId.includes('token') || lowerId.includes('secret')) {
    if (trimmed.length <= 6) {
      return '******';
    }
    return `${trimmed.slice(0, 3)}...${trimmed.slice(-2)}`;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return `${url.origin}${url.pathname === '/' ? '' : url.pathname}`;
    } catch {
      return trimmed;
    }
  }

  if (trimmed.length <= 10) {
    return trimmed;
  }

  return `${trimmed.slice(0, 4)}...${trimmed.slice(-3)}`;
}
