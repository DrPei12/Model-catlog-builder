#!/usr/bin/env node

import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getProviderSetup,
  listModels,
  listProviders,
} from '../assets/starter-api/modelCatalogService.mjs';
import { createApiAccessControl } from '../assets/starter-api/apiAccessControl.mjs';
import { createTenantRuntimeServiceManager } from '../assets/starter-api/tenantRuntimeServiceManager.mjs';
import { validateProviderCredentials } from '../assets/starter-api/validateProviderCredentials.mjs';

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
  const jsonStatePath = path.resolve(options.jsonStatePath || options.statePath || DEFAULT_JSON_STATE_PATH);
  const sqlitePath = path.resolve(options.sqlitePath || DEFAULT_SQLITE_PATH);
  const storageMode = options.storageMode || DEFAULT_STORAGE_MODE;
  const encryptionSecret = options.encryptionSecret || DEFAULT_ENCRYPTION_SECRET;
  const secretSourceType = options.secretSourceType || DEFAULT_SECRET_SOURCE_TYPE;
  const secretSourceRoot = path.resolve(options.secretSourceRoot || DEFAULT_SECRET_SOURCE_ROOT);
  const accessControl = createApiAccessControl({
    defaultTenantId: options.defaultTenantId || DEFAULT_TENANT_ID,
    apiKeys: options.apiKeys,
  });
  const tenantManager = createTenantRuntimeServiceManager({
    rootDir: ROOT_DIR,
    catalogPath,
    jsonStatePath,
    sqlitePath,
    tenantsRoot: options.tenantsRoot || DEFAULT_TENANTS_ROOT,
    storageMode,
    syncScriptPath: SYNC_SCRIPT_PATH,
    encryptionSecret,
    encryptionKeyVersion: options.encryptionKeyVersion || 'v1',
    secretSource: options.encryptionSecret
      ? 'option'
      : process.env.MODEL_CATALOG_SECRET
        ? 'env'
        : 'default-dev-secret',
    usesDefaultSecret: !options.encryptionSecret && !process.env.MODEL_CATALOG_SECRET,
    secretSourceType,
    secretSourceRoot,
  });

  const defaultTenantServices = await tenantManager.getTenantServices(options.defaultTenantId || DEFAULT_TENANT_ID);
  let catalog = await defaultTenantServices.runtimeService.loadCatalog();

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', `http://${request.headers.host || `localhost:${port}`}`);

      if (request.method === 'GET' && url.pathname === '/') {
        return sendHtml(response, await fs.readFile(DEMO_PAGE_PATH, 'utf8'));
      }

      if (request.method === 'GET' && url.pathname === '/healthz') {
        return sendJson(response, 200, {
          ok: true,
          generatedAt: catalog?.generatedAt || null,
          providerCount: catalog?.providers?.length || 0,
        });
      }

      let requestContext = null;
      let tenantServices = null;

      if (url.pathname.startsWith('/api/')) {
        requestContext = accessControl.resolveRequestContext(request);
        if (!requestContext.ok) {
          return sendJson(response, requestContext.statusCode, requestContext.payload);
        }
        tenantServices = await tenantManager.getTenantServices(requestContext.tenantId);
      }

      if (request.method === 'GET' && url.pathname === '/api/catalog/meta') {
        return sendJson(response, 200, {
          tenantId: requestContext.tenantId,
          generatedAt: catalog?.generatedAt || null,
          sourceStatus: catalog?.sourceStatus || {},
          runtimeStore: tenantServices.runtimeService.getPersistenceInfo(),
          credentialVault: tenantServices.connectionService.getVaultInfo(),
          accessControl: accessControl.describe(),
          tenantServices: tenantManager.describe(),
        });
      }

      if (request.method === 'GET' && url.pathname === '/api/providers') {
        return sendJson(response, 200, {
          providers: listProviders(catalog),
        });
      }

      const providerSetupMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/setup$/);
      if (request.method === 'GET' && providerSetupMatch) {
        const providerId = decodeURIComponent(providerSetupMatch[1]);
        const setup = getProviderSetup(catalog, providerId);
        if (!setup) {
          return sendJson(response, 404, { error: 'provider_not_found' });
        }
        return sendJson(response, 200, setup);
      }

      const providerModelsMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/models$/);
      if (request.method === 'GET' && providerModelsMatch) {
        const providerId = decodeURIComponent(providerModelsMatch[1]);
        const result = listModels(catalog, providerId, parseModelFilters(url));
        if (!result) {
          return sendJson(response, 404, { error: 'provider_not_found' });
        }
        return sendJson(response, 200, result);
      }

      const providerRuntimeMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/runtime$/);
      if (request.method === 'GET' && providerRuntimeMatch) {
        const providerId = decodeURIComponent(providerRuntimeMatch[1]);
        const providerSetup = getProviderSetup(catalog, providerId);
        if (!providerSetup) {
          return sendJson(response, 404, { error: 'provider_not_found' });
        }
        const runtimeState = await tenantServices.runtimeService.getProviderState(providerId);
        return sendJson(response, 200, {
          tenantId: requestContext.tenantId,
          providerId,
          runtime: runtimeState,
        });
      }

      const providerConnectionMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/connection$/);
      if (request.method === 'GET' && providerConnectionMatch) {
        const providerId = decodeURIComponent(providerConnectionMatch[1]);
        const providerSetup = getProviderSetup(catalog, providerId);
        if (!providerSetup) {
          return sendJson(response, 404, { error: 'provider_not_found' });
        }
        const connection = await tenantServices.connectionService.getConnection(providerId);
        return sendJson(response, 200, {
          tenantId: requestContext.tenantId,
          providerId,
          connection,
        });
      }

      const providerAuditEventsMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/audit-events$/);
      if (request.method === 'GET' && providerAuditEventsMatch) {
        const providerId = decodeURIComponent(providerAuditEventsMatch[1]);
        const providerSetup = getProviderSetup(catalog, providerId);
        if (!providerSetup) {
          return sendJson(response, 404, { error: 'provider_not_found' });
        }
        const limit = Number(url.searchParams.get('limit') || '20');
        const auditEvents = await tenantServices.connectionService.getAuditEvents({ providerId, limit });
        return sendJson(response, 200, {
          tenantId: requestContext.tenantId,
          providerId,
          auditEvents,
        });
      }

      const providerValidationRunsMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/validation-runs$/);
      if (request.method === 'GET' && providerValidationRunsMatch) {
        const providerId = decodeURIComponent(providerValidationRunsMatch[1]);
        const providerSetup = getProviderSetup(catalog, providerId);
        if (!providerSetup) {
          return sendJson(response, 404, { error: 'provider_not_found' });
        }
        const limit = Number(url.searchParams.get('limit') || '20');
        const validationRuns = await tenantServices.runtimeService.getValidationRuns({ providerId, limit });
        return sendJson(response, 200, {
          tenantId: requestContext.tenantId,
          providerId,
          validationRuns,
        });
      }

      const providerValidateMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/validate$/);
      if (request.method === 'POST' && providerValidateMatch) {
        const providerId = decodeURIComponent(providerValidateMatch[1]);
        const providerSetup = getProviderSetup(catalog, providerId);
        if (!providerSetup) {
          return sendJson(response, 404, { error: 'provider_not_found' });
        }
        const body = await readJsonBody(request);
        const validationResult = await validateProviderCredentials(providerSetup, body?.credentials || {});
        const result = await tenantServices.runtimeService.recordValidationRun(validationResult);
        return sendJson(response, 200, result);
      }

      const providerConnectMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/connect$/);
      if (request.method === 'POST' && providerConnectMatch) {
        const providerId = decodeURIComponent(providerConnectMatch[1]);
        const providerSetup = getProviderSetup(catalog, providerId);
        if (!providerSetup) {
          return sendJson(response, 404, { error: 'provider_not_found' });
        }
        const body = await readJsonBody(request);
        const result = await tenantServices.connectionService.connectProvider(
          providerSetup,
          body?.credentials || {},
          body?.actor || createDemoActor(requestContext),
        );
        return sendJson(response, result.ok ? 200 : 400, result);
      }

      const providerRotateMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/rotate$/);
      if (request.method === 'POST' && providerRotateMatch) {
        const providerId = decodeURIComponent(providerRotateMatch[1]);
        const providerSetup = getProviderSetup(catalog, providerId);
        if (!providerSetup) {
          return sendJson(response, 404, { error: 'provider_not_found' });
        }
        const body = await readJsonBody(request);
        const result = await tenantServices.connectionService.rotateProviderCredentials(
          providerSetup,
          body?.credentials || {},
          body?.actor || createDemoActor(requestContext),
        );
        return sendJson(response, result.ok ? 200 : 400, result);
      }

      const providerRevalidateMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/revalidate$/);
      if (request.method === 'POST' && providerRevalidateMatch) {
        const providerId = decodeURIComponent(providerRevalidateMatch[1]);
        const providerSetup = getProviderSetup(catalog, providerId);
        if (!providerSetup) {
          return sendJson(response, 404, { error: 'provider_not_found' });
        }
        const body = await readJsonBody(request);
        const result = await tenantServices.connectionService.revalidateProvider(
          providerSetup,
          body?.actor || createDemoActor(requestContext),
        );
        return sendJson(response, result.ok ? 200 : 400, result);
      }

      if (request.method === 'DELETE' && providerConnectionMatch) {
        const providerId = decodeURIComponent(providerConnectionMatch[1]);
        const providerSetup = getProviderSetup(catalog, providerId);
        if (!providerSetup) {
          return sendJson(response, 404, { error: 'provider_not_found' });
        }
        const body = await readJsonBody(request);
        const result = await tenantServices.connectionService.disconnectProvider(
          providerId,
          body?.actor || createDemoActor(requestContext),
        );
        return sendJson(response, result.ok ? 200 : 404, result);
      }

      const providerRefreshMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/refresh$/);
      if (request.method === 'POST' && providerRefreshMatch) {
        const providerId = decodeURIComponent(providerRefreshMatch[1]);
        const providerSetup = getProviderSetup(catalog, providerId);
        if (!providerSetup) {
          return sendJson(response, 404, { error: 'provider_not_found' });
        }

        const result = await tenantServices.runtimeService.refreshProvider(providerId);
        if (result.ok) {
          catalog = await tenantServices.runtimeService.loadCatalog();
        }
        return sendJson(response, result.ok ? 200 : 500, result);
      }

      if (request.method === 'GET' && url.pathname === '/api/operations/refresh-runs') {
        const providerId = url.searchParams.get('providerId') || null;
        const limit = Number(url.searchParams.get('limit') || '20');
        const refreshRuns = await tenantServices.runtimeService.getRefreshRuns({ providerId, limit });
        return sendJson(response, 200, { tenantId: requestContext.tenantId, refreshRuns });
      }

      if (request.method === 'GET' && url.pathname === '/api/operations/validation-runs') {
        const providerId = url.searchParams.get('providerId') || null;
        const limit = Number(url.searchParams.get('limit') || '20');
        const validationRuns = await tenantServices.runtimeService.getValidationRuns({ providerId, limit });
        return sendJson(response, 200, { tenantId: requestContext.tenantId, validationRuns });
      }

      if (request.method === 'GET' && url.pathname === '/api/operations/connections') {
        const connections = await tenantServices.connectionService.listConnections();
        return sendJson(response, 200, { tenantId: requestContext.tenantId, connections });
      }

      if (request.method === 'GET' && url.pathname === '/api/operations/audit-events') {
        const providerId = url.searchParams.get('providerId') || null;
        const limit = Number(url.searchParams.get('limit') || '20');
        const auditEvents = await tenantServices.connectionService.getAuditEvents({ providerId, limit });
        return sendJson(response, 200, { tenantId: requestContext.tenantId, auditEvents });
      }

      if (request.method === 'POST' && url.pathname === '/api/refresh') {
        const result = await tenantServices.runtimeService.refreshAllProviders();
        if (result.ok) {
          catalog = await tenantServices.runtimeService.loadCatalog();
        }
        return sendJson(response, result.ok ? 200 : 500, result);
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
    tenantManager.closeAll();
  });

  return {
    server,
    port,
    catalogPath,
    statePath: defaultTenantServices.jsonStatePath,
    jsonStatePath: defaultTenantServices.jsonStatePath,
    sqlitePath: defaultTenantServices.sqlitePath,
    runtimeStore: defaultTenantServices.runtimeStore,
    credentialVault: defaultTenantServices.credentialVault,
    accessControl: accessControl.describe(),
    tenantServices: tenantManager.describe(),
    secretSourceType,
    secretSourceRoot,
    getCatalog: () => catalog,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const instance = await startDemoServer();
  console.log(`Demo server running at http://localhost:${instance.port}`);
  console.log(`Catalog path: ${instance.catalogPath}`);
  console.log(`Runtime store: ${instance.runtimeStore.kind} (${instance.runtimeStore.path})`);
}

function parseModelFilters(url) {
  const capabilities = [];
  for (const value of url.searchParams.getAll('capability')) {
    for (const item of value.split(',')) {
      if (item.trim()) {
        capabilities.push(item.trim());
      }
    }
  }

  return {
    group: url.searchParams.get('group') || 'all',
    query: url.searchParams.get('query') || '',
    includePreview: parseBoolean(url.searchParams.get('includePreview')),
    includeDeprecated: parseBoolean(url.searchParams.get('includeDeprecated')),
    capabilities,
  };
}

function parseBoolean(value) {
  return value === 'true' || value === '1';
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

function createDemoActor(requestContext) {
  return {
    type: requestContext.actor.type,
    id: requestContext.actor.id,
  };
}
