import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export async function createSqliteRuntimeStore(databasePath, options = {}) {
  const resolvedPath = path.resolve(databasePath);
  const maxRuns = options.maxRuns ?? 200;

  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });

  const db = new DatabaseSync(resolvedPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS refresh_runs (
      run_id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      provider_id TEXT,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      generated_at TEXT,
      source_status_json TEXT,
      provider_summary_json TEXT,
      provider_summaries_json TEXT,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS provider_runtime_state (
      provider_id TEXT PRIMARY KEY,
      last_refresh_run_id TEXT,
      last_refresh_scope TEXT,
      last_refresh_status TEXT,
      last_refresh_at TEXT,
      last_successful_refresh_at TEXT,
      last_successful_run_id TEXT,
      last_known_generated_at TEXT,
      last_known_model_count INTEGER,
      last_known_latest_count INTEGER,
      last_known_recommended_count INTEGER,
      last_availability_source TEXT,
      last_error_message TEXT,
      last_validation_run_id TEXT,
      last_validation_ok INTEGER,
      last_validation_at TEXT,
      last_successful_validation_at TEXT,
      last_validation_error_code TEXT,
      last_validation_error_message TEXT,
      last_validation_strategy TEXT,
      last_validation_status INTEGER
    );

    CREATE TABLE IF NOT EXISTS validation_runs (
      validation_id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      checked_at TEXT NOT NULL,
      ok INTEGER NOT NULL,
      error_code TEXT,
      error_message TEXT,
      status INTEGER,
      details_json TEXT
    );
  `);

  const insertRefreshRun = db.prepare(`
    INSERT INTO refresh_runs (
      run_id, scope, provider_id, status, started_at, completed_at, generated_at,
      source_status_json, provider_summary_json, provider_summaries_json, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertValidationRun = db.prepare(`
    INSERT INTO validation_runs (
      validation_id, provider_id, checked_at, ok, error_code, error_message, status, details_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const upsertProviderState = db.prepare(`
    INSERT INTO provider_runtime_state (
      provider_id,
      last_refresh_run_id,
      last_refresh_scope,
      last_refresh_status,
      last_refresh_at,
      last_successful_refresh_at,
      last_successful_run_id,
      last_known_generated_at,
      last_known_model_count,
      last_known_latest_count,
      last_known_recommended_count,
      last_availability_source,
      last_error_message,
      last_validation_run_id,
      last_validation_ok,
      last_validation_at,
      last_successful_validation_at,
      last_validation_error_code,
      last_validation_error_message,
      last_validation_strategy,
      last_validation_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider_id) DO UPDATE SET
      last_refresh_run_id = excluded.last_refresh_run_id,
      last_refresh_scope = excluded.last_refresh_scope,
      last_refresh_status = excluded.last_refresh_status,
      last_refresh_at = excluded.last_refresh_at,
      last_successful_refresh_at = COALESCE(excluded.last_successful_refresh_at, provider_runtime_state.last_successful_refresh_at),
      last_successful_run_id = COALESCE(excluded.last_successful_run_id, provider_runtime_state.last_successful_run_id),
      last_known_generated_at = COALESCE(excluded.last_known_generated_at, provider_runtime_state.last_known_generated_at),
      last_known_model_count = COALESCE(excluded.last_known_model_count, provider_runtime_state.last_known_model_count),
      last_known_latest_count = COALESCE(excluded.last_known_latest_count, provider_runtime_state.last_known_latest_count),
      last_known_recommended_count = COALESCE(excluded.last_known_recommended_count, provider_runtime_state.last_known_recommended_count),
      last_availability_source = COALESCE(excluded.last_availability_source, provider_runtime_state.last_availability_source),
      last_error_message = excluded.last_error_message,
      last_validation_run_id = COALESCE(excluded.last_validation_run_id, provider_runtime_state.last_validation_run_id),
      last_validation_ok = COALESCE(excluded.last_validation_ok, provider_runtime_state.last_validation_ok),
      last_validation_at = COALESCE(excluded.last_validation_at, provider_runtime_state.last_validation_at),
      last_successful_validation_at = COALESCE(excluded.last_successful_validation_at, provider_runtime_state.last_successful_validation_at),
      last_validation_error_code = COALESCE(excluded.last_validation_error_code, provider_runtime_state.last_validation_error_code),
      last_validation_error_message = COALESCE(excluded.last_validation_error_message, provider_runtime_state.last_validation_error_message),
      last_validation_strategy = COALESCE(excluded.last_validation_strategy, provider_runtime_state.last_validation_strategy),
      last_validation_status = COALESCE(excluded.last_validation_status, provider_runtime_state.last_validation_status)
  `);

  const trimRefreshRuns = db.prepare(`
    DELETE FROM refresh_runs
    WHERE rowid IN (
      SELECT rowid FROM refresh_runs
      ORDER BY datetime(started_at) DESC, rowid DESC
      LIMIT -1 OFFSET ?
    )
  `);

  const trimValidationRuns = db.prepare(`
    DELETE FROM validation_runs
    WHERE rowid IN (
      SELECT rowid FROM validation_runs
      ORDER BY datetime(checked_at) DESC, rowid DESC
      LIMIT -1 OFFSET ?
    )
  `);

  return {
    kind: 'sqlite',
    path: resolvedPath,
    close: () => db.close(),
    load: async () => ({
      kind: 'sqlite',
      path: resolvedPath,
      refreshRuns: db.prepare(`
        SELECT run_id, scope, provider_id, status, started_at, completed_at, generated_at,
               source_status_json, provider_summary_json, provider_summaries_json, error_message
        FROM refresh_runs
        ORDER BY datetime(started_at) DESC, rowid DESC
        LIMIT ?
      `).all(maxRuns).map(mapRefreshRow),
      validationRuns: db.prepare(`
        SELECT validation_id, provider_id, checked_at, ok, error_code, error_message, status, details_json
        FROM validation_runs
        ORDER BY datetime(checked_at) DESC, rowid DESC
        LIMIT ?
      `).all(maxRuns).map(mapValidationRow),
      providers: Object.fromEntries(
        db.prepare(`SELECT * FROM provider_runtime_state`).all().map((row) => [row.provider_id, mapProviderStateRow(row)]),
      ),
    }),
    getRefreshRuns: async ({ providerId = null, limit = 50 } = {}) => {
      const rows = providerId
        ? db.prepare(`
            SELECT run_id, scope, provider_id, status, started_at, completed_at, generated_at,
                   source_status_json, provider_summary_json, provider_summaries_json, error_message
            FROM refresh_runs
            WHERE provider_id = ? OR scope = 'global'
            ORDER BY datetime(started_at) DESC, rowid DESC
            LIMIT ?
          `).all(providerId, limit)
        : db.prepare(`
            SELECT run_id, scope, provider_id, status, started_at, completed_at, generated_at,
                   source_status_json, provider_summary_json, provider_summaries_json, error_message
            FROM refresh_runs
            ORDER BY datetime(started_at) DESC, rowid DESC
            LIMIT ?
          `).all(limit);

      return rows.map(mapRefreshRow);
    },
    getValidationRuns: async ({ providerId = null, limit = 50 } = {}) => {
      const rows = providerId
        ? db.prepare(`
            SELECT validation_id, provider_id, checked_at, ok, error_code, error_message, status, details_json
            FROM validation_runs
            WHERE provider_id = ?
            ORDER BY datetime(checked_at) DESC, rowid DESC
            LIMIT ?
          `).all(providerId, limit)
        : db.prepare(`
            SELECT validation_id, provider_id, checked_at, ok, error_code, error_message, status, details_json
            FROM validation_runs
            ORDER BY datetime(checked_at) DESC, rowid DESC
            LIMIT ?
          `).all(limit);

      return rows.map(mapValidationRow);
    },
    getProviderState: async (providerId) => {
      const row = db.prepare(`SELECT * FROM provider_runtime_state WHERE provider_id = ?`).get(providerId);
      return row ? mapProviderStateRow(row) : null;
    },
    recordRefreshRun: async (run) => {
      const nextRun = normalizeRefreshRun(run);

      db.exec('BEGIN');
      try {
        insertRefreshRun.run(
          nextRun.runId,
          nextRun.scope,
          nextRun.providerId,
          nextRun.status,
          nextRun.startedAt,
          nextRun.completedAt,
          nextRun.generatedAt,
          JSON.stringify(nextRun.sourceStatus || {}),
          JSON.stringify(nextRun.providerSummary || null),
          JSON.stringify(nextRun.providerSummaries || []),
          nextRun.errorMessage,
        );

        if (nextRun.providerId) {
          upsertProviderState.run(...providerStateParams(
            applyProviderRefreshStateSql(readProviderState(db, nextRun.providerId), nextRun),
          ));
        } else if (nextRun.scope === 'global') {
          for (const providerSummary of nextRun.providerSummaries || []) {
            upsertProviderState.run(...providerStateParams(
              applyProviderRefreshStateSql(readProviderState(db, providerSummary.providerId), {
                ...nextRun,
                providerId: providerSummary.providerId,
                providerSummary,
              }),
            ));
          }
        }

        trimRefreshRuns.run(maxRuns);
        db.exec('COMMIT');
        return nextRun;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    recordValidationRun: async (result) => {
      const validationRun = normalizeValidationRun(result);
      const existing = readProviderState(db, validationRun.providerId);
      const nextState = applyValidationStateSql(existing, validationRun);

      db.exec('BEGIN');
      try {
        insertValidationRun.run(
          validationRun.validationId,
          validationRun.providerId,
          validationRun.checkedAt,
          validationRun.ok ? 1 : 0,
          validationRun.errorCode,
          validationRun.errorMessage,
          validationRun.status,
          JSON.stringify(validationRun.details || null),
        );
        upsertProviderState.run(...providerStateParams(nextState));
        trimValidationRuns.run(maxRuns);
        db.exec('COMMIT');
        return validationRun;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function mapRefreshRow(row) {
  return {
    runId: row.run_id,
    scope: row.scope,
    providerId: row.provider_id,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    generatedAt: row.generated_at,
    sourceStatus: parseJson(row.source_status_json, {}),
    providerSummary: parseJson(row.provider_summary_json, null),
    providerSummaries: parseJson(row.provider_summaries_json, []),
    errorMessage: row.error_message,
  };
}

function mapValidationRow(row) {
  return {
    validationId: row.validation_id,
    providerId: row.provider_id,
    checkedAt: row.checked_at,
    ok: Boolean(row.ok),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    status: row.status,
    details: parseJson(row.details_json, null),
  };
}

function mapProviderStateRow(row) {
  return {
    providerId: row.provider_id,
    lastRefreshRunId: row.last_refresh_run_id,
    lastRefreshScope: row.last_refresh_scope,
    lastRefreshStatus: row.last_refresh_status,
    lastRefreshAt: row.last_refresh_at,
    lastSuccessfulRefreshAt: row.last_successful_refresh_at,
    lastSuccessfulRunId: row.last_successful_run_id,
    lastKnownGeneratedAt: row.last_known_generated_at,
    lastKnownModelCount: row.last_known_model_count,
    lastKnownLatestCount: row.last_known_latest_count,
    lastKnownRecommendedCount: row.last_known_recommended_count,
    lastAvailabilitySource: row.last_availability_source,
    lastErrorMessage: row.last_error_message,
    lastValidationRunId: row.last_validation_run_id,
    lastValidationOk: row.last_validation_ok === null ? null : Boolean(row.last_validation_ok),
    lastValidationAt: row.last_validation_at,
    lastSuccessfulValidationAt: row.last_successful_validation_at,
    lastValidationErrorCode: row.last_validation_error_code,
    lastValidationErrorMessage: row.last_validation_error_message,
    lastValidationStrategy: row.last_validation_strategy,
    lastValidationStatus: row.last_validation_status,
  };
}

function parseJson(value, fallback) {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeRefreshRun(run) {
  return {
    runId: run.runId || createId('run'),
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

function readProviderState(db, providerId) {
  const row = db.prepare(`SELECT * FROM provider_runtime_state WHERE provider_id = ?`).get(providerId);
  return row ? mapProviderStateRow(row) : null;
}

function applyProviderRefreshStateSql(existingState = {}, run) {
  const previousState = existingState || {};
  const providerSummary = run.providerSummary || null;
  const nextState = {
    ...previousState,
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

function applyValidationStateSql(existingState = {}, validationRun) {
  const previousState = existingState || {};
  return {
    ...previousState,
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
      : previousState.lastSuccessfulValidationAt || null,
  };
}

function providerStateParams(state) {
  return [
    state.providerId,
    state.lastRefreshRunId ?? null,
    state.lastRefreshScope ?? null,
    state.lastRefreshStatus ?? null,
    state.lastRefreshAt ?? null,
    state.lastSuccessfulRefreshAt ?? null,
    state.lastSuccessfulRunId ?? null,
    state.lastKnownGeneratedAt ?? null,
    state.lastKnownModelCount ?? null,
    state.lastKnownLatestCount ?? null,
    state.lastKnownRecommendedCount ?? null,
    state.lastAvailabilitySource ?? null,
    state.lastErrorMessage ?? null,
    state.lastValidationRunId ?? null,
    state.lastValidationOk === undefined || state.lastValidationOk === null ? null : state.lastValidationOk ? 1 : 0,
    state.lastValidationAt ?? null,
    state.lastSuccessfulValidationAt ?? null,
    state.lastValidationErrorCode ?? null,
    state.lastValidationErrorMessage ?? null,
    state.lastValidationStrategy ?? null,
    state.lastValidationStatus ?? null,
  ];
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
