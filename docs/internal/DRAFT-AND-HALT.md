# DRAFT-AND-HALT.md — The Review Protocol

**This is the most important operating rule in the repository. It applies to Epic 3 (core) and Epic 4 (persistence + adapters).**

---

## The rule

**You design in drafts and stop. Hilary rules. Then you build.**

Within the affected epics, you work up to — and stop at — the *design artefacts*. You do not implement. You do not test against the shapes. You surface the drafts and wait for an explicit go-ahead.

The interfaces and data models **are** the decisions. Implementation is downstream of decisions. The cheap, high-leverage moment for Hilary's judgment is *before* code, when a shape is still a draft that can be redlined — not after, when changing it means rewriting implementations and tests.

---

## What counts as a "design artefact" (these trigger a HALT)

- Interfaces and type signatures (event / aggregate / projection, strippers, the storage interface, the registry contract, the projection-store contract).
- Data models and the *shape* of Zod schemas (structure and fields visible; you may leave fine-grained validation detail to fill in after ratification, but the structure must be reviewable).
- The public API surface of any package.
- The self-healing algorithm expressed as **signature + described steps**, before it is code.

---

## How to draft

- Write the artefacts as **real files in their real home** — the actual `.ts` interface files — with implementations stubbed: `throw new Error("not implemented — awaiting ratification")`. This way the artefact Hilary approves *is* the artefact that ships; there is no translation gap between "the draft I blessed" and "the code that got written."
- No implementation behind the stubs. No tests yet.
- Then **HALT** and surface the drafts for review.

---

## The go-ahead is explicit and per-artefact

- Approval of one interface is **not** approval of the others. Approving the core event interface is not approval of the aggregate interface. Each contract is its own gate.
- "This looks good" is not a blanket "continue." Wait for a clear, specific go-ahead on the specific artefact before implementing *that* artefact.
- If Hilary brings a draft to chat for a deeper session, that is expected and good. Do not treat the halt as an obstacle to get past — it is the point.

---

## After ratification

Once an artefact is ratified: implement it to match the ratified shape exactly, write tests, and prove it. If implementation reveals the shape was wrong, **stop and resurface it** — do not silently change a ratified interface. A ratified shape that turns out flawed goes back through the gate; it is not yours to quietly revise.

---

## Why this is stated more than once

You are an agentic tool built to complete things. The pull toward "I'll just finish the implementation while I'm here" is strong and is exactly the instinct this protocol exists to stop. The rule appears in CLAUDE.md, here, and as a terminal step inside each affected epic in PLAN.md. The redundancy is deliberate: the cost of skipping the gate is precisely the expensive rework the gate prevents.

**HALT means halt. Surface the drafts. Wait.**