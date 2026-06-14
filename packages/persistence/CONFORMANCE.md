# CONFORMANCE.md — the StorageI conformance spec (DRAFT, design-and-ratify)

> **Status: design draft, no trusted test code yet.** This is what the conformance suite must
> PROVE. Phase D's halts are adversarial: the question at each is not "does this pass" but
> **"what would this fail to catch."** A suite that passes a broken adapter is worse than no
> suite — it certifies the swappable promise while letting it be false.

## Provenance — spec-not-net (ratified)

The suite is derived from the `StorageI` contract + the §3 capabilities (FOUNDATION), stated
**without reference to how S3 / Postgres / Mongo each achieve them**, then the adapters are
checked against it — never the reverse. A suite generalized from the three implementations
inherits any assumption all three happen to share and certifies it as correct; catching a
shared-wrong-assumption is the whole point of conformance, and it structurally cannot do that
if its provenance is the implementations.

- **One parameterized `conformance(makeStorage)`** run against each participant.
- **Fixtures are per-adapter** (construction is irreducibly different — `s3Storage(client,{bucket},dest)` sync; `postgresStorage`/`mongoStorage` async; distinct clients; clean-store teardown). Normalized behind one `await makeStorage()`.
- **Assertions NEVER branch on adapter type and never reference the route.** The three reach `VERSION_CONFLICT` via etag-CAS / 23505 / 11000 — the suite only ever asserts the fact ("concurrent append at a taken position is rejected"), never the mechanism. Same for overwrite.
- **Optional capabilities stay OUT of the core suite.** Global / cross-stream ordering (§3 item 4) is not the shared port. If ever tested, a separate opt-in suite — never a branch here.

## The append-contiguity fork — RULED: it IS a conformance requirement

An `append` whose first position ≠ `(expectedHead ?? -1) + 1` is rejected with
`APPEND_NOT_CONTIGUOUS`, and nothing is written. Reasoning:

1. Swappability demands identical observable behavior on **bad** inputs, not just good ones —
   else a latent caller bug is a loud error on one adapter and silent corruption on another.
2. The unique index catches **duplicates but not gaps**: `expectedHead=5` / position `7` is
   silently accepted by a PK-only adapter and rejected by S3's single-file check. Only a
   contract requirement forces convergence.
3. It is in the shared `StorageErrors` vocabulary — a contract-level fact.

**Consequence faced (not smoothed):** the Phase B in-memory double does NOT throw
`APPEND_NOT_CONTIGUOUS` — it is **non-conformant**. The Phase B repository/forget proofs rested
on that under-meeting reference, yet **remain valid**: they never exercised the gap (inputs are
core-generated and always contiguous; a repository contiguity bug would have surfaced as wrong
projection _values_, not been masked by the double's silence). **Action: bring the double to
conformance** (add the contiguity check). No Phase B re-run needed — the un-implemented path was
never hit. This is the double earning its keep: the conformance run validated the reference and
already found it incomplete.

---

## Contract-facts — adapter-blind assertions

### `head(stream)`

- Empty / never-written stream → **`undefined`** (pinned — the `(expectedHead ?? -1)` contiguity
  convention and the registry both depend on head-of-nothing having this defined answer; three
  implementations would otherwise quietly disagree).
- After appends → the highest stored position.
- Unaffected by `overwrite` (in-place redaction does not move the head).

### `read(stream, after?)`

- Empty / never-written stream → **`[]`** (pinned — empty, never throw. S3 no-object / Postgres
  empty-result / Mongo empty-cursor must all converge to `[]`; exactly the kind of edge three
  implementations disagree about).
- Full read (`after` omitted) → all events in strict position order.
- Delta read (`after = N`) → exactly the events with position > N, in order.
- **Delta at the head (pinned):** `read(stream, after = head)` → **`[]`** — no events exist past
  the head. This is the boundary the STALE-vs-CURRENT self-healing split rides on (CURRENT is
  `head === bookmark`; the stale path then asks for events after the bookmark). An adapter that
  returns anything but `[]` here diverges the three-outcome rebuild — so this connects the suite
  back to the Scenario-2 proof.
- A **gap** in the stream cannot occur (forbidden by `APPEND_NOT_CONTIGUOUS`), so `read` is not
  separately tested for gap-exposure: doing so would require constructing the gap the contract
  prohibits — i.e. driving a non-conformant adapter, which the suite structurally forbids.
  Covered transitively by the contiguity case.
- **Round-trip fidelity**: an appended envelope is returned **equal** (see the hostile-key
  adversarial case — this is where the document model may diverge).

### `append(stream, events, expectedHead?)`

- Happy: events land, `head` advances, `read` returns them.
- **`VERSION_CONFLICT`** when `expectedHead` does not match the stream's current head — the
  fact, never the route. Rejected ⇒ **nothing written** (all-or-nothing).
- **`APPEND_NOT_CONTIGUOUS`** when `events[0].position ≠ (expectedHead ?? -1) + 1` — its own
  error (caller bug, not a concurrency loss). Rejected ⇒ nothing written.
- Stream creation: append to a new stream (`expectedHead` omitted, position 0) succeeds; a
  second create-append at position 0 → `VERSION_CONFLICT`.
- **Observable retry-safety (pinned):** re-appending an already-landed commit (same events,
  same `expectedHead`) → `VERSION_CONFLICT`, and the stream is **unchanged — no duplication**.
  This is the storage-level fact the repository's "discard-and-reload, not retry" rests on; the
  reload-and-retry _policy_ itself is a repository property above this port (uniform across
  adapters), not a per-adapter conformance concern.
- **Empty append (pinned — honors `expectedHead`):** `append(stream, [], expectedHead)` writes
  nothing and advances nothing, but it STILL performs the compare. A **given-and-stale**
  `expectedHead` → **`VERSION_CONFLICT`** (exactly as a non-empty stale append); a matching or
  omitted `expectedHead` → no-op. `expectedHead` is the _expected version_ — the compare in
  compare-and-append, a precondition asserted whenever given, NOT merely a write-guard — so it
  is not skipped just because the batch is empty. This is what the ratified Phase A `append`
  contract literally says ("if given and it does not match the stream's current head, throw
  `VERSION_CONFLICT`"), unconditional on batch size; a "no `expectedHead` check" reading would
  contradict it. **Recorded adapter action:** all three adapters currently early-return on an
  empty batch _before_ the compare (implementing the contradicting reading for free) — they
  must compare `expectedHead` on an empty batch before the no-op. Same family as the double's
  contiguity gap: a spec ruling on contract-meaning forcing a small adapter change, not a
  free-behavior pin.

### `overwrite(stream, events)`

- Happy: redacts in place at `(stream, position)`; `read` returns the redacted payload;
  **identity preserved** (id / position / topic unchanged, only payload differs).
- **`OVERWRITE_UNKNOWN_POSITION`** on any position not stored.
- **All-or-nothing, set-membership (not cardinality):** overwriting a set where one position
  is missing redacts **none** and throws; and a duplicate position must not fake the count (see
  the set-membership adversarial case).
- **Head-invariant, including overwrite of the head position (pinned):** `head(stream)` is the
  same before and after `overwrite` — **even when the redacted position IS the current highest**.
  Identity-preservation says position is unchanged, so the max is unchanged; "should be safe" is
  exactly what a conformance case converts to "is." (S3 recomputes head from the whole object,
  Postgres/Mongo from `max(position)` — adapter-blind, the suite asserts only the invariant.)
  This is the property forget relies on: overwrite can't be masked by a "current" projection,
  because the head does not move.

### Projections

- `loadProjection` of an unknown (stream, name) → `undefined`; after `saveProjection`, returns
  it (state + bookmark round-trip; `state` is arbitrary).
- `saveProjection` is an upsert (save, save again → second wins).
- `deleteProjections(stream)` removes **every** projection for that stream — and **only** that
  stream (see isolation case); events are untouched.

---

## Adversarial cases — the mean ones ("try to make the promise false")

Each is annotated with **what a weaker version would fail to catch.**

| Case                                    | The attack                                                                                       | A weaker version misses                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Concurrent append race**              | parallel appends at one `expectedHead` → _exactly one_ wins                                      | sequential-only misses a CAS that works serially but races                                                     |
| **Multi-event atomicity**               | a 3-event append that conflicts on the 2nd → assert **none** landed                              | single-event appends never catch a partial multi-event write                                                   |
| **Re-append (retry-safety)**            | append the same committed events twice → `VERSION_CONFLICT`, no dup                              | proves a landed-but-retried commit can't silently double                                                       |
| **Overwrite set-membership**            | overwrite `[P, P]` vs `[P, missing]`                                                             | a cardinality-only guard passes a duplicate faking the count (the Postgres `DISTINCT` concern)                 |
| **Append vs overwrite contention**      | append racing overwrite → assert convergent final state (both effects present after retries)     | see the **benign divergence** below — without this it's silent                                                 |
| **Hostile-key round-trip (event)**      | event payload with `$`-prefixed / dotted keys, unicode, deep nesting → assert returned **equal** | **the Mongo BSON-key attack** — most likely to find a _real_ divergence (BSON key rules vs JSON)               |
| **Hostile-key round-trip (projection)** | projection `state` with the SAME hostile keys → save, load, assert **equal**                     | the BSON-key risk hits HALF the data (arbitrary `state`) too — asserting it only on events leaves it unproven  |
| **Un-provisioned store → construct**    | point at a bare store, construct, assert the CAS now fires                                       | proves the enforcement _provisions_ the CAS; a non-enforcing adapter fails here — **but see the no-op caveat** |
| **`deleteProjections` isolation**       | bin stream A's projections; assert B's projections + all events untouched                        | an over-broad filter/prefix passes if only one stream exists                                                   |
| **Empty-stream edges**                  | head→`undefined`, read→`[]`, overwrite→`OVERWRITE_UNKNOWN_POSITION` on the empty stream          | three implementations quietly disagree on the never-written stream                                             |

### Benign divergence (recorded, ruled — not silent)

Under **append racing overwrite**, S3's whole-object etag-CAS will reject the append with
`VERSION_CONFLICT` _even though the head did not move_ (the overwrite changed the object's etag);
Postgres/Mongo (row/doc-level) will not — the append touches a different row/doc and succeeds.
**The outcome converges** (after reload-and-retry, both the appended event and the redaction are
present), because `VERSION_CONFLICT` _means_ "reload and retry," not "the head moved." The
divergence is therefore **benign**, but it is real and is **ruled benign here so it is visible,
not discovered on swap.** The suite asserts the convergent final state (adapter-blind); it does
**not** assert which adapter conflicts.

---

## Named limits — what this suite CANNOT prove (necessary, not sufficient)

A green suite is a floor, not a ceiling. On the record:

1. **No fault injection ⇒ no crash-atomicity.** The suite proves all-or-nothing for
   _deterministic_ rejections (conflict, contiguity, miss) and observable retry-safety. It does
   **not** prove atomicity under a mid-write backend crash, nor the presence of a
   landed-but-unacked append's events — those need killing the backend / dropping the connection
   mid-write, which the harness does not do. A consumer relying on crash-atomicity must verify
   per-backend.
2. **Race interleaving is not deterministically forced.** Append-vs-overwrite (and to a degree
   the concurrent-append race) can assert _convergence_, but single-threaded JS cannot force the
   exact interleaving that exposes the S3-conflicts-on-overwrite window; doing so needs
   multi-connection concurrency. Convergence is proven; the precise contended path is not.
3. **The double cannot catch a spec-misreading it shares with the suite.** It tests
   adapter-vs-reference, never reference-vs-reality. Only adversarial design (this section's
   reason for existing) catches a wrong reading encoded in both.
4. **The double cannot exhibit real-backend failure modes** (eventual consistency, partial
   writes, dropped connections). Double-green is the fast first filter, **never "conformance
   done."**
5. **Single-node Docker won't show distributed modes** (partitions, replica-set failover,
   replication lag). The real-service runs catch more than the double, not everything.
6. **The un-provisioned-store case is a no-op for two of four participants.** It is _vacuous_
   for S3 (native conditional PUT — nothing to provision) and for the double (no provisioning
   step); it runs meaningfully only against Postgres and Mongo. **This case does NOT run
   adapter-blind.** "All participants pass" must never be read as "all participants were
   tested" — a no-op pass is not a pass.

---

## Participants and runs

| Participant           | Run                                                                                                                                                                                                                                                          | Proves                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| In-memory double      | source-level, fast, no Docker/build                                                                                                                                                                                                                          | contract-logic signal + retroactive certification that the Phase B proofs rested on a (now-) conformant reference |
| Postgres / Mongo / S3 | **clean build** (`rm -rf dist` + rebuild from source; CI from clean checkout) against the **built, installed artifacts** the way a consumer resolves them, real services via Docker Compose (Mongo as a replica set — the ratified operational precondition) | the swappable promise against the actual installed thing                                                          |

Source-level real-adapter runs are forbidden: the original `dist/` smell was a cross-package
_built-artifact_ bug, and a source-level run sails straight past that class — it would certify
something narrower than the promise.
