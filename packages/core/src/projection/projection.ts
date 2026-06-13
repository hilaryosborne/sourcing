// The projection — a PURE builder. An output Zod schema (the read-model shape) plus
// mappers keyed by topic. build() folds events through the mappers and validates the
// produced state against the schema on every build (FOUNDATION §Projections).
// Projections hold no independent truth: throw one away and rebuild it at any time.
import type { ZodType } from "zod";
import type { EventInstance } from "../event/event.instance";
import type { EventEnvelopeV1Type } from "../event/event.schema";
import { ProjectionErrors } from "./projection.errors";

// A mapper: one topic's effect on the read-model. PURE and DETERMINISTIC (style §11)
// — no clock, no random, no IO, no id-gen. It reads nondeterministic values back from
// the event; it never generates them. Immutable: spread to update, never mutate.
export interface ProjectionHandler<State> {
  topic: string;
  apply: (current: State, event: EventEnvelopeV1Type) => State;
}

// What you pass to projection(): the output schema, the seed state, and the mappers.
export interface ProjectionConfig<State> {
  schema: ZodType<State>;
  initial: State;
  handlers: ProjectionHandler<State>[];
}

export interface ProjectionDefinition<State> {
  schema: ZodType<State>;
  // Fold events → read-model, then parse against `schema`. An unmapped topic returns
  // `current` unchanged (tolerate the unknown — never throw; topics accrue over time).
  // The Scenario 3 staged overlay is just: pass committed ++ staged here. Scenario 1
  // "projection on demand" is: pass any event set here. Same fold, different source.
  build: (events: EventInstance[]) => State;
}

// projection({ schema: FileReadModelV1, initial, handlers: [HandleFileCreateV1, …] })
const projection = <State>({ schema, initial, handlers }: ProjectionConfig<State>): ProjectionDefinition<State> => {
  const byTopic = new Map<string, ProjectionHandler<State>>();
  for (const handler of handlers) {
    if (!handler || typeof handler.topic !== "string" || typeof handler.apply !== "function")
      throw new Error(ProjectionErrors.MAPPER_INVALID);
    if (byTopic.has(handler.topic)) throw new Error(ProjectionErrors.TOPIC_DUPLICATE);
    byTopic.set(handler.topic, handler);
  }
  const build = (events: EventInstance[]): State => {
    let state = initial;
    for (const instance of events) {
      const event = instance.build();
      const handler = byTopic.get(event.topic);
      if (!handler) continue; // tolerate unknown topics — still folds the rest
      state = handler.apply(state, event);
    }
    try {
      return schema.parse(state); // validated on EVERY build, not just the first
    } catch (cause) {
      throw new Error(ProjectionErrors.OUTPUT_INVALID, { cause });
    }
  };
  return { schema, build };
};

export default projection;
