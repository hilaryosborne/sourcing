import { describe, it, expect } from "vitest";
import { FileAggregate, FileCreateV1, FileRenameV1, creator } from "./fixtures";

// The right-to-forget pass/fail test (testing skill / FOUNDATION §Strippers): after
// strip(), walk the produced events and assert NO PII survives, identity is preserved,
// and the original bowl is untouched (strip is a pure derivation, not a mutation).
const PII = "Alice Secret";

const committedBowl = () => {
  const bowl = FileAggregate.instance("file-1");
  bowl.add(FileCreateV1).by(creator).message({ name: "draft.txt", owner: PII });
  bowl.add(FileRenameV1).by(creator).message({ name: "final.txt" });
  bowl.commit(); // exercise stripping over the durable history, the real erasure case
  return bowl;
};

describe("aggregate.strip — right to forget", () => {
  it("should leave no PII anywhere in the produced events", () => {
    const stripped = committedBowl().strip("gdpr");
    const serialized = JSON.stringify(stripped.export());
    expect(serialized).not.toContain(PII);
  });

  it("should redact the create payload to the stripper's value", () => {
    const stripped = committedBowl().strip("gdpr");
    const create = stripped.export().find((event) => event.topic === "file.create.v1");
    expect(create?.payload).toEqual({ name: "draft.txt", owner: "[redacted]" });
  });

  it("should preserve event identity and metadata across stripping", () => {
    const original = committedBowl();
    const before = original.export()[0];
    const after = original.strip("gdpr").export()[0];
    expect(after?.id).toBe(before?.id);
    expect(after?.position).toBe(before?.position);
    expect(after?.creator).toEqual(before?.creator);
    expect(after?.created).toBe(before?.created);
  });

  it("should leave events without a matching stripper unchanged (but as new instances)", () => {
    const original = committedBowl();
    const beforeRename = original.export().find((event) => event.topic === "file.rename.v1");
    const afterRename = original
      .strip("gdpr")
      .export()
      .find((event) => event.topic === "file.rename.v1");
    expect(afterRename).toEqual(beforeRename);
  });

  it("should not mutate the original bowl — strip returns a new aggregate", () => {
    const original = committedBowl();
    original.strip("gdpr");
    const serialized = JSON.stringify(original.export());
    expect(serialized).toContain(PII); // the source of truth is untouched until persisted
  });
});
