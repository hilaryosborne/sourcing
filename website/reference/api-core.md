# 📘 API reference: core

Everything exported from `@hilaryosborne/sourcing` — the three builders, the instances they produce, and the value types. This is the precise surface; for the shapes it reads and writes see the [data model reference](/reference/data-models), and for what it throws see the [error index](/reference/error-index).

```ts
import {
  event,
  aggregate,
  projection, // the three builders
  nanoid, // re-exported id minter
} from "@hilaryosborne/sourcing";
```

---

## `event(topic)`

```ts
const event: (topic: string) => EventDefinition;
```

Creates an **event definition** — a named family of versioned payload shapes. Capture it in a `const` and declare versions on it; the definition is the handle you create and restore events from.

### `EventDefinition`

| Member                | Signature                                                 | Description                                                                                                                                                                                                                                                                      |
| --------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `topic`               | `string`                                                  | The event's name, as passed to `event()`.                                                                                                                                                                                                                                        |
| `.version(n, schema)` | `(n: number, schema: ZodType) => VersionBuilder<Payload>` | Declares version `n` (1-based, contiguous) with its payload schema. The returned builder carries `.upcast`/`.strip` and is usually discarded — registration is the side effect. Throws [`VERSION_SEQUENCE`](/reference/error-index#core-eventerrors) if `n` breaks the sequence. |
| `.create(payload)`    | `(payload: unknown) => EventInstance`                     | Mints a new event at the **head** version. Validates `payload` against the head schema ([`PAYLOAD_INVALID`](/reference/error-index#core-eventerrors)) and stamps `id` + `created`.                                                                                               |
| `.restore(envelope)`  | `(envelope: EventEnvelopeV1Type) => EventInstance`        | Rehydrates a stored event at its stored `version`, re-validating its payload. Reads see the payload upcast to head. Throws [`VERSION_UNKNOWN`](/reference/error-index#core-eventerrors) if the stored ordinal isn't declared.                                                    |

```ts
const AccountOpened = event("account.opened");
AccountOpened.version(1, object({ holder: string() }));

const opened = AccountOpened.create({ holder: "Ada" }).creator("user", "ada");
```

### `VersionBuilder<Cur>`

Returned by `.version(n, schema)`; scoped to that one version.

| Member                | Signature                                                             | Description                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.upcast(fn)`         | `(fn: (previous: unknown) => Cur) => VersionBuilder<Cur>`             | Lifts the previous version's payload into this one. Input is `unknown` (narrow it yourself); the return is checked against this version's schema. Mandatory on every version ≥ 2, forbidden on version 1. Throws [`UPCAST_ON_FIRST_VERSION`](/reference/error-index#core-eventerrors); lazily throws [`UPCAST_MISSING`](/reference/error-index#core-eventerrors) / [`UPCAST_INVALID`](/reference/error-index#core-eventerrors). |
| `.strip(context, fn)` | `(context: string, fn: (payload: Cur) => Cur) => VersionBuilder<Cur>` | Registers a named, version-local redactor for right-to-forget. Output is re-validated against this version's schema ([`STRIP_INVALID`](/reference/error-index#core-eventerrors)). Throws [`STRIPPER_DUPLICATE`](/reference/error-index#core-eventerrors) if `context` is registered twice.                                                                                                                                      |

```ts
AccountOpened.version(2, object({ holder: object({ name: string() }) }))
  .upcast((prev) => ({ holder: { name: (prev as { holder: string }).holder } }))
  .strip("gdpr", (p) => ({ holder: { name: "[redacted]" } }));
```

### `EventInstance<P>`

A single event in flight. Fluent setters return the instance; the `get` accessors read it.

| Member                                  | Signature                                                | Description                                                                   |
| --------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `.creator(entity, uid)`                 | `(entity: string, uid: string) => EventInstance<P>`      | Sets required provenance. Must be called before staging.                      |
| `.headers(headers)`                     | `(headers: Record<string, unknown>) => EventInstance<P>` | Sets optional, opaque metadata.                                               |
| `.get.id()` / `.topic()` / `.created()` | `() => string`                                           | Intrinsic fields.                                                             |
| `.get.payload()`                        | `() => P`                                                | The payload **upcast to head** — the consumer view.                           |
| `.get.version()`                        | `() => number`                                           | The stored version ordinal.                                                   |
| `.get.position()`                       | `() => number \| undefined`                              | Stream index; `undefined` until staged.                                       |
| `.get.aggregate()`                      | `() => AggregateRefV1Type \| undefined`                  | Stream reference; set at staging.                                             |
| `.get.creator()` / `.get.headers()`     | —                                                        | Provenance and metadata.                                                      |
| `.build()`                              | `() => EventEnvelopeV1Type`                              | The **stored** envelope — payload as written, never upcast. What you persist. |
| `.consume()`                            | `() => EventEnvelopeV1Type`                              | The **head** envelope — payload upcast. What projections fold.                |
| `.strip(context)`                       | `(context: string) => EventInstance<P>`                  | A new instance with the stored payload redacted at its version.               |
| `.stage(ref, position)`                 | —                                                        | Called by the aggregate when staging; you won't call this directly.           |

---

## `aggregate(name)`

```ts
const aggregate: (name: string) => AggregateDefinition;
```

Creates an **aggregate definition** — a named stream type and the set of events legal on it. It enforces no business rules; it is a faithful container.

### `AggregateDefinition`

| Member                  | Signature                                              | Description                                                                                                                                          |
| ----------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                  | `string`                                               | The definition's name.                                                                                                                               |
| `events`                | `RegisteredEvent[]`                                    | The registered event types.                                                                                                                          |
| `.register(definition)` | `(definition: EventDefinition) => AggregateDefinition` | Registers an event as legal on this stream (chainable). Throws [`TOPIC_DUPLICATE`](/reference/error-index#core-aggregateerrors) on a repeated topic. |
| `.instance(id?)`        | `(id?: string) => AggregateInstance`                   | Mints a stream instance. Omit `id` and core mints a `nanoid`; pass one to use it as-is.                                                              |
| `.topic(topic)`         | `(topic: string) => RegisteredEvent \| undefined`      | Looks up a registered event by topic.                                                                                                                |

```ts
const Account = aggregate("account").register(AccountOpened).register(Deposited);
const instance = Account.instance(); // id minted by core
```

### `AggregateInstance`

| Member            | Signature                                | Description                                                                                              |
| ----------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `id`              | `string`                                 | The stream's id.                                                                                         |
| `name`            | `string`                                 | The definition's name.                                                                                   |
| `position`        | `number \| undefined`                    | Highest index across committed + staged, or `undefined` when empty.                                      |
| `events`          | `AggregateEvents`                        | The staging namespace (below).                                                                           |
| `.strip(context)` | `(context: string) => AggregateInstance` | A **new** aggregate with every event redacted by the named stripper. Pure; identity preserved per event. |

### `AggregateEvents` — `instance.events`

| Member               | Signature                                              | Description                                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `committed`          | `EventInstance[]`                                      | Durable history (a copy).                                                                                                                                                                                                |
| `staged`             | `EventInstance[]`                                      | Proposed, not-yet-committed events (a copy).                                                                                                                                                                             |
| `.add(event)`        | `<P>(event: EventInstance<P>) => EventInstance<P>`     | Stages an event: stamps its `position` and `aggregate`, pushes it to `staged`. Throws [`TOPIC_UNKNOWN`](/reference/error-index#core-aggregateerrors) / [`MISSING_CREATOR`](/reference/error-index#core-aggregateerrors). |
| `.import(envelopes)` | `(events: EventEnvelopeV1Type[]) => AggregateInstance` | Loads durable history into `committed`. Throws [`TOPIC_UNKNOWN`](/reference/error-index#core-aggregateerrors) / [`EVENT_INVALID`](/reference/error-index#core-aggregateerrors).                                          |
| `.export()`          | `() => EventEnvelopeV1Type[]`                          | Committed ++ staged as stored envelopes, in position order.                                                                                                                                                              |
| `.commit()`          | `() => AggregateInstance`                              | In-memory bookkeeping: folds `staged` into `committed`. **Does not persist** — that's the repository's job.                                                                                                              |

---

## `projection(name, schema)`

```ts
const projection: <State>(name: string, schema: ZodType<State>) => ProjectionDefinition<State>;
```

Creates a **projection** — a pure fold from a stream into a read model of shape `State`. The `name` is its identity in the projection store; the `schema` is validated on every build.

### `ProjectionDefinition<State>`

| Member                     | Signature                                                                                                  | Description                                                                                                                                                                                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name` / `schema`          | `string` / `ZodType<State>`                                                                                | Identity and output shape.                                                                                                                                                                                                                                                                            |
| `.aggregate(definition)`   | `(definition: AggregateDefinition) => ProjectionDefinition<State>`                                         | Binds the aggregate this projection reads (chainable).                                                                                                                                                                                                                                                |
| `.handle(event, mapper)`   | `<P = unknown>(event: EventDefinition, mapper: ProjectionMapper<State, P>) => ProjectionDefinition<State>` | Registers a typed mapper for one event. Narrow `P` by supplying the payload type. Throws [`MAPPER_INVALID`](/reference/error-index#core-projectionerrors) / [`TOPIC_DUPLICATE`](/reference/error-index#core-projectionerrors) / [`EVENT_UNREGISTERED`](/reference/error-index#core-projectionerrors). |
| `.build(aggregate, from?)` | `(aggregate: AggregateInstance, from?: State) => State`                                                    | Folds committed + staged events through the handlers. Omit `from` for a full build; pass `from` to resume from a saved state (delta fold). Validates the result ([`OUTPUT_INVALID`](/reference/error-index#core-projectionerrors)).                                                                   |

```ts
const Balance = projection("balance", object({ holder: string(), balance: number() }))
  .aggregate(Account)
  .handle<{ holder: string }>(AccountOpened, (s, e) => ({ ...s, holder: e.payload.holder, balance: 0 }))
  .handle<{ amount: number }>(Deposited, (s, e) => ({ ...s, balance: s.balance + e.payload.amount }));

Balance.build(instance); // → { holder: "Ada", balance: 100 }
```

### Supporting types

| Type                         | Definition                                              | Notes                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProjectionMapper<State, P>` | `(current: State, event: TypedEvent<P>) => State`       | Pure and deterministic — no clock, randomness, or IO. Spread to update; never mutate `current`. The first folded event must establish the complete `State`. |
| `TypedEvent<P>`              | `Omit<EventEnvelopeV1Type, "payload"> & { payload: P }` | The stored envelope with `payload` narrowed to this handler's type.                                                                                         |

::: warning The first-event contract
Handlers are typed `(current: State, event) => State` — the signature _promises_ a complete `current`, not a `Partial`. You keep that promise by seeding the full shape in your creating event's handler. Break it and you get an [`OUTPUT_INVALID`](/reference/error-index#core-projectionerrors) the types said couldn't happen. ([Projections guide →](/guide/projections))
:::

---

## Re-exports & value types

| Export                                                                                                                                                                                                                       | Description                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `nanoid`                                                                                                                                                                                                                     | The id minter core uses, re-exported for convenience.                                        |
| `EventEnvelopeV1`, `CreatorSchemaV1`, `AggregateRefV1` (+ `…Type`)                                                                                                                                                           | The Zod schemas and inferred types — see the [data model reference](/reference/data-models). |
| `EventErrors`, `AggregateErrors`, `ProjectionErrors`                                                                                                                                                                         | The error enums — see the [error index](/reference/error-index).                             |
| `EventDefinition`, `VersionBuilder`, `VersionEntry`, `Stripper`, `EventInstance`, `AggregateDefinition`, `AggregateInstance`, `AggregateEvents`, `RegisteredEvent`, `ProjectionDefinition`, `ProjectionMapper`, `TypedEvent` | The interface/type exports documented above.                                                 |

## ➡️ Next

- [API: persistence](/reference/api-persistence) — the repository, storage port, and observer.
- [Data model reference](/reference/data-models) · [Error index](/reference/error-index)
- Guides: [Events](/guide/events) · [Aggregates](/guide/aggregates) · [Projections](/guide/projections)
