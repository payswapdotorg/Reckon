/**
 * SIM-004 — Ladder Level 10: the MOBILITY / RIDE-HAILING synthetic host.
 *
 * Ladder definition (docs/simulations/reckon-complete-ladder.md):
 *   "Mobility / ride-hailing — real-time matching, spatial context,
 *    scarce resources, tight latency."
 *
 * The host owns a ride-hailing slice (host-owned fleet, zones, surge
 * model, fare/ETA authority — architecture law) and asks Reckon for the
 * next dispatch decision through the PUBLIC surface only: manifest →
 * connect sources → per step: candidates → decision request (objective,
 * attention policy, constraints, currentExperience) → host presents →
 * outcome → preference delta.
 *
 * World-state transitions (all host-side, all deterministic, all
 * step-indexed — fixture-class scripted behaviors, never behavioral
 * claims):
 * - real-time matching: every step is a dispatch decision over the
 *   currently-available fleet; a matched vehicle leaves the pool until
 *   its ride completes (+ cooldown), then re-enters;
 * - spatial context: the rider's pickup zone rotates central → north →
 *   east → south; the per-step context ids reference the zone, but the
 *   frozen ContextSnapshot payload (location.coarse + device.class)
 *   CANNOT cross the public surface — the honest `context-snapshots`
 *   partial / API_GAP, the THIRD domain (after Wave A levels 2 and 4)
 *   for the ladder's 3-domain law;
 * - scarce resources: the south zone has NO home vehicles — its request
 *   is served by the nearest-zone vehicle with an eta penalty
 *   (retrieval source "host-nearest-zone");
 * - tight latency: every request carries a max-latency budget (250
 *   virtual ms) and first-decision timing is measured honestly;
 * - surge: at step 5 the eta degrades (surge multiplier 1.8) and the
 *   host requests a time-critical re-dispatch (source
 *   "host-time-critical") which INTERRUPTs the in-flight ride with a
 *   retained resume checkpoint.
 *
 * LAWS obeyed (SIM-004 work order):
 * - zero internal Reckon imports — only @reckon/contracts types + the
 *   harness host-adapter seam (enforced by the conformance scanner);
 * - no Math.random, no Date.now / wall-clock reads, no LLM/network;
 * - every synthetic outcome carries evidenceClass "fixture" — synthetic
 *   host output NEVER becomes observed evidence;
 * - deterministic: a fresh host from this factory + the same run seed
 *   yields byte-identical records (replay gate).
 *
 * Glue declaration (honest, host-declared; mechanically re-verified by
 * packages/simulation/test/levels-wave-b.test.ts):
 * - `loc` — comment-stripped non-blank lines of THIS module;
 * - `customAdapterLoc` — lines between the `glue:adapter` markers below
 *   (the fleet / zone / scarcity / surge code);
 * - `functions` — the named host functions: zoneForStep,
 *   isVehicleAvailable, etaForVehicle, mobilityCandidates,
 *   dispatchConstraints, provideDecisionInputs, consumeDecision,
 *   provideOutcome, providePreferenceDelta,
 *   createLevel10MobilityHost (10 total).
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
const TENANT: TenantScope = { tenantId: "tenant-l10-mobility" };
const SUBJECT: SubjectReference = { kind: "user", ref: "user-l10-rider-1" };

// --- glue:adapter:begin ----------------------------------------------------
// The mobility world: 3 ride tiers, 5 vehicle slots (the SCARCE
// resource), 4 pickup zones, and a deterministic surge model. The fleet
// pool, zone rotation, and surge are HOST-owned.

const ZONES = ["central", "north", "east", "south"] as const;
type Zone = (typeof ZONES)[number];

interface FleetVehicle {
  readonly vehicleId: string;
  readonly itemId: string;
  readonly tier: string;
  readonly zone: Zone;
  readonly baseEtaMinutes: number;
  /** Cross-zone dispatch penalty when the request zone has no home vehicle. */
  readonly crossZonePenaltyMinutes: number;
}

const FLEET: readonly FleetVehicle[] = [
  { vehicleId: "l10-veh-standard-01", itemId: "l10-ride-standard", tier: "standard", zone: "central", baseEtaMinutes: 4, crossZonePenaltyMinutes: 6 },
  { vehicleId: "l10-veh-standard-02", itemId: "l10-ride-standard", tier: "standard", zone: "north", baseEtaMinutes: 5, crossZonePenaltyMinutes: 6 },
  { vehicleId: "l10-veh-standard-03", itemId: "l10-ride-standard", tier: "standard", zone: "east", baseEtaMinutes: 5, crossZonePenaltyMinutes: 6 },
  { vehicleId: "l10-veh-xl-01", itemId: "l10-ride-xl", tier: "xl", zone: "central", baseEtaMinutes: 7, crossZonePenaltyMinutes: 4 },
  { vehicleId: "l10-veh-green-01", itemId: "l10-ride-green", tier: "green", zone: "east", baseEtaMinutes: 9, crossZonePenaltyMinutes: 5 },
];

/** The surge step: eta degrades and a time-critical re-dispatch is requested. */
const SURGE_STEP = 5;
const SURGE_MULTIPLIER = 1.8;
/** Steps until a completed vehicle re-enters the pool. */
const COMPLETION_COOLDOWN_STEPS = 2;
/** Steps until an interrupted vehicle is released. */
const INTERRUPT_RELEASE_STEPS = 1;
/** The tight-latency budget on every dispatch request (virtual ms). */
const LATENCY_BUDGET_MS = 250;

interface RideRecord {
  readonly rideId: number;
  readonly pickupZone: Zone;
  readonly vehicleId: string;
  readonly matchedAtStep: number;
  completedAtStep: number | null;
}

interface Level10WorldState {
  presentations: number;
  rideCounter: number;
  rides: RideRecord[];
  /** vehicleId → free-from step (busy/cooldown bookkeeping). */
  busyUntil: Map<string, number>;
  zoneRotation: string[];
  matchedLog: Array<{ step: number; vehicleId: string; zone: string; source: string }>;
  poolLog: string[][];
  surgeSteps: number[];
  completedRides: number[];
  inFlightAtEnd: string | null;
  candidateSources: string[];
  etaLog: number[];
  outcomeSteps: number[];
  outcomeTypes: string[];
  deltaDimensions: string[];
  zoneWeights: Map<string, number>;
}

/** Read-only view over the final world state (for deterministic assertions). */
export interface Level10WorldView {
  readonly presentations: number;
  readonly rideCounter: number;
  readonly rides: readonly RideRecord[];
  readonly zoneRotation: readonly string[];
  readonly matchedLog: ReadonlyArray<{ step: number; vehicleId: string; zone: string; source: string }>;
  readonly poolLog: readonly (readonly string[])[];
  readonly surgeSteps: readonly number[];
  readonly completedRides: readonly number[];
  readonly inFlightAtEnd: string | null;
  readonly candidateSources: readonly string[];
  readonly etaLog: readonly number[];
  readonly outcomeSteps: readonly number[];
  readonly outcomeTypes: readonly string[];
  readonly deltaDimensions: readonly string[];
  readonly zoneWeights: Readonly<Record<string, number>>;
}

function createLevel10WorldState(): Level10WorldState {
  return {
    presentations: 0,
    rideCounter: 0,
    rides: [],
    busyUntil: new Map(),
    zoneRotation: [],
    matchedLog: [],
    poolLog: [],
    surgeSteps: [],
    completedRides: [],
    inFlightAtEnd: null,
    candidateSources: [],
    etaLog: [],
    outcomeSteps: [],
    outcomeTypes: [],
    deltaDimensions: [],
    zoneWeights: new Map([["central", 1], ["east", 1], ["north", 1], ["south", 1]]),
  };
}

/** The rider's pickup zone this step (deterministic rotation). */
function zoneForStep(step: number): Zone {
  return ZONES[(step - 1) % ZONES.length]!;
}

/** Is the vehicle dispatchable this step (not busy, not cooling down)? */
function isVehicleAvailable(vehicle: FleetVehicle, busyUntil: ReadonlyMap<string, number>, step: number): boolean {
  return (busyUntil.get(vehicle.vehicleId) ?? 0) < step;
}

/** The eta this step for a vehicle (surge multiplier applies on surge steps). */
function etaForVehicle(vehicle: FleetVehicle, zone: Zone, step: number): number {
  const penalty = vehicle.zone === zone ? 0 : vehicle.crossZonePenaltyMinutes;
  const surge = step === SURGE_STEP ? SURGE_MULTIPLIER : 1;
  return Math.max(1, Math.round((vehicle.baseEtaMinutes + penalty) * surge));
}

interface MobilityCandidate {
  readonly itemId: string;
  readonly realizationIds: string[];
  readonly source: string;
  readonly rankHint: number;
}

/** Retrieval: the dispatchable vehicles for this step's request zone. */
function mobilityCandidates(
  busyUntil: ReadonlyMap<string, number>,
  step: number,
  liveVehicleId: string | null,
): MobilityCandidate[] {
  const zone = zoneForStep(step);
  if (liveVehicleId !== null && step !== SURGE_STEP) {
    // Ride in progress: continue the matched vehicle (CONTINUE semantics).
    const vehicle = FLEET.find((entry) => entry.vehicleId === liveVehicleId);
    return vehicle === undefined
      ? []
      : [{ itemId: vehicle.itemId, realizationIds: [vehicle.vehicleId], source: "host-ride-track", rankHint: 1 }];
  }
  if (liveVehicleId !== null && step === SURGE_STEP) {
    // Surge: request the time-critical re-dispatch to the best alternative.
    const alternatives = FLEET.filter(
      (vehicle) => vehicle.vehicleId !== liveVehicleId && isVehicleAvailable(vehicle, busyUntil, step),
    ).map((vehicle) => ({ vehicle, eta: etaForVehicle(vehicle, zone, step) }));
    const best = alternatives.sort((a, b) => a.eta - b.eta)[0];
    return best === undefined
      ? []
      : [{ itemId: best.vehicle.itemId, realizationIds: [best.vehicle.vehicleId], source: "host-time-critical", rankHint: 1 }];
  }
  // Fresh request: home-zone vehicles first (scarce resources), then the
  // nearest-zone vehicle with an eta penalty when the zone has none.
  const home = FLEET.filter(
    (vehicle) => vehicle.zone === zone && isVehicleAvailable(vehicle, busyUntil, step),
  ).map((vehicle) => ({ vehicle, eta: etaForVehicle(vehicle, zone, step), crossZone: false }));
  const nearest = FLEET.filter(
    (vehicle) => vehicle.zone !== zone && isVehicleAvailable(vehicle, busyUntil, step),
  ).map((vehicle) => ({ vehicle, eta: etaForVehicle(vehicle, zone, step), crossZone: true }));
  const pool = (home.length > 0 ? home : nearest).sort((a, b) => a.eta - b.eta);
  return pool.map((entry, index) => ({
    itemId: entry.vehicle.itemId,
    realizationIds: [entry.vehicle.vehicleId],
    source: entry.crossZone ? "host-nearest-zone" : "home-zone-supply",
    rankHint: index + 1,
  }));
}

/** Tight-latency + dispatch constraints on every request. */
function dispatchConstraints(zone: Zone): HardConstraint[] {
  return [
    { kind: "max-latency", latencyMs: LATENCY_BUDGET_MS },
    { kind: "custom", constraintId: "l10-driver-supply", params: { zone, minDriversRequired: 1 } },
  ];
}
// --- glue:adapter:end ------------------------------------------------------

/** Host catalog source — connected once, before the loop (public API). */
const LEVEL10_CATALOG: { items: readonly CatalogItemInput[]; realizations: readonly RealizationInput[] } = {
  items: [
    { itemId: "l10-ride-standard", kind: "other", labels: ["ride", "standard"], attributes: { tier: "standard", capacity: 4 } },
    { itemId: "l10-ride-xl", kind: "other", labels: ["ride", "xl"], attributes: { tier: "xl", capacity: 6 } },
    { itemId: "l10-ride-green", kind: "other", labels: ["ride", "green"], attributes: { tier: "green", capacity: 4 } },
  ],
  realizations: FLEET.map((vehicle) => ({
    realizationId: vehicle.vehicleId,
    itemId: vehicle.itemId,
    kind: "vehicle-dispatch",
    constraints: { homeZone: vehicle.zone, baseEtaMinutes: vehicle.baseEtaMinutes, tier: vehicle.tier },
  })),
};

/** The host's honest capability manifest (statuses, evidence, ops, methods). */
const LEVEL10_MANIFEST_CONTENT: SimulationManifestContentInput = {
  manifestVersion: "1",
  hostSystem: {
    hostId: "host-l10-mobility",
    name: "VectorHail Mobility",
    hostAdapterId: "adapter-l10-mobility-1",
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
    },
    {
      capability: "realization-declaration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/catalog/realizations"],
      sdkMethods: ["catalog.upsertRealization"],
      notes: "each vehicle slot is a realization; realization constraints carry the host-owned home zone / base ETA / tier delivery characteristics",
    },
    {
      capability: "candidate-retrieval",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/candidates"],
      sdkMethods: ["candidates.submit"],
      notes: "per-step dispatch candidate sets over the scarce vehicle pool (home-zone supply, nearest-zone fallback)",
    },
    {
      capability: "objective-declaration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "objective declared on every decision request (in-request field)",
    },
    {
      capability: "constraint-declaration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "max-latency tight dispatch budget + custom driver-supply gate on every request",
    },
    {
      capability: "attention-policy",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "attention policy declared on every decision request (in-request field)",
    },
    {
      capability: "decision-request",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "requests carry currentExperience for the in-flight ride (CONTINUE tracking, INTERRUPT surge re-dispatch)",
    },
    {
      capability: "schedule-execution",
      status: "supported",
      evidenceClass: "fixture",
      notes: "host-side execution of schedule deltas (QUEUE match, CONTINUE ride tracking, INTERRUPT surge re-dispatch with retained checkpoint)",
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
    {
      capability: "conformance-verification",
      status: "supported",
      evidenceClass: "fixture",
      notes: "harness conformance verdict; no API route — machine-checked offline",
    },
    {
      capability: "context-snapshots",
      status: "partial",
      evidenceClass: "fixture",
      friction: "API_GAP",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes:
        "spatial context (the rider's pickup zone as location.coarse, the in-vehicle device class) lives in the frozen ContextSnapshot payload but the public surface carries an opaque contextId only — no ingestion route exists, so the mobility host's spatial context cannot cross the public surface as data, third domain after Wave A levels 2 and 4",
    },
  ],
};

/** The Level 10 Reckon-Complete profile: what this archetype REQUIRES. */
export const level10MobilityProfile: ReckonCompleteProfileDeclarationInput = {
  profileId: "profile-l10-mobility",
  name: "Mobility / ride-hailing",
  description: "SIM-004 ladder level 10 — real-time matching, spatial context, scarce resources, tight latency.",
  ladderLevel: 10,
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
    { capability: "context-snapshots" },
  ],
  requiredEvidenceClass: "fixture",
  declaredAt: 1_000,
};

/** A fresh Level 10 host (fresh world state — replay-safe by construction). */
export interface Level10Host {
  readonly host: SimulationHostAdapter;
  readonly world: Level10WorldView;
}

export function createLevel10MobilityHost(): Level10Host {
  const state = createLevel10WorldState();
  /** The experience the previous step's decision selected (the live ride). */
  let liveExperience: ExperienceInput | undefined;
  let liveVehicleId: string | null = null;

  const host: SimulationHostAdapter = {
    hostAdapterId: "adapter-l10-mobility-1",
    hostSystem: {
      hostId: "host-l10-mobility",
      name: "VectorHail Mobility",
      version: "0.1.0",
    },
    glue: { functions: 10, loc: 507, customAdapterLoc: 142 },
    manifestContent: LEVEL10_MANIFEST_CONTENT,
    catalog: {
      items: LEVEL10_CATALOG.items.map((item) => ({ ...item })),
      realizations: LEVEL10_CATALOG.realizations.map((realization) => ({ ...realization })),
    },

    provideDecisionInputs(step: number): HostDecisionInputs {
      const zone = zoneForStep(step);
      state.zoneRotation.push(zone);
      if (step === SURGE_STEP) state.surgeSteps.push(step);
      state.poolLog.push(
        FLEET.filter((vehicle) => isVehicleAvailable(vehicle, state.busyUntil, step)).map(
          (vehicle) => vehicle.vehicleId,
        ),
      );
      const candidates = mobilityCandidates(state.busyUntil, step, liveVehicleId);
      state.candidateSources.push(candidates[0]?.source ?? "none");
      const vehicle = candidates[0] !== undefined ? FLEET.find((entry) => entry.vehicleId === candidates[0]!.realizationIds[0]) : undefined;
      if (vehicle !== undefined) {
        state.etaLog.push(etaForVehicle(vehicle, zone, step));
      }
      return {
        contextId: `ctx-l10-${step}-${zone}`,
        tenant: TENANT,
        subject: SUBJECT,
        objective: {
          objectiveId: "obj-l10-arrive-on-time",
          version: "1",
          kind: "complete-task",
          params: { mode: "dispatch", zone },
        },
        attentionPolicy: {
          policyId: "ap-l10-balanced",
          version: "1",
          style: "balanced",
          params: { maxReassignmentsPerRide: 1 },
        },
        candidates: {
          setId: `cs-l10-${step}`,
          candidates: candidates.map((candidate) => ({ ...candidate })),
        },
        constraints: dispatchConstraints(zone),
        policySelector: { policyId: "vectorhail-dispatch-v1" },
        ...(liveExperience !== undefined ? { currentExperience: liveExperience } : {}),
      };
    },

    consumeDecision(step: number, result: DecisionResult): HostDecisionReaction {
      const vehicleId = result.selectedExperience?.realizationId ?? "";
      state.presentations += 1;
      if (result.action === "INTERRUPT" && liveVehicleId !== null) {
        // Surge re-dispatch: the interrupted vehicle is released after
        // the release window; the interrupted RIDE closes (terminated by
        // re-dispatch); the new vehicle takes over as a new ride.
        const interruptedRide = state.rides.find(
          (ride) => ride.vehicleId === liveVehicleId && ride.completedAtStep === null,
        );
        if (interruptedRide !== undefined) {
          state.rides = state.rides.map((ride) =>
            ride.rideId === interruptedRide.rideId ? { ...ride, completedAtStep: step } : ride,
          );
        }
        state.busyUntil.set(liveVehicleId, step + INTERRUPT_RELEASE_STEPS);
        state.rideCounter += 1;
        state.rides.push({
          rideId: state.rideCounter,
          pickupZone: zoneForStep(step),
          vehicleId,
          matchedAtStep: step,
          completedAtStep: null,
        });
        state.matchedLog.push({ step, vehicleId, zone: zoneForStep(step), source: "host-time-critical" });
        state.busyUntil.set(vehicleId, step + 99);
      } else if (result.action === "QUEUE" && liveVehicleId === null) {
        // Fresh match: the vehicle leaves the pool until the ride ends.
        state.rideCounter += 1;
        state.rides.push({
          rideId: state.rideCounter,
          pickupZone: zoneForStep(step),
          vehicleId,
          matchedAtStep: step,
          completedAtStep: null,
        });
        state.matchedLog.push({
          step,
          vehicleId,
          zone: zoneForStep(step),
          source: state.candidateSources[state.candidateSources.length - 1] ?? "home-zone-supply",
        });
        state.busyUntil.set(vehicleId, step + 99);
      }
      // CONTINUE steps keep the live ride (completion is an outcome, below).
      liveExperience = result.selectedExperience;
      liveVehicleId = result.selectedExperience?.realizationId ?? null;
      return { presented: true };
    },

    provideOutcome(step: number, result: DecisionResult, _reaction: HostDecisionReaction, nowMs: number) {
      state.outcomeSteps.push(step);
      const ride = state.rides.find((entry) => entry.vehicleId === (result.selectedExperience?.realizationId ?? "") && entry.completedAtStep === null);
      const zone = zoneForStep(step);
      const interrupted = result.action === "INTERRUPT";
      const completing = step % 3 === 0 && !interrupted;
      let eventType: "start" | "completion" | "interruption-accept" | "custom" = "custom";
      let customEventType: string | undefined = "ride-progress";
      if (completing) {
        eventType = "completion";
        customEventType = undefined;
        if (ride !== undefined) {
          const completed = { ...ride, completedAtStep: step };
          state.rides = state.rides.map((entry) => (entry.rideId === ride.rideId ? completed : entry));
          state.completedRides.push(ride.rideId);
          state.busyUntil.set(ride.vehicleId, step + COMPLETION_COOLDOWN_STEPS);
          const weight = state.zoneWeights.get(ride.pickupZone) ?? 1;
          state.zoneWeights.set(ride.pickupZone, Math.round((weight + 0.3) * 100) / 100);
        }
        // The ride is over: the next step is a fresh dispatch request.
        liveExperience = undefined;
        liveVehicleId = null;
      } else if (interrupted) {
        eventType = "interruption-accept";
        customEventType = undefined;
      } else if (ride !== undefined && ride.matchedAtStep === step) {
        eventType = "start";
        customEventType = undefined;
      }
      state.outcomeTypes.push(eventType);
      const vehicle = FLEET.find((entry) => entry.vehicleId === (result.selectedExperience?.realizationId ?? ""));
      const waitMinutes = etaForVehicle(vehicle ?? FLEET[0]!, zone, step);
      return {
        eventId: `ev-l10-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        decisionId: result.decisionId,
        experienceId: result.selectedExperience?.experienceId,
        eventType,
        ...(customEventType !== undefined ? { customEventType } : {}),
        occurredAt: nowMs,
        evidenceClass: "fixture" as const,
        metrics: {
          waitMinutes,
          surgeMultiplier: state.surgeSteps.includes(step) ? SURGE_MULTIPLIER : 1,
          rideId: ride?.rideId ?? 0,
          fareUsd: 8 + 1.4 * (vehicle?.baseEtaMinutes ?? 5),
        },
        idempotencyKey: `idem-out-l10-${step}`,
      };
    },

    providePreferenceDelta(step: number, _result: DecisionResult, nowMs: number) {
      const zone = zoneForStep(step);
      const dimension = `zone.${zone}`;
      state.deltaDimensions.push(dimension);
      const weight = (state.zoneWeights.get(zone) ?? 1) + 0.15;
      state.zoneWeights.set(zone, Math.round(weight * 100) / 100);
      return {
        deltaId: `delta-l10-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        dimension,
        op: "add" as const,
        newValue: Math.round(weight * 100) / 100,
        resultingConfidence: Math.min(0.9, 0.5 + 0.05 * step),
        model: { modelId: "vectorhail-zone-affinity", version: "1" },
        timestamp: nowMs,
      };
    },
  };

  const finalize = (): void => {
    const inFlight = state.rides.find((ride) => ride.completedAtStep === null);
    state.inFlightAtEnd = inFlight?.vehicleId ?? null;
  };

  return {
    host,
    world: {
      get presentations() { return state.presentations; },
      get rideCounter() { return state.rideCounter; },
      get rides() { return state.rides.map((ride) => ({ ...ride })); },
      get zoneRotation() { return [...state.zoneRotation]; },
      get matchedLog() { return state.matchedLog.map((entry) => ({ ...entry })); },
      get poolLog() { return state.poolLog.map((pool) => [...pool]); },
      get surgeSteps() { return [...state.surgeSteps]; },
      get completedRides() { return [...state.completedRides]; },
      get inFlightAtEnd() { finalize(); return state.inFlightAtEnd; },
      get candidateSources() { return [...state.candidateSources]; },
      get etaLog() { return [...state.etaLog]; },
      get outcomeSteps() { return [...state.outcomeSteps]; },
      get outcomeTypes() { return [...state.outcomeTypes]; },
      get deltaDimensions() { return [...state.deltaDimensions]; },
      get zoneWeights() { return Object.fromEntries([...state.zoneWeights.entries()].sort()); },
    },
  };
}

/** Level metadata for wave reporting (mirrors the module's declarations). */
export const level10MobilityMeta = {
  level: 10,
  name: "Mobility / ride-hailing",
  hostAdapterId: "adapter-l10-mobility-1",
  requiredCapabilities: 13,
  expectedSatisfied: 12,
  expectedPartial: 1,
  expectedMissing: 0,
  expectedGaps: ["context-snapshots|API_GAP"] as readonly string[],
} as const;
