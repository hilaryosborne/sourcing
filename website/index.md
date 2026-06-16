---
layout: home

hero:
  name: sourcing
  text: Event sourcing as mechanism, not judgment.
  tagline: "Define events, fold them into read models, and keep your business rules in your own code. Domain-agnostic, ~zero-dependency, and refreshingly honest about where it stops."
  actions:
    - theme: brand
      text: Get started →
      link: /guide/getting-started
    - theme: alt
      text: Why event sourcing?
      link: /guide/what-is-sourcing
    - theme: alt
      text: 🧪 Examples
      link: /examples
    - theme: alt
      text: GitHub
      link: https://github.com/hilaryosborne/sourcing

features:
  - icon: 🎯
    title: Mechanism, not judgment
    details: "No decider, no command bus, no rule engine. You stage an event, ask what the state would be, and decide in your own if-statement. The library never learns your rule — that's the point."
  - icon: 🪶
    title: A core with two dependencies
    details: "The core touches no database and ships on Zod + nanoid. Persistence is a separate, optional package you reach for only when you want events stored. Nothing you don't use."
  - icon: ♻️
    title: Self-healing projections
    details: "One cheap head read picks the cheapest correct path: full build, delta fold, or a no-op cache hit. Read models are pure folds — bin one and rebuild any time."
  - icon: 🔌
    title: Swappable storage, no lock-in
    details: "Postgres, Mongo, S3, or your own — behind one interface, each certified against the real service via a shared conformance suite. If it works on S3, it works anywhere."
  - icon: 🗑️
    title: Right-to-forget, built in
    details: "Immutable history and delete-my-data, reconciled by in-place stripping. The repository owns the erase sequence so PII never survives — and observability can't leak it back."
  - icon: 📈
    title: Observable on your terms
    details: "An optional, async-safe observer maps the storage layer to Splunk, New Relic, or OpenTelemetry — logging, error reporting, and profiling — without ever touching the adapters."
---

## ⚡ Enough talk — your first projection in 60 seconds

No database, nothing to configure. This snippet runs as-is.

```ts
import { event, aggregate, projection } from "@hilaryosborne/sourcing";
import { object, string, number } from "zod";

// 1 — events: a topic + a typed payload schema (declared as the first version)
const AccountOpened = event("account.opened.v1");
AccountOpened.version(1, object({ holder: string().min(1) }));
const Deposited = event("account.deposited.v1");
Deposited.version(1, object({ amount: number().int().positive() }));

// 2 — an aggregate: a name + the events legal on its stream
const Account = aggregate("account.v1");
Account.register(AccountOpened);
Account.register(Deposited);

// 3 — a projection: a name, an output schema, one handler per event
const Balance = projection("projection.balance.v1", object({ holder: string(), balance: number() }));
Balance.aggregate(Account);
Balance.handle<{ holder: string }>(AccountOpened, (s, e) => ({ ...s, holder: e.payload.holder, balance: 0 }));
Balance.handle<{ amount: number }>(Deposited, (s, e) => ({ ...s, balance: s.balance + e.payload.amount }));

// fold some facts — nothing is stored, this is pure
const account = Account.instance();
account.events.add(AccountOpened.create({ holder: "Ada" }).creator("user", "ada"));
account.events.add(Deposited.create({ amount: 100 }).creator("user", "ada"));
account.events.commit();

Balance.build(account); // → { holder: "Ada", balance: 100 }
```

Want the storage-backed, self-healing version? It's the [same code plus four lines](/examples/self-healing-postgres).

## 🧠 The shift: from "current state" to "the facts that got you there"

Most apps store the _latest_ value and overwrite it. That's lossy by construction — the moment a number changes, the reason is gone. Event sourcing stores the **facts**, and treats current state as a fold over them:

::: code-group

```ts [❌ CRUD — state, overwritten]
// one row, mutated in place — the "why" evaporates the instant it changes
account.balance = 70; // was 100. why? when? by whom? — gone.
await db.update(account);
```

```ts [✅ Event sourcing — facts, appended]
// the history IS the database; current state is just a fold over it
account.events.add(Withdrawn.create({ amount: 30 }).creator("user", "ada"));
Balance.build(account); // → 70, and every step that got there is still on the record
```

:::

You get a perfect audit trail, the freedom to derive **new** read models from data you already have, and time-travel debugging — for free. [The full story →](/guide/what-is-sourcing)

## 🧭 Pick your path

- 🧠 **Learn the idea** — [Why event sourcing?](/guide/what-is-sourcing) — the problem, our take, and when it's the wrong tool.
- 🏃 **Start in 60 seconds** — [Getting started](/guide/getting-started) — install and build your first projection.
- 🧪 **Show me real builds** — [Examples](/examples) — shopping carts, orders, GDPR erasure, Postgres.
- 🗺️ **Understand the model** — [Concepts](/concepts) — the three nouns the whole library falls out of.
- 🔌 **Wire up storage** — [Storage adapters](/guide/storage-adapters) — Postgres, Mongo, S3, or your own.

## 🚦 When _not_ to reach for this

We'd rather you use the right tool than the cool one. If you only ever need the latest value and will never ask "how did it get this way?", event sourcing is overhead — use a row in a table. It earns its keep when you need the timeline, retroactive read models, or a hard audit trail. [Honest guidance, and the rest of the hard questions, in the FAQ →](/faq#do-i-actually-need-event-sourcing)

---

<p align="center"><em>Released under the MIT License. Core depends only on Zod and nanoid.</em></p>
