// Strippers — the right-to-forget pass/fail. The decisive test (FOUNDATION §Strippers):
// strip an aggregate, export its events, and assert NO PII survives. That is what proves
// stripping works rather than merely appears to. Plus: identity is preserved, the original
// is not mutated, and events without a matching stripper pass through unchanged.
import { describe, it, expect } from "vitest";
import { FileAggregate, FileCreateV1, FileRenameV1 } from "./fixtures";

const PII = "Alice Q. Privacy";

// A committed file stream carrying PII (the owner on create) plus a rename (no PII).
const seeded = () => {
  const file = FileAggregate.instance("file-1");
  file.events.add(FileCreateV1.create({ name: "draft.txt", owner: PII }).creator("user", "u1"));
  file.events.add(FileRenameV1.create({ name: "final.txt" }).creator("user", "u1"));
  file.events.commit(); // strip over the durable history — the real erasure case
  return file;
};

describe("strip (right-to-forget)", () => {
  it("produces events with NO PII surviving — the pass/fail test", () => {
    const dump = JSON.stringify(seeded().strip("gdpr").events.export());
    expect(dump).not.toContain(PII);
    expect(dump).toContain("[redacted]");
  });

  it("preserves identity per event (id, position, topic)", () => {
    const original = seeded();
    const identity = (events: ReturnType<typeof original.events.export>) =>
      events.map((e) => ({ id: e.id, position: e.position, topic: e.topic }));
    expect(identity(original.strip("gdpr").events.export())).toEqual(identity(original.events.export()));
  });

  it("does not mutate the original aggregate", () => {
    const original = seeded();
    original.strip("gdpr");
    expect(JSON.stringify(original.events.export())).toContain(PII);
  });

  it("passes through events that have no matching stripper, unchanged", () => {
    const rename = seeded()
      .strip("gdpr")
      .events.export()
      .find((e) => e.topic === "file.rename.v1");
    expect(rename?.payload).toEqual({ name: "final.txt" });
  });
});
