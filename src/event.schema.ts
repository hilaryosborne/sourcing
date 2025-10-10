import { nanoid } from "nanoid";
import { z } from "zod";

export const EventSchemaV1 = z.object({
  id: z
    .string()
    .optional()
    .transform((val) => val ?? nanoid()),
  topic: z.string().min(1).max(100),
  creator: z
    .object({
      entity: z.enum(["self", "user", "system"]).default("user"),
      uid: z.string().min(1),
    })
    .default({ entity: "user", uid: "unknown" }),
  headers: z.record(z.string(), z.unknown()).default({}),
  aggregate: z
    .object({
      id: z.string().min(1),
      position: z.number().int().min(0),
    })
    .default({ id: "unknown", position: 0 }),
  position: z.number().int().min(0).default(0),
  payload: z.unknown(),
  created: z
    .string()
    .optional()
    .transform((val) => val ?? new Date().toISOString()),
});

export type EventSchemaV1Type = z.infer<typeof EventSchemaV1>;
