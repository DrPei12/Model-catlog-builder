import { createCredentialVault, summarizeCredentials } from './credentialVault.mjs';
import { validateProviderCredentials } from './validateProviderCredentials.mjs';

export function createProviderConnectionService(options = {}) {
  const runtimeService = options.runtimeService;
  if (!runtimeService) {
    throw new Error('runtimeService is required.');
  }

  const vault = createCredentialVault({
    secret: options.encryptionSecret,
    keyVersion: options.encryptionKeyVersion || 'v1',
  });

  const validator = options.validator || validateProviderCredentials;
  const validationOptions = options.validationOptions || {};
  const secretSource = options.secretSource || 'explicit';
  const usesDefaultSecret = Boolean(options.usesDefaultSecret);

  return {
    getVaultInfo: () => ({
      algorithm: vault.algorithm,
      keyVersion: vault.keyVersion,
      secretSource,
      usesDefaultSecret,
    }),
    listConnections: async () => {
      const records = await runtimeService.listConnections();
      return records.map(sanitizeConnectionRecord);
    },
    getConnection: async (providerId) => {
      const record = await runtimeService.getConnection(providerId);
      return sanitizeConnectionRecord(record);
    },
    getAuditEvents: (query) => runtimeService.getAuditEvents(query),
    connectProvider: async (providerSetup, credentials = {}, actor = null) => {
      const actorInfo = normalizeActor(actor);
      const credentialSummary = summarizeCredentials(providerSetup?.auth?.fields || [], credentials);
      const validationResult = await validator(providerSetup, credentials, validationOptions);
      const persistedValidation = await runtimeService.recordValidationRun(validationResult);

      if (!persistedValidation.ok) {
        const auditEvent = await runtimeService.recordAuditEvent({
          providerId: providerSetup.providerId,
          action: 'connect',
          actorType: actorInfo.actorType,
          actorId: actorInfo.actorId,
          ok: false,
          details: {
            reason: persistedValidation.errorCode || 'validation_failed',
            validationId: persistedValidation.validationId,
            credentialSummary,
          },
        });

        return {
          ok: false,
          providerId: providerSetup.providerId,
          validation: persistedValidation,
          connection: sanitizeConnectionRecord(await runtimeService.getConnection(providerSetup.providerId)),
          auditEvent,
        };
      }

      const existing = await runtimeService.getConnection(providerSetup.providerId);
      const now = new Date().toISOString();
      const encryptedCredentials = vault.encrypt(credentials);
      const connectionRecord = await runtimeService.upsertConnection({
        providerId: providerSetup.providerId,
        status: 'connected',
        encryptedCredentials,
        credentialSummary,
        keyVersion: vault.keyVersion,
        updatedAt: now,
        lastConnectedAt: now,
        lastRotatedAt: now,
        lastValidatedAt: persistedValidation.checkedAt,
        lastValidationOk: persistedValidation.ok,
        lastValidationErrorCode: persistedValidation.errorCode || null,
        lastValidationErrorMessage: persistedValidation.errorMessage || null,
        lastValidationStatus: persistedValidation.status ?? null,
        metadata: {
          authStrategy: providerSetup?.auth?.strategy || null,
          fieldIds: Object.keys(credentialSummary),
          lastActor: actorInfo,
        },
      });

      const auditEvent = await runtimeService.recordAuditEvent({
        providerId: providerSetup.providerId,
        action: existing ? 'rotate_credentials' : 'connect',
        actorType: actorInfo.actorType,
        actorId: actorInfo.actorId,
        ok: true,
        details: {
          validationId: persistedValidation.validationId,
          credentialSummary,
        },
      });

      return {
        ok: true,
        providerId: providerSetup.providerId,
        validation: persistedValidation,
        connection: sanitizeConnectionRecord(connectionRecord),
        auditEvent,
      };
    },
    revalidateProvider: async (providerSetup, actor = null) => {
      const actorInfo = normalizeActor(actor);
      const existing = await runtimeService.getConnection(providerSetup.providerId);
      if (!existing?.encryptedCredentials) {
        const auditEvent = await runtimeService.recordAuditEvent({
          providerId: providerSetup.providerId,
          action: 'revalidate',
          actorType: actorInfo.actorType,
          actorId: actorInfo.actorId,
          ok: false,
          details: {
            reason: 'connection_not_found',
          },
        });

        return {
          ok: false,
          providerId: providerSetup.providerId,
          errorCode: 'connection_not_found',
          errorMessage: `No stored credentials were found for provider "${providerSetup.providerId}".`,
          auditEvent,
        };
      }

      const credentials = vault.decrypt(existing.encryptedCredentials);
      const validationResult = await validator(providerSetup, credentials, validationOptions);
      const persistedValidation = await runtimeService.recordValidationRun(validationResult);
      const now = new Date().toISOString();

      const nextRecord = await runtimeService.upsertConnection({
        ...existing,
        status: persistedValidation.ok ? 'connected' : 'needs_attention',
        updatedAt: now,
        lastValidatedAt: persistedValidation.checkedAt,
        lastValidationOk: persistedValidation.ok,
        lastValidationErrorCode: persistedValidation.errorCode || null,
        lastValidationErrorMessage: persistedValidation.errorMessage || null,
        lastValidationStatus: persistedValidation.status ?? null,
        metadata: {
          ...(existing.metadata || {}),
          lastActor: actorInfo,
        },
      });

      const auditEvent = await runtimeService.recordAuditEvent({
        providerId: providerSetup.providerId,
        action: 'revalidate',
        actorType: actorInfo.actorType,
        actorId: actorInfo.actorId,
        ok: persistedValidation.ok,
        details: {
          validationId: persistedValidation.validationId,
          credentialSummary: existing.credentialSummary || {},
        },
      });

      return {
        ok: persistedValidation.ok,
        providerId: providerSetup.providerId,
        validation: persistedValidation,
        connection: sanitizeConnectionRecord(nextRecord),
        auditEvent,
      };
    },
    disconnectProvider: async (providerId, actor = null) => {
      const actorInfo = normalizeActor(actor);
      const existing = await runtimeService.deleteConnection(providerId);

      const auditEvent = await runtimeService.recordAuditEvent({
        providerId,
        action: 'disconnect',
        actorType: actorInfo.actorType,
        actorId: actorInfo.actorId,
        ok: Boolean(existing),
        details: existing
          ? {
              credentialSummary: existing.credentialSummary || {},
            }
          : {
              reason: 'connection_not_found',
            },
      });

      if (!existing) {
        return {
          ok: false,
          providerId,
          errorCode: 'connection_not_found',
          errorMessage: `No stored credentials were found for provider "${providerId}".`,
          auditEvent,
        };
      }

      return {
        ok: true,
        providerId,
        connection: sanitizeConnectionRecord(existing),
        auditEvent,
      };
    },
  };
}

function sanitizeConnectionRecord(record) {
  if (!record) {
    return null;
  }

  return {
    providerId: record.providerId,
    status: record.status,
    credentialSummary: record.credentialSummary || {},
    keyVersion: record.keyVersion || null,
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null,
    lastConnectedAt: record.lastConnectedAt || null,
    lastRotatedAt: record.lastRotatedAt || null,
    lastValidatedAt: record.lastValidatedAt || null,
    lastValidationOk: record.lastValidationOk ?? null,
    lastValidationErrorCode: record.lastValidationErrorCode || null,
    lastValidationErrorMessage: record.lastValidationErrorMessage || null,
    lastValidationStatus: record.lastValidationStatus ?? null,
    metadata: record.metadata || {},
  };
}

function normalizeActor(actor) {
  if (!actor || typeof actor !== 'object') {
    return {
      actorType: 'system',
      actorId: null,
    };
  }

  return {
    actorType: actor.type || actor.actorType || 'system',
    actorId: actor.id || actor.actorId || null,
  };
}
