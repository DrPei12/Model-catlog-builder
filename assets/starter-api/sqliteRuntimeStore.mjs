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

    CREATE TABLE IF NOT EXISTS provider_credentials (
      provider_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      encrypted_credentials_json TEXT NOT NULL,
      credential_summary_json TEXT,
      key_version TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_connected_at TEXT,
      last_rotated_at TEXT,
      last_validated_at TEXT,
      last_validation_ok INTEGER,
      last_validation_error_code TEXT,
      last_validation_error_message TEXT,
      last_validation_status INTEGER,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      event_id TEXT PRIMARY KEY,
      provider_id TEXT,
      action TEXT NOT NULL,
      actor_type TEXT,
      actor_id TEXT,
      occurred_at TEXT NOT NULL,
      ok INTEGER,
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

  const upsertConnection = db.prepare(`
    INSERT INTO provider_credentials (
      provider_id,
      status,
      encrypted_credentials_json,
      credential_summary_json,
      key_version,
      created_at,
      updated_at,
      last_connected_at,
      last_rotated_at,
      last_validated_at,
      last_validation_ok,
      last_validation_error_code,
      last_validation_error_message,
      last_validation_status,
      metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider_id) DO UPDATE SET
      status = excluded.status,
      encrypted_credentials_json = excluded.encrypted_credentials_json,
      credential_summary_json = excluded.credential_summary_json,
      key_version = excluded.key_version,
      created_at = provider_credentials.created_at,
      updated_at = excluded.updated_at,
      last_connected_at = excluded.last_connected_at,
      last_rotated_at = excluded.last_rotated_at,
      last_validated_at = excluded.last_validated_at,
      last_validation_ok = excluded.last_validation_ok,
      last_validation_error_code = excluded.last_validation_error_code,
      last_validation_error_message = excluded.last_validation_error_message,
      last_validation_status = excluded.last_validation_status,
      metadata_json = excluded.metadata_json
  `);

  const deleteConnection = db.prepare(`
    DELETE FROM provider_credentials
    WHERE provider_id = ?
  `);

  const insertAuditEvent = db.prepare(`
    INSERT INTO audit_events (
      event_id, provider_id, action, actor_type, actor_id, occurred_at, ok, details_json
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

  const trimAuditEvents = db.prepare(`
    DELETE FROM audit_events
    WHERE rowid IN (
      SELECT rowid FROM audit_events
      ORDER BY datetime(occurred_at) DESC, rowid DESC
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
      auditEvents: db.prepare(`
        SELECT event_id, provider_id, action, actor_type, actor_id, occurred_at, ok, details_json
        FROM audit_events
        ORDER BY datetime(occurred_at) DESC, rowid DESC
        LIMIT ?
      `).all(maxRuns).map(mapAuditEventRow),
      connections: Object.fromEntries(
        db.prepare(`
          SELECT *
          FROM provider_credentials
          ORDER BY datetime(updated_at) DESC, rowid DESC
        `).all().map((row) => [row.provider_id, mapConnectionRow(row)]),
      ),
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
    getAuditEvents: async ({ providerId = null, limit = 50 } = {}) => {
      const rows = providerId
        ? db.prepare(`
            SELECT event_id, provider_id, action, actor_type, actor_id, occurred_at, ok, details_json
            FROM audit_events
            WHERE provider_id = ?
            ORDER BY datetime(occurred_at) DESC, rowid DESC
            LIMIT ?
          `).all(providerId, limit)
        : db.prepare(`
            SELECT event_id, provider_id, action, actor_type, actor_id, occurred_at, ok, details_json
            FROM audit_events
            ORDER BY datetime(occurred_at) DESC, rowid DESC
            LIMIT ?
          `).all(limit);

      return rows.map(mapAuditEventRow);
    },
    getProviderState: async (providerId) => {
      const row = db.prepare(`SELECT * FROM provider_runtime_state WHERE provider_id = ?`).get(providerId);
      return row ? mapProviderStateRow(row) : null;
    },
    getConnection: async (providerId) => {
      const row = db.prepare(`SELECT * FROM provider_credentials WHERE provider_id = ?`).get(providerId);
      return row ? mapConnectionRow(row) : null;
    },
    listConnections: async () =>
      db.prepare(`
        SELECT *
        FROM provider_credentials
        ORDER BY datetime(updated_at) DESC, rowid DESC
      `).all().map(mapConnectionRow),
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
    upsertConnection: async (record) => {
      const connectionRecord = normalizeConnectionRecord(record, await readConnection(db, record.providerId));

      upsertConnection.run(
        connectionRecord.providerId,
        connectionRecord.status,
        JSON.stringify(connectionRecord.encryptedCredentials || null),
        JSON.stringify(connectionRecord.credentialSummary || {}),
        connectionRecord.keyVersion,
        connectionRecord.createdAt,
        connectionRecord.updatedAt,
        connectionRecord.lastConnectedAt,
        connectionRecord.lastRotatedAt,
        connectionRecord.lastValidatedAt,
        normalizeNullableBoolean(connectionRecord.lastValidationOk),
        connectionRecord.lastValidationErrorCode,
        connectionRecord.lastValidationErrorMessage,
        connectionRecord.lastValidationStatus,
        JSON.stringify(connectionRecord.metadata || {}),
      );

      return connectionRecord;
    },
    deleteConnection: async (providerId) => {
      const existing = await readConnection(db, providerId);
      if (!existing) {
        return null;
      }
      deleteConnection.run(providerId);
      return existing;
    },
    recordAuditEvent: async (event) => {
      const auditEvent = normalizeAuditEvent(event);
      insertAuditEvent.run(
        auditEvent.eventId,
        auditEvent.providerId,
        auditEvent.action,
        auditEvent.actorType,
        auditEvent.actorId,
        auditEvent.occurredAt,
        normalizeNullableBoolean(auditEvent.ok),
        JSON.stringify(auditEvent.details || null),
      );
      trimAuditEvents.run(maxRuns);
      return auditEvent;
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

function mapConnectionRow(row) {
  return {
    providerId: row.provider_id,
    status: row.status,
    encryptedCredentials: parseJson(row.encrypted_credentials_json, null),
    credentialSummary: parseJson(row.credential_summary_json, {}),
    keyVersion: row.key_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastConnectedAt: row.last_connected_at,
    lastRotatedAt: row.last_rotated_at,
    lastValidatedAt: row.last_validated_at,
    lastValidationOk: row.last_validation_ok === null ? null : Boolean(row.last_validation_ok),
    lastValidationErrorCode: row.last_validation_error_code,
    lastValidationErrorMessage: row.last_validation_error_message,
    lastValidationStatus: row.last_validation_status,
    metadata: parseJson(row.metadata_json, {}),
  };
}

function mapAuditEventRow(row) {
  return {
    eventId: row.event_id,
    providerId: row.provider_id,
    action: row.action,
    actorType: row.actor_type,
    actorId: row.actor_id,
    occurredAt: row.occurred_at,
    ok: row.ok === null ? null : Boolean(row.ok),
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

function normalizeConnectionRecord(record, existing = null) {
  const now = new Date().toISOString();
  const previous = existing || {};
  return {
    providerId: record.providerId,
    status: record.status || 'connected',
    encryptedCredentials: record.encryptedCredentials,
    credentialSummary: record.credentialSummary || {},
    keyVersion: record.keyVersion || record.encryptedCredentials?.keyVersion || previous.keyVersion || null,
    createdAt: previous.createdAt || record.createdAt || now,
    updatedAt: record.updatedAt || now,
    lastConnectedAt: record.lastConnectedAt || now,
    lastRotatedAt: record.lastRotatedAt || now,
    lastValidatedAt: record.lastValidatedAt || previous.lastValidatedAt || null,
    lastValidationOk:
      record.lastValidationOk === undefined ? previous.lastValidationOk ?? null : Boolean(record.lastValidationOk),
    lastValidationErrorCode: record.lastValidationErrorCode || null,
    lastValidationErrorMessage: record.lastValidationErrorMessage || null,
    lastValidationStatus: record.lastValidationStatus ?? null,
    metadata: record.metadata || previous.metadata || {},
  };
}

function normalizeAuditEvent(event) {
  return {
    eventId: event.eventId || createId('audit'),
    providerId: event.providerId || null,
    action: event.action || 'unknown',
    actorType: event.actorType || 'system',
    actorId: event.actorId || null,
    occurredAt: event.occurredAt || new Date().toISOString(),
    ok: event.ok === undefined ? null : Boolean(event.ok),
    details: event.details || null,
  };
}

function readProviderState(db, providerId) {
  const row = db.prepare(`SELECT * FROM provider_runtime_state WHERE provider_id = ?`).get(providerId);
  return row ? mapProviderStateRow(row) : null;
}

function readConnection(db, providerId) {
  const row = db.prepare(`SELECT * FROM provider_credentials WHERE provider_id = ?`).get(providerId);
  return row ? mapConnectionRow(row) : null;
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

function normalizeNullableBoolean(value) {
  if (value === undefined || value === null) {
    return null;
  }
  return value ? 1 : 0;
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
