# Why this exists

Most applications store the _current_ state of a thing: one row per account, overwritten on every change. That row is lossy by construction — the moment a balance goes from 100 to 70, _why_ it changed is gone. Event sourcing inverts that: you store the **sequence of facts** that happened (`opened`, `deposited 100`, `withdrew 30`) and treat current state as a _fold_ over those facts. Nothing is overwritten; the history _is_ the database. You get a perfect audit trail, the ability to derive new read models retroactively from data you already have, and time-travel debugging for free.

The catch is that event sourcing libraries tend to do **too much**. They ship a "decider" or command-handler layer that wants to own your business rules; they bake in an event store; they carry upcaster machinery for versioning. You adopt the pattern and inherit a framework.

This library is the opposite bet. It is **mechanism, not judgment** — a deliberately small set of primitives:

- **It owns** events (with right-to-forget stripping), the aggregate (a container that keeps committed history apart from staged proposals), the projection builder, and — in a separate optional layer — a self-healing repository over swappable storage.
- **It does not own** your business rules. There is no command/decider/validation layer. The aggregate enforces _no_ invariants and cannot reject an event for being "not allowed." You stage an event, ask the library _"what would the state be if this were real?"_, and judge the answer in your own code. The library never learns what your rule was.
- **It has no opinion on storage.** The core has zero storage dependencies — it never reaches a database. Persistence is a separate package you add only when you want it, behind one interface with three reference adapters (Postgres, Mongo, S3) or your own.
- **The only errors it raises are mechanical** — a payload that fails its schema, a malformed projection mapper, a topic collision, a lost optimistic-concurrency race. It will never say "insufficient funds." That sentence is yours to write.

A few deliberate stances distinguish it (each explained in the [FAQ](/faq)): **versioning is a naming convention, not a feature** (`file.create.v1` is an opaque string — no upcasters, no migration engine); **right-to-forget is built in** via in-place stripping; and **the committed/staged split** is what lets you do business validation without the library ever knowing what validation is.

::: warning When you should _not_ reach for this
If you only ever need the latest state and will never ask "how did it get this way?", event sourcing is overhead you don't need — use a row in a table. See [Do I actually need event sourcing?](/faq#do-i-actually-need-event-sourcing) before adopting.
:::

## Next

- [Getting started](/guide/getting-started) — install and build your first projection.
- [The mental model](/concepts) — the three nouns the whole library falls out of.
- [The three scenarios](/guide/scenarios) — the shapes you'll actually build.
