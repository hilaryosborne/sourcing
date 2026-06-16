// Cross-stream read models, proven end to end: events committed to MANY order streams via the
// real repository, folded into ONE "open orders" read model via the real processor over the
// in-memory feed. Covers the headline (many streams → one view), resumable/incremental catch-up,
// the idempotent no-op, the explicit-initial seed, unmapped-topic tolerance, and the read-model
// errors.
import { describe, it, expect } from "vitest";
import { object, number, record, string } from "zod";
import { event, aggregate } from "@hilaryosborne/sourcing";
import { repository } from "../../repository/repository";
import { readModel } from "../../read-model/read-model";
import { ReadModelErrors } from "../../read-model/read-model.errors";
import { processor } from "../processor";
import { memoryReadSide } from "../../__tests__/memory-readside";

// --- A tiny order domain (one aggregate definition; many instances = many streams) ---
const OrderPlaced = event("order.placed.v1").version(
  object({ customer: string().min(1), total: number().int().nonnegative() }),
);
const OrderDelivered = event("order.delivered.v1").version(object({}));

const Order = aggregate("order.v1");
Order.register(OrderPlaced);
Order.register(OrderDelivered);

// --- The CROSS-STREAM read model: open orders across every order stream, keyed by order id ---
const OpenOrdersV1 = object({ open: record(string(), number()), total: number() });
const makeOpenOrders = () =>
  readModel("readmodel.open-orders.v1", OpenOrdersV1, { open: {}, total: 0 })
    // `e.aggregate.id` is WHICH order — that's how a cross-stream view keys its rows.
    .on(OrderPlaced, (state, e) => {
      const open = { ...state.open, [e.aggregate.id]: e.payload.total };
      return { open, total: Object.values(open).reduce((a, b) => a + b, 0) };
    })
    .on(OrderDelivered, (state, e) => {
      const { [e.aggregate.id]: _gone, ...open } = state.open;
      return { open, total: Object.values(open).reduce((a, b) => a + b, 0) };
    });

// Commit one order (place, optionally deliver) to its own stream via the real repository.
const placeOrder = async (repo: ReturnType<typeof repository>, customer: string, total: number, deliver = false) => {
  const order = await repo.create(Order);
  order.events.add(OrderPlaced.create({ customer, total }).creator("user", customer));
  if (deliver) order.events.add(OrderDelivered.create({}).creator("system", "fulfilment"));
  await repo.commit(order);
  return order.id;
};

describe("cross-stream read model — many streams, one view", () => {
  it("folds OrderPlaced across THREE separate order streams into one open-orders view", async () => {
    const storage = memoryReadSide();
    const repo = repository({ storage });
    await placeOrder(repo, "ada", 100);
    await placeOrder(repo, "bes", 250);
    await placeOrder(repo, "cy", 75);

    const state = await processor({ feed: storage, store: storage }).catchUp(makeOpenOrders());

    expect(Object.keys(state.open)).toHaveLength(3);
    expect(state.total).toBe(425);
  });

  it("a delivered order leaves the open set; the cross-stream total reflects it", async () => {
    const storage = memoryReadSide();
    const repo = repository({ storage });
    await placeOrder(repo, "ada", 100);
    const delivered = await placeOrder(repo, "bes", 250, true); // placed AND delivered

    const state = await processor({ feed: storage, store: storage }).catchUp(makeOpenOrders());

    expect(state.open).not.toHaveProperty(delivered);
    expect(Object.keys(state.open)).toHaveLength(1);
    expect(state.total).toBe(100);
  });
});

describe("cross-stream read model — resumable catch-up", () => {
  it("a second catchUp folds ONLY the new events (incremental, from the checkpoint)", async () => {
    const storage = memoryReadSide();
    const repo = repository({ storage });
    const proc = processor({ feed: storage, store: storage });

    await placeOrder(repo, "ada", 100);
    const first = await proc.catchUp(makeOpenOrders());
    expect(first.total).toBe(100);

    // More orders arrive after the first catch-up.
    await placeOrder(repo, "bes", 250);
    await placeOrder(repo, "cy", 75);
    const second = await proc.catchUp(makeOpenOrders());

    expect(Object.keys(second.open)).toHaveLength(3);
    expect(second.total).toBe(425);
  });

  it("catchUp with no new events is an idempotent no-op (state unchanged)", async () => {
    const storage = memoryReadSide();
    const repo = repository({ storage });
    const proc = processor({ feed: storage, store: storage });
    await placeOrder(repo, "ada", 100);

    const once = await proc.catchUp(makeOpenOrders());
    const twice = await proc.catchUp(makeOpenOrders()); // feed hasn't advanced
    expect(twice).toEqual(once);
  });

  it("drains across multiple batches when batchSize is small", async () => {
    const storage = memoryReadSide();
    const repo = repository({ storage });
    for (let i = 0; i < 5; i++) await placeOrder(repo, `c${i}`, 10);

    const state = await processor({ feed: storage, store: storage }).catchUp(makeOpenOrders(), { batchSize: 2 });
    expect(Object.keys(state.open)).toHaveLength(5);
    expect(state.total).toBe(50);
  });
});

describe("cross-stream read model — folding rules", () => {
  it("an empty feed yields the explicit initial state", async () => {
    const storage = memoryReadSide();
    const state = await processor({ feed: storage, store: storage }).catchUp(makeOpenOrders());
    expect(state).toEqual({ open: {}, total: 0 });
  });

  it("tolerates unmapped topics — folds only the events it handles", async () => {
    const storage = memoryReadSide();
    const repo = repository({ storage });
    // A topic the read model does NOT handle also rides the firehose.
    const Ignored = event("noise.happened.v1").version(object({}));
    const Noisy = aggregate("noise.v1");
    Noisy.register(Ignored);
    const noise = await repo.create(Noisy);
    noise.events.add(Ignored.create({}).creator("system", "x"));
    await repo.commit(noise);
    await placeOrder(repo, "ada", 100);

    const state = await processor({ feed: storage, store: storage }).catchUp(makeOpenOrders());
    expect(state.total).toBe(100); // the noise event was skipped, the order folded
  });
});

describe("readModel — mechanical errors", () => {
  it("rejects two handlers for one topic (TOPIC_DUPLICATE)", () => {
    const rm = readModel("readmodel.dup.v1", OpenOrdersV1, { open: {}, total: 0 });
    rm.on(OrderPlaced, (s) => s);
    expect(() => rm.on(OrderPlaced, (s) => s)).toThrow(ReadModelErrors.TOPIC_DUPLICATE);
  });

  it("rejects a structurally malformed handler (MAPPER_INVALID)", () => {
    const rm = readModel("readmodel.bad.v1", OpenOrdersV1, { open: {}, total: 0 });
    // @ts-expect-error — a non-function handler is a programming error the factory catches.
    expect(() => rm.on(OrderPlaced, undefined)).toThrow(ReadModelErrors.MAPPER_INVALID);
  });

  it("a fold whose result fails the schema throws OUTPUT_INVALID", async () => {
    const storage = memoryReadSide();
    const repo = repository({ storage });
    await placeOrder(repo, "ada", 100);
    // total typed as a string by a buggy handler → fails the number() schema.
    const broken = readModel("readmodel.broken.v1", OpenOrdersV1, { open: {}, total: 0 }).on(
      OrderPlaced,
      (state, e) => ({ ...state, open: { ...state.open, [e.aggregate.id]: e.payload.total }, total: "nope" as never }),
    );
    await expect(processor({ feed: storage, store: storage }).catchUp(broken)).rejects.toThrow(
      ReadModelErrors.OUTPUT_INVALID,
    );
  });
});
