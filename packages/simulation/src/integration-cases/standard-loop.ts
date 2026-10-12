/**
 * SIM-003 — the standard decision-loop declaration toolkit (W2 lane).
 *
 * The COMMON host-side wiring every Level 5–8 integration case needs,
 * provided by the simulation package so each synthetic host declares its
 * manifest/profile without re-writing platform plumbing (the ladder's
 * target: marginal host effort falls as common wiring moves platform-side):
 *
 * - `standardLoopManifestContent` — the capability-manifest content for the
 *   standard decision loop (12 supported entries with the API operations +
 *   SDK methods each maps to) plus the host's honest beyond-surface
 *   declarations (partial/gap entries with named friction categories);
 * - `standardLoopProfile` — the baseline Reckon-Complete profile a ladder
 *   level targets;
 * - `capabilityProbeProfile` — the capability PROBE profile that surfaces a
 *   beyond-surface friction into measured IntegrationEffortRecord gaps (the
 *   honest two-tier design documented in docs/simulations/integration-cases/
 *   README.md).
 *
 * The host remains the authority: it supplies its own hostSystem identity,
 * declaredAt clock, and beyond-surface findings — these builders only shape
 * them onto the frozen contract vocabulary.
 *
 * LAWS: no wall-clock reads, no unseeded randomness, imports ONLY
 * @reckon/contracts + intra-package harness modules.
 */
import type {
  ReckonCompleteCapability,
  ReckonCompleteFriction,
  ReckonCompleteProfileDeclarationInput,
} from "@reckon/contracts";
import type { SimulationManifestContentInput } from "../harness/host-adapter.js";

// ---------------------------------------------------------------------------
// The standard decision loop (what every Level 5–8 host wires)
// ---------------------------------------------------------------------------

/**
 * The capabilities a Level 5–8 host requires to run the standard decision
 * loop with switching/interruption/resume/replan semantics: identity, the
 * catalog + realizations, retrieval, objective/constraint/attention
 * declaration, decisions, HOST-SIDE schedule execution, outcomes,
 * preference feedback, and conformance itself.
 */
export const STANDARD_LOOP_REQUIRED_CAPABILITIES: readonly ReckonCompleteCapability[] = [
  "tenant-identity",
  "catalog-registration",
  "realization-declaration",
  "candidate-retrieval",
  "objective-declaration",
  "constraint-declaration",
  "attention-policy",
  "decision-request",
  "schedule-execution",
  "outcome-return",
  "preference-feedback",
  "conformance-verification",
];

/** A beyond-surface capability declaration (the honest partial/gap entry). */
export interface BeyondSurfaceCapability {
  readonly capability: ReckonCompleteCapability;
  readonly friction: ReckonCompleteFriction;
  readonly notes: string;
}

/**
 * The standard-loop capability manifest content for a synthetic host: the
 * twelve supported entries (with the API operations + SDK methods each
 * maps to) plus the level's honest beyond-surface declarations.
 */
export function standardLoopManifestContent(input: {
  readonly hostSystem: {
    readonly hostId: string;
    readonly name: string;
    readonly hostAdapterId: string;
    readonly version: string;
  };
  readonly declaredAt: number;
  readonly beyondSurface?: readonly BeyondSurfaceCapability[];
}): SimulationManifestContentInput {
  return {
    manifestVersion: "1",
    hostSystem: input.hostSystem,
    declaredAt: input.declaredAt,
    supportedCapabilities: [
      { capability: "tenant-identity", status: "supported", evidenceClass: "fixture" },
      {
        capability: "catalog-registration",
        status: "supported",
        evidenceClass: "fixture",
        apiOperations: ["POST /v1/catalog/items"],
        sdkMethods: ["catalog.upsertItem"],
      },
      {
        capability: "realization-declaration",
        status: "supported",
        evidenceClass: "fixture",
        apiOperations: ["POST /v1/catalog/realizations"],
        sdkMethods: ["catalog.upsertRealization"],
      },
      {
        capability: "candidate-retrieval",
        status: "supported",
        evidenceClass: "fixture",
        apiOperations: ["POST /v1/candidates"],
        sdkMethods: ["candidates.submit"],
      },
      {
        capability: "objective-declaration",
        status: "supported",
        evidenceClass: "fixture",
        notes: "objectives declared in-request on POST /v1/decisions",
      },
      {
        capability: "constraint-declaration",
        status: "supported",
        evidenceClass: "fixture",
        notes: "hard constraints (time-window, format-required/forbidden, max-cost, policy-rights, custom coupling/pacing gates) declared in-request on POST /v1/decisions",
      },
      {
        capability: "attention-policy",
        status: "supported",
        evidenceClass: "fixture",
        notes: "attention policies (mindful/balanced/immersive) declared in-request on POST /v1/decisions",
      },
      {
        capability: "decision-request",
        status: "supported",
        evidenceClass: "fixture",
        apiOperations: ["POST /v1/decisions"],
        sdkMethods: ["decisions.request"],
        notes: "requests carry currentExperience/planId/reward for switching, interruption, resume and rolling-plan coupling",
      },
      {
        capability: "schedule-execution",
        status: "supported",
        evidenceClass: "fixture",
        notes: "host-side execution of schedule deltas (QUEUE/CONTINUE/SUGGEST/SWITCH/INTERRUPT/RESUME, enqueue/dequeue, resume checkpoints) — no dedicated API surface; deltas arrive on decision results",
      },
      {
        capability: "outcome-return",
        status: "supported",
        evidenceClass: "fixture",
        apiOperations: ["POST /v1/outcomes"],
        sdkMethods: ["outcomes.append"],
      },
      {
        capability: "preference-feedback",
        status: "supported",
        evidenceClass: "fixture",
        apiOperations: ["POST /v1/preferences/events"],
        sdkMethods: ["preferences.appendDelta"],
      },
      { capability: "conformance-verification", status: "supported", evidenceClass: "fixture" },
      ...(input.beyondSurface ?? []).map((beyond) => ({
        capability: beyond.capability,
        status: "partial" as const,
        evidenceClass: "fixture" as const,
        friction: beyond.friction,
        apiOperations: [],
        sdkMethods: [],
        notes: beyond.notes,
      })),
    ],
  };
}

/** The baseline Reckon-Complete profile for a ladder level (the 12-capability standard loop). */
export function standardLoopProfile(input: {
  readonly profileId: string;
  readonly name: string;
  readonly description: string;
  readonly ladderLevel: 5 | 6 | 7 | 8;
  readonly declaredAt: number;
}): ReckonCompleteProfileDeclarationInput {
  return {
    profileId: input.profileId,
    name: input.name,
    description: input.description,
    ladderLevel: input.ladderLevel,
    requiredCapabilities: STANDARD_LOOP_REQUIRED_CAPABILITIES.map((capability) => ({
      capability,
    })),
    requiredEvidenceClass: "fixture",
    declaredAt: input.declaredAt,
  };
}

/**
 * The capability PROBE profile for a level: the standard loop PLUS one
 * beyond-surface capability the host genuinely needs for the domain —
 * honestly expected to be PARTIAL (the run's verdict is incomplete by
 * design; the record's gaps carry the named friction).
 */
export function capabilityProbeProfile(input: {
  readonly baseline: ReckonCompleteProfileDeclarationInput;
  readonly probeCapability: ReckonCompleteCapability;
  readonly probeNote?: string;
}): ReckonCompleteProfileDeclarationInput {
  return {
    ...input.baseline,
    profileId: `${input.baseline.profileId}-probe-${input.probeCapability}`,
    requiredCapabilities: [
      ...input.baseline.requiredCapabilities,
      { capability: input.probeCapability },
    ],
  };
}
