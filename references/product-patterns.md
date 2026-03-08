# Product Patterns

## OpenCode

Copy this pattern:

- connect the provider first
- show models only after provider setup exists
- keep provider setup and model choice as separate actions

Use this as the baseline for provider-first UX.

## Open WebUI

Copy this pattern:

- if the provider supports model discovery, use it
- if discovery is weak or noisy, fall back to a manual allowlist
- do not dump every routed model into the default UI

Use this when direct provider APIs and gateway catalogs behave differently.

## OpenHands

Copy this pattern:

- simple mode for most users
- advanced mode for raw provider plus model IDs

Use this when your audience mixes beginners and power users.

## LobeChat

Copy this pattern:

- maintain model overrides separately from provider env config
- support add, hide, rename, and deployment mapping

Use this when you need ongoing operator control without editing application code every time a model changes.
