# API Contract

## Goal

Expose a stable product-facing contract so the UI and agent layer never read raw upstream catalogs directly.

The bundled demo server implements the read-only portion of this contract:

- `GET /api/providers`
- `GET /api/providers/:providerId/setup`
- `GET /api/providers/:providerId/models`
- `GET /api/providers/:providerId/runtime`
- `GET /api/catalog/meta`
- `GET /api/operations/refresh-runs`
- `POST /api/refresh`
- `POST /api/providers/:providerId/refresh`

## Recommended endpoints or tools

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

### `listRefreshRuns()`

Return recent refresh history for auditing and debugging.

Suggested filters:

- `providerId`
- `limit`

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
