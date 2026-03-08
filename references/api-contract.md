# API Contract

## Goal

Expose a stable product-facing contract so the UI and agent layer never read raw upstream catalogs directly.

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
