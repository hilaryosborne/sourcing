# Events

An event is a **topic** (opaque unique string) + a **payload schema** (Zod). Definitions are standalone — built on their own, registered onto aggregates later, reusable across many. This page assumes the [event sourcing mental model](/concepts).

## Define an event

```ts
import { event } from "@hilaryosborne/sourcing";
import { object, string, number } from "zod";

export const AccountOpenedV1 = event("account.opened.v1", object({ holder: string().min(1) }));
export const AccountDepositedV1 = event("account.deposited.v1", object({ amount: number().int().positive() }));
```

- `event<P>(topic: string, schema: ZodType<P>): EventDefinition<P>` — `P` is inferred from the schema, so payloads are fully typed everywhere downstream.
- **The topic is opaque and versioned-by-convention.** Pick `name.verb.vN`. A breaking payload change = a new topic (`...v2`); the library will never relate them, upcast, or migrate. That is your call to make in the string.
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

Read an instance through its `get` accessors: `opened.get.id()`, `.get.topic()`, `.get.payload()`, `.get.creator()`, `.get.headers()`, `.get.created()`, and (once staged) `.get.position()`, `.get.aggregate()`.

## Strippers — right-to-forget, declared next to the event

Only the event understands its payload, so redactions live with the definition. A stripper is a **pure** function: payload in, redacted payload out.

```ts
AccountOpenedV1.strip("gdpr", (payload) => ({ ...payload, holder: "[redacted]" }));
AccountOpenedV1.strip("export-redaction", (payload) => ({ ...payload, holder: payload.holder[0] + "***" }));
```

- `strip(context, fn)` registers a **named** stripper so you can have several contexts (`"gdpr"`, `"support-view"`, …). It returns the definition, so it chains.
- The aggregate's `strip(context)` later walks events and applies the matching stripper to each (see [aggregates](/guide/aggregates) / right-to-forget). Events with no matching stripper pass through untouched.

::: warning
The test of a correct stripper: no PII survives the produced payload. Return a new object; never mutate the input. Registering two strippers under one context name throws `EventErrors.STRIPPER_DUPLICATE`.
:::

## Errors events raise (all mechanical)

| Error                            | When                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `EventErrors.PAYLOAD_INVALID`    | `create(payload)` got a payload that fails the schema. Fail-fast, at creation. |
| `EventErrors.STRIPPER_DUPLICATE` | Two strippers registered under the same context name on one definition.        |

Import the enum to switch on faults: `import { EventErrors } from "@hilaryosborne/sourcing"`.

## Gotchas

- **Don't defer `creator`.** Add it at construction; it's required and there is no default.
- **Don't read `position` before staging** — it's `undefined` until an aggregate stamps it, and provisional (it evaporates if you discard the staged event) until commit.
- **Don't encode version relationships in code.** `account.opened.v1` and `...v2` are unrelated strings to the library. If you need both understood, register both and handle both.
- **Re-exported `nanoid`.** Core re-exports `nanoid` (`import { nanoid } from "@hilaryosborne/sourcing"`) as a convenience if you mint your own payload uids.

## Related

- [Aggregates](/guide/aggregates) — staging events, positions, and right-to-forget
- [Projections](/guide/projections) — folding events into read models
- [Storage adapters](/guide/storage-adapters) — persisting committed events
