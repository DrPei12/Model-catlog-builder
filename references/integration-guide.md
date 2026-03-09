# Integration Guide

## Goal

Help developers import the starter into an existing AI application with the least amount of decision fatigue.

## What this package can do today

If you import the current starter, you get these capabilities immediately:

- a provider registry with provider-specific auth forms
- a normalized model catalog instead of raw upstream JSON
- an OpenClaw-style routing config with `provider/model` refs
- API endpoints for providers, models, routing, runtime status, and health
- an `/admin` console in the full starter template
- credential validation, encrypted storage, refresh runs, and audit events

That is already enough to validate the core value:

developers no longer need to build provider setup, model sync, model picker defaults, and model fallback logic from scratch.

## Choose the smallest integration path

### Path 1: Generate a full app

Choose this when you want a working reference product first.

```bash
npm run scaffold:next -- ./my-model-catalog-app --template full --providers minimal
```

You get:

- `/api/model-catalog`
- `/admin`
- provider registry
- catalog sync
- model routing config

### Path 2: Add the API layer to an existing Next.js app

Choose this when your frontend already exists and you only need the backend model configuration layer.

Use:

- `assets/starter-api/index.mjs`
- `assets/starter-api/next/createNextRouteHandlers.mjs`
- `assets/starter-api/next/route.template.ts`
- `assets/provider-registry.template.json`
- `assets/catalog-overrides.template.json`
- `scripts/sync_model_catalog.mjs`
- `scripts/init_model_routing_config.mjs`

Minimum steps:

1. mount a catch-all route such as `app/api/model-catalog/[[...route]]/route.ts`
2. add `assets/provider-registry.template.json`
3. add `assets/catalog-overrides.template.json`
4. run `sync:catalog`
5. run `init:model-routing`
6. point your frontend model settings UI at `/api/model-catalog/...`

### Path 3: Use only the model configuration core

Choose this when your product already has its own backend and UI, and you only want the normalized model configuration logic.

Use:

- `scripts/sync_model_catalog.mjs`
- `scripts/init_model_routing_config.mjs`
- `assets/starter-api/modelCatalogService.mjs`
- `assets/starter-api/modelRoutingConfigService.mjs`

This gives you:

- normalized provider and model data
- editable allowlists
- primary model
- fallback chain

## The minimum user experience this starter enables

### For end users

- choose provider
- fill provider-specific auth
- choose model from a curated picker

### For operators

- connect and refresh providers
- decide which models appear in the picker
- choose the default model and fallback chain
- inspect recent runs and health status

That is the core UX promise of this project.

## Integration checklist

Before saying the integration is done, verify:

- `/api/model-catalog/providers` returns providers
- `/api/model-catalog/config/model-routing` returns refs in `provider/model` format
- `/api/model-catalog/health` returns `ok` or `degraded`
- one provider can connect successfully
- one provider can refresh successfully
- the picker can load `recommended` models from the API
- the routing config resolves without unexpected warnings

## Recommended first validation exercise

Do one small real-world test:

1. pick one existing AI app
2. add only `OpenAI`, `Anthropic`, and `OpenAI-Compatible`
3. mount the starter API
4. wire one settings page to the provider and model endpoints
5. confirm a user can finish:
   - choose provider
   - enter credentials
   - choose model
   - save primary and fallback

If that works quickly, the starter is proving its value.
