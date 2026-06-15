// Event layer: standalone creation, fluent provenance, validation at the boundary, the
// create/restore split, and the unstaged-build guard.
import { describe, it, expect } from "vitest";
import { object, string } from "zod";
import event from "../event";
import { EventErrors } from "../event.errors";
import { FileCreateV1, committedEnvelopes } from "../../__tests__/fixtures";

describe("event", () => {
  it("create() validates the payload immediately (fail fast)", () => {
    expect(() => FileCreateV1.create({ name: "", owner: "Alice" })).toThrow(EventErrors.PAYLOAD_INVALID);
  });

  it("create() mints id + created eagerly, before staging", () => {
    const instance = FileCreateV1.create({ name: "draft.txt", owner: "Alice" });
    expect(instance.get.id()).toMatch(/.+/);
    expect(instance.get.created()).toMatch(/\d{4}-\d{2}-\d{2}T/);
    // Unstaged: no position / aggregate / creator yet.
    expect(instance.get.position()).toBeUndefined();
    expect(instance.get.aggregate()).toBeUndefined();
    expect(instance.get.creator()).toBeUndefined();
  });

  it("creator() and headers() decorate fluently", () => {
    const instance = FileCreateV1.create({ name: "draft.txt", owner: "Alice" })
      .creator("user", "u1")
      .headers({ source: "import" });
    expect(instance.get.creator()).toEqual({ entity: "user", uid: "u1" });
    expect(instance.get.headers()).toEqual({ source: "import" });
  });

  it("build() throws on an unstaged event (no position/aggregate/creator)", () => {
    const instance = FileCreateV1.create({ name: "draft.txt", owner: "Alice" }).creator("user", "u1");
    expect(() => instance.build()).toThrow();
  });

  it("build() yields a full envelope once staged", () => {
    const instance = FileCreateV1.create({ name: "draft.txt", owner: "Alice" })
      .creator("user", "u1")
      .stage({ id: "file-1", name: "file.v1" }, 0);
    const envelope = instance.build();
    expect(envelope).toMatchObject({
      topic: "file.create.v1",
      position: 0,
      aggregate: { id: "file-1", name: "file.v1" },
      creator: { entity: "user", uid: "u1" },
      payload: { name: "draft.txt", owner: "Alice" },
    });
  });

  it("strip() registers contextually and rejects a duplicate name in one scope", () => {
    const def = event("file.note.v1", object({ text: string() }));
    def.strip("gdpr", (p) => ({ ...p, text: "" }));
    expect(() => def.strip("gdpr", (p) => p)).toThrow(EventErrors.STRIPPER_DUPLICATE);
  });

  it("restore() rehydrates a stored envelope without minting new identity", () => {
    const created = committedEnvelopes("file-9")[0]!;
    const instance = FileCreateV1.restore(created);
    expect(instance.get.id()).toBe(created.id);
    expect(instance.get.position()).toBe(created.position);
    expect(instance.build()).toEqual(created);
  });
});
