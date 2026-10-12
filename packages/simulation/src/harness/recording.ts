/**
 * RecordingPort — wraps a ReckonPublicPort and records EVERY operation
 * call the harness makes, with deterministic virtual-clock latency,
 * seeded fault injection, and bounded, CLASSIFIED retries (SIM-001).
 *
 * MEASUREMENT MODEL (frozen — see docs/simulations/scorecard.md):
 * - Per-attempt latency is drawn from the run RNG (seeded): success
 *   attempts 5 + rng.below(45) virtual ms; faulted attempts 3 +
 *   rng.below(7) virtual ms.
 * - Retry backoff is a fixed formula: 10ms · 2^attempt (no RNG).
 * - `call.latencyMs` = total virtual ms from call start to completion,
 *   including backoff between retries.
 * - p50/p95 are computed over SUCCESSFUL call latencies only; failed
 *   calls are failure behavior (count/retried/exhausted), not latency.
 *
 * RETRY CLASSIFICATION (frozen): only TRANSIENT failures are retried —
 * injected transport faults and the SDK's transport/server-5xx error
 * codes. Deterministic request errors (contract validation, auth,
 * tenant/scope, idempotency conflict, 404) are terminal: they fail the
 * call immediately as `PortCallFailedError` — retrying a bad request
 * would waste measurement and mask a real contract gap.
 *
 * DETERMINISM: fault draws and latency draws come from the run-scoped
 * seeded RNG in call order — same seed + same call sequence ⇒ identical
 * call log ⇒ byte-identical effort records.
 */
import { isReckonSdkError } from "@reckon/sdk";
import type { Rng } from "../rng.js";
import type { SimClock } from "./clock.js";
import type { ReckonPublicPort, PortSdkMethod } from "./port.js";
import { PORT_OPERATIONS } from "./port.js";

/**
 * SDK error codes that are TRANSIENT (safe + meaningful to retry).
 * Everything else — client-side validation, auth, scope, tenant,
 * idempotency, 404, contract violations — is deterministic and terminal.
 */
export const RETRYABLE_SDK_ERROR_CODES: ReadonlySet<string> = new Set([
  "SDK_TRANSPORT_ERROR", // network-layer failure (fetch rejected / non-JSON / no content-type)
  "SDK_UNEXPECTED_ERROR_SHAPE", // response did not carry the typed error envelope (gateway-ish)
  "RATE_LIMIT_EXCEEDED", // 429 with retry-after — the canonical retryable server state
  "INTERNAL", // server 500
  "HANDLER_RESPONSE_INVALID", // server-side handler contract violation (500-class)
  "NOT_WIRED", // composition not mounted (503-class in production semantics)
]);

/** One recorded operation call (the raw measurement unit). */
export interface PortCallRecord {
  /** Public API operation id, e.g. "POST /v1/decisions". */
  readonly operation: string;
  /** SDK method path, e.g. "decisions.request". */
  readonly sdkMethod: string;
  /** Virtual clock (absolute) when the call started. */
  readonly startedAtMs: number;
  /** Total virtual ms from start to completion (success or terminal failure). */
  readonly latencyMs: number;
  /** Attempts made (faults + real attempts). */
  readonly attempts: number;
  readonly status: "ok" | "error";
  /** Terminal failure classification (failed calls only). */
  readonly errorCode?: string;
  /** Per-attempt virtual latencies, in attempt order. */
  readonly attemptLatenciesMs: readonly number[];
}

/** Typed error for an operation whose retry budget was exhausted. */
export class PortCallExhaustedError extends Error {
  constructor(
    public readonly sdkMethod: string,
    public readonly record: PortCallRecord,
    public readonly cause_: unknown,
  ) {
    super(
      `PortCallExhaustedError: ${sdkMethod} failed after ${record.attempts} attempt(s) (${record.errorCode ?? "unknown"})`,
    );
    this.name = "PortCallExhaustedError";
  }
}

/** Typed error for a NON-RETRYABLE terminal operation failure. */
export class PortCallFailedError extends Error {
  constructor(
    public readonly sdkMethod: string,
    public readonly record: PortCallRecord,
    public readonly cause_: unknown,
  ) {
    super(
      `PortCallFailedError: ${sdkMethod} failed terminally (${record.errorCode ?? "unknown"}); non-retryable`,
    );
    this.name = "PortCallFailedError";
  }
}

/** Success-attempt latency: 5 + rng.below(45) → [5, 49] virtual ms. */
export function drawSuccessLatencyMs(rng: Rng): number {
  return 5 + rng.nextBelow(45);
}

/** Faulted-attempt latency: 3 + rng.below(7) → [3, 9] virtual ms. */
export function drawFailureLatencyMs(rng: Rng): number {
  return 3 + rng.nextBelow(7);
}

/** Retry backoff before attempt n+1: 10 · 2^n virtual ms (fixed formula). */
export function retryBackoffMs(failedAttemptIndex: number): number {
  return 10 * 2 ** failedAttemptIndex;
}

/** Is this inner failure transient (retryable)? */
function isRetryableFailure(error: unknown): boolean {
  if (isReckonSdkError(error)) {
    return RETRYABLE_SDK_ERROR_CODES.has(error.code);
  }
  // Non-SDK errors from the port are treated as transport-class (the
  // port contract only rejects with SDK-typed or transport failures).
  return true;
}

/** Terminal error code for the record (SDK code when present). */
function terminalErrorCode(error: unknown): string {
  if (isReckonSdkError(error)) return error.code;
  return "PORT_FAILURE";
}

export interface RecordingPortConfig {
  readonly inner: ReckonPublicPort;
  readonly clock: SimClock;
  readonly rng: Rng;
  /** Probability [0,1] of an injected transport fault per attempt. */
  readonly faultRate: number;
  /** Maximum retries after the first attempt (0 = single attempt). */
  readonly maxRetries: number;
}

export interface RecordingPort extends ReckonPublicPort {
  /** Every call so far, in call order. */
  readonly calls: readonly PortCallRecord[];
}

/** Wrap a port with recording, seeded faults, and classified bounded retries. */
export function createRecordingPort(config: RecordingPortConfig): RecordingPort {
  const { inner, clock, rng, faultRate, maxRetries } = config;
  if (!(faultRate >= 0 && faultRate <= 1)) {
    throw new Error(`createRecordingPort: faultRate must be within [0,1], got ${faultRate}`);
  }
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new Error(`createRecordingPort: maxRetries must be a non-negative integer, got ${maxRetries}`);
  }
  const calls: PortCallRecord[] = [];

  async function call<T>(sdkMethod: PortSdkMethod, fn: () => Promise<T>): Promise<T> {
    const operation = PORT_OPERATIONS[sdkMethod];
    const startedAtMs = clock.now();
    const attemptLatencies: number[] = [];
    let attempts = 0;
    let lastError: unknown;

    while (attempts <= maxRetries) {
      attempts += 1;
      const faulted = faultRate > 0 && rng.nextFloat() < faultRate;
      const latency = faulted ? drawFailureLatencyMs(rng) : drawSuccessLatencyMs(rng);
      clock.advance(latency);
      attemptLatencies.push(latency);

      if (faulted) {
        lastError = new Error(`injected transport fault (${sdkMethod} attempt ${attempts})`);
      } else {
        try {
          const result = await fn();
          calls.push({
            operation,
            sdkMethod,
            startedAtMs,
            latencyMs: clock.now() - startedAtMs,
            attempts,
            status: "ok",
            attemptLatenciesMs: attemptLatencies,
          });
          return result;
        } catch (cause) {
          lastError = cause;
          if (!isRetryableFailure(cause)) {
            // Deterministic failure — terminal, never retried.
            const record: PortCallRecord = {
              operation,
              sdkMethod,
              startedAtMs,
              latencyMs: clock.now() - startedAtMs,
              attempts,
              status: "error",
              errorCode: terminalErrorCode(cause),
              attemptLatenciesMs: attemptLatencies,
            };
            calls.push(record);
            throw new PortCallFailedError(sdkMethod, record, cause);
          }
        }
      }
      // A retry follows → deterministic backoff gap on the virtual clock.
      if (attempts <= maxRetries) {
        clock.advance(retryBackoffMs(attempts - 1));
      }
    }

    const record: PortCallRecord = {
      operation,
      sdkMethod,
      startedAtMs,
      latencyMs: clock.now() - startedAtMs,
      attempts,
      status: "error",
      errorCode: "RETRY_BUDGET_EXHAUSTED",
      attemptLatenciesMs: attemptLatencies,
    };
    calls.push(record);
    throw new PortCallExhaustedError(sdkMethod, record, lastError);
  }

  return {
    calls,
    decisions: {
      request: (input) => call("decisions.request", () => inner.decisions.request(input)),
    },
    outcomes: {
      append: (event) => call("outcomes.append", () => inner.outcomes.append(event)),
    },
    preferences: {
      appendDelta: (delta) =>
        call("preferences.appendDelta", () => inner.preferences.appendDelta(delta)),
    },
    catalog: {
      upsertItem: (item) => call("catalog.upsertItem", () => inner.catalog.upsertItem(item)),
      upsertRealization: (realization) =>
        call("catalog.upsertRealization", () => inner.catalog.upsertRealization(realization)),
    },
    candidates: {
      submit: (set) => call("candidates.submit", () => inner.candidates.submit(set)),
    },
  };
}
