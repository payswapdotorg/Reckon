/**
 * EventStore PORT (ADR-001 port/adapter law).
 *
 * The port is the repository interface for append-oriented outcome
 * storage. Production persistence is a PostgreSQL adapter owned by a
 * LATER wave (W3-003 transport); this package ships only an in-memory
 * adapter explicitly labeled as test infrastructure.
 */
import type { Id, TenantScope, TimestampMs } from "@reckon/contracts";
import type { OutcomeEvent, SubjectReference, EvidenceClass } from "@reckon/contracts";
import { OBSERVED_EVIDENCE_CLASSES, RESEARCH_EVIDENCE_CLASSES } from "@reckon/contracts";

/** Inclusive occurrence-time range [fromMs, toMs] on `occurredAt`. */
export interface TimeRange {
  fromMs?: TimestampMs;
  toMs?: TimestampMs;
}

/**
 * An event as stored: the immutable contract record plus its
 * `contentDigest` (reproducible artifact lineage, ADR-001) and the
 * per-store append `sequence` (monotonic; deterministic tie-break).
 */
export interface StoredOutcomeEvent {
  readonly event: OutcomeEvent;
  readonly contentDigest: string;
  /** Monotonic per-store append order (1-based). Deterministic. */
  readonly sequence: number;
}

/** Result of `append`. */
export interface AppendResult {
  /** The stored event record (the ORIGINAL when `duplicate` is true). */
  readonly event: OutcomeEvent;
  /** Digest of the stored (original, when duplicate) event. */
  readonly contentDigest: string;
  /** True when the idempotencyKey was already observed in this tenant. */
  readonly duplicate: boolean;
  /** Present when `duplicate` — the eventId of the original record. */
  readonly originalEventId?: Id;
  /** Store sequence of the returned record. */
  readonly sequence: number;
}

/**
 * Evidence-class partition view. `observed()` yields only
 * observed-class records; `research()` yields only research-class
 * records. The two partitions are disjoint BY CONSTRUCTION (frozen
 * contract enums) — one class can never flow into the other's API
 * (contracts.md #9, architecture-lock #20, ADR-004).
 */
export const OBSERVED_CLASSES: readonly string[] = OBSERVED_EVIDENCE_CLASSES;
export const RESEARCH_CLASSES: readonly string[] = RESEARCH_EVIDENCE_CLASSES;

export function isObservedEvidenceClass(cls: EvidenceClass): boolean {
  return (OBSERVED_EVIDENCE_CLASSES as readonly string[]).includes(cls);
}

export function isResearchEvidenceClass(cls: EvidenceClass): boolean {
  return (RESEARCH_EVIDENCE_CLASSES as readonly string[]).includes(cls);
}

/**
 * EventStore PORT.
 *
 * Tenant isolation (contracts.md #5): every query takes the tenant
 * scope EXPLICITLY as its first argument — a cross-tenant read is
 * structurally impossible because no query accepts an unscoped
 * identifier.
 */
export interface EventStore {
  /**
   * Append an outcome event (append law, ADR-001 / contracts.md #8).
   *
   * - The record is validated against the frozen `OutcomeEventSchema`
   *   (unknown shapes rejected with `EventValidationError`).
   * - Idempotent per (tenant, idempotencyKey): a re-observation with the
   *   same key returns the ORIGINAL record with `duplicate: true` — a
   *   second record is never created.
   * - Reusing an eventId with a DIFFERENT idempotencyKey is rejected
   *   with `EventIdConflictError` (IDs are immutable, contracts #2).
   * - A correction carrying `correctsEventId` must reference an event
   *   that exists in the SAME tenant and the SAME evidence-class
   *   partition, else typed rejection.
   * - `occurredAt` (caller-supplied) is never overwritten; the stored
   *   record is a frozen defensive copy — callers cannot mutate the
   *   store through a previously returned reference.
   */
  append(event: OutcomeEvent): AppendResult;

  /** All events referencing a decision, in append order. Tenant-scoped. */
  getByDecision(tenant: TenantScope, decisionId: Id): readonly StoredOutcomeEvent[];

  /** Events for a subject (optionally time-ranged), in append order. */
  getBySubject(
    tenant: TenantScope,
    subject: SubjectReference,
    range?: TimeRange
  ): readonly StoredOutcomeEvent[];

  /** All events referencing an experience, in append order. Tenant-scoped. */
  getByExperience(tenant: TenantScope, experienceId: Id): readonly StoredOutcomeEvent[];

  /**
   * Sync iterator over ALL events in the tenant (optionally
   * time-ranged), in deterministic append order.
   */
  stream(tenant: TenantScope, range?: TimeRange): IterableIterator<StoredOutcomeEvent>;

  /**
   * Sync iterator over observed-class events only
   * (production-observed | staging | controlled-local). Research-class
   * records can never appear here.
   */
  observed(tenant: TenantScope, range?: TimeRange): IterableIterator<StoredOutcomeEvent>;

  /**
   * Sync iterator over research-class events only
   * (simulated | counterfactual | fixture). Observed-class records can
   * never appear here.
   */
  research(tenant: TenantScope, range?: TimeRange): IterableIterator<StoredOutcomeEvent>;
}
