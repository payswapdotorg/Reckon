/**
 * InMemoryEventStoreAdapter — test infrastructure, evidence class:
 * controlled-local.
 *
 * NOT production persistence (ADR-001: PostgreSQL-compatible durable
 * persistence is the authority; a later wave owns the real transport).
 * Every store instance is explicitly constructed and injectable — no
 * hidden global mutable state.
 */
import {
  OutcomeEventSchema,
  contentDigest,
  type Id,
  type OutcomeEvent,
  type SubjectReference,
  type TenantScope,
} from "@reckon/contracts";
import type {
  AppendResult,
  EventStore,
  StoredOutcomeEvent,
  TimeRange,
} from "./port.js";
import { isObservedEvidenceClass, isResearchEvidenceClass } from "./port.js";
import {
  CorrectionCrossTenantError,
  CorrectionEvidenceClassMismatchError,
  CorrectionTargetNotFoundError,
  EventIdConflictError,
  EventValidationError,
  toValidationIssues,
} from "./errors.js";

/** Composite tenant key: tenantId (+ optional workspace). */
function tenantKey(tenant: TenantScope): string {
  return `${tenant.tenantId}|${tenant.workspaceId ?? ""}`;
}

/** Composite subject key (kind + ref are both part of identity). */
function subjectKey(subject: SubjectReference): string {
  return `${subject.kind}:${subject.ref}`;
}

function inRange(occurredAt: number, range: TimeRange | undefined): boolean {
  if (!range) return true;
  if (range.fromMs !== undefined && occurredAt < range.fromMs) return false;
  if (range.toMs !== undefined && occurredAt > range.toMs) return false;
  return true;
}

/** Recursively freeze a plain record tree (append-only guarantee). */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** A frozen internal record. */
interface FrozenRecord {
  readonly tenant: string;
  readonly subjectKey: string;
  readonly stored: StoredOutcomeEvent;
}

/**
 * In-memory EventStore adapter. Construct one per test/embedding scope:
 *
 * ```ts
 * const store = new InMemoryEventStoreAdapter();
 * ```
 */
export class InMemoryEventStoreAdapter implements EventStore {
  private readonly records: FrozenRecord[] = [];
  private readonly byIdempotency = new Map<string, number>(); // tenant|key -> records index
  private readonly byEventId = new Map<string, number>(); // tenant|eventId -> records index
  private nextSequence = 1;

  append(event: OutcomeEvent): AppendResult {
    // 1. Validate against the frozen schema — unknown shapes get a
    //    typed error, never a raw string throw.
    const parsed = OutcomeEventSchema.safeParse(event);
    if (!parsed.success) {
      throw new EventValidationError(
        "outcome event failed OutcomeEventSchema validation",
        toValidationIssues(parsed.error),
        event
      );
    }
    const record: OutcomeEvent = parsed.data;

    // 2. Idempotency (tenant-scoped): same key returns the original.
    const tKey = tenantKey(record.tenant);
    const idemIndex = this.byIdempotency.get(`${tKey}|${record.idempotencyKey}`);
    if (idemIndex !== undefined) {
      const original = this.records[idemIndex]!.stored;
      return {
        event: original.event,
        contentDigest: original.contentDigest,
        duplicate: true,
        originalEventId: original.event.eventId,
        sequence: original.sequence,
      };
    }

    // 3. eventId immutability (contracts #2): same eventId + different
    //    idempotency key is a conflict, not a duplicate.
    const evIndex = this.byEventId.get(`${tKey}|${record.eventId}`);
    if (evIndex !== undefined) {
      const existing = this.records[evIndex]!.stored.event;
      throw new EventIdConflictError(tKey, record.eventId, existing.idempotencyKey);
    }

    // 4. Correction verification (append law, contracts #8).
    if (record.correctsEventId !== undefined) {
      const targetIndex = this.byEventId.get(`${tKey}|${record.correctsEventId}`);
      if (targetIndex === undefined) {
        // Structural tenant isolation: the target may exist in ANOTHER
        // tenant. We surface that as an explicit cross-tenant error so a
        // misconfigured caller cannot silently rely on it.
        if (this.existsInAnyOtherTenant(record.tenant, record.correctsEventId)) {
          throw new CorrectionCrossTenantError(tKey, record.correctsEventId);
        }
        throw new CorrectionTargetNotFoundError(tKey, record.correctsEventId);
      }
      const target = this.records[targetIndex]!.stored.event;
      const targetObserved = isObservedEvidenceClass(target.evidenceClass);
      const correctionObserved = isObservedEvidenceClass(record.evidenceClass);
      if (targetObserved !== correctionObserved) {
        // Evidence-typing law: corrections may not link the observed
        // partition to the research partition.
        throw new CorrectionEvidenceClassMismatchError(
          tKey,
          record.correctsEventId,
          target.evidenceClass,
          record.evidenceClass
        );
      }
    }

    // 5. Store an immutable defensive copy with its contentDigest.
    //    `occurredAt` is the caller-supplied value — never rewritten.
    const frozen = deepFreeze(structuredClone(record));
    const digest = contentDigest(frozen);
    const stored: StoredOutcomeEvent = Object.freeze({
      event: frozen,
      contentDigest: digest,
      sequence: this.nextSequence,
    });
    const entry: FrozenRecord = Object.freeze({
      tenant: tKey,
      subjectKey: subjectKey(record.subject),
      stored,
    });
    const index = this.records.length;
    this.records.push(entry);
    this.byIdempotency.set(`${tKey}|${record.idempotencyKey}`, index);
    this.byEventId.set(`${tKey}|${record.eventId}`, index);
    this.nextSequence += 1;

    return {
      event: frozen,
      contentDigest: digest,
      duplicate: false,
      sequence: stored.sequence,
    };
  }

  getByDecision(tenant: TenantScope, decisionId: Id): readonly StoredOutcomeEvent[] {
    const tKey = tenantKey(tenant);
    return this.records
      .filter((r) => r.tenant === tKey && r.stored.event.decisionId === decisionId)
      .map((r) => r.stored);
  }

  getBySubject(
    tenant: TenantScope,
    subject: SubjectReference,
    range?: TimeRange
  ): readonly StoredOutcomeEvent[] {
    const tKey = tenantKey(tenant);
    const sKey = subjectKey(subject);
    return this.records
      .filter(
        (r) =>
          r.tenant === tKey &&
          r.subjectKey === sKey &&
          inRange(r.stored.event.occurredAt, range)
      )
      .map((r) => r.stored);
  }

  getByExperience(tenant: TenantScope, experienceId: Id): readonly StoredOutcomeEvent[] {
    const tKey = tenantKey(tenant);
    return this.records
      .filter((r) => r.tenant === tKey && r.stored.event.experienceId === experienceId)
      .map((r) => r.stored);
  }

  *stream(tenant: TenantScope, range?: TimeRange): IterableIterator<StoredOutcomeEvent> {
    yield* this.filterTenant(tenant, range);
  }

  *observed(tenant: TenantScope, range?: TimeRange): IterableIterator<StoredOutcomeEvent> {
    for (const rec of this.filterTenant(tenant, range)) {
      if (isObservedEvidenceClass(rec.event.evidenceClass)) yield rec;
    }
  }

  *research(tenant: TenantScope, range?: TimeRange): IterableIterator<StoredOutcomeEvent> {
    for (const rec of this.filterTenant(tenant, range)) {
      if (isResearchEvidenceClass(rec.event.evidenceClass)) yield rec;
    }
  }

  private *filterTenant(
    tenant: TenantScope,
    range: TimeRange | undefined
  ): IterableIterator<StoredOutcomeEvent> {
    const tKey = tenantKey(tenant);
    for (const record of this.records) {
      if (record.tenant !== tKey) continue;
      if (!inRange(record.stored.event.occurredAt, range)) continue;
      yield record.stored;
    }
  }

  private existsInAnyOtherTenant(request: TenantScope, eventId: Id): boolean {
    const requestKey = tenantKey(request);
    for (const record of this.records) {
      if (record.tenant !== requestKey && record.stored.event.eventId === eventId) return true;
    }
    return false;
  }
}
