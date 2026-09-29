/**
 * InMemoryContextStoreAdapter — test infrastructure, evidence class:
 * controlled-local.
 *
 * NOT production persistence (ADR-001: PostgreSQL is the authority; a
 * later wave owns the real transport). Explicitly constructed and
 * injectable — no hidden global mutable state.
 */
import {
  ContextSnapshotSchema,
  contentDigest,
  type ContextSnapshot,
  type Id,
  type SubjectReference,
  type TenantScope,
  type TimestampMs,
} from "@reckon/contracts";
import type {
  ContextSaveInput,
  ContextSaveResult,
  ContextStore,
  StoredContextSnapshot,
  TimeRange,
} from "./port.js";
import { ContextValidationError, toValidationIssues } from "./errors.js";

function tenantKey(tenant: TenantScope): string {
  return `${tenant.tenantId}|${tenant.workspaceId ?? ""}`;
}

function subjectKey(subject: SubjectReference): string {
  return `${subject.kind}:${subject.ref}`;
}

function inRange(at: TimestampMs, range: TimeRange | undefined): boolean {
  if (!range) return true;
  if (range.fromMs !== undefined && at < range.fromMs) return false;
  if (range.toMs !== undefined && at > range.toMs) return false;
  return true;
}

/** Ascending deterministic order: by (at, contextId). */
function compareByAtThenContextId(a: ContextSnapshot, b: ContextSnapshot): number {
  if (a.at !== b.at) return a.at - b.at;
  return a.contextId < b.contextId ? -1 : a.contextId > b.contextId ? 1 : 0;
}

/** Recursively freeze a plain record tree (immutability guarantee). */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

interface Entry {
  readonly tenant: string;
  readonly subjectKey: string;
  readonly stored: StoredContextSnapshot;
}

/**
 * In-memory ContextStore adapter. Construct one per scope:
 *
 * ```ts
 * const store = new InMemoryContextStoreAdapter();
 * ```
 */
export class InMemoryContextStoreAdapter implements ContextStore {
  private readonly entries: Entry[] = [];
  private readonly byContextId = new Map<string, number>(); // tenant|contextId -> index
  private readonly byDigest = new Map<string, number>(); // tenant|subject|digest -> index

  save(input: ContextSaveInput): ContextSaveResult {
    // 1. Validate against the frozen schema — unknown shapes get a
    //    typed error (never a raw string throw).
    const parsed = ContextSnapshotSchema.safeParse(input.snapshot);
    if (!parsed.success) {
      throw new ContextValidationError(
        "context snapshot failed ContextSnapshotSchema validation",
        toValidationIssues(parsed.error),
        input.snapshot
      );
    }

    // 2. Frozen defensive copy + deterministic digest over the full
    //    stored association (tenant, subject, snapshot).
    const frozen = deepFreeze(structuredClone(parsed.data));
    const digest = contentDigest({
      tenant: input.tenant,
      subject: input.subject,
      snapshot: frozen,
    });
    const stored: StoredContextSnapshot = Object.freeze({
      tenant: input.tenant,
      subject: input.subject,
      snapshot: frozen,
      contentDigest: digest,
    });

    // 3. Idempotent save of the identical association+snapshot.
    const tKey = tenantKey(input.tenant);
    const sKey = subjectKey(input.subject);
    const digestIndex = this.byDigest.get(`${tKey}|${sKey}|${digest}`);
    if (digestIndex !== undefined) {
      return { stored: this.entries[digestIndex]!.stored, duplicate: true };
    }

    // 4. contextId uniqueness within the tenant (contracts #2: IDs are
    //    immutable). Re-saving a DIFFERENT snapshot under an existing
    //    contextId is a validation-style rejection: contextIds never
    //    get rewritten.
    const idIndex = this.byContextId.get(`${tKey}|${frozen.contextId}`);
    if (idIndex !== undefined) {
      throw new ContextValidationError(
        `contextId ${frozen.contextId} already exists in tenant with different content — ids are immutable`,
        [{ path: "contextId", message: "already exists with different content", code: "conflict" }],
        input.snapshot
      );
    }

    const index = this.entries.length;
    this.entries.push(Object.freeze({ tenant: tKey, subjectKey: sKey, stored }));
    this.byContextId.set(`${tKey}|${frozen.contextId}`, index);
    this.byDigest.set(`${tKey}|${sKey}|${digest}`, index);

    return { stored, duplicate: false };
  }

  latest(subject: SubjectReference, tenant: TenantScope): StoredContextSnapshot | undefined {
    const matching = this.matching(subject, tenant, undefined);
    if (matching.length === 0) return undefined;
    // max by (at, contextId) — caller-supplied `at` wins, contextId is
    // the deterministic tie-break.
    let best = matching[0]!;
    for (const candidate of matching.slice(1)) {
      if (compareByAtThenContextId(best.snapshot, candidate.snapshot) <= 0) {
        best = candidate;
      }
    }
    return best;
  }

  get(contextId: Id, tenant: TenantScope): StoredContextSnapshot | undefined {
    const index = this.byContextId.get(`${tenantKey(tenant)}|${contextId}`);
    return index === undefined ? undefined : this.entries[index]!.stored;
  }

  history(
    subject: SubjectReference,
    tenant: TenantScope,
    range?: TimeRange
  ): readonly StoredContextSnapshot[] {
    const matching = this.matching(subject, tenant, range);
    return [...matching].sort((a, b) => compareByAtThenContextId(a.snapshot, b.snapshot));
  }

  private matching(
    subject: SubjectReference,
    tenant: TenantScope,
    range: TimeRange | undefined
  ): StoredContextSnapshot[] {
    const tKey = tenantKey(tenant);
    const sKey = subjectKey(subject);
    const out: StoredContextSnapshot[] = [];
    for (const entry of this.entries) {
      if (entry.tenant !== tKey) continue; // structural tenant isolation
      if (entry.subjectKey !== sKey) continue;
      if (!inRange(entry.stored.snapshot.at, range)) continue;
      out.push(entry.stored);
    }
    return out;
  }
}
