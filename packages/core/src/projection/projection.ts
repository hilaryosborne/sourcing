// The projection — a PURE builder (contract B, ratified). It is named, declares an output
// Zod schema (the read-model shape), binds the aggregate it reads, and registers a typed
// handler per event. `build` folds the aggregate's events through the handlers and
// validates the produced state against the schema on every build (FOUNDATION §Projections).
//
// Construction is imperative: `projection(name, model)` then `.aggregate(def)` then
// `.handle(eventDef, fn)` per event. Two wins over the prior shape: handlers key off the
// event DEFINITION, so `event.payload` is typed; and the projection carries a NAME, which
// is its identity in the persistence-layer projection store.
import type { ZodType } from "zod";
import type { EventDefinition } from "../event/event";
import type { EventEnvelopeV1Type } from "../event/event.schema";
import type { AggregateDefinition, AggregateInstance } from "../aggregate/aggregate";
import { ProjectionErrors } from "./projection.errors";

// The stored envelope, with its payload narrowed to a specific event's payload type. This
// is what a typed handler receives — `event.payload` is known, `event.created` / `.id` /
// `.position` etc. are still available.
export type TypedEvent<P> = Omit<EventEnvelopeV1Type, "payload"> & { payload: P };

// One topic's effect on the read-model. PURE and DETERMINISTIC (style §11) — no clock,
// no random, no IO, no id-gen. Immutable: spread to update, never mutate.
//
// `current` is typed as the COMPLETE State, not Partial — the handler signature promises a
// complete current. You keep that promise by seeding the full shape in your creating event
// (FOUNDATION §Projections). Break it — a first folded event that doesn't establish the
// shape — and you get a runtime validation failure the types did not catch. That sharp edge
// is the price of the ergonomic default (no `current.x | undefined` friction everywhere).
export type ProjectionMapper<State, P> = (current: State, event: TypedEvent<P>) => State;

export interface ProjectionDefinition<State> {
  name: string;
  schema: ZodType<State>;
  // Bind the aggregate this projection reads. handle() then validates that each event is
  // registered on it (else ProjectionErrors.EVENT_UNREGISTERED).
  aggregate: (definition: AggregateDefinition) => ProjectionDefinition<State>;
  // Register a mapper for one event, keyed by the event DEFINITION. The event definition is
  // no longer parameterized by payload (the ref-exact builder leaves the handle untyped), so
  // the mapper's payload is `unknown` by default — narrow it by supplying the head payload
  // type explicitly: `handle<FilePayload>(FileCreateV1, (cur, e) => …)`. Duplicate topic
  // within one projection → TOPIC_DUPLICATE; a structurally malformed mapper → MAPPER_INVALID.
  handle: <P = unknown>(event: EventDefinition, mapper: ProjectionMapper<State, P>) => ProjectionDefinition<State>;
  // Build the read-model by folding the aggregate's events (committed ++ staged, in
  // position order) through the handlers, validating against the model on every build.
  //   • Omit `from` → a full build. The CREATING event must establish the model's base
  //     shape; a first folded event that does not yield a schema-valid base fails
  //     validation, by design (there is no separate `initial`).
  //   • Pass a stored projection state as `from` → RESUME: the self-healing stale path
  //     imports only the delta into the aggregate and folds it over `from` instead of
  //     replaying from the first event (Scenario 2).
  build: (aggregate: AggregateInstance, from?: State) => State;
}

// The internal, payload-erased mapper record. The payload-typed ProjectionMapper is the
// caller's view; once registered we only ever apply it to a built envelope.
interface Handler<State> {
  topic: string;
  apply: (current: State, event: EventEnvelopeV1Type) => State;
}

// projection("projection.file.v1", FileModelV1)
//   .aggregate(FileAggregateV1)
//   .handle(FileCreateV1, (current, event) => ({ ... }))
const projection = <State>(name: string, schema: ZodType<State>): ProjectionDefinition<State> => {
  const byTopic = new Map<string, Handler<State>>();
  let bound: AggregateDefinition | undefined;
  const definition: ProjectionDefinition<State> = {
    name,
    schema,
    aggregate: (aggregateDefinition) => ((bound = aggregateDefinition), definition),
    handle: (event, mapper) => {
      if (!event || typeof event.topic !== "string" || typeof mapper !== "function")
        throw new Error(ProjectionErrors.MAPPER_INVALID);
      if (bound && !bound.topic(event.topic)) throw new Error(ProjectionErrors.EVENT_UNREGISTERED);
      if (byTopic.has(event.topic)) throw new Error(ProjectionErrors.TOPIC_DUPLICATE);
      byTopic.set(event.topic, { topic: event.topic, apply: mapper as Handler<State>["apply"] });
      return definition;
    },
    build: (aggregateInstance, from) => {
      let state = (from ?? {}) as State;
      const events = [...aggregateInstance.events.committed, ...aggregateInstance.events.staged].sort(
        (a, b) => (a.get.position() ?? 0) - (b.get.position() ?? 0),
      );
      for (const instance of events) {
        // consume() (not build()): mappers key off the head definition, so they require the
        // payload UPCAST to head. build() is the faithful stored form, for persistence only.
        const envelope = instance.consume();
        const handler = byTopic.get(envelope.topic);
        if (!handler) continue; // tolerate unmapped topics — still folds the rest
        state = handler.apply(state, envelope);
      }
      try {
        return schema.parse(state); // validated on EVERY build, not just the first
      } catch (cause) {
        throw new Error(ProjectionErrors.OUTPUT_INVALID, { cause });
      }
    },
  };
  return definition;
};

export default projection;
