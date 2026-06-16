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

## 🗺️ Event sourcing is a field of opinions

Now the honest part — the part most libraries skip. **There is no one event sourcing.** The three ideas above are the entire pattern, but the moment you go to build with them you walk into thirty years of accumulated opinion about _how_, and most of it arrives welded together as though it were the pattern itself.

Lay the takes out on a spectrum:

- At one end, **append-and-fold.** Events are a way to store state. You write facts, you read them back as a projection, you stop there. Boring — in the way a good ORM is boring.
- At the other end, **event sourcing as an entire architecture.** Commands and deciders. Aggregates as consistency boundaries enforcing invariants. CQRS with separate read and write stores. Asynchronous projections riding a message bus. Sagas and process managers. Eventually-consistent read models. Event-driven microservices broadcasting to one another. A worldview, adopted wholesale.

Both call themselves "event sourcing." That conflation is the source of most of the confusion — and most of the bad first experiences. Someone reaches for the pattern to solve a _storage_ problem, and the ecosystem hands them an _architecture_. But the **storage pattern** (facts in, state out) and the **architecture** (how your whole system is shaped around those facts) are genuinely separable. Mistaking one for the other is how a small, sharp idea turns into a six-month migration.

So which one are we? We're opinionated about that — and the rest of this page is us being honest about our opinion, and the trade-offs that come with it.

## 🧰 Our take: it's an ORM, not an architecture

Here's the thesis the rest of the library falls out of: **we treat event sourcing the way you treat an ORM.**

An ORM has a narrow, honest job. It persists your objects to rows and reads them back as objects. It does _not_ tell you how to structure your domain, where to put your business rules, how to scale your reads, or how your services talk to each other. It is a _persistence mechanism_, and its restraint is exactly why you trust it with your data.

This library is that, but for events. Its whole ambition is one sentence:

> Persist a set of events to your data store, and fold them back into state when you read.

That's the entire pitch. No worldview attached. The events live in your Postgres / Mongo / S3 right next to everything else you keep — synchronous, in-process, **no message bus, no separate read database, no eventual consistency** unless _you_ go and build it. You aren't adopting event-driven architecture. You're choosing how a few of your tables remember their past.

This is a _position_, not a universal truth — and that distinction matters to us. If your problem genuinely is a distributed, high-throughput, read/write-asymmetric system, the full-architecture end of the spectrum exists for good reasons, and you should go there with our blessing. We've deliberately planted our flag at the boring end, because the boring end is where most applications actually live — and almost nobody building tools for them is honest about that.

Everything distinctive below is downstream of this one decision.

## 🤷 On CQRS (and why we shrug)

The objection writes itself: _you can't talk about event sourcing without CQRS._ So let's talk about it — honestly, because it deserves an honest answer rather than a dismissal.

**CQRS** — Command Query Responsibility Segregation — is the idea that the model you write through and the model you read through should be _different_ models: often different stores, often updated asynchronously. It pairs naturally with event sourcing — your events are the write model, your projections are the read model, and the two are free to drift apart in time.

Where it genuinely pays off: lopsided read/write ratios, read and write paths that must scale independently, many different read shapes over one write model, systems that can happily tolerate a read model running a few hundred milliseconds stale. These are real problems, and CQRS is a real answer to them.

Here's our nuance. We **do** separate the write model from the read model — events are written, projections are read, and a projection is unmistakably a query-side view. In that narrow sense the library is CQRS-flavoured and can't help being. What we **don't** do is _mandate_ the rest of it: no separate command stack, no asynchronous propagation, no message bus, no eventually-consistent read store you have to hold in your head. A projection is a synchronous fold you call when you want it; by default it is _exactly_ as fresh as the events you've written, because it's computed from them on the spot.

So we shrug — not because CQRS is wrong, but because the heavyweight version of it is a _scaling_ tool, and scaling is a problem you should _have_ before you buy the machinery for it. If you need full CQRS, this library sits underneath it perfectly happily: your events and projections are right there to build asynchronous read models on top of. We just won't make you take on that complexity to store a fact. **Opt in when you have the problem; don't pay for it before.**

::: tip There's a built-in escape hatch
If you genuinely need a view that spans aggregates, the library ships an opt-in [cross-stream read model](/guide/read-models) — the firehose, folded into one denormalised view. It's deliberately past the line this page draws, and clearly marked as such — but it's there when you reach for it.
:::

## 🎯 Mechanism, not judgment

The ORM stance has a sharp consequence, and it's the most important thing to understand before you write a line: **the library has no business logic, and refuses to grow any.**

Most event-sourcing tools ship a **framework**: a "decider" or command-handler layer that wants to own your rules, a baked-in event store, versioning buried in machinery that couples your read path to a migration history. Adopt the pattern, inherit an opinion about how your whole domain should be structured — the architecture end of the spectrum, smuggled in as a default.

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
- **Versioning, no migration engine.** Evolve a payload with a declared `.version(n, …)` + `.upcast()`; old events lift to the latest shape at read and nothing is rewritten on disk. The version rules are enforced as runtime mechanical errors when a shape changes. The mechanism-not-framework take on upcasting — opt-in per event; the only new stored field is the opaque version ordinal, which the library counts but never interprets. ([Why →](/faq#how-do-i-version-events-when-the-payload-changes))
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
- **Old versions live in your upcast chain.** You can't drop a version while events written at it still exist — the chain has to keep lifting them forward, and each evolution costs a small upcaster (a later version left without one throws `UPCAST_MISSING` at first use). The upside: projections only ever see the latest shape, with no migration engine to fight.

## 🚦 When _not_ to use it

If you only ever need the latest value and will never ask "how did it get this way?", reach for a row in a table — it's simpler, and we'd rather you used it. Event sourcing earns its place when you need the **timeline**, **retroactive read models**, or a **hard audit trail**. The [FAQ has the decision checklist](/faq#do-i-actually-need-event-sourcing).

::: tip Can I adopt it incrementally?
Yes. The in-memory paths are **core only** — no database, no repository. You can fold events you already hold into a read model today, in one corner of your app, and add the persistence layer later if and when you want stored, self-healing projections. Nothing is all-or-nothing.
:::

## ➡️ Next

- [Getting started](/guide/getting-started) — install and build your first projection.
- [The mental model](/concepts) — the three nouns, in depth.
- [Examples](/examples) — pick the domain that looks like yours and steal it.
