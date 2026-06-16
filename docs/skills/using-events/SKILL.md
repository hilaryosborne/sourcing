---
name: using-events
description: >-
  How to DEFINE and USE events with the published @hilaryosborne/sourcing core — the
  `event(topic)` definition + `.version(n, schema)` builder, versions + upcasters for
  read-time evolution, the fluent instance builder (create/creator/headers), per-version
  strippers for right-to-forget,
  and the mechanical errors events raise. Use when a consumer is modelling a domain into
  events, choosing topics, evolving a payload shape, attaching provenance, registering
  redactions, or debugging a payload/stripper/upcast error. Assumes the sourcing-concepts
  mental model. Companions: using-aggregates, using-projections.
---

# Using events

An event is a **topic** + one or more **versioned payload schemas** (Zod). Definitions are standalone — built on their own, registered onto aggregates later, reusable across many.

## Define an event

```ts
import { event } from "@hilaryosborne/sourcing";
import { object, string, number } from "zod";

export const AccountOpenedV1 = event("account.opened.v1");
AccountOpenedV1.version(1, object({ holder: string().min(1) }));
export const AccountDepositedV1 = event("account.deposited.v1");
AccountDepositedV1.version(1, object({ amount: number().int().positive() }));
```

- `event(topic)` returns the **definition** (it carries `create`/`restore`/`version`); capture it in a `const`. `.version(n, schema)` declares a version **on** it — `n` is an explicit, 1-based, contiguous number that IS the persisted ordinal, and the call returns a per-version builder (for `.upcast`/`.strip`) whose return you usually discard. A single `.version(1, …)` is the common case — upcasters only matter once a shape changes.
- **Payloads are NOT typed downstream** — the definition handle isn't parameterized by payload, so `create`, `get.payload()`, and projection/read-model handlers see `unknown`. Payloads are validated at runtime against the schema; type a handler by annotating it (`handle<P>(…)`). This is the deliberate cost of the per-statement DSL.
- **The topic is an opaque string; the version chain belongs to the library.** Pick a stable topic. Evolving a payload is another `.version(n, …)` + `.upcast()` (below) — old events lift to the latest shape at read, not branched across parallel topics. (You can still suffix `.vN` in the topic; the library treats the whole string as opaque.)
- Put each definition where it's reusable (often a `events/` module). The same definition can be `register`ed on multiple aggregates — topic uniqueness is per-aggregate, not global.

## Create an instance (the fluent builder)

```ts
const opened = AccountOpenedV1.create({ holder: "Ada" }) // validates the payload NOW (fail fast) — throws EventErrors.PAYLOAD_INVALID
  .creator("user", "ada") // REQUIRED: provenance { entity, uid }. No default.
  .headers({ source: "import" }); // OPTIONAL decoration, defaults to {}
```

- `create(payload)` mints `id` (a nanoid) and `created` (timestamp) **eagerly**, and validates the payload immediately.
- `creator(entity, uid)` is **required before the event can be staged** — a permanent fact with bogus provenance is worse than one that refuses to exist. Forgetting it surfaces later as `AggregateErrors.MISSING_CREATOR` when you `add()` it.
- `position` and the aggregate reference are **not** set here — they're stamped when the aggregate stages the event (see using-aggregates). A freshly-created event has no position yet.

Read an instance through its `get` accessors: `opened.get.id()`, `.get.topic()`, `.get.payload()` (always the **latest** shape — upcast on read, typed `unknown`), `.get.version()` (the stored 1-based ordinal), `.get.creator()`, `.get.headers()`, `.get.created()`, and (once staged) `.get.position()`, `.get.aggregate()`.

## Versions & upcasters — evolving a payload

When a payload shape changes, declare another `.version(n, …)` on the definition and an `.upcast()` that lifts the previous version's payload into the new one. The **first** version has no upcast (nothing precedes it); **every later** version must declare one — both are runtime mechanical faults (not compile-time).

```ts
export const AccountOpened = event("account.opened");
// version 1 — the original shape
AccountOpened.version(1, object({ holder: string().min(1) }));
// version 2 — a richer shape + the upcaster that lifts v1 into it
AccountOpened.version(2, object({ holder: object({ name: string().min(1) }), country: string().min(1) })).upcast(
  (prev) => {
    const v1 = prev as { holder: string };
    return { holder: { name: v1.holder }, country: "unknown" };
  },
);
```

- **New events are born at the latest version**; `create(...)` takes the head shape (typed `unknown`, runtime-validated).
- **Stored events are never rewritten.** Each records the 1-based ordinal it was written at; at read time the library walks it forward through your upcasters, so projections and aggregates only ever see the **latest** shape (`build()` still returns the faithful stored form for persistence).
- **The upcaster's input is `unknown`** — the handle can't thread the previous version's type — so narrow it (`prev as …`) against the schema you're lifting from; its **return** is checked against the new version's schema. `EventErrors.UPCAST_INVALID` is the read-time backstop.
- **The version rules are runtime mechanical faults:** `.upcast` on the first version → `UPCAST_ON_FIRST_VERSION`; a later version left without one → `UPCAST_MISSING` (at first use); a number that breaks the `1, 2, 3, …` sequence → `VERSION_SEQUENCE`.
- **Mechanism, not judgment.** The library applies your ordered chain of pure functions by declared number; it never interprets what a version _means_. No migration engine, nothing rewritten on disk — the only new stored field is the opaque ordinal, which the library counts but never parses for meaning.

## Strippers — right-to-forget, declared next to the event

Only the event understands its payload, so redactions live with the version. A stripper is a **pure** function: payload in, redacted payload out — registered on the **version builder** that `.version()` returns (chainable, including after `.upcast`).

```ts
AccountOpenedV1.version(1, object({ holder: string().min(1) }))
  .strip("gdpr", (payload) => ({ ...payload, holder: "[redacted]" }))
  .strip("export-redaction", (payload) => ({ ...payload, holder: payload.holder[0] + "***" }));
```

- `strip(context, fn)` registers a **named** stripper so you can have several contexts (`"gdpr"`, `"support-view"`, …). It returns the version builder, so it chains. Unlike the payload, the stripper's input/output ARE typed to that version's schema.
- **Strippers are per version.** Register them on the version whose shape they redact (via that `.version()` builder); right-to-forget applies the one matching each event's stored version, redacting in that version's own vocabulary.
- The aggregate's `strip(context)` later walks events and applies the matching stripper to each (see using-aggregates / right-to-forget). Events with no matching stripper pass through untouched.
- **The test of a correct stripper: no PII survives the produced payload.** Return a new object; never mutate the input. The output is re-validated against its version's schema — redact to a schema-valid sentinel, or it throws `EventErrors.STRIP_INVALID`. Two strippers under one context name on one version throws `EventErrors.STRIPPER_DUPLICATE`.

## Errors events raise (all mechanical)

| Error                                 | When                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| `EventErrors.PAYLOAD_INVALID`         | `create(payload)` got a payload that fails the head schema. Fail-fast, at creation.   |
| `EventErrors.STRIPPER_DUPLICATE`      | Two strippers registered under the same context name on one version.                  |
| `EventErrors.STRIP_INVALID`           | A stripper's output failed its own version's schema (redact to a valid sentinel).     |
| `EventErrors.UPCAST_INVALID`          | An upcaster returned a payload that fails the next version's schema, on read.         |
| `EventErrors.VERSION_UNKNOWN`         | A stored event's version ordinal isn't declared on the definition's chain.            |
| `EventErrors.VERSION_SEQUENCE`        | A `.version(n, …)` number broke the contiguous-from-1 sequence (wrong start/gap/dup). |
| `EventErrors.UPCAST_ON_FIRST_VERSION` | `.upcast` declared on the first version (nothing precedes it).                        |
| `EventErrors.UPCAST_MISSING`          | A later version left without its mandatory upcast; raised at first use.               |

Import the enum to switch on faults: `import { EventErrors } from "@hilaryosborne/sourcing"`.

## Gotchas

- **Don't defer `creator`.** Add it at construction; it's required and there is no default.
- **Don't read `position` before staging** — it's `undefined` until an aggregate stamps it, and provisional (it evaporates if you discard the staged event) until commit.
- **Evolve with `.version()`, not parallel topics.** To change a payload shape, add a version + upcast so old events lift to the latest shape automatically — don't register two topics and branch every projection on which one fired.
- **Re-exported `nanoid`.** Core re-exports `nanoid` (`import { nanoid } from "@hilaryosborne/sourcing"`) as a convenience if you mint your own payload uids.
