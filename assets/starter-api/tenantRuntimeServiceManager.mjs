import path from 'node:path';

import { createCatalogRuntimeService } from './catalogRuntimeService.mjs';
import { createProviderConnectionService } from './providerConnectionService.mjs';

export function createTenantRuntimeServiceManager(options = {}) {
  const cache = new Map();
  const rootDir = path.resolve(options.rootDir);
  const catalogPath = path.resolve(options.catalogPath);
  const syncScriptPath = path.resolve(options.syncScriptPath);
  const storageMode = options.storageMode || 'auto';
  const tenantsRoot = path.resolve(
    options.tenantsRoot ||
      path.join(path.dirname(options.jsonStatePath || options.statePath || path.join(rootDir, 'output')), 'tenants'),
  );

  return {
    async getTenantServices(tenantId) {
      const normalizedTenantId = normalizeTenantId(tenantId || 'default');
      if (cache.has(normalizedTenantId)) {
        return cache.get(normalizedTenantId);
      }

      const tenantDir = path.join(tenantsRoot, normalizedTenantId);
      const jsonStatePath = path.join(tenantDir, 'runtime-state.json');
      const sqlitePath = path.join(tenantDir, 'runtime-state.sqlite');

      const runtimeService = await createCatalogRuntimeService({
        rootDir,
        catalogPath,
        jsonStatePath,
        sqlitePath,
        storageMode,
        syncScriptPath,
        allowFallback: options.allowFallback,
        stateOptions: options.stateOptions,
      });

      await runtimeService.ensureCatalog();

      const connectionService = createProviderConnectionService({
        runtimeService,
        encryptionSecret: resolveTenantSecret(options, normalizedTenantId),
        encryptionKeyVersion: options.encryptionKeyVersion || 'v1',
        secretSource: options.secretSource || 'shared',
        usesDefaultSecret: Boolean(options.usesDefaultSecret),
        secretSourceType: options.secretSourceType || 'embedded',
        secretSourceRoot: options.secretSourceRoot,
        tenantId: normalizedTenantId,
      });

      const services = {
        tenantId: normalizedTenantId,
        runtimeService,
        connectionService,
        runtimeStore: runtimeService.getPersistenceInfo(),
        credentialVault: connectionService.getVaultInfo(),
        jsonStatePath,
        sqlitePath,
        close: () => runtimeService.close?.(),
      };

      cache.set(normalizedTenantId, services);
      return services;
    },
    describe: () => ({
      tenantsRoot,
      storageMode,
      secretSourceType: options.secretSourceType || 'embedded',
      secretSourceRoot: options.secretSourceRoot || null,
      cachedTenants: [...cache.keys()],
    }),
    closeAll: () => {
      for (const services of cache.values()) {
        services.close?.();
      }
      cache.clear();
    },
  };
}

function resolveTenantSecret(options, tenantId) {
  if (typeof options.resolveEncryptionSecret === 'function') {
    return options.resolveEncryptionSecret(tenantId);
  }
  return options.encryptionSecret;
}

function normalizeTenantId(value) {
  return String(value || 'default')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-') || 'default';
}
