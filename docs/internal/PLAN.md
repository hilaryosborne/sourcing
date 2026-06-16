# PLAN.md — The Build Plan

A domain-agnostic event sourcing library, built as a monorepo of individually publishable TypeScript packages.

**Before starting: read CLAUDE.md, then FOUNDATION.md, then DRAFT-AND-HALT.md.** The architecture is in FOUNDATION.md, not in any sample code.

The epics are ordered by dependency. Each buildable epic produces something provable before the next begins. Two epics (3 and 4) contain mandatory **HALT** gates — see DRAFT-AND-HALT.md.

---

## Epic 0 — Foundation & rulings (read-only)

**Goal:** Internalise the conceptual model before any work.

- Read FOUNDATION.md. This is the governing spec.
- The sample files (`event.ts`, `aggregate.ts`, `projection.ts`, schemas) are *illustration*, not specification. Where they conflict with FOUNDATION.md, FOUNDATION.md wins.
- Produce nothing in this epic except confirmation that the model is understood, and a short list of any points in FOUNDATION.md you find ambiguous — surface those to Hilary before proceeding.

---

## Epic 1 — Capture style + tooling conventions

**Goal:** Produce the coding-style skill(s) that govern all subsequent code, and decide the repo's tooling conventions — *before* any scaffold or library code exists.

**Privacy is critical here. See CLAUDE.md "Privacy rule for style-capture inputs."**

1. Create an ignored input location for Hilary's examples. Add it to `.gitignore` **first**. Run `git status` and confirm the location is untracked **before** Hilary places anything there. Ignore-first, paste-second.
2. Hilary places prior sourcing examples, previous attempts, and style references in that location, each marked **style-canonical** (learn this) vs **old-attempt** (learn the style, not the substance/architecture).
3. Distil **coding-style skill(s)** — abstracted rules and patterns only, **never verbatim source**. If recognisable chunks of the examples end up in the committed skill, the privacy goal has leaked. Capture taste, not transcription.
4. From the same study, propose the **tooling/convention decisions** that will govern the scaffold: package manager, monorepo tool, build, lint/format, test runner, TypeScript config conventions, naming.
5. **Surface the skill + tooling decisions to Hilary for review.** On approval, Hilary deletes the input location (nothing remains in history, as it was never tracked).

**Gate:** Style skill and tooling conventions ratified before Epic 2.

---

## Epic 2 — Scaffold the monorepo (per the skill)

**Goal:** A clean monorepo skeleton that obeys the Epic 1 skill and tooling decisions from its very first file.

- Workspace structure for individually publishable packages.
- Shared TypeScript / lint / format / test configuration per the ratified conventions.
- Placeholder package boundaries for: **core**, the **persistence layer**, and the **adapters** (Postgres, Mongo, S3) — empty but correctly wired into the workspace.
- No library logic yet. Scaffold only.

**Note:** Scaffold obeys the style skill — that is why the skill comes before the scaffold.

---

## Epic 3 — Core sourcing library: draft → HALT → ratify → build → prove

**Goal:** The aggregate. Events (with strippers), the aggregate, the projection builder, the staged-events mechanism. **Zero storage concepts** (see FOUNDATION.md).

**Phase A — Draft (then HALT):**
- Draft the interfaces / type signatures / data-model shapes for: event definitions + strippers; the aggregate (import / add / committed / staged / export / position); the projection builder; the staged-events mechanism.
- Write these as real `.ts` files with stubbed implementations (`throw new Error("not implemented — awaiting ratification")`).
- ⛔ **HALT.** Surface the drafts. Await **per-artefact** ratification. Do not implement. Do not test. (See DRAFT-AND-HALT.md.)

**Phase B — Build (only after ratification):**
- Implement each ratified artefact to match its approved shape exactly.
- The only errors the core raises are mechanical (schema validation, malformed mapper, topic collision). No business logic. No storage.

**Phase C — Prove:**
- Tests covering: event validation; aggregate import/add/committed-staged split; projection build; staged-events overlay (Scenario 3 in-memory); stripping (the pass/fail test — no PII survives in produced events).
- A worked example demonstrating Scenario 1 (projections on demand) end-to-end, in memory, with no persistence package.

**Definition of done:** ratified shapes, matching implementation, passing tests, a runnable proof. Core depends on nothing but its own dev tooling and Zod.

---

## Epic 4 — Persistence layer + adapters: draft → HALT → ratify → build → prove

**Goal:** The repository and the storage adapters. The persistence layer (aggregate registry, projection store, self-healing algorithm) composed on top of core, and the three reference adapters behind a shared interface.

This epic has two sub-layers. Keep them distinct — do not flatten the registry/algorithm into the adapters.

**Phase A — Draft the persistence contracts + storage interface (then HALT):**
- Draft the **storage interface** that all adapters will implement (the seam to Postgres/Mongo/S3). Draft it against all three reference stores at once — if it can't be honestly implemented by S3, it's wrong. Explicitly account for the **overwrite-events-in-place** operation that right-to-forget requires, and flag its cost on S3.
- Draft the **aggregate registry** contract (`aggregate id → current head position`).
- Draft the **projection store** contract (load/save a projection with its bookmark).
- Draft the **self-healing algorithm** as signature + described steps (the three-outcome logic from FOUNDATION.md Scenario 2).
- Stub implementations only.
- ⛔ **HALT.** Surface the drafts. Await **per-artefact** ratification. This is the load-bearing interface of the whole storage story — Hilary ratifies it here, and may bring it to a dedicated chat session for a deeper pass. Do not build adapters against an unratified interface. (See DRAFT-AND-HALT.md.)

**Phase B — Build the persistence layer (after ratification):**
- Implement the registry, projection store, and self-healing algorithm against the ratified contracts. This layer depends on core; core never depends on it.

**Phase C — Build the adapters (one task each, after the interface is ratified):**
- **Postgres adapter** — implements the storage interface.
- **Mongo adapter** — implements the storage interface.
- **S3 adapter** — implements the storage interface (the hard one).
- Each adapter is its own task and its own publishable package.

**Phase D — Prove:**
- **Docker Compose** for local dev/test: real Postgres, real Mongo, an S3-compatible service (MinIO or LocalStack).
- A shared conformance test suite that every adapter must pass against its real service — proving the interface holds across all three.
- A worked example demonstrating Scenario 2 (self-healing from storage) end-to-end against at least one adapter: no-projection → full build; stale → delta build; current → no-op return.

**Definition of done:** ratified contracts; persistence layer + three adapters implemented; all adapters pass the conformance suite against real services; self-healing proven end-to-end.

---

## Epic 5 — Deployment via GitHub Actions

**Goal:** Each package individually installable, published automatically. Public repo (not protected IP).

- Publishing target: **GitHub Packages** (Hilary's stated preference). Note for Hilary's awareness, not to action unless she changes the call: GitHub Packages requires consumers to authenticate to install *even public packages*, which is a documentation burden; npm would be frictionless for public consumers. Proceed with GitHub Packages unless Hilary rules otherwise.
- **Independent versioning** across the monorepo — when only one adapter changes, only it publishes. Use a changesets-style workflow; do not publish all packages in lockstep.
- GitHub Actions: build, test (including the adapter conformance suite via Docker Compose in CI), version, publish.
- Correct `publishConfig` / scope on every package.

---

## Epic 6 — Documentation & skills

**Goal:** Make the library usable by developers who want to *consume* it (not contribute to it).

- **A five-star README**, audience = developers using the library. Lead with the mental model and a fast "first projection in 60 seconds," then the three scenarios, then the right-to-forget story. Consumer-facing, not contributor-facing.
- **A concepts skill/doc** teaching the mental model — aggregate / repository / storage adapter, strippers, staged events, self-healing. Someone who doesn't grasp the model will misuse the parts; this is the "why."
- **Four component skills** for working with the library via an AI assistant: one each for **events**, **aggregates**, **projections**, and **storage adapters**. These are the consumer counterpart to the Epic 1 styling skill (which was about writing *in* the repo; these are about *using* the published packages).
- Contributor docs are secondary; cover them lightly.

---

## Epic 8 — Event versioning & upcasters (separate plan)

First-class, type-safe upcasters: an event declares an ordered version chain; persisted events carry an opaque ordinal; core upcasts to head on read; strippers are per-version. **Amends a ratified non-negotiable** (FOUNDATION's "topics are opaque" / no-upcasters rule) — so it owns a FOUNDATION-amendment gate before its contract gate. Full plan: **`PLAN-EVENT-VERSIONING.md`**.

## The gates, in one place

1. **Epic 1:** style skill + tooling ratified before scaffold; examples deleted, never tracked.
2. **Epic 3:** core interfaces + data models drafted → **HALT** → per-artefact ratification → implement → test → prove.
3. **Epic 4:** persistence contracts + storage interface + each adapter contract drafted → **HALT** → per-artefact ratification → implement → test → prove.

**The through-line: Claude Code designs in drafts and stops; Hilary rules; then Claude Code builds.**