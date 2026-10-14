/**
 * SIM-006 — Ladder Level 18: the MULTI-SURFACE REALTIME synthetic host.
 *
 * Ladder definition (docs/simulations/reckon-complete-ladder.md):
 *   "Multi-surface realtime system — web/mobile/device bodies,
 *    cross-surface plans, explicit cross-device consent."
 *
 * The host owns a listening product (AuraPlay) with three surfaces —
 * web (desktop), mobile (phone), device (speaker) — behind ONE Personal
 * Agent logical identity (a single SubjectReference on every request,
 * whatever the surface; architecture law: the Personal Agent is one
 * logical identity with explicit cross-device permission).
 *
 * Per step the host asks Reckon for the next experience decision on the
 * step's surface through the PUBLIC standard loop only: manifest →
 * connect sources → candidates → decision request (objective, attention
 * policy, constraints, currentExperience, planId) → host presents →
 * outcome → preference delta.
 *
 * World-state transitions (all host-side, all deterministic, all
 * step-indexed — fixture-class scripted behaviors, never behavioral
 * claims):
 * - surfaces: the day rotates web → web → mobile → mobile → device →
 *   device → web → mobile; every surface has its own realizations of
 *   the shared catalog (kind surface-web / surface-mobile /
 *   surface-device-audio);
 * - explicit cross-device consent (the ladder's law — no implicit
 *   cross-surface data flow): the user grants cross-device consent at
 *   step 4. BEFORE the grant, a deciding surface references ONLY its own
 *   surface state — the request carries NO currentExperience from
 *   another surface and cross-surface candidates are withheld (step 3
 *   is surface-local: QUEUE, world records the withheld flow); the
 *   consent state CARRIES on every request as a custom hard constraint
 *   (the contract-idiomatic gate — rights/consent stays host authority);
 * - cross-surface handoffs (post-consent only): step 4 moves the
 *   episode to mobile (SWITCH, checkpoint), step 5 hands it to the
 *   device speaker (SWITCH); step 7 RESUMES the checkpointed episode on
 *   the web surface (the well-known "host-resume" source — a genuine
 *   cross-surface resume round-trip);
 * - cross-surface plan: every request couples to the day plan
 *   (planId "plan-l18-day-1"), echoed by every schedule delta;
 * - single logical identity: every request carries the SAME subject
 *   reference — the world records the distinct subject set (size 1).
 *
 * LAWS obeyed (SIM-006 work order):
 * - zero internal Reckon imports — only @reckon/contracts types and the
 *   harness host-adapter seam (enforced by the conformance scanner);
 * - no Math.random, no Date.now / wall-clock reads, no LLM/network;
 * - every synthetic outcome carries evidenceClass "fixture" — synthetic
 *   host output NEVER becomes observed evidence;
 * - deterministic: a fresh host from this factory + the same run seed
 *   yields byte-identical records (replay gate);
 * - realtime push to surfaces (webhook-delivery) is WANTED but not
 *   composed in the harness path (the SDK/API expose webhook endpoints,
 *   the SIM-001 port composes only the six standard-loop operations) —
 *   probed honestly as a webhook-delivery COMPOSITION_GAP record.
 *
 * Glue declaration (honest, host-declared; mechanically re-verified by
 * packages/simulation/test/levels-wave-c.test.ts):
 * - `loc` — comment-stripped non-blank lines of THIS module;
 * - `customAdapterLoc` — lines between the `glue:adapter` markers below
 *   (the surface world / consent / handoff code);
 * - `functions` — the named host functions: realizationForSurface,
 *   consentGrantedAt, surfaceConstraints, surfaceCandidates,
 *   createLevel18WorldState, createLevel18MultiSurfaceHost + its four
 *   adapter callbacks (10).
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
const TENANT: TenantScope = { tenantId: "tenant-l18-auraplay" };
/** ONE Personal Agent logical identity across every surface (the law). */
const SUBJECT: SubjectReference = { kind: "user", ref: "user-l18-listener-1" };

// --- glue:adapter:begin ----------------------------------------------------
// The multi-surface world: three delivery surfaces over one shared
// catalog, one day plan, and an explicit cross-device consent gate.

/** The delivery surfaces of the host product. */
type Surface = "web" | "mobile" | "device";

/** The realization id serving an item on a surface. */
function realizationForSurface(itemId: string, surface: Surface): string {
  return `l18-real-${itemId.replace("l18-item-", "")}-${surface}`;
}

/** Numeric surface codes (the frozen MetricPayload is numeric-only). */
const SURFACE_CODE: Readonly<Record<Surface, number>> = Object.freeze({
  web: 1,
  mobile: 2,
  device: 3,
});

/** The step at which the user EXPLICITLY grants cross-device consent. */
const CONSENT_GRANTED_STEP = 4;

/** Is cross-device consent granted as of this step (host authority)? */
function consentGrantedAt(step: number): boolean {
  return step >= CONSENT_GRANTED_STEP;
}

interface SurfaceStep {
  readonly step: number;
  readonly surface: Surface;
  readonly itemId: string;
  /** The retrieval provenance: normal, handoff, or cross-surface resume. */
  readonly source: string;
}

/** The day's listening script (consent-aware). */
const SURFACE_STEPS: readonly SurfaceStep[] = [
  { step: 1, surface: "web", itemId: "l18-item-ep1", source: "host-surface-retrieval" },
  { step: 2, surface: "web", itemId: "l18-item-ep1", source: "host-surface-retrieval" },
  { step: 3, surface: "mobile", itemId: "l18-item-news1", source: "host-surface-retrieval" },
  { step: 4, surface: "mobile", itemId: "l18-item-ep1", source: "host-handoff" },
  { step: 5, surface: "device", itemId: "l18-item-ambient1", source: "host-handoff" },
  { step: 6, surface: "device", itemId: "l18-item-ambient1", source: "host-surface-retrieval" },
  { step: 7, surface: "web", itemId: "l18-item-ep1", source: "host-resume" },
  { step: 8, surface: "mobile", itemId: "l18-item-news1", source: "host-surface-retrieval" },
];

/** The hard constraints carried on every request (incl. the consent gate). */
function surfaceConstraints(step: number): HardConstraint[] {
  return [
    { kind: "time-window", untilMs: 1_000 * 60 * 60 * (step + 2) },
    { kind: "max-latency", latencyMs: 300 },
    { kind: "catalog-rule", ruleId: "l18-surface-capability" },
    {
      kind: "custom",
      constraintId: "l18-cross-device-consent",
      params: { granted: consentGrantedAt(step), grantedAtStep: CONSENT_GRANTED_STEP },
    },
  ];
}

interface Level18WorldState {
  presentations: number;
  actionLog: string[];
  surfaceLog: Surface[];
  consentGrantedStep: number;
  consentWithheldSteps: number[];
  handoffSteps: number[];
  crossSurfaceResumeSteps: number[];
  crossSurfaceCurrentSteps: number[];
  subjectRefs: Set<string>;
  planCoupledSteps: number[];
  outcomeSteps: number[];
  outcomeTypes: string[];
  deltaDimensions: string[];
  surfaceWeights: Map<string, number>;
}

function createLevel18WorldState(): Level18WorldState {
  return {
    presentations: 0,
    actionLog: [],
    surfaceLog: [],
    consentGrantedStep: 0,
    consentWithheldSteps: [],
    handoffSteps: [],
    crossSurfaceResumeSteps: [],
    crossSurfaceCurrentSteps: [],
    subjectRefs: new Set<string>(),
    planCoupledSteps: [],
    outcomeSteps: [],
    outcomeTypes: [],
    deltaDimensions: [],
    surfaceWeights: new Map([
      ["web", 1],
      ["mobile", 1],
      ["device", 1],
    ]),
  };
}

/** The step's candidates on the deciding surface (post-consent aware). */
function surfaceCandidates(step: number): SurfaceStep[] {
  const entry = SURFACE_STEPS[step - 1]!;
  return [entry];
}
// --- glue:adapter:end ------------------------------------------------------

/** Host catalog source — connected once, before the loop (public API). */
const LEVEL18_CATALOG: { items: readonly CatalogItemInput[]; realizations: readonly RealizationInput[] } = {
  items: [
    { itemId: "l18-item-ep1", kind: "media", labels: ["series", "narrative"], attributes: { title: "Tide Signals — Episode 1", runtimeMinutes: 42 } },
    { itemId: "l18-item-ep2", kind: "media", labels: ["series", "narrative"], attributes: { title: "Tide Signals — Episode 2", runtimeMinutes: 44 } },
    { itemId: "l18-item-news1", kind: "media", labels: ["brief", "news"], attributes: { title: "Morning brief", runtimeMinutes: 8 } },
    { itemId: "l18-item-ambient1", kind: "media", labels: ["ambient", "audio"], attributes: { title: "Kitchen ambient mix", runtimeMinutes: 30 } },
  ],
  realizations: [
    { realizationId: "l18-real-ep1-web", itemId: "l18-item-ep1", kind: "surface-web", constraints: { surface: "web", bandwidthHint: "high" } },
    { realizationId: "l18-real-ep1-mobile", itemId: "l18-item-ep1", kind: "surface-mobile", constraints: { surface: "mobile", bandwidthHint: "medium" } },
    { realizationId: "l18-real-ep1-device", itemId: "l18-item-ep1", kind: "surface-device-audio", constraints: { surface: "device", bandwidthHint: "low", audioOnly: true } },
    { realizationId: "l18-real-ep2-web", itemId: "l18-item-ep2", kind: "surface-web", constraints: { surface: "web", bandwidthHint: "high" } },
    { realizationId: "l18-real-ep2-mobile", itemId: "l18-item-ep2", kind: "surface-mobile", constraints: { surface: "mobile", bandwidthHint: "medium" } },
    { realizationId: "l18-real-ep2-device", itemId: "l18-item-ep2", kind: "surface-device-audio", constraints: { surface: "device", bandwidthHint: "low", audioOnly: true } },
    { realizationId: "l18-real-news1-web", itemId: "l18-item-news1", kind: "surface-web", constraints: { surface: "web", bandwidthHint: "high" } },
    { realizationId: "l18-real-news1-mobile", itemId: "l18-item-news1", kind: "surface-mobile", constraints: { surface: "mobile", bandwidthHint: "medium" } },
    { realizationId: "l18-real-news1-device", itemId: "l18-item-news1", kind: "surface-device-audio", constraints: { surface: "device", bandwidthHint: "low", audioOnly: true } },
    { realizationId: "l18-real-ambient1-web", itemId: "l18-item-ambient1", kind: "surface-web", constraints: { surface: "web", bandwidthHint: "high" } },
    { realizationId: "l18-real-ambient1-mobile", itemId: "l18-item-ambient1", kind: "surface-mobile", constraints: { surface: "mobile", bandwidthHint: "medium" } },
    { realizationId: "l18-real-ambient1-device", itemId: "l18-item-ambient1", kind: "surface-device-audio", constraints: { surface: "device", bandwidthHint: "low", audioOnly: true } },
  ],
};

/** The host's honest capability manifest (composed surface). */
const LEVEL18_MANIFEST_CONTENT: SimulationManifestContentInput = {
  manifestVersion: "1",
  hostSystem: {
    hostId: "host-l18-auraplay",
    name: "AuraPlay",
    hostAdapterId: "adapter-l18-auraplay-1",
    version: "0.1.0",
  },
  declaredAt: 0,
  supportedCapabilities: [
    { capability: "tenant-identity", status: "supported", evidenceClass: "fixture", notes: "ONE Personal Agent logical identity — a single subject reference on every request across all three surfaces" },
    { capability: "catalog-registration", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/catalog/items"], sdkMethods: ["catalog.upsertItem"] },
    { capability: "realization-declaration", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/catalog/realizations"], sdkMethods: ["catalog.upsertRealization"], notes: "one realization per (item, surface) — surface-web / surface-mobile / surface-device-audio delivery envelopes" },
    { capability: "candidate-retrieval", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/candidates"], sdkMethods: ["candidates.submit"], notes: "candidates carry the surface's realization and the handoff/resume provenance" },
    { capability: "objective-declaration", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/decisions"], sdkMethods: ["decisions.request"], notes: "objective declared on every decision request (in-request field)" },
    { capability: "constraint-declaration", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/decisions"], sdkMethods: ["decisions.request"], notes: "every request carries the custom l18-cross-device-consent hard constraint (the explicit consent gate — host authority)" },
    { capability: "attention-policy", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/decisions"], sdkMethods: ["decisions.request"], notes: "attention policy declared on every decision request (in-request field)" },
    { capability: "decision-request", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/decisions"], sdkMethods: ["decisions.request"], notes: "requests carry currentExperience only when the owning surface's state may flow (consent law); the day plan couples via planId" },
    { capability: "schedule-execution", status: "supported", evidenceClass: "fixture", notes: "host-side execution of schedule deltas (surface-local QUEUE/CONTINUE, post-consent handoff SWITCH, cross-surface RESUME)" },
    { capability: "outcome-return", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/outcomes"], sdkMethods: ["outcomes.append"], notes: "outcome metrics carry the surface, consent state, and cross-surface facts" },
    { capability: "preference-feedback", status: "supported", evidenceClass: "fixture", apiOperations: ["POST /v1/preferences/events"], sdkMethods: ["preferences.appendDelta"], notes: "surface-affinity deltas (host-side preference model)" },
    { capability: "conformance-verification", status: "supported", evidenceClass: "fixture", notes: "harness conformance verdict; no API route — machine-checked offline" },
  ],
};

/** The probe manifest: realtime push is not composed in the harness path. */
const LEVEL18_PROBE_MANIFEST_CONTENT: SimulationManifestContentInput = {
  ...LEVEL18_MANIFEST_CONTENT,
  supportedCapabilities: [
    ...LEVEL18_MANIFEST_CONTENT.supportedCapabilities,
    {
      capability: "webhook-delivery",
      status: "partial",
      evidenceClass: "fixture",
      friction: "COMPOSITION_GAP",
      apiOperations: ["POST /v1/webhooks/endpoints"],
      sdkMethods: ["webhookEndpoints.create"],
      notes:
        "a multi-surface realtime system wants thin-event push to its surfaces (decision/schedule/outcome notifications), and the SDK/API expose webhook endpoint create/list/get + event/delivery surfaces, but the SIM-001 harness port composes only the six standard-loop operations — realtime push cannot cross the composed public path, so surfaces poll through the standard loop instead",
    },
  ],
};

/** The Level 18 Reckon-Complete profile: what this archetype REQUIRES. */
export const level18MultiSurfaceProfile: ReckonCompleteProfileDeclarationInput = {
  profileId: "profile-l18-multi-surface",
  name: "Multi-surface realtime system",
  description: "SIM-006 ladder level 18 — web/mobile/device bodies, cross-surface plans, explicit cross-device consent.",
  ladderLevel: 18,
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

/** The capability-probe profile: the level also WANTS realtime push. */
export const level18WebhookDeliveryProbeProfile: ReckonCompleteProfileDeclarationInput = {
  ...level18MultiSurfaceProfile,
  profileId: "profile-l18-multi-surface-probe",
  name: "Multi-surface realtime system (webhook-delivery probe)",
  description:
    "SIM-006 ladder level 18 capability probe — additionally requires webhook-delivery; the composed harness path cannot express it (honest COMPOSITION_GAP).",
  requiredCapabilities: [
    ...level18MultiSurfaceProfile.requiredCapabilities,
    { capability: "webhook-delivery" },
  ],
};

/** Read-only view over the final world state (deterministic assertions). */
export interface Level18WorldView {
  readonly presentations: number;
  readonly actionLog: readonly string[];
  readonly surfaceLog: readonly string[];
  readonly consentGrantedStep: number;
  readonly consentWithheldSteps: readonly number[];
  readonly handoffSteps: readonly number[];
  readonly crossSurfaceResumeSteps: readonly number[];
  readonly crossSurfaceCurrentSteps: readonly number[];
  readonly distinctSubjectCount: number;
  readonly planCoupledSteps: readonly number[];
  readonly outcomeSteps: readonly number[];
  readonly outcomeTypes: readonly string[];
  readonly deltaDimensions: readonly string[];
  readonly surfaceWeights: Readonly<Record<string, number>>;
}

/** A fresh Level 18 host (fresh world state — replay-safe by construction). */
export interface Level18Host {
  readonly host: SimulationHostAdapter;
  readonly world: Level18WorldView;
}

export function createLevel18MultiSurfaceHost(): Level18Host {
  const state = createLevel18WorldState();
  /**
   * The current experience on the LAST deciding surface. The consent
   * law is enforced HERE: before the grant, a surface may only carry
   * currentExperience that belongs to ITS OWN surface (cross-surface
   * state is withheld — no implicit cross-surface data flow).
   */
  let surfaceLocalExperience: ExperienceInput | undefined;
  let surfaceLocalSurface: Surface | null = null;

  const host: SimulationHostAdapter = {
    hostAdapterId: "adapter-l18-auraplay-1",
    hostSystem: {
      hostId: "host-l18-auraplay",
      name: "AuraPlay",
      version: "0.1.0",
    },
    // Glue honesty (wave-C battery recounts mechanically): loc = the
    // module's comment-stripped non-blank lines; the custom adapter LOC
    // = the recount inside the glue:adapter markers.
    glue: { functions: 10, loc: 405, customAdapterLoc: 83 },
    manifestContent: LEVEL18_MANIFEST_CONTENT,
    catalog: {
      items: LEVEL18_CATALOG.items.map((item) => ({ ...item })),
      realizations: LEVEL18_CATALOG.realizations.map((realization) => ({ ...realization })),
    },

    provideDecisionInputs(step: number): HostDecisionInputs {
      const entry = surfaceCandidates(step)[0]!;
      const surface = entry.surface;
      state.surfaceLog.push(surface);
      state.subjectRefs.add(`${SUBJECT.kind}:${SUBJECT.ref}`);
      state.planCoupledSteps.push(step);
      if (step === CONSENT_GRANTED_STEP) state.consentGrantedStep = step;
      const consent = consentGrantedAt(step);
      // The consent law: carry currentExperience ONLY when it belongs to
      // the deciding surface (always allowed) OR consent has been
      // explicitly granted (cross-surface flow allowed).
      const currentBelongsToSurface =
        surfaceLocalExperience !== undefined && surfaceLocalSurface === surface;
      const mayCarryCurrent = surfaceLocalExperience !== undefined && (currentBelongsToSurface || consent);
      if (surfaceLocalExperience !== undefined && !currentBelongsToSurface && !consent) {
        state.consentWithheldSteps.push(step);
      }
      if (surfaceLocalExperience !== undefined && !currentBelongsToSurface && consent) {
        state.crossSurfaceCurrentSteps.push(step);
      }
      return {
        contextId: `ctx-l18-${step}-${surface}`,
        tenant: TENANT,
        subject: SUBJECT,
        objective: {
          objectiveId: "obj-l18-day-listening",
          version: "1",
          kind: "be-entertained",
          params: { dayPlan: "single-identity", surface },
        },
        attentionPolicy: {
          policyId: "ap-l18-balanced",
          version: "1",
          style: "balanced",
          params: { crossSurfaceHandoff: "consent-gated" },
        },
        candidates: {
          setId: `cs-l18-${step}`,
          candidates: [
            {
              itemId: entry.itemId,
              realizationIds: [realizationForSurface(entry.itemId, surface)],
              source: entry.source,
              rankHint: 1,
            },
          ],
        },
        constraints: surfaceConstraints(step),
        policySelector: { policyId: "auraplay-day-v1" },
        ...(mayCarryCurrent ? { currentExperience: surfaceLocalExperience } : {}),
        planId: "plan-l18-day-1",
      };
    },

    consumeDecision(step: number, result: DecisionResult): HostDecisionReaction {
      state.presentations += 1;
      state.actionLog.push(result.action);
      const entry = SURFACE_STEPS[step - 1]!;
      if (entry.source === "host-handoff") state.handoffSteps.push(step);
      if (entry.source === "host-resume") state.crossSurfaceResumeSteps.push(step);
      surfaceLocalExperience = result.selectedExperience;
      surfaceLocalSurface = entry.surface;
      return { presented: true };
    },

    provideOutcome(step: number, result: DecisionResult, _reaction: HostDecisionReaction, nowMs: number) {
      state.outcomeSteps.push(step);
      const entry = SURFACE_STEPS[step - 1]!;
      const crossSurface = state.handoffSteps.includes(step) || state.crossSurfaceResumeSteps.includes(step);
      let eventType: "start" | "conversion" | "resume" | "custom" = "custom";
      let customEventType: string | undefined = "surface-continue";
      if (step === SURFACE_STEPS.length) {
        eventType = "conversion";
        customEventType = undefined;
      } else if (state.crossSurfaceResumeSteps.includes(step)) {
        eventType = "resume";
        customEventType = undefined;
      } else if (step === 1) {
        eventType = "start";
        customEventType = undefined;
      } else if (state.handoffSteps.includes(step)) {
        customEventType = "cross-surface-handoff";
      } else if (state.consentWithheldSteps.includes(step)) {
        customEventType = "surface-local-queue";
      }
      state.outcomeTypes.push(eventType);
      const surfacesUsed = new Set(state.surfaceLog).size;
      return {
        eventId: `ev-l18-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        decisionId: result.decisionId,
        experienceId: result.selectedExperience?.experienceId,
        eventType,
        ...(customEventType !== undefined ? { customEventType } : {}),
        occurredAt: nowMs,
        evidenceClass: "fixture" as const,
        metrics: {
          surfaceCode: SURFACE_CODE[entry.surface],
          consentGranted: consentGrantedAt(step) ? 1 : 0,
          crossSurface: crossSurface ? 1 : 0,
          surfacesUsedSoFar: surfacesUsed,
          ...(step === SURFACE_STEPS.length
            ? {
                surfacesUsed,
                crossSurfaceSwitches: state.handoffSteps.length,
                consentGrantedAtStep: CONSENT_GRANTED_STEP,
              }
            : {}),
        },
        idempotencyKey: `idem-out-l18-${step}`,
      };
    },

    providePreferenceDelta(step: number, _result: DecisionResult, nowMs: number) {
      const entry = SURFACE_STEPS[step - 1]!;
      const dimension = `surface.${entry.surface}`;
      state.deltaDimensions.push(dimension);
      const weight = (state.surfaceWeights.get(entry.surface) ?? 1) + 0.1;
      state.surfaceWeights.set(entry.surface, Math.round(weight * 100) / 100);
      return {
        deltaId: `delta-l18-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        dimension,
        op: "add" as const,
        newValue: Math.round(weight * 100) / 100,
        resultingConfidence: Math.min(0.9, 0.5 + 0.05 * step),
        model: { modelId: "auraplay-surface-affinity", version: "1" },
        timestamp: nowMs,
      };
    },
  };

  return {
    host,
    world: {
      get presentations() { return state.presentations; },
      get actionLog() { return [...state.actionLog]; },
      get surfaceLog() { return [...state.surfaceLog]; },
      get consentGrantedStep() { return state.consentGrantedStep; },
      get consentWithheldSteps() { return [...state.consentWithheldSteps]; },
      get handoffSteps() { return [...state.handoffSteps]; },
      get crossSurfaceResumeSteps() { return [...state.crossSurfaceResumeSteps]; },
      get crossSurfaceCurrentSteps() { return [...state.crossSurfaceCurrentSteps]; },
      get distinctSubjectCount() { return state.subjectRefs.size; },
      get planCoupledSteps() { return [...state.planCoupledSteps]; },
      get outcomeSteps() { return [...state.outcomeSteps]; },
      get outcomeTypes() { return [...state.outcomeTypes]; },
      get deltaDimensions() { return [...state.deltaDimensions]; },
      get surfaceWeights() { return Object.fromEntries([...state.surfaceWeights.entries()].sort()); },
    },
  };
}

/** Level metadata for wave reporting (mirrors the module's declarations). */
export const level18MultiSurfaceMeta = {
  level: 18,
  name: "Multi-surface realtime system",
  hostAdapterId: "adapter-l18-auraplay-1",
  requiredCapabilities: 12,
  expectedSatisfied: 12,
  expectedPartial: 0,
  expectedMissing: 0,
  expectedGaps: [] as readonly string[],
} as const;

export const level18WebhookDeliveryProbeMeta = {
  level: 18,
  name: "Multi-surface realtime system (webhook-delivery probe)",
  hostAdapterId: "adapter-l18-auraplay-1",
  requiredCapabilities: 13,
  expectedSatisfied: 12,
  expectedPartial: 1,
  expectedMissing: 0,
  expectedGaps: ["webhook-delivery|COMPOSITION_GAP"] as readonly string[],
} as const;

/**
 * The webhook-delivery PROBE host: the same multi-surface behavior,
 * measured against the stricter profile — its manifest additionally
 * declares the webhook-delivery PARTIAL entry (COMPOSITION_GAP) so the
 * probe run's verdict is honestly incomplete and the record carries the
 * finding.
 */
export function createLevel18WebhookDeliveryProbeHost(): Level18Host {
  const handle = createLevel18MultiSurfaceHost();
  return {
    host: { ...handle.host, manifestContent: LEVEL18_PROBE_MANIFEST_CONTENT },
    world: handle.world,
  };
}
