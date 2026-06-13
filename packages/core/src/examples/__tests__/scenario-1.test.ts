import { describe, it, expect } from "vitest";
import { run } from "../scenario-1.projection-on-demand";

// The runnable proof for Scenario 1: the worked example folds to the expected balance,
// end to end, in memory, with no persistence package involved.
describe("Scenario 1 — projections on demand", () => {
  it("should fold staged events into the expected read-model", () => {
    expect(run()).toEqual({ holder: "Ada", balance: 70, entries: 3 });
  });
});
