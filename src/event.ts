import type { z, ZodObject } from "zod";
import { EventSchemaV1, EventSchemaV1Type } from "./event.schema";

export type EventDataType<T extends string, P extends z.ZodTypeAny> = EventSchemaV1Type & {
  topic: T;
  payload: z.infer<P>;
};

export class EventBase<T extends string, P extends z.ZodTypeAny> {
  protected data: EventDataType<T, P>;
  constructor(
    public topic: T,
    public model: P,
    payload: z.input<P>,
  ) {
    this.data = EventSchemaV1.parse({ topic, payload: model.parse(payload) }) as EventDataType<T, P>;
  }
  public id(id: string) {
    this.data = EventSchemaV1.parse({ ...this.data, id }) as EventDataType<T, P>;
    return this;
  }
  public creator(entity: string, uid: string) {
    this.data = EventSchemaV1.parse({ ...this.data, creator: { entity: entity, uid } }) as EventDataType<T, P>;
    return this;
  }
  public headers(headers: Record<string, string>) {
    this.data = EventSchemaV1.parse({ ...this.data, headers }) as EventDataType<T, P>;
    return this;
  }
  public aggregate(id: string, position: number) {
    this.data = EventSchemaV1.parse({ ...this.data, aggregate: { id, position } }) as EventDataType<T, P>;
    return this;
  }
  public position(position: number) {
    this.data = EventSchemaV1.parse({ ...this.data, position }) as EventDataType<T, P>;
    return this;
  }
  public payload(payload: z.input<P>) {
    this.data = EventSchemaV1.parse({ ...this.data, payload: this.model.parse(payload) }) as EventDataType<T, P>;
    return this;
  }
  public created(created: string) {
    this.data = EventSchemaV1.parse({ ...this.data, created }) as EventDataType<T, P>;
    return this;
  }
  public toObject(): EventSchemaV1Type {
    return EventSchemaV1.parse(this.data);
  }
}

export class EventFactory<T extends string, M extends z.ZodTypeAny> {
  constructor(
    public topic: T,
    public model: M,
  ) {}

  public create(payload: z.input<M>): EventBase<T, M> {
    return new EventBase<T, M>(this.topic, this.model, payload);
  }
}

function event<T extends string, P extends z.ZodTypeAny>(topic: T, model: P): EventFactory<T, P> {
  return new EventFactory(topic, model);
}

export default event;
