import { describe, it, expect } from "vitest";
import { object } from "zod";
import event from "../../event/event";
import aggregate from "../aggregate";
import { AggregateErrors } from "../aggregate.errors";
import type { EventEnvelopeV1Type } from "../../event/event.schema";
import { FileAggregate, FileCreateV1, FileRenameV1, creator } from "../../__tests__/fixtures";

// A complete committed envelope for import tests.
const committedCreate = (position: number, owner = "Alice"): EventEnvelopeV1Type => ({
  id: `id-${position}`,
  topic: "file.create.v1",
  position,
  aggregate: { id: "file-1", name: "file" },
  creator: { entity: "user", uid: "importer" },
  headers: {},
  created: "2020-01-01T00:00:00.000Z",
  payload: { name: "stored.txt", owner },
});

describe("aggregate definition", () => {
  it("should reject duplicate topics on one definition with TOPIC_DUPLICATE", () => {
    expect(() => aggregate("file", [FileCreateV1, FileCreateV1])).toThrow(AggregateErrors.TOPIC_DUPLICATE);
  });

  it("should reject staging an event it does not register with TOPIC_UNKNOWN", () => {
    const unregistered = event("other.v1", object({}));
    const file = FileAggregate.instance("file-1");
    expect(() => file.add(unregistered)).toThrow(AggregateErrors.TOPIC_UNKNOWN);
  });
});

describe("aggregate instance — committed/staged split", () => {
  it("should require a creator before message() with MISSING_CREATOR", () => {
    const file = FileAggregate.instance("file-1");
    expect(() => file.add(FileCreateV1).message({ name: "a", owner: "Alice" })).toThrow(
      AggregateErrors.MISSING_CREATOR,
    );
  });

  it("should stage events with 0-based provisional positions, keeping committed empty", () => {
    const file = FileAggregate.instance("file-1");
    file.add(FileCreateV1).by(creator).message({ name: "draft", owner: "Alice" });
    file.add(FileRenameV1).by(creator).message({ name: "final" });
    expect(file.get.committed()).toHaveLength(0);
    expect(file.get.staged()).toHaveLength(2);
    expect(file.get.staged().map((event) => event.get.position())).toEqual([0, 1]);
    expect(file.get.position()).toBe(1);
  });

  it("should continue provisional positions from the imported committed head", () => {
    const file = FileAggregate.instance("file-1");
    file.import([committedCreate(0), committedCreate(1)]);
    file.add(FileRenameV1).by(creator).message({ name: "final" });
    expect(file.get.committed()).toHaveLength(2);
    expect(file.get.staged()[0]?.get.position()).toBe(2);
  });

  it("should fold staged into committed on commit()", () => {
    const file = FileAggregate.instance("file-1");
    file.add(FileCreateV1).by(creator).message({ name: "draft", owner: "Alice" });
    file.commit();
    expect(file.get.staged()).toHaveLength(0);
    expect(file.get.committed()).toHaveLength(1);
  });

  it("should reject importing an unregistered topic with TOPIC_UNKNOWN", () => {
    const file = FileAggregate.instance("file-1");
    const alien = { ...committedCreate(0), topic: "alien.v1" };
    expect(() => file.import([alien])).toThrow(AggregateErrors.TOPIC_UNKNOWN);
  });

  it("should reject importing a malformed envelope with EVENT_INVALID", () => {
    const file = FileAggregate.instance("file-1");
    const broken = { ...committedCreate(0), payload: { name: "no owner" } } as EventEnvelopeV1Type;
    expect(() => file.import([broken])).toThrow(AggregateErrors.EVENT_INVALID);
  });

  it("should export committed and staged events as validated envelopes", () => {
    const file = FileAggregate.instance("file-1");
    file.add(FileCreateV1).by(creator).message({ name: "draft", owner: "Alice" });
    const exported = file.export();
    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({
      topic: "file.create.v1",
      position: 0,
      aggregate: { id: "file-1", name: "file" },
      creator: { entity: "user", uid: "tester" },
      payload: { name: "draft", owner: "Alice" },
    });
  });
});
