// The internal machinery that drives the observer seam: a fire-and-forget dispatcher, a
// per-operation tracer, a "during" step emitter, and a storage-port wrapper. None of this is
// exported from the package — consumers see the Observer interface and consoleObserver, never
// these. The whole point of routing every emission through `emit` is the guarantee promised in
// observer.interface.ts: an observer can never slow or break a storage operation.
import type { StorageI } from "../storage/storage.interface";
import type { StorageStream, StoredProjectionV1Type } from "../storage/storage.model";
import type { Observer, ObservedOp, ObserverData } from "./observer.interface";

const noop = (): void => {};

// Fire-and-forget. We do not await the observer (async sinks run detached), and we swallow
// both a synchronous throw and a rejected promise — a broken plugin is the plugin's problem,
// never the storage operation's. This is the single chokepoint that makes the seam safe.
export const emit = (call: () => void | Promise<void> | undefined): void => {
  try {
    const result = call();
    if (result && typeof (result as Promise<void>).then === "function") {
      (result as Promise<void>).then(noop, noop);
    }
  } catch {
    // swallowed by design — observability must never become a failure mode
  }
};

// camelCase op → SNAKE_CASE for the BRAND_EVENT_NAME key idiom (loadProjection → LOAD_PROJECTION).
const snake = (op: string): string => op.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
const key = (op: ObservedOp, suffix: string): string => `SOURCING_${snake(op)}${suffix}`;
// Stream metadata for every emission — id + aggregate name, never the payload.
const base = (stream?: StorageStream): ObserverData => ({ stream: stream?.id, aggregate: stream?.name });
// Mechanical errors are thrown as `new Error(StorageErrors.X)`, so the message IS the code.
const codeOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// Wrap one async operation, emitting pre → (success | failure) across all three channels with
// a measured duration. When no observer is wired this is a straight pass-through with ZERO
// overhead — the quiet default never pays for what it doesn't use.
export const track = async <T>(
  observer: Observer | undefined,
  op: ObservedOp,
  stream: StorageStream | undefined,
  work: () => Promise<T>,
  onSuccess?: (result: T) => ObserverData,
): Promise<T> => {
  if (!observer) return work();
  const start = Date.now();
  emit(() => observer.logger?.debug(key(op, ""), base(stream)));
  emit(() => observer.hook?.({ op, phase: "pre", code: key(op, ""), stream }));
  try {
    const result = await work();
    const durationMs = Date.now() - start;
    const data = onSuccess ? onSuccess(result) : undefined;
    emit(() => observer.logger?.debug(key(op, "_OK"), { ...base(stream), durationMs, ...data }));
    emit(() => observer.hook?.({ op, phase: "success", code: key(op, "_OK"), stream, durationMs, data }));
    return result;
  } catch (error) {
    const durationMs = Date.now() - start;
    const code = codeOf(error);
    emit(() => observer.logger?.error(key(op, "_FAIL"), { ...base(stream), durationMs, error: code }));
    emit(() => observer.report?.({ op, stream, error, code }));
    emit(() => observer.hook?.({ op, phase: "failure", code: key(op, "_FAIL"), stream, durationMs, error: code }));
    throw error;
  }
};

// Emit a "during" step for a multi-step operation (rebuild's chosen path; forget's stages).
export const step = (
  observer: Observer | undefined,
  op: ObservedOp,
  stream: StorageStream | undefined,
  name: string,
): void => {
  if (!observer) return;
  const code = key(op, `_${name.toUpperCase()}`);
  emit(() => observer.logger?.debug(code, { ...base(stream), step: name }));
  emit(() => observer.hook?.({ op, phase: "progress", code, stream, step: name }));
};

// Wrap a storage adapter so every port call the repository makes through it is observed, at the
// SAME boundary the repository already uses — adapters are NOT modified, observation lives at
// the port. Metadata only: counts, positions, found-flags; never an event payload or a stored
// projection's state.
export const instrument = (storage: StorageI, observer: Observer): StorageI => ({
  head: (stream) =>
    track(
      observer,
      "head",
      stream,
      () => storage.head(stream),
      (head) => ({ head }),
    ),
  read: (stream, after) =>
    track(
      observer,
      "read",
      stream,
      () => storage.read(stream, after),
      (events) => ({ count: events.length, after }),
    ),
  append: (stream, events, expectedHead) =>
    track(
      observer,
      "append",
      stream,
      () => storage.append(stream, events, expectedHead),
      () => ({
        count: events.length,
        expectedHead,
      }),
    ),
  overwrite: (stream, events) =>
    track(
      observer,
      "overwrite",
      stream,
      () => storage.overwrite(stream, events),
      () => ({ count: events.length }),
    ),
  loadProjection: (stream, name) =>
    track(
      observer,
      "loadProjection",
      stream,
      () => storage.loadProjection(stream, name),
      (found) => ({
        name,
        found: !!found,
      }),
    ),
  saveProjection: (stored: StoredProjectionV1Type) =>
    track(
      observer,
      "saveProjection",
      stored.aggregate,
      () => storage.saveProjection(stored),
      () => ({
        name: stored.name,
      }),
    ),
  deleteProjections: (stream) => track(observer, "deleteProjections", stream, () => storage.deleteProjections(stream)),
});
