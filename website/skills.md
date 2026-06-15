# 🤖 Skills for AI assistants

You probably aren't building alone. You're building with Claude, Cursor, Copilot, or whatever assistant sits in your editor — and an assistant is only as good as the context it has. Point it at a half-remembered blog post and it'll hallucinate an API that doesn't exist. Point it at **a skill** and it writes idiomatic `sourcing` code on the first try.

A **skill** is a single Markdown file — exact signatures, the real error tables, the sharp edges, the house patterns — written to be loaded straight into an AI assistant. They're the same curated knowledge these docs are built from, packaged for a machine reader. This page is how you get them into yours.

::: tip Why this exists
Documentation in the AI age has two readers: the human skimming for the gist, and the assistant that needs to be _right_. The guides on this site serve the first; these skills serve the second. Same truth, two shapes.
:::

## The skills

| Skill                | What your assistant learns                                                                        | Read it                                     | Grab the file                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Concepts**         | The mental model — aggregate / repository / adapter, staged events, self-healing, right-to-forget | [Concepts](/concepts)                       | [`sourcing-concepts.md`](https://hilaryosborne.github.io/sourcing/skills/sourcing-concepts.md)           |
| **Events**           | Defining events, the fluent builder, strippers, the mechanical errors                             | [Events](/guide/events)                     | [`using-events.md`](https://hilaryosborne.github.io/sourcing/skills/using-events.md)                     |
| **Aggregates**       | Registering events, staging, the committed/staged split, staged validation                        | [Aggregates](/guide/aggregates)             | [`using-aggregates.md`](https://hilaryosborne.github.io/sourcing/skills/using-aggregates.md)             |
| **Projections**      | The builder, typed handlers, the first-event-shape contract, the errors                           | [Projections](/guide/projections)           | [`using-projections.md`](https://hilaryosborne.github.io/sourcing/skills/using-projections.md)           |
| **Storage adapters** | Wiring Postgres/Mongo/S3, the client ports, observability, the preconditions                      | [Storage adapters](/guide/storage-adapters) | [`using-storage-adapters.md`](https://hilaryosborne.github.io/sourcing/skills/using-storage-adapters.md) |

Each "Grab the file" link is the raw skill, hosted right here on the site — copy it, download it, or fetch it from your tooling.

## Install them in your assistant

::: code-group

```sh [Claude Code]
# Drop each skill into your project's .claude/skills/ — Claude Code auto-loads them.
mkdir -p .claude/skills/sourcing
for s in sourcing-concepts using-events using-aggregates using-projections using-storage-adapters; do
  mkdir -p ".claude/skills/$s"
  curl -fsSL "https://hilaryosborne.github.io/sourcing/skills/$s.md" -o ".claude/skills/$s/SKILL.md"
done
```

```md [Cursor / Windsurf]
<!-- Add the skills as project rules/context. Paste a skill's contents into a .cursor/rules
     file (or your editor's rules panel), or reference the hosted URL, e.g.: -->

Use @sourcing per https://hilaryosborne.github.io/sourcing/skills/using-events.md
```

```text [Any assistant]
Point your assistant at the docs or a specific skill URL and ask it to follow it:

  "Read https://hilaryosborne.github.io/sourcing/skills/using-projections.md and
   write a projection for my domain following it exactly."

Or hand it the whole-docs index for LLMs (see below).
```

:::

## `llms.txt` — the whole docs, machine-readable

This site publishes an **[`llms.txt`](/llms.txt)** — the [emerging convention](https://llmstxt.org) for giving language models a clean index of a site's documentation. Hand it to any assistant that supports it, or just include the URL in a prompt, and it gets a curated map of every guide, example, and skill here.

```text
https://hilaryosborne.github.io/sourcing/llms.txt
```

## Keep them honest

These skills are generated from the canonical source in the repo ([`docs/skills/`](https://github.com/hilaryosborne/sourcing/tree/main/docs/skills)) and synced into the site on every build — so the file your assistant grabs is never out of date with the library it describes.
