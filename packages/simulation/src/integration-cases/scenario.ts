/**
 * SIM-003 — the integration-case scenario machinery (W2 lane).
 *
 * A ladder "integration case" is a deterministic, scripted SYNTHETIC HOST
 * (one `ScenarioScript`) whose steps exercise the decision / experience /
 * scheduler surfaces of the SIM-001 common harness:
 *
 *   per step: submit candidates → decision request (objective, attention
 *   policy, constraints, reward, currentExperience, planId) → the scripted
 *   responder's schedule policy answers QUEUE / CONTINUE / SWITCH /
 *   INTERRUPT / RESUME / SUGGEST (+ resume checkpoints, plan coupling) →
 *   the host PRESENTS (or honestly declines host-side, e.g. on a failed
 *   rights/consent/pacing gate) → outcome event → preference delta.
 *
 * The factory turns a script into a `SimulationHostAdapter` plus an
 * `observations` log used by the acceptance tests to assert the scenario
 * semantics (schedule actions, checkpoints, queue evolution, outcomes).
 *
 * LAWS (same as the harness):
 * - No Date.now / Math.random / wall-clock reads — time is the injected
 *   virtual clock passed to the host callbacks; every id is content- or
 *   counter-derived.
 * - The host imports ONLY public surface types (@reckon/contracts through
 *   the harness port) — zero internal kernel packages.
 * - Deterministic: the same script + same seed ⇒ byte-identical records
 *   (the scenario state — host-side queue + checkpoints — is a pure
 *   function of the scripted decisions, which are pure functions of the
 *   scripted requests).
 * - Evidence honesty: every outcome/delta this fixture host emits is
 *   `fixture` class — it is scripted-world data, never observed evidence.
 */
import type {
  AttentionPolicy,
  DecisionResult,
  HardConstraint,
  Objective,
  OutcomeEventType,
  ScheduleAction,
  TenantScope,
  SubjectReference,
} from "@reckon/contracts";
import type { HostGlueMeasurement } from "@reckon/contracts";
import type {
  CandidateSetInput,
  ExperienceInput,
  OutcomeEventInput,
  PreferenceDeltaInput,
  RewardSpecInput,
} from "../harness/port.js";
import type {
  HostCatalogSource,
  HostDecisionInputs,
  HostDecisionReaction,
  SimulationHostAdapter,
  SimulationManifestContentInput,
} from "../harness/host-adapter.js";

// ---------------------------------------------------------------------------
// Scenario script types (the deterministic fixture a level provides)
// ---------------------------------------------------------------------------

/**
 * How a step references its CURRENT experience (the currently-playing /
 * being-configured experience the deciding side may CONTINUE, SWITCH away
 * from, INTERRUPT or RESUME):
 * - `literal` — a fixed experience written in the script;
 * - `selected-from-step` — the experience the decision of an EARLIER step
 *   selected (switch/resume targets are content-derived ids, so the script
 *   references them by step instead of hardcoding digests).
 */
export type ScenarioExperienceRef =
  | { readonly kind: "literal"; readonly experience: ExperienceInput }
  | { readonly kind: "selected-from-step"; readonly step: number };

/** The outcome event a presented step reports (metrics are numeric-only — the frozen contract). */
export interface ScenarioOutcomeSpec {
  readonly eventType: OutcomeEventType;
  readonly customEventType?: string;
  readonly metrics: Readonly<Record<string, number>>;
  /** Append-oriented correction: the earlier outcome event this corrects. */
  readonly correctsEventId?: string;
}

/** The optional per-step preference delta (omitted ⇒ no delta call). */
export interface ScenarioPreferenceDeltaSpec {
  readonly dimension: string;
  readonly op: "set" | "add" | "multiply" | "decay" | "remove" | "merge";
  readonly newValue?: number | string | boolean | null;
  readonly confidenceDelta?: number;
  readonly resultingConfidence?: number;
  readonly modelId: string;
  readonly modelVersion: string;
}

/** One scripted decision-loop step. */
export interface ScenarioStep {
  readonly contextId: string;
  readonly tenant: TenantScope;
  readonly subject: SubjectReference;
  readonly objective: Objective;
  readonly attentionPolicy: AttentionPolicy;
  readonly candidates: CandidateSetInput;
  readonly constraints?: readonly HardConstraint[];
  readonly policySelector: { readonly policyId: string; readonly version?: string };
  /** The currently-active experience (drives the schedule policy). */
  readonly currentExperience?: ScenarioExperienceRef;
  /** Rolling-plan coupling — echoed into `scheduleDelta.planId`. */
  readonly planId?: string;
  /** The host's declared, versioned reward (competing objectives). */
  readonly reward?: RewardSpecInput;
  /** Does the host present the decision's experience? (host-owned authority — a rights/consent/pacing gate may decline) */
  readonly present: boolean;
  readonly outcome: ScenarioOutcomeSpec;
  readonly preferenceDelta?: ScenarioPreferenceDeltaSpec;
}

/** A complete deterministic integration-case script (one scenario host). */
export interface ScenarioScript {
  /** Replay identity (stable across runs of the same adapter). */
  readonly hostAdapterId: string;
  readonly hostSystem: { readonly hostId: string; readonly name: string; readonly version: string };
  /** Honest host-declared glue measurement for THIS scenario's integration. */
  readonly glue: HostGlueMeasurement;
  readonly manifestContent: SimulationManifestContentInput;
  readonly catalog: HostCatalogSource;
  readonly steps: readonly ScenarioStep[];
}

// ---------------------------------------------------------------------------
// Observations (deterministic per run — used by acceptance tests)
// ---------------------------------------------------------------------------

/** One observed step of the scenario run (host-side view). */
export interface ScenarioStepObservation {
  readonly step: number;
  /** The schedule action the decision returned. */
  readonly action: ScheduleAction;
  readonly selectedExperienceId: string | undefined;
  /** The format kind of the selected experience (placement assertions). */
  readonly selectedFormatKind: string | undefined;
  readonly enqueue: readonly string[];
  readonly dequeue: readonly string[];
  readonly resumeCheckpoint: { readonly experienceId: string; readonly resumeToken: string } | undefined;
  readonly planId: string | undefined;
  /** Did the host present? */
  readonly presented: boolean;
  /** Outcome event emitted for this step (absent when not presented). */
  readonly outcome: { readonly eventId: string; readonly eventType: OutcomeEventType } | undefined;
  /** Preference delta emitted for this step (absent when none/not presented). */
  readonly preferenceDeltaId: string | undefined;
  /** The host-side rolling queue AFTER executing the schedule delta. */
  readonly queueAfter: readonly string[];
  /** All checkpoints the host holds after this step (experienceId → token). */
  readonly checkpointsAfter: Readonly<Record<string, string>>;
}

/** The observation log of ONE scenario host instance (per run). */
export interface ScenarioObservations {
  readonly steps: readonly ScenarioStepObservation[];
}

/** A fresh scenario host instance: the adapter + its observation log. */
export interface ScenarioHostInstance {
  readonly host: SimulationHostAdapter;
  readonly observations: ScenarioObservations;
}

// ---------------------------------------------------------------------------
// Host-side schedule execution (the glue the ladder measures)
// ---------------------------------------------------------------------------

interface HostScheduleState {
  queue: string[];
  checkpoints: Map<string, string>;
}

/**
 * Execute a schedule delta host-side (the schedule-execution capability the
 * ladder measures). Enqueue is idempotent per experience id (a queued id is
 * never duplicated); dequeue removes the first occurrence; a resume
 * checkpoint is retained for later resume steps.
 */
function executeScheduleDelta(
  state: HostScheduleState,
  result: DecisionResult,
): { queue: readonly string[]; checkpoints: Readonly<Record<string, string>> } {
  const delta = result.scheduleDelta;
  if (delta !== undefined) {
    for (const experienceId of delta.enqueue) {
      if (!state.queue.includes(experienceId)) state.queue.push(experienceId);
    }
    for (const experienceId of delta.dequeue) {
      const index = state.queue.indexOf(experienceId);
      if (index >= 0) state.queue.splice(index, 1);
    }
    if (delta.resumeCheckpoint !== undefined) {
      state.checkpoints.set(delta.resumeCheckpoint.experienceId, delta.resumeCheckpoint.resumeToken);
    }
  }
  return { queue: [...state.queue], checkpoints: snapshotCheckpoints(state) };
}

/** Snapshot the checkpoint map as a plain record (deterministic insertion order). */
function snapshotCheckpoints(state: HostScheduleState): Readonly<Record<string, string>> {
  const checkpoints: Record<string, string> = {};
  for (const [experienceId, token] of state.checkpoints) {
    checkpoints[experienceId] = token;
  }
  return checkpoints;
}

// ---------------------------------------------------------------------------
// The scenario host factory
// ---------------------------------------------------------------------------

/**
 * Build a fresh scenario host from a script. Each call returns an
 * INDEPENDENT instance (adapter + empty observation log) — run it once per
 * `runSimulation` call; identical scripts + seeds produce byte-identical
 * records (the replay law), and the observations are deterministic per run.
 */
export function createScenarioHost(script: ScenarioScript): ScenarioHostInstance {
  const decisions = new Map<number, DecisionResult>();
  const observations: ScenarioStepObservation[] = [];
  const scheduleState: HostScheduleState = { queue: [], checkpoints: new Map() };

  const requireStep = (step: number): ScenarioStep => {
    const scripted = script.steps[step - 1];
    if (scripted === undefined) {
      throw new Error(
        `scenario host ${script.hostAdapterId}: no scripted step ${step} (script has ${script.steps.length} steps)`,
      );
    }
    return scripted;
  };

  const resolveCurrentExperience = (
    step: number,
    ref: ScenarioExperienceRef,
  ): ExperienceInput => {
    if (ref.kind === "literal") return ref.experience;
    const earlier = decisions.get(ref.step);
    if (earlier === undefined || earlier.selectedExperience === undefined) {
      throw new Error(
        `scenario host ${script.hostAdapterId}: step ${step} references selected-from-step ${ref.step}, which has no selected experience (must reference a PAST step)`,
      );
    }
    return earlier.selectedExperience;
  };

  const host: SimulationHostAdapter = {
    hostAdapterId: script.hostAdapterId,
    hostSystem: script.hostSystem,
    glue: script.glue,
    manifestContent: script.manifestContent,
    catalog: script.catalog,

    provideDecisionInputs(step: number): HostDecisionInputs {
      const scripted = requireStep(step);
      const inputs: HostDecisionInputs = {
        contextId: scripted.contextId,
        tenant: scripted.tenant,
        subject: scripted.subject,
        objective: scripted.objective,
        attentionPolicy: scripted.attentionPolicy,
        candidates: scripted.candidates,
        ...(scripted.constraints !== undefined ? { constraints: [...scripted.constraints] } : {}),
        policySelector: scripted.policySelector,
        ...(scripted.currentExperience !== undefined
          ? { currentExperience: resolveCurrentExperience(step, scripted.currentExperience) }
          : {}),
        ...(scripted.planId !== undefined ? { planId: scripted.planId } : {}),
        ...(scripted.reward !== undefined ? { reward: scripted.reward } : {}),
      };
      return inputs;
    },

    consumeDecision(step: number, result: DecisionResult): HostDecisionReaction {
      decisions.set(step, result);
      const scripted = requireStep(step);
      // Presentation authority is host-owned: an un-presented decision's
      // schedule delta is NOT executed host-side (the interruption/switch/
      // queue change simply does not happen — honestly observed as an
      // unchanged queue in this step's observation).
      const { queue, checkpoints } = scripted.present
        ? executeScheduleDelta(scheduleState, result)
        : { queue: [...scheduleState.queue], checkpoints: snapshotCheckpoints(scheduleState) };
      const delta = result.scheduleDelta;
      observations.push({
        step,
        action: result.action,
        selectedExperienceId: result.selectedExperience?.experienceId,
        selectedFormatKind: result.selectedExperience?.format.kind,
        enqueue: delta?.enqueue ?? [],
        dequeue: delta?.dequeue ?? [],
        resumeCheckpoint: delta?.resumeCheckpoint,
        planId: delta?.planId,
        presented: scripted.present,
        outcome: undefined,
        preferenceDeltaId: undefined,
        queueAfter: queue,
        checkpointsAfter: checkpoints,
      });
      return { presented: scripted.present };
    },

    provideOutcome(
      step: number,
      result: DecisionResult,
      _reaction: HostDecisionReaction,
      nowMs: number,
    ): OutcomeEventInput {
      const scripted = requireStep(step);
      const observation = observations[step - 1];
      if (observation !== undefined) {
        observations[step - 1] = {
          ...observation,
          outcome: {
            eventId: `ev-${script.hostAdapterId}-${step}`,
            eventType: scripted.outcome.eventType,
          },
        };
      }
      const outcome: OutcomeEventInput = {
        eventId: `ev-${script.hostAdapterId}-${step}`,
        tenant: scripted.tenant,
        subject: scripted.subject,
        decisionId: result.decisionId,
        experienceId: result.selectedExperience?.experienceId,
        eventType: scripted.outcome.eventType,
        ...(scripted.outcome.customEventType !== undefined
          ? { customEventType: scripted.outcome.customEventType }
          : {}),
        occurredAt: nowMs,
        evidenceClass: "fixture",
        metrics: { ...scripted.outcome.metrics },
        ...(scripted.outcome.correctsEventId !== undefined
          ? { correctsEventId: scripted.outcome.correctsEventId }
          : {}),
        idempotencyKey: `idem-out-${script.hostAdapterId}-${step}`,
      };
      return outcome;
    },

    providePreferenceDelta(
      step: number,
      _result: DecisionResult,
      nowMs: number,
    ): PreferenceDeltaInput | undefined {
      const scripted = requireStep(step);
      if (scripted.preferenceDelta === undefined) return undefined;
      const observation = observations[step - 1];
      const deltaId = `delta-${script.hostAdapterId}-${step}`;
      if (observation !== undefined) {
        observations[step - 1] = { ...observation, preferenceDeltaId: deltaId };
      }
      const delta: PreferenceDeltaInput = {
        deltaId,
        tenant: scripted.tenant,
        subject: scripted.subject,
        dimension: scripted.preferenceDelta.dimension,
        op: scripted.preferenceDelta.op,
        ...(scripted.preferenceDelta.newValue !== undefined
          ? { newValue: scripted.preferenceDelta.newValue }
          : {}),
        ...(scripted.preferenceDelta.confidenceDelta !== undefined
          ? { confidenceDelta: scripted.preferenceDelta.confidenceDelta }
          : {}),
        ...(scripted.preferenceDelta.resultingConfidence !== undefined
          ? { resultingConfidence: scripted.preferenceDelta.resultingConfidence }
          : {}),
        model: {
          modelId: scripted.preferenceDelta.modelId,
          version: scripted.preferenceDelta.modelVersion,
        },
        timestamp: nowMs,
      };
      return delta;
    },
  };

  return { host, observations: { steps: observations } };
}
