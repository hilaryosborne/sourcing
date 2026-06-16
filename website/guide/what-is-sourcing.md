# 🧠 Why event sourcing?

Let's start with a confession most data layers won't make: **your database is lying to you.**

It tells you a user's balance is `70`. It does _not_ tell you it was `100` an hour ago, that `30` left in a withdrawal, who authorised it, or whether that's even the change you think it is. The row holds the _answer_ and throws away the _working_. For a surprising number of systems — anything financial, regulated, collaborative, or that you'll ever have to debug at 2am — the working was the valuable part.

Event sourcing flips the storage model on its head. Instead of storing the latest state and overwriting it, you store the **sequence of facts that happened**, and treat current state as a _fold_ over those facts.

## 📖 The pattern, stated plainly

Three ideas, and that's genuinely it:

1. **Events are immutable, past-tense facts.** `account.opened`, `money.deposited`, `money.withdrawn`. Each is a small, named record of something that _already happened_. You append them; you never update or delete them.
2. **An aggregate is the stream of events for one thing.** One account, one order, one document — its whole history, in order.
3. **A projection is a fold.** Replay the events through a reducer and you get a read model: a balance, a status, a search row, whatever shape you need to answer a question.

```ts
// the facts (what happened)
opened   { holder: "Ada" }
deposited { amount: 100 }
withdrawn { amount: 30 }

// the fold (what it means, right now)
Balance.build(account); // → { holder: "Ada", balance: 70 }
```

Current state isn't _stored_ — it's _derived_, on demand, from facts you can always re-read. Which means you can derive a **different** read model tomorrow from the same history, with no migration. The data you wish you'd captured? If it was in the events, it's already there.

> 💡 Oskar Dudycz puts it well: _event sourcing is architecting for tomorrow's questions._ Today's decisions are tomorrow's context — so keep the context.

## 😖 The problem it solves (and the pain you already know)

State-oriented (CRUD) persistence keeps only the latest version of a row. That has three costs you've probably paid:

- **Lost history.** "Why is this order cancelled?" → nobody knows; the status column just says `cancelled`. You bolt on an `audit_log` table, half-populated, that drifts out of sync with reality.
- **Read models you can't change cheaply.** A new dashboard needs data you didn't think to denormalise. Now it's a backfill migration against production.
- **Debugging by archaeology.** Reproducing "how did it get into this state?" means guessing, because the path is gone.

Event sourcing makes the audit log _the source of truth_ instead of an afterthought, makes new read models a `build()` instead of a migration, and makes "how did it get here?" a literal replay.

::: tip You might be thinking: "isn't this just an audit log?"
An audit log _describes_ changes to a state table that's still the source of truth — two things to keep in sync, and the table wins ties. Event sourcing makes the log _the_ source of truth and derives the table from it. There's nothing to keep in sync, because there's only one place the truth lives.
:::

## 🎯 Our take: mechanism, not judgment

Here's where most event-sourcing libraries lose the plot — and where this one deliberately stops short.

They ship a **framework**. A "decider" or command-handler layer that wants to own your business rules. A baked-in event store. Versioning buried in upcaster machinery that couples your read path to a migration history. You adopt the pattern and inherit an opinion about how your whole domain should be structured.

This library is the opposite bet. It is a **mechanism**: a small set of primitives that record facts and derive state, and then get out of your way.

- **It owns** events (with right-to-forget stripping), the aggregate, the projection builder, and — in a separate, optional layer — a self-healing repository over swappable storage.
- **It does not own your business rules.** There is no command/decider/validation layer. The aggregate enforces _no_ invariants and cannot reject an event for being "not allowed." Instead, you get a superpower: **stage** an event without committing, ask the library _"what would the state be if this were real?"_, and judge the answer in your own code.

```ts
cart.events.add(CheckedOut.create({}).creator("user", "ada")); // staged, NOT committed
const preview = CartSummary.build(cart); // fold including the staged event

if (preview.lineCount === 0) {
  // YOUR rule. The library has no idea what "empty cart" means. Reject; never commit.
}
```

The library answers _"what would the state be?"_ Your app answers _"is this allowed?"_ The framework never gets between you and your domain. ([See it in full →](/examples/shopping-cart))

### The deliberate stances

These distinguish the library, and each is a _choice_, not an omission:

- **No storage opinion in the core.** The core has zero storage dependencies — it never reaches a database. Persistence is a separate package, behind one interface, with Postgres / Mongo / S3 reference adapters or your own. ([Storage adapters →](/guide/storage-adapters))
- **Type-safe versioning, no migration engine.** Evolve a payload with a declared `.version()` + `.upcast()`; old events lift to the latest shape at read, nothing is rewritten on disk, and the compiler forces every mapper when a shape changes. The mechanism-not-framework take on upcasting — opt-in per event, no version field to parse. ([Why →](/faq#how-do-i-version-events-when-the-payload-changes))
- **Right-to-forget is built in.** Immutable history and GDPR erasure, reconciled by in-place stripping — and observability is metadata-only _by type_, so it can't leak the PII back out. ([Right-to-forget →](/guide/right-to-forget))
- **The only errors it raises are mechanical** — a bad schema, a malformed mapper, a topic collision, a lost concurrency race. It will never say "insufficient funds." That sentence is yours to write.

## 🍬 The payoffs, concretely

- **A real audit trail, for free.** The events _are_ the history. No separate log to maintain.
- **New read models without migrations.** Need a different view? Write a projection and `build()`. The data's already there.
- **Business validation without a framework.** The staged-preview trick gives you full control with zero ceremony. ([Order example: "can't ship unpaid" →](/examples/order-fulfillment))
- **Many views from one stream.** One aggregate can power a summary _and_ an access-control list _and_ a search row. ([Document example →](/examples/document-lifecycle))
- **Self-healing reads.** Stored projections stay current on a single cheap head read; the cheapest correct path is always taken. ([Postgres example →](/examples/self-healing-postgres))

## 😅 Okay, what's the catch?

Honesty buys trust, so here's the bill:

- **You store more data.** Every change is a retained fact. Disk is cheap; the trade is deliberate.
- **There's a mental-model shift.** Thinking in events instead of rows is new for most teams. That's normal — the [Concepts page](/concepts) is built to get you there, and the [examples](/examples) make it concrete.
- **The S3 adapter has real costs.** Single-object-per-aggregate means unbounded object growth and no cheap deltas — a structural trade for atomic reads. Postgres/Mongo don't have this. ([FAQ →](/faq#what-s-the-performance-and-storage-cost))
- **Old versions live in your upcast chain.** You can't drop a version while events written at it still exist — the chain has to keep lifting them forward, and each evolution costs a small upcaster (the compiler makes you write it). The upside: projections only ever see the latest shape, with no migration engine to fight.

## 🚦 When _not_ to use it

If you only ever need the latest value and will never ask "how did it get this way?", reach for a row in a table — it's simpler, and we'd rather you used it. Event sourcing earns its place when you need the **timeline**, **retroactive read models**, or a **hard audit trail**. The [FAQ has the decision checklist](/faq#do-i-actually-need-event-sourcing).

::: tip Can I adopt it incrementally?
Yes. Scenarios 1 and 3 are **core only** — no database, no repository. You can fold events you already hold into a read model today, in one corner of your app, and add the persistence layer later if and when you want stored, self-healing projections. Nothing is all-or-nothing.
:::

## ➡️ Next

- [Getting started](/guide/getting-started) — install and build your first projection.
- [The mental model](/concepts) — the three nouns, in depth.
- [Examples](/examples) — pick the domain that looks like yours and steal it.
