# PLAN — Event Versioning & Upcasters (Epic 8)

A standalone plan for a single epic that **amends a ratified non-negotiable**. Read CLAUDE.md, FOUNDATION.md, and DRAFT-AND-HALT.md first. This epic does not begin until its FOUNDATION amendment (Gate 0) is ratified.

**What this reverses.** FOUNDATION.md:37 ("topics are opaque… the library never relates `file.create.v1` to `v2`") and :190 ("Event versioning / upcasting / migration" is *out of scope for core*), and the CLAUDE.md non-negotiable "Versioning is a naming convention, not a feature. No upcasters, no version field, no migration machinery." It also **escalates REFINEMENTS B1**, which recorded the deliberate stance that the library *stays out* of versioning and ships a guide instead. This plan brings the mechanism *in*.

**Why it can still be "mechanism, not judgment."** Core already runs user-supplied pure functions at defined points — projection reducers, strippers. An upcaster is the same shape: a pure transform the consumer *declares*, that core applies *in declared order*. Core never parses or understands version semantics; it stores an opaque ordinal and applies the chain from that ordinal to head. That reconciliation is the load-bearing argument of the amendment, and it must be ratified before any code.

---

## The model being committed

- An event has a **stable base identity** (`account.opened`) and an **ordered list of versions**, each `(schema, upcast?, strip?)`.
- Persisted events are written at whatever version was current at write time and **are never mutated** by versioning. Each persisted event carries an **opaque version ordinal** (the discriminator the read path needs).
- **Upcast is forward and read-only.** At consumption (projection build / aggregate import), a stored payload is run `vN → … → head` so consumers only ever see the head shape. Storage is untouched.
- **Strip is in-place and version-local.** Right-to-forget mutates the *as-stored* record, which lives at its write version — so each version owns its own stripper. Strippers do **not** compose along the chain.
- **Stripped output must be schema-valid** for its own version. The strip mechanism re-validates the stripper's output against that version's schema and raises a **mechanical error** on failure (the kind core is allowed to raise). Consequence: every stored event is always valid for its version, so **upcasters are guaranteed valid inputs** — the strip and upcast chains decouple completely.

| | direction | touches storage? | composes along chain? | re-validated? |
|---|---|---|---|---|
| **upcast** | forward (prev → this) | no | yes — chained to head | input guaranteed valid |
| **strip** | in-place (this → this) | yes | no — each version stands alone | yes — output vs own schema |

---

## Gate 0 — FOUNDATION amendment (HALT)

Draft the amendment to FOUNDATION.md and the CLAUDE.md non-negotiable:
- Reverse :37/:190 and the "no version field / no upcasters" non-negotiable to the model above.
- Record the **persisted version ordinal** as the one new field on the stored event, and confirm it is opaque (core never parses it, only counts from it).
- Record the **strip/upcast asymmetry** table and the **stripped-output-must-be-valid** ruling.
- Record the **mechanism-not-judgment reconciliation** verbatim, so the reversal is justified on the record.
- Mark **REFINEMENTS B1** superseded by this epic.

⛔ **HALT.** Surface the amendment. This is a reversal of a settled non-negotiable — it gets its own ratification before any contract is drafted. (DRAFT-AND-HALT.md.)

---

## Phase A — Draft the contract (HALT)

Write as real `.ts` in `packages/core/src/event/`, stubbed (`throw new Error("not implemented — awaiting ratification")`). No implementation, no tests yet.

**The type-state builder** (proves the three compile-time rules structurally):
- `event(topic)` → `EventStart` — only `.version()`.
- `EventStart.version(schema)` → `Complete<O1>` — the **first** version routes straight to `Complete`, which has **no `.upcast`** (first version structurally cannot upcast).
- `Complete<Cur>.version(schema)` → `Pending<Cur, Output<S>>` — a later version.
- `Pending<Prev, Cur>` exposes **exactly one** method: `.upcast(fn: (event: Prev) => Cur) → Complete<Cur>` (upcast is therefore mandatory — nothing else is reachable, including the terminal).
- `Complete<Cur>` exposes `.strip(fn: (event: Cur) => Cur)`, `.version(...)`, and the **terminal/register** step. The terminal lives only on `Complete`, so a dangling `Pending` is an unusable definition.

**The persisted event shape** — add the opaque version ordinal; confirm nothing else changes.

**The read/build seam** — where core threads a stored payload through the upcast chain (projection builder + aggregate import). Identify the exact functions touched.

**The strip seam** — per-version stripper applied to the as-stored payload, output re-validated against that version's schema.

**Open decisions to rule on at this gate** (do not pick silently):
1. **Single-version ergonomics / migration of existing events.** Today's events use the pre-version `event()` API; this is a breaking core change. Is the first `.version()` the canonical single-version form (all existing events migrate to `.version(schema)`), or is there a shorthand? How do the existing core/persistence tests and the worked examples migrate?
2. **Topic identity.** Does a projection subscribe to the base `account.opened` (versions hidden beneath), or do `.v1/.v2` remain real topics the chain bridges? (The ref implies the former.)
3. **Ordinal representation** — integer index vs a recorded version label; what persistence stores and how the adapters carry it (touches Epic 4's stored shape and the conformance suite).
4. **Strip-then-upcast at head** — confirm a stripped, then upcasted, event is required to be valid at head, and what happens if a later upcast would reintroduce a field strip removed.

⛔ **HALT.** Surface the drafts. Await **per-artefact** ratification.

---

## Phase B — Build (only after ratification)

- Implement the builder to match the ratified type-state exactly.
- Implement the persisted ordinal and its read/write through persistence (touches `packages/persistence` and each adapter's stored shape — keep the ordinal opaque end to end).
- Implement the read-path upcast threading in the projection builder + aggregate import.
- Implement per-version strip with output re-validation → mechanical error on invalid output.
- Migrate existing event definitions, examples, and their tests to the ratified single-version form (decision 1).

---

## Phase C — Prove (create / test / prove)

**Type-level tests (new in kind — the safeguard is a compile-time guarantee).** Using the existing `@ts-expect-error` discipline:
- `@ts-expect-error` — `.upcast` after the **first** version is rejected.
- A second `.version()` with **no** `.upcast` cannot reach the terminal (definition unusable).
- `upcast`'s input type **is** the previous version's output; a wrong-shaped param fails to compile.
- `upcast` must **return** the current version's shape; an incomplete object fails to compile.
- `strip`'s input/output are the version's own shape.

**Runtime unit tests:**
- Upcast chain composes `v1 → v2 → v3`; a v1-stored event read at head equals the expected head shape.
- Mixed-version stream → projection sees every event at head shape.
- Strip output re-validated; a stripper returning a schema-invalid payload raises the mechanical error.
- Stripped v1 event still upcasts to a valid head shape (decouple proof).

**Worked example:** a stream with mixed-version stored events, projected end-to-end (all at head), plus a right-to-forget sweep across mixed versions using per-version strippers — proving both chains on one stream.

---

## Definition of done

Gate 0 amendment ratified; Phase A contract ratified per-artefact; implementation matches the ratified shapes; existing events migrated; type-level **and** runtime tests pass; the worked example proves mixed-version projection and per-version stripping. REFINEMENTS B1 marked superseded.

## Gates, in one place

0. **FOUNDATION amendment** drafted → **HALT** → ratify (reversal of a non-negotiable).
1. **Phase A contract** drafted (stubbed) → **HALT** → per-artefact ratify.
2. Then build → migrate → prove.
