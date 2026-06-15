# The three scenarios

The same aggregate and projection builder serve every scenario. Only **who fills the aggregate** changes — and the library can't tell the difference, which is the whole point.

## Scenario 1 — projections on demand

Fold events you already hold into a read model and return it. Nothing is stored. This needs **core only** — no database, no repository.

```ts
const account = Account.instance();
account.events.add(AccountOpened.create({ holder: "Ada" }).creator("user", "ada"));
account.events.add(Deposited.create({ amount: 100 }).creator("user", "ada"));
account.events.commit();

Balance.build(account); // → { holder: "Ada", balance: 100 }
```

This is the purest use of the library: a source of events plus the projection builder.

## Scenario 2 — staged validation (business rules in your code)

Stage an event _without committing_, build the would-be projection, and judge it yourself. This is the committed/staged split doing its job — the library previews, your app decides. Still **core only**.

```ts
account.events.add(Withdrawn.create({ amount: 250 }).creator("user", "ada")); // staged, NOT committed

const wouldBe = Balance.build(account); // folds committed ++ staged → balance -150
if (wouldBe.balance < 0) {
  // your overdraw rule — the library has no opinion. Reject; never commit; the staged event evaporates.
} else {
  account.events.commit();
}
```

There is no decider, no command bus, no rule engine to configure. The overdraw rule lives in an `if` statement in your code, exactly where you can read it. The library answers _"what would the state be?"_; your app answers _"is this allowed?"_.

## Scenario 3 — persisted, self-healing projections

Bring in the repository and an adapter. Write through `commit`, read through `rebuild` — which keeps the stored projection current without you tracking what's stale.

```ts
import { repository } from "@hilaryosborne/sourcing-persistence";
import { postgresStorage } from "@hilaryosborne/sourcing-adapter-postgres";

const storage = await postgresStorage(pgClient, { events: "account_events", projections: "account_projections" });
const repo = repository({ storage });

const opening = await repo.create(Account);
opening.events.add(AccountOpened.create({ holder: "Ada" }).creator("user", "ada"));
await repo.commit(opening); // append staged events, advance the head

const balance = await repo.rebuild({ aggregate: Account, id: opening.id, projection: Balance });
```

`rebuild` makes **one cheap head read** and takes the cheapest correct path:

| Stored projection vs. stream head | What happens                                                  |
| --------------------------------- | ------------------------------------------------------------- |
| **none**                          | read the full stream, build from scratch, save                |
| **head > bookmark** (stale)       | read **only the delta**, fold it over the stored state, save  |
| **head == bookmark** (current)    | return the stored state — **no event fetch** (the cheap path) |

Because projections are pure folds, they hold no independent truth: bin them and rebuild any time. That property is also what makes [right-to-forget](/guide/right-to-forget) tractable.

The `pgClient` is a thin adapter over the `pg` driver — see [Storage adapters](/guide/storage-adapters) for the exact wiring for Postgres, Mongo, and S3.
