// THE OBSERVABILITY SEAM — the single interface a consumer implements to wire the repository
// into their platform. It is the product: ship one console default, expect consumers to build
// plugins for Splunk, New Relic, OpenTelemetry, Datadog, whatever. Three deliberate stances,
// each load-bearing:
//
//   1. OBSERVABILITY ONLY. These are WordPress *action* hooks, never *filter* hooks — every
//      method returns void (or a Promise of void) and NOTHING it returns changes what the
//      library does. A plugin observes; it cannot redirect an append, swallow a conflict, or
//      alter a query. To change storage behaviour, build a storage adapter — not an observer.
//
//   2. ASYNC-FIRST, FIRE-AND-FORGET. console is synchronous; Splunk HEC and a New Relic agent
//      are not. So every method may return a Promise, and the library NEVER awaits it and
//      swallows any throw/rejection (see observe.ts). A slow or broken plugin can neither slow
//      nor break a storage operation. Delivery guarantees, if a consumer needs them, are the
//      plugin's concern (buffer/queue internally).
//
//   3. METADATA ONLY — a STRUCTURAL guarantee, not a convention. Hook/log data is constrained
//      to primitives (ObserverData), so an event PAYLOAD cannot be nested into a record. This
//      matters acutely for an event store: events carry PII, and right-to-forget erases it —
//      an observer that emitted payloads would exfiltrate PII into your telemetry backend AND
//      silently defeat forget (you can strip the event store; you cannot strip Splunk). The
//      type forbids it.
import type { StorageStream } from "../storage/storage.model";

// Log severity, mapped to the logger channel. Mirrors the console methods of the same name.
export type ObserverLevel = "error" | "warn" | "info" | "debug";

// The exhaustive set of observed operations — the 5 repository operations plus the 7 storage
// port calls the repository makes. Every one fires pre → success | failure (multi-step ones
// also fire progress). Switch on this in a hook to subscribe to a specific operation.
export type ObservedOp =
  | "create"
  | "load"
  | "commit"
  | "rebuild"
  | "forget"
  | "head"
  | "read"
  | "append"
  | "overwrite"
  | "loadProjection"
  | "saveProjection"
  | "deleteProjections";

// The lifecycle phase of a hook. `pre` fires before the work, `success`/`failure` after it
// (carrying the measured duration), and `progress` marks a step inside a multi-step operation
// (rebuild's chosen path, forget's stages) — the "during" hooks.
export type ObserverPhase = "pre" | "progress" | "success" | "failure";

// Structured metadata carried by hooks and log lines. PRIMITIVES ONLY, on purpose: this is
// what makes "no event payload in observability" a type-level guarantee rather than a promise
// (see the header note). Counts, positions, durations, flags — never a payload object.
export type ObserverData = Record<string, string | number | boolean | undefined>;

// The logging channel (the Splunk-shaped sink). Free-text-event + structured data, level per
// method — the house idiom is a `BRAND_EVENT_NAME` event key (e.g. "SOURCING_COMMIT_OK"). The
// library narrates pre/success at `debug` and failure at `error`, so this channel alone tells
// the whole story; a consumer can forward each line to Splunk as a structured event.
export interface Logger {
  error(event: string, data?: ObserverData): void | Promise<void>;
  warn(event: string, data?: ObserverData): void | Promise<void>;
  info(event: string, data?: ObserverData): void | Promise<void>;
  debug(event: string, data?: ObserverData): void | Promise<void>;
}

// The error-reporting channel (the New Relic-shaped sink). Unlike the logger and hooks, this
// carries the actual thrown value, so a consumer can hand it straight to an error tracker:
//   report: (r) => newrelic.noticeError(r.error, { op: r.op, code: r.code, stream: r.stream?.id })
// `code` is the mechanical error code when known (a StorageErrors / RepositoryErrors value);
// note VERSION_CONFLICT is EXPECTED and frequent (optimistic-concurrency retries) — filter it
// in your sink if you don't want it surfacing as an alert.
export interface ErrorReport {
  op: ObservedOp;
  stream?: StorageStream;
  error: unknown;
  code?: string;
}

interface HookCommon {
  op: ObservedOp;
  // The `BRAND_EVENT_NAME` event key for this hook, e.g. "SOURCING_APPEND_OK".
  code: string;
  // The stream the operation targets (id + aggregate name) — metadata, never the payload.
  stream?: StorageStream;
}

// An operation is about to run.
export interface HookPre extends HookCommon {
  phase: "pre";
}

// A "during" step of a multi-step operation (rebuild's path: no_stored / stale / current;
// forget's stages: loaded / stripped / overwritten / binned).
export interface HookProgress extends HookCommon {
  phase: "progress";
  step: string;
}

// An operation completed. `durationMs` is the profiling signal; `data` carries op-specific
// metadata (counts, positions, the rebuild path) — primitives only.
export interface HookSuccess extends HookCommon {
  phase: "success";
  durationMs: number;
  data?: ObserverData;
}

// An operation threw. `durationMs` is how long it ran before failing; `error` is the mechanical
// code (the Error object itself goes to the report channel, not here).
export interface HookFailure extends HookCommon {
  phase: "failure";
  durationMs: number;
  error: string;
}

// The lifecycle-hook channel (the profiling / metrics sink). A discriminated union over phase:
// switch on `event.phase` (and `event.op`) to time operations, count outcomes, and watch the
// self-healing cache-hit ratio (rebuild's progress step is its path).
export type HookEvent = HookPre | HookProgress | HookSuccess | HookFailure;

// The plugin. Every channel is OPTIONAL — implement only the sink you wire (logger for Splunk,
// report for New Relic, hook for metrics; any combination). When no observer is supplied to the
// repository, instrumentation is skipped entirely — the quiet default costs nothing.
export interface Observer {
  logger?: Logger;
  report?(report: ErrorReport): void | Promise<void>;
  hook?(event: HookEvent): void | Promise<void>;
}
