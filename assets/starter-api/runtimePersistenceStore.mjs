import path from 'node:path';

import { createRuntimeStateStore } from './runtimeStateStore.mjs';

export async function createRuntimePersistenceStore(options = {}) {
  const storageMode = options.storageMode || 'auto';
  const allowFallback = options.allowFallback !== false;
  const stateOptions = options.stateOptions || {};
  const jsonStatePath = path.resolve(options.jsonStatePath || options.statePath || 'runtime-state.json');
  const sqlitePath = path.resolve(options.sqlitePath || deriveSqlitePath(jsonStatePath));

  if (storageMode === 'json') {
    const store = await createRuntimeStateStore(jsonStatePath, stateOptions);
    return attachStoreMetadata(store, {
      preferredKind: 'json',
      availablePaths: {
        jsonStatePath,
        sqlitePath,
      },
    });
  }

  try {
    const { createSqliteRuntimeStore } = await import('./sqliteRuntimeStore.mjs');
    const store = await createSqliteRuntimeStore(sqlitePath, stateOptions);
    return attachStoreMetadata(store, {
      preferredKind: 'sqlite',
      availablePaths: {
        jsonStatePath,
        sqlitePath,
      },
      fallbackReason: null,
    });
  } catch (error) {
    if (storageMode === 'sqlite' || !allowFallback) {
      throw error;
    }

    const store = await createRuntimeStateStore(jsonStatePath, stateOptions);
    return attachStoreMetadata(store, {
      preferredKind: 'sqlite',
      availablePaths: {
        jsonStatePath,
        sqlitePath,
      },
      fallbackReason: error instanceof Error ? error.message : String(error),
    });
  }
}

function deriveSqlitePath(jsonStatePath) {
  if (/\.json$/i.test(jsonStatePath)) {
    return jsonStatePath.replace(/\.json$/i, '.sqlite');
  }
  return `${jsonStatePath}.sqlite`;
}

function attachStoreMetadata(store, metadata) {
  Object.assign(store, metadata);
  return store;
}
