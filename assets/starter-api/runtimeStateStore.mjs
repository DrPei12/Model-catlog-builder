import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_STATE = {
  schemaVersion: 1,
  updatedAt: null,
  refreshRuns: [],
  validationRuns: [],
  providers: {},
};

export async function createRuntimeStateStore(statePath, options = {}) {
  const resolvedPath = path.resolve(statePath);
  const maxRuns = options.maxRuns ?? 200;

  await ensureStateFile(resolvedPath);

  return {
    kind: 'json',
    path: resolvedPath,
    load: () => loadState(resolvedPath),
    getRefreshRuns: async ({ providerId = null, limit = 50 } = {}) => {
      const state = await loadState(resolvedPath);
      return state.refreshRuns
        .filter((run) => !providerId || run.providerId === providerId || run.scope === 'global')
        .slice(0, limit);
    },
    getValidationRuns: async ({ providerId = null, limit = 50 } = {}) => {
      const state = await loadState(resolvedPath);
      return state.validationRuns
        .filter((run) => !providerId || run.providerId === providerId)
        .slice(0, limit);
    },
    getProviderState: async (providerId) => {
      const state = await loadState(resolvedPath);
      return state.providers[providerId] || null;
    },
    recordRefreshRun: async (run) => {
      const state = await loadState(resolvedPath);
      const nextRun = normalizeRefreshRun(run);

      state.refreshRuns.unshift(nextRun);
      state.refreshRuns = state.refreshRuns.slice(0, maxRuns);
      state.updatedAt = new Date().toISOString();

      if (nextRun.providerId) {
        state.providers[nextRun.providerId] = applyProviderRefreshState(
          state.providers[nextRun.providerId],
          nextRun,
        );
      } else if (nextRun.scope === 'global') {
        for (const providerSummary of nextRun.providerSummaries || []) {
          state.providers[providerSummary.providerId] = applyProviderRefreshState(
            state.providers[providerSummary.providerId],
            {
              ...nextRun,
              providerId: providerSummary.providerId,
              providerSummary,
            },
          );
        }
      }

      await saveState(resolvedPath, state);
      return nextRun;
    },
    recordValidationRun: async (result) => {
      const state = await loadState(resolvedPath);
      const nextRun = normalizeValidationRun(result);

      state.validationRuns.unshift(nextRun);
      state.validationRuns = state.validationRuns.slice(0, maxRuns);
      state.updatedAt = new Date().toISOString();
      state.providers[nextRun.providerId] = applyValidationState(
        state.providers[nextRun.providerId],
        nextRun,
      );

      await saveState(resolvedPath, state);
      return nextRun;
    },
  };
}

async function ensureStateFile(filePath) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await saveState(filePath, DEFAULT_STATE);
  }
}

async function loadState(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return mergeStateDefaults(JSON.parse(content));
}

async function saveState(filePath, state) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function mergeStateDefaults(state) {
  return {
    ...DEFAULT_STATE,
    ...state,
    refreshRuns: Array.isArray(state.refreshRuns) ? state.refreshRuns : [],
    validationRuns: Array.isArray(state.validationRuns) ? state.validationRuns : [],
    providers: state.providers && typeof state.providers === 'object' ? state.providers : {},
  };
}

function normalizeRefreshRun(run) {
  return {
    runId: run.runId || createRunId(),
    scope: run.scope || (run.providerId ? 'provider' : 'global'),
    providerId: run.providerId || null,
    status: run.status || 'unknown',
    startedAt: run.startedAt || new Date().toISOString(),
    completedAt: run.completedAt || null,
    generatedAt: run.generatedAt || null,
    sourceStatus: run.sourceStatus || {},
    providerSummary: run.providerSummary || null,
    providerSummaries: run.providerSummaries || [],
    errorMessage: run.errorMessage || null,
  };
}

function applyProviderRefreshState(existingState = {}, run) {
  const providerSummary = run.providerSummary || null;
  const nextState = {
    ...existingState,
    providerId: run.providerId,
    lastRefreshRunId: run.runId,
    lastRefreshScope: run.scope,
    lastRefreshStatus: run.status,
    lastRefreshAt: run.completedAt || run.startedAt,
    lastErrorMessage: run.status === 'error' ? run.errorMessage || null : null,
  };

  if (providerSummary) {
    nextState.lastKnownGeneratedAt = run.generatedAt || null;
    nextState.lastKnownModelCount = providerSummary.modelCount ?? null;
    nextState.lastKnownLatestCount = providerSummary.latestCount ?? null;
    nextState.lastKnownRecommendedCount = providerSummary.recommendedCount ?? null;
    nextState.lastAvailabilitySource = providerSummary.availabilitySource ?? null;
  }

  if (run.status === 'success') {
    nextState.lastSuccessfulRefreshAt = run.completedAt || run.startedAt;
    nextState.lastSuccessfulRunId = run.runId;
  }

  return nextState;
}

function normalizeValidationRun(result) {
  return {
    validationId: result.validationId || createId('validation'),
    providerId: result.providerId,
    checkedAt: result.checkedAt || new Date().toISOString(),
    ok: Boolean(result.ok),
    errorCode: result.errorCode || null,
    errorMessage: result.errorMessage || null,
    status: result.status ?? null,
    details: result.details || null,
  };
}

function applyValidationState(existingState = {}, validationRun) {
  return {
    ...existingState,
    providerId: validationRun.providerId,
    lastValidationRunId: validationRun.validationId,
    lastValidationOk: validationRun.ok,
    lastValidationAt: validationRun.checkedAt,
    lastValidationErrorCode: validationRun.ok ? null : validationRun.errorCode,
    lastValidationErrorMessage: validationRun.ok ? null : validationRun.errorMessage,
    lastValidationStrategy: validationRun.details?.strategy || null,
    lastValidationStatus: validationRun.status ?? null,
    lastSuccessfulValidationAt: validationRun.ok
      ? validationRun.checkedAt
      : existingState?.lastSuccessfulValidationAt || null,
  };
}

function createRunId() {
  return createId('run');
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
