# CLAUDE.md

**This file governs every interaction in this repository. Read it first, every time. The rules here outrank your own instincts about how to proceed.**

This is the build of an **event sourcing library** — a domain-agnostic TypeScript monorepo published as individually installable packages. The library is the foundation other projects are built on. It must be correct before it is complete.

---

## The single most important rule: Draft-and-Halt

**You design in drafts and stop. Hilary rules. Then you build.**

In the epics that design contracts (the core library, the persistence layer, the adapters), you work up to the *design artefacts* — interfaces, type signatures, data models, public API surface — and then you **HALT**. You do not write implementations. You do not write tests against those shapes. You surface the drafts and wait for an explicit, per-artefact go-ahead.

This is not a suggestion. It is the operating mode. The interfaces *are* the decisions; implementation is downstream of decisions. The full protocol is in **DRAFT-AND-HALT.md** — read it before starting Epic 3 or Epic 4.

"This looks good" on one interface is **not** blanket approval to build the rest. Each contract is its own gate.

---

## What to read, and in what order

The build-process docs live under **`docs/internal/`** (relocated there so the public repo root stays consumer-facing — see `docs/internal/README.md`). This file lives at `.claude/CLAUDE.md` and is still auto-loaded.

1. **`.claude/CLAUDE.md`** (this file) — how to behave here.
2. **`docs/internal/FOUNDATION.md`** — the conceptual model and the rulings that define the library. **This is the architecture. The sample code is not.**
3. **`docs/internal/DRAFT-AND-HALT.md`** — the review protocol for design artefacts.
4. **`docs/internal/PLAN.md`** — the epic-by-epic plan, dependencies, and gates.

---

## The architecture lives in the rulings, not the sample code

You may be given sample files (`event.ts`, `aggregate.ts`, `projection.ts`, and their schemas). **Treat these as illustration, not specification.** They were written across prior attempts and contain ambiguities and decisions that have since been superseded. Where the sample code and FOUNDATION.md disagree, **FOUNDATION.md wins, always.** Do not reverse-engineer architecture from the samples. The rulings are law; the samples are a sketch.

---

## Core design commitments (the non-negotiables)

These are settled. Do not relitigate them, do not "improve" them without asking.

- **The library is mechanism, not judgment.** It owns events, aggregates, projections, strippers, and the projection-build mechanism. It has **no business logic** and **no opinions about storage**.
- **The only errors the core raises are mechanical** — a payload that fails its schema, a malformed projection mapper, a topic collision. The core can never say "insufficient funds." Business validation is 100% the consuming app's responsibility.
- **The core has zero dependency on persistence.** No storage imports, no registry concept, no projection-store concept in core. Persistence is a separate, optional layer that depends *on* core — never the reverse.
- **Versioning is a first-class, type-safe mechanism — but core still understands nothing about it.** An event declares an ordered list of versions; each persisted event carries an opaque version ordinal; at read, core applies the declared upcast chain from that ordinal to head so consumers see the head shape. Upcasting is read-only — it never mutates persisted events. Core never parses or relates version *meaning*; it counts order and runs the user's pure functions, exactly as for projection reducers and strippers. Strippers are per-version and their output must be valid for that version's schema. *(Reverses the prior "naming convention / no upcasters / no version field" rule — see docs/internal/PLAN-EVENT-VERSIONING.md.)*
- **Events are almost-immutable.** They are never mutated in normal operation. The single exception is **stripping** (right-to-forget) — see FOUNDATION.md.

---

## How you write code here

- A **coding-style skill** is created in Epic 1 from Hilary's examples, *before* any library or scaffold code is written. Once it exists, **it governs all code you write.** Follow it.
- Until that skill exists, write nothing beyond what Epic 1 requires.
- Match Hilary's style. She has strong preferences. The skill is how you learn them — apply it, don't drift from it.

---

## Privacy rule for style-capture inputs (Epic 1)

Hilary will provide prior code examples to teach the style. **These must never be tracked or committed — not in the current tree, not in history.**

- Before requesting any examples, create the ignored input location and confirm it is in `.gitignore`. Verify with `git status` that the location is untracked **before** Hilary places anything in it. Ignore-first, paste-second — never the other way around (git will not retroactively ignore already-tracked files).
- The style skill must capture **abstracted rules and patterns**, never verbatim source. If recognisable chunks of the example code end up in the committed skill file, the privacy goal has leaked. Distil taste, don't transcribe.
- Hilary deletes the input location after the skill is approved. Because it was never tracked, nothing remains in history.

---

## Working discipline

- **Stop at the gates.** The HALTs in PLAN.md and DRAFT-AND-HALT.md are terminal steps, not checkpoints to pass through. The agentic pull to "just finish it while I'm here" is exactly the instinct to resist.
- **Surface decisions, don't make them silently.** When you hit a fork that isn't covered by FOUNDATION.md, stop and ask. Do not pick a direction and bury it in an implementation.
- **Prove your work.** "Create, test, prove" is the standard for the core and the adapters. Tests are part of done — but only *after* the relevant interface has been ratified.
- **Docker Compose for local dev/test** of the adapters (real Postgres, real Mongo, an S3-compatible service such as MinIO or LocalStack). The core needs none of this — it has no storage.

---

## Definition of done (per buildable epic)

An epic is not done until: drafts were ratified at the gate; implementation matches the ratified drafts; tests exist and pass; and the result is demonstrably provable (a worked example, a passing suite, or both). An unratified or untested epic is an open epic.