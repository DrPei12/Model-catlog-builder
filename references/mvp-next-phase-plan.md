# Next Version Plan

## Current Position

`Model-catlog-builder` is now at a usable MVP stage for Node.js and Next.js AI applications.

What the current MVP already proves:

- We can normalize model catalogs from multiple sources into one app-friendly structure.
- We can expose provider setup, model listing, routing config, and admin operations through one starter API.
- We can support an OpenClaw-style configuration model with `provider/model`, `primary`, `fallbacks`, and `allowlist`.
- We can generate a starter app with admin pages, health checks, and a minimal deployment path.
- We have completed one real integration validation in `ErrorPare`, which shows the package can replace hardcoded provider/model setup logic in a real AI application.

This means the project has crossed the "can we build it?" stage.
It is now in the "will developers actually adopt it because it saves time?" stage.

## Product Goal For The Next Phase

Do not expand into a larger platform.

The next-phase goal is:

**Make this package fast to understand, fast to embed, and obviously useful in a second real AI application.**

## Target Users

The next version should focus on these users only:

- Solo developers building AI applications
- Small product teams using Node.js or Next.js
- Teams that already have an AI product and want to stop hardcoding provider/model config

We are not optimizing yet for:

- Large enterprise platform teams
- Non-Node primary stacks
- Heavy multi-team governance workflows
- Broad cloud-infrastructure abstraction

## What We Should Not Do Next

To protect focus, avoid these directions in the next cycle:

- Adding many more providers just for coverage
- Expanding admin and operations features beyond the current essentials
- Building more infrastructure adapters unless a real integration blocks on them
- Customizing default recommendations for many app categories
- Turning the project into a general AI platform control plane

## Next 4 Weeks

### Week 1: Tighten The Integration Story

Goal:
Make the package easier to embed in an existing application.

Deliverables:

- A short "start here" path in the main docs
- A minimal embed guide for existing Next.js apps
- A minimal embed guide for "API only" usage
- A cleaner explanation of what an integrating app must own versus what the package provides

Success check:

- A new developer can identify the shortest integration path in under 5 minutes
- The package surface feels smaller and clearer, even if the internal system stays the same

### Week 2: Second Real Integration Validation

Goal:
Confirm the MVP is not only useful for `ErrorPare`.

Deliverables:

- Integrate the package into one more real AI application with a different product shape
- Capture friction points during the integration
- Record what the app had to adapt locally

Success check:

- The second integration still saves meaningful engineering time
- The API and config model remain mostly stable across two different apps

### Week 3: Reduce Adoption Friction

Goal:
Make the first-use path feel more complete.

Deliverables:

- A clearer starter README
- A smaller default setup path with fewer decisions
- Better provider selection copy and setup guidance in the starter UI/CLI
- A default "happy path" that works with one provider and one fallback

Success check:

- The package feels like a productized starter, not a collection of building blocks
- A developer can reach a working provider/model setup with fewer choices and less hesitation

### Week 4: MVP Release Readiness

Goal:
Prepare for small-scale external trial use.

Deliverables:

- An MVP release checklist
- A recommended trial scope
- A clear support boundary: what this MVP supports and what it does not
- A short feedback template for trial users

Success check:

- We can confidently invite a small number of external developers to try it
- We know exactly what feedback matters for the next iteration

## Three Metrics That Matter

We should measure only a few things in the next phase:

1. Time to first working integration
2. Number of app-specific patches required during integration
3. Whether the integrating team says this removed enough model-config work to be worth keeping

## Release Framing

The next version should be described as:

**An embeddable LLM configuration starter for AI applications**

It should not be described yet as:

- an enterprise control plane
- a universal multi-cloud model platform
- a zero-customization solution for every stack

## Decision Rule

If the next real integration still shows clear time savings, continue investing.

If the second integration needs too much app-specific glue, the next step should be to simplify and narrow the package surface before adding any more capability.
