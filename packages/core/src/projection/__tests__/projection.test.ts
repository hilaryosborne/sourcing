import { describe, it, expect } from "vitest";
import { object, string, number } from "zod";
import projection from "../projection";
import { ProjectionErrors } from "../projection.errors";
import { FileAggregate, FileProjection, FileCreateV1, FileRenameV1, creator } from "../../__tests__/fixtures";

// A bowl with a create then a rename staged — the standard fold input.
const stagedBowl = () => {
  const bowl = FileAggregate.instance("file-1");
  bowl.add(FileCreateV1).by(creator).message({ name: "draft.txt", owner: "Alice" });
  bowl.add(FileRenameV1).by(creator).message({ name: "final.txt" });
  return bowl;
};

describe("projection builder", () => {
  it("should fold events into the read-model (Scenario 1, on demand)", () => {
    const model = FileProjection.build(stagedBowl().get.events());
    expect(model).toEqual({ name: "final.txt", owner: "Alice", events: 2 });
  });

  it("should apply staged events on top of committed ones (Scenario 3 overlay)", () => {
    const bowl = stagedBowl();
    bowl.commit(); // create + rename now committed
    bowl.add(FileRenameV1).by(creator).message({ name: "renamed-again.txt" });
    const model = FileProjection.build(bowl.get.events());
    expect(model).toEqual({ name: "renamed-again.txt", owner: "Alice", events: 3 });
  });

  it("should tolerate an unmapped topic by leaving state unchanged", () => {
    const createOnly = projection({
      schema: object({ name: string(), events: number() }),
      initial: { name: "", events: 0 },
      handlers: [
        { topic: "file.create.v1", apply: (current) => ({ ...current, name: "seen", events: current.events + 1 }) },
      ],
    });
    // The rename event has no handler here — it must be folded over without throwing.
    const model = createOnly.build(stagedBowl().get.events());
    expect(model).toEqual({ name: "seen", events: 1 });
  });

  it("should be deterministic — the same events rebuild the identical read-model", () => {
    const events = stagedBowl().get.events();
    expect(FileProjection.build(events)).toEqual(FileProjection.build(events));
  });

  it("should reject a duplicate mapper topic with TOPIC_DUPLICATE", () => {
    expect(() =>
      projection({
        schema: object({ n: number() }),
        initial: { n: 0 },
        handlers: [
          { topic: "file.create.v1", apply: (c) => c },
          { topic: "file.create.v1", apply: (c) => c },
        ],
      }),
    ).toThrow(ProjectionErrors.TOPIC_DUPLICATE);
  });

  it("should reject a malformed mapper with MAPPER_INVALID", () => {
    expect(() =>
      projection({
        schema: object({ n: number() }),
        initial: { n: 0 },
        handlers: [{ topic: "file.create.v1" } as never],
      }),
    ).toThrow(ProjectionErrors.MAPPER_INVALID);
  });

  it("should reject a produced read-model that fails the output schema with OUTPUT_INVALID", () => {
    const broken = projection({
      schema: object({ events: number() }),
      initial: { events: 0 },
      handlers: [{ topic: "file.create.v1", apply: () => ({ events: "not-a-number" }) as never }],
    });
    expect(() => broken.build(stagedBowl().get.events())).toThrow(ProjectionErrors.OUTPUT_INVALID);
  });
});
