/**
 * Shared contract fixtures for the persistence test battery
 * (controlled-local evidence; mirrors the events-package fixture style).
 */
import type {
  CatalogItem,
  ContextSnapshot,
  DecisionResult,
  ExperiencePlan,
  OutcomeEvent,
  PreferenceDelta,
  Realization,
  SubjectReference,
  TenantScope,
} from "@reckon/contracts";

export const tenantA: TenantScope = { tenantId: "tenant-a" };
export const tenantAWorkspace: TenantScope = { tenantId: "tenant-a", workspaceId: "ws-1" };
export const tenantB: TenantScope = { tenantId: "tenant-b" };
export const subject: SubjectReference = { kind: "user", ref: "user-9" };

let counter = 0;
export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function makeEvent(overrides: Partial<OutcomeEvent> = {}): OutcomeEvent {
  return {
    schema: "reckon.outcome-event",
    schemaVersion: "0.1.0",
    eventId: "ev-1",
    tenant: tenantA,
    subject,
    eventType: "completion",
    occurredAt: 1_000,
    evidenceClass: "production-observed",
    idempotencyKey: "idem-1",
    metrics: {},
    ...overrides,
  };
}

export function makeDecision(overrides: Partial<DecisionResult> = {}): DecisionResult {
  return {
    schema: "reckon.decision-result",
    schemaVersion: "0.1.0",
    decisionId: "dec-1",
    requestId: "req-1",
    tenant: tenantA,
    action: "HOLD",
    alternatives: [],
    policy: { policyId: "pol-neutral", version: "1" },
    reasons: [{ code: "default", message: "neutral fixture decision" }],
    at: 5_000,
    ...overrides,
  };
}

export function makePlan(overrides: Partial<ExperiencePlan> = {}): ExperiencePlan {
  return {
    schema: "reckon.experience-plan",
    schemaVersion: "0.1.0",
    planId: "plan-1",
    version: 0,
    tenant: tenantA,
    subject,
    objective: { objectiveId: "obj-relax", version: "1", kind: "relax", params: {} },
    attentionPolicy: { policyId: "att-mindful", version: "1", style: "mindful", params: {} },
    queuedExperiences: [],
    replanTriggers: ["outcome-observed"],
    resumeCheckpoints: [],
    createdAt: 10_000,
    updatedAt: 10_000,
    ...overrides,
  };
}

export function makeCatalogItem(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    schema: "reckon.catalog-item",
    schemaVersion: "0.1.0",
    itemId: "item-1",
    kind: "media",
    labels: ["fixture"],
    attributes: {},
    ...overrides,
  };
}

export function makeRealization(overrides: Partial<Realization> = {}): Realization {
  return {
    schema: "reckon.realization",
    schemaVersion: "0.1.0",
    realizationId: "real-1",
    itemId: "item-1",
    kind: "stream",
    constraints: {},
    ...overrides,
  };
}

export function makePreferenceDelta(overrides: Partial<PreferenceDelta> = {}): PreferenceDelta {
  return {
    schema: "reckon.preference-delta",
    schemaVersion: "0.1.0",
    deltaId: "delta-1",
    tenant: tenantA,
    subject,
    dimension: "genre.scifi",
    op: "add",
    value: 1,
    model: { modelId: "fixture-model", version: "1" },
    timestamp: 20_000,
    ...overrides,
  };
}

export function makeContextSnapshot(overrides: Partial<ContextSnapshot> = {}): ContextSnapshot {
  return {
    schema: "reckon.context-snapshot",
    schemaVersion: "0.1.0",
    contextId: "ctx-1",
    at: 30_000,
    activity: ["fixture-activity"],
    extra: {},
    ...overrides,
  };
}

/** Deterministic injected clock (mirrors the events package ManualClock law). */
export class ManualClock {
  #now: number;
  constructor(start = 1_000) {
    this.#now = start;
  }
  now(): number {
    return this.#now;
  }
  advance(ms: number): void {
    this.#now += ms;
  }
  set(ms: number): void {
    this.#now = ms;
  }
}
