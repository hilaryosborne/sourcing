# 📄 Document lifecycle

One stream of facts about a single document — created, renamed, shared, revoked, archived — and **two completely different read models folded from it**. A plain summary card, and a live access-control list that adds and removes collaborators as the shares come and go. Same events, same instance, two views. No database to make this run.

## 🧱 The events

Five facts a document can record over its life. Each is a topic (opaque, versioned-by-convention string) plus a Zod payload schema — nothing more.

```ts
import { event } from "@hilaryosborne/sourcing";
import { object, string, enum as zenum } from "zod";

const Role = zenum(["viewer", "editor"]);

export const FileCreatedV1 = event("file.created.v1", object({ name: string().min(1), owner: string().min(1) }));
export const FileRenamedV1 = event("file.renamed.v1", object({ name: string().min(1) }));
export const FileSharedV1 = event("file.shared.v1", object({ withUser: string().min(1), role: Role }));
export const FileAccessRevokedV1 = event("file.access-revoked.v1", object({ fromUser: string().min(1) }));
export const FileArchivedV1 = event("file.archived.v1", object({}));
```

`create()` validates each payload the instant you build it — a malformed fact never gets half-made. And `creator` is required: every fact below carries who made it.

## 📁 The aggregate

One aggregate, `file.v1`, declaring exactly which topics are legal on its stream.

```ts
import { aggregate } from "@hilaryosborne/sourcing";

export const File = aggregate("file.v1");
File.register(FileCreatedV1);
File.register(FileRenamedV1);
File.register(FileSharedV1);
File.register(FileAccessRevokedV1);
File.register(FileArchivedV1);
```

## ✍️ Write the document's life

Stage the facts, then commit. This is pure in-memory bookkeeping — core stores nothing.

```ts
const doc = File.instance("doc-42"); // or omit the id and core mints a nanoid

doc.events.add(FileCreatedV1.create({ name: "Q3 Plan.md", owner: "ada" }).creator("user", "ada"));
doc.events.add(FileRenamedV1.create({ name: "Q3 Roadmap.md" }).creator("user", "ada"));
doc.events.add(FileSharedV1.create({ withUser: "grace", role: "editor" }).creator("user", "ada"));
doc.events.add(FileSharedV1.create({ withUser: "lin", role: "viewer" }).creator("user", "ada"));
doc.events.add(FileAccessRevokedV1.create({ fromUser: "grace" }).creator("user", "ada"));
doc.events.add(FileArchivedV1.create({}).creator("user", "ada"));

doc.events.commit(); // fold staged → committed (in memory)
```

That's the whole stream. Now derive from it.

## 🪪 Projection A — the summary card

A flat read model: what the file _is_ right now. The creating event establishes the entire shape; every other handler spreads `...current` and touches only what it owns.

```ts
import { projection } from "@hilaryosborne/sourcing";
import { object, string, boolean } from "zod";

const FileSummaryV1 = object({ name: string(), owner: string(), archived: boolean() });

export const FileSummary = projection("projection.file-summary.v1", FileSummaryV1);
FileSummary.aggregate(File);
FileSummary.handle(FileCreatedV1, (current, e) => ({
  ...current,
  name: e.payload.name,
  owner: e.payload.owner,
  archived: false,
}));
FileSummary.handle(FileRenamedV1, (current, e) => ({ ...current, name: e.payload.name }));
FileSummary.handle(FileArchivedV1, (current) => ({ ...current, archived: true }));

FileSummary.build(doc); // → { name: "Q3 Roadmap.md", owner: "ada", archived: true }
```

Notice it never handles `file.shared.v1` or `file.access-revoked.v1` — **unmapped topics are simply skipped.** A projection only folds the events it cares about.

::: warning The first folded event establishes the shape
Handlers receive a _complete_ `current: State`, never a `Partial` — that's what lets `FileRenamedV1` write `...current` without re-stating `owner` and `archived`. You uphold that contract by making the **creating event** (`file.created.v1`) return every field the schema requires. If the first event folded into a projection isn't a shape-establishing one, `build` throws `ProjectionErrors.OUTPUT_INVALID` — a runtime fault the types can't catch for you.
:::

## 🔐 Projection B — the access-control list

Same stream, _entirely_ different model. This one **folds shares and revokes into a live map** of who currently has access and at what role. `file.shared.v1` writes a key; `file.access-revoked.v1` deletes one. The creating event seeds the owner with the highest role.

```ts
import { projection } from "@hilaryosborne/sourcing";
import { object, string, record, enum as zenum } from "zod";

const AclV1 = object({ file: string(), collaborators: record(string(), zenum(["owner", "viewer", "editor"])) });

export const FileAcl = projection("projection.file-acl.v1", AclV1);
FileAcl.aggregate(File);

// creating event establishes the whole shape — including the owner as the first collaborator
FileAcl.handle(FileCreatedV1, (current, e) => ({
  ...current,
  file: e.payload.name,
  collaborators: { [e.payload.owner]: "owner" },
}));

// a share FOLDS a new entry into the derived map
FileAcl.handle(FileSharedV1, (current, e) => ({
  ...current,
  collaborators: { ...current.collaborators, [e.payload.withUser]: e.payload.role },
}));

// a revoke FOLDS the entry back out
FileAcl.handle(FileAccessRevokedV1, (current, e) => {
  const { [e.payload.fromUser]: _removed, ...remaining } = current.collaborators;
  return { ...current, collaborators: remaining };
});

FileAcl.build(doc);
// → { file: "Q3 Roadmap.md", collaborators: { ada: "owner", lin: "viewer" } }
```

Walk the result: `ada` is owner from creation, `grace` was added as editor then revoked (gone), `lin` remains a viewer. The map is a **pure derivation** of the share/revoke events — replay them and you get the identical answer every time. Bin it, rebuild it, never worry.

## 🔁 Two read models, one stream

The point worth pausing on: you built **both** views from the _same_ `doc` instance, with no coordination between them.

```ts
FileSummary.build(doc); // { name: "Q3 Roadmap.md", owner: "ada", archived: true }
FileAcl.build(doc); // { file: "Q3 Roadmap.md", collaborators: { ada: "owner", lin: "viewer" } }
```

A summary card and an access matrix are different _questions_, so they're different projections — but there's exactly one source of truth underneath. Need a third view tomorrow (an audit timeline, a share-count badge)? Write another projection over the same events. The stream never changes; the read models multiply for free.

## 🧽 A taste of right-to-forget

Suppose `owner` is personal data you must be able to erase. The redaction lives _next to the event_ — only `file.created.v1` understands its own payload — as a named, pure stripper:

```ts
FileCreatedV1.strip("gdpr", (payload) => ({ ...payload, owner: "[redacted]" }));

const forgotten = doc.strip("gdpr"); // a NEW aggregate — nothing mutated in place
FileSummary.build(forgotten); // → { name: "Q3 Roadmap.md", owner: "[redacted]", archived: true }
```

Projections need no special handling: they're pure derivations, so once the underlying events are stripped you just **rebuild** and the PII is gone from every read model automatically. In core this is the in-memory path; once events are persisted, `repo.forget(...)` overwrites the durable events _and_ bins the affected projections for you.

::: info The full erasure story
This is the one-paragraph taste. The persisted path — `repo.forget`, overwriting durable history, and rebuilding stored projections — gets the full treatment in [GDPR erasure](/examples/gdpr-erasure).
:::

## What you just saw

- **One aggregate, one stream of facts** about a single document, written as plain `create().creator(...)` events.
- **Two independent read models folded from that one stream** — a flat summary card, and an access-control list that _folds add/remove events into a derived map_. Different questions, one source of truth.
- **Unmapped topics are skipped** — each projection handles only the events it cares about.
- **The first folded event establishes the whole shape**; every other handler spreads `...current` and changes only what it owns.
- **Right-to-forget is a stripper next to the event plus a rebuild** — no per-projection erasure code.

Keep going:

- [Projections](/guide/projections) — the folding contract, resuming from a seed, and the errors `build` raises.
- [GDPR erasure](/examples/gdpr-erasure) — the full persisted right-to-forget story with `repo.forget`.
