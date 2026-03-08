# Architecture

## Core modules

Split the system into five modules.

1. `provider registry`
   Stores provider metadata, auth strategies, setup copy, and discovery modes.
2. `catalog sync`
   Pulls upstream model data, normalizes it, snapshots it, and emits a provider-first catalog.
3. `rules and overrides`
   Applies product decisions such as recommended models, pinned aliases, hidden models, and display names.
4. `serving APIs`
   Returns provider setup definitions and model lists to both the frontend and the agent layer.
5. `operations`
   Tracks sync runs, diffs, alerts, and manual changes.

## Canonical entities

### ProviderDefinition

Use source control for this object so changes are reviewable.

Required fields:

- `providerId`
- `displayName`
- `auth.strategy`
- `auth.fields[]`
- `discovery.mode`
- `discovery.officialListEndpoint`
- `supportsManualAllowlist`
- `helpText`

### ModelRecord

Keep one normalized record per provider plus model ID pair.

Required fields:

- `providerId`
- `modelId`
- `displayName`
- `family`
- `stage`
- `releaseDate`
- `lastUpdated`
- `contextWindow`
- `maxOutputTokens`
- `capabilities[]`
- `pricing`
- `sources[]`

Recommended derived flags:

- `isLatestAlias`
- `isLatestStableRelease`
- `recommended`
- `hidden`

### ProviderCollections

Precompute these lists so the UI remains simple:

- `recommendedIds`
- `latestIds`
- `previewIds`
- `deprecatedIds`
- `hiddenIds`

### SyncRun

Track each sync run with:

- `providerId` or `global`
- `startedAt`
- `completedAt`
- `status`
- `sourceStatus`
- `added`
- `changed`
- `missing`
- `errorSummary`

## API surface

Keep the frontend and agents on the same contract.

Recommended endpoints or tools:

- `GET /api/providers`
- `GET /api/providers/:providerId/setup`
- `POST /api/providers/:providerId/validate`
- `GET /api/providers/:providerId/models`
- `POST /api/providers/:providerId/refresh`
- `GET /api/admin/model-overrides`
- `PUT /api/admin/model-overrides/:providerId/:modelId`

## Storage split

Use different homes for different kinds of data.

- provider registry: versioned JSON or code constants
- normalized catalog: database table or cached JSON blob
- snapshots and diffs: object storage or append-only table
- overrides: database table or versioned JSON, depending on how often non-developers edit it
- sync logs: append-only table

## Latest-model rule

Keep user-facing labels and runtime model IDs separate.

- display label example: `Claude Sonnet Latest`
- pinned runtime model example: `claude-sonnet-4-5-20250929`

Use aliases for ease of choice and pinned IDs for stable execution. Do not let a user-facing `latest` alias silently change existing production behavior without logging and review.

## Recommended rollout

Phase 1:

- 3 to 5 providers
- provider setup screens
- normalized public catalog
- manual overrides

Phase 2:

- official provider sync for enabled providers
- refresh logs
- alerting
- preview and deprecated rules

Phase 3:

- team policies
- budgets
- fallback routes
- scenario-based recommendations
