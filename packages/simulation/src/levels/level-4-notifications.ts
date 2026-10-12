/**
 * SIM-002 — Ladder Level 4: the NOTIFICATION SYSTEM synthetic host.
 *
 * Ladder definition:
 *   "Notification system — attention, fatigue, time windows, defer/queue, interruption."
 *
 * World-state transitions this host owns (all host-side, all deterministic):
 * - ATTENTION: the synthetic user's attention quality rotates
 *   background → partial → full by step. Background attention DEFERS
 *   presentation (the decision is still requested and measured; the
 *   host simply does not present) — which is why this level's
 *   full-loop completion lands LATER than its first decision: the
 *   defer cost is a measured, honest number in the effort record.
 * - FATIGUE: per-category presentation history; a category presented
 *   ≥2 times within the last 3 steps is suppressed for the detection
 *   step plus two more — suppressed categories leave retrieval until
 *   the window passes (a fatigue → retrieval transition).
 * - TIME WINDOWS: every decision request declares a time-window hard
 *   constraint (delivery window in the host's own time base), plus
 *   max-latency and a push format requirement. Quiet-hour steps
 *   (every 5th) defer presentation regardless of attention — the
 *   host-side time-window gate.
 * - DEFER/QUEUE: deferred notifications enter a defer queue and get
 *   retrieval PRIORITY when attention returns — defer → queue →
 *   re-retrieval → decision → presentation, all through the public
 *   surface. The queue drains over the run (asserted by tests).
 * - INTERRUPTION: a high-urgency notification presented while
 *   attention is partial is an interruption — accepted while under
 *   the attention policy's interruption budget, rejected beyond it.
 *
 * The context-snapshots capability is honestly PARTIAL: attention
 * quality and fatigue signals live in the frozen ContextSnapshot
 * payload, but the public surface carries only an opaque contextId —
 * no ingestion route exists (API_GAP, same finding as Level 2).
 *
 * LAWS: zero internal imports; no Math.random / Date.now / wall clock /
 * LLM / network; synthetic outcomes are evidenceClass "fixture";
 * deterministic given (seed, fresh host factory) — replay gate applies.
 *
 * Glue (honest; re-verified mechanically by levels.test.ts): `loc` =
 * comment-stripped non-blank lines of this module; `customAdapterLoc`
 * = lines inside the glue:adapter markers; `functions` =
 * createLevel4WorldState, attentionQualityForStep, isQuietHoursStep,
 * isFatiguedAt, registerPresentation, rankNotifications,
 * selectedNotifications, deferSelected, drainFromDeferQueue,
 * interruptionOutcomeFor, categoryWeightUpdate,
 * buildNotificationConstraints, provideDecisionInputs,
 * consumeDecision, provideOutcome, providePreferenceDelta,
 * createLevel4NotificationsHost (17).
 */
import type {
  DecisionResult,
  HostDecisionReaction,
  HostDecisionInputs,
  CatalogItemInput,
  RealizationInput,
  SimulationHostAdapter,
  SimulationManifestContentInput,
  SubjectReference,
  TenantScope,
} from "../harness/host-adapter.js";
import type { HardConstraint } from "@reckon/contracts";
import type { ReckonCompleteProfileDeclarationInput } from "@reckon/contracts";

const TENANT: TenantScope = { tenantId: "tenant-l4-notifications" };
const SUBJECT: SubjectReference = { kind: "user", ref: "user-l4-notify-1" };

const MAX_INTERRUPTIONS_PER_HOUR = 3;
const FATIGUE_WINDOW_STEPS = 3;
const FATIGUE_PRESENTED_THRESHOLD = 2;
const SUPPRESSION_EXTRA_STEPS = 2;

// --- glue:adapter:begin ----------------------------------------------------
// The notification world: 8 notifications across 4 categories (high /
// normal urgency), push + in-app channel variants; an attention quality
// rotation; per-category fatigue with suppression windows; a defer queue
// with retrieval priority; quiet-hour deferrals; and interruption
// accounting bounded by the attention policy's budget.

interface NotificationItem {
  readonly itemId: string;
  readonly title: string;
  readonly category: string;
  readonly urgency: "high" | "normal";
  readonly pushRealizationId: string;
  readonly inAppRealizationId: string;
}

const NOTIFICATION_ITEMS: readonly NotificationItem[] = [
  { itemId: "l4-notif-cal-01", title: "Team standup in 10 minutes", category: "calendar", urgency: "high", pushRealizationId: "l4-real-cal-01-push", inAppRealizationId: "l4-real-cal-01-inapp" },
  { itemId: "l4-notif-cal-02", title: "Dentist appointment tomorrow", category: "calendar", urgency: "normal", pushRealizationId: "l4-real-cal-02-push", inAppRealizationId: "l4-real-cal-02-inapp" },
  { itemId: "l4-notif-msg-01", title: "New message from Ada", category: "messages", urgency: "high", pushRealizationId: "l4-real-msg-01-push", inAppRealizationId: "l4-real-msg-01-inapp" },
  { itemId: "l4-notif-msg-02", title: "Three new reactions", category: "messages", urgency: "normal", pushRealizationId: "l4-real-msg-02-push", inAppRealizationId: "l4-real-msg-02-inapp" },
  { itemId: "l4-notif-news-01", title: "Storm warning in your area", category: "news-alerts", urgency: "high", pushRealizationId: "l4-real-news-01-push", inAppRealizationId: "l4-real-news-01-inapp" },
  { itemId: "l4-notif-news-02", title: "Daily digest is ready", category: "news-alerts", urgency: "normal", pushRealizationId: "l4-real-news-02-push", inAppRealizationId: "l4-real-news-02-inapp" },
  { itemId: "l4-notif-promo-01", title: "Flash sale ends tonight", category: "promos", urgency: "normal", pushRealizationId: "l4-real-promo-01-push", inAppRealizationId: "l4-real-promo-01-inapp" },
  { itemId: "l4-notif-promo-02", title: "New arrivals in your sizes", category: "promos", urgency: "normal", pushRealizationId: "l4-real-promo-02-push", inAppRealizationId: "l4-real-promo-02-inapp" },
];

const NOTIFICATION_CATEGORIES: readonly string[] = ["calendar", "messages", "news-alerts", "promos"];

type AttentionQuality = "background" | "partial" | "full";

interface Level4WorldState {
  categoryWeights: Map<string, number>;
  recentPresentedByCategory: Map<string, number[]>;
  suppressedUntil: Map<string, number>;
  suppressionLog: { category: string; detectedAtStep: number; untilStep: number }[];
  consumedItems: Set<string>;
  deferQueue: string[];
  recentInterruptions: number;
  backgroundDeferrals: number;
  quietDeferrals: number;
  interruptionAccepts: number;
  interruptionRejects: number;
  completions: number;
  skips: number;
  presentedLog: { step: number; itemId: string; category: string; urgency: string; attention: AttentionQuality; eventType: string }[];
}

export interface Level4WorldView {
  readonly categoryWeights: ReadonlyMap<string, number>;
  readonly suppressionLog: readonly { category: string; detectedAtStep: number; untilStep: number }[];
  readonly deferQueue: readonly string[];
  readonly recentInterruptions: number;
  readonly backgroundDeferrals: number;
  readonly quietDeferrals: number;
  readonly interruptionAccepts: number;
  readonly interruptionRejects: number;
  readonly completions: number;
  readonly skips: number;
  readonly presentedLog: readonly {
    step: number;
    itemId: string;
    category: string;
    urgency: string;
    attention: AttentionQuality;
    eventType: string;
  }[];
}

function createLevel4WorldState(): Level4WorldState {
  const categoryWeights = new Map<string, number>();
  const recentPresentedByCategory = new Map<string, number[]>();
  for (const category of NOTIFICATION_CATEGORIES) {
    categoryWeights.set(category, 1.0);
    recentPresentedByCategory.set(category, []);
  }
  return {
    categoryWeights,
    recentPresentedByCategory,
    suppressedUntil: new Map(),
    suppressionLog: [],
    consumedItems: new Set(),
    deferQueue: [],
    recentInterruptions: 0,
    backgroundDeferrals: 0,
    quietDeferrals: 0,
    interruptionAccepts: 0,
    interruptionRejects: 0,
    completions: 0,
    skips: 0,
    presentedLog: [],
  };
}

/** Attention rotation: background → partial → full by step. */
function attentionQualityForStep(step: number): AttentionQuality {
  return (["background", "partial", "full"] as const)[(step - 1) % 3]!;
}

/** Quiet hours fall on every 5th step (host-side time-window gate). */
function isQuietHoursStep(step: number): boolean {
  return step % 5 === 0;
}

/** A category presented FATIGUE_PRESENTED_THRESHOLD times in the last
 *  FATIGUE_WINDOW_STEPS steps is fatigued at this step. */
function isFatiguedAt(state: Level4WorldState, category: string, step: number): boolean {
  const history = state.recentPresentedByCategory.get(category) ?? [];
  const withinWindow = history.filter((at) => at >= step - FATIGUE_WINDOW_STEPS && at <= step - 1);
  return withinWindow.length >= FATIGUE_PRESENTED_THRESHOLD;
}

/** Record a presentation in the category's history (fatigue accounting). */
function registerPresentation(state: Level4WorldState, category: string, step: number): void {
  const history = state.recentPresentedByCategory.get(category) ?? [];
  history.push(step);
  state.recentPresentedByCategory.set(category, history);
}

/** Retrieval: deferred first, then category weight, urgency, index;
 *  suppressed and already-consumed notifications excluded (with an
 *  honest fallback that never submits an empty candidate set — the
 *  frozen contract requires at least one candidate). */
function rankNotifications(state: Level4WorldState, step: number) {
  const eligible = NOTIFICATION_ITEMS.filter((item) => {
    if (state.consumedItems.has(item.itemId)) return false;
    const until = state.suppressedUntil.get(item.category);
    return until === undefined || step > until;
  });
  const pool = eligible.length > 0 ? eligible : NOTIFICATION_ITEMS;
  const deferredFirst = (a: NotificationItem, b: NotificationItem) => {
    const aDeferred = state.deferQueue.includes(a.itemId) ? 0 : 1;
    const bDeferred = state.deferQueue.includes(b.itemId) ? 0 : 1;
    return aDeferred - bDeferred;
  };
  const ordered = [...pool].sort((a, b) => {
    const byDefer = deferredFirst(a, b);
    if (byDefer !== 0) return byDefer;
    const byWeight = (state.categoryWeights.get(b.category) ?? 1.0) - (state.categoryWeights.get(a.category) ?? 1.0);
    if (byWeight !== 0) return byWeight;
    if (a.category !== b.category) return a.category < b.category ? -1 : 1;
    if (a.urgency !== b.urgency) return a.urgency === "high" ? -1 : 1;
    return a.itemId < b.itemId ? -1 : 1;
  });
  return ordered.map((item, index) => ({
    itemId: item.itemId,
    realizationIds: [item.pushRealizationId, item.inAppRealizationId],
    source: "host-notification-center",
    rankHint: index + 1,
  }));
}

/** The selected notification (first candidate) as a domain object. */
function selectedNotifications(result: DecisionResult): NotificationItem {
  const itemId = result.selectedExperience?.itemId ?? "";
  return NOTIFICATION_ITEMS.find((item) => item.itemId === itemId) ?? NOTIFICATION_ITEMS[0]!;
}

/** Defer the selected notification (background attention or quiet hours). */
function deferSelected(state: Level4WorldState, item: NotificationItem, step: number, reason: "background" | "quiet"): void {
  if (reason === "background") state.backgroundDeferrals += 1;
  else state.quietDeferrals += 1;
  if (!state.deferQueue.includes(item.itemId)) state.deferQueue.push(item.itemId);
}

/** Drain the selected notification from the defer queue on presentation. */
function drainFromDeferQueue(state: Level4WorldState, itemId: string): void {
  const index = state.deferQueue.indexOf(itemId);
  if (index >= 0) state.deferQueue.splice(index, 1);
}

/** Interruption semantics: high urgency + partial attention, bounded by
 *  the attention policy's interruption budget (accept → reject beyond). */
function interruptionOutcomeFor(state: Level4WorldState): "interruption-accept" | "interruption-reject" {
  return state.recentInterruptions < MAX_INTERRUPTIONS_PER_HOUR
    ? "interruption-accept"
    : "interruption-reject";
}

/** Category affinity: +0.25 on accepted interruption/completion; ×0.7 on
 *  rejected interruption or skip (fatigue-averse preference transition). */
function categoryWeightUpdate(weights: Map<string, number>, category: string, eventType: string): number {
  const current = weights.get(category) ?? 1.0;
  const next =
    eventType === "interruption-reject" || eventType === "skip"
      ? current * 0.7
      : Math.min(3.0, current + 0.25);
  weights.set(category, next);
  return next;
}

/** Notification constraints: delivery window, latency ceiling, push
 *  format, and the quiet-hours gate (host time base). */
function buildNotificationConstraints(step: number): HardConstraint[] {
  return [
    { kind: "time-window", fromMs: (step - 1) * 30_000, untilMs: step * 30_000 },
    { kind: "max-latency", latencyMs: 750 },
    { kind: "format-required", format: "push" },
    { kind: "custom", constraintId: "custom-quiet-hours", params: { window: "22:00-07:00" } },
  ];
}
// --- glue:adapter:end ------------------------------------------------------

const LEVEL4_CATALOG: { items: readonly CatalogItemInput[]; realizations: readonly RealizationInput[] } = {
  items: NOTIFICATION_ITEMS.map((item) => ({
    itemId: item.itemId,
    kind: "notification" as const,
    labels: ["notification", item.category, item.urgency],
    attributes: { title: item.title, category: item.category, urgency: item.urgency },
  })),
  realizations: NOTIFICATION_ITEMS.flatMap((item) => [
    { realizationId: item.pushRealizationId, itemId: item.itemId, kind: "push", constraints: { channel: "push", priority: item.urgency === "high" ? "high" : "normal" } },
    { realizationId: item.inAppRealizationId, itemId: item.itemId, kind: "inapp", constraints: { channel: "in-app" } },
  ]),
};

const LEVEL4_MANIFEST_CONTENT: SimulationManifestContentInput = {
  manifestVersion: "1",
  hostSystem: {
    hostId: "host-l4-notifications",
    name: "Notification System",
    hostAdapterId: "adapter-l4-notifications-1",
    version: "0.1.0",
  },
  declaredAt: 0,
  supportedCapabilities: [
    { capability: "tenant-identity", status: "supported", evidenceClass: "fixture" },
    {
      capability: "catalog-registration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/catalog/items"],
      sdkMethods: ["catalog.upsertItem"],
      notes: "notification items (kind: notification) with urgency labels",
    },
    {
      capability: "realization-declaration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/catalog/realizations"],
      sdkMethods: ["catalog.upsertRealization"],
      notes: "push + in-app channel variants per notification",
    },
    {
      capability: "candidate-retrieval",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/candidates"],
      sdkMethods: ["candidates.submit"],
      notes: "deferred-first ranking; fatigued categories suppressed; consumed items excluded",
    },
    {
      capability: "context-snapshots",
      status: "partial",
      evidenceClass: "fixture",
      friction: "API_GAP",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes:
        "attention quality and fatigue signals live in the frozen ContextSnapshot payload " +
        "(attention.quality, fatigue.repetitionLevel, fatigue.recentInterruptions) but the public surface " +
        "carries an opaque contextId only — no ingestion route exists, so the notification host's " +
        "attention/fatigue state cannot cross the public surface as data",
    },
    {
      capability: "objective-declaration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "catch-up (triage) objective declared in-request",
    },
    {
      capability: "constraint-declaration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "time-window, max-latency, format-required and quiet-hours constraints per request",
    },
    {
      capability: "attention-policy",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "mindful policy with interruption budget params (maxInterruptionsPerHour, quiet hours)",
    },
    {
      capability: "decision-request",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
    },
    {
      capability: "outcome-return",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/outcomes"],
      sdkMethods: ["outcomes.append"],
      notes: "completion, skip, interruption-accept and interruption-reject outcomes",
    },
    {
      capability: "preference-feedback",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/preferences/events"],
      sdkMethods: ["preferences.appendDelta"],
      notes: "category deltas: + on accepted interruption/completion, decay on reject/skip",
    },
    {
      capability: "schedule-execution",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "host-side defer/queue execution: deferred notifications queue with retrieval priority and drain on presentation",
    },
    {
      capability: "conformance-verification",
      status: "supported",
      evidenceClass: "fixture",
      notes: "harness conformance verdict; no API route — machine-checked offline",
    },
  ],
};

export const level4NotificationsProfile: ReckonCompleteProfileDeclarationInput = {
  profileId: "profile-l4-notifications",
  name: "Notification system",
  description: "SIM-002 ladder level 4 — attention, fatigue, time windows, defer/queue, interruption.",
  ladderLevel: 4,
  requiredCapabilities: [
    { capability: "tenant-identity" },
    { capability: "catalog-registration" },
    { capability: "realization-declaration" },
    { capability: "candidate-retrieval" },
    { capability: "context-snapshots" },
    { capability: "objective-declaration" },
    { capability: "constraint-declaration" },
    { capability: "attention-policy" },
    { capability: "decision-request" },
    { capability: "outcome-return" },
    { capability: "preference-feedback" },
    { capability: "schedule-execution" },
    { capability: "conformance-verification" },
  ],
  requiredEvidenceClass: "fixture",
  declaredAt: 1_000,
};

export interface Level4Host {
  readonly host: SimulationHostAdapter;
  readonly world: Level4WorldView;
}

export function createLevel4NotificationsHost(): Level4Host {
  const state = createLevel4WorldState();

  const host: SimulationHostAdapter = {
    hostAdapterId: "adapter-l4-notifications-1",
    hostSystem: {
      hostId: "host-l4-notifications",
      name: "Notification System",
      version: "0.1.0",
    },
    glue: { functions: 17, loc: 455, customAdapterLoc: 159 },
    manifestContent: LEVEL4_MANIFEST_CONTENT,
    catalog: {
      items: LEVEL4_CATALOG.items.map((item) => ({ ...item })),
      realizations: LEVEL4_CATALOG.realizations.map((realization) => ({ ...realization })),
    },

    provideDecisionInputs(step: number): HostDecisionInputs {
      // Fatigue detection runs at retrieval time: any category that just
      // crossed the fatigue threshold is suppressed for this step + 2.
      for (const category of NOTIFICATION_CATEGORIES) {
        if (state.suppressedUntil.has(category)) continue;
        if (isFatiguedAt(state, category, step)) {
          const untilStep = step + SUPPRESSION_EXTRA_STEPS;
          state.suppressedUntil.set(category, untilStep);
          state.suppressionLog.push({ category, detectedAtStep: step, untilStep });
        }
      }
      const attention = attentionQualityForStep(step);
      return {
        contextId: `ctx-l4-${step}-${attention}`,
        tenant: TENANT,
        subject: SUBJECT,
        objective: { objectiveId: "obj-l4-catch-up", version: "1", kind: "catch-up", params: { mode: "triage" } },
        attentionPolicy: {
          policyId: "ap-l4-mindful",
          version: "1",
          style: "mindful",
          params: { maxInterruptionsPerHour: MAX_INTERRUPTIONS_PER_HOUR, maxNotificationsPerHour: 6, quietHours: "22:00-07:00" },
        },
        candidates: { setId: `cs-l4-${step}`, candidates: rankNotifications(state, step) },
        constraints: buildNotificationConstraints(step),
        policySelector: { policyId: "greedy-v1" },
      };
    },

    consumeDecision(step: number, result: DecisionResult): HostDecisionReaction {
      const item = selectedNotifications(result);
      const attention = attentionQualityForStep(step);
      if (attention === "background") {
        deferSelected(state, item, step, "background");
        return { presented: false };
      }
      if (isQuietHoursStep(step)) {
        deferSelected(state, item, step, "quiet");
        return { presented: false };
      }
      drainFromDeferQueue(state, item.itemId);
      state.consumedItems.add(item.itemId);
      registerPresentation(state, item.category, step);
      return { presented: true };
    },

    provideOutcome(step: number, result: DecisionResult, _reaction: HostDecisionReaction, nowMs: number) {
      const item = selectedNotifications(result);
      const attention = attentionQualityForStep(step);
      let eventType: "completion" | "skip" | "interruption-accept" | "interruption-reject";
      if (item.urgency === "high" && attention === "partial") {
        eventType = interruptionOutcomeFor(state);
        if (eventType === "interruption-accept") {
          state.interruptionAccepts += 1;
          state.recentInterruptions += 1;
        } else {
          state.interruptionRejects += 1;
        }
      } else if (step % 6 === 0) {
        eventType = "skip";
        state.skips += 1;
      } else {
        eventType = "completion";
        state.completions += 1;
      }
      state.presentedLog.push({ step, itemId: item.itemId, category: item.category, urgency: item.urgency, attention, eventType });
      return {
        eventId: `ev-l4-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        decisionId: result.decisionId,
        experienceId: result.selectedExperience?.experienceId,
        eventType,
        occurredAt: nowMs,
        context: { contextId: `ctx-l4-${step}-${attention}` },
        evidenceClass: "fixture",
        metrics: {
          acknowledgedWithinMs: eventType === "completion" ? 800 + 100 * step : 0,
          interruptionCostMs: eventType.startsWith("interruption") ? 2500 + 500 * state.recentInterruptions : 0,
        },
        idempotencyKey: `idem-out-l4-${step}`,
      };
    },

    providePreferenceDelta(step: number, result: DecisionResult, nowMs: number) {
      const item = selectedNotifications(result);
      const presented = state.presentedLog.find((entry) => entry.step === step);
      const eventType = presented?.eventType ?? "completion";
      const oldValue = state.categoryWeights.get(item.category) ?? 1.0;
      const newValue = categoryWeightUpdate(state.categoryWeights, item.category, eventType);
      return {
        deltaId: `delta-l4-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        dimension: `notif.category.${item.category}`,
        op: eventType === "interruption-reject" || eventType === "skip" ? "multiply" : "add",
        oldValue,
        newValue,
        scope: { contextId: `ctx-l4-${step}-${attentionQualityForStep(step)}` },
        resultingConfidence: 0.55,
        model: { modelId: "host-l4-notification-affinity", version: "1" },
        timestamp: nowMs,
      };
    },
  };

  return { host, world: state };
}

export const level4NotificationsMeta = {
  level: 4,
  name: "Notification system",
  hostAdapterId: "adapter-l4-notifications-1",
  requiredCapabilities: 13,
  expectedSatisfied: 12,
  expectedPartial: 1,
  expectedMissing: 0,
  expectedGaps: ["context-snapshots|API_GAP"] as readonly string[],
} as const;
