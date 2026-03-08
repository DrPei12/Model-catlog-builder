# UI Patterns

## Default user flow

Keep the primary experience short and predictable.

1. `Choose provider`
2. `Fill setup fields`
3. `Choose model`

Do not show model choices until the provider is known. Different providers need different setup fields and support different model IDs.

## Provider picker

Show:

- provider name
- short help text
- auth method hint
- optional popularity or recommended badge

Avoid:

- huge flat lists with no grouping
- exposing raw endpoint terminology to new users

## Auth form

Drive the form from the provider registry.

Examples:

- `apiKey`
- `baseUrl + apiKey`
- `endpoint + apiKey + deploymentName`
- `oauth`

Show inline guidance and a verification button. Return a clear error when credentials fail.

## Model list

Default groups:

- `recommended`
- `latest`
- `all`

Recommended display fields:

- model display name
- short family or capability badges
- context size
- preview or deprecated labels
- optional price hint

Hide deprecated models by default. Preview models should remain visible only if the product audience can handle instability.

## Search and filters

Keep filters simple:

- text
- vision
- reasoning
- tools
- embeddings
- image generation

Only add advanced filters after users prove they need them.

## Basic and advanced modes

Use a split experience.

- Basic mode: curated providers, curated models, few decisions
- Advanced mode: raw model IDs, manual allowlists, custom compatible endpoints

This mirrors how tools like OpenHands and Open WebUI reduce cognitive load for most users while still leaving an escape hatch for power users.

## Save behavior

Save both:

- the label shown in the UI
- the exact runtime model ID

If the user selected a `latest` alias, also store the resolved pinned model so the system can explain later what actually ran.
