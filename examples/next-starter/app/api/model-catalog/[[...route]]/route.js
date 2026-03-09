import path from 'node:path';

import { createNextRouteHandlers } from 'model-catlog-builder';

export const runtime = 'nodejs';

const repoRoot = path.resolve(process.cwd(), '../..');
const handlers = createNextRouteHandlers({
  rootDir: repoRoot,
  catalogPath: path.join(repoRoot, 'output', 'model-catalog.generated.json'),
  modelRoutingConfigPath: path.join(repoRoot, 'assets', 'model-routing.config.json'),
  jsonStatePath: path.join(repoRoot, 'output', 'runtime-state.json'),
  sqlitePath: path.join(repoRoot, 'output', 'runtime-state.sqlite'),
  tenantsRoot: path.join(repoRoot, 'output', 'tenants'),
  syncScriptPath: path.join(repoRoot, 'scripts', 'sync_model_catalog.mjs'),
  defaultTenantId: process.env.MODEL_CATALOG_DEFAULT_TENANT || 'starter-demo',
  apiKeys: process.env.MODEL_CATALOG_API_KEYS || '',
  encryptionSecret: process.env.MODEL_CATALOG_SECRET,
  secretSourceType: process.env.MODEL_CATALOG_SECRET_SOURCE || 'embedded',
  secretSourceRoot: process.env.MODEL_CATALOG_SECRET_FILE_ROOT,
});

export const { GET, POST, PUT, PATCH, DELETE } = handlers;
