// Shared test fixtures: a small "file" domain exercised across the core suites. A file is
// created (with an owner — the PII that strippers must erase) and can be renamed. One
// projection folds those into a read-model. Kept domain-agnostic and tiny on purpose.
import { object, string } from "zod";
import event from "../event/event";
import aggregate from "../aggregate/aggregate";
import projection from "../projection/projection";

// --- Events ---
type FileCreate = { name: string; owner: string };
export const FileCreateV1 = event("file.create.v1");
FileCreateV1.version(1, object({ name: string().min(1), owner: string().min(1) }))
  // The owner is PII — the gdpr stripper redacts it.
  .strip("gdpr", (payload) => ({ ...payload, owner: "[redacted]" }));

type FileRename = { name: string };
export const FileRenameV1 = event("file.rename.v1");
FileRenameV1.version(1, object({ name: string().min(1) }));

// An event the file aggregate does NOT register — for TOPIC_UNKNOWN paths.
export const FolderCreateV1 = event("folder.create.v1");
FolderCreateV1.version(1, object({ name: string().min(1) }));

// --- Aggregate ---
export const FileAggregate = aggregate("file.v1");
FileAggregate.register(FileCreateV1);
FileAggregate.register(FileRenameV1);

// --- Projection (read-model) ---
export const FileModelV1 = object({ name: string(), owner: string() });
export const FileView = projection("projection.file.v1", FileModelV1);
FileView.aggregate(FileAggregate);
FileView.handle<FileCreate>(FileCreateV1, (current, event) => ({
  ...current,
  name: event.payload.name,
  owner: event.payload.owner,
}));
FileView.handle<FileRename>(FileRenameV1, (current, event) => ({ ...current, name: event.payload.name }));

// A committed-history helper: build a stream and export its envelopes (as a store would
// hand them back), so import()/restore() paths can be exercised with real envelopes.
export const committedEnvelopes = (id = "file-1") => {
  const seed = FileAggregate.instance(id);
  seed.events.add(FileCreateV1.create({ name: "draft.txt", owner: "Alice" }).creator("user", "u1"));
  seed.events.add(FileRenameV1.create({ name: "final.txt" }).creator("user", "u1"));
  return seed.events.export();
};
