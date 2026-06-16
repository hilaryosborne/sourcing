# 📓 Changelog

This page tracks notable changes. Releases are managed with [Changesets](https://github.com/changesets/changesets): each package is versioned **independently** and follows [Semantic Versioning](https://semver.org/), so a change to one adapter bumps only that adapter. The format below follows [Keep a Changelog](https://keepachangelog.com/).

::: tip Pre-1.0
Every package is currently `0.0.0` — the surface is shaped and fully tested, but the first stable release hasn't been cut. Until then, treat the API as settling: it's deliberate and documented, but a `1.0` may still refine it. See the [Roadmap](/project/roadmap).
:::

## Unreleased

Everything built so far, grouped by area. This becomes the first published release's notes.

### Core — `@hilaryosborne/sourcing`

- **Events** — topics with versioned, Zod-validated payloads; eager `id`/`created`; required `creator` provenance.
- **Event versioning & upcasters** — 1-based ordinals, read-time upcast chain to head, nothing rewritten on disk; runtime-enforced version rules. ([Versioning →](/guide/versioning))
- **Aggregates** — the committed/staged split; faithful containers that enforce no business rules.
- **Projections** — pure folds with schema-validated output and the first-event-establishes-shape contract; full and delta (resume-from-state) builds.
- **Strippers** — per-version, named redactors for right-to-forget, with re-validated output.

### Persistence — `@hilaryosborne/sourcing-persistence`

- **Repository** — `create` / `load` / `commit`, self-healing `rebuild`, and `forget`.
- **Self-healing reads** — one head read picks full-build / delta-fold / cache-hit. ([Repository →](/guide/repository))
- **Optimistic concurrency** — real compare-and-append surfacing `VERSION_CONFLICT`.
- **Right-to-forget** — load → strip → in-place overwrite → bin projections.
- **Observability** — an optional, async-safe, passive, metadata-only observer (logger / report / hook) plus `consoleObserver`. ([Observability →](/guide/observability))
- **Cross-stream read models** — the `readModel` fold, the `processor` (catch-up / rebuild), and the `StorageFeedI` / `ReadModelStoreI` contracts. ([Read models →](/guide/read-models))

### Adapters

- **`@hilaryosborne/sourcing-adapter-postgres`** — relational, cheap deltas, unique-index CAS.
- **`@hilaryosborne/sourcing-adapter-mongo`** — document store, transaction-backed appends (replica set required).
- **`@hilaryosborne/sourcing-adapter-s3`** — single-object-per-aggregate, etag CAS, atomic reads.
- **Conformance suite** — one shared contract suite all adapters (and yours) are certified against.

### Documentation

- This site: onboarding, concept and builder guides, persistence and extension guides, recipes, a full reference (error index, data models, two API references, glossary), and the AI skills + `llms.txt`.

## How entries get here

When you land a change, you [add a changeset](/project/contributing#proposing-a-change) describing it and its bump level. On release, Changesets aggregates those into per-package version bumps and writes the published notes — so this page stays accurate without anyone hand-maintaining it.
