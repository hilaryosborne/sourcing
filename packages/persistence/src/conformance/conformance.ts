// The StorageI conformance suite — the shared, parameterized contract test every participant
// (the in-memory double + the real adapters) must pass. Derived from CONFORMANCE.md, which is
// derived from the StorageI contract + §3 — NOT generalized from any implementation.
//
// SPEC-NOT-NET: assertions never branch on adapter type and never reference the route (etag /
// 23505 / 11000, CTE / updateOne / putIfMatch). They assert only the contract FACT. The
// per-adapter difference lives entirely in `makeStorage` (the fixture), which yields a clean
// StorageI; the suite calls `await makeStorage()` for a fresh store per test.
import { describe, it, expect } from "vitest";
import type { EventEnvelopeV1Type } from "@hilaryosborne/sourcing";
import type { StorageI, StorageStream, StoredProjectionV1Type } from "../index";
import { StorageErrors } from "../index";

const STREAM_A: StorageStream = { id: "agg-a", name: "test.v1" };
const STREAM_B: StorageStream = { id: "agg-b", name: "test.v1" };

// A valid event envelope at a position. Payload defaults to something position-derived so
// round-trips are checkable; override it for the hostile-key cases.
const env = (stream: StorageStream, position: number, payload: unknown = { n: position }): EventEnvelopeV1Type => ({
  id: `${stream.id}-${position}`,
  topic: "test.event.v1",
  version: 0,
  position,
  aggregate: { id: stream.id, name: stream.name },
  creator: { entity: "system", uid: "conformance" },
  headers: {},
  created: "2026-01-01T00:00:00.000Z",
  payload,
});

const storedProjection = (
  stream: StorageStream,
  name: string,
  position: number,
  state: unknown,
): StoredProjectionV1Type => ({
  aggregate: { id: stream.id, name: stream.name },
  name,
  position,
  state,
});

// Append a fresh stream of `count` events (positions 0..count-1) and return the storage.
const seeded = async (makeStorage: () => Promise<StorageI>, count: number): Promise<StorageI> => {
  const storage = await makeStorage();
  if (count > 0) {
    const events = Array.from({ length: count }, (_, position) => env(STREAM_A, position));
    await storage.append(STREAM_A, events, undefined);
  }
  return storage;
};

const positions = (events: EventEnvelopeV1Type[]): number[] => events.map((event) => event.position);

export const runConformance = (makeStorage: () => Promise<StorageI>): void => {
  describe("StorageI conformance — head", () => {
    it("is undefined for a never-written stream", async () => {
      const storage = await makeStorage();
      expect(await storage.head(STREAM_A)).toBeUndefined();
    });

    it("is the highest stored position after appends", async () => {
      const storage = await seeded(makeStorage, 3);
      expect(await storage.head(STREAM_A)).toBe(2);
    });

    it("is unaffected by overwrite (in-place redaction does not move the head)", async () => {
      const storage = await seeded(makeStorage, 3);
      await storage.overwrite(STREAM_A, [env(STREAM_A, 1, { redacted: true })]);
      expect(await storage.head(STREAM_A)).toBe(2);
    });

    it("is unaffected by overwrite of the head position itself", async () => {
      const storage = await seeded(makeStorage, 3);
      await storage.overwrite(STREAM_A, [env(STREAM_A, 2, { redacted: true })]);
      expect(await storage.head(STREAM_A)).toBe(2);
    });
  });

  describe("StorageI conformance — read", () => {
    it("is [] for a never-written stream", async () => {
      const storage = await makeStorage();
      expect(await storage.read(STREAM_A)).toEqual([]);
    });

    it("returns the full stream in strict position order", async () => {
      const storage = await seeded(makeStorage, 4);
      expect(positions(await storage.read(STREAM_A))).toEqual([0, 1, 2, 3]);
    });

    it("returns only the delta (events with position > after)", async () => {
      const storage = await seeded(makeStorage, 4);
      expect(positions(await storage.read(STREAM_A, 1))).toEqual([2, 3]);
    });

    it("returns [] for a delta at the head (after === head)", async () => {
      const storage = await seeded(makeStorage, 3);
      expect(await storage.read(STREAM_A, 2)).toEqual([]);
    });

    it("round-trips an appended envelope equal", async () => {
      const storage = await makeStorage();
      const event = env(STREAM_A, 0, { nested: { a: 1 }, list: [1, "two", true] });
      await storage.append(STREAM_A, [event], undefined);
      expect(await storage.read(STREAM_A)).toEqual([event]);
    });
  });

  describe("StorageI conformance — append", () => {
    it("lands events; head advances; read returns them", async () => {
      const storage = await makeStorage();
      await storage.append(STREAM_A, [env(STREAM_A, 0), env(STREAM_A, 1)], undefined);
      expect(await storage.head(STREAM_A)).toBe(1);
      expect(positions(await storage.read(STREAM_A))).toEqual([0, 1]);
    });

    it("rejects with VERSION_CONFLICT when expectedHead does not match, and writes nothing", async () => {
      const storage = await seeded(makeStorage, 3); // head 2
      // ISOLATE the CAS: the event is contiguous to expectedHead (0 → position 1), so the
      // contiguity precondition PASSES and only the stale-head CAS can fire. An input that also
      // violated contiguity would depend on each adapter's check-order (a non-adapter-blind test).
      await expect(storage.append(STREAM_A, [env(STREAM_A, 1)], 0)).rejects.toThrow(StorageErrors.VERSION_CONFLICT);
      expect(await storage.head(STREAM_A)).toBe(2);
      expect(positions(await storage.read(STREAM_A))).toEqual([0, 1, 2]);
    });

    it("rejects a non-contiguous append with APPEND_NOT_CONTIGUOUS, and writes nothing", async () => {
      const storage = await seeded(makeStorage, 3); // head 2; expected next position 3
      await expect(storage.append(STREAM_A, [env(STREAM_A, 5)], 2)).rejects.toThrow(
        StorageErrors.APPEND_NOT_CONTIGUOUS,
      );
      expect(await storage.head(STREAM_A)).toBe(2);
    });

    it("creates a new stream, and rejects a second create at position 0 with VERSION_CONFLICT", async () => {
      const storage = await makeStorage();
      await storage.append(STREAM_A, [env(STREAM_A, 0)], undefined);
      await expect(storage.append(STREAM_A, [env(STREAM_A, 0)], undefined)).rejects.toThrow(
        StorageErrors.VERSION_CONFLICT,
      );
      expect(positions(await storage.read(STREAM_A))).toEqual([0]);
    });

    it("is retry-safe: re-appending a landed commit is rejected, with no duplication", async () => {
      const storage = await seeded(makeStorage, 2); // head 1
      const next = [env(STREAM_A, 2)];
      await storage.append(STREAM_A, next, 1); // lands; head 2
      await expect(storage.append(STREAM_A, next, 1)).rejects.toThrow(StorageErrors.VERSION_CONFLICT);
      expect(positions(await storage.read(STREAM_A))).toEqual([0, 1, 2]);
    });

    it("empty append honors expectedHead: stale → VERSION_CONFLICT", async () => {
      const storage = await seeded(makeStorage, 3); // head 2
      await expect(storage.append(STREAM_A, [], 0)).rejects.toThrow(StorageErrors.VERSION_CONFLICT);
    });

    it("empty append with matching or omitted expectedHead is a no-op", async () => {
      const storage = await seeded(makeStorage, 3); // head 2
      await storage.append(STREAM_A, [], 2); // matching
      await storage.append(STREAM_A, [], undefined); // omitted
      expect(await storage.head(STREAM_A)).toBe(2);
      expect(positions(await storage.read(STREAM_A))).toEqual([0, 1, 2]);
    });
  });

  describe("StorageI conformance — overwrite", () => {
    it("redacts in place, preserving identity (only payload differs)", async () => {
      const storage = await seeded(makeStorage, 3);
      await storage.overwrite(STREAM_A, [env(STREAM_A, 1, { redacted: true })]);
      const stored = (await storage.read(STREAM_A)).find((event) => event.position === 1);
      expect(stored).toMatchObject({ id: "agg-a-1", topic: "test.event.v1", position: 1, payload: { redacted: true } });
    });

    it("rejects an unknown position with OVERWRITE_UNKNOWN_POSITION", async () => {
      const storage = await seeded(makeStorage, 2);
      await expect(storage.overwrite(STREAM_A, [env(STREAM_A, 9, { redacted: true })])).rejects.toThrow(
        StorageErrors.OVERWRITE_UNKNOWN_POSITION,
      );
    });

    it("is all-or-nothing on a miss: a set with one missing position redacts none", async () => {
      const storage = await seeded(makeStorage, 3);
      await expect(
        storage.overwrite(STREAM_A, [env(STREAM_A, 1, { redacted: true }), env(STREAM_A, 9, { redacted: true })]),
      ).rejects.toThrow(StorageErrors.OVERWRITE_UNKNOWN_POSITION);
      // position 1 must be untouched
      const stored = (await storage.read(STREAM_A)).find((event) => event.position === 1);
      expect(stored?.payload).toEqual({ n: 1 });
    });
  });

  describe("StorageI conformance — projections", () => {
    it("loadProjection is undefined for an unknown (stream, name)", async () => {
      const storage = await makeStorage();
      expect(await storage.loadProjection(STREAM_A, "p1")).toBeUndefined();
    });

    it("round-trips a saved projection (state + bookmark)", async () => {
      const storage = await makeStorage();
      const stored = storedProjection(STREAM_A, "p1", 3, { total: 42 });
      await storage.saveProjection(stored);
      expect(await storage.loadProjection(STREAM_A, "p1")).toEqual(stored);
    });

    it("saveProjection is an upsert (second save wins)", async () => {
      const storage = await makeStorage();
      await storage.saveProjection(storedProjection(STREAM_A, "p1", 1, { total: 1 }));
      await storage.saveProjection(storedProjection(STREAM_A, "p1", 2, { total: 2 }));
      expect(await storage.loadProjection(STREAM_A, "p1")).toEqual(storedProjection(STREAM_A, "p1", 2, { total: 2 }));
    });

    it("deleteProjections removes every projection for the stream", async () => {
      const storage = await makeStorage();
      await storage.saveProjection(storedProjection(STREAM_A, "p1", 1, {}));
      await storage.saveProjection(storedProjection(STREAM_A, "p2", 1, {}));
      await storage.deleteProjections(STREAM_A);
      expect(await storage.loadProjection(STREAM_A, "p1")).toBeUndefined();
      expect(await storage.loadProjection(STREAM_A, "p2")).toBeUndefined();
    });

    it("deleteProjections is isolated: it leaves other streams' projections (and events) untouched", async () => {
      const storage = await makeStorage();
      await storage.saveProjection(storedProjection(STREAM_A, "p1", 1, {}));
      await storage.saveProjection(storedProjection(STREAM_B, "p1", 1, { keep: true }));
      await storage.append(STREAM_A, [env(STREAM_A, 0)], undefined);
      await storage.deleteProjections(STREAM_A);
      expect(await storage.loadProjection(STREAM_B, "p1")).toEqual(storedProjection(STREAM_B, "p1", 1, { keep: true }));
      expect(positions(await storage.read(STREAM_A))).toEqual([0]); // events untouched
    });
  });

  describe("StorageI conformance — adversarial", () => {
    it("concurrent append race: exactly one of two appends at one expectedHead wins", async () => {
      const storage = await seeded(makeStorage, 1); // head 0
      const a = storage.append(STREAM_A, [env(STREAM_A, 1, { who: "a" })], 0);
      const b = storage.append(STREAM_A, [env(STREAM_A, 1, { who: "b" })], 0);
      const results = await Promise.allSettled([a, b]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason?.message).toContain(StorageErrors.VERSION_CONFLICT);
      expect(positions(await storage.read(STREAM_A))).toEqual([0, 1]); // exactly one landed
    });

    it("multi-event atomicity: an append that conflicts writes NONE of its events", async () => {
      const storage = await seeded(makeStorage, 3); // head 2
      // 3 events contiguous to a STALE expectedHead (0): positions 1,2,3 — passes contiguity,
      // then conflicts because positions 1,2 are already taken. Must land NONE (not even pos 3).
      await expect(storage.append(STREAM_A, [env(STREAM_A, 1), env(STREAM_A, 2), env(STREAM_A, 3)], 0)).rejects.toThrow(
        StorageErrors.VERSION_CONFLICT,
      );
      expect(positions(await storage.read(STREAM_A))).toEqual([0, 1, 2]); // unchanged — nothing partial landed
    });

    it("hostile-key round-trip (event payload): $-prefixed / dotted / unicode keys survive equal", async () => {
      const storage = await makeStorage();
      const event = env(STREAM_A, 0, { $set: 1, "a.b": 2, unïcode: "✓", nested: { $inc: 3 } });
      await storage.append(STREAM_A, [event], undefined);
      expect(await storage.read(STREAM_A)).toEqual([event]);
    });

    it("hostile-key round-trip (projection state): the same keys survive equal", async () => {
      const storage = await makeStorage();
      const stored = storedProjection(STREAM_A, "p1", 0, { $set: 1, "a.b": 2, unïcode: "✓" });
      await storage.saveProjection(stored);
      expect(await storage.loadProjection(STREAM_A, "p1")).toEqual(stored);
    });

    it("append racing overwrite converges (both effects present after retries)", async () => {
      const storage = await seeded(makeStorage, 3); // head 2
      // overwrite position 1, append position 3 — concurrently; retry the loser of any VERSION_CONFLICT.
      const overwrite = storage.overwrite(STREAM_A, [env(STREAM_A, 1, { redacted: true })]);
      const append = storage.append(STREAM_A, [env(STREAM_A, 3)], 2);
      const settle = async (op: Promise<unknown>, retry: () => Promise<unknown>): Promise<void> => {
        try {
          await op;
        } catch {
          await retry(); // reload-and-retry; VERSION_CONFLICT means "try again", not "give up"
        }
      };
      await Promise.all([
        settle(overwrite, () => storage.overwrite(STREAM_A, [env(STREAM_A, 1, { redacted: true })])),
        settle(append, async () => {
          const head = await storage.head(STREAM_A);
          await storage.append(STREAM_A, [env(STREAM_A, (head ?? -1) + 1)], head);
        }),
      ]);
      const all = await storage.read(STREAM_A);
      expect(all.find((e) => e.position === 1)?.payload).toEqual({ redacted: true });
      expect(all.some((e) => e.position === 3)).toBe(true);
    });
  });
};
