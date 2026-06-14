// The staging dsl returned by aggregate.add(). This is the "stage → validate → emit"
// flow (coding-style §7, functional-dsl) expressed as a story:
//
//   aggregate.add(FileCreateV1).by(creator).message({ name })
//
// message() parses its payload immediately (fail fast, before anything commits),
// assigns the provisional position + aggregate reference + required creator, and
// pushes the new event onto the aggregate's STAGED set, returning the aggregate so further
// facts can be staged in one chain. Half-writing is the disaster this prevents.
import type { EventDefinition } from "../event/event";
import type { EventInstance } from "../event/event.instance";
import type { CreatorSchemaV1Type } from "../event/event.schema";
import type { AggregateInstance, AggregateState } from "./aggregate";
import { AggregateErrors } from "./aggregate.errors";

// Generic over the payload type of the event definition being staged, so message()
// is type-checked against that event's schema.
export interface StageDsl<P = unknown> {
  // Required: provenance for the immutable fact. Without it message() throws
  // AggregateErrors.MISSING_CREATOR.
  by: (creator: CreatorSchemaV1Type) => StageDsl<P>;
  // Optional decoration, defaults to empty if never called.
  headers: (headers: Record<string, unknown>) => StageDsl<P>;
  // Terminal: validate payload, mint + stage the event, return the aggregate.
  message: (payload: P) => AggregateInstance;
}

// The next provisional position: one past the highest the aggregate can see, 0 for empty.
// Two processes staging onto separately-loaded copies will both pick the same index —
// reconciling that is the repository's job, not core's (FOUNDATION §Events).
const nextPosition = (state: AggregateState): number => {
  const positions = [...state.committed, ...state.staged]
    .map((event) => event.get.position())
    .filter((position): position is number => position !== undefined);
  return positions.length ? Math.max(...positions) + 1 : 0;
};

export const stage = <P>(
  name: string,
  instance: AggregateInstance,
  state: AggregateState,
  definition: EventDefinition<P>,
): StageDsl<P> => {
  let creator: CreatorSchemaV1Type | undefined;
  let headers: Record<string, unknown> = {};
  const dsl: StageDsl<P> = {
    by: (next) => ((creator = next), dsl),
    headers: (next) => ((headers = next), dsl),
    message: (payload) => {
      if (!creator) throw new Error(AggregateErrors.MISSING_CREATOR);
      const event = definition.create(payload);
      event.set.position(nextPosition(state));
      event.set.aggregate({ id: instance.get.id(), name });
      event.set.creator(creator);
      event.set.headers(headers);
      state.staged.push(event as EventInstance);
      return instance;
    },
  };
  return dsl;
};
