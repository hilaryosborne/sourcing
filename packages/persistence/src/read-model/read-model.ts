// A CROSS-STREAM read model — a pure fold over the firehose of events from MANY aggregates,
// into one denormalised view (an order list, a search index, a dashboard). The counterpart to
// core's single-stream `projection`, and deliberately different in one load-bearing way:
//
//   A projection folds ONE aggregate's stream and relies on its CREATING event (`*.opened`) to
//   establish the model's shape — the "first folded event establishes the shape" contract. A
//   cross-stream read model has NO creating event: it exists before any stream does (an empty
//   list, an empty index). So its shape MUST be seeded explicitly, hence the required `initial`.
//   The asymmetry falls straight out of "one stream has a beginning; the firehose does not."
//
// Pure mechanism: no storage, no clock, no IO. The processor wires this to a feed + a checkpoint
// store; here we only fold and validate. (Design: docs/internal/design/cross-stream-read-models.md.)
import type { EventDefinition, EventEnvelopeV1Type, TypedEvent } from "@hilaryosborne/sourcing";
import type { ZodType } from "zod";
import { ReadModelErrors } from "./read-model.errors";

// A handler folds one event into the running state. It receives the TYPED event envelope — so
// `event.payload` is known from the event definition, and `event.aggregate` tells the read model
// WHICH stream (order, document, …) this event came from. That stream reference is how a
// cross-stream view keys its rows.
export type ReadModelHandler<State, P> = (state: State, event: TypedEvent<P>) => State;

export interface ReadModelDefinition<State> {
  // The read model's identity in the read-model store (its checkpoint + state are keyed by it).
  name: string;
  // The output schema — validated on every fold.
  schema: ZodType<State>;
  // The seed. Unlike a projection, a cross-stream read model is seeded explicitly (see header).
  initial: State;
  // Register a handler for one event, keyed by the event DEFINITION. The event definition is
  // no longer parameterized by payload (the ref-exact builder leaves the handle untyped), so
  // the handler's payload is `unknown` by default — narrow it by supplying the head payload
  // type explicitly: `on<OrderPayload>(OrderPlaced, (s, e) => …)`. Duplicate topic →
  // TOPIC_DUPLICATE; a structurally malformed handler → MAPPER_INVALID.
  on: <P = unknown>(event: EventDefinition, handler: ReadModelHandler<State, P>) => ReadModelDefinition<State>;
  // Fold a flat sequence of events (from any streams, in feed order) over a starting state
  // (defaults to `initial`), validating the result against the schema. Unmapped topics are
  // tolerated — the firehose carries every topic; a read model folds only the ones it cares
  // about. Idempotent if your handlers are (the processor is at-least-once; see the design doc).
  fold: (events: EventEnvelopeV1Type[], from?: State) => State;
}

// readModel(name, schema, initial) — define a cross-stream read model. Chain `.on(...)` to add
// handlers, then `.fold(...)` (or hand it to a `processor` to keep current from a feed).
export const readModel = <State>(name: string, schema: ZodType<State>, initial: State): ReadModelDefinition<State> => {
  const byTopic = new Map<string, (state: State, event: EventEnvelopeV1Type) => State>();

  const definition: ReadModelDefinition<State> = {
    name,
    schema,
    initial,

    on: (event, handler) => {
      if (!event || typeof handler !== "function") throw new Error(ReadModelErrors.MAPPER_INVALID);
      if (byTopic.has(event.topic)) throw new Error(ReadModelErrors.TOPIC_DUPLICATE);
      // The handler is typed against P at the call site; store it against the raw envelope (the
      // topic guarantees the payload shape at fold time, exactly as core's projection does).
      byTopic.set(event.topic, handler as (state: State, event: EventEnvelopeV1Type) => State);
      return definition;
    },

    fold: (events, from) => {
      let state = from ?? initial;
      for (const event of events) {
        const handler = byTopic.get(event.topic);
        if (!handler) continue; // tolerate unmapped topics — the firehose carries everything
        state = handler(state, event);
      }
      try {
        return schema.parse(state);
      } catch (cause) {
        throw new Error(ReadModelErrors.OUTPUT_INVALID, { cause });
      }
    },
  };

  return definition;
};

export default readModel;
