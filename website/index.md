---
layout: home

hero:
  name: sourcing
  text: Event sourcing as mechanism, not judgment.
  tagline: "A domain-agnostic TypeScript library that records facts and derives state from them — with no business rules, no command layer, and no opinion about where your data lives."
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Why this exists
      link: /guide/what-is-sourcing
    - theme: alt
      text: View on GitHub
      link: https://github.com/hilaryosborne/sourcing

features:
  - title: Mechanism, not judgment
    details: "No decider, no command bus, no rule engine. You stage an event, ask what the state would be, and decide what's allowed in your own code. The library never learns your rule."
  - title: Zero storage opinion
    details: "The core touches no database — it depends on exactly two packages (Zod and nanoid). Persistence is a separate, optional layer behind one interface, with Postgres, Mongo, and S3 adapters or your own."
  - title: Self-healing projections
    details: "One cheap head read picks the cheapest correct path — full build, delta fold, or a no-op cache hit. Projections are pure folds you can bin and rebuild any time."
  - title: Right-to-forget, built in
    details: "Immutable history and delete-my-data, reconciled by in-place stripping. The repository owns the erase sequence so PII never survives — and observability can't leak it back."
  - title: Typed end to end
    details: "Event payloads are inferred from their Zod schemas and flow, fully typed, into every projection handler. No casts, no stringly-typed topics in your fold."
  - title: Observable on your terms
    details: "An optional, async-safe observer maps the storage layer to Splunk, New Relic, or OpenTelemetry — logging, error reporting, and profiling — without ever touching the adapters."
---

## First projection in 60 seconds

```ts
import { event, aggregate, projection } from "@hilaryosborne/sourcing";
import { object, string, number } from "zod";

// 1 — events: a topic + a typed payload schema
const AccountOpened = event("account.opened.v1", object({ holder: string().min(1) }));
const Deposited = event("account.deposited.v1", object({ amount: number().int().positive() }));

// 2 — an aggregate: a name + the events legal on its stream
const Account = aggregate("account.v1");
Account.register(AccountOpened);
Account.register(Deposited);

// 3 — a projection: a name, an output schema, one handler per event
const Balance = projection("projection.balance.v1", object({ holder: string(), balance: number() }));
Balance.aggregate(Account);
Balance.handle(AccountOpened, (s, e) => ({ ...s, holder: e.payload.holder, balance: 0 }));
Balance.handle(Deposited, (s, e) => ({ ...s, balance: s.balance + e.payload.amount }));

// fold some facts — nothing is stored, this is pure
const account = Account.instance();
account.events.add(AccountOpened.create({ holder: "Ada" }).creator("user", "ada"));
account.events.add(Deposited.create({ amount: 100 }).creator("user", "ada"));
account.events.commit();

Balance.build(account); // → { holder: "Ada", balance: 100 }
```

Ready? Head to **[Getting started](/guide/getting-started)**, or read **[why this exists](/guide/what-is-sourcing)** first.
