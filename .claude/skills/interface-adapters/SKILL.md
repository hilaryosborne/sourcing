---
name: interface-adapters
description: >-
  How to build SWAPPABLE ADAPTERS and pluggable components behind a published contract in this
  repository — the interface + base + concrete pattern, constructor DI with batteries-included
  defaults, barrels as the public API, per-module error enums, and universal-model + per-adapter
  mapping. Use when building the persistence layer and storage adapters (Epic 4, the
  Postgres/Mongo/S3 fridges), any consumer-swappable seam (logger, cache, store), or the
  published package surface. Assumes the `coding-style` foundation; this is the Mode-B recipe.
  Storage interface shapes are governed by FOUNDATION.md and ratified via DRAFT-AND-HALT.md.
---

# interface-adapters — building swappable contracts

This is **Mode B** from `coding-style` §5: reach for it when a consumer must **implement or
swap** an implementation — a storage adapter, a cache, a logger. Here classes are *correct*: the
value is a stable contract with interchangeable implementations behind it. The test is always
"is this a swappable contract?" — if not, use `functional-dsl` instead.

Examples below use a neutral `Brand` prefix and the storage domain this skill targets; in real
code the prefix is the package's brand and the seam is whatever varies.

## When this applies — ownership, not "it's persistence"

Don't reach for classes just because something does IO. **Internal persistence you own and wire
yourself stays functional** — the repositories and db clients in this codebase are region-curried
closures, not classes:

```ts
const accounts = (region: string) => {
  const db = database(region);                            // region injected by currying
  const add = async (data: AccountModelType) => {
    const collection = (await db.store.data.connect()).collection(AccountCollectionV1);
    await collection.insertOne(data);
    bus.publish("account.created.v1", data);              // emit an event on write
    return AccountModel.parse(await collection.findOne({ uid: data.uid }));  // parse on read
  };
  return { add };
};
```

Reach for **interface + base + concrete (this skill)** only when a *consumer* must implement or
swap the thing behind a published contract. For our build that's the **storage adapters**
(Postgres/Mongo/S3 fridges behind one storage interface). The persistence layer that composes
them (registry, projection store, self-healing) can itself be functional. The decision is
**ownership / swappability**, never "is it IO?"

> Scope note: the **storage interface** all adapters implement — and the overwrite-in-place
> operation right-to-forget needs — is drafted against Postgres/Mongo/S3 at once and ratified at
> the Epic 4 gate (FOUNDATION.md, DRAFT-AND-HALT.md). This skill is the construction style, not
> the ratified port.

---

## The three-file pattern, per pluggable component

Each swappable thing is a small family of files with a shared stem:

```
storage.interface.ts  →  the contract:    interface BrandStorageI { … }         (export default)
storage.base.ts       →  shared plumbing: class BrandStorageBase { … }          (default + options type)
storage.postgres.ts   →  a concrete:      class BrandStoragePostgres extends Base implements I { … }
storage.errors.ts     →  const enum BrandStorageErrors { … }                    (one per module)
```

- **Interface** = the *minimal* contract a consumer codes against. Keep it tight — only what
  every implementation must offer (the thin honest port; see below).
- **Base** = the boring shared plumbing every concrete reuses (logger get/set, key building,
  option parsing) so concretes don't repeat it. Hold generic helpers `protected`.
- **Concrete** = `class X extends Base implements I` — the real behaviour for one backend
  (`…Postgres`, `…Mongo`, `…S3`, `…Memory`).
- **Naming:** `BrandStorageI` (interface), `BrandStorageBase` (base), `BrandStorage<Variant>`
  (concrete). Brand-prefix every public symbol.

```ts
interface BrandStorageI {
  setLogger(logger: BrandLoggerI): void;
  hasLogger(): boolean;
  append<E extends EventModel>(stream: string, events: E[]): Promise<void>;
  read<E extends EventModel>(stream: string, fromPosition?: number): Promise<E[]>;
}
```

Type reusable members with **generics constrained by a base type** (`<E extends EventModel>`),
never `any`, so adapters stay type-safe across implementations.

---

## Constructor DI with batteries-included defaults

The composition root takes an options bag of interfaces, **defaults each one**, and wires
cross-dependencies. Consumers get a working object out of the box and can override any seam.

```ts
class Persistence {
  protected storage: BrandStorageI;
  protected logger: BrandLoggerI;

  constructor(protected options?: { logger?: BrandLoggerI; storage?: BrandStorageI }) {
    this.logger = options?.logger ?? new BrandLoggerConsole();       // a sensible default
    this.storage = this.createStorage(options?.storage);             // factory wires deps
  }

  protected createStorage(storage?: BrandStorageI): BrandStorageI {
    if (storage) {
      if (!storage.hasLogger()) storage.setLogger(this.logger);      // late injection
      return storage;
    }
    return new BrandStorageMemory({ logger: this.logger });
  }
}
```

Patterns to keep:
- **Default every collaborator** (`?? new DefaultX()`) — batteries included, fully overridable.
- **Factory methods** (`createX`) over inline construction when wiring needs a step — they're the
  seam for cross-dependency injection and per-instance setup.
- **Late setter injection** (`hasLogger()/setLogger()`) so a consumer's object can be handed its
  collaborators after construction.
- **Fail fast on required config** — config that can't be supplied later throws a tagged error at
  construction (`if (!this.dsn) throw new Error(StorageErrors.MISSING_CONNECTION_STRING)`); config
  comes from the options bag *or* env (`options?.dsn ?? process.env.STORAGE_DSN`).
- **Graceful degradation at the outermost edge only.** Internal layers throw; a single
  public-facing entry method may choose to catch-log-and-degrade so the SDK stays resilient. That
  choice is deliberate and at the boundary, never sprinkled within.

---

## Barrels are the public API

In a published library the `index.ts` barrel **is** the curated, brand-named surface:

```ts
// module barrel — brand-name the default exports, export types explicitly
export { default as BrandStorageI } from "./storage.interface";
export { default as BrandStorageBase } from "./storage.base";
export { default as BrandStoragePostgres } from "./storage.postgres";

// types get `export type`; grouped sub-modules can get a namespace re-export
export type { EventModelType } from "./event.model";
export * as BrandStorageConfig from "./storage.config";
```

- The barrel is where defaults acquire their **branded public names** and where you decide what is
  contract vs internal. An accidental export is a future breaking change.
- The package root `index.ts` composes the module barrels into the whole surface.

---

## Errors — one `const enum` per module

A module's failure codes live in `storage.errors.ts` as a `const enum` of stable
`SCREAMING_SNAKE` strings, thrown via `new Error(Code)` so consumers can branch on a known value.
Don't grow an error-class hierarchy; don't throw bare ad-hoc strings.

```ts
const enum BrandStorageErrors {
  MISSING_CONNECTION_STRING = "MISSING_CONNECTION_STRING",
  STREAM_NOT_FOUND = "STREAM_NOT_FOUND",
}
```

---

## Universal model + per-adapter mapping

A canonical model is the shared currency; each adapter maps its backend's shape into it.

- The **universal model** is backend-agnostic and tolerant — fields optional where they can be,
  plus an `unknown` escape hatch for raw backend data (`// here be dragons`).
- A **per-adapter model** `.extend()`s it to type that backend's specifics.
- The adapter **maps backend row/document/object → model and `parse()`s into it** — selective
  hydration (only fetch/return what the caller asked for) keeps work and data minimal.
- **Validate what you send, type what you receive** (foundation): Zod-validate what you write out;
  type a backend's raw read shape with a hand-written `type` (you may not own it); parse the
  mapped result into your model.

---

## Middleware hooks & secret hygiene

Expose **interception hooks** at IO seams (e.g. `onRequestLog` / `onResponseLog`, or a query
logger) so callers can transform what's logged — and use them to **scrub secrets**: strip
credentials/connection strings from logs before they're written. Observability must never
exfiltrate secrets (foundation §9).

---

## The thin honest port

When one interface must serve several backends (Postgres, Mongo, S3), it can only contain what
**all** of them can honestly do. S3 is the brutal test — almost no features to lean on; if the
port works for S3 it works for anything. Anything needing one store's special power is either an
**optional advertised capability** or out of scope. Flag the expensive operations: right-to-forget
needs **overwrite-in-place** — trivial in Postgres/Mongo, a batch rewrite in S3 — so call its cost
out when drafting the interface.

---

## Examples as runnable consumer apps

Demonstrate each extension point with a tiny consumer app that imports the **published package**
and implements an interface (`class MyRedisStorage implements BrandStorageI`). One example per
seam (in-memory default, custom storage, custom logger). These double as documentation (Epic 6)
and as proof the contract is genuinely swappable. Rehearse publish/install against a local
registry (verdaccio) before releasing — see `testing`.
