// Aggregate layer: register/topic uniqueness, id minting, the add() staging guards, the
// committed/staged split, import/restore, commit, export, and position.
import { describe, it, expect } from "vitest";
import aggregate from "../aggregate";
import { AggregateErrors } from "../aggregate.errors";
import {
  FileAggregate,
  FileCreateV1,
  FileRenameV1,
  FolderCreateV1,
  committedEnvelopes,
} from "../../__tests__/fixtures";

describe("aggregate", () => {
  it("register() rejects a duplicate topic on one definition", () => {
    const def = aggregate("dup.v1");
    def.register(FileCreateV1);
    expect(() => def.register(FileCreateV1)).toThrow(AggregateErrors.TOPIC_DUPLICATE);
  });

  it("instance() mints a nanoid when no id is given, and accepts an explicit id", () => {
    expect(FileAggregate.instance().id).toMatch(/.+/);
    expect(FileAggregate.instance("file-1").id).toBe("file-1");
    expect(FileAggregate.instance().id).not.toBe(FileAggregate.instance().id);
  });

  it("events.add() rejects an unregistered topic", () => {
    const file = FileAggregate.instance("file-1");
    const alien = FolderCreateV1.create({ name: "docs" }).creator("user", "u1");
    expect(() => file.events.add(alien)).toThrow(AggregateErrors.TOPIC_UNKNOWN);
  });

  it("events.add() rejects an event with no creator (provenance required)", () => {
    const file = FileAggregate.instance("file-1");
    const noCreator = FileCreateV1.create({ name: "draft.txt", owner: "Alice" });
    expect(() => file.events.add(noCreator)).toThrow(AggregateErrors.MISSING_CREATOR);
  });

  it("events.add() stages onto `staged`, stamps position + reference, returns the instance", () => {
    const file = FileAggregate.instance("file-1");
    const staged = file.events.add(FileCreateV1.create({ name: "draft.txt", owner: "Alice" }).creator("user", "u1"));
    expect(staged.get.position()).toBe(0);
    expect(staged.get.aggregate()).toEqual({ id: "file-1", name: "file.v1" });
    expect(file.events.committed).toHaveLength(0);
    expect(file.events.staged).toHaveLength(1);
    file.events.add(FileRenameV1.create({ name: "final.txt" }).creator("user", "u1"));
    expect(file.events.staged.map((e) => e.get.position())).toEqual([0, 1]);
    expect(file.position).toBe(1);
  });

  it("commit() folds staged into committed", () => {
    const file = FileAggregate.instance("file-1");
    file.events.add(FileCreateV1.create({ name: "draft.txt", owner: "Alice" }).creator("user", "u1"));
    file.events.commit();
    expect(file.events.staged).toHaveLength(0);
    expect(file.events.committed).toHaveLength(1);
  });

  it("import() rehydrates committed history; the next staged position continues the stream", () => {
    const file = FileAggregate.instance("file-1");
    file.events.import(committedEnvelopes("file-1")); // positions 0,1
    expect(file.events.committed).toHaveLength(2);
    file.events.add(FileRenameV1.create({ name: "renamed.txt" }).creator("user", "u1"));
    expect(file.events.staged[0]?.get.position()).toBe(2);
  });

  it("import() rejects an unregistered topic", () => {
    const file = FileAggregate.instance("file-1");
    const alien = FolderCreateV1.create({ name: "docs" }).creator("user", "u1").stage({ id: "x", name: "folder" }, 0);
    expect(() => file.events.import([alien.build()])).toThrow(AggregateErrors.TOPIC_UNKNOWN);
  });

  it("import() rejects a malformed envelope", () => {
    const file = FileAggregate.instance("file-1");
    const broken = { ...committedEnvelopes("file-1")[0]!, payload: { name: "", owner: "" } };
    expect(() => file.events.import([broken])).toThrow(AggregateErrors.EVENT_INVALID);
  });

  it("export() yields committed ++ staged as envelopes", () => {
    const file = FileAggregate.instance("file-1");
    file.events.add(FileCreateV1.create({ name: "draft.txt", owner: "Alice" }).creator("user", "u1"));
    const exported = file.events.export();
    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({ topic: "file.create.v1", position: 0 });
  });

  it("position is undefined for an empty aggregate", () => {
    expect(FileAggregate.instance("file-1").position).toBeUndefined();
  });
});
