/**
 * The simulation harness driver (SIM-001).
 *
 * The lifecycle a synthetic host exercises — exactly the ladder doc's
 * target onboarding flow:
 *
 *   register a capability manifest
 *   → connect sources (catalog items + realizations through the public API)
 *   → per step: submit candidates → declare objective/policy (in-request)
 *     → decision request → host presents → outcome returned → preference
 *     delta
 *   → conformance verdict + IntegrationEffortRecord with replay inputs.
 *
 * DETERMINISM CONTRACT: the run is a pure function of
 * (seed, host adapter, profile, steps, fault config, clock config, port
 * behavior). No Date.now, no Math.random, no wall-clock reads — time is
 * the injected SimClock, randomness is the seeded SplitMix64 RNG. The
 * record's `replayInputs` block carries everything needed to replay.
 */
import {
  type DecisionResult,
  contentDigest,
  evaluateReckonCompleteConformance,
  finalizeReckonCompleteCapabilityManifest,
  finalizeReckonCompleteConformanceVerdict,
  finalizeIntegrationEffortRecord,
  finalizeReckonCompleteProfile,
  reckonCompleteManifestChecksum,
  type EvidenceClass,
  type IntegrationEffortRecord,
  type ReckonCompleteCapabilityManifest,
  type ReckonCompleteConformanceVerdict,
  type ReckonCompleteProfileDeclaration,
  type ReckonCompleteProfileDeclarationInput,
  type SimulationReplayInputs,
} from "@reckon/contracts";
import { createRng, normalizeSeed } from "../rng.js";
import { createSimClock, type SimClock } from "./clock.js";
import { createRecordingPort, PortCallExhaustedError, type PortCallRecord, type RecordingPort } from "./recording.js";
import { percentileNearestRank } from "./percentile.js";
import type { ReckonPublicPort } from "./port.js";
import type { SimulationHostAdapter } from "./host-adapter.js";
import { scriptedDecisionFor } from "./responder.js";

/** Version of the harness kernel (recorded in effort records). */
export const HARNESS_VERSION = "0.1.0";

export interface SimulationHarnessConfig {
  /** Run seed (uint64 decimal string or non-negative integer). */
  readonly seed: string | number;
  /** Virtual clock configuration (defaults: startMs 0, stepMs 1000). */
  readonly clock?: { readonly startMs?: number; readonly stepMs?: number };
  /** Probability [0,1] of an injected transport fault per attempt (default 0). */
  readonly faultRate?: number;
  /** Maximum retries after the first attempt (default 2). */
  readonly maxRetries?: number;
  /** The Reckon public-surface port (e.g. createFixtureReckonPort().port). */
  readonly port: ReckonPublicPort;
  /** Honest evidence class of the RUN itself (default "fixture"). */
  readonly runEvidenceClass?: EvidenceClass;
}

export interface SimulationRunOptions {
  readonly host: SimulationHostAdapter;
  readonly profile: ReckonCompleteProfileDeclaration | ReckonCompleteProfileDeclarationInput;
  /** Number of decision-loop steps (>= 1). */
  readonly steps: number;
}

export interface SimulationRunResult {
  readonly record: IntegrationEffortRecord;
  readonly verdict: ReckonCompleteConformanceVerdict;
  readonly manifest: ReckonCompleteCapabilityManifest;
  readonly profile: ReckonCompleteProfileDeclaration;
  readonly replayInputs: SimulationReplayInputs;
  readonly calls: readonly PortCallRecord[];
  /**
   * The run-level completion verdict: the conformance verdict is complete
   * AND the run used zero internal imports AND the full loop completed.
   */
  readonly reckonComplete: boolean;
}

/** Typed error for a replay-input/manifest mismatch (replay gate). */
export class SimulationReplayMismatchError extends Error {
  constructor(detail: string) {
    super(`SimulationReplayMismatchError: ${detail}`);
    this.name = "SimulationReplayMismatchError";
  }
}

function requireSteps(steps: number): void {
  if (!Number.isInteger(steps) || steps < 1) {
    throw new Error(`runSimulation: steps must be a positive integer, got ${steps}`);
  }
}

/** Deterministic id fragment from digest parts. */
function runIdFragment(parts: readonly unknown[]): string {
  return contentDigest(parts).slice(0, 16);
}

/**
 * Run one simulation. Each invocation creates a FRESH clock, RNG, and
 * recording port from the config — the same (seed, host, profile, steps,
 * config) always yields byte-identical artifacts.
 */
export async function runSimulation(
  config: SimulationHarnessConfig,
  options: SimulationRunOptions,
): Promise<SimulationRunResult> {
  requireSteps(options.steps);
  const faultRate = config.faultRate ?? 0;
  const maxRetries = config.maxRetries ?? 2;
  const runEvidenceClass = config.runEvidenceClass ?? "fixture";
  // Seeds beyond the uint64 domain are reduced by masking (deterministic;
  // distinct test seeds stay distinct). The uint64 guard itself is a W1 law.
  const seedText = /^[0-9]+$/.test(String(config.seed))
    ? (BigInt(config.seed) & 0xffff_ffff_ffff_ffffn).toString()
    : String(config.seed);
  const seed = normalizeSeed(seedText);
  const clock: SimClock = createSimClock(config.clock ?? {});
  const rng = createRng(seed);
  const port: RecordingPort = createRecordingPort({
    inner: config.port,
    clock,
    rng,
    faultRate,
    maxRetries,
  });

  const profile = finalizeReckonCompleteProfile(options.profile);
  const host = options.host;

  // --- 1. register the capability manifest ---------------------------------
  const manifestContent = {
    ...host.manifestContent,
    hostSystem: {
      hostId: host.hostSystem.hostId,
      name: host.hostSystem.name,
      hostAdapterId: host.hostAdapterId,
      version: host.hostSystem.version,
    },
    declaredAt: clock.now(),
  };
  const manifestChecksum = reckonCompleteManifestChecksum(manifestContent);
  const manifestId = `man-${manifestChecksum.slice(0, 16)}`;
  const manifest = finalizeReckonCompleteCapabilityManifest(manifestContent, manifestId);

  // --- 2. connect sources (host-owned catalog authority) --------------------
  // A connect-phase call that exhausts its retry budget is recorded as a
  // failure and the run continues — a host that cannot connect its
  // sources is a legitimate (measured) integration outcome, never a crash.
  const catchExhausted = async (call: () => Promise<unknown>): Promise<boolean> => {
    try {
      await call();
      return true;
    } catch (error) {
      if (error instanceof PortCallExhaustedError) return false;
      throw error;
    }
  };
  for (const item of host.catalog.items) {
    await catchExhausted(() => port.catalog.upsertItem(item));
  }
  for (const realization of host.catalog.realizations) {
    await catchExhausted(() => port.catalog.upsertRealization(realization));
  }

  // --- 3. the decision loop --------------------------------------------------
  let firstDecisionSteps = 0;
  let firstDecisionMs = 0;
  let fullLoopSteps = 0;
  let fullLoopMs = 0;

  for (let step = 1; step <= options.steps; step += 1) {
    const inputs = host.provideDecisionInputs(step);

    // Host retrieval → public candidate submission.
    let candidatesOk = true;
    try {
      await port.candidates.submit(inputs.candidates);
    } catch (error) {
      if (error instanceof PortCallExhaustedError) {
        candidatesOk = false;
      } else {
        throw error;
      }
    }

    let decisionOk = false;
    {
      const request = {
        schema: "reckon.decision-request" as const,
        schemaVersion: "1",
        requestId: `req-${step}`,
        tenant: inputs.tenant,
        subject: inputs.subject,
        objective: inputs.objective,
        attentionPolicy: inputs.attentionPolicy,
        context: { contextId: inputs.contextId },
        candidates: inputs.candidates,
        constraints: [...(inputs.constraints ?? [])],
        policySelector: {
          policyId: inputs.policySelector.policyId,
          version: inputs.policySelector.version ?? "1",
        },
        at: clock.now(),
        idempotencyKey: `idem-${step}`,
      };
      let result: DecisionResult;
      let decisionLive = true;
      try {
        result = await port.decisions.request(request);
        decisionOk = true;
        if (firstDecisionSteps === 0) {
          firstDecisionSteps = step;
          firstDecisionMs = clock.now() - clock.startMs;
        }
      } catch (error) {
        if (!(error instanceof PortCallExhaustedError)) throw error;
        // Decision call exhausted its retry budget — the step's live decision
        // failed, but the loop still exercises the host callbacks with the
        // deterministic scripted decision so outcome/delta surface calls are
        // attempted and measured (resilience measurement; honestly recorded).
        decisionLive = false;
        result = scriptedDecisionFor(request as Parameters<typeof scriptedDecisionFor>[0]);
      }

      // Host consumes the decision (host-owned presentation authority).
      const reaction = host.consumeDecision(step, result);
      if (reaction.presented) {
        const outcome = host.provideOutcome(step, result, reaction, clock.now());
        let outcomeOk = false;
        try {
          await port.outcomes.append(outcome);
          outcomeOk = true;
        } catch (error) {
          if (!(error instanceof PortCallExhaustedError)) throw error;
        }

        let deltaOk = true;
        const delta = host.providePreferenceDelta?.(step, result, clock.now());
        if (delta !== undefined) {
          try {
            await port.preferences.appendDelta(delta);
          } catch (error) {
            if (!(error instanceof PortCallExhaustedError)) throw error;
            deltaOk = false;
          }
        }

        if (decisionLive && candidatesOk && outcomeOk && deltaOk && fullLoopSteps === 0) {
          fullLoopSteps = step;
          fullLoopMs = clock.now() - clock.startMs;
        }
      }
    }

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

  let failedAttemptCount = 0;
  let callsWithFailure = 0;
  let callsRetriedOk = 0;
  let callsExhausted = 0;
  let retryAttemptCount = 0;
  for (const call of port.calls) {
    const failedAttempts = call.status === "ok" ? call.attempts - 1 : call.attempts;
    failedAttemptCount += failedAttempts;
    if (failedAttempts > 0) callsWithFailure += 1;
    if (call.status === "ok" && call.attempts > 1) callsRetriedOk += 1;
    if (call.status === "error") callsExhausted += 1;
    // RETRIES actually spent: every attempt beyond the first, whatever the
    // call's final status (storm: 16 calls × 1 retry = 16).
    retryAttemptCount += Math.max(0, call.attempts - 1);
  }

  const apiOperations = [...new Set(port.calls.map((call) => call.operation))].sort();
  const sdkMethods = [...new Set(port.calls.map((call) => call.sdkMethod))].sort();

  const replayInputs: SimulationReplayInputs = {
    seed,
    manifestChecksum: manifest.checksum,
    hostAdapterId: host.hostAdapterId,
    harnessVersion: HARNESS_VERSION,
    steps: options.steps,
    faultRate,
    maxRetries,
    clockStartMs: clock.startMs,
    clockStepMs: clock.stepMs,
  };

  const runId = `run-${runIdFragment([seed, options.steps, faultRate, maxRetries, host.hostAdapterId, profile.profileId])}`;
  const recordId = `rec-${runIdFragment([runId, "record"])}`;

  const record = finalizeIntegrationEffortRecord(
    {
      runId,
      harnessVersion: HARNESS_VERSION,
      seed,
      hostAdapterId: host.hostAdapterId,
      hostSystem: manifest.hostSystem,
      profileId: profile.profileId,
      ...(profile.ladderLevel !== undefined ? { ladderLevel: profile.ladderLevel } : {}),
      manifestId: manifest.manifestId,
      manifestChecksum: manifest.checksum,
      evidenceClass: runEvidenceClass,
      apiOperations,
      sdkMethods,
      glue: host.glue,
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

  const reckonComplete =
    verdict.reckonComplete && record.internalImports === 0 && timingFullLoopAchieved(record);

  return { record, verdict, manifest, profile, replayInputs, calls: port.calls, reckonComplete };
}

function timingFullLoopAchieved(record: IntegrationEffortRecord): boolean {
  return record.timing.fullLoopSteps > 0;
}

/**
 * Replay a recorded run from its replay inputs. The REPLAY GATE:
 * - the harness version must match;
 * - the regenerated manifest checksum must equal the recorded one;
 * - the caller supplies the same host adapter + a port of the same kind
 *   (the scripted responder is deterministic, so identical calls yield
 *   identical responses).
 *
 * Byte-identity of the resulting record is asserted by the harness tests
 * (`replaySimulationRun(...)` then compare canonical JSON digests).
 */
export async function replaySimulationRun(
  replayInputs: SimulationReplayInputs,
  deps: {
    readonly host: SimulationHostAdapter;
    readonly profile: ReckonCompleteProfileDeclaration | ReckonCompleteProfileDeclarationInput;
    readonly port: ReckonPublicPort;
  },
): Promise<SimulationRunResult> {
  if (replayInputs.harnessVersion !== HARNESS_VERSION) {
    throw new SimulationReplayMismatchError(
      `harness version mismatch: recorded ${replayInputs.harnessVersion}, current ${HARNESS_VERSION}`,
    );
  }
  const result = await runSimulation(
    {
      seed: replayInputs.seed,
      clock: { startMs: replayInputs.clockStartMs, stepMs: replayInputs.clockStepMs },
      faultRate: replayInputs.faultRate,
      maxRetries: replayInputs.maxRetries,
      port: deps.port,
    },
    { host: deps.host, profile: deps.profile, steps: replayInputs.steps },
  );
  if (result.manifest.checksum !== replayInputs.manifestChecksum) {
    throw new SimulationReplayMismatchError(
      `manifest checksum mismatch: recorded ${replayInputs.manifestChecksum}, replayed ${result.manifest.checksum}`,
    );
  }
  return result;
}

/**
 * The reusable harness handle: `createSimulationHarness(config)` fixes the
 * seed/config and lets a synthetic host run repeatedly (each `run` gets a
 * fresh clock + RNG, so runs with the same options are byte-identical —
 * vary the seed for ensembles).
 */
export function createSimulationHarness(config: SimulationHarnessConfig): {
  readonly run: (options: SimulationRunOptions) => Promise<SimulationRunResult>;
} {
  return {
    run: (options) => runSimulation(config, options),
  };
}
