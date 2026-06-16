// Right-to-forget — end-to-end CORRECTNESS proof (the bit Phase A parked). Runs the real
// repository over the in-memory StorageI double and proves: strip is identity-preserving,
// overwrite redacts in place keyed by (stream, position), bin-all + lazy heal leave no PII
// on the read side, and the decisive pass/fail — no PII survives in the stored events.
import { describe, it, expect } from "vitest";
import { object, string } from "zod";
import { event, aggregate, projection } from "@hilaryosborne/sourcing";
import { repository } from "../repository/repository";
import { StorageErrors } from "../storage/storage.errors";
import { memoryStorage } from "./memory-storage";

const PII = "alice@example.com";

// A user domain with PII (the email on registration) and a non-PII rename.
const UserRegisteredV1 = event("user.registered.v1");
UserRegisteredV1.version(1, object({ email: string().min(1) })).strip("gdpr", (payload) => ({
  ...payload,
  email: "[redacted]",
}));
const UserRenamedV1 = event("user.renamed.v1");
UserRenamedV1.version(1, object({ handle: string().min(1) }));

const User = aggregate("user.v1");
User.register(UserRegisteredV1);
User.register(UserRenamedV1);

const Profile = projection("projection.profile.v1", object({ email: string(), handle: string() }));
Profile.aggregate(User);
Profile.handle<{ email: string }>(UserRegisteredV1, (current, event) => ({
  ...current,
  email: event.payload.email,
  handle: "",
}));
Profile.handle<{ handle: string }>(UserRenamedV1, (current, event) => ({ ...current, handle: event.payload.handle }));

const userStream = (id: string) => ({ id, name: "user.v1" });

// Seed a committed user stream carrying PII, with its projection already built and cached
// (so there is a "current" projection that erasure must not let mask the PII).
const seeded = async () => {
  const storage = memoryStorage();
  const repo = repository({ storage });
  const user = await repo.create(User);
  user.events.add(UserRegisteredV1.create({ email: PII }).creator("user", "alice"));
  user.events.add(UserRenamedV1.create({ handle: "alice" }).creator("user", "alice"));
  await repo.commit(user);
  await repo.rebuild({ aggregate: User, id: user.id, projection: Profile }); // cache a "current" projection
  return { storage, repo, id: user.id };
};

describe("forget (right-to-forget, end to end)", () => {
  it("erases PII from the stored events — the pass/fail proof", async () => {
    const { storage, repo, id } = await seeded();
    await repo.forget({ aggregate: User, id, context: "gdpr" });
    const dump = JSON.stringify(await storage.read(userStream(id)));
    expect(dump).not.toContain(PII);
    expect(dump).toContain("[redacted]");
  });

  it("preserves event identity (id/position/topic); redacts only the payload", async () => {
    const { storage, repo, id } = await seeded();
    const before = await storage.read(userStream(id));
    await repo.forget({ aggregate: User, id, context: "gdpr" });
    const after = await storage.read(userStream(id));
    const identity = (events: EventEnvelopeShape[]) =>
      events.map((e) => ({ id: e.id, position: e.position, topic: e.topic }));
    expect(identity(after)).toEqual(identity(before));
    // An event with no gdpr stripper passes through unchanged.
    expect(after.find((e) => e.topic === "user.renamed.v1")?.payload).toEqual({ handle: "alice" });
  });

  it("bins the projection; the next rebuild heals clean (no PII on the read side)", async () => {
    const { repo, id } = await seeded();
    await repo.forget({ aggregate: User, id, context: "gdpr" });
    const healed = await repo.rebuild({ aggregate: User, id, projection: Profile });
    expect(healed.email).toBe("[redacted]");
    expect(JSON.stringify(healed)).not.toContain(PII);
  });

  it("overwrite of an unknown (stream, position) is OVERWRITE_UNKNOWN_POSITION (port contract)", async () => {
    const { storage, id } = await seeded();
    const [first] = await storage.read(userStream(id));
    const ghost = { ...first!, position: 99 };
    await expect(storage.overwrite(userStream(id), [ghost])).rejects.toThrow(StorageErrors.OVERWRITE_UNKNOWN_POSITION);
  });
});

// Minimal structural shape for identity assertions (the stored envelope).
type EventEnvelopeShape = { id: string; position: number; topic: string };
