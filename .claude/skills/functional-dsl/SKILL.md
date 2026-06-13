---
name: functional-dsl
description: >-
  How to build the FUNCTIONAL DOMAIN CORE in this repository — events, aggregates,
  projections, strippers, and the closure-based DSLs that define them. Use when writing or
  shaping the core library (Epic 3) or any in-memory domain mechanism: defining event
  topics/payloads, modelling a flow into atomic events, writing projection reducers, building
  a fluent builder/DSL, or splitting a DSL across files. Assumes the `coding-style`
  foundation; this is the Mode-A construction recipe. The exact core API is governed by
  FOUNDATION.md and ratified via DRAFT-AND-HALT.md — this skill is style, not contract.
---

# functional-dsl — building the domain core

This is **Mode A** from `coding-style` §5: the functional construction style for the domain
mechanism — the bowl, the facts, the folds. No classes, no `this`, no `new`. Closures over a
`state` object, pure derivations, fluent DSLs that read like a story.

> Scope note: FOUNDATION.md owns *what* the core is (events with strippers, the aggregate's
> committed/staged split, the pure projection builder, zero storage). The shapes here are
> *how we write it*, drafted and ratified at the Epic 3 gate. Don't treat the code sketches
> as the ratified API.

---

## The factory mechanic

A building block is a **lowercase, single-word factory** that captures `state` in a closure
and returns an operations object (a `dsl`). Mutating/chaining methods `return dsl`; a terminal
`build()` / `parse()` validates and yields the finished value.

```ts
const event = (topic: string, schema: SomeZodObject) => {
  const state = { topic, schema };                       // closed over, never exported
  const create = (payload: unknown) => {
    const data = { /* id, position, payload, ...defaults */ };
    const dsl = {
      get: { id: () => data.id, payload: () => data.payload },
      set: { id: (id: string) => (data.id = id) },       // internal mutation is fine here
      build: () => state.schema.parse(data),             // validate at the boundary
    };
    return dsl;
  };
  return { topic, create };                              // the definition is the outer return
};
```

Two layers recur: a **definition** (the outer factory return — topic/name + what's registered)
and an **instance** (what `create()`/`factory()` returns — live state + the `dsl`). Keep the
distinction; types derive from them (`ReturnType<typeof event>`, `ReturnType<…["create"]>`).

**Accessor convention:** reads under `get`, writes under `set`, each a tiny one-line accessor.
A method that changes state returns `dsl` so calls chain. The finished value only ever leaves
through `build()`/`parse()`.

---

## Modelling a flow into atomic events

One event = one fact (foundation §2). Build events by `.extend()`-ing a shared base schema
with a `literal` topic (defaulted) and a payload composed from **value-object schemas**.

```ts
// value objects — a small reusable vocabulary, one per file, default-exported
const EmailSchemaV1 = object({ address: string().email(), type: z.enum(["personal","work"]).default("personal") });

// events — atomic, topic mirrors filename & symbol (the three-way lockstep)
export const AccountEmailAddV1 = EventSchema.extend({
  action: literal("account.email.add.v1").default("account.email.add.v1"),
  payload: EmailSchemaV1,
});
export type AccountEmailAddV1Type = z.infer<typeof AccountEmailAddV1>;
```

- Compose payloads from value objects (`OwnerSchemaV1`, `PhoneSchemaV1`, …); extend them when
  an event needs an extra field (`EmailSchemaV1.extend({ primary: … })`). Don't re-declare.
- A flow (e.g. an onboarding) is *many* of these — `…create.v1`, `…owner.v1`, `…name.v1`,
  `…status.v1` — never one fat event. The topic hierarchy is the documentation.

---

## Aggregates — faithful containers

An aggregate is the **bowl**: it holds a stream for one id and nothing more. It enforces no
business rules and makes no judgements.

- **Definition** = a name + its registered event types (the events that are legal on it; this
  is where per-aggregate topic-uniqueness is checked).
- **Instance** = an id + the stream, maintaining the **committed/staged split** (durable
  history vs proposed-not-yet-committed). The split is load-bearing: it's how a consuming app
  previews "what would the state be?" without the core knowing what validation is.

```ts
const AccountAggregate = { name: "account", events: [AccountCreateV1, AccountEmailAddV1] };
```

---

## Projections — output schema + pure reducers

A projection is a **pure builder**: an output Zod schema (the read-model) plus reducers keyed
by topic, driven by a dumb runner.

```ts
export const AccountProjection = object({
  aggregate: object({ id: string(), position: number() }),
  emails: array(EmailSchemaV1),
});
export type AccountProjectionType = z.infer<typeof AccountProjection>;

// declarative { action, apply } — pure, immutable, one fact's effect each
const HandleEmailAddV1 = {
  action: "account.email.add.v1",
  apply: (current, event) => ({ ...current, emails: upsert(current.emails, event.payload) }),
};

const AccountProjector = { aggregate: AccountAggregate, handlers: [HandleEmailAddV1] };
```

Rules for reducers:
- **Pure and deterministic** (foundation §11): no clock, no random, no IO, no id-gen inside an
  `apply`. Read nondeterministic values back from the event; never generate them on replay.
- **Immutable** (foundation): spread to update; upsert by copy-then-replace-or-push; spread
  every nested level you touch.
- **Tolerate the unknown:** an unmapped topic returns `current` unchanged (still advancing the
  bookmark) — never throw. Topics accrue over time; a read-model that crashes on an unfamiliar
  fact is brittle. The only projection errors are a malformed mapper or a failed
  output-schema `parse()` on build.

The same taste appears in other declarative-object shapes — automation jobs
(`{ slug, trigger, execute }`), tasks (`(task, saga) => ({ output, ledger })`). Small named
functions in a plain object; the runner stays dumb.

---

## Strippers — the one sanctioned mutation

Right-to-forget lives at the event layer (only the event understands its payload). A stripper
is a **pure function** registered by name that returns a redacted payload. Applying it yields
**new event instances** preserving identity (id/position/topic/metadata) with the redacted
payload — never a mutation in place, never an appended marker. The pass/fail test: no PII
survives in the produced events. (Exact API: FOUNDATION.md + Epic 3 gate.)

---

## Staging — validate the whole batch, then emit

Producing events is a fluent, story-shaped flow: stage each fact, validate the *whole* batch,
then emit atomically. Half-writing is the disaster to prevent (foundation §7).

```ts
await aggregate.add(AccountCreateV1).message({});
await aggregate.add(AccountEmailAddV1).message({ address, type: "work" });
const { aggregateId } = await aggregate.emit();   // validates all, then commits as one
```

`add(Event)` returns a small chained `dsl` (`.by(creator)`, `.message(payload)`); each
`message()` parses its payload immediately so a bad one fails *before* anything is emitted.

---

## Splitting a DSL across files while keeping one top-level state

When a builder outgrows a file, split it **without scattering its state**:

- The **entry file owns the state** (and a shared `ctx`): it declares the single `state` object
  and is the composition root.
- Each **sub-file is a method-group factory** — `(state, ctx) => ({ …methods })` — closing over
  the passed-in state and returning just its slice (the `get` group, the `set` group, the
  `events` group).
- The entry **composes** them into one `dsl`:

```ts
// account.dsl.ts  (entry — owns state)
const dsl = { ...reads(state), ...writes(state), ...events(state, ctx) };

// account.dsl.reads.ts
export const reads = (state) => ({ get: { id: () => state.id } });
```

State lives once, in the composition root; every sub-file stays single-purpose and shares that
state by closure. No globals, no re-threading state through return values.

---

## A worked vertical slice

Each file tiny and single-purpose; the whole reads as one story.

```ts
// account.schemas/email.schema/email.schema.v1.ts
const EmailSchemaV1 = object({ address: string().email(), type: z.enum(["personal","work"]).default("personal") });
export default EmailSchemaV1;

// account.events/account.events.ts — atomic facts from value objects
export const AccountCreateV1   = EventSchema.extend({ action: literal("account.create.v1").default("account.create.v1"), payload: object({}) });
export const AccountEmailAddV1 = EventSchema.extend({ action: literal("account.email.add.v1").default("account.email.add.v1"), payload: EmailSchemaV1 });

// account.aggregates/account.aggregate.ts — a faithful container
const AccountAggregate = { name: "account", events: [AccountCreateV1, AccountEmailAddV1] };
export default AccountAggregate;

// account.projections/account.projection.ts — output schema + pure reducers + projector
export const AccountProjection = object({ aggregate: object({ id: string(), position: number() }), emails: array(EmailSchemaV1) });
const HandleEmailAddV1 = { action: "account.email.add.v1", apply: (c, e) => ({ ...c, emails: upsert(c.emails, e.payload) }) };
const AccountProjector = { aggregate: AccountAggregate, handlers: [HandleEmailAddV1] };
export default AccountProjector;

// account.services/account.service.v1.ts — curried DI, named ops, story-shaped (imperative shell)
const AccountService = (region: string) => {
  const addEmail = async (id: string, email: unknown) => {
    logger.system.debug(`adding email to ${id}`);
    // resolve aggregate → stage facts → emit (validates batch) → project
    logger.system.debug(`✓ added email to ${id}`);
  };
  return { addEmail };
};
export default AccountService;
```

A hook/route reads top-to-bottom: parse input → resolve deps → stage facts → emit → project →
respond, wrapped once in `try/catch` returning a clean error shape. Pure folds in the centre;
IO only at the edge (foundation §10).
