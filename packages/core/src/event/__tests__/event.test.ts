import { describe, it, expect } from "vitest";
import { object, string } from "zod";
import event from "../event";
import { EventErrors } from "../event.errors";
import type { EventEnvelopeV1Type } from "../event.schema";
import { FileCreateV1 } from "../../__tests__/fixtures";

describe("event definition", () => {
  it("should assign an id and created timestamp eagerly at creation, leaving staging fields unset", () => {
    const instance = FileCreateV1.create({ name: "draft.txt", owner: "Alice" });
    expect(instance.get.id()).toBeTruthy();
    expect(instance.get.created()).toBeTruthy();
    expect(instance.get.payload()).toEqual({ name: "draft.txt", owner: "Alice" });
    expect(instance.get.position()).toBeUndefined();
    expect(instance.get.creator()).toBeUndefined();
  });

  it("should give every created event a distinct id", () => {
    const a = FileCreateV1.create({ name: "a", owner: "Alice" });
    const b = FileCreateV1.create({ name: "b", owner: "Bob" });
    expect(a.get.id()).not.toBe(b.get.id());
  });

  it("should reject a payload that fails its schema with PAYLOAD_INVALID", () => {
    expect(() => FileCreateV1.create({ name: "a" } as never)).toThrow(EventErrors.PAYLOAD_INVALID);
  });

  it("should not be buildable before staging (no position/aggregate/creator yet)", () => {
    const instance = FileCreateV1.create({ name: "a", owner: "Alice" });
    expect(() => instance.build()).toThrow();
  });

  it("should reject a duplicate stripper name with STRIPPER_DUPLICATE", () => {
    const definition = event("sample.v1", object({ secret: string() }));
    definition.strip("gdpr", (payload) => payload);
    expect(() => definition.strip("gdpr", (payload) => payload)).toThrow(EventErrors.STRIPPER_DUPLICATE);
  });

  it("should rehydrate a stored envelope via restore() without minting new identity", () => {
    const envelope: EventEnvelopeV1Type = {
      id: "fixed-id",
      topic: "file.create.v1",
      position: 3,
      aggregate: { id: "file-1", name: "file" },
      creator: { entity: "user", uid: "importer" },
      headers: {},
      created: "2020-01-01T00:00:00.000Z",
      payload: { name: "stored.txt", owner: "Alice" },
    };
    const restored = FileCreateV1.restore(envelope);
    expect(restored.get.id()).toBe("fixed-id");
    expect(restored.get.position()).toBe(3);
    expect(restored.get.creator()).toEqual({ entity: "user", uid: "importer" });
    expect(restored.build()).toEqual(envelope);
  });

  it("should reject restoring an envelope whose payload fails the schema", () => {
    const envelope = {
      id: "x",
      topic: "file.create.v1",
      position: 0,
      aggregate: { id: "file-1", name: "file" },
      creator: { entity: "user", uid: "importer" },
      headers: {},
      created: "2020-01-01T00:00:00.000Z",
      payload: { name: "missing owner" },
    } as unknown as EventEnvelopeV1Type;
    expect(() => FileCreateV1.restore(envelope)).toThrow();
  });
});
