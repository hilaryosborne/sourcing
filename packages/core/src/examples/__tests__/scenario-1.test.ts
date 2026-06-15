// Proof for Scenario 1: the worked example projects the expected balance end-to-end, in
// memory, with no persistence — and the staged/committed split lets a would-be state be
// previewed before committing (the Scenario 3 overlay on the same builder).
import { describe, it, expect } from "vitest";
import {
  Account,
  Balance,
  AccountOpenedV1,
  AccountDepositedV1,
  AccountWithdrawnV1,
  projectBalance,
} from "../scenario-1.projection-on-demand";

describe("Scenario 1 — projections on demand", () => {
  it("projects the balance end-to-end, in memory", () => {
    expect(projectBalance()).toEqual({ holder: "Ada", balance: 70 });
  });

  it("previews a would-be state from staged events without committing (Scenario 3 overlay)", () => {
    const account = Account.instance();
    account.events.add(AccountOpenedV1.create({ holder: "Ada" }).creator("user", "ada"));
    account.events.add(AccountDepositedV1.create({ amount: 100 }).creator("user", "ada"));
    account.events.commit(); // balance now 100, durable

    // Stage a withdrawal that would overdraw — preview, do NOT commit.
    account.events.add(AccountWithdrawnV1.create({ amount: 250 }).creator("user", "ada"));
    const wouldBe = Balance.build(account);
    expect(wouldBe.balance).toBe(-150); // the library answers "what would the state be?"
    // The app's job is to reject it; the staged event is never committed.
    expect(account.events.staged).toHaveLength(1);
  });
});
