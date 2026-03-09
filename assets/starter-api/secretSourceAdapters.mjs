import fs from 'node:fs/promises';
import path from 'node:path';

export function createSecretSourceAdapter(options = {}) {
  const type = options.type || 'embedded';
  const tenantId = normalizeTenantId(options.tenantId || 'default');
  const vault = options.vault;

  if (!vault) {
    throw new Error('Secret source adapter requires a credential vault.');
  }

  if (type === 'embedded') {
    return createEmbeddedAdapter({ vault, tenantId });
  }

  if (type === 'file') {
    const rootDir = path.resolve(options.rootDir || 'secret-store');
    return createFileAdapter({ vault, tenantId, rootDir });
  }

  throw new Error(`Unsupported secret source adapter "${type}".`);
}

function createEmbeddedAdapter({ vault, tenantId }) {
  return {
    type: 'embedded-vault',
    usesExternalStorage: false,
    tenantId,
    describe: () => ({
      type: 'embedded-vault',
      usesExternalStorage: false,
      tenantId,
      rootDir: null,
    }),
    describeStoredSecret: (storedSecret) => ({
      type: 'embedded-vault',
      ref: storedSecret?.ref || null,
    }),
    storeSecret: async ({ credentials }) => ({
      adapter: 'embedded-vault',
      mode: 'embedded',
      ...vault.encrypt(credentials),
    }),
    loadSecret: async ({ storedSecret }) => vault.decrypt(normalizeEmbeddedRecord(storedSecret)),
    deleteSecret: async () => {},
  };
}

function createFileAdapter({ vault, tenantId, rootDir }) {
  return {
    type: 'file-vault',
    usesExternalStorage: true,
    tenantId,
    rootDir,
    describe: () => ({
      type: 'file-vault',
      usesExternalStorage: true,
      tenantId,
      rootDir,
    }),
    describeStoredSecret: (storedSecret) => ({
      type: 'file-vault',
      ref: storedSecret?.ref || null,
    }),
    storeSecret: async ({ providerId, credentials }) => {
      const filePath = buildSecretFilePath(rootDir, tenantId, providerId);
      const encryptedRecord = vault.encrypt(credentials);

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(encryptedRecord, null, 2) + '\n', 'utf8');

      return {
        adapter: 'file-vault',
        mode: 'external-ref',
        ref: filePath,
        keyVersion: encryptedRecord.keyVersion,
        storedAt: new Date().toISOString(),
      };
    },
    loadSecret: async ({ storedSecret }) => {
      if (!storedSecret?.ref) {
        throw new Error('Secret reference is missing for file-vault adapter.');
      }

      const payload = JSON.parse(await fs.readFile(storedSecret.ref, 'utf8'));
      return vault.decrypt(payload);
    },
    deleteSecret: async ({ storedSecret }) => {
      if (!storedSecret?.ref) {
        return;
      }
      await fs.rm(storedSecret.ref, { force: true }).catch(() => {});
    },
  };
}

function buildSecretFilePath(rootDir, tenantId, providerId) {
  return path.join(rootDir, tenantId, `${providerId}.secret.json`);
}

function normalizeEmbeddedRecord(storedSecret) {
  if (!storedSecret) {
    throw new Error('Stored secret record is missing.');
  }

  if (storedSecret.ciphertext && storedSecret.iv && storedSecret.authTag) {
    return storedSecret;
  }

  if (storedSecret.payload?.ciphertext) {
    return storedSecret.payload;
  }

  throw new Error('Stored embedded secret is incomplete.');
}

function normalizeTenantId(value) {
  return String(value || 'default')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-') || 'default';
}
