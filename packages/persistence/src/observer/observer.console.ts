// The batteries-included observer — a quiet, level-filtered console logger. The ONE default we
// ship, and deliberately minimal: it implements the logger channel only. The report (New Relic)
// and hook (metrics) channels are for machine sinks a console has no use for, and leaving them
// unimplemented keeps console output to ONE line per beat rather than three. Because the
// library narrates pre/success at `debug` and failure at `error`, the logger alone tells the
// whole story.
//
// QUIET BY DEFAULT: the default level is `info`, which HIDES the per-operation `debug` beats and
// surfaces only failures (and any warnings). Pass `{ level: "debug" }` to see the full trace.
// And when no observer is given to the repository at all, nothing is emitted and no wrapping
// happens — silence costs nothing.
import type { Logger, Observer, ObserverData, ObserverLevel } from "./observer.interface";

const RANK: Record<ObserverLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export interface ConsoleObserverOptions {
  // Highest severity to print. Default "info" (failures + warnings + info; debug beats hidden).
  level?: ObserverLevel;
}

export const consoleObserver = (options?: ConsoleObserverOptions): Observer => {
  const threshold = RANK[options?.level ?? "info"];
  const at =
    (level: ObserverLevel) =>
    (event: string, data?: ObserverData): void => {
      if (RANK[level] > threshold) return;
      // The one sanctioned console use in the library: this IS the console logger. Every other
      // module routes through the injected Logger; here the sink is console by definition.
      // eslint-disable-next-line no-console
      console[level](event, data ?? {});
    };
  const logger: Logger = { error: at("error"), warn: at("warn"), info: at("info"), debug: at("debug") };
  return { logger };
};

export default consoleObserver;
