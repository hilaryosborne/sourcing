// Scenario 1 — Projections on demand (FOUNDATION §Scenario 1). The purest use of the
// library: define events, an aggregate, and a projection; fill the aggregate in memory;
// fold a read-model. No persistence package, no storage — just core. This file is a
// runnable worked example; its test asserts the end-to-end result.
import { object, string, number } from "zod";
import event from "../event/event";
import aggregate from "../aggregate/aggregate";
import projection from "../projection/projection";

// --- Domain: a bank account (deposits add, withdrawals subtract) ---
export const AccountOpenedV1 = event("account.opened.v1", object({ holder: string().min(1) }));
export const AccountDepositedV1 = event("account.deposited.v1", object({ amount: number().int().positive() }));
export const AccountWithdrawnV1 = event("account.withdrawn.v1", object({ amount: number().int().positive() }));

export const Account = aggregate("account.v1");
Account.register(AccountOpenedV1);
Account.register(AccountDepositedV1);
Account.register(AccountWithdrawnV1);

export const BalanceV1 = object({ holder: string(), balance: number() });
export const Balance = projection("projection.balance.v1", BalanceV1);
Balance.aggregate(Account);
Balance.handle(AccountOpenedV1, (current, event) => ({ ...current, holder: event.payload.holder, balance: 0 }));
Balance.handle(AccountDepositedV1, (current, event) => ({
  ...current,
  balance: current.balance + event.payload.amount,
}));
Balance.handle(AccountWithdrawnV1, (current, event) => ({
  ...current,
  balance: current.balance - event.payload.amount,
}));

// Open an account, deposit, withdraw — then project the balance, all in memory.
export const projectBalance = () => {
  const account = Account.instance(); // core mints the id
  account.events.add(AccountOpenedV1.create({ holder: "Ada" }).creator("user", "ada"));
  account.events.add(AccountDepositedV1.create({ amount: 100 }).creator("user", "ada"));
  account.events.add(AccountWithdrawnV1.create({ amount: 30 }).creator("user", "ada"));
  return Balance.build(account);
};
