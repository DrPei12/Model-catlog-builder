# API Contract

## Goal

Expose a stable product-facing contract so the UI and agent layer never read raw upstream catalogs directly.

The bundled demo server implements this starter contract:

- `GET /api/providers`
- `GET /api/providers/:providerId/setup`
- `GET /api/providers/:providerId/models`
- `GET /api/providers/:providerId/runtime`
- `GET /api/providers/:providerId/connection`
- `GET /api/providers/:providerId/validation-runs`
- `GET /api/providers/:providerId/audit-events`
- `GET /api/catalog/meta`
- `GET /api/operations/refresh-runs`
- `GET /api/operations/validation-runs`
- `GET /api/operations/connections`
- `GET /api/operations/audit-events`
- `POST /api/providers/:providerId/validate`
- `POST /api/providers/:providerId/connect`
- `POST /api/providers/:providerId/rotate`
- `POST /api/providers/:providerId/revalidate`
- `POST /api/refresh`
- `POST /api/providers/:providerId/refresh`
- `DELETE /api/providers/:providerId/connection`

The starter package also exposes a framework-neutral request handler through `createStarterApiService()` and a Next.js App Router adapter through `createNextRouteHandlers()`. Use those instead of re-implementing the route table.

## Recommended endpoints or tools

## Auth and tenant context

For embeddable products, every API call should carry tenant context.

Suggested transport:

- `Authorization: Bearer <token>` or `x-api-key: <token>`
- `x-tenant-id: <tenantId>`

Starter behavior:

- if no API keys are configured, the API is open and falls back to `x-tenant-id` or `default`
- if API keys are configured, each key is mapped to one tenant
- a tenant mismatch should return `403`

## Embedding options

### Shared Node service

Use `createStarterApiService()` when you want a single request handler that works across:

- raw `node:http`
- integration tests
- custom Express or Fastify adapters
- internal agent tools

It expects a normalized request-like object:

- `method`
- `pathname`
- `searchParams`
- `headers`
- `body`
- `remoteAddress`

### Next.js App Router

Use `createNextRouteHandlers()` when you want a drop-in adapter for a catch-all route such as:

- `app/api/model-catalog/[[...route]]/route.ts`

Recommended path mapping:

- `/api/model-catalog/providers` -> `/api/providers`
- `/api/model-catalog/providers/openai/setup` -> `/api/providers/openai/setup`
- `/api/model-catalog/providers/openai/models` -> `/api/providers/openai/models`
- `/api/model-catalog/operations/refresh-runs` -> `/api/operations/refresh-runs`

If the catch-all route is called without extra segments, the adapter returns the same payload as `GET /api/catalog/meta`.

### `listProviders()`

Return one object per provider.

Suggested fields:

- `providerId`
- `displayName`
- `auth`
- `discovery`
- `availabilitySource`
- `officialSources`
- `collectionsSummary`

### `getProviderSetup(providerId)`

Return the provider-specific auth form and setup copy.

Suggested fields:

- `providerId`
- `displayName`
- `auth.strategy`
- `auth.fields`
- `helpText`
- `validationHints`

### `validateProviderCredentials(providerId, credentials)`

Use this to verify auth before exposing models.

Suggested fields:

- `ok`
- `providerId`
- `checkedAt`
- `validationId`
- `errorCode`
- `errorMessage`

Suggested request body for HTTP:

```json
{
  "credentials": {
    "apiKey": "..."
  }
}
```

Current starter support:

- `openai`
- `anthropic`
- `google`
- `openrouter`
- `vercel-ai-gateway`
- `openai-compatible`

The starter returns a structured `not_supported_yet` response for providers that still need a deployment-aware validator, such as `azure-openai`.

### `listModels(providerId, filters)`

Return only normalized records.

Suggested filters:

- `group`: `recommended | latest | all`
- `query`
- `capabilities[]`
- `includePreview`
- `includeDeprecated`

Suggested response fields:

- `providerId`
- `collections`
- `models[]`

Each model should include:

- `modelId`
- `displayName`
- `family`
- `stage`
- `availabilityConfidence`
- `contextWindow`
- `maxOutputTokens`
- `capabilities`
- `pricing`
- `recommended`
- `hidden`
- `isLatestAlias`
- `isLatestStableRelease`
- `pinnedTargetModelId`

### `connectProvider(providerId, credentials)`

Validate and persist provider credentials.

Suggested fields:

- `ok`
- `providerId`
- `validation`
- `connection`
- `auditEvent`

Credentials should be encrypted before persistence. The response should never return plaintext secrets.

### `rotateProviderCredentials(providerId, credentials)`

Validate a replacement credential set, persist it through the configured secret source, and emit a rotation audit event.

Suggested fields:

- `ok`
- `providerId`
- `validation`
- `connection`
- `auditEvent`

Rotation should fail if there is no existing connection to rotate.

### `revalidateProvider(providerId)`

Load the stored credentials, validate them again, and update runtime plus connection state.

Suggested fields:

- `ok`
- `providerId`
- `validation`
- `connection`
- `auditEvent`

### `disconnectProvider(providerId)`

Delete the stored credentials and emit an audit event.

Suggested fields:

- `ok`
- `providerId`
- `connection`
- `auditEvent`

### `refreshProviderModels(providerId)`

Trigger a provider refresh and return a summary.

Suggested fields:

- `providerId`
- `status`
- `startedAt`
- `completedAt`
- `sourceStatus`
- `added`
- `changed`
- `missing`

The starter demo implements refresh as:

- `POST /api/refresh` for a full sync
- `POST /api/providers/:providerId/refresh` for a provider-scoped sync that merges the refreshed provider back into the full catalog

## Runtime status endpoints

### `getProviderRuntime(providerId)`

Return the latest operational state for a provider.

Suggested fields:

- `providerId`
- `lastRefreshRunId`
- `lastRefreshScope`
- `lastRefreshStatus`
- `lastRefreshAt`
- `lastSuccessfulRefreshAt`
- `lastKnownGeneratedAt`
- `lastKnownModelCount`
- `lastKnownLatestCount`
- `lastKnownRecommendedCount`
- `lastAvailabilitySource`
- `lastValidationRunId`
- `lastValidationOk`
- `lastValidationAt`
- `lastSuccessfulValidationAt`
- `lastValidationErrorCode`
- `lastValidationErrorMessage`
- `lastValidationStrategy`

### `getProviderConnection(providerId)`

Return the saved connection state without exposing plaintext credentials.

Suggested fields:

- `providerId`
- `status`
- `credentialSummary`
- `keyVersion`
- `createdAt`
- `updatedAt`
- `lastConnectedAt`
- `lastRotatedAt`
- `lastValidatedAt`
- `lastValidationOk`
- `lastValidationErrorCode`
- `lastValidationErrorMessage`
- `lastValidationStatus`
- `metadata`

### `listRefreshRuns()`

Return recent refresh history for auditing and debugging.

Suggested filters:

- `providerId`
- `limit`

### `listValidationRuns()`

Return recent validation history for auditing and setup debugging.

Suggested filters:

- `providerId`
- `limit`

### `getCatalogMeta()`

Return the current catalog and runtime-store metadata.

Suggested fields:

- `generatedAt`
- `sourceStatus`
- `runtimeStore.kind`
- `runtimeStore.path`
- `runtimeStore.preferredKind`
- `runtimeStore.availablePaths`
- `runtimeStore.fallbackReason`
- `runtimeStore.supportsCredentialVault`
- `credentialVault.algorithm`
- `credentialVault.keyVersion`
- `credentialVault.secretSource`
- `credentialVault.usesDefaultSecret`
- `accessControl.enabled`
- `accessControl.tenants`
- `tenantServices.tenantsRoot`
- `tenantServices.cachedTenants`
- `tenantServices.secretSourceType`
- `tenantServices.secretSourceRoot`

## UI guidance

The UI should call these in order:

1. `listProviders`
2. `getProviderSetup`
3. `validateProviderCredentials`
4. `listModels`

Do not call `listModels` before the provider is known. Do not derive setup fields from model data.

## Agent guidance

Expose the same contract as internal tools:

- `listProviders`
- `getProviderSetup`
- `listModels`
- `refreshProviderModels`

This keeps the agent deterministic. The agent should select from your normalized catalog, not infer latest models from upstream JSON.
