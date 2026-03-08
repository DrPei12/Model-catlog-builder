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
import { createCatalogRuntimeService } from '../assets/starter-api/catalogRuntimeService.mjs';
import { createProviderConnectionService } from '../assets/starter-api/providerConnectionService.mjs';
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
const SYNC_SCRIPT_PATH = path.join(ROOT_DIR, 'scripts', 'sync_model_catalog.mjs');
const DEMO_PAGE_PATH = path.join(ROOT_DIR, 'assets', 'starter-api', 'demoPage.html');

export async function startDemoServer(options = {}) {
  const port = Number(options.port || DEFAULT_PORT);
  const catalogPath = path.resolve(options.catalogPath || DEFAULT_CATALOG_PATH);
  const jsonStatePath = path.resolve(options.jsonStatePath || options.statePath || DEFAULT_JSON_STATE_PATH);
  const sqlitePath = path.resolve(options.sqlitePath || DEFAULT_SQLITE_PATH);
  const storageMode = options.storageMode || DEFAULT_STORAGE_MODE;
  const encryptionSecret = options.encryptionSecret || DEFAULT_ENCRYPTION_SECRET;

  const runtime = await createCatalogRuntimeService({
    rootDir: ROOT_DIR,
    catalogPath,
    jsonStatePath,
    sqlitePath,
    storageMode,
    syncScriptPath: SYNC_SCRIPT_PATH,
  });

  await runtime.ensureCatalog();
  let catalog = await runtime.loadCatalog();
  const runtimeStore = runtime.getPersistenceInfo();
  const connectionService = createProviderConnectionService({
    runtimeService: runtime,
    encryptionSecret,
    encryptionKeyVersion: options.encryptionKeyVersion || 'v1',
    secretSource: options.encryptionSecret
      ? 'option'
      : process.env.MODEL_CATALOG_SECRET
        ? 'env'
        : 'default-dev-secret',
    usesDefaultSecret: !options.encryptionSecret && !process.env.MODEL_CATALOG_SECRET,
  });

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

      if (request.method === 'GET' && url.pathname === '/api/catalog/meta') {
        return sendJson(response, 200, {
          generatedAt: catalog?.generatedAt || null,
          sourceStatus: catalog?.sourceStatus || {},
          runtimeStore,
          credentialVault: connectionService.getVaultInfo(),
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
        const runtimeState = await runtime.getProviderState(providerId);
        return sendJson(response, 200, {
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
        const connection = await connectionService.getConnection(providerId);
        return sendJson(response, 200, {
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
        const auditEvents = await connectionService.getAuditEvents({ providerId, limit });
        return sendJson(response, 200, {
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
        const validationRuns = await runtime.getValidationRuns({ providerId, limit });
        return sendJson(response, 200, {
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
        const result = await runtime.recordValidationRun(validationResult);
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
        const result = await connectionService.connectProvider(
          providerSetup,
          body?.credentials || {},
          body?.actor || createDemoActor(request),
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
        const result = await connectionService.revalidateProvider(
          providerSetup,
          body?.actor || createDemoActor(request),
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
        const result = await connectionService.disconnectProvider(
          providerId,
          body?.actor || createDemoActor(request),
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

        const result = await runtime.refreshProvider(providerId);
        if (result.ok) {
          catalog = await runtime.loadCatalog();
        }
        return sendJson(response, result.ok ? 200 : 500, result);
      }

      if (request.method === 'GET' && url.pathname === '/api/operations/refresh-runs') {
        const providerId = url.searchParams.get('providerId') || null;
        const limit = Number(url.searchParams.get('limit') || '20');
        const refreshRuns = await runtime.getRefreshRuns({ providerId, limit });
        return sendJson(response, 200, { refreshRuns });
      }

      if (request.method === 'GET' && url.pathname === '/api/operations/validation-runs') {
        const providerId = url.searchParams.get('providerId') || null;
        const limit = Number(url.searchParams.get('limit') || '20');
        const validationRuns = await runtime.getValidationRuns({ providerId, limit });
        return sendJson(response, 200, { validationRuns });
      }

      if (request.method === 'GET' && url.pathname === '/api/operations/connections') {
        const connections = await connectionService.listConnections();
        return sendJson(response, 200, { connections });
      }

      if (request.method === 'GET' && url.pathname === '/api/operations/audit-events') {
        const providerId = url.searchParams.get('providerId') || null;
        const limit = Number(url.searchParams.get('limit') || '20');
        const auditEvents = await connectionService.getAuditEvents({ providerId, limit });
        return sendJson(response, 200, { auditEvents });
      }

      if (request.method === 'POST' && url.pathname === '/api/refresh') {
        const result = await runtime.refreshAllProviders();
        if (result.ok) {
          catalog = await runtime.loadCatalog();
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
    runtime.close?.();
  });

  return {
    server,
    port,
    catalogPath,
    statePath: jsonStatePath,
    jsonStatePath,
    sqlitePath,
    runtimeStore,
    credentialVault: connectionService.getVaultInfo(),
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

function createDemoActor(request) {
  return {
    type: 'demo-user',
    id: request.headers['x-forwarded-for'] || request.socket.remoteAddress || 'local-demo',
  };
}
