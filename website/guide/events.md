# Events

An event is a **topic** + one or more **versioned payload schemas** (Zod). Definitions are standalone — built on their own, registered onto aggregates later, reusable across many. This page assumes the [event sourcing mental model](/concepts).

## Define an event

```ts
import { event } from "@hilaryosborne/sourcing";
import { object, string, number } from "zod";

export const AccountOpenedV1 = event("account.opened.v1").version(object({ holder: string().min(1) }));
export const AccountDepositedV1 = event("account.deposited.v1").version(object({ amount: number().int().positive() }));
```

- `event(topic).version(schema)` returns the event definition; `P` is inferred from the schema, so payloads are fully typed everywhere downstream. A single `.version()` is the common case — you only think about upcasters when a shape actually changes.
- **The topic is an opaque string; the version chain belongs to the library.** Pick a stable topic. Evolving a payload is a new `.version()` + `.upcast()` (below) — old events are lifted to the latest shape at read, not branched across parallel topics. (You can still suffix `.vN` in the topic if you like; the library treats the whole string as opaque.)
- Put each definition where it's reusable (often a `events/` module). The same definition can be `register`ed on multiple aggregates — topic uniqueness is per-aggregate, not global.

## Create an instance (the fluent builder)

```ts
const opened = AccountOpenedV1.create({ holder: "Ada" }) // validates the payload NOW (fail fast) — throws EventErrors.PAYLOAD_INVALID
  .creator("user", "ada") // REQUIRED: provenance { entity, uid }. No default.
  .headers({ source: "import" }); // OPTIONAL decoration, defaults to {}
```

- `create(payload)` mints `id` (a nanoid) and `created` (timestamp) **eagerly**, and validates the payload immediately.
- `creator(entity, uid)` is **required before the event can be staged** — a permanent fact with bogus provenance is worse than one that refuses to exist. Forgetting it surfaces later as `AggregateErrors.MISSING_CREATOR` when you `add()` it.
- `position` and the aggregate reference are **not** set here — they're stamped when the aggregate stages the event (see [aggregates](/guide/aggregates)). A freshly-created event has no position yet.

Read an instance through its `get` accessors: `opened.get.id()`, `.get.topic()`, `.get.payload()` (always the **latest** shape — upcast on read), `.get.version()` (the stored ordinal), `.get.creator()`, `.get.headers()`, `.get.created()`, and (once staged) `.get.position()`, `.get.aggregate()`.

## Versions & upcasters — evolving a payload

When a payload shape changes, add a `.version()` and an `.upcast()` that lifts the previous version's payload into the new one. The **first** version has no upcast (nothing precedes it); **every later** version must declare one — the type-state builder enforces both at compile time.

```ts
export const AccountOpened = event("account.opened")
  .version(object({ holder: string().min(1) }))
  .version(object({ holder: object({ name: string().min(1) }), country: string().min(1) }))
  .upcast((v1) => ({ holder: { name: v1.holder }, country: "unknown" }));
```

- **New events are born at the latest version.** `AccountOpened.create(...)` takes the head shape.
- **Stored events are never rewritten.** Each records the ordinal it was written at; at read time the library walks it forward through your upcasters, so projections and aggregates only ever see the **latest** shape (`build()` still returns the faithful stored form for persistence).
- **The compiler is the safeguard.** Add a version whose shape differs and the `.upcast` won't compile until you write it — and every projection mapper reading the changed shape fails to compile until you fix it. (`EventErrors.UPCAST_INVALID` is the runtime backstop if an upcaster returns a shape that fails the next schema.)
- **Mechanism, not judgment.** The library understands nothing about what a version _means_; it applies the ordered chain of pure functions you declared, by index. No migration engine, no version field to parse, nothing rewritten on disk.

## Strippers — right-to-forget, declared next to the event

Only the event understands its payload, so redactions live with the definition. A stripper is a **pure** function: payload in, redacted payload out.

```ts
AccountOpenedV1.strip("gdpr", (payload) => ({ ...payload, holder: "[redacted]" }));
AccountOpenedV1.strip("export-redaction", (payload) => ({ ...payload, holder: payload.holder[0] + "***" }));
```

- `strip(context, fn)` registers a **named** stripper so you can have several contexts (`"gdpr"`, `"support-view"`, …). It returns the definition, so it chains.
- **Strippers are per version.** Register them on the version whose shape they redact (chain `.strip(...)` after each `.version()`); right-to-forget applies the one matching each event's stored version, redacting in that version's own vocabulary.
- The aggregate's `strip(context)` later walks events and applies the matching stripper to each (see [aggregates](/guide/aggregates) / right-to-forget). Events with no matching stripper pass through untouched.

::: warning
The test of a correct stripper: no PII survives the produced payload. Return a new object; never mutate the input. A stripper's output is re-validated against its own version's schema — redact to a schema-valid sentinel (e.g. `"[redacted]"`), not a value the schema forbids, or it throws `EventErrors.STRIP_INVALID`. Registering two strippers under one context name on one version throws `EventErrors.STRIPPER_DUPLICATE`.
:::

## Errors events raise (all mechanical)

| Error                            | When                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `EventErrors.PAYLOAD_INVALID`    | `create(payload)` got a payload that fails the head schema. Fail-fast, at creation. |
| `EventErrors.STRIPPER_DUPLICATE` | Two strippers registered under the same context name on one version.                |
| `EventErrors.STRIP_INVALID`      | A stripper's output failed its own version's schema (redact to a valid sentinel).   |
| `EventErrors.UPCAST_INVALID`     | An upcaster returned a payload that fails the next version's schema, on read.       |
| `EventErrors.VERSION_UNKNOWN`    | A stored event's version ordinal isn't declared on the definition's chain.          |

Import the enum to switch on faults: `import { EventErrors } from "@hilaryosborne/sourcing"`.

## Gotchas

- **Don't defer `creator`.** Add it at construction; it's required and there is no default.
- **Don't read `position` before staging** — it's `undefined` until an aggregate stamps it, and provisional (it evaporates if you discard the staged event) until commit.
- **Evolve with `.version()`, not parallel topics.** To change a payload shape, add a version + upcast so old events lift to the latest shape automatically — don't register two topics and branch every projection on which one fired.
- **Re-exported `nanoid`.** Core re-exports `nanoid` (`import { nanoid } from "@hilaryosborne/sourcing"`) as a convenience if you mint your own payload uids.

## Related

- [Aggregates](/guide/aggregates) — staging events, positions, and right-to-forget
- [Projections](/guide/projections) — folding events into read models
- [Storage adapters](/guide/storage-adapters) — persisting committed events
