/**
 * SIM-004 — the API-only measurement driver (W3 lane, Wave B mandate).
 *
 * "Wave B: … W3 validates the public API/SDK across representative
 * levels." This driver measures what the ladder mandates WITHOUT the
 * SimulationHostAdapter abstraction: a synthetic host is a flat script
 * of PUBLIC operations. Every call crosses the REAL `@reckon/sdk`
 * client (`createReckonClient` → `createSdkPort` — the seam
 * `harness/sdk-port.ts` documents), which validates every request
 * against the frozen zod contracts before sending and every response
 * after receiving — a contract-parity round-trip on both directions of
 * every operation. Zero internal Reckon packages are imported
 * (mechanically enforced by tests/conformance/zero-internal-access.test
 * .ts, which scans this module).
 *
 * What the driver measures (per the ladder's measurement section):
 * - request/response behavior: contract round-trips on every successful
 *   call; client-side request-validation failures (SDK_REQUEST_INVALID)
 *   are TERMINAL (never retried) and honestly recorded;
 * - failure/retry classification: seeded transport faults through the
 *   recording port (transient → bounded classified retries, the frozen
 *   RETRYABLE_SDK_ERROR_CODES set) vs terminal request errors;
 * - capability coverage: the manifest × profile conformance verdict,
 *   evaluated with the frozen `evaluateReckonCompleteConformance`;
 * - timing (virtual clock), p50/p95 latency (nearest-rank over
 *   successful calls), API operations + SDK methods (from the call log),
 *   glue (host-declared, mechanically recounted in the fixtures),
 *   evidence class `fixture` (scripted responder — never observed).
 *
 * Determinism laws (same as the SIM-001 harness): the run is a pure
 * function of (seed, scenario, fault config, clock config). No
 * Date.now / Math.random / wall-clock — time is the injected SimClock,
 * randomness is the seeded SplitMix64 RNG, ids are counter- or
 * content-derived (the SDK idGenerator is
 * `createDeterministicIdGenerator`). Same seed + same scenario ⇒
 * byte-identical IntegrationEffortRecord (asserted by the acceptance
 * suite, including the replay gate below).
 *
 * EVIDENCE HONESTY: every run goes through the scripted fixture
 * responder ⇒ evidenceClass "fixture". The driver proves the HOST side
 * and CONTRACT parity, not a live deployment.
 */
import { createReckonClient, type FetchLike, type ReckonClient } from "@reckon/sdk";
import {
  type DecisionResult,
  type EvidenceClass,
  type IntegrationEffortRecord,
  type IntegrationEffortScorecard,
  type ReckonCompleteCapabilityManifest,
  type ReckonCompleteConformanceVerdict,
  type ReckonCompleteProfileDeclaration,
  type ReckonCompleteProfileDeclarationInput,
  type SimulationReplayInputs,
  contentDigest,
  evaluateReckonCompleteConformance,
  finalizeIntegrationEffortRecord,
  finalizeReckonCompleteCapabilityManifest,
  finalizeReckonCompleteConformanceVerdict,
  finalizeReckonCompleteProfile,
  reckonCompleteManifestChecksum,
} from "@reckon/contracts";
import { createRng, normalizeSeed } from "../rng.js";
import { createSimClock, type SimClock } from "../harness/clock.js";
import {
  createRecordingPort,
  PortCallExhaustedError,
  PortCallFailedError,
  RETRYABLE_SDK_ERROR_CODES,
  type PortCallRecord,
  type RecordingPort,
} from "../harness/recording.js";
import { createSdkPort, createDeterministicIdGenerator } from "../harness/sdk-port.js";
import { createScriptedResponder } from "../harness/responder.js";
import { percentileNearestRank } from "../harness/percentile.js";
import type {
  CatalogItemInput,
  CandidateSetInput,
  DecisionRequestInput,
  OutcomeEventInput,
  PreferenceDeltaInput,
  RealizationInput,
  ReckonPublicPort,
} from "../harness/port.js";
import type { HostGlueMeasurement } from "@reckon/contracts";
import type { SimulationManifestContentInput } from "../harness/host-adapter.js";
import { aggregateIntegrationEffortScorecard } from "../harness/scorecard.js";

/** Version of the API-only driver (recorded in effort records). */
export const API_ONLY_HARNESS_VERSION = "sim-004-api-only-0.1.0";

/** Typed error for a replay-input/manifest mismatch (replay gate). */
export class ApiOnlyReplayMismatchError extends Error {
  constructor(detail: string) {
    super(`ApiOnlyReplayMismatchError: ${detail}`);
    this.name = "ApiOnlyReplayMismatchError";
  }
}

// ---------------------------------------------------------------------------
// The scenario: a flat script of PUBLIC operations (no host callbacks)
// ---------------------------------------------------------------------------

/**
 * One decision-loop step, expressed purely as the request bodies that
 * cross the public surface. The `at` timestamp is injected from the
 * virtual clock by the driver (determinism law — hosts never read wall
 * time inside the harness). The outcome/delta builders receive the
 * decision result (for decisionId/experienceId linkage) and the virtual
 * clock; returning `undefined` (or omitting the builder) is the honest
 * host-side DECLINE: no outcome call, no delta call.
 */
export interface ApiOnlyStep {
  /** POST /v1/candidates body. */
  readonly candidates: CandidateSetInput;
  /** The POST /v1/decisions body fields (requestId + idempotencyKey included — host-generated). */
  readonly request: Omit<DecisionRequestInput, "at">;
  /** POST /v1/outcomes builder (omitted/undefined ⇒ the host declines). */
  readonly outcome?: (decision: DecisionResult, nowMs: number) => OutcomeEventInput | undefined;
  /** POST /v1/preferences/events builder (omitted/undefined ⇒ no delta call). */
  readonly preferenceDelta?: (decision: DecisionResult, nowMs: number) => PreferenceDeltaInput | undefined;
}

/** A complete API-only scenario: one synthetic host as a public-operation script. */
export interface ApiOnlyScenario {
  readonly level: number;
  readonly scenarioId: string;
  readonly description: string;
  readonly hostSystem: {
    readonly hostId: string;
    readonly name: string;
    readonly hostAdapterId: string;
    readonly version: string;
  };
  /** Honest host-declared glue (mechanically recounted in the fixtures). */
  readonly glue: HostGlueMeasurement;
  readonly manifestContent: SimulationManifestContentInput;
  readonly profile: ReckonCompleteProfileDeclarationInput;
  /** The connect phase: catalog items + realizations (public upserts). */
  readonly connect: {
    readonly items: readonly CatalogItemInput[];
    readonly realizations: readonly RealizationInput[];
  };
  readonly steps: readonly ApiOnlyStep[];
}

/** One observed API-only step (deterministic per run). */
export interface ApiOnlyStepObservation {
  readonly step: number;
  readonly candidatesOk: boolean;
  readonly decisionOk: boolean;
  /** The terminal classification of a failed call (SDK error code), if any. */
  readonly terminalError: string | undefined;
  readonly decisionId: string | undefined;
  readonly action: string | undefined;
  readonly outcomeEventId: string | undefined;
  readonly preferenceDeltaId: string | undefined;
}

/** The run-level API-only measurement result. */
export interface ApiOnlyRunResult {
  readonly record: IntegrationEffortRecord;
  readonly verdict: ReckonCompleteConformanceVerdict;
  readonly manifest: ReckonCompleteCapabilityManifest;
  readonly profile: ReckonCompleteProfileDeclaration;
  readonly replayInputs: SimulationReplayInputs;
  readonly calls: readonly PortCallRecord[];
  readonly steps: readonly ApiOnlyStepObservation[];
  readonly reckonComplete: boolean;
  /** Request/response behavior: successful contract round-trips. */
  readonly contractRoundTrips: number;
  /** Terminal request-validation failures (SDK_REQUEST_INVALID class). */
  readonly clientValidationFailures: number;
}

/** The driver configuration (seed, faults, clock, optional port override). */
export interface ApiOnlyRunConfig {
  readonly seed: string | number;
  /** Virtual clock configuration (defaults: startMs 0, stepMs 1000). */
  readonly clock?: { readonly startMs?: number; readonly stepMs?: number };
  /** Probability [0,1] of an injected transport fault per attempt (default 0). */
  readonly faultRate?: number;
  /** Maximum retries after the first attempt (default 2). */
  readonly maxRetries?: number;
  /**
   * The Reckon public-surface port. Default: a REAL SDK client over the
   * scripted fixture responder (evidence class `fixture`). Supply a
   * controlled-local/staging port for higher evidence classes.
   */
  readonly port?: ReckonPublicPort;
  /** Honest evidence class of the RUN itself (default "fixture"). */
  readonly runEvidenceClass?: EvidenceClass;
}

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

/** Deterministic id fragment from digest parts. */
function runIdFragment(parts: readonly unknown[]): string {
  return contentDigest(parts).slice(0, 16);
}

/** Compose the default fixture port: REAL SDK client over the scripted responder. */
export function createApiOnlyFixturePort(options?: {
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly idempotencyPrefix?: string;
}): { readonly port: ReckonPublicPort; readonly client: ReckonClient; readonly fetch: FetchLike } {
  const responder = createScriptedResponder();
  const client = createReckonClient({
    baseUrl: options?.baseUrl ?? "https://reckon.fixture.test",
    apiKey: options?.apiKey ?? "rk_test_simulation_fixture",
    fetchImpl: responder.fetch,
    idGenerator: createDeterministicIdGenerator(options?.idempotencyPrefix ?? "idem"),
  });
  return { port: createSdkPort(client), client, fetch: responder.fetch };
}

/**
 * Run one API-only scenario. Every operation the host issues goes
 * through the recording port (which wraps the REAL SDK client): the
 * six standard-loop public operations only, in the ladder's order —
 * connect (catalog upserts) → per step: candidates → decision →
 * outcome (unless declined) → preference delta (unless none).
 *
 * TERMINAL request failures (client-side contract validation) are
 * MEASURED, never fatal: the step is marked failed with its SDK error
 * code and the run continues (failure/retry classification — a bad
 * request is deterministic and must not be retried).
 */
export async function runApiOnlyScenario(
  config: ApiOnlyRunConfig,
  scenario: ApiOnlyScenario,
): Promise<ApiOnlyRunResult> {
  const faultRate = config.faultRate ?? 0;
  const maxRetries = config.maxRetries ?? 2;
  const runEvidenceClass = config.runEvidenceClass ?? "fixture";
  const seedText = /^[0-9]+$/.test(String(config.seed))
    ? (BigInt(config.seed) & 0xffff_ffff_ffff_ffffn).toString()
    : String(config.seed);
  const seed = normalizeSeed(seedText);
  const clock: SimClock = createSimClock(config.clock ?? {});
  const rng = createRng(seed);
  const port: RecordingPort = createRecordingPort({
    inner: config.port ?? createApiOnlyFixturePort().port,
    clock,
    rng,
    faultRate,
    maxRetries,
  });

  const profile = finalizeReckonCompleteProfile(scenario.profile);

  // --- 1. register the capability manifest ---------------------------------
  const manifestContent = {
    ...scenario.manifestContent,
    hostSystem: {
      hostId: scenario.hostSystem.hostId,
      name: scenario.hostSystem.name,
      hostAdapterId: scenario.hostSystem.hostAdapterId,
      version: scenario.hostSystem.version,
    },
    declaredAt: clock.now(),
  };
  const manifestChecksum = reckonCompleteManifestChecksum(manifestContent);
  const manifestId = `man-${manifestChecksum.slice(0, 16)}`;
  const manifest = finalizeReckonCompleteCapabilityManifest(manifestContent, manifestId);

  // --- 2. connect sources (host-owned catalog authority) --------------------
  const catchTerminal = async (call: () => Promise<unknown>): Promise<boolean> => {
    try {
      await call();
      return true;
    } catch (error) {
      if (error instanceof PortCallExhaustedError || error instanceof PortCallFailedError) {
        return false;
      }
      throw error;
    }
  };
  for (const item of scenario.connect.items) {
    await catchTerminal(() => port.catalog.upsertItem(item));
  }
  for (const realization of scenario.connect.realizations) {
    await catchTerminal(() => port.catalog.upsertRealization(realization));
  }

  // --- 3. the decision loop (public operations only) ------------------------
  let firstDecisionSteps = 0;
  let firstDecisionMs = 0;
  let fullLoopSteps = 0;
  let fullLoopMs = 0;
  const observations: ApiOnlyStepObservation[] = [];

  for (let step = 1; step <= scenario.steps.length; step += 1) {
    const scripted = scenario.steps[step - 1]!;

    let candidatesOk = true;
    let terminalError: string | undefined;
    try {
      await port.candidates.submit(scripted.candidates);
    } catch (error) {
      if (error instanceof PortCallExhaustedError || error instanceof PortCallFailedError) {
        candidatesOk = false;
        terminalError = error.record.errorCode;
      } else {
        throw error;
      }
    }

    let decisionOk = false;
    let decision: DecisionResult | undefined;
    {
      const request: DecisionRequestInput = { ...scripted.request, at: clock.now() };
      try {
        decision = await port.decisions.request(request);
        decisionOk = true;
        if (firstDecisionSteps === 0) {
          firstDecisionSteps = step;
          firstDecisionMs = clock.now() - clock.startMs;
        }
      } catch (error) {
        if (error instanceof PortCallExhaustedError || error instanceof PortCallFailedError) {
          if (terminalError === undefined) terminalError = error.record.errorCode;
        } else {
          throw error;
        }
      }
    }

    let outcomeOk = true;
    let deltaOk = true;
    let outcomeEventId: string | undefined;
    let preferenceDeltaId: string | undefined;
    if (decisionOk && decision !== undefined) {
      // Host-owned presentation authority: the builder returning
      // undefined (or absent) is the honest DECLINE — no outcome call.
      const outcomeBody =
        scripted.outcome !== undefined ? scripted.outcome(decision, clock.now()) : undefined;
      if (outcomeBody !== undefined) {
        try {
          await port.outcomes.append(outcomeBody);
          outcomeEventId = outcomeBody.eventId;
        } catch (error) {
          if (error instanceof PortCallExhaustedError || error instanceof PortCallFailedError) {
            outcomeOk = false;
            if (terminalError === undefined) terminalError = error.record.errorCode;
          } else {
            throw error;
          }
        }
      }
      const deltaBody =
        scripted.preferenceDelta !== undefined
          ? scripted.preferenceDelta(decision, clock.now())
          : undefined;
      if (deltaBody !== undefined) {
        try {
          await port.preferences.appendDelta(deltaBody);
          preferenceDeltaId = deltaBody.deltaId;
        } catch (error) {
          if (error instanceof PortCallExhaustedError || error instanceof PortCallFailedError) {
            deltaOk = false;
            if (terminalError === undefined) terminalError = error.record.errorCode;
          } else {
            throw error;
          }
        }
      }
    }

    if (candidatesOk && decisionOk && outcomeOk && deltaOk && fullLoopSteps === 0) {
      fullLoopSteps = step;
      fullLoopMs = clock.now() - clock.startMs;
    }
    observations.push({
      step,
      candidatesOk,
      decisionOk,
      terminalError,
      decisionId: decision?.decisionId,
      action: decision?.action,
      outcomeEventId,
      preferenceDeltaId,
    });

    // Host "think time" between steps (virtual).
    clock.advance(clock.stepMs);
  }

  // --- 4. conformance verdict + effort record --------------------------------
  const assessment = evaluateReckonCompleteConformance(profile, manifest);
  const verdictId = `verd-${runIdFragment([manifestId, "verdict"])}`;
  const verdict = finalizeReckonCompleteConformanceVerdict({
    verdictId,
    measuredAt: clock.now(),
    profile,
    manifest,
  });

  const successfulLatencies = port.calls
    .filter((call) => call.status === "ok")
    .map((call) => call.latencyMs);
  const latencyP50 = percentileNearestRank(successfulLatencies, 50);
  const latencyP95 = percentileNearestRank(successfulLatencies, 95);

  let callsWithFailure = 0;
  let callsRetriedOk = 0;
  let callsExhausted = 0;
  let retryAttemptCount = 0;
  for (const call of port.calls) {
    const failedAttempts = call.status === "ok" ? call.attempts - 1 : call.attempts;
    if (failedAttempts > 0) callsWithFailure += 1;
    if (call.status === "ok" && call.attempts > 1) callsRetriedOk += 1;
    if (call.status === "error") callsExhausted += 1;
    retryAttemptCount += Math.max(0, call.attempts - 1);
  }

  const apiOperations = [...new Set(port.calls.map((call) => call.operation))].sort();
  const sdkMethods = [...new Set(port.calls.map((call) => call.sdkMethod))].sort();

  const replayInputs: SimulationReplayInputs = {
    seed,
    manifestChecksum: manifest.checksum,
    hostAdapterId: scenario.hostSystem.hostAdapterId,
    harnessVersion: API_ONLY_HARNESS_VERSION,
    steps: scenario.steps.length,
    faultRate,
    maxRetries,
    clockStartMs: clock.startMs,
    clockStepMs: clock.stepMs,
  };

  const runId = `run-${runIdFragment([seed, scenario.steps.length, faultRate, maxRetries, scenario.hostSystem.hostAdapterId, profile.profileId])}`;
  const recordId = `rec-${runIdFragment([runId, "record"])}`;

  const record = finalizeIntegrationEffortRecord(
    {
      runId,
      harnessVersion: API_ONLY_HARNESS_VERSION,
      seed,
      hostAdapterId: scenario.hostSystem.hostAdapterId,
      hostSystem: manifest.hostSystem,
      profileId: profile.profileId,
      ...(profile.ladderLevel !== undefined ? { ladderLevel: profile.ladderLevel } : {}),
      manifestId: manifest.manifestId,
      manifestChecksum: manifest.checksum,
      evidenceClass: runEvidenceClass,
      apiOperations,
      sdkMethods,
      glue: scenario.glue,
      internalImports: 0,
      timing: {
        firstDecisionMs,
        firstDecisionSteps,
        fullLoopMs,
        fullLoopSteps,
      },
      latency: {
        p50Ms: latencyP50,
        p95Ms: latencyP95,
        samples: successfulLatencies.length,
      },
      failures: {
        count: callsWithFailure,
        retriedCount: callsRetriedOk,
        retryCount: retryAttemptCount,
        exhaustedCount: callsExhausted,
      },
      capabilityCoverage: assessment.coverage,
      gaps: [...assessment.gaps],
      replayInputs,
      completedAt: clock.now(),
    },
    recordId,
  );

  const contractRoundTrips = port.calls.filter((call) => call.status === "ok").length;
  const clientValidationFailures = port.calls.filter(
    (call) => call.errorCode === "SDK_REQUEST_INVALID",
  ).length;

  const reckonComplete =
    verdict.reckonComplete && record.internalImports === 0 && record.timing.fullLoopSteps > 0;

  return {
    record,
    verdict,
    manifest,
    profile,
    replayInputs,
    calls: port.calls,
    steps: observations,
    reckonComplete,
    contractRoundTrips,
    clientValidationFailures,
  };
}

/**
 * The API-only REPLAY GATE: re-run a recorded scenario from its replay
 * inputs. Throws `ApiOnlyReplayMismatchError` on harness-version drift
 * or manifest-checksum mismatch. Byte-identity of the resulting record
 * is asserted by the acceptance suite.
 */
export async function replayApiOnlyScenario(
  replayInputs: SimulationReplayInputs,
  deps: {
    readonly scenario: ApiOnlyScenario;
    readonly port?: ReckonPublicPort;
  },
): Promise<ApiOnlyRunResult> {
  if (replayInputs.harnessVersion !== API_ONLY_HARNESS_VERSION) {
    throw new ApiOnlyReplayMismatchError(
      `harness version mismatch: recorded ${replayInputs.harnessVersion}, current ${API_ONLY_HARNESS_VERSION}`,
    );
  }
  const result = await runApiOnlyScenario(
    {
      seed: replayInputs.seed,
      clock: { startMs: replayInputs.clockStartMs, stepMs: replayInputs.clockStepMs },
      faultRate: replayInputs.faultRate,
      maxRetries: replayInputs.maxRetries,
      ...(deps.port !== undefined ? { port: deps.port } : {}),
    },
    deps.scenario,
  );
  if (result.manifest.checksum !== replayInputs.manifestChecksum) {
    throw new ApiOnlyReplayMismatchError(
      `manifest checksum mismatch: recorded ${replayInputs.manifestChecksum}, replayed ${result.manifest.checksum}`,
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// Suite aggregation
// ---------------------------------------------------------------------------

export interface ApiOnlySuiteEntry {
  readonly scenario: ApiOnlyScenario;
  readonly run: ApiOnlyRunResult;
}

export interface ApiOnlySuiteResult {
  readonly runs: readonly ApiOnlySuiteEntry[];
  readonly records: readonly IntegrationEffortRecord[];
  readonly scorecard: IntegrationEffortScorecard;
}

/** Run a suite of API-only scenarios and aggregate the sealed scorecard. */
export async function runApiOnlySuite(
  entries: ReadonlyArray<{ readonly config: ApiOnlyRunConfig; readonly scenario: ApiOnlyScenario }>,
  options: { readonly scorecardId: string },
): Promise<ApiOnlySuiteResult> {
  if (entries.length === 0) {
    throw new Error("runApiOnlySuite: at least one scenario is required");
  }
  const runs: ApiOnlySuiteEntry[] = [];
  for (const entry of entries) {
    runs.push({ scenario: entry.scenario, run: await runApiOnlyScenario(entry.config, entry.scenario) });
  }
  const records = runs.map((entry) => entry.run.record);
  const generatedAt = records.reduce((max, record) => Math.max(max, record.completedAt), 0);
  const scorecard = aggregateIntegrationEffortScorecard(records, {
    scorecardId: options.scorecardId,
    generatedAt,
  });
  return { runs, records, scorecard };
}

// ---------------------------------------------------------------------------
// The public-SDK surface probes (beyond-surface capability measurement)
// ---------------------------------------------------------------------------

/** One beyond-surface SDK probe result (honest, fixture-class). */
export interface SdkSurfaceProbeResult {
  /** The public SDK method exercised (it EXISTS and is callable). */
  readonly sdkMethod: string;
  /** The public API route the method drives. */
  readonly route: string;
  /** The capability the method backs (frozen vocabulary). */
  readonly capability: string;
  /** Did the SDK accept + validate the request body (client-side contract validation)? */
  readonly requestBuilt: boolean;
  /** The typed error code that came back (the composed fixture path has no route). */
  readonly outcome: string;
  /** Retry classification of the outcome (the frozen port semantics). */
  readonly classification: "terminal" | "transient";
  /** The honest reading of the probe. */
  readonly note: string;
}

/**
 * Probe the beyond-surface PUBLIC SDK methods against the scripted
 * fixture port: the SDK seam exists and validates requests both ways,
 * but the composed fixture path has no route — the honest COMPOSITION_
 * GAP measurement from the API-only side. The probes prove the seam
 * (public surface EXISTS); they do NOT prove a live deployment
 * (fixture evidence class).
 */
export async function probePublicSdkSurface(options?: {
  readonly baseUrl?: string;
  readonly apiKey?: string;
}): Promise<readonly SdkSurfaceProbeResult[]> {
  const { client } = createApiOnlyFixturePort({
    ...(options?.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    ...(options?.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
  });
  const probes: SdkSurfaceProbeResult[] = [];

  const record = (probe: Omit<SdkSurfaceProbeResult, "classification">, code: string): void => {
    // The frozen port semantics: only the RETRYABLE_SDK_ERROR_CODES set
    // is transient; everything else (NOT_FOUND, validation, …) is terminal.
    probes.push({
      ...probe,
      classification: RETRYABLE_SDK_ERROR_CODES.has(code) ? "transient" : "terminal",
    });
  };

  // decision-retrieval: GET /v1/decisions/{id} via decisions.get.
  try {
    await client.decisions.get("dec-api-only-probe");
    record(
      {
        sdkMethod: "decisions.get",
        route: "GET /v1/decisions/{decisionId}",
        capability: "decision-retrieval",
        requestBuilt: true,
        outcome: "OK",
        note: "the public decision-lookup surface answered — unexpected against the fixture port",
      },
      "OK",
    );
  } catch (error) {
    const code = (error as { code?: string }).code ?? "UNKNOWN";
    record(
      {
        sdkMethod: "decisions.get",
        route: "GET /v1/decisions/{decisionId}",
        capability: "decision-retrieval",
        requestBuilt: code !== "SDK_REQUEST_INVALID",
        outcome: code,
        note:
          "the public SDK method exists and drove a typed round-trip, but the composed fixture port has no route — decision retrieval is not reachable through the composed harness path (COMPOSITION_GAP)",
      },
      code,
    );
  }

  // plan-management: POST /v1/plans via plans.create (contract-valid body).
  try {
    await client.plans.create({
      planId: "plan-api-only-probe",
      tenant: { tenantId: "tenant-api-only-probe" },
      subject: { kind: "user", ref: "user-api-only-probe" },
      objective: { objectiveId: "obj-api-only-probe", kind: "complete-task" },
      attentionPolicy: { policyId: "ap-api-only-probe", style: "balanced" },
      replanTriggers: ["host-request"],
      createdAt: 1_000,
      updatedAt: 1_000,
    });
    record(
      {
        sdkMethod: "plans.create",
        route: "POST /v1/plans",
        capability: "plan-management",
        requestBuilt: true,
        outcome: "OK",
        note: "the public plans surface answered — unexpected against the fixture port",
      },
      "OK",
    );
  } catch (error) {
    const code = (error as { code?: string }).code ?? "UNKNOWN";
    record(
      {
        sdkMethod: "plans.create",
        route: "POST /v1/plans",
        capability: "plan-management",
        requestBuilt: code !== "SDK_REQUEST_INVALID",
        outcome: code,
        note:
          "the public SDK method exists and the plan body passed client-side contract validation, but the composed fixture port has no route — plan CRUD is not reachable through the composed harness path (COMPOSITION_GAP)",
      },
      code,
    );
  }

  // ad-memory: POST /v1/ads/query via ads.query.
  try {
    await client.ads.query({
      queryId: "q-api-only-probe",
      tenant: { tenantId: "tenant-api-only-probe" },
      subject: { kind: "user", ref: "user-api-only-probe" },
      mode: "both",
      at: 1_000,
      idempotencyKey: "idem-ads-probe",
    });
    record(
      {
        sdkMethod: "ads.query",
        route: "POST /v1/ads/query",
        capability: "ad-memory",
        requestBuilt: true,
        outcome: "OK",
        note: "the public ad-memory surface answered — unexpected against the fixture port",
      },
      "OK",
    );
  } catch (error) {
    const code = (error as { code?: string }).code ?? "UNKNOWN";
    record(
      {
        sdkMethod: "ads.query",
        route: "POST /v1/ads/query",
        capability: "ad-memory",
        requestBuilt: code !== "SDK_REQUEST_INVALID",
        outcome: code,
        note:
          "the public SDK method exists and drove a typed round-trip, but the composed fixture port has no route — ad memory retrieval is not reachable through the composed harness path (COMPOSITION_GAP)",
      },
      code,
    );
  }

  return probes;
}

// ---------------------------------------------------------------------------
// The machine-generated doc tables (pure functions of the measured runs)
// ---------------------------------------------------------------------------

/** The canonical API-only evidence table (pure function of the suite runs). */
export function renderApiOnlyMarkdownTable(
  entries: ReadonlyArray<{ readonly scenario: ApiOnlyScenario; readonly run: ApiOnlyRunResult }>,
): string {
  const header =
    "| Level | Scenario | Host adapter | Glue (fn/LOC/adapter LOC) | API ops | SDK methods | First decision (step/ms) | Full loop (step/ms) | p50/p95 (ms) | Samples | Round-trips | Failures (cnt/retry/exh) | Capability coverage | Evidence | Reckon-Complete |";
  const separator =
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|";
  const rows = entries.map((entry) => {
    const record = entry.run.record;
    const { satisfied, required } = record.capabilityCoverage;
    const ratio = required === 0 ? 0 : satisfied / required;
    return `| ${record.ladderLevel} | ${entry.scenario.scenarioId} | ${record.hostAdapterId} | ${record.glue.functions}/${record.glue.loc}/${record.glue.customAdapterLoc} | ${record.apiOperations.length} | ${record.sdkMethods.length} | ${record.timing.firstDecisionSteps}/${record.timing.firstDecisionMs} | ${record.timing.fullLoopSteps}/${record.timing.fullLoopMs} | ${record.latency.p50Ms}/${record.latency.p95Ms} | ${record.latency.samples} | ${entry.run.contractRoundTrips} | ${record.failures.count}/${record.failures.retryCount}/${record.failures.exhaustedCount} | ${satisfied}/${required} (${ratio.toFixed(3)}) | ${record.evidenceClass} | ${entry.run.reckonComplete ? "YES" : "NO"} |`;
  });
  return [header, separator, ...rows].join("\n");
}

/** The beyond-surface SDK probe table (pure function of the probe results). */
export function renderSdkSurfaceProbesTable(probes: readonly SdkSurfaceProbeResult[]): string {
  const header = "| SDK method | Route | Capability | Request built | Outcome | Classification | Note |";
  const separator = "|---|---|---|---|---|---|---|";
  const rows = probes.map((probe) => {
    const note = probe.note.replace(/\|/g, "/").replace(/\r?\n/g, " ");
    return `| ${probe.sdkMethod} | ${probe.route} | ${probe.capability} | ${probe.requestBuilt ? "YES" : "NO"} | ${probe.outcome} | ${probe.classification} | ${note} |`;
  });
  return [header, separator, ...rows].join("\n");
}
