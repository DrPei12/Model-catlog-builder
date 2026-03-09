#!/usr/bin/env node

import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStarterApiService } from '../assets/starter-api/createStarterApiService.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_PORT = Number(process.env.PORT || '4177');
const DEFAULT_CATALOG_PATH = path.resolve(process.env.CATALOG_PATH || path.join(ROOT_DIR, 'output', 'model-catalog.generated.json'));
const DEFAULT_JSON_STATE_PATH = path.resolve(process.env.RUNTIME_STATE_PATH || path.join(ROOT_DIR, 'output', 'runtime-state.json'));
const DEFAULT_SQLITE_PATH = path.resolve(process.env.RUNTIME_SQLITE_PATH || path.join(ROOT_DIR, 'output', 'runtime-state.sqlite'));
const DEFAULT_STORAGE_MODE = process.env.RUNTIME_STORAGE_MODE || 'auto';
const DEFAULT_ENCRYPTION_SECRET = process.env.MODEL_CATALOG_SECRET || 'model-catlog-builder-dev-secret';
const DEFAULT_SECRET_SOURCE_TYPE = process.env.MODEL_CATALOG_SECRET_SOURCE || 'embedded';
const DEFAULT_SECRET_SOURCE_ROOT = path.resolve(process.env.MODEL_CATALOG_SECRET_FILE_ROOT || path.join(ROOT_DIR, 'output', 'secret-store'));
const DEFAULT_TENANTS_ROOT = path.resolve(process.env.RUNTIME_TENANTS_ROOT || path.join(ROOT_DIR, 'output', 'tenants'));
const DEFAULT_TENANT_ID = (process.env.MODEL_CATALOG_DEFAULT_TENANT || 'default').trim().toLowerCase();
const SYNC_SCRIPT_PATH = path.join(ROOT_DIR, 'scripts', 'sync_model_catalog.mjs');
const DEMO_PAGE_PATH = path.join(ROOT_DIR, 'assets', 'starter-api', 'demoPage.html');

export async function startDemoServer(options = {}) {
  const port = Number(options.port || DEFAULT_PORT);
  const catalogPath = path.resolve(options.catalogPath || DEFAULT_CATALOG_PATH);
  const effectiveDefaultTenantId = String(options.defaultTenantId || DEFAULT_TENANT_ID)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-') || DEFAULT_TENANT_ID;
  const effectiveTenantsRoot = path.resolve(options.tenantsRoot || DEFAULT_TENANTS_ROOT);
  const secretSourceType = options.secretSourceType || DEFAULT_SECRET_SOURCE_TYPE;
  const secretSourceRoot = path.resolve(options.secretSourceRoot || DEFAULT_SECRET_SOURCE_ROOT);
  const starterApi = await createStarterApiService({
    rootDir: ROOT_DIR,
    catalogPath,
    jsonStatePath: options.jsonStatePath || options.statePath || DEFAULT_JSON_STATE_PATH,
    sqlitePath: options.sqlitePath || DEFAULT_SQLITE_PATH,
    tenantsRoot: options.tenantsRoot || DEFAULT_TENANTS_ROOT,
    storageMode: options.storageMode || DEFAULT_STORAGE_MODE,
    syncScriptPath: SYNC_SCRIPT_PATH,
    encryptionSecret: options.encryptionSecret || DEFAULT_ENCRYPTION_SECRET,
    encryptionKeyVersion: options.encryptionKeyVersion || 'v1',
    secretSource: options.encryptionSecret
      ? 'option'
      : process.env.MODEL_CATALOG_SECRET
        ? 'env'
        : 'default-dev-secret',
    usesDefaultSecret: !options.encryptionSecret && !process.env.MODEL_CATALOG_SECRET,
    secretSourceType,
    secretSourceRoot,
    defaultTenantId: effectiveDefaultTenantId,
    apiKeys: options.apiKeys,
  });

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', `http://${request.headers.host || `localhost:${port}`}`);

      if (request.method === 'GET' && url.pathname === '/') {
        return sendHtml(response, await fs.readFile(DEMO_PAGE_PATH, 'utf8'));
      }

      if (request.method === 'GET' && url.pathname === '/healthz') {
        const catalog = starterApi.getCatalog();
        return sendJson(response, 200, {
          ok: true,
          generatedAt: catalog?.generatedAt || null,
          providerCount: catalog?.providers?.length || 0,
        });
      }

      if (url.pathname.startsWith('/api/')) {
        const body = request.method === 'GET' || request.method === 'HEAD' ? {} : await readJsonBody(request);
        const result = await starterApi.handleApiRequest({
          method: request.method,
          pathname: url.pathname,
          searchParams: url.searchParams,
          body,
          headers: request.headers,
          remoteAddress: request.socket.remoteAddress || null,
        });
        return sendJson(response, result.statusCode, result.payload);
      }

      sendJson(response, 404, { error: 'not_found' });
    } catch (error) {
      sendJson(response, 500, {
        error: 'internal_error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise((resolve) => {
    server.listen(port, resolve);
  });

  server.on('close', () => {
    starterApi.close();
  });

  const catalog = starterApi.getCatalog();
  const serviceDescription = starterApi.describe();

  return {
    server,
    port,
    catalogPath,
    statePath: path.resolve(effectiveTenantsRoot, effectiveDefaultTenantId, 'runtime-state.json'),
    jsonStatePath: path.resolve(effectiveTenantsRoot, effectiveDefaultTenantId, 'runtime-state.json'),
    sqlitePath: path.resolve(effectiveTenantsRoot, effectiveDefaultTenantId, 'runtime-state.sqlite'),
    runtimeStore: serviceDescription.runtimeStore,
    credentialVault: serviceDescription.credentialVault,
    accessControl: serviceDescription.accessControl,
    tenantServices: serviceDescription.tenantServices,
    secretSourceType,
    secretSourceRoot,
    getCatalog: starterApi.getCatalog,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const instance = await startDemoServer();
  console.log(`Demo server running at http://localhost:${instance.port}`);
  console.log(`Catalog path: ${instance.catalogPath}`);
  console.log(`Runtime store: ${instance.runtimeStore.kind} (${instance.runtimeStore.path})`);
}

function sendHtml(response, body) {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload, null, 2));
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const body = Buffer.concat(chunks).toString('utf8');
  if (!body.trim()) {
    return {};
  }

  return JSON.parse(body);
}
