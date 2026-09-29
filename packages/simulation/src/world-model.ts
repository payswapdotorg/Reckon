/**
 * WorldModel PORT + deterministic implementation (W1-005).
 *
 * A world model is the versioned, reproducible research artifact that
 * anchors sequential simulation (W1-006): a frozen snapshot of
 * everything the simulator may condition on, at a declared
 * information cutoff.
 *
 * LAWS implemented here (docs/architecture/architecture-lock.md):
 * - NO-FUTURE-LEAKAGE: recent events with `occurredAt > cutoff` are
 *   DROPPED (and counted in `droppedFutureEventCount`, mirroring
 *   @reckon/features — leakage is observable, never silent). An anchor
 *   context snapshot dated after the cutoff is REJECTED (typed error):
 *   it would taint the entire state.
 * - DETERMINISM: same inputs ⇒ byte-identical canonical serialization
 *   and content digest (`stateDigest`, sha256 over canonicalJson).
 * - EVIDENCE-CLASS SEPARATION (contracts.md #9, lock #20, ADR-004):
 *   input history keeps its original evidence classes (immutable);
 *   the SIMULATED partition may only ever hold
 *   `evidenceClass: "simulated"` records — enforced by `advance`.
 * - TENANT + SUBJECT SCOPING: every input event must belong to the
 *   world's tenant AND subject (typed rejections, never silent mixing).
 *
 * STRUCTURAL TYPES: `PreferenceSnapshotShape` and `FeatureVectorShape`
 * are deliberately STRUCTURAL (field-compatible with the snapshots of
 * @reckon/preferences and the FeatureVector of @reckon/features). This
 * package declares no workspace dependency on them — the pnpm lockfile
 * is frozen for this wave, and the TL3-owned composition root wires
 * the stores together (same precedent as @reckon/features/port.ts).
 */
import {
  CatalogItemSchema,
  ContextSnapshotSchema,
  ExperienceSchema,
  OutcomeEventSchema,
  RealizationSchema,
  RewardSpecSchema,
  SubjectReferenceSchema,
  TenantScopeSchema,
  TimestampMsSchema,
  canonicalJson,
  contentDigest,
  type CatalogItem,
  type ContextSnapshot,
  type Experience,
  type OutcomeEvent,
  type Realization,
  type RewardSpec,
  type SubjectReference,
  type TenantScope,
  type TimestampMs,
} from "@reckon/contracts";
import { normalizeSeed, type SeedString } from "./rng.js";
import {
  SimulationCutoffViolationError,
  SimulationClockViolationError,
  SimulationConfigurationError,
  SimulationEvidenceClassViolationError,
  SimulationSeedInvalidError,
  SimulationSubjectMismatchError,
  SimulationTenantMismatchError,
  SimulationValidationError,
  toSimulationIssues,
} from "./errors.js";

/** Version of the world-model representation (recorded in every state). */
export const WORLD_MODEL_VERSION = "reckon.world-model/0.1.0";

/** Default configuration id/version of a world model. */
export const DEFAULT_CONFIGURATION_ID = "reckon.simulation.default";
export const DEFAULT_CONFIGURATION_VERSION = "1";

// ---------------------------------------------------------------------------
// Structural input shapes (field-compatible with sibling W1 packages)
// ---------------------------------------------------------------------------

/** Structural preference dimension (see @reckon/preferences views). */
export interface PreferenceDimensionShape {
  readonly dimension: string;
  readonly value: number | string | boolean | null;
  readonly confidence: number;
}

/** Structural preference snapshot (see @reckon/preferences snapshot). */
export interface PreferenceSnapshotShape {
  readonly stable: readonly PreferenceDimensionShape[];
  readonly situational: readonly (PreferenceDimensionShape & {
    readonly contextScope?: {
      readonly contextKind?: string;
      readonly contextId?: string;
    };
  })[];
  readonly at?: TimestampMs | null;
}

/**
 * Structural feature-vector shape (see @reckon/features FeatureVector):
 * `families[f][k]` is the value of feature `names[f][k]`, and `digest`
 * is the assembler's content digest over the vector. Extra fields
 * (subject/tenant/at) carried by the real FeatureVector are accepted
 * and ignored.
 */
export interface FeatureVectorShape {
  readonly families: Readonly<Record<string, readonly number[]>>;
  readonly names: Readonly<Record<string, readonly string[]>>;
  readonly digest: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Simulation configuration — recorded in the state so every stepped
 * artifact is reproducible. All fields are primitives (canonical-JSON
 * safe); `params` is numeric-only for the same reason.
 */
export interface SimulationConfiguration {
  readonly configurationId: string;
  readonly version: string;
  /** Virtual-time advance per simulator step (ms, > 0). */
  readonly stepDurationMs: number;
  /** Maximum steps before truncation (int > 0). */
  readonly maxSteps: number;
  /** Whether stochastic components draw from seeded noise. */
  readonly stochastic: boolean;
  /** Additional numeric configuration parameters (host-defined). */
  readonly params: Readonly<Record<string, number>>;
}

export const DEFAULT_SIMULATION_CONFIGURATION: SimulationConfiguration = Object.freeze({
  configurationId: DEFAULT_CONFIGURATION_ID,
  version: DEFAULT_CONFIGURATION_VERSION,
  stepDurationMs: 60_000,
  maxSteps: 100,
  stochastic: true,
  params: Object.freeze({}),
});

function validateConfiguration(config: SimulationConfiguration): SimulationConfiguration {
  if (typeof config.configurationId !== "string" || config.configurationId.length === 0) {
    throw new SimulationConfigurationError("configurationId must be a non-empty string");
  }
  if (typeof config.version !== "string" || config.version.length === 0) {
    throw new SimulationConfigurationError("configuration version must be a non-empty string");
  }
  if (!Number.isInteger(config.stepDurationMs) || config.stepDurationMs <= 0) {
    throw new SimulationConfigurationError(
      `stepDurationMs must be a positive integer, got ${config.stepDurationMs}`
    );
  }
  if (!Number.isInteger(config.maxSteps) || config.maxSteps <= 0) {
    throw new SimulationConfigurationError(`maxSteps must be a positive integer, got ${config.maxSteps}`);
  }
  if (typeof config.stochastic !== "boolean") {
    throw new SimulationConfigurationError("stochastic must be a boolean");
  }
  for (const [key, value] of Object.entries(config.params)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new SimulationConfigurationError(
        `configuration param "${key}" must be a finite number (canonical-JSON safety)`,
        { key, value }
      );
    }
  }
  return config;
}

// ---------------------------------------------------------------------------
// World model input / state
// ---------------------------------------------------------------------------

/** Input to `WorldModel.build`. */
export interface WorldModelInput {
  readonly tenant: TenantScope;
  readonly subject: SubjectReference;
  /**
   * Information cutoff — the simulation-time moment the world is
   * anchored at. Events with `occurredAt > informationCutoff` are
   * dropped (counted); the context snapshot must not postdate it.
   */
  readonly informationCutoff: TimestampMs;
  /** Base seed (uint64 decimal string or non-negative integer). */
  readonly seed: string | number;
  /** Partial override of the default simulation configuration. */
  readonly configuration?: Partial<SimulationConfiguration>;
  /** Host-declared, versioned reward spec (optional; never defaulted). */
  readonly reward?: RewardSpec;
  readonly contextSnapshot: ContextSnapshot;
  readonly items: readonly CatalogItem[];
  readonly realizations?: readonly Realization[];
  readonly experiences?: readonly Experience[];
  readonly preferences?: PreferenceSnapshotShape;
  /** Declared FeatureAssembler output (structural FeatureVectorShape). */
  readonly features: FeatureVectorShape;
  /** Recent outcome events (events after the cutoff are dropped). */
  readonly recentEvents?: readonly OutcomeEvent[];
}

/**
 * Versioned, immutable world-model state. `stateDigest` is the sha256
 * content digest over the canonical serialization of everything
 * except the digest itself and the non-semantic diagnostics counter
 * `droppedFutureEventCount` (see `worldModelDigestContent`).
 */
export interface WorldModelState {
  readonly worldModelVersion: string;
  readonly tenant: TenantScope;
  readonly subject: SubjectReference;
  readonly informationCutoff: TimestampMs;
  /** Base seed, uint64 decimal string. Per-step/ensemble seeds derive from it. */
  readonly seed: SeedString;
  readonly configuration: SimulationConfiguration;
  /** `${rewardId}@${version}` of the declared RewardSpec, or "unset". */
  readonly rewardVersion: string;
  readonly contextSnapshot: ContextSnapshot;
  readonly items: readonly CatalogItem[];
  readonly realizations: readonly Realization[];
  readonly experiences: readonly Experience[];
  readonly preferences: Readonly<PreferenceSnapshotShape>;
  readonly features: FeatureVectorShape;
  /**
   * Input evidence at/below the cutoff, original evidence classes
   * preserved (immutable input lineage — the simulator never rewrites
   * history).
   */
  readonly history: readonly OutcomeEvent[];
  /**
   * Simulator output partition — ALWAYS `evidenceClass: "simulated"`
   * (enforced by `advance`; typed rejection otherwise).
   */
  readonly simulatedEvents: readonly OutcomeEvent[];
  /** Input events dropped because they postdate the cutoff. */
  readonly droppedFutureEventCount: number;
  /** Monotonic virtual clock (starts at the information cutoff). */
  readonly simulationClock: TimestampMs;
  /** Number of applied steps (0 on a freshly built state). */
  readonly stepCount: number;
  readonly stateDigest: string;
}

/** One simulated step to fold into the state via `WorldModel.advance`. */
export interface WorldModelStep {
  /** Events to append to the simulated partition. */
  readonly events: readonly OutcomeEvent[];
  /** Virtual clock advance for this step (ms, integer >= 0). */
  readonly clockAdvanceMs: number;
}

// ---------------------------------------------------------------------------
// Structural validation helpers
// ---------------------------------------------------------------------------

function parseOrThrow<T>(
  label: string,
  schema: { safeParse: (input: unknown) => { success: boolean; data?: T; error?: unknown } },
  input: unknown
): T {
  const result = schema.safeParse(input);
  if (!result.success || result.data === undefined) {
    throw new SimulationValidationError(
      `${label} failed its frozen schema`,
      toSimulationIssues(result.error),
      input
    );
  }
  return result.data;
}

function validatePreferenceSnapshotShape(preferences: PreferenceSnapshotShape): void {
  const issues: { path: string; message: string; code: string }[] = [];
  if (preferences === null || typeof preferences !== "object") {
    throw new SimulationValidationError(
      "preferences must be an object",
      [{ path: "preferences", message: "must be an object", code: "invalid_type" }],
      preferences
    );
  }
  if (!Array.isArray(preferences.stable) || !Array.isArray(preferences.situational)) {
    throw new SimulationValidationError(
      "preference snapshot must carry stable[] and situational[] arrays",
      [
        { path: "stable", message: Array.isArray(preferences.stable) ? "ok" : "must be an array", code: "invalid_type" },
        { path: "situational", message: Array.isArray(preferences.situational) ? "ok" : "must be an array", code: "invalid_type" },
      ],
      preferences
    );
  }
  for (const [listName, list] of [
    ["stable", preferences.stable],
    ["situational", preferences.situational],
  ] as const) {
    for (let i = 0; i < list.length; i++) {
      const dim = list[i]!;
      if (dim === null || typeof dim !== "object") {
        issues.push({ path: `${listName}[${i}]`, message: "must be an object", code: "invalid_type" });
        continue;
      }
      if (typeof dim.dimension !== "string" || dim.dimension.length === 0) {
        issues.push({ path: `${listName}[${i}].dimension`, message: "must be a non-empty string", code: "invalid_type" });
      }
      const value = dim.value;
      if (
        typeof value !== "number" &&
        typeof value !== "string" &&
        typeof value !== "boolean" &&
        value !== null
      ) {
        issues.push({ path: `${listName}[${i}].value`, message: "must be number|string|boolean|null", code: "invalid_union" });
      }
      if (typeof dim.confidence !== "number" || !(dim.confidence >= 0 && dim.confidence <= 1)) {
        issues.push({ path: `${listName}[${i}].confidence`, message: "must be a number in [0, 1]", code: "too_big_or_small" });
      }
    }
  }
  if (issues.length > 0) {
    throw new SimulationValidationError(
      "preference snapshot dimension(s) invalid",
      issues,
      preferences
    );
  }
}

function validateFeatureVectorShape(features: FeatureVectorShape): void {
  const issues: { path: string; message: string; code: string }[] = [];
  if (features === null || typeof features !== "object") {
    throw new SimulationValidationError(
      "features must be an object",
      [{ path: "features", message: "must be an object", code: "invalid_type" }],
      features
    );
  }
  const familyKeys = Object.keys(features.families ?? {});
  const nameKeys = Object.keys(features.names ?? {});
  if (familyKeys.length === 0) {
    issues.push({ path: "features.families", message: "must contain at least one family", code: "invalid_type" });
  }
  const namesKeySet = new Set(nameKeys);
  for (const key of familyKeys) {
    const values = features.families[key];
    const names = features.names[key];
    if (!Array.isArray(values) || values.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
      issues.push({ path: `features.families.${key}`, message: "must be a finite-number array", code: "invalid_type" });
      continue;
    }
    if (!namesKeySet.has(key)) {
      issues.push({ path: `features.names.${key}`, message: "missing name list for family", code: "invalid_type" });
      continue;
    }
    if (!Array.isArray(names) || names.some((n) => typeof n !== "string")) {
      issues.push({ path: `features.names.${key}`, message: "must be a string array", code: "invalid_type" });
      continue;
    }
    if (values.length !== names.length) {
      issues.push({
        path: `features.${key}`,
        message: `values (${values.length}) and names (${names.length}) must be parallel`,
        code: "alignment",
      });
    }
  }
  if (typeof features.digest !== "string" || features.digest.length === 0) {
    issues.push({ path: "features.digest", message: "must be a non-empty string", code: "invalid_type" });
  }
  if (issues.length > 0) {
    throw new SimulationValidationError("declared feature vector is structurally invalid", issues, features);
  }
}

function tenantKey(tenant: TenantScope): string {
  return `${tenant.tenantId}|${tenant.workspaceId ?? ""}`;
}

function subjectKey(subject: SubjectReference): string {
  return `${subject.kind}:${subject.ref}`;
}

/** Recursively freeze a plain record tree (immutability guarantee). */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Digest content (everything except stateDigest itself)
// ---------------------------------------------------------------------------

/**
 * The canonical digestable content of a state (the state minus its own
 * `stateDigest`). Public so callers can verify the digest law:
 * `contentDigest(worldModelDigestContent(s)) === s.stateDigest`.
 *
 * `droppedFutureEventCount` is DELIBERATELY EXCLUDED: it is
 * observability metadata about REJECTED (future) inputs — including it
 * would make the digest a function of future information. The digest
 * is a pure function of admissible (at/below-cutoff) evidence, so a
 * world state is provably identical regardless of what the future
 * holds (no-future-leakage law).
 */
export function worldModelDigestContent(state: Omit<WorldModelState, "stateDigest" | "droppedFutureEventCount">): unknown {
  return {
    worldModelVersion: state.worldModelVersion,
    tenant: state.tenant,
    subject: state.subject,
    informationCutoff: state.informationCutoff,
    seed: state.seed,
    configuration: state.configuration,
    rewardVersion: state.rewardVersion,
    contextSnapshot: state.contextSnapshot,
    items: state.items,
    realizations: state.realizations,
    experiences: state.experiences,
    preferences: state.preferences,
    features: {
      families: state.features.families,
      names: state.features.names,
      digest: state.features.digest,
    },
    history: state.history,
    simulatedEvents: state.simulatedEvents,
    simulationClock: state.simulationClock,
    stepCount: state.stepCount,
  };
}

/** Canonical (deterministic) serialization of a state — byte-stable. */
export function serializeWorldModelState(state: WorldModelState): string {
  return canonicalJson(worldModelDigestContent(state));
}

/** Recompute the state digest from content. */
function digestOf(content: unknown): string {
  return contentDigest(content);
}

// ---------------------------------------------------------------------------
// Evidence partition views (mirroring the EventStore partition law)
// ---------------------------------------------------------------------------

const OBSERVED_CLASSES: readonly string[] = ["production-observed", "staging", "controlled-local"];
const RESEARCH_CLASSES: readonly string[] = ["simulated", "counterfactual", "fixture"];

/** History events with an OBSERVED evidence class (never simulated output). */
export function observedHistoryEvents(state: WorldModelState): readonly OutcomeEvent[] {
  return state.history.filter((event) => OBSERVED_CLASSES.includes(event.evidenceClass));
}

/**
 * History events with a RESEARCH evidence class (fixture or previously
 * simulated context), plus every event in the simulated partition —
 * research evidence is never presented as observed.
 */
export function researchHistoryEvents(state: WorldModelState): readonly OutcomeEvent[] {
  const researchHistory = state.history.filter((event) => RESEARCH_CLASSES.includes(event.evidenceClass));
  return [...researchHistory, ...state.simulatedEvents];
}

// ---------------------------------------------------------------------------
// WorldModel PORT + implementation
// ---------------------------------------------------------------------------

/**
 * WorldModel port: builds versioned world states from anchored inputs
 * and folds simulated steps into them. Pure and deterministic — no
 * clock, no store, no side effects.
 */
export interface WorldModel {
  /** Build the initial state at the information cutoff. */
  build(input: WorldModelInput): WorldModelState;

  /**
   * Fold one simulated step into the state. Enforces:
   * evidence class "simulated" only; tenant/subject match; virtual
   * clock monotonicity; returns a NEW immutable state (input state is
   * untouched).
   */
  advance(state: WorldModelState, step: WorldModelStep): WorldModelState;

  /** Return a copy of the state with a different base seed (digest recomputed). */
  reseed(state: WorldModelState, seed: string | number): WorldModelState;
}

/** Create the deterministic WorldModel implementation. */
export function createWorldModel(): WorldModel {
  return {
    build(input: WorldModelInput): WorldModelState {
      // 1. Anchor scopes (frozen schemas).
      const tenant = parseOrThrow("tenant", TenantScopeSchema, input.tenant);
      const subject = parseOrThrow("subject", SubjectReferenceSchema, input.subject);
      const informationCutoff = parseOrThrow(
        "informationCutoff",
        TimestampMsSchema,
        input.informationCutoff
      );

      // 2. Seed.
      let seed: SeedString;
      try {
        seed = normalizeSeed(input.seed);
      } catch (error) {
        throw new SimulationSeedInvalidError(String(input.seed), (error as Error).message);
      }

      // 3. Configuration (defaults + validated override).
      const configuration = validateConfiguration({
        ...DEFAULT_SIMULATION_CONFIGURATION,
        ...(input.configuration ?? {}),
        params: {
          ...DEFAULT_SIMULATION_CONFIGURATION.params,
          ...(input.configuration?.params ?? {}),
        },
      });

      // 4. Reward spec (optional; version recorded, never defaulted).
      let rewardVersion = "unset";
      if (input.reward !== undefined) {
        const reward = parseOrThrow("reward", RewardSpecSchema, input.reward);
        rewardVersion = `${reward.rewardId}@${reward.version}`;
      }

      // 5. Context snapshot — must not postdate the cutoff (anchor law).
      const contextSnapshot = parseOrThrow("contextSnapshot", ContextSnapshotSchema, input.contextSnapshot);
      if (contextSnapshot.at > informationCutoff) {
        throw new SimulationCutoffViolationError(
          informationCutoff,
          contextSnapshot.at,
          "context snapshot"
        );
      }

      // 6. Catalog / experience records (frozen schemas).
      const items = input.items.map((item, index) =>
        parseOrThrow(`items[${index}]`, CatalogItemSchema, item)
      );
      const realizations = (input.realizations ?? []).map((realization, index) =>
        parseOrThrow(`realizations[${index}]`, RealizationSchema, realization)
      );
      const experiences = (input.experiences ?? []).map((experience, index) =>
        parseOrThrow(`experiences[${index}]`, ExperienceSchema, experience)
      );

      // 7. Structural shapes (preferences + declared feature vector).
      //    Defensive copies BEFORE freezing: deepFreeze of the state must
      //    never reach into caller-owned objects.
      let preferences: PreferenceSnapshotShape = { stable: [], situational: [] };
      if (input.preferences !== undefined) {
        validatePreferenceSnapshotShape(input.preferences);
        preferences = structuredClone(input.preferences);
      }
      validateFeatureVectorShape(input.features);
      const features: FeatureVectorShape = {
        families: structuredClone(input.features.families) as Record<string, readonly number[]>,
        names: structuredClone(input.features.names) as Record<string, readonly string[]>,
        digest: input.features.digest,
      };

      // 8. Recent events: schema-validate, tenant/subject scope, cutoff.
      const parsedEvents = (input.recentEvents ?? []).map((event, index) =>
        parseOrThrow(`recentEvents[${index}]`, OutcomeEventSchema, event)
      );
      const expectedTenantKey = tenantKey(tenant);
      const expectedSubjectKey = subjectKey(subject);
      const history: OutcomeEvent[] = [];
      let droppedFutureEventCount = 0;
      for (const event of parsedEvents) {
        if (tenantKey(event.tenant) !== expectedTenantKey) {
          throw new SimulationTenantMismatchError(expectedTenantKey, tenantKey(event.tenant), event.eventId);
        }
        if (subjectKey(event.subject) !== expectedSubjectKey) {
          throw new SimulationSubjectMismatchError(
            expectedSubjectKey,
            subjectKey(event.subject),
            event.eventId
          );
        }
        if (event.occurredAt > informationCutoff) {
          droppedFutureEventCount += 1; // no-future-leakage: drop + count
          continue;
        }
        history.push(event);
      }

      const content = {
        worldModelVersion: WORLD_MODEL_VERSION,
        tenant,
        subject,
        informationCutoff,
        seed,
        configuration,
        rewardVersion,
        contextSnapshot,
        items,
        realizations,
        experiences,
        preferences,
        features: {
          families: features.families,
          names: features.names,
          digest: features.digest,
        },
        history,
        simulatedEvents: [] as OutcomeEvent[],
        droppedFutureEventCount,
        simulationClock: informationCutoff,
        stepCount: 0,
      };
      const stateDigest = digestOf(worldModelDigestContent(content));
      return deepFreeze({ ...content, stateDigest }) as WorldModelState;
    },

    advance(state: WorldModelState, step: WorldModelStep): WorldModelState {
      if (!Number.isInteger(step.clockAdvanceMs) || step.clockAdvanceMs < 0) {
        throw new SimulationConfigurationError(
          `clockAdvanceMs must be a non-negative integer, got ${step.clockAdvanceMs}`
        );
      }
      const expectedTenantKey = tenantKey(state.tenant);
      const expectedSubjectKey = subjectKey(state.subject);
      const appended: OutcomeEvent[] = [];
      for (const rawEvent of step.events) {
        const event = parseOrThrow("simulatedEvent", OutcomeEventSchema, rawEvent);
        if (tenantKey(event.tenant) !== expectedTenantKey) {
          throw new SimulationTenantMismatchError(expectedTenantKey, tenantKey(event.tenant), event.eventId);
        }
        if (subjectKey(event.subject) !== expectedSubjectKey) {
          throw new SimulationSubjectMismatchError(
            expectedSubjectKey,
            subjectKey(event.subject),
            event.eventId
          );
        }
        // Evidence-class law: the simulated partition is research-class
        // "simulated" BY CONSTRUCTION — anything else is rejected.
        if (event.evidenceClass !== "simulated") {
          throw new SimulationEvidenceClassViolationError(event.eventId, event.evidenceClass);
        }
        // Monotonic virtual clock: stamped at/after the current clock.
        if (event.occurredAt < state.simulationClock) {
          throw new SimulationClockViolationError(event.eventId, event.occurredAt, state.simulationClock);
        }
        appended.push(event);
      }

      const content = {
        ...state,
        history: state.history,
        simulatedEvents: [...state.simulatedEvents, ...appended],
        simulationClock: state.simulationClock + step.clockAdvanceMs,
        stepCount: state.stepCount + 1,
      };
      const { stateDigest: _ignored, ...rest } = content as WorldModelState;
      void _ignored;
      const nextDigest = digestOf(worldModelDigestContent(rest));
      return deepFreeze({ ...rest, stateDigest: nextDigest }) as WorldModelState;
    },

    reseed(state: WorldModelState, seed: string | number): WorldModelState {
      let normalized: SeedString;
      try {
        normalized = normalizeSeed(seed);
      } catch (error) {
        throw new SimulationSeedInvalidError(String(seed), (error as Error).message);
      }
      const { stateDigest: _ignored, ...rest } = state;
      void _ignored;
      const nextContent = { ...rest, seed: normalized };
      const nextDigest = digestOf(worldModelDigestContent(nextContent));
      return deepFreeze({ ...nextContent, stateDigest: nextDigest }) as WorldModelState;
    },
  };
}
