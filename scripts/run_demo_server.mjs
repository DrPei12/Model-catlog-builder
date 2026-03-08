#!/usr/bin/env node

import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  getProviderSetup,
  listModels,
  listProviders,
  loadCatalog,
} from '../assets/starter-api/modelCatalogService.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_PORT = Number(process.env.PORT || '4177');
const DEFAULT_CATALOG_PATH = path.resolve(process.env.CATALOG_PATH || path.join(ROOT_DIR, 'output', 'model-catalog.generated.json'));
const DEMO_PAGE_PATH = path.join(ROOT_DIR, 'assets', 'starter-api', 'demoPage.html');

export async function startDemoServer(options = {}) {
  const port = Number(options.port || DEFAULT_PORT);
  const catalogPath = path.resolve(options.catalogPath || DEFAULT_CATALOG_PATH);

  await ensureCatalog(catalogPath);
  let catalog = await loadCatalog(catalogPath);

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

      const providerValidateMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/validate$/);
      if (request.method === 'POST' && providerValidateMatch) {
        const providerId = decodeURIComponent(providerValidateMatch[1]);
        if (!getProviderSetup(catalog, providerId)) {
          return sendJson(response, 404, { error: 'provider_not_found' });
        }
        return sendJson(response, 501, {
          ok: false,
          providerId,
          errorCode: 'not_implemented',
          errorMessage: 'Credential validation is the next production step. This demo only exposes catalog and setup APIs.',
        });
      }

      if (request.method === 'POST' && url.pathname === '/api/refresh') {
        const summary = await refreshCatalog();
        return sendJson(response, 200, summary);
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

  return {
    server,
    port,
    catalogPath,
    getCatalog: () => catalog,
  };

  async function refreshCatalog() {
    const startedAt = new Date().toISOString();
    await runCatalogSync(catalogPath);
    catalog = await loadCatalog(catalogPath);
    return {
      ok: true,
      startedAt,
      completedAt: new Date().toISOString(),
      generatedAt: catalog.generatedAt,
      sourceStatus: catalog.sourceStatus,
      providerCount: catalog.providers?.length || 0,
    };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const instance = await startDemoServer();
  console.log(`Demo server running at http://localhost:${instance.port}`);
  console.log(`Catalog path: ${instance.catalogPath}`);
}

async function ensureCatalog(catalogPath) {
  try {
    await fs.access(catalogPath);
  } catch {
    await runCatalogSync(catalogPath);
  }
}

async function runCatalogSync(catalogPath) {
  const scriptPath = path.join(ROOT_DIR, 'scripts', 'sync_model_catalog.mjs');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, '--output', catalogPath], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      env: process.env,
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Catalog sync failed with exit code ${code}`));
    });
    child.on('error', reject);
  });
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
