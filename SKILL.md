---
name: llm-model-catalog-builder
description: Build, refactor, or review provider-first LLM model catalogs and model picker flows. Use when Codex needs to help developers support multiple AI providers, normalize model metadata, sync latest models, define provider-specific auth forms, or build admin and user interfaces for model selection, overrides, and maintenance.
---

# LLM Model Catalog Builder

## Quick Start

What this gives a developer right now:

- provider-specific setup forms
- normalized model data
- OpenClaw-style model routing config
- starter APIs for provider, model, routing, runtime, and health
- an `/admin` console in the full template

Treat model selection as a product system, not as a prompt engineering problem. Split the work into five layers:

- `provider registry`: the list of providers, auth methods, and setup forms
- `catalog sync`: the normalized model directory built from official or public sources
- `rules and overrides`: tags such as recommended, latest, preview, hidden, and pinned aliases
- `model routing config`: OpenClaw-style picker allowlists, primary model refs, fallbacks, and auth profile order
- `APIs and UI`: provider picker, auth form, model list, and admin maintenance tools

Start by copying these resources:

- `assets/provider-registry.template.json`
- `assets/catalog-overrides.template.json`
- `assets/model-catalog.schema.json`
- `scripts/init_model_routing_config.mjs`
- `assets/starter-api/modelCatalogService.mjs`

Run the bootstrap script to generate a provider-first public catalog:

```bash
npm run sync:catalog -- \
  --output output/model-catalog.generated.json \
  --registry assets/provider-registry.template.json \
  --overrides assets/catalog-overrides.template.json
```

Then generate the OpenClaw-style routing config:

```bash
npm run init:model-routing -- --providers openai,anthropic,google
```

Start the interactive demo server:

```bash
npm run demo
```

Then open `http://localhost:4177`.

To generate a standalone Next.js starter app from this repo:

```bash
npm run scaffold:next -- ./my-model-catalog-app --name my-model-catalog-app
```

Useful scaffold options:

- `--template full` or `--template api-only`
- `--providers global | china | minimal | all`
- `--providers openai,anthropic,openai-compatible` for a custom provider set
- `--deploy vercel | render | none`
- `--multi-tenant`
- `--api-auth`
- `--skip-install`
- `--skip-sync`

Example:

```bash
npm run scaffold:next -- ./china-api --template api-only --providers china --deploy render --multi-tenant --api-auth
```

If you want to embed the runtime into another app instead of using the demo server, copy:

- `assets/starter-api/index.mjs`
- `assets/starter-api/createStarterApiService.mjs`
- `assets/starter-api/next/createNextRouteHandlers.mjs`
- `assets/starter-api/next/route.template.ts`
- `examples/next-starter/`

The starter API service uses the same developer-friendly fallback as the demo server: if `MODEL_CATALOG_SECRET` is not set, it falls back to a built-in development secret. That is convenient for local setup, but production deployments must provide their own secret explicitly.

To try the embedded Next.js starter example from the repo root:

```bash
npm run example:next:install
npm run example:next:build
npm run example:next:dev
```

The example app mounts the shared starter API through the Next.js route adapter and demonstrates both a landing page and an `/admin` console for provider setup, runtime status, model routing, and recent operations.
The example currently uses `--webpack` for Next scripts because this repo layout is more reliable there than with Turbopack when resolving the local starter package.

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
- `connectProvider(providerId, credentials)`
- `rotateProviderCredentials(providerId, credentials)`
- `revalidateProvider(providerId)`
- `disconnectProvider(providerId)`
- `listModels(providerId, filters)`
- `refreshProviderModels(providerId)`
- `getModelRoutingConfig()`
- `updateModelRoutingConfig(config)`

The frontend should never infer auth forms or latest models by itself.
If you need production-style isolation, scope runtime state per tenant instead of sharing one state file across every user.

### 5. Build the picker as a three-step flow

Read `references/ui-patterns.md` before implementing UI.

Default interaction:

1. Choose provider
2. Fill provider-specific auth form
3. Choose model from `recommended`, `latest`, and `all`

Hide deprecated models by default. Label preview models clearly. Keep an advanced path for power users who need raw model IDs or custom compatible endpoints.

### 5.5 Add a model routing layer instead of hard-coded defaults

Borrow this directly from OpenClaw:

- `agents.defaults.models` controls the picker allowlist
- `agents.defaults.model.primary` defines the production default
- `agents.defaults.model.fallbacks` defines fallback order
- `auth.profiles` and `auth.order` stay metadata-only

That keeps model configuration editable without mixing it into sync code or encrypted credential storage.

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

### `scripts/init_model_routing_config.mjs`

Use this after catalog sync when you want an OpenClaw-style routing file generated from the current provider set. It builds `provider/model` allowlists, a primary model ref, a short fallback chain, and default auth profile order metadata.

### `references/architecture.md`

Load this when designing tables, services, API routes, or the agent tool surface.

### `references/source-priority.md`

Load this when deciding what counts as source-of-truth and how to merge upstream sources.

### `references/ui-patterns.md`

Load this when building the provider picker, auth forms, or model selection views.

### `references/product-patterns.md`

Load this when you want to borrow proven interaction patterns from OpenCode, Open WebUI, OpenHands, LobeChat, or OpenClaw.

### `references/api-contract.md`

Load this when exposing provider and model data to a frontend, agent tool, or backend integration.

### `references/integration-guide.md`

Load this when the real question is "how do I import this into my AI app quickly?" It focuses on the smallest useful integration paths, what the starter can already do today, and the minimum checklist for validating its value in a real product.

### `assets/starter-api/modelCatalogService.mjs`

Copy this when you want a minimal Node service wrapper around the generated catalog. It exposes `listProviders`, `getProviderSetup`, and `listModels` without forcing your product code to parse the catalog shape directly.

### `assets/starter-api/createStarterApiService.mjs`

Copy this when you want one reusable API surface for Node servers, route handlers, and tests. It centralizes the provider, runtime, connection, validation, refresh, and audit endpoints so you do not duplicate routing logic across frameworks.

### `assets/starter-api/index.mjs`

Copy this when you want a starter-package style entry point. It re-exports the catalog loader, runtime service, connection service, validation helpers, and the Next.js adapter.

### `assets/starter-api/validateProviderCredentials.mjs`

Copy this when you want a real credential validator for the production path. The current version supports `OpenAI`, `Anthropic`, `Google Gemini`, `OpenRouter`, `Vercel AI Gateway`, and `OpenAI-Compatible` endpoints, with explicit fallback messages for unsupported providers.

### `assets/starter-api/credentialVault.mjs`

Copy this when you need encrypted credential storage without adding another dependency. It uses AES-256-GCM and stores only masked summaries plus fingerprints in public state.

### `assets/starter-api/providerConnectionService.mjs`

Copy this when you want a product-facing connection layer on top of runtime persistence. It handles `connect`, `revalidate`, `disconnect`, connection inventory, and audit events while keeping plaintext credentials out of API responses.

### `assets/starter-api/apiAccessControl.mjs`

Copy this when you want lightweight API-key auth and tenant resolution. The starter supports `Bearer` tokens or `x-api-key`, and can map each key to a tenant.

### `assets/starter-api/tenantRuntimeServiceManager.mjs`

Copy this when you want tenant-aware runtime state without changing every storage schema. The starter isolates each tenant into its own runtime-state files while sharing the normalized model catalog.

### `assets/starter-api/secretSourceAdapters.mjs`

Copy this when you want pluggable secret storage. The starter includes an embedded adapter and a file-backed adapter, so you can prototype the contract before wiring a real secret manager.

### `assets/starter-api/modelRoutingConfigService.mjs`

Copy this when you want an OpenClaw-inspired routing layer for the model picker. It keeps picker allowlists, primary refs, fallback chains, and auth profile order in one editable config file without mixing that logic into catalog sync or credential storage.

### `assets/starter-api/catalogRuntimeService.mjs`

Copy this when you want refresh orchestration and runtime state without wiring those concerns directly into your HTTP server. It supports full-catalog refresh, provider-scoped refresh, refresh logs, validation logs, and provider runtime summaries backed by a SQLite-first runtime store with JSON fallback.

### `assets/starter-api/runtimePersistenceStore.mjs`

Copy this when you want a single runtime persistence entry point. The starter will prefer SQLite when the runtime supports `node:sqlite`, then fall back to the JSON store automatically if SQLite is unavailable.

### `assets/starter-api/sqliteRuntimeStore.mjs`

Copy this when you want a lightweight relational runtime store without bringing in an external database dependency. It persists refresh runs, validation runs, and per-provider runtime summaries.

### `assets/starter-api/runtimeStateStore.mjs`

Copy this when you need the JSON fallback store or want a fully inspectable state file during local development. It stores recent refresh runs, validation runs, and per-provider operational summaries in one file.

### `scripts/run_demo_server.mjs`

Use this when you want a zero-dependency demo server. It now reuses `createStarterApiService.mjs` and serves both product APIs and operational APIs, including refresh history, validation history, encrypted connection management, audit history, provider runtime state, and runtime-store metadata.

### `scripts/create-model-catalog-app.mjs`

Use this when you want to hand a developer a one-command bootstrap path. It generates a standalone Next.js app with local starter-api files, sync scripts, provider and rule templates, an OpenClaw-style model routing config, an `/admin` operator console in the full template, and an initial generated catalog. It also supports product presets for UI mode, provider mix, deploy target, multi-tenant runtime, and API auth.

### `assets/starter-api/next/createNextRouteHandlers.mjs`

Copy this when you want to drop the starter runtime into a Next.js App Router project. Pair it with `assets/starter-api/next/route.template.ts`, then mount the handlers in a catch-all route such as `app/api/model-catalog/[[...route]]/route.ts`.

### `examples/next-starter`

Copy this when you want a full example application instead of isolated snippets. It wires the shared starter API, the Next.js route adapter, and a product-style provider/model management interface into one runnable App Router project.

### `references/operations.md`

Load this when defining maintenance jobs, admin actions, or alerting.

### `references/deployment-playbook.md`

Load this when turning the starter into a deployable product environment. It explains the health endpoint, production env vars, and why Render is the safer default for the current local-persistence runtime while Vercel is better treated as preview-first unless you swap in external persistence.
