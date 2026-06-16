# 🧪 Examples

Talk is cheap. Here are complete, copy-pasteable builds — each one a real domain, modelled end to end. Every snippet uses the real API; steal whichever is closest to your problem and go.

## Start here

| Example                                                        | What it teaches                  | One-liner                                                                             |
| -------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------- |
| [🛒 Shopping cart](/examples/shopping-cart)                    | **Staged validation**            | Preview a checkout, reject it in _your_ code — the library never knows your rule.     |
| [📦 Order fulfillment](/examples/order-fulfillment)            | **Lifecycles & audit trail**     | A stream models a process over time; guard "can't ship unpaid" with a staged preview. |
| [📄 Document lifecycle](/examples/document-lifecycle)          | **Many read models, one stream** | Fold the same events into a file summary _and_ a live access-control list.            |
| [🗑️ Right-to-forget](/examples/gdpr-erasure)                   | **GDPR erasure**                 | Immutable history _and_ delete-my-data, reconciled — with proof no PII survives.      |
| [🐘 Self-healing on Postgres](/examples/self-healing-postgres) | **Production storage**           | Persist, self-heal projections, handle conflicts, and wire up observability.          |

## Which one looks like your problem?

- **Evaluating the idea?** [🛒 Shopping cart](/examples/shopping-cart) — the whole philosophy in ~30 lines.
- **Modelling something stateful?** [📦 Order fulfillment](/examples/order-fulfillment) — a lifecycle with a real guard.
- **Need several views, or GDPR?** [📄 Document lifecycle](/examples/document-lifecycle) and [🗑️ Right-to-forget](/examples/gdpr-erasure).
- **Going to production?** [🐘 Self-healing on Postgres](/examples/self-healing-postgres) — retries, concurrency, observability.

## How to read these

Each example grows **one snippet at a time** — define events → register an aggregate → fold a projection → reach the payoff. No fragments, no "left as an exercise." If a block compiles in your head, it compiles in your editor.

::: tip New to the pattern?
Read [**Why event sourcing?**](/guide/what-is-sourcing) first for the mental model, or jump straight into [**Getting started**](/guide/getting-started) for the 60-second version. Then come back here and pick the domain that looks like yours.
:::

Missing an example you'd find useful? [Open an issue](https://github.com/hilaryosborne/sourcing/issues) — we'd rather add the one you need than guess.
