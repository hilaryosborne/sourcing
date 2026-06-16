# 🧪 Testing events, aggregates & projections

The library is built to be testable: the core is **pure** (no clock, no IO, no randomness in the parts you write), so most of it tests with plain assertions and no mocks. This recipe shows how to prove each piece. Examples use [Vitest](https://vitest.dev), but any runner works.

## What needs mocking (almost nothing)

- **Events, aggregates, projections, upcasters, strippers** — pure. Construct them, exercise them, assert. No mocks.
- **The repository** — test it over the [in-memory adapter](/guide/write-own-adapter#a-complete-in-memory-adapter), not a real database. It's a faithful `StorageI`, conflicts and all.
- **A storage adapter** — don't unit-test it; run the [conformance suite](#testing-an-adapter) against the real service.

## Events: creation validates, strippers redact

```ts
import { describe, it, expect } from "vitest";
import { EventErrors } from "@hilaryosborne/sourcing";
import { AccountOpened } from "./events";

describe("AccountOpened", () => {
  it("validates the payload at create()", () => {
    expect(() => AccountOpened.create({ holder: "" })).toThrow(EventErrors.PAYLOAD_INVALID);
  });

  it("redacts PII with the gdpr stripper", () => {
    const stripped = AccountOpened.create({ holder: "Ada" }).creator("user", "ada").strip("gdpr");
    expect(stripped.get.payload()).toEqual({ holder: "[redacted]" });
  });
});
```

## Aggregates: the committed/staged split

Stage events, assert the split, then commit and assert it folds:

```ts
import { AggregateErrors } from "@hilaryosborne/sourcing";

it("stages an event without committing it", () => {
  const account = Account.instance("acc-1");
  account.events.add(AccountOpened.create({ holder: "Ada" }).creator("user", "ada"));
  expect(account.events.staged).toHaveLength(1);
  expect(account.events.committed).toHaveLength(0);

  account.events.commit();
  expect(account.events.staged).toHaveLength(0);
  expect(account.events.committed).toHaveLength(1);
});

it("refuses an event with no creator", () => {
  const account = Account.instance("acc-1");
  expect(() => account.events.add(AccountOpened.create({ holder: "Ada" }))).toThrow(AggregateErrors.MISSING_CREATOR);
});
```

## Projections: the full fold, the delta fold, and the contract

The three tests worth writing for every projection — full build, resume-from-state (the self-healing stale path), and the first-event contract:

```ts
import { ProjectionErrors } from "@hilaryosborne/sourcing";

it("folds the full stream", () => {
  const account = Account.instance("acc-1");
  account.events.add(AccountOpened.create({ holder: "Ada" }).creator("user", "ada"));
  account.events.add(Deposited.create({ amount: 100 }).creator("user", "ada"));
  expect(Balance.build(account)).toEqual({ holder: "Ada", balance: 100 });
});

it("resumes from a prior state (the delta path)", () => {
  const delta = Account.instance("acc-1");
  delta.events.add(Deposited.create({ amount: 50 }).creator("user", "ada"));
  // only the delta is in the aggregate; the stored state is supplied as `from`
  expect(Balance.build(delta, { holder: "Ada", balance: 100 })).toEqual({ holder: "Ada", balance: 150 });
});

it("throws OUTPUT_INVALID when the first event doesn't establish the shape", () => {
  const account = Account.instance("acc-1");
  account.events.add(Deposited.create({ amount: 50 }).creator("user", "ada")); // no creating event first
  expect(() => Balance.build(account)).toThrow(ProjectionErrors.OUTPUT_INVALID);
});
```

## Upcasters: fold a mixed-version stream

The highest-value versioning test imports old-ordinal envelopes and asserts every event arrives at head shape ([Versioning →](/guide/versioning#testing-your-upcasters)):

```ts
it("lifts a v1 event to the head shape on read", () => {
  const account = Account.instance("acc-1");
  account.events.import([storedV1Envelope]); // written at version 1
  expect(Profile.build(account).countryCode).toBe("ZZ"); // v1 → v2 → v3 ran on read
});
```

## Business rules: test the judgement, not the library

Your validation is a plain function over the projected state — so test _it_, directly, with no framework:

```ts
const canCheckout = (cart: CartSummary) => cart.lineCount > 0;

it("rejects an empty checkout", () => {
  expect(canCheckout({ lineCount: 0 })).toBe(false);
});
```

That's the whole point of [mechanism, not judgment](/guide/what-is-sourcing#mechanism-not-judgment): the rule lives in your code, testable on its own.

## The repository: over the in-memory adapter

```ts
import { repository } from "@hilaryosborne/sourcing-persistence";
import { memoryStorage } from "./memory-storage"; // from "Write your own adapter"

it("self-heals a stored projection to current", async () => {
  const repo = repository({ storage: memoryStorage() });
  const opening = await repo.create(Account);
  opening.events.add(AccountOpened.create({ holder: "Ada" }).creator("user", "ada"));
  await repo.commit(opening);
  expect(await repo.rebuild({ aggregate: Account, id: opening.id, projection: Balance })).toEqual({
    holder: "Ada",
    balance: 0,
  });
});
```

## Testing an adapter

Don't hand-roll adapter assertions — run the shared [conformance suite](/reference/api-persistence#conformance) against the real service (via Docker, [as the library does](/guide/installation#local-databases-for-development)):

```ts
import { runConformance } from "@hilaryosborne/sourcing-persistence";

runConformance(async () => postgresStorage(pgClientForFreshSchema()));
```

## ➡️ Next

- [Write your own storage adapter](/guide/write-own-adapter) — the in-memory adapter these tests use.
- [Versioning & upcasters](/guide/versioning) — testing the upcast chain.
- [Projections](/guide/projections) — the first-event contract in depth.
