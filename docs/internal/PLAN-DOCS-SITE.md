# PLAN — The 5-star documentation site

A standalone plan for turning the VitePress docs site (`website/`) into the best event-sourcing
library documentation on the internet: a click-and-paste onboarding experience, an exhaustive and
honest reference, and the library's best salesperson — all in the established house voice.

> **Status: DRAFT — awaiting ratification.** This plan is the design artefact. No pages get built
> until the information architecture and the open decisions below are ratified. Then we build in
> phases, page by page, each to "create / prove" standard (it renders, links resolve, code is real).

---

## 1. What "5-star" means here

Measured against the docs people actually rave about — Stripe, Prisma, Drizzle, Tailwind, Astro /
Starlight, Supabase, tRPC, Zod — the bar is:

1. **First success in under a minute.** A copy-paste path from "never heard of it" to a green run,
   with zero yak-shaving (auth, install, a runnable snippet that needs no edits).
2. **Three reading modes, all first-class.** *Learn* (concepts, narrative), *do* (task recipes),
   *look up* (reference: every export, every field, every error). A great site lets you switch modes
   without losing your place.
3. **Exhaustive, honest reference.** Every public symbol, every data model, every error code — with
   the cause and the fix. For a library whose whole identity is "the only errors are mechanical,"
   a complete **error index** is the single most on-brand page we can ship.
4. **Edge cases demonstrated, not buried.** Every sharp edge gets named, explained, and shown being
   handled in real code. Doubt is met head-on, the way `use-cases.md` already does.
5. **It sells.** Honest about trade-offs, confident about the bet, and structured so an evaluator
   reaches "yes" and an adopter reaches "running" by the shortest path.
6. **Built for its two heaviest users: future-Hilary and an AI assistant.** Fast lookup, stable
   anchors, copy-paste blocks, and the AI skills / `llms.txt` surface kept first-class.

---

## 2. Who's reading, and what they want

| Persona | Walks in asking | Primary pages |
| --- | --- | --- |
| **Evaluator** (skeptic) | "Should I use this? What's the catch? Is it production-ready?" | Why, Use cases, FAQ, Comparison, Architecture |
| **Onboarder** (just said yes) | "Get me running *now*, copy-paste, no edits." | Install, Quickstart, First projection |
| **Builder** (mid-build) | "How do I do *X* with the API?" | Builder guides, Recipes, API reference |
| **Integrator** (going to prod) | "Wire Postgres, observability, concurrency, GDPR." | Adapters, Repository, Observability, Operations |
| **Extender** (power user) | "Write my own adapter / observer; cross-stream models." | Extend section, Conformance, Read models |
| **Returner** (daily user / future-Hilary) | "What's that error again? That signature?" | Reference, Error index, Glossary, Search |
| **AI assistant** (Claude Code) | "Give me unambiguous, copy-paste-correct context." | Skills, `llms.txt`, Reference |

The current site serves Evaluator and Onboarder well, Builder and Integrator partially, and
Extender / Returner barely at all. The plan closes those gaps.

---

## 3. Target information architecture

New sidebar. **(NEW)** = page to write, **(KEEP)** = exists and is strong, **(ENHANCE)** = exists,
needs work. Ordering is the funnel: orient → onboard → learn → build → integrate → extend → look up.

```
Introduction
  Why event sourcing?                     (KEEP)
  Installation & setup                    (NEW   — split out, deepened: auth, local DBs)
  Quickstart: your first projection       (ENHANCE — the 60-second win, was getting-started)
  Common use cases                        (KEEP)
  Architecture at a glance                (NEW   — layers + diagram; core vs persistence vs adapters)

Concepts
  The mental model                        (ENHANCE — reconcile Scenario vocabulary; add a diagram)
  The three read scenarios                (NEW   — on-demand / self-healing / staged, as a concept)
  Mechanism, not judgment                 (NEW   — the philosophy as its own anchored concept page)

The builders (core)
  Defining events                         (ENHANCE — events.md; deepen schema-design guidance)
  Versioning & upcasters                  (NEW   — the "87 versions" deep-dive, strategies, perf)
  Modelling aggregates                    (ENHANCE — aggregates.md; add committed/staged diagram)
  Building projections                    (ENHANCE — projections.md; patterns + anti-patterns)
  Right-to-forget                         (ENHANCE — right-to-forget.md; add operational runbook)

Persistence & storage
  The repository & self-healing           (NEW   — repository methods + rebuild algorithm deep-dive)
  Storage adapters: overview & choosing   (ENHANCE — storage-adapters.md + decision matrix)
  Postgres adapter                        (NEW   — setup, DDL, client port, constraints)
  Mongo adapter                           (NEW   — setup, replica-set, client port, constraints)
  S3 adapter                              (NEW   — layout, etag CAS, costs, client port)
  Cross-stream read models                (NEW   — readModel / processor / feed; CURRENTLY UNDOCUMENTED)
  Observability                           (KEEP)

Customise & extend
  Write your own storage adapter          (NEW   — StorageI port + the conformance suite)
  Write your own observer                 (NEW   — channels, platform patterns, filtering)
  Spreading storage (destinations)        (NEW   — configurable destinations, one-adapter rule)

Recipes (cookbook)
  Testing events, aggregates, projections (NEW   — the create/test/prove standard for consumers)
  Modelling a state machine               (NEW)
  Multi-tenant & sharding by stream       (NEW)
  Incremental adoption from CRUD          (NEW)
  Bulk & operational right-to-forget      (NEW)

Examples
  Overview                                (ENHANCE — add "which example for which reader")
  Shopping cart                           (KEEP)
  Order fulfillment                       (KEEP)
  Document lifecycle                      (KEEP)
  Right-to-forget (GDPR)                  (KEEP)
  Self-healing (Postgres)                 (KEEP)
  Cross-stream read model                 (NEW   — worked example for the new capability)
  Custom in-memory adapter                (NEW   — write + certify an adapter end to end)

Reference
  API: core (event / aggregate / projection)   (NEW)
  API: persistence (repository / storage / observer)  (NEW)
  Data model reference                    (NEW   — the envelopes & schemas; "data models" page)
  Error index                             (NEW   — EVERY error, cause + fix; flagship)
  Glossary                                (NEW)
  FAQ & edge cases                        (KEEP)

For AI assistants
  Skills & llms.txt                       (ENHANCE — add a sample skill; "write your own")

Meta
  Changelog                               (NEW — optional)
  Contributing                            (NEW — optional)
  Roadmap                                 (NEW — optional)
```

Top nav (compressed): **Guide · Concepts · Reference · Examples · 🤖 AI · GitHub**.

---

## 4. The flagship reference pages (the biggest gap, the biggest win)

These three are net-new, fully grounded in the API maps already extracted, and are what separate a
"good readme-site" from "5-star docs."

### 4a. Error index — *the* on-brand page
A single searchable page listing **every** mechanical error the library can raise, grouped by layer,
each row: **code · what it means · what triggers it · how to fix it · link to the relevant guide.**
This is the page the Returner and the AI assistant will hit most.

Source enums (all confirmed in code):
- Core: `EventErrors` (PAYLOAD_INVALID, STRIPPER_DUPLICATE, STRIP_INVALID, UPCAST_INVALID,
  VERSION_UNKNOWN, VERSION_SEQUENCE, UPCAST_ON_FIRST_VERSION, UPCAST_MISSING),
  `AggregateErrors` (TOPIC_DUPLICATE, TOPIC_UNKNOWN, MISSING_CREATOR, EVENT_INVALID),
  `ProjectionErrors` (TOPIC_DUPLICATE, OUTPUT_INVALID, MAPPER_INVALID, EVENT_UNREGISTERED).
- Persistence: `StorageErrors` (VERSION_CONFLICT, OVERWRITE_UNKNOWN_POSITION, APPEND_NOT_CONTIGUOUS),
  `RepositoryErrors` (PROJECTION_AHEAD_OF_HEAD), `ReadModelErrors` (OUTPUT_INVALID, TOPIC_DUPLICATE,
  MAPPER_INVALID).

### 4b. Data model reference — the "data models" page Hilary asked for
The concrete persisted shapes, as real Zod schemas with field-by-field tables:
`EventEnvelopeV1` (incl. the opaque `version` ordinal, `position` lifecycle, `creator`, `headers`,
`created`), `CreatorSchemaV1`, `AggregateRefV1`, `StoredProjectionV1`, `StoredReadModelV1`,
`FeedEntry` / `FeedPage`. Plus a lifecycle note: which fields are set at create vs stage vs commit.

### 4c. API reference — curated, hand-written, voiced
Two pages (core, persistence). Every public export with signature, params, returns, throws, and a
minimal example. Hand-written (not TypeDoc) to keep the house voice and editorial control; the
surface is small enough that curation beats generation. Grounded in the two API maps.

---

## 5. Newly-discovered surface that must be documented

The audit found shipped, public capability with **no docs at all**. Exhaustiveness means covering it:

- **Cross-stream read models** — `readModel(name, schema, initial)`, `.on()`, `.fold()`; the
  `processor` (`catchUp` / `rebuild`, `batchSize`, at-least-once + resumable semantics); the
  `StorageFeedI` global feed (optional adapter capability; *must reflect in-place redactions* —
  GDPR-critical); `StoredReadModelV1` (cursor travels with state). → new guide + new example.
  ⚠️ **Positioning check needed** (see Decisions): a global firehose read model is exactly the
  "data on the outside" shape the Why page frames as *out of scope / build-it-yourself*. We need to
  decide how to present an optional capability that the marketing page currently disclaims.
- **The conformance suite** — `runConformance(makeStorage)`: the shared contract every adapter
  passes. This is a *selling point* ("certify your own adapter against the same suite the official
  three pass") and the backbone of the "write your own adapter" page.
- **Configurable destinations** — `Destinations` (events / projections / registry), the
  default-to-events rule, the one-adapter-per-repository / no-cross-destination-atomicity ruling.
- **Registry & projection-store seams** — `RegistryI`, `ProjectionStoreI` (thin views over the
  storage port) — reference-level, supports the repository deep-dive.

---

## 6. Cross-cutting craft (what makes it *feel* 5-star)

- **Diagrams.** Add Mermaid (VitePress plugin) for: the layer architecture, the committed/staged
  split, the self-healing three-path decision, the upcast chain, the forget sequence. Static SVG
  fallback where a diagram needs art direction.
- **Copy-paste integrity.** Every fenced block either runs as-is or is explicitly a fragment with a
  link to the full file. Audit found heavy verbatim duplication (event defs, the first-event
  contract, Postgres wiring, retry loops) — see §7.
- **An interactive playground** (stretch): a StackBlitz/Sandpack embed for the core-only path (no DB
  needed) so "your first projection" runs in the browser. Core has only Zod + nanoid deps, so this
  is feasible.
- **Onboarding polish.** Install page handles GitHub Packages auth properly; a Docker-compose
  snippet brings up local Postgres/Mongo/MinIO for the storage examples (the repo already uses
  compose for adapter tests — reuse it).
- **Navigability.** "Next / previous" footers, "on this page" outlines (VitePress default), a
  consistent "Where to next" block, and an "Edit this page" link (already configured).
- **Discoverability.** OG/social-card images, a tightened meta description per page, the existing
  local search kept (consider Algolia DocSearch later).
- **Landing page.** Sharpen feature cards from abstract benefits to concrete outcomes; add an install
  line to the hero; consider a second runnable snippet showing the storage-backed path.

---

## 7. De-duplication strategy

The audit found the same code/prose repeated across many pages (event definitions; the
"first folded event establishes the shape" contract; Postgres client-port wiring; the
VERSION_CONFLICT retry loop; staged-validation structure). Some repetition aids learning and stays.
But the canonical, long-form statement of each should live in **one** place and be *linked*:

- First-event contract → canonical in **Building projections**; examples link to it.
- Postgres wiring → canonical in **Postgres adapter**; the Postgres example links/uses it.
- Versioning/upcaster mechanics → canonical in **Versioning & upcasters**; FAQ & events link to it.
- Retry loop → canonical in **The repository & self-healing**; use-cases/examples link to it.

Rule of thumb: *teach once in depth, echo briefly elsewhere with a link.*

---

## 8. Phasing (proposed build order)

Each phase is independently shippable and leaves the site better than before.

- **Phase 1 — Reference spine (highest leverage for the daily user + AI).**
  Error index · Data model reference · API: core · API: persistence · Glossary.
  *Why first:* biggest current gap, unblocks linking from every other page, serves Returner + AI now.

- **Phase 2 — Onboarding & architecture.**
  Installation & setup · Quickstart polish · Architecture at a glance (with first diagrams).
  *Why:* the funnel's narrow neck; fastest path to "first success in a minute."

- **Phase 3 — Builder & persistence depth.**
  Versioning & upcasters · The repository & self-healing · per-adapter pages (Postgres/Mongo/S3) ·
  Storage decision matrix · enhance events/aggregates/projections with diagrams.

- **Phase 4 — Extend & the undocumented surface.**
  Write your own adapter (+ conformance) · Write your own observer · Spreading storage ·
  Cross-stream read models (guide + example) · custom-adapter example.

- **Phase 5 — Recipes & polish.**
  Testing recipe · state-machine · multi-tenant · incremental adoption · bulk forget ·
  playground · OG images · concept-page reconciliation (Scenario vocabulary) · landing refresh.

- **Phase 6 — Meta (optional).**
  Changelog · Contributing · Roadmap · Comparison-to-alternatives.

---

## 9. Open decisions for Hilary (ratify before building)

> **Ratified 2026-06-16:** (1) start with **Phase 1 — reference spine**; (2) cross-stream read
> models **documented as advanced opt-in** (full guide + example, with a Why-page note that the
> escape hatch exists); (3) **Mermaid diagrams + StackBlitz playground approved** (tooling installed
> in Phase 2 when first used). Per-adapter split and hand-written reference stand as recommended.
>
> **Ratified 2026-06-16 (Phase 2):** the live browser **playground is dropped** — the package is on
> GitHub Packages with restricted access, so anonymous installs are impossible; the Quickstart keeps
> an honest "run locally with `tsx`" path instead (revisit only if the package goes to public npm).
> Event **topics are normalised site-wide to the clean form** (`account.opened`, not
> `account.opened.v1`; `projection("balance", …)`, not `projection("projection.balance.v1", …)`) —
> the `.v1` suffix was a pre-versioning holdover, now that `.version(n, …)` owns versioning.
> *Follow-up flagged:* example `const` identifiers still carry a `…V1` suffix (`AccountOpenedV1`).

1. **Cross-stream read models — document and how to position?** It's shipped and public, but it's
   the "firehose / data on the outside" shape the Why page disclaims. Options: (a) document fully as
   an *advanced, opt-in* capability with a clear "you're now past the ORM line" framing; (b) document
   minimally in reference only; (c) leave undocumented for now. *Recommend (a).*
2. **Per-adapter pages vs one big storage page.** Split Postgres/Mongo/S3 into their own pages
   (deeper, better for the Integrator) or keep one combined page? *Recommend split.*
3. **Reference style** — hand-written curated (voiced, editorial) vs generated (TypeDoc).
   *Recommend hand-written* given the small surface and the premium on voice.
4. **Ambition / scope sign-off** — full IA above, or trim any sections (Recipes? Meta?
   Comparison?) before we start?
5. **Where to start** — Phase 1 (reference spine) as recommended, or front-load onboarding/sales
   (Phase 2) first?
6. **Diagrams + playground** — green-light the Mermaid plugin and a StackBlitz playground embed, or
   keep it pure-markdown for now?

---

## 10. Definition of done (per page)

A page is done when: it's in the ratified IA and sidebar; every code block is real (runs as-is or is
a marked fragment linking to the full source); every error/edge case it touches is named and shown
handled; internal links resolve; it carries the house voice (emoji anchors, honest callouts,
"where to next"); and it renders clean in `vitepress build`.
