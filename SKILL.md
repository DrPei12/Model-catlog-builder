---
name: llm-model-catalog-builder
description: Build, refactor, or review provider-first LLM model catalogs and model picker flows. Use when Codex needs to help developers support multiple AI providers, normalize model metadata, sync latest models, define provider-specific auth forms, or build admin and user interfaces for model selection, overrides, and maintenance.
---

# LLM Model Catalog Builder

## Quick Start

Treat model selection as a product system, not as a prompt engineering problem. Split the work into four layers:

- `provider registry`: the list of providers, auth methods, and setup forms
- `catalog sync`: the normalized model directory built from official or public sources
- `rules and overrides`: tags such as recommended, latest, preview, hidden, and pinned aliases
- `APIs and UI`: provider picker, auth form, model list, and admin maintenance tools

Start by copying these resources:

- `assets/provider-registry.template.json`
- `assets/catalog-overrides.template.json`
- `assets/model-catalog.schema.json`
- `assets/starter-api/modelCatalogService.mjs`

Run the bootstrap script to generate a provider-first public catalog:

```bash
npm run sync:catalog -- \
  --output output/model-catalog.generated.json \
  --registry assets/provider-registry.template.json \
  --overrides assets/catalog-overrides.template.json
```

Start the interactive demo server:

```bash
npm run demo
```

Then open `http://localhost:4177`.

The script is a bootstrap layer, not the final production sync. For enabled providers in production, add official model-list sync and keep public catalogs as fallbacks.

If you set any of these environment variables, the script will use official provider model lists before public catalogs:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`

## Workflow

### 1. Define the provider registry first

Do not start from model JSON. Start from the providers your product wants to expose.

For each provider, define:

- `providerId`
- `displayName`
- `auth.strategy`
- `auth.fields`
- `discovery.mode`
- `discovery.officialListEndpoint`
- `supportsManualAllowlist`
- help text for setup and error recovery

Use `assets/provider-registry.template.json` as the starting point. Add providers only when you can explain their auth flow and model discovery strategy.

### 2. Build a normalized catalog layer

Never let the UI or an agent consume raw upstream JSON directly. Normalize everything into a single schema.

Minimum model fields:

- `providerId`
- `modelId`
- `displayName`
- `family`
- `stage`
- `releaseDate`
- `lastUpdated`
- `contextWindow`
- `maxOutputTokens`
- `capabilities`
- `pricing`
- `sources`

Read `references/source-priority.md` before wiring sync logic. Read `references/architecture.md` before defining tables or APIs.

### 3. Separate rules from source data

Keep source facts and product rules separate.

Source facts:

- official availability
- model IDs
- pricing
- context size
- supported capabilities
- release dates

Product rules:

- recommended models
- latest labels
- preview visibility
- deprecated visibility
- pinned aliases
- renamed display names
- custom sort order

Use `assets/catalog-overrides.template.json` to keep those rules versioned and reviewable.

### 4. Build APIs before UI polish

Expose a stable API surface for the frontend and agent layer:

- `listProviders()`
- `getProviderSetup(providerId)`
- `validateProviderCredentials(providerId, credentials)`
- `listModels(providerId, filters)`
- `refreshProviderModels(providerId)`

The frontend should never infer auth forms or latest models by itself.

### 5. Build the picker as a three-step flow

Read `references/ui-patterns.md` before implementing UI.

Default interaction:

1. Choose provider
2. Fill provider-specific auth form
3. Choose model from `recommended`, `latest`, and `all`

Hide deprecated models by default. Label preview models clearly. Keep an advanced path for power users who need raw model IDs or custom compatible endpoints.

### 6. Add maintenance paths on day one

Read `references/operations.md` before shipping production sync.

At minimum, support:

- daily refresh
- refresh on first provider connection
- sync logs
- diff history
- alerts on provider failures
- manual hide and rename
- alias pinning for production stability

## Resource Guide

### `scripts/sync_model_catalog.mjs`

Use this to bootstrap a normalized public catalog from `models.dev`, `OpenRouter`, `Vercel AI Gateway`, and `LiteLLM`. It is useful for scaffolding and for filling metadata gaps. Replace or augment it with official provider sync for providers that your users can authenticate against directly.

### `references/architecture.md`

Load this when designing tables, services, API routes, or the agent tool surface.

### `references/source-priority.md`

Load this when deciding what counts as source-of-truth and how to merge upstream sources.

### `references/ui-patterns.md`

Load this when building the provider picker, auth forms, or model selection views.

### `references/product-patterns.md`

Load this when you want to borrow proven interaction patterns from OpenCode, Open WebUI, OpenHands, or LobeChat.

### `references/api-contract.md`

Load this when exposing provider and model data to a frontend, agent tool, or backend integration.

### `assets/starter-api/modelCatalogService.mjs`

Copy this when you want a minimal Node service wrapper around the generated catalog. It exposes `listProviders`, `getProviderSetup`, and `listModels` without forcing your product code to parse the catalog shape directly.

### `scripts/run_demo_server.mjs`

Use this when you want a zero-dependency demo server. It serves both JSON APIs and a browser page that demonstrates the provider-first flow.

### `references/operations.md`

Load this when defining maintenance jobs, admin actions, or alerting.
