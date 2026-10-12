/**
 * SimClock — the injected virtual clock for the simulation harness
 * (SIM-001 determinism law).
 *
 * LAWS:
 * - NO wall-clock reads anywhere in harness paths — `now()` is a pure
 *   function of the start offset plus explicit `advance()` calls.
 * - Monotonic: advancing by a non-positive amount is a typed error.
 * - Every recorded timestamp/latency in an IntegrationEffortRecord is
 *   derived from this clock, so replay (seed + manifest + host adapter
 *   id) reproduces byte-identical records.
 */

/** The injected clock port used by every harness component. */
export interface SimClock {
  /** Current virtual time in milliseconds (absolute, incl. start offset). */
  now(): number;
  /** Advance the virtual clock by `ms` (must be > 0). Returns the new time. */
  advance(ms: number): number;
  /** The configured start offset (virtual epoch of the run). */
  readonly startMs: number;
  /** The configured per-step advancement (host "think time" between steps). */
  readonly stepMs: number;
}

export class SimClockStepError extends Error {
  constructor(ms: number) {
    super(`SimClock.advance: step must be a positive finite number of ms, got ${ms}`);
    this.name = "SimClockStepError";
  }
}

/** Create a deterministic virtual clock. */
export function createSimClock(options: {
  readonly startMs?: number;
  readonly stepMs?: number;
}): SimClock {
  const startMs = options.startMs ?? 0;
  const stepMs = options.stepMs ?? 1_000;
  if (!Number.isInteger(startMs) || startMs < 0) {
    throw new Error(`createSimClock: startMs must be a non-negative integer, got ${startMs}`);
  }
  if (!Number.isInteger(stepMs) || stepMs < 1) {
    throw new Error(`createSimClock: stepMs must be a positive integer, got ${stepMs}`);
  }
  let current = startMs;
  return {
    startMs,
    stepMs,
    now: () => current,
    advance(ms: number): number {
      if (!Number.isFinite(ms) || ms <= 0) {
        throw new SimClockStepError(ms);
      }
      current += ms;
      return current;
    },
  };
}
