/**
 * SIM-006 — Ladder Level 20: the ADVERSARIAL/UNCERTAIN ENVIRONMENT
 * synthetic host.
 *
 * Ladder definition (docs/simulations/reckon-complete-ladder.md):
 *   "Adversarial/uncertain environment — stale/noisy data, provider
 *    failure, delayed outcomes, capability churn and recovery."
 *
 * The host owns a severe-weather news/alerts product (StormWatch)
 * running against a DEGRADED environment. Per the SIM-006 work-order
 * law, the adversity is injected through the surfaces that already
 * exist — the host adapter's world state and the harness's own fault
 * injection (`faultRate` / `maxRetries` in runSimulation config) — and
 * the recovery behavior is EVIDENCED:
 *
 * - stale data: the host's retrieval index ages (+1h per step) and the
 *   provider outage corrupts its refresh at steps 3–4 (index age 6h/7h,
 *   candidates served from the stale cache, source "host-stale-cache");
 *   the index refreshes at step 5 (age back to 1h) — staleness is
 *   carried in candidate provenance, constraint params, and outcome
 *   metrics;
 * - noisy data: preference feedback on the stale/outage steps carries
 *   reduced signal confidence (resultingConfidence 0.4 vs 0.7) — the
 *   honest way noisy signals cross the public surface;
 * - provider failure: (a) the canonical run injects transport faults
 *   through the harness (faultRate 0.25, maxRetries 3 — measured
 *   failures/retries in the record); (b) the content provider
 *   "l20-provider-alpha" is down at steps 3–4 — the host fails over to
 *   the beta realizations (failover recorded in constraint params,
 *   world state, and outcome metrics) and recovers at step 5;
 * - delayed outcomes: the step-2 presentation's completion event is
 *   reported THREE steps late — at step 5 the host's outcome slot
 *   carries the completion for the STEP-2 decision/experience with
 *   metrics { delayedOutcome, presentedAtStep, reportedAtStep,
 *   delaySteps } (decision↔outcome linkage across steps, honest);
 * - capability churn and recovery (existing capability-manifest
 *   mechanics): the host factory has two phases —
 *     · degraded (manifest v1): the preference provider outage takes
 *       the feedback channel down; the manifest declares
 *       preference-feedback as an honest GAP (ADAPTER_GAP) and NO
 *       preference deltas flow (the call log shows it);
 *     · recovered (manifest v2, the canonical phase): the capability
 *       is restored, deltas flow again — the recovery is evidenced by
 *       the complete verdict + the returning preference calls.
 *
 * LAWS obeyed (SIM-006 work order):
 * - zero internal Reckon imports — only @reckon/contracts types and the
 *   harness host-adapter seam (enforced by the conformance scanner);
 * - no Math.random, no Date.now / wall-clock reads, no LLM/network;
 * - every synthetic outcome carries evidenceClass "fixture" — synthetic
 *   host output NEVER becomes observed evidence;
 * - deterministic: a fresh host from this factory + the same run seed
 *   yields byte-identical records (replay gate) — the transport faults
 *   are seeded draws in the harness, not host randomness;
 * - recovery is never claimed without evidence: every failure mode this
 *   module scripts has a matching recovery transition in the world
 *   state and the measured records.
 *
 * Glue declaration (honest, host-declared; mechanically re-verified by
 * packages/simulation/test/levels-wave-d.test.ts):
 * - `loc` — comment-stripped non-blank lines of THIS module (which
 *   lawfully contains BOTH capability phases — they share the world
 *   code; only the manifest + delta wiring differ);
 * - `customAdapterLoc` — lines between the `glue:adapter` markers below
 *   (the degraded-environment world: staleness, provider failover,
 *   noisy signals, delayed outcomes, churn phases);
 * - `functions` — the named host functions: indexAgeHoursAt,
 *   isStaleStep, alphaUpAt, providerForStep, adversarialConstraints,
 *   adversarialCandidates, createLevel20WorldState,
 *   createLevel20StormwatchHost + its four adapter callbacks (12).
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
import type { ExperienceInput } from "../harness/port.js";
import type { ReckonCompleteProfileDeclarationInput } from "@reckon/contracts";

/** Host-owned identity (host is the identity authority — never Reckon). */
const TENANT: TenantScope = { tenantId: "tenant-l20-stormwatch" };
const SUBJECT: SubjectReference = { kind: "user", ref: "user-l20-watcher-1" };

// --- glue:adapter:begin ----------------------------------------------------
// The adversarial world: a stale-prone retrieval index, a failing
// content provider, noisy preference signals, delayed outcome
// reporting, and a capability churn phase pair.

/** The step at which the provider outage begins and ends. */
const PROVIDER_OUTAGE_STEPS: readonly number[] = [3, 4];
/** The step whose outcome event is reported late (delayed outcomes). */
const DELAYED_OUTCOME_FOR_STEP = 2;
const DELAYED_OUTCOME_REPORTED_AT_STEP = 5;
/** Steps whose preference signals are noisy (stale index + outage). */
const NOISY_SIGNAL_STEPS: readonly number[] = [3, 4];
/** Confidences: honest reduced confidence under noise. */
const NOISY_CONFIDENCE = 0.4;
const NORMAL_CONFIDENCE = 0.7;

/** The retrieval index age per step (hours; the outage corrupts refresh). */
function indexAgeHoursAt(step: number): number {
  const ages = [1, 2, 6, 7, 1, 2, 3, 4];
  return ages[step - 1] ?? 1;
}

/** Is this step served from the stale cache? */
function isStaleStep(step: number): boolean {
  return indexAgeHoursAt(step) > 5;
}

/** Is the alpha provider up at this step (host-owned provider health)? */
function alphaUpAt(step: number): boolean {
  return !PROVIDER_OUTAGE_STEPS.includes(step);
}

/** The provider realization serving an item at a step (failover-aware). */
function providerForStep(itemId: string, step: number): string {
  const suffix = alphaUpAt(step) ? "alpha" : "beta";
  return `l20-real-${itemId.replace("l20-item-", "")}-${suffix}`;
}

interface AdversarialStep {
  readonly step: number;
  readonly itemId: string;
  /** The retrieval provenance: fresh index, stale cache, alert, resume. */
  readonly source: string;
}

/** The degraded-day script (failover + interruption + resume aware). */
const ADVERSARIAL_STEPS: readonly AdversarialStep[] = [
  { step: 1, itemId: "l20-item-brief-1", source: "host-fresh-index" },
  { step: 2, itemId: "l20-item-brief-1", source: "host-fresh-index" },
  { step: 3, itemId: "l20-item-brief-2", source: "host-stale-cache" },
  { step: 4, itemId: "l20-item-alert-1", source: "host-time-critical" },
  { step: 5, itemId: "l20-item-brief-2", source: "host-resume" },
  { step: 6, itemId: "l20-item-brief-2", source: "host-fresh-index" },
  { step: 7, itemId: "l20-item-sitrep-1", source: "host-fresh-index" },
  { step: 8, itemId: "l20-item-brief-1", source: "host-fresh-index" },
];

/** The hard constraints carried on every request (provider + freshness gates). */
function adversarialConstraints(step: number): HardConstraint[] {
  return [
    { kind: "time-window", untilMs: 1_000 * 60 * (step + 45) },
    { kind: "max-latency", latencyMs: 200 },
    {
      kind: "custom",
      constraintId: "l20-provider-health",
      params: { alphaUp: alphaUpAt(step), failoverTo: alphaUpAt(step) ? "alpha" : "beta" },
    },
    {
      kind: "custom",
      constraintId: "l20-freshness-gate",
      params: { staleCache: isStaleStep(step), indexAgeHours: indexAgeHoursAt(step) },
    },
  ];
}

/** The step's candidates (provider-failover + staleness aware). */
function adversarialCandidates(step: number): { itemId: string; realizationId: string; source: string }[] {
  const entry = ADVERSARIAL_STEPS[step - 1]!;
  return [
    {
      itemId: entry.itemId,
      realizationId: providerForStep(entry.itemId, step),
      source: entry.source,
    },
  ];
}

interface Level20WorldState {
  presentations: number;
  actionLog: string[];
  providerAlphaUpLog: boolean[];
  providerOutageSteps: number[];
  failoverSteps: number[];
  indexAgeHoursLog: number[];
  staleSteps: number[];
  noisyDeltaSteps: number[];
  interruptSteps: number[];
  resumeSteps: number[];
  delayedOutcomeReported: boolean;
  outcomeSteps: number[];
  outcomeTypes: string[];
  deltaDimensions: string[];
  topicWeights: Map<string, number>;
}

function createLevel20WorldState(): Level20WorldState {
  return {
    presentations: 0,
    actionLog: [],
    providerAlphaUpLog: [],
    providerOutageSteps: [],
    failoverSteps: [],
    indexAgeHoursLog: [],
    staleSteps: [],
    noisyDeltaSteps: [],
    interruptSteps: [],
    resumeSteps: [],
    delayedOutcomeReported: false,
    outcomeSteps: [],
    outcomeTypes: [],
    deltaDimensions: [],
    topicWeights: new Map([
      ["energy-brief", 1],
      ["severe-weather", 1],
      ["situation-report", 1],
    ]),
  };
}

/** The preference dimension for an item (topic affinity model). */
function topicDimensionFor(itemId: string): string {
  if (itemId.includes("alert")) return "topic.severe-weather";
  if (itemId.includes("sitrep")) return "topic.situation-report";
  return "topic.energy-brief";
}

/** Numeric provider codes (the frozen MetricPayload is numeric-only). */
const PROVIDER_CODE: Readonly<Record<string, number>> = Object.freeze({
  alpha: 1,
  beta: 2,
});
// --- glue:adapter:end ------------------------------------------------------

/** Host catalog source — connected once, before the loop (public API). */
const LEVEL20_CATALOG: { items: readonly CatalogItemInput[]; realizations: readonly RealizationInput[] } = {
  items: [
    { itemId: "l20-item-brief-1", kind: "article", labels: ["brief", "weather"], attributes: { title: "Morning grid brief", contentRole: "brief" } },
    { itemId: "l20-item-brief-2", kind: "article", labels: ["brief", "weather"], attributes: { title: "Evening grid brief", contentRole: "brief" } },
    { itemId: "l20-item-alert-1", kind: "notification", labels: ["alert", "severe-weather"], attributes: { title: "Severe storm alert", contentRole: "alert" } },
    { itemId: "l20-item-sitrep-1", kind: "article", labels: ["sitrep", "severe-weather"], attributes: { title: "Storm situation report", contentRole: "sitrep" } },
  ],
  realizations: [
    { realizationId: "l20-real-brief-1-alpha", itemId: "l20-item-brief-1", kind: "provider-alpha", constraints: { provider: "alpha", region: "eu-west" } },
    { realizationId: "l20-real-brief-1-beta", itemId: "l20-item-brief-1", kind: "provider-beta", constraints: { provider: "beta", region: "eu-central" } },
    { realizationId: "l20-real-brief-2-alpha", itemId: "l20-item-brief-2", kind: "provider-alpha", constraints: { provider: "alpha", region: "eu-west" } },
    { realizationId: "l20-real-brief-2-beta", itemId: "l20-item-brief-2", kind: "provider-beta", constraints: { provider: "beta", region: "eu-central" } },
    { realizationId: "l20-real-alert-1-alpha", itemId: "l20-item-alert-1", kind: "provider-alpha", constraints: { provider: "alpha", region: "eu-west" } },
    { realizationId: "l20-real-alert-1-beta", itemId: "l20-item-alert-1", kind: "provider-beta", constraints: { provider: "beta", region: "eu-central" } },
    { realizationId: "l20-real-sitrep-1-alpha", itemId: "l20-item-sitrep-1", kind: "provider-alpha", constraints: { provider: "alpha", region: "eu-west" } },
    { realizationId: "l20-real-sitrep-1-beta", itemId: "l20-item-sitrep-1", kind: "provider-beta", constraints: { provider: "beta", region: "eu-central" } },
  ],
};

/** The recovered-phase manifest (v2): all twelve capabilities supported. */
const LEVEL20_RECOVERED_MANIFEST_CONTENT: SimulationManifestContentInput = {
  manifestVersion: "2",
  hostSystem: {
    hostId: "host-l20-stormwatch",
    name: "StormWatch",
    hostAdapterId: "adapter-l20-stormwatch-1",
    version: "0.1.0",
  },
  declaredAt: 0,
  supportedCapabilities: [
    { capability: "tenant-identity", status: "supported", evidenceClass: "fixture" },
    { capability: "catalog-registration", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/catalog/items"], sdkMethods: ["catalog.upsertItem"] },
    { capability: "realization-declaration", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/catalog/realizations"], sdkMethods: ["catalog.upsertRealization"], notes: "two provider realizations per item (provider-alpha / provider-beta) — the failover surface" },
    { capability: "candidate-retrieval", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/candidates"], sdkMethods: ["candidates.submit"], notes: "candidate sources carry the retrieval truth: host-fresh-index vs host-stale-cache (staleness is provenance, never hidden)" },
    { capability: "objective-declaration", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/decisions"], sdkMethods: ["decisions.request"], notes: "objective declared on every decision request (in-request field)" },
    { capability: "constraint-declaration", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/decisions"], sdkMethods: ["decisions.request"], notes: "custom hard constraints carry the environment truth: provider health (alphaUp/failoverTo) and the freshness gate (staleCache/indexAgeHours)" },
    { capability: "attention-policy", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/decisions"], sdkMethods: ["decisions.request"], notes: "attention policy declared on every decision request (in-request field)" },
    { capability: "decision-request", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/decisions"], sdkMethods: ["decisions.request"], notes: "requests carry currentExperience (SWITCH on failover, INTERRUPT on the critical alert, RESUME after recovery)" },
    { capability: "schedule-execution", status: "supported", evidenceClass: "fixture", notes: "host-side execution of schedule deltas (failover SWITCH, alert INTERRUPT with retained checkpoint, post-recovery RESUME)" },
    { capability: "outcome-return", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/outcomes"], sdkMethods: ["outcomes.append"], notes: "outcomes carry delayed-event metrics (delayedOutcome/presentedAtStep/reportedAtStep) with decision linkage to the original step" },
    { capability: "preference-feedback", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/preferences/events"], sdkMethods: ["preferences.appendDelta"], notes: "RECOVERED after the churn phase (manifest v1 declared the outage gap): deltas flow again, with honest reduced confidence (0.4) on the noisy steps" },
    { capability: "conformance-verification", status: "supported", evidenceClass: "fixture", notes: "harness conformance verdict; no API route — machine-checked offline" },
  ],
};

/**
 * The degraded-phase manifest (v1): the preference provider outage takes
 * the feedback channel down — an honest GAP entry (nothing is wired, no
 * evidence class) with the churn friction named.
 */
const LEVEL20_DEGRADED_MANIFEST_CONTENT: SimulationManifestContentInput = {
  ...LEVEL20_RECOVERED_MANIFEST_CONTENT,
  manifestVersion: "1",
  supportedCapabilities: LEVEL20_RECOVERED_MANIFEST_CONTENT.supportedCapabilities.map((entry) =>
    entry.capability === "preference-feedback"
      ? {
          capability: "preference-feedback" as const,
          status: "gap" as const,
          friction: "ADAPTER_GAP" as const,
          notes:
            "preference provider outage during the churn phase — the feedback channel is down; manifest v1 declares the gap honestly (no deltas flow, nothing is wired); recovery is the v2 manifest with the capability restored and evidenced",
        }
      : entry,
  ),
};

/** The Level 20 Reckon-Complete profile: what this archetype REQUIRES. */
export const level20AdversarialProfile: ReckonCompleteProfileDeclarationInput = {
  profileId: "profile-l20-adversarial",
  name: "Adversarial/uncertain environment",
  description: "SIM-006 ladder level 20 — stale/noisy data, provider failure, delayed outcomes, capability churn and recovery.",
  ladderLevel: 20,
  requiredCapabilities: [
    { capability: "tenant-identity" },
    { capability: "catalog-registration" },
    { capability: "realization-declaration" },
    { capability: "candidate-retrieval" },
    { capability: "objective-declaration" },
    { capability: "constraint-declaration" },
    { capability: "attention-policy" },
    { capability: "decision-request" },
    { capability: "schedule-execution" },
    { capability: "outcome-return" },
    { capability: "preference-feedback" },
    { capability: "conformance-verification" },
  ],
  requiredEvidenceClass: "fixture",
  declaredAt: 1_000,
};

/** Read-only view over the final world state (deterministic assertions). */
export interface Level20WorldView {
  readonly presentations: number;
  readonly actionLog: readonly string[];
  readonly providerAlphaUpLog: readonly boolean[];
  readonly providerOutageSteps: readonly number[];
  readonly failoverSteps: readonly number[];
  readonly indexAgeHoursLog: readonly number[];
  readonly staleSteps: readonly number[];
  readonly noisyDeltaSteps: readonly number[];
  readonly interruptSteps: readonly number[];
  readonly resumeSteps: readonly number[];
  readonly delayedOutcomeReported: boolean;
  readonly outcomeSteps: readonly number[];
  readonly outcomeTypes: readonly string[];
  readonly deltaDimensions: readonly string[];
  readonly topicWeights: Readonly<Record<string, number>>;
  readonly capabilityPhase: "degraded" | "recovered";
}

/** A fresh Level 20 host (fresh world state — replay-safe by construction). */
export interface Level20Host {
  readonly host: SimulationHostAdapter;
  readonly world: Level20WorldView;
}

/** The host factory's capability phase (churn via manifest mechanics). */
export interface Level20HostOptions {
  /** "degraded" = manifest v1 (preference provider outage); "recovered" = manifest v2. Default "recovered". */
  readonly capabilityPhase?: "degraded" | "recovered";
}

export function createLevel20StormwatchHost(options?: Level20HostOptions): Level20Host {
  const capabilityPhase = options?.capabilityPhase ?? "recovered";
  const state = createLevel20WorldState();
  /** The experience the previous step's decision selected (the live brief). */
  let liveExperience: ExperienceInput | undefined;
  /** The step-2 presentation whose completion event is reported late. */
  let pendingDelayedOutcome: { decisionId: string; experienceId?: string } | undefined;

  const host: SimulationHostAdapter = {
    hostAdapterId: "adapter-l20-stormwatch-1",
    hostSystem: {
      hostId: "host-l20-stormwatch",
      name: "StormWatch",
      version: "0.1.0",
    },
    // Glue honesty (wave-C battery recounts mechanically): loc = the
    // module's comment-stripped non-blank lines; the custom adapter LOC
    // = the recount inside the glue:adapter markers.
    glue: { functions: 12, loc: 443, customAdapterLoc: 110 },
    manifestContent:
      capabilityPhase === "degraded"
        ? LEVEL20_DEGRADED_MANIFEST_CONTENT
        : LEVEL20_RECOVERED_MANIFEST_CONTENT,
    catalog: {
      items: LEVEL20_CATALOG.items.map((item) => ({ ...item })),
      realizations: LEVEL20_CATALOG.realizations.map((realization) => ({ ...realization })),
    },

    provideDecisionInputs(step: number): HostDecisionInputs {
      const candidates = adversarialCandidates(step);
      state.providerAlphaUpLog.push(alphaUpAt(step));
      if (!alphaUpAt(step)) {
        state.providerOutageSteps.push(step);
        state.failoverSteps.push(step);
      }
      state.indexAgeHoursLog.push(indexAgeHoursAt(step));
      if (isStaleStep(step)) state.staleSteps.push(step);
      return {
        contextId: `ctx-l20-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        objective: {
          objectiveId: "obj-l20-stay-ahead-of-storm",
          version: "1",
          kind: "stay-informed",
          params: { environment: "adversarial", staleServing: isStaleStep(step) },
        },
        attentionPolicy: {
          policyId: "ap-l20-alert-ready",
          version: "1",
          style: "balanced",
          params: { criticalAlertsOnlyInterruptions: true },
        },
        candidates: {
          setId: `cs-l20-${step}`,
          candidates: candidates.map((candidate) => ({
            itemId: candidate.itemId,
            realizationIds: [candidate.realizationId],
            source: candidate.source,
            rankHint: 1,
          })),
        },
        constraints: adversarialConstraints(step),
        policySelector: { policyId: "stormwatch-serve-v1" },
        ...(liveExperience !== undefined ? { currentExperience: liveExperience } : {}),
        planId: "plan-l20-storm-day",
      };
    },

    consumeDecision(step: number, result: DecisionResult): HostDecisionReaction {
      state.presentations += 1;
      state.actionLog.push(result.action);
      if (result.action === "INTERRUPT") state.interruptSteps.push(step);
      if (result.action === "RESUME") state.resumeSteps.push(step);
      if (step === DELAYED_OUTCOME_FOR_STEP) {
        // The completion of this presentation will be reported late.
        pendingDelayedOutcome = {
          decisionId: result.decisionId,
          experienceId: result.selectedExperience?.experienceId,
        };
      }
      liveExperience = result.selectedExperience;
      return { presented: true };
    },

    provideOutcome(step: number, result: DecisionResult, _reaction: HostDecisionReaction, nowMs: number) {
      state.outcomeSteps.push(step);
      if (step === DELAYED_OUTCOME_REPORTED_AT_STEP && pendingDelayedOutcome !== undefined) {
        // DELAYED OUTCOME: this slot carries the completion event for the
        // STEP-2 decision/experience — reported three steps late, with
        // the linkage and lateness recorded honestly in the metrics.
        state.delayedOutcomeReported = true;
        state.outcomeTypes.push("completion");
        const metrics: Record<string, number> = {
          delayedOutcome: 1,
          presentedAtStep: DELAYED_OUTCOME_FOR_STEP,
          reportedAtStep: DELAYED_OUTCOME_REPORTED_AT_STEP,
          delaySteps: DELAYED_OUTCOME_REPORTED_AT_STEP - DELAYED_OUTCOME_FOR_STEP,
        };
        return {
          eventId: `ev-l20-delayed-${DELAYED_OUTCOME_FOR_STEP}`,
          tenant: TENANT,
          subject: SUBJECT,
          decisionId: pendingDelayedOutcome.decisionId,
          experienceId: pendingDelayedOutcome.experienceId,
          eventType: "completion" as const,
          occurredAt: nowMs,
          evidenceClass: "fixture" as const,
          metrics,
          idempotencyKey: `idem-out-l20-delayed-${DELAYED_OUTCOME_FOR_STEP}`,
        };
      }
      let eventType: "start" | "conversion" | "interruption-accept" | "custom" = "custom";
      let customEventType: string | undefined = "pending-completion";
      if (step === ADVERSARIAL_STEPS.length) {
        eventType = "conversion";
        customEventType = undefined;
      } else if (state.interruptSteps.includes(step)) {
        eventType = "interruption-accept";
        customEventType = undefined;
      } else if (step === 1) {
        eventType = "start";
        customEventType = undefined;
      } else if (state.failoverSteps.includes(step)) {
        customEventType = "provider-failover";
      } else if (step === ADVERSARIAL_STEPS.length - 1) {
        customEventType = "situation-report";
      }
      state.outcomeTypes.push(eventType);
      const metrics: Record<string, number> = {
        providerCode: PROVIDER_CODE[alphaUpAt(step) ? "alpha" : "beta"],
        failover: state.failoverSteps.includes(step) ? 1 : 0,
        staleServing: isStaleStep(step) ? 1 : 0,
        indexAgeHours: indexAgeHoursAt(step),
      };
      if (step === ADVERSARIAL_STEPS.length) {
        metrics.providerOutages = state.providerOutageSteps.length;
        metrics.failovers = state.failoverSteps.length;
        metrics.staleServings = state.staleSteps.length;
        metrics.delayedOutcomes = state.delayedOutcomeReported ? 1 : 0;
        metrics.interrupts = state.interruptSteps.length;
        metrics.resumes = state.resumeSteps.length;
      }
      return {
        eventId: `ev-l20-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        decisionId: result.decisionId,
        experienceId: result.selectedExperience?.experienceId,
        eventType,
        ...(customEventType !== undefined ? { customEventType } : {}),
        occurredAt: nowMs,
        evidenceClass: "fixture" as const,
        metrics,
        idempotencyKey: `idem-out-l20-${step}`,
      };
    },

    providePreferenceDelta(step: number, _result: DecisionResult, nowMs: number) {
      if (capabilityPhase === "degraded") {
        // The preference provider outage: NO deltas flow in the churn
        // phase (the manifest declares the gap honestly).
        return undefined;
      }
      const entry = ADVERSARIAL_STEPS[step - 1]!;
      const dimension = topicDimensionFor(entry.itemId);
      state.deltaDimensions.push(dimension);
      const noisy = NOISY_SIGNAL_STEPS.includes(step);
      if (noisy) state.noisyDeltaSteps.push(step);
      const weight = (state.topicWeights.get(topicRoleOf(dimension)) ?? 1) + 0.1;
      state.topicWeights.set(topicRoleOf(dimension), Math.round(weight * 100) / 100);
      return {
        deltaId: `delta-l20-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        dimension,
        op: "add" as const,
        newValue: Math.round(weight * 100) / 100,
        resultingConfidence: noisy ? NOISY_CONFIDENCE : NORMAL_CONFIDENCE,
        model: { modelId: "stormwatch-topic-affinity", version: "1" },
        timestamp: nowMs,
      };
    },
  };

  return {
    host,
    world: {
      get presentations() { return state.presentations; },
      get actionLog() { return [...state.actionLog]; },
      get providerAlphaUpLog() { return [...state.providerAlphaUpLog]; },
      get providerOutageSteps() { return [...state.providerOutageSteps]; },
      get failoverSteps() { return [...state.failoverSteps]; },
      get indexAgeHoursLog() { return [...state.indexAgeHoursLog]; },
      get staleSteps() { return [...state.staleSteps]; },
      get noisyDeltaSteps() { return [...state.noisyDeltaSteps]; },
      get interruptSteps() { return [...state.interruptSteps]; },
      get resumeSteps() { return [...state.resumeSteps]; },
      get delayedOutcomeReported() { return state.delayedOutcomeReported; },
      get outcomeSteps() { return [...state.outcomeSteps]; },
      get outcomeTypes() { return [...state.outcomeTypes]; },
      get deltaDimensions() { return [...state.deltaDimensions]; },
      get topicWeights() { return Object.fromEntries([...state.topicWeights.entries()].sort()); },
      get capabilityPhase() { return capabilityPhase; },
    },
  };
}

/** The topic-role key for a preference dimension (weight map key). */
function topicRoleOf(dimension: string): string {
  return dimension.replace("topic.", "");
}

/** Level metadata for wave reporting (mirrors the module's declarations). */
export const level20AdversarialMeta = {
  level: 20,
  name: "Adversarial/uncertain environment",
  hostAdapterId: "adapter-l20-stormwatch-1",
  requiredCapabilities: 12,
  expectedSatisfied: 12,
  expectedPartial: 0,
  expectedMissing: 0,
  expectedGaps: [] as readonly string[],
} as const;

export const level20ChurnDegradedMeta = {
  level: 20,
  name: "Adversarial/uncertain environment (churn phase, manifest v1)",
  hostAdapterId: "adapter-l20-stormwatch-1",
  requiredCapabilities: 12,
  expectedSatisfied: 11,
  expectedPartial: 0,
  expectedMissing: 1,
  expectedGaps: ["preference-feedback|ADAPTER_GAP"] as readonly string[],
} as const;
