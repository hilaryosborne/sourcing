---
name: coding-style
description: >-
  The always-on coding foundation for this repository — the cross-cutting taste, thinking,
  naming, and conventions that apply to EVERY .ts file (library, scaffold, tests, examples,
  scripts). Use whenever you create or edit TypeScript, name a file or symbol, shape a
  module, choose a construction style, write a Zod schema, handle errors, or add logging.
  Three companion skills go deeper per context: functional-dsl (the domain core),
  interface-adapters (swappable adapters / SDK surface), testing (create/test/prove). Match
  this; do not drift; do not gold-plate beyond it.
---

# Coding style — the foundation

This is the **always-on foundation**: the cross-cutting taste and thinking for every `.ts`
file here. Three companion skills go deeper where the work is mode-specific — load them
alongside this one:

- **`functional-dsl`** — the domain mechanism: events, aggregates, projections, the
  closure-based DSLs. This is the *core* (Epic 3).
- **`interface-adapters`** — swappable adapters behind a published contract: the persistence
  layer + storage adapters (Epic 4), and any SDK extension point.
- **`testing`** — the create / test / prove approach.

If you remember one line: **the smallest honest solution that reads like a story.** Small
files, one job each. Derive, don't duplicate. Trust Zod and TypeScript instead of
hand-checking them. Comment the *why*. Condense. Reach for the right tool — functional
closures for the domain core, interfaces and classes for swappable adapters — and when
unsure, the more restrained option is almost always right here.

---

# Part I — How to think here

These are the load-bearing ideas. The conventions in Part II are downstream of them.

## 1. Events are the only truth; everything else is derived

State is not stored and mutated — it is **folded out of a stream of past facts**. An
aggregate holds events. A projection is `events.reduce(apply, base)`. A read-model is
disposable: throw it away and rebuild it from the events at any time.

- You never "update a record." You **append a fact** and re-derive.
- Projections hold no independent truth, so they are cheap to delete and rebuild.
- The events are sacred and (almost) immutable; the derived stuff is throwaway.

## 2. Decompose to atomic facts

Model each state change as **the smallest meaningful fact** — one event, one concept,
usually one field. A flow is many tiny events, not one fat "update."

```ts
// YES — atomic facts, each a single past-tense truth
account.email.add.v1            // { email, type }
account.email.verify.v1         // { email }
account.email.primary.set.v1    // { email }

// NO — a coarse, lossy "update" event
account.update.v1               // { email?, name?, status?, ... }
```

Atomic events make projections trivial and history meaningful, and let you add a new fact
type without touching the old ones. When you catch yourself adding an optional field to an
event payload, ask whether it's really a second fact. (The modelling recipe is in
`functional-dsl`.)

## 3. Derive, don't duplicate

If a value can be computed, compute it — don't maintain a copy.

- **Types come from values.** Infer from Zod (`z.infer<typeof X>`) and from functions
  (`ReturnType<typeof f>`). Hand-authoring an interface that restates a schema you already
  wrote is duplication that will drift.
- **Read-models come from events.** Don't cache what a `reduce` can reproduce.

## 4. Trust your tools — validate at the boundary, then let go

Zod validates data; TypeScript proves types. **Do not hand-roll runtime checks for things
the compiler or a `parse()` already guarantees.** Defensive `typeof x !== "string"` ladders
on an argument TypeScript already typed are noise, and a tell that the code doesn't trust
its own contracts.

- `parse()` at the edges — on create, on import, on the produced read-model. Inside the
  walls, trust the parsed shape.
- Let Zod's error bubble to a caller who can act on it; don't swallow-and-rewrap every call.
  Wrap a *story* once at its boundary, not every line within it.

## 5. Right tool for the job — two modes

This codebase has **two construction modes**, and choosing correctly is itself a skill:

- **Functional mode — the default for domain mechanism.** A unit of behaviour is a function
  that closes over a `state` object and returns operations; dependencies are injected by
  currying — `(deps) => (args) => …`. No `this`, no `new`. Events, aggregates, projections,
  services, hooks, tasks are built this way. → `functional-dsl`.
- **Interface mode — for swappable adapters behind a published contract.** When a consumer
  must implement or swap an implementation — a storage adapter, a cache, a logger, a
  provider — reach for the classic `interface` + base class + concrete `implements`, with
  constructor dependency injection and batteries-included defaults. → `interface-adapters`.

Neither is "more correct." Functional-by-default keeps the core small and pure; interfaces
earn their classes exactly when there is a contract to vary behind. The test is **"is this a
swappable contract?"** — not "are classes allowed?"

**Ownership decides it — not "is it IO?"** Internal persistence you own and wire yourself —
repositories, db clients, region-scoped stores — stays *functional* (a region-curried closure
returning named operations). Classes are for a contract a **consumer** must supply or swap behind
your published interface. Persistence is not automatically "class mode": our storage *adapters*
are swappable (interface mode), but the repository/registry that wires them is functional.

```ts
const accountService = (region: string) => {          // functional mode: curried DI
  const op = async (id: string) => { /* ... */ };
  return { op };
};
```

A service/hook/publisher in functional mode pulls in its helpers and exposes a *small,
named* set of operations — never a grab-bag, never a god-object.

## 6. Fewer responsibilities is the testability strategy

There is no other one. The moment a function earns a second job, split it. Small units are
independently testable and independently understandable. A file that does two things is two
files. This is the rule you will lean on most.

## 7. Validate the whole batch, then commit (staging)

When producing multiple events, **stage them all and validate them all before anything is
committed.** Half-writing — some events land, one fails validation mid-write — is the
disaster this prevents. Stage → validate everything → emit atomically. (Mechanics in
`functional-dsl`.)

## 8. Simplicity is a feature; resist gold-plating

The instinct to add a cache, a listener cap, a defensive guard, a speculative abstraction
"while I'm here" is the instinct to suppress. Add it when a real need proves it, not before.
Condensing readable code is good taste; padding it with machinery nobody asked for is the
opposite. The worst smell here is an over-engineered solution to a problem no one had.

## 9. Observability is part of the design

Instrument the **happy path**, not just failures. A reader should be able to follow the
story in the logs: log intent before an action, confirm after it. Track cost/audit data
where it matters (a task returning a `ledger` of what it consumed). And **never let
observability leak secrets** (see Observability, below). Design it in; don't bolt it on.

## 10. Functional core, imperative shell

Keep the centre pure; push side effects to the edge. The **derivations** — reducers,
strippers, builders, the projection fold — are pure functions of their inputs: no IO, no
clock, no global state. The **IO** — fetching events, writing projections, emitting to a
bus — lives in the outer shell (services, publishers, adapters) and calls *into* the pure
core. This is the whole reason the core can hold no storage opinion and no business logic:
the interesting logic is pure and testable in isolation, and the messy parts are thin and at
the boundary. When a function in the core reaches for a database, the logic is in the wrong
layer — move the IO out and pass the data in.

## 11. Derivations are deterministic

Because state is rebuilt by replaying events, a projection (or stripper, or any fold) **must
be a deterministic function of its events.** No `Date.now()`, no `Math.random()`, no id
generation, no IO inside an `apply`. If a value is nondeterministic — a timestamp, a
generated id — it is **captured into the event as a fact at creation time**, and the reducer
only ever reads it back. Replaying the same events must yield the identical read-model every
time, or "throw the projection away and rebuild it" is unsafe and the whole model is
unsound. This law is *why* events capture their `id` and `created` once, at the source.

---

# Part II — The shapes

## Naming

**Files — dotted, lowercase, single-word segments, hierarchical.**
- Shape: `module.<area>/<area>.<group>/<area>.<concept>[.<sub>].v<N>.ts`.
- Every dot-segment is one lowercase word. Never camelCase or two words inside a segment.
  Prefer `account.email.primary.set.v1.ts` over `account.setPrimaryEmail.ts`.
- Versioned artefacts carry a `.v1` segment (events, schemas, models, projections, http
  routes, tasks). Add a new version; never overwrite a shipped one.
- Sibling-file families share the stem: `thing.interface.ts` / `thing.base.ts` /
  `thing.memory.ts` / `thing.errors.ts`; `record.model.ts` / `record.postgres.model.ts`.

**The three-way lockstep.** A fact's filename, its topic string, and its exported symbol are
the same name in three cases. Keep them in sync — drift is a real bug (see Fix-on-sight).

```
file:   account.email.add.v1.ts
topic:  "account.email.add.v1"
symbol: AccountEmailAddV1
```

**Symbols.**
- DSL / factory primitives: **lowercase, single word** — `event()`, `aggregate()`,
  `projection()`, `task()`. Never `EventAggregate()` or `makeAggregate()`.
- Exported definitions (events, schemas, models, projections, handlers, jobs): **PascalCase**
  mirroring the topic — `AccountEmailAddV1`.
- A published package **brand-prefixes** its public symbols and scopes its name
  (`@scope/thing`, `BrandThingI`, `BrandThingMemory`) — the prefix *is* the namespace.
- Local functions and variables: **camelCase, verb-led** — `fetchByAggregateId`,
  `syncToAggregate`, `checkCanBeAdded`.
- Types: PascalCase, and **derived** — `z.infer<typeof X>`, `ReturnType<typeof f>`.

## Files & modules

- **One purpose per file** — the strongest rule here.
- **Default export at the bottom** is the file's primary artefact; named exports beside it
  for the schemas/types it also publishes.
- Keep files short. A long file is usually a missing split or an un-split DSL.
- **`index.ts` is context-dependent.** In an app, module indexes are thin wiring or empty —
  never logic. In a **published library, the barrel IS the public API**: it curates and
  brand-names the surface (`export { default as BrandThingI } from "./thing.interface"`,
  `export type { ... }`). See `interface-adapters`.
- **What you export is the contract.** Keep the surface minimal and intentional; helpers stay
  unexported. In a published package an accidental export is a future breaking change.

## Code shape & tightness

- **Single-statement conditionals are inline, no braces:**
  `if (!handler) return current;` · `if (status !== "active") return false;` ·
  `if (!found) throw new Error("event handler not found");`
- Guards are a **flat ladder of early exits** (`else if (…) return …;`), never a nested
  pyramid.
- **Multi-statement blocks get braces.** Inline is only the one-statement case.
- Prefer expression-bodied arrows and direct returns.
- Formatting is Prettier's job: 2-space indent, double quotes, ~120 print width. Don't
  hand-format around it.

## Comments — the *why*, the *risk*, the *open question*. Never the *what*.

Terse code is the goal, but a comment that captures **reasoning, a hazard, or an unresolved
decision is valuable and wanted.** A comment that narrates what the next line plainly does is
noise.

```ts
// YES — captures a risk and a rationale the code can't show
// This must pass; if it doesn't we've half-written a stream — wake someone up.
const prepared = schema.parse(event);

// YES — an open design question, flagged in place for later
// @THOUGHT should middleware get a chance to inspect events before they're stored?

// NO — narration of the obvious
// Getters
getId() { ... }
```

**Density scales with external messiness.** Pure internal domain code is terse and needs
almost none. Integration code wrestling with someone else's API — a surprising vendor field,
an assumption about ordering, a security concern — earns liberal annotation: state the
assumption, flag the hazard, admit the uncertainty (`// not sure — the vendor returns "Address
Range" here?`), warn on escape hatches (`// here be dragons`). Honesty about what you don't
know is part of the taste. Mark open questions with `@THOUGHT` so they're greppable.

## Functional composition (the default mechanic)

The domain core is built from **closures over a `state` object** that return an operations
object (often a `dsl` with `get`/`set` namespaces and a terminal `build()`/`parse()`). The
full recipe — factory shape, accessor convention, splitting a DSL across files with shared
state — is in **`functional-dsl`**. The cross-cutting rule for *here*: prefer a function that
closes over state to a class, unless you're building a swappable contract (§5).

## Types — strong at the edge, contained within

Derive types; never hand-maintain what a value already encodes. Keep the **public surface
strongly typed** — a consumer of a published package gets real types, not `any`.

- `any` is a last resort and an **internal** one. A generic DSL sometimes needs a single
  `any` to bridge a relationship the compiler can't follow — keep it at the lowest internal
  level, behind a typed signature. `any` must never surface in an exported type or public
  return. (The sample builders leak `any` at their edges — a loose end to fix, not copy.)
- At a boundary taking outside data, reach for `unknown` + a `parse()`/narrow, not `any`.
- Prefer **generics constrained by a base type** (`<T extends BaseModel>`) to keep reusable
  code type-safe rather than widening to `any`.
- Let inference work: annotate exported signatures (the contract); let locals infer.

## Async — await, ordered or parallel, never clever

- async/await only. No `.then`/`.catch` chains except, at most, one at a process entrypoint.
- Sequential work is a plain `for (const x of xs) { await … }`. Parallel work is
  `await Promise.all(xs.map(…))`. Choose deliberately — in event sourcing, stream order is
  load-bearing, so default to sequential whenever position order matters.
- Avoid the `reduce` that awaits its own accumulator
  (`reduce(async (acc) => [...(await acc), x])`). It's a sequential loop in disguise — harder
  to read and easy to get subtly wrong. Write the loop.

## Immutability

- Build new state with **spread** — `{ ...current, status }` — never mutate in place.
- Upsert into a list by copying then replace-or-push:

```ts
const idx = list.findIndex((x) => x.uid === incoming.uid);
const next = [...list];
if (idx > -1) next[idx] = incoming;
else next.push(incoming);
return { ...current, items: next };
```

- Spreads are **shallow**. To change a nested field, spread every level you touch —
  `{ ...current, meta: { ...current.meta, name } }` — never mutate a child of a shallow copy.
- The **one** sanctioned place to mutate is a builder's own internal `state` before it hands
  a value back. Everything crossing a boundary is copied.

## Validation with Zod (v4)

- Prefer **named imports** for constructors — `object`, `string`, `array`, `literal` — and
  use `z.` for `enum` / `infer`.
- Name schemas with a `V1` suffix; export the inferred type beside them.
- Build a **vocabulary of small value-object schemas** (owner, email, phone, text) and
  compose larger shapes from them with `.extend()` — don't re-declare shapes.
- Use `.default()` liberally so optional/defaulted fields are explicit at the schema.
- `parse()` at boundaries — **including reads from your own store.** Don't trust a row or
  document just because you wrote it; parse it back through the model on the way out. The only
  errors raised are mechanical (bad payload, bad model).
- **Validate what you send; type what you receive.** Zod-parse your own inputs and the models
  you produce. For a third party's response you only read, a hand-written `type` is fine (you
  don't own it) — then map it through a `parse()` into *your* model. Zod at your boundaries;
  plain types for shapes you don't control.

```ts
const EmailSchemaV1 = object({
  address: string().email(),
  type: z.enum(["personal", "work"]).default("personal"),
});
export type EmailSchemaV1Type = z.infer<typeof EmailSchemaV1>;
```

## Errors — few, mechanical, distinguishable

Raise errors only for **mechanical** faults — a payload that fails its schema, a malformed
mapper, a topic collision — never for business judgement. Two failure modes sit on either
side of the right answer: the bare `throw new Error("string")` a caller can't branch on, and
the class tower the agent build grew. The middle is correct: a small **tagged** error a
consumer can switch on — a stable `code` plus a message, nothing more.

The house form for a code vocabulary is a **per-module `const enum` of stable
`SCREAMING_SNAKE` string codes** (`provider.errors.ts`, `client.http.errors.ts`), thrown as
`throw new Error(ProviderErrors.MISSING_API_KEY)`. One errors file per module.

> For the *core library's* error contract — the exact type, codes, and where each is raised —
> the shape is the Epic 3 gated decision (docs/internal/DRAFT-AND-HALT.md), not invented ad hoc. This skill
> fixes the taste (minimal, tagged, mechanical-only).

## Observability

- **Two logger shapes, by mode.** Internally, a `createLogger(label)` factory with named
  subsystem loggers (`logger.system`, `logger.database`, …). For a published library, an
  **injectable logger *interface*** with a console default and full consumer override (see
  `interface-adapters`). Both expose level-filtered `debug / info / warn / error`.
- **Log levels with intent:** `debug` for the beats of the story, `info` for lifecycle,
  `warn`/`error` in catches. Structured log keys read as `BRAND_EVENT_NAME`.
- **Narrate intent, then confirm:** log before the action, confirm after it (a `✓` prefix on
  the success line is the house idiom).
- **Scrub secrets from logs.** Never log an API key, token, or PII. Redact at the log seam —
  request/response hooks that strip credentials, or masking a connection-string password to
  `********` before the line is written. Observability must not become exfiltration.
- **Never `console.log` in committed code** — that's debug cruft. Use the logger or delete it.

```ts
logger.system.debug(`syncing projection ${id}`);
await sync(id);
logger.system.debug(`✓ synced projection ${id}`);
```

## Middleware & adapters

- Favour **middleware seams and adapters**. Keep the port (the shared interface) small; push
  store/transport specifics into `*.adapter.*` implementations behind it.
- A thin, honest interface that several adapters can satisfy beats a clever one only one of
  them can. (S3 is the brutal test: if the port works for S3, it works for anything.)
- The full interface + base + concrete adapter recipe is in **`interface-adapters`**.

## The domain mechanics live in `functional-dsl`

Declarative `{ action, apply }` handler objects, pure reducers that tolerate unknown topics,
the staging / validate-then-emit flow, the closure-DSL recipe, splitting a DSL across files
with shared state, and the worked vertical slice are all domain-core mechanics — see the
**`functional-dsl`** skill. Testing belongs to **`testing`**.

---

# Part III — Canonical vs over-engineered (for the functional core)

A prior agent build of this very library is kept as a *negative* reference. It is fluent
TypeScript and wrong for the **core**. (Note the scope: this contrast is about the functional
domain core. In `interface-adapters`, classes are *correct* — the test is §5's "swappable
contract?", not a blanket ban.)

| Concern | Canonical core (do this) | Over-engineered (avoid) |
|---|---|---|
| Core building block | function + closure over `state` | `class … implements`, `private _data`, `new`, `this` *for the core* |
| Accessors | `get.id()` / `set.id()` namespaces | `getId()` / `withId()` method-per-field sprawl |
| Validation | `parse()` at the boundary; trust the shape inside | hand-rolled `typeof x !== "string"` guards on already-typed args |
| Errors | tagged code; let it bubble; wrap the *story* once | `try/catch` around every call, re-wrapping messages |
| Comments | the *why* / risk / `@THOUGHT` | `// Getters`, `// set the id` narration |
| Performance | derive; add machinery when a need proves it | speculative cache, `MAX_LISTENERS`, `process.nextTick` nobody asked for |
| Types | derived, strong at the public edge | `any` leaking through exported signatures |
| Async | `for…of` / `Promise.all`, chosen on purpose | `reduce` that awaits its own accumulator |
| Size | the smallest honest version | defensive bloat "just in case" |

The lesson: **untrusted contracts and gold-plating are the failure mode to watch for in your
own output.** When a draft starts growing guard clauses and helper machinery, stop and cut
back to the fact.

---

# Part IV — Fix-on-sight (don't reproduce these)

Real defects found in prior code — each maps to a rule above:

- **Debug `console.log` / `console.debug` / casual `console.log("oh no", e)` left in** → use
  the logger or delete it.
- **Three-way-lockstep drift** — an event's literal/topic not matching its filename, or a
  whole events file copy-pasted from another with the literals never renamed. Keep file ↔
  topic ↔ symbol identical.
- **Field-name typos that harden into data** (e.g. `agrregateId`). Names on immutable facts
  are forever; get them right the first time.
- **Inverted guards** — a branch labelled "found existing" running when nothing was found.
  Read conditionals back against their log lines.
- **Empty stubs and commented-out blocks** shipped in real files — finish it or delete it
  (an empty `const enum Errors {}` is still a stub).
- **Mixed conventions in one place** (logger *and* `console`; two Zod import styles;
  duplicated `it()` names) — pick one and be consistent.

---

# Companion skills

- **`functional-dsl`** — building the domain core (events, aggregates, projections, DSLs).
- **`interface-adapters`** — building swappable adapters / SDK extension points.
- **`testing`** — create / test / prove.

Load the one that matches the work; this foundation always applies underneath it.
