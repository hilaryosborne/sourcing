# sourcing

**Event sourcing as mechanism, not judgment.** Define **events**, hold them in an **aggregate**, derive state with **projections** — with no business logic baked in and no opinion about where your data lives. The core is ~zero-dependency (Zod + nanoid); storage is an optional, swappable layer you bolt on when you need it.

```ts
const Balance = projection("projection.balance.v1", object({ holder: string(), balance: number() }));
Balance.aggregate(Account);
Balance.handle(AccountOpenedV1, (s, e) => ({ ...s, holder: e.payload.holder, balance: 0 }));
Balance.handle(AccountDepositedV1, (s, e) => ({ ...s, balance: s.balance + e.payload.amount }));

Balance.build(account); // → { holder: "Ada", balance: 100 }
```

---

## The mental model in three nouns

You only ever need to keep three things straight. The whole library falls out of them.

- **The aggregate** — a container for one entity's stream of events, keeping _committed_ history apart from _staged_ (proposed) events. It holds events; it does **not** fetch, store, or judge them. Pure, in-memory, storage-free.
- **The repository** — the optional persistence layer. It decides what to read and write, composes events into an aggregate, builds and caches projections, and heals stale ones. It is composed _on top of_ core and is the only thing that touches storage.
- **The storage adapter** — the swappable backend: Postgres, Mongo, or S3 (or your own). The repository talks to it through one interface; the aggregate never knows it exists.

> The library answers _"what would the state be if this event were real?"_ It never answers _"is this event allowed?"_ — that judgment is 100% your application's. New here? Read the [**concepts skill**](docs/skills/sourcing-concepts/SKILL.md) (the _why_), then [**DOCS.md**](DOCS.md) (the worked _how_).

---

## Install

Core only — everything in Scenario 1 and 3 below needs nothing else:

```sh
npm install @hilaryosborne/sourcing zod
```

Add the repository and an adapter when you want stored, self-healing projections (Scenario 2):

```sh
npm install @hilaryosborne/sourcing-persistence @hilaryosborne/sourcing-adapter-postgres
```

> **Packages are published to GitHub Packages**, which requires authentication to install **even though the packages are public**. Add a project `.npmrc`:
>
> ```ini
> @hilaryosborne:registry=https://npm.pkg.github.com
> //npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
> ```
>
> and export a `GITHUB_TOKEN` (a personal access token with `read:packages`). This is a one-time setup cost of GitHub Packages, not of this library.

---

## First projection in 60 seconds (core only, no database)

Three steps: define events, register them on an aggregate, fold them with a projection. This snippet runs as-is.

```ts
import { event, aggregate, projection } from "@hilaryosborne/sourcing";
import { object, string, number } from "zod";

// 1 — events: a topic + a payload schema. The topic is an opaque, versioned string.
const AccountOpenedV1 = event("account.opened.v1", object({ holder: string().min(1) }));
const AccountDepositedV1 = event("account.deposited.v1", object({ amount: number().int().positive() }));

// 2 — an aggregate: a name + the events that are legal on it.
const Account = aggregate("account.v1");
Account.register(AccountOpenedV1);
Account.register(AccountDepositedV1);

// 3 — a projection: a name, an output schema, a handler per event.
const Balance = projection("projection.balance.v1", object({ holder: string(), balance: number() }));
Balance.aggregate(Account);
Balance.handle(AccountOpenedV1, (current, e) => ({ ...current, holder: e.payload.holder, balance: 0 }));
Balance.handle(AccountDepositedV1, (current, e) => ({ ...current, balance: current.balance + e.payload.amount }));

// build some events and fold them — nothing is stored.
const account = Account.instance(); // core mints a nanoid; pass one to override
account.events.add(AccountOpenedV1.create({ holder: "Ada" }).creator("user", "ada"));
account.events.add(AccountDepositedV1.create({ amount: 100 }).creator("user", "ada"));
account.events.commit();

Balance.build(account); // → { holder: "Ada", balance: 100 }
```

`create()` validates the payload immediately. `creator` (provenance) is **required** — a permanent fact with no provenance refuses to be created; `headers` are optional. `event.payload` inside a handler is **fully typed** from the event's schema.

---

## The three scenarios

The same aggregate + projection builder serves all three. Only _who fills the aggregate_ changes.

### Scenario 1 — projections on demand (core only)

Fold events into a read-model and return it. Nothing is stored. That's the snippet above.

### Scenario 3 — staged preview & business validation (core only)

Stage an event _without committing_, build the would-be projection, and judge it. This is the committed/staged split doing its job — the library previews, your app decides.

```ts
account.events.add(AccountWithdrawnV1.create({ amount: 250 }).creator("user", "ada")); // staged, NOT committed
const wouldBe = Balance.build(account); // folds committed ++ staged

if (wouldBe.balance < 0) {
  // your overdraw rule — the library has no opinion. Reject; never commit; the staged event evaporates.
} else {
  account.events.commit();
}
```

### Scenario 2 — projections from storage (self-healing)

Bring in the repository and an adapter. Write through `commit`; read through `rebuild`, which keeps the stored projection up to date for you.

```ts
import { repository } from "@hilaryosborne/sourcing-persistence";
import { postgresStorage } from "@hilaryosborne/sourcing-adapter-postgres";

const storage = await postgresStorage(pgClient, { events: "account_events", projections: "account_projections" });
const repo = repository({ storage });

const opening = await repo.create(Account);
opening.events.add(AccountOpenedV1.create({ holder: "Ada" }).creator("user", "ada"));
await repo.commit(opening); // append staged events, advance the head

const balance = await repo.rebuild({ aggregate: Account, id: opening.id, projection: Balance });
```

`rebuild` makes one cheap head lookup and picks the cheapest correct path:

| Stored projection vs. head     | What happens                                                 |
| ------------------------------ | ------------------------------------------------------------ |
| **none**                       | read the full stream, build from scratch, save               |
| **head > bookmark** (stale)    | read **only the delta**, fold it over the stored state, save |
| **head == bookmark** (current) | return the stored state — **no event fetch** (the cheap win) |

(`pgClient` is a thin adapter over the `pg` driver — see the [**storage-adapters skill**](docs/skills/using-storage-adapters/SKILL.md) for the exact wiring for Postgres, Mongo, and S3.)

---

## Right-to-forget, built in

Events are _almost_ immutable. The one sanctioned mutation is **stripping** — for GDPR / data-erasure. An event declares named, contextual redactions next to itself:

```ts
AccountOpenedV1.strip("gdpr", (payload) => ({ ...payload, holder: "[redacted]" }));
```

Pure-core, erasure is `strip → export` (the pass/fail test: no PII survives in the produced events):

```ts
const redacted = account.strip("gdpr"); // a NEW aggregate — same ids/positions/topics, payloads redacted
redacted.events.export(); // PII-free envelopes
```

With storage, the repository owns the whole sharp-edged sequence (load → strip → overwrite in place → bin projections so a cached one can't mask the PII) as one idempotent operation:

```ts
await repo.forget({ aggregate: Account, id, context: "gdpr" });
```

Because projections are pure derivations, once events are stripped the read side heals automatically on the next `rebuild`. The library appends **no** "redaction happened" marker — if you want an erasure audit trail, emit your own event.

---

## Packages

| Package                                    | Role                                                      | Install it when…                          |
| ------------------------------------------ | --------------------------------------------------------- | ----------------------------------------- |
| `@hilaryosborne/sourcing`                  | core — events, aggregates, projections, strippers         | always                                    |
| `@hilaryosborne/sourcing-persistence`      | the repository — registry, projection store, self-healing | you want stored, self-healing projections |
| `@hilaryosborne/sourcing-adapter-postgres` | storage adapter — Postgres                                | events live in Postgres                   |
| `@hilaryosborne/sourcing-adapter-mongo`    | storage adapter — Mongo (needs a replica set)             | events live in Mongo                      |
| `@hilaryosborne/sourcing-adapter-s3`       | storage adapter — S3 (the brutal one)                     | events live in object storage             |

Each is independently versioned — when only one adapter changes, only it publishes. Core depends on nothing but Zod and nanoid; persistence depends on core; core never depends on persistence.

---

## Learn more

- [**concepts skill**](docs/skills/sourcing-concepts/SKILL.md) — the mental model in depth (the _why_): aggregate vs repository vs adapter, strippers, staged events, self-healing.
- Component skills for using each part with an AI assistant: [events](docs/skills/using-events/SKILL.md) · [aggregates](docs/skills/using-aggregates/SKILL.md) · [projections](docs/skills/using-projections/SKILL.md) · [storage adapters](docs/skills/using-storage-adapters/SKILL.md).
- [**DOCS.md**](DOCS.md) — one worked domain across all three scenarios, end to end.
- [**FOUNDATION.md**](FOUNDATION.md) — the conceptual model and the rulings behind the design.

Contributing to the library itself? See [**CLAUDE.md**](CLAUDE.md), [**PLAN.md**](PLAN.md), and [**TOOLING.md**](TOOLING.md).

## License

MIT © Hilary Osborne
