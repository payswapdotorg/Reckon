/**
 * ObservabilityRecorder — the composition facade that turns frozen
 * contract objects into append-only, digest-stamped observability
 * records (W3-004).
 *
 * - Inputs are validated against the REAL frozen zod contracts
 *   (safeParse via the imported schemas); invalid inputs raise typed
 *   ObservabilityInputError — never raw throws.
 * - Latency is CALLER-computed from the injected clock (the apps/api
 *   wrapper measures handler execution); the record pins
 *   `latencySource: "injected-clock"` for honesty.
 * - Every record carries a `contentDigest` over its own content —
 *   identical content yields identical digests (stability law).
 */
import {
  DecisionRequestSchema,
  DecisionResultSchema,
  OutcomeEventSchema,
  ScheduleDeltaSchema,
  contentDigest,
} from "@reckon/contracts";
import type {
  DecisionRequest,
  DecisionResult,
  EvidenceClass,
  Id,
  OutcomeEvent,
  ScheduleAction,
  ScheduleDelta,
  TenantScope,
} from "@reckon/contracts";
import type {
  DecisionObservabilityRecord,
  ErrorObservabilityRecord,
  IntegrationCapabilityObservabilityRecord,
  ObservabilityRecord,
  OutcomeLinkageObservabilityRecord,
  SchedulerActionObservabilityRecord,
} from "./records.js";
import type { ObservabilitySink } from "./sink.js";
import { ObservabilityInputError } from "./errors.js";
import { toObservabilityIssues } from "./errors.js";

/** Injected time source (epoch ms) — deterministic replay in tests. */
export type ObservabilityClock = () => number;

/** Structural safeParse view (no zod coupling). */
interface Parseable<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: unknown };
}

function validate<T>(schema: Parseable<T>, input: unknown, label: string): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new ObservabilityInputError(`${label} failed its frozen contract validation`, toObservabilityIssues(result.error));
}

export interface ObservabilityRecorderOptions {
  readonly sink: ObservabilitySink;
  /** Injected clock — deterministic record timestamps. */
  readonly clock: ObservabilityClock;
  /** Record-id generator (default: crypto.randomUUID). */
  readonly idGenerator?: () => Id;
  /**
   * Honest evidence-class label stamped on every record. Default
   * "controlled-local" (this wave's wiring runs in controlled harnesses);
   * production deployments pass their real class.
   */
  readonly evidenceClass?: EvidenceClass;
}

export interface DecisionRecordInput {
  readonly request: DecisionRequest;
  /** Present when the handler succeeded. */
  readonly result?: DecisionResult;
  /** Present when the handler failed. */
  readonly error?: { readonly code: string; readonly message: string };
  /** Caller-computed from the injected clock (handler execution time). */
  readonly latencyMs: number;
}

export interface OutcomeRecordInput {
  readonly event: OutcomeEvent;
  readonly transportStatus?: "delivered" | "duplicate" | "buffered" | "failed";
}

export interface SchedulerActionRecordInput {
  readonly source: "decision" | "plan-create" | "plan-replan";
  readonly action: ScheduleAction;
  readonly tenant: TenantScope;
  readonly decisionId?: Id;
  readonly planId?: Id;
  /** The frozen ScheduleDelta that carries enqueue/dequeue/resume. */
  readonly scheduleDelta?: ScheduleDelta;
}

export interface IntegrationCapabilityRecordInput {
  readonly integration: string;
  readonly capability: string;
  readonly available: boolean;
  readonly detail?: string;
}

export interface ErrorRecordInput {
  readonly scope: string;
  readonly code: string;
  readonly message: string;
  readonly route?: string;
  readonly tenant?: TenantScope;
}

export class ObservabilityRecorder {
  readonly #sink: ObservabilitySink;
  readonly #clock: ObservabilityClock;
  readonly #idGenerator: () => Id;
  readonly #evidenceClass: EvidenceClass;

  constructor(options: ObservabilityRecorderOptions) {
    this.#sink = options.sink;
    this.#clock = options.clock;
    this.#idGenerator = options.idGenerator ?? (() => crypto.randomUUID());
    this.#evidenceClass = options.evidenceClass ?? "controlled-local";
  }

  /** Decision path: latency, policy version, uncertainty, cost, errors. */
  recordDecision(input: DecisionRecordInput): DecisionObservabilityRecord {
    const request = validate(DecisionRequestSchema as Parseable<DecisionRequest>, input.request, "decision request");
    const result =
      input.result !== undefined
        ? validate(DecisionResultSchema as Parseable<DecisionResult>, input.result, "decision result")
        : undefined;
    if (result === undefined && input.error === undefined) {
      throw new ObservabilityInputError("recordDecision requires either result or error", [
        { path: "", message: "result or error must be present", code: "custom" },
      ]);
    }

    const record: DecisionObservabilityRecord = {
      kind: "decision",
      recordId: this.#idGenerator(),
      recordedAt: this.#clock(),
      evidenceClass: this.#evidenceClass,
      contentDigest: "",
      tenant: request.tenant,
      requestId: request.requestId,
      ...(result !== undefined
        ? {
            decisionId: result.decisionId,
            action: result.action,
            policy: { policyId: result.policy.policyId, version: result.policy.version },
            uncertainty: result.uncertainty,
            cost: result.latency,
          }
        : {}),
      latencyMs: Math.max(0, Math.round(input.latencyMs)),
      latencySource: "injected-clock",
      status: result !== undefined ? "ok" : "error",
      ...(input.error !== undefined
        ? { errorCode: input.error.code, errorMessage: input.error.message }
        : {}),
    };
    return this.#append(record);
  }

  /** Outcome path: outcome eventId ↔ decision id linkage. */
  recordOutcome(input: OutcomeRecordInput): OutcomeLinkageObservabilityRecord {
    const event = validate(OutcomeEventSchema as Parseable<OutcomeEvent>, input.event, "outcome event");
    const record: OutcomeLinkageObservabilityRecord = {
      kind: "outcome-linkage",
      recordId: this.#idGenerator(),
      recordedAt: this.#clock(),
      evidenceClass: this.#evidenceClass,
      contentDigest: "",
      tenant: event.tenant,
      eventId: event.eventId,
      ...(event.decisionId !== undefined ? { decisionId: event.decisionId } : {}),
      ...(event.experienceId !== undefined ? { experienceId: event.experienceId } : {}),
      eventType: event.eventType,
      outcomeEvidenceClass: event.evidenceClass,
      linked: event.decisionId !== undefined,
      ...(input.transportStatus !== undefined ? { transportStatus: input.transportStatus } : {}),
    };
    return this.#append(record);
  }

  /** Scheduler path: HOLD/CONTINUE/QUEUE/SUGGEST/SWITCH/INTERRUPT/RESUME/END. */
  recordSchedulerAction(input: SchedulerActionRecordInput): SchedulerActionObservabilityRecord {
    const scheduleDelta =
      input.scheduleDelta !== undefined
        ? validate(ScheduleDeltaSchema as Parseable<ScheduleDelta>, input.scheduleDelta, "schedule delta")
        : undefined;
    const record: SchedulerActionObservabilityRecord = {
      kind: "scheduler-action",
      recordId: this.#idGenerator(),
      recordedAt: this.#clock(),
      evidenceClass: this.#evidenceClass,
      contentDigest: "",
      tenant: input.tenant,
      source: input.source,
      action: input.action,
      ...(input.decisionId !== undefined ? { decisionId: input.decisionId } : {}),
      ...(input.planId !== undefined ? { planId: input.planId } : {}),
      enqueuedCount: scheduleDelta?.enqueue.length ?? 0,
      dequeuedCount: scheduleDelta?.dequeue.length ?? 0,
      ...(scheduleDelta?.resumeCheckpoint !== undefined
        ? { interruptedExperienceId: scheduleDelta.resumeCheckpoint.experienceId }
        : {}),
    };
    return this.#append(record);
  }

  /** Integration capability: is a capability wired and usable. */
  recordIntegrationCapability(input: IntegrationCapabilityRecordInput): IntegrationCapabilityObservabilityRecord {
    const record: IntegrationCapabilityObservabilityRecord = {
      kind: "integration-capability",
      recordId: this.#idGenerator(),
      recordedAt: this.#clock(),
      evidenceClass: this.#evidenceClass,
      contentDigest: "",
      integration: input.integration,
      capability: input.capability,
      available: input.available,
      ...(input.detail !== undefined ? { detail: input.detail } : {}),
    };
    return this.#append(record);
  }

  /** Error path: route/handler/transport/sink/sdk failures. */
  recordError(input: ErrorRecordInput): ErrorObservabilityRecord {
    const record: ErrorObservabilityRecord = {
      kind: "error",
      recordId: this.#idGenerator(),
      recordedAt: this.#clock(),
      evidenceClass: this.#evidenceClass,
      contentDigest: "",
      scope: input.scope,
      code: input.code,
      message: input.message,
      ...(input.route !== undefined ? { route: input.route } : {}),
      ...(input.tenant !== undefined ? { tenant: input.tenant } : {}),
    };
    return this.#append(record);
  }

  #append<T extends ObservabilityRecord>(record: T): T {
    // Digest over the record content WITHOUT the digest field
    // (deterministic canonical JSON → sha256).
    const { contentDigest: _ignored, ...content } = record;
    const stamped = deepFreeze({ ...record, contentDigest: contentDigest(content) }) as T;
    this.#sink.record(stamped);
    return stamped;
  }
}

/** Recursively freeze a record tree (append-only guarantee). */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
