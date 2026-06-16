# 🧭 Roadmap

A roadmap is only useful if it's honest — so this one says what's **shipped**, what's **planned**, and, just as importantly, what's **deliberately never coming**. The last list is the most revealing: a library that won't say no to anything has no shape.

## Shipped today

| Capability                                                          | Where                                         |
| ------------------------------------------------------------------- | --------------------------------------------- |
| Events, aggregates, projections, strippers — the in-memory core     | [The builders](/guide/events)                 |
| Event versioning & upcasters (read-time, never rewritten)           | [Versioning →](/guide/versioning)             |
| The repository: write path, self-healing reads, right-to-forget     | [Repository →](/guide/repository)             |
| Postgres, Mongo, S3 reference adapters + a shared conformance suite | [Storage adapters →](/guide/storage-adapters) |
| Optional, async-safe, metadata-only observability                   | [Observability →](/guide/observability)       |
| Cross-stream read models — the fold, processor, and contracts       | [Read models →](/guide/read-models)           |
| This documentation site, AI skills, and `llms.txt`                  | [Skills →](/skills)                           |

The packages are **pre-1.0** (`0.0.0`) — the surface is shaped and tested, but the version number is honest that the first stable release hasn't been cut.

## On the horizon

Shaped by use, not promised by date:

- **A feed adapter for Postgres (and Mongo).** Cross-stream read models ship as a mechanism, but [no shipped adapter provides a `StorageFeedI` yet](/guide/read-models#the-pieces-you-wire) — a global, redaction-reflecting feed over a Postgres sequence (and a Mongo equivalent) is the most-wanted next piece, so the firehose becomes turnkey rather than bring-your-own.
- **A first tagged, published release.** Cutting `1.0` and publishing through [changesets](/project/contributing#proposing-a-change) once the surface has settled in real use.
- **More reference adapters** as the community needs them — the [conformance suite](/reference/api-persistence#conformance) makes adding one safe.

## Deliberately out of scope

These aren't missing features — they're decisions. Each is a place the library stops on purpose, so it stays mechanism, not framework:

- **A business-logic / command / decider layer.** That's the part you should own. The [staged-preview](/guide/use-cases#enforce-a-business-rule-without-a-rule-engine) gives you full control with no framework; a built-in decider would have to learn your domain, and then the library would be in your rules.
- **Transport & broadcasting.** No HTTP, no sockets, no message bus. Getting events _out_ of the system ("data on the outside") is a separate concern that lives in your app.
- **Cross-stream ordering on S3, or coordination across stores.** Global ordering stays an [optional feed capability](/guide/read-models#the-pieces-you-wire), never promised by the shared port — S3 can't offer it honestly. And the library [never coordinates a single operation across two destinations](/guide/destinations) (no distributed transactions in disguise).
- **On-disk migration / snapshotting that reintroduces a read seam.** Upcasting is read-time and never rewrites storage; the S3 adapter's [unbounded growth](/guide/adapter-s3#constraints-trade-offs-structural-by-design) is an accepted, documented trade, not a TODO.
- **Interpreting what a version _means_.** The library counts ordinals and runs your pure functions in order; version _semantics_ are yours.

If you need one of these, it belongs in your application or your adapter — and the library's job is to never silently pretend otherwise.

## Want to shape it?

The horizon is shaped by what people actually hit. [Open an issue](https://github.com/hilaryosborne/sourcing/issues) with your use case, or see [Contributing](/project/contributing).
