# Operations

## Maintenance rhythm

Use a fixed cadence.

- every provider connection: validate credentials and sync that provider
- daily: refresh enabled providers
- weekly: review deprecations, pricing diffs, and missing models
- monthly: clean up stale overrides and retired providers

## Minimum admin actions

Support these actions on day one:

- hide a model
- rename a model
- mark recommended
- pin an alias to a runtime ID
- connect a provider with encrypted credential storage
- revalidate a stored connection
- disconnect a provider and keep the audit trail
- trigger manual refresh
- inspect sync history

The starter runtime now includes:

- SQLite-first runtime persistence with JSON fallback
- full refresh runs
- provider-scoped refresh runs
- validation runs
- encrypted provider connection records
- audit events for connect, rotate, revalidate, and disconnect actions
- per-provider runtime summaries with both refresh and validation state

## Alerts

Alert when:

- provider sync fails repeatedly
- model count drops sharply
- a recommended model becomes preview or deprecated
- pinned aliases no longer resolve
- pricing changes beyond your chosen threshold

## Safe deletion policy

Do not hard-delete models immediately.

Recommended flow:

1. missing once: mark `suspect-missing`
2. missing for multiple syncs: mark `deprecated`
3. only archive after historical references are no longer needed

## Review checklist

Before shipping changes:

- verify provider registry changes
- compare latest diff against previous sync
- confirm recommended models still exist
- confirm auth help text still matches the provider console
- verify the UI still hides deprecated entries by default
