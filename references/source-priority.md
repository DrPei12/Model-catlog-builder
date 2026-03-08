# Source Priority

## Source-of-truth order

Use this priority order when merging model metadata.

1. Official provider model-list API
2. Official provider documentation or release notes when the API lacks metadata
3. `models.dev`
4. Gateway catalogs as separate providers
   - `OpenRouter`
   - `Vercel AI Gateway`
5. `LiteLLM` public model map
6. Manual overrides

## What each source is good for

### Official APIs

Use these to answer:

- does this model currently exist for this provider
- which model ID should the user choose
- what should the product call "latest" for this provider

### `models.dev`

Use this to fill:

- release dates
- last-updated dates
- capabilities
- context limits
- pricing

Treat it as metadata help, not the final authority for direct provider availability.

### `OpenRouter` and `Vercel AI Gateway`

Treat these as their own providers, not as proof that the upstream provider exposes the same models directly. They are excellent for:

- broad discovery
- long-tail model coverage
- pricing hints
- capability hints

### `LiteLLM`

Use it as a fallback metadata source. Do not use it alone to decide which models are newest or currently enabled in production.

## Merge rules

- Prefer higher-priority sources when two sources disagree.
- Preserve all contributing source names on the normalized record.
- Keep raw snapshots for debugging.
- If a model disappears from a lower-priority source but still exists in a higher-priority source, keep it active.
- If a model disappears from the top source, mark it `suspect-missing` first, then `deprecated` after repeated misses.

## Sync cadence

- on first provider connection: sync that provider immediately
- daily: refresh enabled providers
- weekly: audit diff volume, deprecations, and pricing changes

For the bundled script, official sync is enabled when these environment variables are present:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`

## Failure behavior

If official sync fails:

- serve the last successful catalog
- surface the last sync time in admin
- alert if failures repeat
- allow manual refresh

If public metadata sources fail:

- keep serving official availability data
- skip metadata enrichment for that run

## Provider-specific note

For direct providers such as `openai`, `anthropic`, `google`, `qwen`, or `minimax`, use their own availability signal when possible. For gateway providers such as `openrouter` or `vercel-ai-gateway`, store routed model IDs exactly as the gateway expects.
