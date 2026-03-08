import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { loadCatalog } from './modelCatalogService.mjs';
import { createRuntimePersistenceStore } from './runtimePersistenceStore.mjs';

export async function createCatalogRuntimeService(options) {
  const rootDir = path.resolve(options.rootDir);
  const catalogPath = path.resolve(options.catalogPath);
  const syncScriptPath = path.resolve(options.syncScriptPath);

  const persistenceStore = await createRuntimePersistenceStore({
    storageMode: options.storageMode,
    sqlitePath: options.sqlitePath,
    jsonStatePath: options.jsonStatePath || options.statePath,
    allowFallback: options.allowFallback,
    stateOptions: options.stateOptions,
  });

  return {
    ensureCatalog: () => ensureCatalog(catalogPath, syncScriptPath, rootDir),
    loadCatalog: () => loadCatalog(catalogPath),
    getRefreshRuns: (query) => persistenceStore.getRefreshRuns(query),
    getValidationRuns: (query) => persistenceStore.getValidationRuns(query),
    getProviderState: (providerId) => persistenceStore.getProviderState(providerId),
    recordValidationRun: (result) => persistenceStore.recordValidationRun(result),
    getPersistenceInfo: () => ({
      kind: persistenceStore.kind,
      path: persistenceStore.path,
      preferredKind: persistenceStore.preferredKind || persistenceStore.kind,
      availablePaths: persistenceStore.availablePaths || null,
      fallbackReason: persistenceStore.fallbackReason || null,
    }),
    close: () => persistenceStore.close?.(),
    refreshAllProviders: async () => {
      const startedAt = new Date().toISOString();

      try {
        await runCatalogSync({
          syncScriptPath,
          rootDir,
          outputPath: catalogPath,
        });

        const catalog = await loadCatalog(catalogPath);
        const run = await persistenceStore.recordRefreshRun({
          scope: 'global',
          status: 'success',
          startedAt,
          completedAt: new Date().toISOString(),
          generatedAt: catalog.generatedAt,
          sourceStatus: catalog.sourceStatus,
          providerSummaries: summarizeProviders(catalog.providers || []),
        });

        return {
          ok: true,
          ...run,
          providerCount: (catalog.providers || []).length,
        };
      } catch (error) {
        const run = await persistenceStore.recordRefreshRun({
          scope: 'global',
          status: 'error',
          startedAt,
          completedAt: new Date().toISOString(),
          errorMessage: error instanceof Error ? error.message : String(error),
        });

        return {
          ok: false,
          ...run,
        };
      }
    },
    refreshProvider: async (providerId) => {
      const startedAt = new Date().toISOString();
      const tempCatalogPath = path.join(path.dirname(catalogPath), `.provider-refresh-${providerId}.json`);

      try {
        await ensureCatalog(catalogPath, syncScriptPath, rootDir);
        const currentCatalog = await loadCatalog(catalogPath);

        await runCatalogSync({
          syncScriptPath,
          rootDir,
          outputPath: tempCatalogPath,
          providerId,
        });

        const scopedCatalog = await loadCatalog(tempCatalogPath);
        const refreshedProvider = (scopedCatalog.providers || []).find((provider) => provider.providerId === providerId);
        if (!refreshedProvider) {
          throw new Error(`Scoped refresh did not return provider "${providerId}".`);
        }

        const mergedCatalog = mergeScopedProviderIntoCatalog(currentCatalog, refreshedProvider, scopedCatalog.sourceStatus);
        await fs.writeFile(catalogPath, JSON.stringify(mergedCatalog, null, 2) + '\n', 'utf8');

        const run = await persistenceStore.recordRefreshRun({
          scope: 'provider',
          providerId,
          status: 'success',
          startedAt,
          completedAt: new Date().toISOString(),
          generatedAt: mergedCatalog.generatedAt,
          sourceStatus: scopedCatalog.sourceStatus,
          providerSummary: summarizeProvider(refreshedProvider),
        });

        return {
          ok: true,
          ...run,
        };
      } catch (error) {
        const run = await persistenceStore.recordRefreshRun({
          scope: 'provider',
          providerId,
          status: 'error',
          startedAt,
          completedAt: new Date().toISOString(),
          errorMessage: error instanceof Error ? error.message : String(error),
        });

        return {
          ok: false,
          ...run,
        };
      } finally {
        await fs.rm(tempCatalogPath, { force: true }).catch(() => {});
      }
    },
  };
}

async function ensureCatalog(catalogPath, syncScriptPath, rootDir) {
  try {
    await fs.access(catalogPath);
  } catch {
    await runCatalogSync({
      syncScriptPath,
      rootDir,
      outputPath: catalogPath,
    });
  }
}

async function runCatalogSync({ syncScriptPath, rootDir, outputPath, providerId = null }) {
  const args = [syncScriptPath, '--output', outputPath];
  if (providerId) {
    args.push('--providers', providerId);
  }

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: rootDir,
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

function mergeScopedProviderIntoCatalog(currentCatalog, refreshedProvider, scopedSourceStatus) {
  const providers = [...(currentCatalog.providers || [])];
  const index = providers.findIndex((provider) => provider.providerId === refreshedProvider.providerId);
  if (index >= 0) {
    providers[index] = refreshedProvider;
  } else {
    providers.push(refreshedProvider);
  }

  return {
    ...currentCatalog,
    generatedAt: new Date().toISOString(),
    sourceStatus: {
      ...(currentCatalog.sourceStatus || {}),
      ...(scopedSourceStatus || {}),
    },
    providers: providers.sort((left, right) => left.displayName.localeCompare(right.displayName)),
  };
}

function summarizeProviders(providers) {
  return providers.map(summarizeProvider);
}

function summarizeProvider(provider) {
  return {
    providerId: provider.providerId,
    displayName: provider.displayName,
    modelCount: provider.modelCount ?? (provider.models || []).length,
    latestCount: provider.collections?.latestIds?.length || 0,
    recommendedCount:
      (provider.collections?.recommendedIds?.length || 0) +
      (provider.collections?.autoRecommendedIds?.length || 0),
    availabilitySource: provider.availabilitySource || 'unknown',
  };
}
