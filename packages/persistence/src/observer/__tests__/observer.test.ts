// Observer proof: the three channels fire with the right shapes over the real repository +
// in-memory StorageI; profiling durations land; the self-healing path is reported; failures
// reach report() and still throw; and — the load-bearing safety guarantee — an observer that
// throws or rejects can never break or slow a storage operation. Metadata-only is checked too:
// no event payload ever reaches the seam.
import { describe, it, expect, vi } from "vitest";
import { object, number, string } from "zod";
import { event, aggregate, projection } from "@hilaryosborne/sourcing";
import { repository } from "../../repository/repository";
import { StorageErrors } from "../../storage/storage.errors";
import { memoryStorage } from "../../__tests__/memory-storage";
import { consoleObserver } from "../observer.console";
import type { ErrorReport, HookEvent, Observer } from "../observer.interface";

const Opened = event("account.opened.v1").version(object({ holder: string().min(1) }));
const Deposited = event("account.deposited.v1").version(object({ amount: number().int().positive() }));
Opened.strip("gdpr", (payload) => ({ ...payload, holder: "[redacted]" }));

const Account = aggregate("account.v1");
Account.register(Opened);
Account.register(Deposited);

const Balance = projection("projection.balance.v1", object({ holder: string(), total: number() }));
Balance.aggregate(Account);
Balance.handle(Opened, (current, e) => ({ ...current, holder: e.payload.holder, total: 0 }));
Balance.handle(Deposited, (current, e) => ({ ...current, total: current.total + e.payload.amount }));

// A capturing observer: records every emission across all three channels.
const capture = () => {
  const hooks: HookEvent[] = [];
  const logs: { level: string; event: string; data?: Record<string, unknown> }[] = [];
  const reports: ErrorReport[] = [];
  const observer: Observer = {
    logger: {
      error: (event, data) => void logs.push({ level: "error", event, data }),
      warn: (event, data) => void logs.push({ level: "warn", event, data }),
      info: (event, data) => void logs.push({ level: "info", event, data }),
      debug: (event, data) => void logs.push({ level: "debug", event, data }),
    },
    report: (r) => void reports.push(r),
    hook: (e) => void hooks.push(e),
  };
  return { observer, hooks, logs, reports };
};

const seed = async (observer?: Observer) => {
  const storage = memoryStorage();
  const repo = repository({ storage, observer });
  const account = await repo.create(Account);
  account.events.add(Opened.create({ holder: "Ada" }).creator("user", "ada"));
  account.events.add(Deposited.create({ amount: 100 }).creator("user", "ada"));
  await repo.commit(account);
  return { storage, repo, id: account.id };
};

const successes = (hooks: HookEvent[], op: string) => hooks.filter((h) => h.op === op && h.phase === "success");

describe("observer — channels and shapes", () => {
  it("commit emits a commit success hook AND a nested append success hook with the event count", async () => {
    const { observer, hooks } = capture();
    await seed(observer);

    expect(successes(hooks, "commit")).toHaveLength(1);
    const append = successes(hooks, "append");
    expect(append).toHaveLength(1);
    expect(append[0]).toMatchObject({ phase: "success", data: { count: 2 } });
  });

  it("every success hook carries a numeric durationMs (the profiling signal)", async () => {
    const { observer, hooks } = capture();
    await seed(observer);
    const settled = hooks.filter((h) => h.phase === "success");
    expect(settled.length).toBeGreaterThan(0);
    for (const h of settled) {
      expect(typeof (h as { durationMs: number }).durationMs).toBe("number");
      expect((h as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("rebuild reports its self-healing path as a progress hook (no_stored, then current)", async () => {
    const { observer, hooks } = capture();
    const { repo, id } = await seed(observer);

    await repo.rebuild({ aggregate: Account, id, projection: Balance }); // builds → no_stored
    await repo.rebuild({ aggregate: Account, id, projection: Balance }); // cached → current

    const paths = hooks
      .filter((h) => h.op === "rebuild" && h.phase === "progress")
      .map((h) => (h as { step: string }).step);
    expect(paths).toEqual(["no_stored", "current"]);
  });

  it("forget emits its four stages in order as progress hooks", async () => {
    const { observer, hooks } = capture();
    const { repo, id } = await seed(observer);
    await repo.forget({ aggregate: Account, id, context: "gdpr" });
    const stages = hooks
      .filter((h) => h.op === "forget" && h.phase === "progress")
      .map((h) => (h as { step: string }).step);
    expect(stages).toEqual(["loaded", "stripped", "overwritten", "binned"]);
  });

  it("NEVER carries an event payload — only metadata reaches the seam", async () => {
    const { observer, hooks, logs } = capture();
    await seed(observer);
    const blob = JSON.stringify({ hooks, logs });
    expect(blob).not.toContain("Ada"); // the holder PII never leaks into observability
  });
});

describe("observer — error reporting", () => {
  it("a VERSION_CONFLICT reaches report() with the error and code, and still throws", async () => {
    const { observer, reports, hooks } = capture();
    const { repo, id } = await seed(observer); // head 1

    // Two writers loaded at the same head; the second commit loses the race.
    const a = await repo.load(Account, id);
    const b = await repo.load(Account, id);
    a.events.add(Deposited.create({ amount: 1 }).creator("user", "ada"));
    b.events.add(Deposited.create({ amount: 2 }).creator("user", "ada"));
    await repo.commit(a);

    await expect(repo.commit(b)).rejects.toThrow(StorageErrors.VERSION_CONFLICT);

    const conflict = reports.filter((r) => r.code === StorageErrors.VERSION_CONFLICT);
    expect(conflict.length).toBeGreaterThan(0);
    expect(conflict[0]!.error).toBeInstanceOf(Error);
    expect(hooks.some((h) => h.phase === "failure" && h.error === StorageErrors.VERSION_CONFLICT)).toBe(true);
  });
});

describe("observer — safety (async, never breaks the operation)", () => {
  it("an observer whose hook REJECTS asynchronously does not break the commit", async () => {
    const rejecting: Observer = { hook: () => Promise.reject(new Error("sink is down")) };
    const storage = memoryStorage();
    const repo = repository({ storage, observer: rejecting });
    const account = await repo.create(Account);
    account.events.add(Opened.create({ holder: "Ada" }).creator("user", "ada"));
    await expect(repo.commit(account)).resolves.toBeDefined();
    expect(await storage.head({ id: account.id, name: "account.v1" })).toBe(0);
  });

  it("an observer whose hook THROWS synchronously does not break the commit", async () => {
    const throwing: Observer = {
      hook: () => {
        throw new Error("sink threw");
      },
    };
    const storage = memoryStorage();
    const repo = repository({ storage, observer: throwing });
    const account = await repo.create(Account);
    account.events.add(Opened.create({ holder: "Ada" }).creator("user", "ada"));
    await expect(repo.commit(account)).resolves.toBeDefined();
    expect(await storage.head({ id: account.id, name: "account.v1" })).toBe(0);
  });
});

describe("consoleObserver", () => {
  it("is quiet at the default level — failure beats print, debug beats do not", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const observer = consoleObserver(); // default level "info"
    observer.logger!.debug("SOURCING_COMMIT", { stream: "x" });
    observer.logger!.error("SOURCING_COMMIT_FAIL", { stream: "x" });
    expect(debug).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("SOURCING_COMMIT_FAIL", { stream: "x" });
    debug.mockRestore();
    error.mockRestore();
  });

  it("at level debug, prints the lifecycle beats too", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const observer = consoleObserver({ level: "debug" });
    observer.logger!.debug("SOURCING_COMMIT", { stream: "x" });
    expect(debug).toHaveBeenCalledWith("SOURCING_COMMIT", { stream: "x" });
    debug.mockRestore();
  });
});
