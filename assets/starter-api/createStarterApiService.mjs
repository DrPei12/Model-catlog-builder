import path from 'node:path';

import { getProviderSetup, listModels, listProviders } from './modelCatalogService.mjs';
import { createApiAccessControl } from './apiAccessControl.mjs';
import { createTenantRuntimeServiceManager } from './tenantRuntimeServiceManager.mjs';
import { validateProviderCredentials } from './validateProviderCredentials.mjs';

const DEFAULT_ENCRYPTION_SECRET = 'model-catlog-builder-dev-secret';

export async function createStarterApiService(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const catalogPath = path.resolve(options.catalogPath || path.join(rootDir, 'output', 'model-catalog.generated.json'));
  const jsonStatePath = path.resolve(options.jsonStatePath || options.statePath || path.join(rootDir, 'output', 'runtime-state.json'));
  const sqlitePath = path.resolve(options.sqlitePath || path.join(rootDir, 'output', 'runtime-state.sqlite'));
  const storageMode = options.storageMode || 'auto';
  const effectiveEncryptionSecret =
    options.encryptionSecret ||
    process.env.MODEL_CATALOG_SECRET ||
    DEFAULT_ENCRYPTION_SECRET;
  const usesDefaultSecret = !options.encryptionSecret && !process.env.MODEL_CATALOG_SECRET;
  const accessControl = createApiAccessControl({
    defaultTenantId: options.defaultTenantId || 'default',
    apiKeys: options.apiKeys,
  });
  const tenantManager = createTenantRuntimeServiceManager({
    rootDir,
    catalogPath,
    jsonStatePath,
    sqlitePath,
    tenantsRoot: options.tenantsRoot,
    storageMode,
    syncScriptPath: path.resolve(options.syncScriptPath || path.join(rootDir, 'scripts', 'sync_model_catalog.mjs')),
    encryptionSecret: effectiveEncryptionSecret,
    encryptionKeyVersion: options.encryptionKeyVersion || 'v1',
    secretSource:
      options.secretSource ||
      (options.encryptionSecret
        ? 'option'
        : process.env.MODEL_CATALOG_SECRET
          ? 'env'
          : 'default-dev-secret'),
    usesDefaultSecret: options.usesDefaultSecret ?? usesDefaultSecret,
    secretSourceType: options.secretSourceType || 'embedded',
    secretSourceRoot: options.secretSourceRoot,
  });

  const defaultTenantServices = await tenantManager.getTenantServices(options.defaultTenantId || 'default');
  let catalog = await defaultTenantServices.runtimeService.loadCatalog();

  return {
    getCatalog: () => catalog,
    describe: () => ({
      catalogPath,
      accessControl: accessControl.describe(),
      tenantServices: tenantManager.describe(),
      defaultTenant: defaultTenantServices.tenantId,
      runtimeStore: defaultTenantServices.runtimeStore,
      credentialVault: defaultTenantServices.credentialVault,
    }),
    close: () => tenantManager.closeAll(),
    handleApiRequest: async (requestLike) => {
      const requestContext = accessControl.resolveRequestContext({
        headers: requestLike.headers || {},
        socket: {
          remoteAddress: requestLike.remoteAddress || null,
        },
      });

      if (!requestContext.ok) {
        return {
          statusCode: requestContext.statusCode,
          payload: requestContext.payload,
        };
      }

      const tenantServices = await tenantManager.getTenantServices(requestContext.tenantId);
      const pathname = requestLike.pathname;
      const method = String(requestLike.method || 'GET').toUpperCase();
      const searchParams = asSearchParams(requestLike.searchParams);
      const body = requestLike.body || {};

      if (method === 'GET' && pathname === '/api/catalog/meta') {
        return ok({
          tenantId: requestContext.tenantId,
          generatedAt: catalog?.generatedAt || null,
          sourceStatus: catalog?.sourceStatus || {},
          runtimeStore: tenantServices.runtimeService.getPersistenceInfo(),
          credentialVault: tenantServices.connectionService.getVaultInfo(),
          accessControl: accessControl.describe(),
          tenantServices: tenantManager.describe(),
        });
      }

      if (method === 'GET' && pathname === '/api/providers') {
        return ok({
          tenantId: requestContext.tenantId,
          providers: listProviders(catalog),
        });
      }

      const providerSetupMatch = pathname.match(/^\/api\/providers\/([^/]+)\/setup$/);
      if (method === 'GET' && providerSetupMatch) {
        const providerId = decodeURIComponent(providerSetupMatch[1]);
        const setup = getRequiredProviderSetup(catalog, providerId);
        if (!setup) {
          return notFound();
        }
        return ok(setup);
      }

      const providerModelsMatch = pathname.match(/^\/api\/providers\/([^/]+)\/models$/);
      if (method === 'GET' && providerModelsMatch) {
        const providerId = decodeURIComponent(providerModelsMatch[1]);
        const result = listModels(catalog, providerId, parseModelFilters(searchParams));
        if (!result) {
          return notFound();
        }
        return ok(result);
      }

      const providerRuntimeMatch = pathname.match(/^\/api\/providers\/([^/]+)\/runtime$/);
      if (method === 'GET' && providerRuntimeMatch) {
        const providerId = decodeURIComponent(providerRuntimeMatch[1]);
        const setup = getRequiredProviderSetup(catalog, providerId);
        if (!setup) {
          return notFound();
        }
        return ok({
          tenantId: requestContext.tenantId,
          providerId,
          runtime: await tenantServices.runtimeService.getProviderState(providerId),
        });
      }

      const providerConnectionMatch = pathname.match(/^\/api\/providers\/([^/]+)\/connection$/);
      if (method === 'GET' && providerConnectionMatch) {
        const providerId = decodeURIComponent(providerConnectionMatch[1]);
        const setup = getRequiredProviderSetup(catalog, providerId);
        if (!setup) {
          return notFound();
        }
        return ok({
          tenantId: requestContext.tenantId,
          providerId,
          connection: await tenantServices.connectionService.getConnection(providerId),
        });
      }

      if (method === 'DELETE' && providerConnectionMatch) {
        const providerId = decodeURIComponent(providerConnectionMatch[1]);
        const setup = getRequiredProviderSetup(catalog, providerId);
        if (!setup) {
          return notFound();
        }
        const result = await tenantServices.connectionService.disconnectProvider(
          providerId,
          body?.actor || createActorFromContext(requestContext),
        );
        return {
          statusCode: result.ok ? 200 : 404,
          payload: result,
        };
      }

      const providerAuditEventsMatch = pathname.match(/^\/api\/providers\/([^/]+)\/audit-events$/);
      if (method === 'GET' && providerAuditEventsMatch) {
        const providerId = decodeURIComponent(providerAuditEventsMatch[1]);
        const setup = getRequiredProviderSetup(catalog, providerId);
        if (!setup) {
          return notFound();
        }
        return ok({
          tenantId: requestContext.tenantId,
          providerId,
          auditEvents: await tenantServices.connectionService.getAuditEvents({
            providerId,
            limit: Number(searchParams.get('limit') || '20'),
          }),
        });
      }

      const providerValidationRunsMatch = pathname.match(/^\/api\/providers\/([^/]+)\/validation-runs$/);
      if (method === 'GET' && providerValidationRunsMatch) {
        const providerId = decodeURIComponent(providerValidationRunsMatch[1]);
        const setup = getRequiredProviderSetup(catalog, providerId);
        if (!setup) {
          return notFound();
        }
        return ok({
          tenantId: requestContext.tenantId,
          providerId,
          validationRuns: await tenantServices.runtimeService.getValidationRuns({
            providerId,
            limit: Number(searchParams.get('limit') || '20'),
          }),
        });
      }

      const providerValidateMatch = pathname.match(/^\/api\/providers\/([^/]+)\/validate$/);
      if (method === 'POST' && providerValidateMatch) {
        const providerId = decodeURIComponent(providerValidateMatch[1]);
        const setup = getRequiredProviderSetup(catalog, providerId);
        if (!setup) {
          return notFound();
        }
        const validationResult = await validateProviderCredentials(setup, body?.credentials || {});
        return ok(await tenantServices.runtimeService.recordValidationRun(validationResult));
      }

      const providerConnectMatch = pathname.match(/^\/api\/providers\/([^/]+)\/connect$/);
      if (method === 'POST' && providerConnectMatch) {
        const providerId = decodeURIComponent(providerConnectMatch[1]);
        const setup = getRequiredProviderSetup(catalog, providerId);
        if (!setup) {
          return notFound();
        }
        const result = await tenantServices.connectionService.connectProvider(
          setup,
          body?.credentials || {},
          body?.actor || createActorFromContext(requestContext),
        );
        return {
          statusCode: result.ok ? 200 : 400,
          payload: result,
        };
      }

      const providerRotateMatch = pathname.match(/^\/api\/providers\/([^/]+)\/rotate$/);
      if (method === 'POST' && providerRotateMatch) {
        const providerId = decodeURIComponent(providerRotateMatch[1]);
        const setup = getRequiredProviderSetup(catalog, providerId);
        if (!setup) {
          return notFound();
        }
        const result = await tenantServices.connectionService.rotateProviderCredentials(
          setup,
          body?.credentials || {},
          body?.actor || createActorFromContext(requestContext),
        );
        return {
          statusCode: result.ok ? 200 : 400,
          payload: result,
        };
      }

      const providerRevalidateMatch = pathname.match(/^\/api\/providers\/([^/]+)\/revalidate$/);
      if (method === 'POST' && providerRevalidateMatch) {
        const providerId = decodeURIComponent(providerRevalidateMatch[1]);
        const setup = getRequiredProviderSetup(catalog, providerId);
        if (!setup) {
          return notFound();
        }
        const result = await tenantServices.connectionService.revalidateProvider(
          setup,
          body?.actor || createActorFromContext(requestContext),
        );
        return {
          statusCode: result.ok ? 200 : 400,
          payload: result,
        };
      }

      const providerRefreshMatch = pathname.match(/^\/api\/providers\/([^/]+)\/refresh$/);
      if (method === 'POST' && providerRefreshMatch) {
        const providerId = decodeURIComponent(providerRefreshMatch[1]);
        const setup = getRequiredProviderSetup(catalog, providerId);
        if (!setup) {
          return notFound();
        }
        const result = await tenantServices.runtimeService.refreshProvider(providerId);
        if (result.ok) {
          catalog = await tenantServices.runtimeService.loadCatalog();
        }
        return {
          statusCode: result.ok ? 200 : 500,
          payload: result,
        };
      }

      if (method === 'GET' && pathname === '/api/operations/refresh-runs') {
        return ok({
          tenantId: requestContext.tenantId,
          refreshRuns: await tenantServices.runtimeService.getRefreshRuns({
            providerId: searchParams.get('providerId') || null,
            limit: Number(searchParams.get('limit') || '20'),
          }),
        });
      }

      if (method === 'GET' && pathname === '/api/operations/validation-runs') {
        return ok({
          tenantId: requestContext.tenantId,
          validationRuns: await tenantServices.runtimeService.getValidationRuns({
            providerId: searchParams.get('providerId') || null,
            limit: Number(searchParams.get('limit') || '20'),
          }),
        });
      }

      if (method === 'GET' && pathname === '/api/operations/connections') {
        return ok({
          tenantId: requestContext.tenantId,
          connections: await tenantServices.connectionService.listConnections(),
        });
      }

      if (method === 'GET' && pathname === '/api/operations/audit-events') {
        return ok({
          tenantId: requestContext.tenantId,
          auditEvents: await tenantServices.connectionService.getAuditEvents({
            providerId: searchParams.get('providerId') || null,
            limit: Number(searchParams.get('limit') || '20'),
          }),
        });
      }

      if (method === 'POST' && pathname === '/api/refresh') {
        const result = await tenantServices.runtimeService.refreshAllProviders();
        if (result.ok) {
          catalog = await tenantServices.runtimeService.loadCatalog();
        }
        return {
          statusCode: result.ok ? 200 : 500,
          payload: result,
        };
      }

      return {
        statusCode: 404,
        payload: {
          error: 'not_found',
        },
      };
    },
  };
}

function asSearchParams(searchParams) {
  if (searchParams instanceof URLSearchParams) {
    return searchParams;
  }

  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams || {})) {
    if (Array.isArray(value)) {
      for (const item of value) {
        next.append(key, item);
      }
      continue;
    }
    if (value !== undefined && value !== null) {
      next.set(key, String(value));
    }
  }
  return next;
}

function getRequiredProviderSetup(catalog, providerId) {
  return getProviderSetup(catalog, providerId);
}

function createActorFromContext(requestContext) {
  return {
    type: requestContext.actor.type,
    id: requestContext.actor.id,
  };
}

function parseModelFilters(searchParams) {
  const capabilities = [];
  for (const value of searchParams.getAll('capability')) {
    for (const item of value.split(',')) {
      if (item.trim()) {
        capabilities.push(item.trim());
      }
    }
  }

  return {
    group: searchParams.get('group') || 'all',
    query: searchParams.get('query') || '',
    includePreview: parseBoolean(searchParams.get('includePreview')),
    includeDeprecated: parseBoolean(searchParams.get('includeDeprecated')),
    capabilities,
  };
}

function parseBoolean(value) {
  return value === 'true' || value === '1';
}

function ok(payload) {
  return {
    statusCode: 200,
    payload,
  };
}

function notFound() {
  return {
    statusCode: 404,
    payload: {
      error: 'provider_not_found',
    },
  };
}
