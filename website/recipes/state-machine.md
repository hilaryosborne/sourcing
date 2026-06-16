# 🚦 Modelling a state machine

Lifecycles — an order moving placed → paid → shipped → delivered, a document draft → review → published — are a natural fit for event sourcing. Each transition is an event; the current state is a fold; and the _rules_ about which transition is allowed live in your code, not the library.

## Events are the transitions

Model each transition as a past-tense fact:

```ts
export const OrderPlaced = event("order.placed");
OrderPlaced.version(1, object({ items: array(object({ sku: string(), qty: number() })), total: number() }));
export const OrderPaid = event("order.paid");
OrderPaid.version(1, object({ amount: number() }));
export const OrderShipped = event("order.shipped");
OrderShipped.version(1, object({ carrier: string(), tracking: string() }));
export const OrderCancelled = event("order.cancelled");
OrderCancelled.version(1, object({ reason: string() }));

export const Order = aggregate("order")
  .register(OrderPlaced)
  .register(OrderPaid)
  .register(OrderShipped)
  .register(OrderCancelled);
```

## The status is a fold

A projection folds the transitions into the current state. The **creating event seeds the shape** (the [first-event contract](/guide/projections)); every later handler advances it:

```ts
type OrderState = "placed" | "paid" | "shipped" | "delivered" | "cancelled";

export const OrderStatus = projection("order-status", object({ status: string(), paid: boolean() }))
  .aggregate(Order)
  .handle<{ total: number }>(OrderPlaced, (s, e) => ({ status: "placed", paid: false }))
  .handle<{ amount: number }>(OrderPaid, (s, e) => ({ ...s, status: "paid", paid: true }))
  .handle<{ carrier: string }>(OrderShipped, (s, e) => ({ ...s, status: "shipped" }))
  .handle<{ reason: string }>(OrderCancelled, (s, e) => ({ ...s, status: "cancelled" }));
```

## The transition guard is yours

The aggregate will happily stage a `shipped` before a `paid` — it enforces no order. The rule that you _can't ship an unpaid order_ is yours, and you check it with a [staged preview](/guide/use-cases#enforce-a-business-rule-without-a-rule-engine): stage the transition, fold the would-be state, and judge it before committing.

```ts
function ship(order: AggregateInstance, carrier: string, tracking: string) {
  order.events.add(OrderShipped.create({ carrier, tracking }).creator("system", "wms")); // staged
  const next = OrderStatus.build(order);

  if (!next.paid) {
    // YOUR rule: can't ship what isn't paid. Reject; never commit; the staged event evaporates.
    throw new Error("cannot ship an unpaid order");
  }
  order.events.commit(); // the transition is legal — keep it
}
```

This keeps the _machine_ (the legal transitions) in plain, testable code, while the library keeps the _history_ (every transition that actually happened). Want to add a "can't cancel a delivered order" rule tomorrow? It's another `if` over the folded state — no schema migration, and the full audit trail of how each order moved is already there.

## ➡️ Next

- [Order fulfillment example](/examples/order-fulfillment) — this pattern, end to end.
- [Projections](/guide/projections) — folding transitions into state.
- [Common use cases](/guide/use-cases#enforce-a-business-rule-without-a-rule-engine) — staged validation.
