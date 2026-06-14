// Projection layer: handler registration guards, the full fold, the resume-from-state
// fold (the self-healing stale path), unmapped-topic tolerance, and the first-event-seeds-
// the-shape contract surfacing as a validation error.
import { describe, it, expect } from "vitest";
import projection from "../projection";
import { ProjectionErrors } from "../projection.errors";
import {
  FileAggregate,
  FileModelV1,
  FileView,
  FileCreateV1,
  FileRenameV1,
  FolderCreateV1,
} from "../../__tests__/fixtures";

const withCreateAndRename = () => {
  const file = FileAggregate.instance("file-1");
  file.events.add(FileCreateV1.create({ name: "draft.txt", owner: "Alice" }).creator("user", "u1"));
  file.events.add(FileRenameV1.create({ name: "final.txt" }).creator("user", "u1"));
  return file;
};

describe("projection", () => {
  it("handle() rejects a structurally malformed mapper", () => {
    const view = projection("projection.bad-mapper.v1", FileModelV1);
    // @ts-expect-error — a non-function mapper is a mechanical fault
    expect(() => view.handle(FileCreateV1, null)).toThrow(ProjectionErrors.MAPPER_INVALID);
  });

  it("handle() rejects an event not registered on the bound aggregate", () => {
    const view = projection("projection.unreg.v1", FileModelV1).aggregate(FileAggregate);
    expect(() => view.handle(FolderCreateV1, (c) => c)).toThrow(ProjectionErrors.EVENT_UNREGISTERED);
  });

  it("handle() rejects a duplicate topic within one projection", () => {
    const view = projection("projection.dup.v1", FileModelV1);
    view.handle(FileCreateV1, (c, e) => ({ ...c, name: e.payload.name, owner: e.payload.owner }));
    expect(() => view.handle(FileCreateV1, (c) => c)).toThrow(ProjectionErrors.TOPIC_DUPLICATE);
  });

  it("build() folds the full stream and validates the model", () => {
    expect(FileView.build(withCreateAndRename())).toEqual({ name: "final.txt", owner: "Alice" });
  });

  it("build(aggregate, from) RESUMES: folds the delta over a supplied prior state", () => {
    // The self-healing stale path: only the delta is in the aggregate, the stored state is
    // the seed. The rename updates `name`; `owner` survives from the seed alone.
    const delta = FileAggregate.instance("file-1");
    delta.events.add(FileRenameV1.create({ name: "v3.txt" }).creator("user", "u1"));
    expect(FileView.build(delta, { name: "final.txt", owner: "Alice" })).toEqual({ name: "v3.txt", owner: "Alice" });
  });

  it("build() tolerates an unmapped topic — it folds the rest", () => {
    const view = projection("projection.partial.v1", FileModelV1).aggregate(FileAggregate);
    view.handle(FileCreateV1, (c, e) => ({ ...c, name: e.payload.name, owner: e.payload.owner }));
    // FileRenameV1 is unmapped here → ignored, the created state stands.
    expect(view.build(withCreateAndRename())).toEqual({ name: "draft.txt", owner: "Alice" });
  });

  it("build() fails validation when the first folded event doesn't establish the shape", () => {
    // The sharp edge of the State-not-Partial contract: a projection whose only handler is
    // a non-creating event produces an incomplete model → OUTPUT_INVALID, by design.
    const view = projection("projection.shapeless.v1", FileModelV1).aggregate(FileAggregate);
    view.handle(FileRenameV1, (c, e) => ({ ...c, name: e.payload.name }));
    const file = FileAggregate.instance("file-1");
    file.events.add(FileRenameV1.create({ name: "x.txt" }).creator("user", "u1"));
    expect(() => view.build(file)).toThrow(ProjectionErrors.OUTPUT_INVALID);
  });
});
