# Deployment Playbook

## Goal

Give developers a safe default path from local starter to first production deployment.

## Health endpoint

Use:

- `/api/model-catalog/health`

It returns:

- catalog availability
- unresolved model routing refs
- whether the app is still using the built-in development secret
- runtime persistence metadata

Wire this into platform health checks before you trust the deployment.

## Render

Render is the best default for the current starter because the runtime can keep using local SQLite plus file-backed state.

Recommended checklist:

- set `MODEL_CATALOG_SECRET`
- set `MODEL_CATALOG_API_KEYS` if you want tenant auth
- keep `RUNTIME_STORAGE_MODE=auto`
- point the service health check at `/api/model-catalog/health`
- review `render.yaml` before deploy

Official reference:

- [Render Blueprint spec](https://render.com/docs/blueprint-spec)

## Vercel

Use Vercel for previews or stateless demos unless you replace the starter's local persistence.

Why:

- the starter runtime assumes local files and SQLite are available across runs
- Vercel is better suited to external persistence products such as Blob, KV, or Postgres

If you want production on Vercel:

- replace local runtime persistence with an external store
- replace embedded or file-backed secrets with a secret manager
- treat the generated `vercel.json` as a delivery convenience, not as full production readiness

Official references:

- [Vercel storage overview](https://vercel.com/docs/storage)
- [Vercel Functions runtime](https://vercel.com/docs/functions/runtimes)

## Minimum production env vars

- `MODEL_CATALOG_SECRET`
- `MODEL_CATALOG_DEFAULT_TENANT`
- `MODEL_CATALOG_API_KEYS` if API auth is enabled
- `MODEL_CATALOG_SECRET_SOURCE`
- `RUNTIME_STORAGE_MODE`
- `RUNTIME_STATE_PATH`
- `RUNTIME_SQLITE_PATH`
- `RUNTIME_TENANTS_ROOT`

Start from `.env.production.example` in scaffolded projects.

## Production launch checklist

- `npm run sync:catalog`
- `npm run init:model-routing`
- verify `/api/model-catalog/health`
- verify `/admin`
- confirm a provider can connect and refresh
- confirm the routing config resolves without warnings
- rotate away from any development secret before launch
