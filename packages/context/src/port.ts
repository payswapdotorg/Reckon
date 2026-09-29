/**
 * ContextStore PORT (ADR-001 port/adapter law).
 *
 * Subject/audience context state (W1-002). The frozen
 * `ContextSnapshot` contract carries NO subject/tenant fields, so the
 * port associates a snapshot with an explicit subject + tenant scope at
 * save time — the caller-supplied association is authoritative and is
 * the only way a snapshot becomes queryable (contracts.md #5: tenant
 * scope is explicit; ADR-003: identity remains host-owned).
 */
import type { Id, TenantScope, TimestampMs } from "@reckon/contracts";
import type { ContextSnapshot, SubjectReference } from "@reckon/contracts";

/** Inclusive `at`-time range [fromMs, toMs]. */
export interface TimeRange {
  fromMs?: TimestampMs;
  toMs?: TimestampMs;
}

/**
 * A saved context snapshot with its immutable association metadata and
 * its `contentDigest` over the canonical form of
 * `{ tenant, subject, snapshot }` (reproducible artifact lineage).
 */
export interface StoredContextSnapshot {
  readonly tenant: TenantScope;
  readonly subject: SubjectReference;
  readonly snapshot: ContextSnapshot;
  readonly contentDigest: string;
}

/** Input to `save` — snapshot plus its host-declared association. */
export interface ContextSaveInput {
  readonly tenant: TenantScope;
  readonly subject: SubjectReference;
  readonly snapshot: ContextSnapshot;
}

/** Result of `save`. */
export interface ContextSaveResult {
  readonly stored: StoredContextSnapshot;
  /** True when this exact (tenant, subject, snapshot) already existed. */
  readonly duplicate: boolean;
}

/**
 * ContextStore PORT.
 *
 * Determinism / no-future-leakage:
 * - `latest()` orders by the CALLER-SUPPLIED `snapshot.at`, tie-broken
 *   by `contextId` — never by save order.
 * - Stored snapshots are frozen defensive copies: a snapshot saved at
 *   T is never mutated by anything appended later.
 */
export interface ContextStore {
  /**
   * Validate (ContextSnapshotSchema — unknown shapes rejected with a
   * typed error) and store an immutable copy, associated with the
   * given subject and tenant.
   */
  save(input: ContextSaveInput): ContextSaveResult;

  /**
   * Most recent snapshot for the subject in the tenant, ordered by
   * `snapshot.at` (caller-supplied), tie-broken by `contextId`
   * (ascending; the max of that order wins). Undefined when none.
   */
  latest(subject: SubjectReference, tenant: TenantScope): StoredContextSnapshot | undefined;

  /** Snapshot by id within the tenant. Undefined when absent. */
  get(contextId: Id, tenant: TenantScope): StoredContextSnapshot | undefined;

  /**
   * All snapshots for the subject in the tenant (optionally
   * `at`-ranged), ordered ascending by (at, contextId) —
   * deterministic regardless of save order.
   */
  history(
    subject: SubjectReference,
    tenant: TenantScope,
    range?: TimeRange
  ): readonly StoredContextSnapshot[];
}
