// Repository proof: the write path (create/load/commit + optimistic concurrency) and the
// three-outcome self-healing rebuild (no-stored / current / stale) plus the corruption
// guard. Runs the real repository over the in-memory StorageI double.
import { describe, it, expect } from "vitest";
import { object, number, string } from "zod";
import { event, aggregate, projection } from "@hilaryosborne/sourcing";
import { repository } from "../repository/repository";
import { RepositoryErrors } from "../repository/repository.errors";
import { StorageErrors } from "../storage/storage.errors";
import { memoryStorage } from "./memory-storage";

const Opened = event("counter.opened.v1");
Opened.version(1, object({ name: string().min(1) }));
const Incremented = event("counter.incremented.v1");
Incremented.version(1, object({ by: number().int().positive() }));

const Counter = aggregate("counter.v1");
Counter.register(Opened);
Counter.register(Incremented);

const Total = projection("projection.total.v1", object({ name: string(), total: number() }));
Total.aggregate(Counter);
Total.handle<{ name: string }>(Opened, (current, event) => ({ ...current, name: event.payload.name, total: 0 }));
Total.handle<{ by: number }>(Incremented, (current, event) => ({
  ...current,
  total: current.total + event.payload.by,
}));

const stream = (id: string) => ({ id, name: "counter.v1" });

// A committed counter at positions 0 (opened) and 1 (+5).
const seeded = async () => {
  const storage = memoryStorage();
  const repo = repository({ storage });
  const counter = await repo.create(Counter);
  counter.events.add(Opened.create({ name: "hits" }).creator("system", "seed"));
  counter.events.add(Incremented.create({ by: 5 }).creator("system", "seed"));
  await repo.commit(counter);
  return { storage, repo, id: counter.id };
};

describe("repository — write path", () => {
  it("create mints an id; commit persists; load rehydrates the committed history", async () => {
    const { repo, id } = await seeded();
    expect(id).toMatch(/.+/);
    const loaded = await repo.load(Counter, id);
    expect(loaded.events.committed).toHaveLength(2);
    expect(loaded.position).toBe(1);
  });

  it("commit is a no-op when nothing is staged", async () => {
    const storage = memoryStorage();
    const repo = repository({ storage });
    const counter = await repo.create(Counter);
    await repo.commit(counter);
    expect(await storage.head(stream(counter.id))).toBeUndefined();
  });

  it("a stale append (two writers, same loaded head) → VERSION_CONFLICT", async () => {
    const { repo, id } = await seeded(); // head 1
    const a = await repo.load(Counter, id);
    const b = await repo.load(Counter, id); // both loaded at head 1
    a.events.add(Incremented.create({ by: 1 }).creator("system", "a"));
    b.events.add(Incremented.create({ by: 2 }).creator("system", "b"));
    await repo.commit(a); // head → 2
    await expect(repo.commit(b)).rejects.toThrow(StorageErrors.VERSION_CONFLICT);
  });
});

describe("repository — self-healing rebuild", () => {
  it("NO-STORED → full build from the first event", async () => {
    const { repo, id } = await seeded();
    expect(await repo.rebuild({ aggregate: Counter, id, projection: Total })).toEqual({ name: "hits", total: 5 });
  });

  it("CURRENT → returns the stored state unchanged (no new events)", async () => {
    const { repo, id } = await seeded();
    await repo.rebuild({ aggregate: Counter, id, projection: Total }); // build + cache at head 1
    expect(await repo.rebuild({ aggregate: Counter, id, projection: Total })).toEqual({ name: "hits", total: 5 });
  });

  it("STALE → folds ONLY the delta over the STORED state (seeded fold, not full replay)", async () => {
    const { storage, repo, id } = await seeded();
    await repo.rebuild({ aggregate: Counter, id, projection: Total }); // bookmark 1, total 5
    // Tamper the stored state: a full replay would ignore it (→ 8); a seeded delta fold uses
    // it (→ 100 + 3 = 103). Asserting 103 proves only the delta was folded, over the seed.
    await storage.saveProjection({
      aggregate: stream(id),
      name: "projection.total.v1",
      position: 1,
      state: { name: "hits", total: 100 },
    });
    const counter = await repo.load(Counter, id);
    counter.events.add(Incremented.create({ by: 3 }).creator("system", "seed"));
    await repo.commit(counter); // head → 2
    expect(await repo.rebuild({ aggregate: Counter, id, projection: Total })).toEqual({ name: "hits", total: 103 });
  });

  it("CORRUPTION (bookmark past head) throws — not one of the three outcomes", async () => {
    const { storage, repo, id } = await seeded(); // head 1
    await storage.saveProjection({
      aggregate: stream(id),
      name: "projection.total.v1",
      position: 99, // claims to have folded events that do not exist
      state: { name: "hits", total: 999 },
    });
    await expect(repo.rebuild({ aggregate: Counter, id, projection: Total })).rejects.toThrow(
      RepositoryErrors.PROJECTION_AHEAD_OF_HEAD,
    );
  });
});
