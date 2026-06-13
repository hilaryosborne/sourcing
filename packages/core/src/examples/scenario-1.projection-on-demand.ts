// Worked example — Scenario 1: projections on demand (FOUNDATION.md). The purest use
// of the library: events live only in memory, the projection is folded out of them on
// the spot, nothing is stored. No persistence package, no cook, no fridge — just the
// bowl and a pure builder. This file is built entirely from the public API.
import { event, aggregate, projection } from "../index";
import { object, string, number } from "zod";
import type { z } from "zod";

// 1. Define atomic events — one fact each (style §2). The payload schema lives with
//    the event; the topic, the symbol, and (in a real tree) the filename agree.
const AccountOpenedV1 = event("account.opened.v1", object({ holder: string().min(1) }));
const MoneyDepositedV1 = event("account.deposited.v1", object({ amount: number().int().positive() }));
const MoneyWithdrawnV1 = event("account.withdrawn.v1", object({ amount: number().int().positive() }));

// 2. Declare the aggregate — the bowl, and the events legal on it.
const AccountAggregate = aggregate("account", [AccountOpenedV1, MoneyDepositedV1, MoneyWithdrawnV1]);

// 3. Declare the read-model and the pure reducers that fold events into it.
const AccountBalanceV1 = object({ holder: string(), balance: number().int(), entries: number().int().min(0) });
type AccountBalanceV1Type = z.infer<typeof AccountBalanceV1>;

const AccountBalanceProjection = projection({
  schema: AccountBalanceV1,
  initial: { holder: "", balance: 0, entries: 0 },
  handlers: [
    {
      topic: "account.opened.v1",
      apply: (current, event) => ({
        ...current,
        holder: (event.payload as { holder: string }).holder,
        entries: current.entries + 1,
      }),
    },
    {
      topic: "account.deposited.v1",
      apply: (current, event) => ({
        ...current,
        balance: current.balance + (event.payload as { amount: number }).amount,
        entries: current.entries + 1,
      }),
    },
    {
      topic: "account.withdrawn.v1",
      apply: (current, event) => ({
        ...current,
        balance: current.balance - (event.payload as { amount: number }).amount,
        entries: current.entries + 1,
      }),
    },
  ],
});

const creator = { entity: "user", uid: "demo" } as const;

// The story, top to bottom: open a bowl, stage facts (each validated as it lands),
// then fold the would-be state on demand. The consumer — not the library — decides
// what the numbers mean (e.g. whether a withdrawal overdraws). Mechanism, not judgment.
export const run = (): AccountBalanceV1Type => {
  const account = AccountAggregate.instance("acct-001");
  account.add(AccountOpenedV1).by(creator).message({ holder: "Ada" });
  account.add(MoneyDepositedV1).by(creator).message({ amount: 100 });
  account.add(MoneyWithdrawnV1).by(creator).message({ amount: 30 });
  return AccountBalanceProjection.build(account.get.events());
};
