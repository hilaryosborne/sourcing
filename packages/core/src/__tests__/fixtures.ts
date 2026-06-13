// Shared test domain — a "file" aggregate. Constructed, not mocked: the core is pure,
// so real events / aggregates / projections are cheap to build (testing skill). The
// owner field stands in for PII so the stripper pass/fail test has something to redact.
import { object, string, number } from "zod";
import type { z } from "zod";
import event from "../event/event";
import aggregate from "../aggregate/aggregate";
import projection from "../projection/projection";
import type { CreatorSchemaV1Type } from "../event/event.schema";

export const FileCreatePayloadV1 = object({ name: string().min(1), owner: string().min(1) });
export const FileRenamePayloadV1 = object({ name: string().min(1) });
export type FileCreatePayloadV1Type = z.infer<typeof FileCreatePayloadV1>;
export type FileRenamePayloadV1Type = z.infer<typeof FileRenamePayloadV1>;

// Events — three-way lockstep (symbol ↔ topic ↔ what a real file would name them).
// FileCreateV1 carries a "gdpr" stripper that redacts the PII owner; FileRenameV1 has
// none, proving strip leaves unstripped events as faithful (new) copies.
export const FileCreateV1 = event("file.create.v1", FileCreatePayloadV1).strip("gdpr", (payload) => ({
  ...payload,
  owner: "[redacted]",
}));
export const FileRenameV1 = event("file.rename.v1", FileRenamePayloadV1);

export const FileAggregate = aggregate("file", [FileCreateV1, FileRenameV1]);

// Read-model: latest name + owner + a count of folded events.
export const FileReadModelV1 = object({
  name: string(),
  owner: string(),
  events: number().int().min(0),
});
export type FileReadModelV1Type = z.infer<typeof FileReadModelV1>;

export const FileProjection = projection({
  schema: FileReadModelV1,
  initial: { name: "", owner: "", events: 0 },
  handlers: [
    {
      topic: "file.create.v1",
      apply: (current, event) => {
        const payload = event.payload as FileCreatePayloadV1Type;
        return { ...current, name: payload.name, owner: payload.owner, events: current.events + 1 };
      },
    },
    {
      topic: "file.rename.v1",
      apply: (current, event) => {
        const payload = event.payload as FileRenamePayloadV1Type;
        return { ...current, name: payload.name, events: current.events + 1 };
      },
    },
  ],
});

export const creator: CreatorSchemaV1Type = { entity: "user", uid: "tester" };
