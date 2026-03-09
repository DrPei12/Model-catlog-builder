// Adjust this import to match where you expose the starter package in your app.
import { createNextRouteHandlers } from '../index.mjs';

export const runtime = 'nodejs';

const handlers = createNextRouteHandlers({
  rootDir: process.cwd(),
  defaultTenantId: process.env.MODEL_CATALOG_DEFAULT_TENANT || 'default',
  apiKeys: process.env.MODEL_CATALOG_API_KEYS || '',
  catalogPath: process.env.CATALOG_PATH,
  jsonStatePath: process.env.RUNTIME_STATE_PATH,
  sqlitePath: process.env.RUNTIME_SQLITE_PATH,
  tenantsRoot: process.env.RUNTIME_TENANTS_ROOT,
  storageMode: process.env.RUNTIME_STORAGE_MODE || 'auto',
  encryptionSecret: process.env.MODEL_CATALOG_SECRET,
  secretSourceType: process.env.MODEL_CATALOG_SECRET_SOURCE || 'embedded',
  secretSourceRoot: process.env.MODEL_CATALOG_SECRET_FILE_ROOT,
});

export const { GET, POST, PUT, PATCH, DELETE } = handlers;
