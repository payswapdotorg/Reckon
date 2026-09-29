/**
 * InMemoryPreferenceStoreAdapter — test infrastructure, evidence class:
 * controlled-local.
 *
 * NOT production persistence (ADR-001: PostgreSQL is the authority; a
 * later wave owns the real transport). Explicitly constructed and
 * injectable — no hidden global mutable state.
 *
 * Architecture: the FULL delta log is the single source of truth.
 * Reads are deterministic FOLDS of the (possibly time-filtered) log:
 *   - `dimensions()` / `snapshot()` without `at` fold the entire log;
 *   - `snapshot(at)` folds ONLY deltas with `timestamp <= at`
 *     (no-future-leakage / deterministic replay).
 */
import {
  PreferenceDeltaSchema,
  type PreferenceDelta,
  type SubjectReference,
  type TenantScope,
  type TimestampMs,
} from "@reckon/contracts";
import type {
  PreferenceApplyResult,
  PreferenceDimensionView,
  PreferenceLogEntry,
  PreferenceScopeFilter,
  PreferenceScopeRoute,
  PreferenceSnapshot,
  PreferenceStore,
  SituationalPreferenceDimensionView,
} from "./port.js";
import {
  deltaDigest,
  foldPreferenceState,
  isDimensionLiveAt,
  routeDelta,
  slotKeyOf,
  snapshotValueAt,
  type DimensionState,
} from "./state.js";
import {
  PreferenceDeltaConflictError,
  PreferenceValidationError,
  toValidationIssues,
} from "./errors.js";

function tenantKey(tenant: TenantScope): string {
  return `${tenant.tenantId}|${tenant.workspaceId ?? ""}`;
}

function subjectKey(subject: SubjectReference): string {
  return `${subject.kind}:${subject.ref}`;
}

/** A subject's retained delta log (append-only, full history). */
interface SubjectLog {
  log: PreferenceLogEntry[];
}

interface AppliedIndex {
  digest: string;
  result: PreferenceApplyResult;
}

/** Recursively freeze a plain record tree. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

function stableView(state: DimensionState): PreferenceDimensionView {
  return Object.freeze({
    dimension: state.dimension,
    value: state.value,
    confidence: state.confidence,
    model: Object.freeze({ ...state.model }),
    updatedAt: state.lastWriteAt,
    deltaCount: state.deltaCount,
  });
}

function situationalView(state: DimensionState): SituationalPreferenceDimensionView {
  return Object.freeze({
    dimension: state.dimension,
    value: state.value,
    confidence: state.confidence,
    model: Object.freeze({ ...state.model }),
    updatedAt: state.lastWriteAt,
    deltaCount: state.deltaCount,
    contextScope: Object.freeze({
      ...(state.contextKind !== undefined ? { contextKind: state.contextKind } : {}),
      ...(state.contextId !== undefined ? { contextId: state.contextId } : {}),
    }),
  });
}

function matchesScopeFilter(route: PreferenceScopeRoute, filter: PreferenceScopeFilter): boolean {
  if (filter === "all") return true;
  if (filter === "stable") return route === "stable";
  return route === "situational";
}

function byDimensionName(
  a: { dimension: string },
  b: { dimension: string }
): number {
  return a.dimension < b.dimension ? -1 : a.dimension > b.dimension ? 1 : 0;
}

/**
 * In-memory PreferenceStore adapter. Construct one per scope:
 *
 * ```ts
 * const store = new InMemoryPreferenceStoreAdapter();
 * ```
 */
export class InMemoryPreferenceStoreAdapter implements PreferenceStore {
  /** tenantKey|subjectKey -> retained delta log. */
  private readonly subjects = new Map<string, SubjectLog>();
  /** tenantKey|deltaId -> applied index (idempotency). */
  private readonly applied = new Map<string, AppliedIndex>();
  private nextSequence = 1;

  apply(delta: PreferenceDelta): PreferenceApplyResult {
    // 1. Validate against the frozen schema — typed error on bad shape.
    const parsed = PreferenceDeltaSchema.safeParse(delta);
    if (!parsed.success) {
      throw new PreferenceValidationError(
        "preference delta failed PreferenceDeltaSchema validation",
        toValidationIssues(parsed.error),
        delta
      );
    }
    const record: PreferenceDelta = parsed.data;
    const tKey = tenantKey(record.tenant);
    const sKey = subjectKey(record.subject);

    // 2. Per-(tenant, deltaId) idempotency: identical re-apply returns
    //    the original result; deltaId reuse with different content is a
    //    typed conflict (IDs are immutable).
    const digest = deltaDigest(record);
    const appliedIndex = this.applied.get(`${tKey}|${record.deltaId}`);
    if (appliedIndex !== undefined) {
      if (appliedIndex.digest !== digest) {
        throw new PreferenceDeltaConflictError(tKey, record.deltaId);
      }
      return { ...appliedIndex.result, duplicate: true };
    }

    // 3. Append to the retained log, then advance the fold to compute
    //    this apply's result (last-writer-wins per dimension/slot).
    const subjectLog = this.subjectLogFor(tKey, sKey);
    subjectLog.log.push(
      Object.freeze({
        delta: deepFreeze(structuredClone(record)),
        contentDigest: digest,
        routedScope: routeDelta(record),
        sequence: this.nextSequence,
      })
    );
    this.nextSequence += 1;

    const { stable, situational } = foldPreferenceState(
      subjectLog.log.map((entry) => entry.delta)
    );
    const route = routeDelta(record);
    const store = route === "stable" ? stable : situational;
    const slotKey = slotKeyOf(record);
    const state = store.get(slotKey)!;

    const result: PreferenceApplyResult = Object.freeze({
      routedScope: route,
      dimension: record.dimension,
      value: state.value,
      confidence: state.confidence,
      removed: state.removed,
      duplicate: false,
      model: Object.freeze({ modelId: record.model.modelId, version: record.model.version }),
    });
    this.applied.set(`${tKey}|${record.deltaId}`, { digest, result });
    return result;
  }

  snapshot(
    subject: SubjectReference,
    tenant: TenantScope,
    at?: TimestampMs
  ): PreferenceSnapshot {
    const tKey = tenantKey(tenant);
    const sKey = subjectKey(subject);
    const subjectLog = this.subjects.get(`${tKey}|${sKey}`);

    // No-future-leakage: fold only deltas timestamped at or before `at`.
    const relevant =
      subjectLog?.log.filter(
        (entry) => at === undefined || entry.delta.timestamp <= at
      ) ?? [];
    const { stable, situational } = foldPreferenceState(relevant.map((e) => e.delta));

    const stableViews: PreferenceDimensionView[] = [];
    const situationalViews: SituationalPreferenceDimensionView[] = [];
    for (const dim of stable.values()) {
      if (dim.removed) continue;
      if (at !== undefined && !isDimensionLiveAt(dim, at)) continue;
      stableViews.push(
        at === undefined ? stableView(dim) : stableView({ ...dim, value: snapshotValueAt(dim, at) })
      );
    }
    for (const dim of situational.values()) {
      if (dim.removed) continue;
      if (at !== undefined && !isDimensionLiveAt(dim, at)) continue;
      situationalViews.push(
        at === undefined
          ? situationalView(dim)
          : situationalView({ ...dim, value: snapshotValueAt(dim, at) })
      );
    }
    stableViews.sort(byDimensionName);
    situationalViews.sort(byDimensionName);

    return Object.freeze({
      subject,
      tenant,
      at: at ?? null,
      stable: Object.freeze(stableViews),
      situational: Object.freeze(situationalViews),
    });
  }

  dimensions(
    subject: SubjectReference,
    tenant: TenantScope,
    scope: PreferenceScopeFilter = "all"
  ): readonly (PreferenceDimensionView | SituationalPreferenceDimensionView)[] {
    const tKey = tenantKey(tenant);
    const sKey = subjectKey(subject);
    const subjectLog = this.subjects.get(`${tKey}|${sKey}`);
    if (!subjectLog) return [];

    const { stable, situational } = foldPreferenceState(subjectLog.log.map((e) => e.delta));
    const out: (PreferenceDimensionView | SituationalPreferenceDimensionView)[] = [];
    if (matchesScopeFilter("stable", scope)) {
      for (const dim of stable.values()) {
        if (dim.removed) continue;
        out.push(stableView(dim));
      }
    }
    if (matchesScopeFilter("situational", scope)) {
      for (const dim of situational.values()) {
        if (dim.removed) continue;
        out.push(situationalView(dim));
      }
    }
    out.sort(byDimensionName);
    return Object.freeze(out);
  }

  log(
    subject: SubjectReference,
    tenant: TenantScope,
    scope: PreferenceScopeFilter = "all"
  ): readonly PreferenceLogEntry[] {
    const tKey = tenantKey(tenant);
    const sKey = subjectKey(subject);
    const subjectLog = this.subjects.get(`${tKey}|${sKey}`);
    if (!subjectLog) return [];
    return Object.freeze(
      subjectLog.log.filter((entry) => matchesScopeFilter(entry.routedScope, scope))
    );
  }

  private subjectLogFor(tenantKeyStr: string, subjectKeyStr: string): SubjectLog {
    const key = `${tenantKeyStr}|${subjectKeyStr}`;
    let subjectLog = this.subjects.get(key);
    if (!subjectLog) {
      subjectLog = { log: [] };
      this.subjects.set(key, subjectLog);
    }
    return subjectLog;
  }
}
