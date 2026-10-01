/**
 * W3-010 — the no-LLM fast-path performance envelope benchmark harness
 * (test infrastructure, committed under tests/perf/).
 *
 * Measures the decision→schedule path latency of the REAL repository
 * kernels at REALISTIC payload sizes — the scales the reference adapters
 * produce (WebFlix adapter limits: 256 items/import, 8 realizations/
 * item, 256 candidates/set):
 *
 *   normalization     — W2-001 normalizeCandidates over the payload
 *   decision          — W2-003 expandExperiences + W2-002 evaluatePolicy
 *   scheduling        — W2-004 decide (the full SWITCH path: request
 *                       validation, scored-experience validation, switch
 *                       evaluation, checkpoint materialization)
 *   outcome recording — adapter report → OutcomeEvent (schema-validated)
 *                       + W3-004 observability recordOutcome + EventStore
 *                       append (the in-memory sink; disk journals are
 *                       I/O, excluded from the kernel envelope)
 *
 * DETERMINISTIC + REPEATABLE: the payload is generated index-based (no
 * randomness), iteration counts are fixed, the percentile method is
 * fixed (nearest-rank on sorted samples), and the caller-supplied
 * timestamps are the only time inputs. Wall-clock timing uses Node's
 * monotonic performance.now(); run-to-run jitter is absorbed by the
 * documented budget headroom in envelope.test.ts.
 *
 * OBSERVABILITY SURFACING: every measured iteration emits decision
 * records (latency advanced onto the injected clock from the measured
 * kernel time — same discipline as apps/api), scheduler-action records
 * (from the real schedule delta) and outcome-linkage records through
 * the REAL W3-004 ObservabilityRecorder, so the envelope surfaces
 * through the observability records (worker-3 handoff: decision
 * latency, policy/model version, uncertainty, cost, outcome linkage,
 * scheduler actions).
 *
 * NO LLM anywhere. Fixture evidence: controlled-local — this measures
 * the composed repository software on the benchmark host, NOT a
 * production deployment (AGENTS.md "Production truth").
 */
import { performance } from "node:perf_hooks";
import {
  DecisionRequestSchema,
  DecisionResultSchema,
  contentDigest,
} from "../../packages/contracts/src/index.js";
import type { DecisionRequest, TenantScope, SubjectReference } from "../../packages/contracts/src/index.js";
import { normalizeCandidates } from "../../packages/decision/src/index.js";
import { evaluatePolicy } from "../../packages/decision/src/index.js";
import { expandExperiences } from "../../packages/experience/src/index.js";
import { decide } from "../../packages/scheduler/src/index.js";
import type { PlanState } from "../../packages/scheduler/src/index.js";
import { createWebFlixAdapter } from "../../packages/integrations/src/index.js";
import type { WebFlixCatalogImport, WebFlixRecommendationFeed, WebFlixViewingSession, WebFlixViewingGoal } from "../../packages/integrations/src/index.js";
import { InMemoryEventStoreAdapter, ManualClock } from "../../packages/events/src/index.js";
import { InMemoryObservabilitySink, ObservabilityRecorder } from "../../packages/observability/src/index.js";
import type { ObservabilityRecord } from "../../packages/observability/src/index.js";

// ---------------------------------------------------------------------------
// Scale + iteration constants (deterministic, documented)
// ---------------------------------------------------------------------------

/** The payload scale: at the scales the reference adapters produce
 *  (WebFlix limits: 256 items/import, 8 realizations/item, 256
 *  candidates/set — the envelope runs at ~78% of every limit). */
export const ENVELOPE_SCALE = {
  catalogItems: 200,
  realizationsPerItem: 2,
  candidateRows: 128,
  ghostRows: 4,
} as const;

/** Warmup iterations (JIT tiering; never measured). */
export const ENVELOPE_WARMUP_ITERATIONS = 30;

/** Measured iterations (the percentile sample count per stage). */
export const ENVELOPE_ITERATIONS = 200;

/** The bench tenant/subject/fixtures (deterministic constants). */
const BENCH_TENANT: TenantScope = { tenantId: "bench-envelope" };
const BENCH_SUBJECT: SubjectReference = { kind: "user", ref: "bench-subject-1" };
const BENCH_T0 = 1_735_689_600_000;
const BENCH_DECISION_AT = BENCH_T0 + 3_600_000;
const BENCH_OUTCOME_AT = BENCH_T0 + 7_200_000;
const BENCH_CONTEXT_ID = "bench-ctx-1";
const BENCH_RESUME_TOKEN = "bench-resume-token-1";

// ---------------------------------------------------------------------------
// Deterministic payload generation (index-based, zero randomness)
// ---------------------------------------------------------------------------

const MEDIA_TYPES = ["movie", "series", "documentary", "short"] as const;
const GENRE_POOL = [
  "nature", "documentary", "drama", "science", "comedy", "thriller",
  "history", "music", "sports", "travel", "food", "art",
] as const;
const SURFACES = ["tv-app", "web-player", "mobile-app", "download"] as const;
const RESOLUTIONS = ["480p", "720p", "1080p", "4k"] as const;

/** A WebFlix-shaped host catalog at envelope scale: every item carries
 *  two playback options; the first expands into three format variants
 *  (full + clip + subtitled), the second into one (full). */
function generateHostCatalog(): WebFlixCatalogImport {
  const items = [];
  for (let i = 0; i < ENVELOPE_SCALE.catalogItems; i++) {
    items.push({
      mediaId: `bench-m-${i}`,
      title: `Bench Item ${i}`,
      mediaType: MEDIA_TYPES[i % MEDIA_TYPES.length],
      genres: [GENRE_POOL[i % GENRE_POOL.length], GENRE_POOL[(i + 1) % GENRE_POOL.length]],
      availableFrom: BENCH_T0,
      availableUntil: BENCH_T0 + 2_592_000_000,
      rightsTags: ["basic"],
      playbacks: [
        {
          optionId: `bench-r-${i}-1`,
          surface: SURFACES[i % SURFACES.length],
          locale: "en",
          maxResolution: RESOLUTIONS[i % RESOLUTIONS.length],
          audioTracks: ["en"],
          durationSeconds: 2400,
          downloadable: false,
          offlineEligible: false,
          variants: ["clip", "subtitled"],
        },
        {
          optionId: `bench-r-${i}-2`,
          surface: SURFACES[(i + 1) % SURFACES.length],
          maxResolution: RESOLUTIONS[(i + 1) % RESOLUTIONS.length],
          audioTracks: ["en"],
          durationSeconds: 1500,
          downloadable: false,
          offlineEligible: false,
        },
      ],
    });
  }
  return { source: "bench-catalog-export", exportedAt: BENCH_T0, items } as WebFlixCatalogImport;
}

/** A WebFlix-shaped retrieval feed: candidateRows known rows + ghostRows
 *  unknown rows (honest absence exercised at scale). */
function generateCandidateFeed(): WebFlixRecommendationFeed {
  const rows = [];
  for (let i = 0; i < ENVELOPE_SCALE.candidateRows; i++) {
    rows.push({ mediaId: `bench-m-${i}`, rank: i + 1 });
  }
  for (let g = 0; g < ENVELOPE_SCALE.ghostRows; g++) {
    rows.push({ mediaId: `bench-m-ghost-${g}`, rank: ENVELOPE_SCALE.candidateRows + g + 1 });
  }
  return { feedId: "bench-feed-1", source: "bench-retrieval", rows };
}

const BENCH_SESSION: WebFlixViewingSession = {
  profileId: "bench-user-1",
  sessionId: BENCH_CONTEXT_ID,
  at: BENCH_DECISION_AT,
  deviceKind: "living-room-tv",
  networkKind: "wifi",
  localTime: "20:15",
  timezone: "Europe/Berlin",
  minutesAvailable: 45,
  recentInterruptions: 1,
  continuing: true,
};

const BENCH_GOAL: WebFlixViewingGoal = {
  goal: "relax",
  tasteGenres: ["nature", "documentary", "drama", "science"],
};

// ---------------------------------------------------------------------------
// Statistics (fixed nearest-rank percentile method)
// ---------------------------------------------------------------------------

/** One stage's measured statistics (milliseconds). */
export interface StageStats {
  readonly stage: string;
  readonly samples: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

/** Nearest-rank percentile over sorted samples (deterministic). */
function percentileOf(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[index] as number;
}

function statsOf(stage: string, samples: readonly number[]): StageStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length);
  return {
    stage,
    samples: samples.length,
    mean: Math.round(mean * 1000) / 1000,
    p50: percentileOf(sorted, 0.5),
    p95: percentileOf(sorted, 0.95),
    p99: percentileOf(sorted, 0.99),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

// ---------------------------------------------------------------------------
// The envelope benchmark
// ---------------------------------------------------------------------------

/** The four measured stages + the composite decision→schedule path. */
export interface EnvelopeStages {
  readonly normalization: StageStats;
  readonly decision: StageStats;
  readonly scheduling: StageStats;
  readonly outcomeRecording: StageStats;
  /** Per-iteration SUM of the four stages (the full no-LLM path). */
  readonly endToEnd: StageStats;
}

export interface EnvelopeScaleReport {
  readonly catalogItems: number;
  readonly realizations: number;
  readonly candidateRows: number;
  readonly ghostRows: number;
  readonly expandedExperiences: number;
  readonly scoredExperiences: number;
}

export interface EnvelopeBenchmarkResult {
  readonly stages: EnvelopeStages;
  readonly scale: EnvelopeScaleReport;
  readonly meta: {
    readonly warmupIterations: number;
    readonly measuredIterations: number;
    readonly timer: "performance.now (monotonic)";
    readonly percentileMethod: "nearest-rank";
  };
  /** The observability records the envelope surfaced through (decision
   *  latency, scheduler actions, outcome linkage — the W3-004 trail). */
  readonly records: readonly ObservabilityRecord[];
}

export interface EnvelopeBenchmarkOptions {
  readonly warmup?: number;
  readonly iterations?: number;
}

/**
 * Run the deterministic no-LLM performance envelope benchmark. The
 * payload is generated, adapter-mapped and kernel-measured exactly the
 * same way on every invocation; only wall-clock timing varies (absorbed
 * by the documented budget headroom).
 */
export function runEnvelopeBenchmark(options: EnvelopeBenchmarkOptions = {}): EnvelopeBenchmarkResult {
  const warmup = options.warmup ?? ENVELOPE_WARMUP_ITERATIONS;
  const iterations = options.iterations ?? ENVELOPE_ITERATIONS;

  // --- Adapter-fronted payload (the REAL WebFlix reference adapter). ---
  const webflix = createWebFlixAdapter();
  const catalog = webflix.importCatalog(generateHostCatalog());
  if (!catalog.ok) throw new Error(`envelope bench: catalog mapping failed: ${catalog.error.message}`);
  const candidateSet = webflix.toCandidateSet(generateCandidateFeed());
  if (!candidateSet.ok) throw new Error(`envelope bench: candidate mapping failed: ${candidateSet.error.message}`);
  const context = webflix.toContextSnapshot(BENCH_SESSION);
  if (!context.ok) throw new Error(`envelope bench: context mapping failed: ${context.error.message}`);
  const objective = webflix.toObjective(BENCH_GOAL);
  if (!objective.ok) throw new Error(`envelope bench: objective mapping failed: ${objective.error.message}`);
  const attentionPolicy = webflix.toAttentionPolicy("balanced");
  if (!attentionPolicy.ok) throw new Error(`envelope bench: attention mapping failed: ${attentionPolicy.error.message}`);
  const objectiveFit = webflix.toObjectiveFit(catalog.value.items);
  const allowedFormats = ["full", "clip", "segment", "subtitled"] as const;

  // --- The scheduler configuration (the full SWITCH path). ---
  // Baseline outputs computed once (deterministic); the per-iteration
  // measurement re-runs the same real kernels on the same payload.
  const normalizedBaseline = normalizeCandidates({
    candidates: candidateSet.value,
    items: catalog.value.items,
    realizations: catalog.value.realizations,
    tenant: BENCH_TENANT,
  });
  if (!normalizedBaseline.ok) throw new Error(`envelope bench: normalization failed: ${normalizedBaseline.error.message}`);
  const expansionBaseline = expandExperiences(
    {
      candidates: normalizedBaseline.value,
      items: catalog.value.items,
      realizations: catalog.value.realizations,
      formatPolicy: { allowedFormats: [...allowedFormats] },
      objective: objective.value,
      constraints: [],
    },
    { objectiveFit },
  );
  if (!expansionBaseline.ok) throw new Error(`envelope bench: expansion failed: ${expansionBaseline.error.message}`);
  const policyBaseline = evaluatePolicy({
    experiences: expansionBaseline.value.experiences.map((entry) => entry.experience),
    objective: objective.value,
    constraints: [],
    policyId: "bench-policy",
    policyVersion: "1",
  });
  if (!policyBaseline.ok) throw new Error(`envelope bench: policy evaluation failed: ${policyBaseline.error.message}`);
  const scored = policyBaseline.value.scored;
  if (scored.length < 2) throw new Error("envelope bench: need at least two scored experiences for the SWITCH path");

  const currentExperience = scored[0] as (typeof scored)[number];
  const switchCandidate = scored[1] as (typeof scored)[number];
  const playingState: PlanState = {
    status: "playing",
    currentExperienceId: currentExperience.experience.experienceId,
    queue: [],
    resumeCheckpoints: [],
  };

  // --- The observability + store composition (the surfaced envelope). ---
  const sink = new InMemoryObservabilitySink();
  const clock = new ManualClock(BENCH_T0);
  let recordId = 0;
  const recorder = new ObservabilityRecorder({
    sink,
    clock: () => clock.now(),
    idGenerator: () => `bench-rec-${(recordId += 1)}`,
  });
  const store = new InMemoryEventStoreAdapter();

  const normalizationSamples: number[] = [];
  const decisionSamples: number[] = [];
  const schedulingSamples: number[] = [];
  const outcomeSamples: number[] = [];
  const endToEndSamples: number[] = [];

  const runOnce = (iteration: number, measure: boolean): void => {
    // Per-iteration request (distinct caller-supplied `at`, request id
    // and idempotency key — constructed OUTSIDE the measured windows).
    const request: DecisionRequest = DecisionRequestSchema.parse({
      requestId: `bench-req-${iteration}`,
      tenant: BENCH_TENANT,
      subject: BENCH_SUBJECT,
      objective: objective.value,
      attentionPolicy: attentionPolicy.value,
      context: { contextId: context.value.contextId },
      candidates: candidateSet.value,
      constraints: [],
      currentExperience: currentExperience.experience,
      policySelector: { policyId: "bench-policy", version: "1" },
      at: BENCH_DECISION_AT + iteration,
      idempotencyKey: `bench-idem-${iteration}`,
    });

    // Stage 1 — normalization (W2-001).
    let t0 = performance.now();
    const normalized = normalizeCandidates({
      candidates: candidateSet.value,
      items: catalog.value.items,
      realizations: catalog.value.realizations,
      tenant: BENCH_TENANT,
    });
    const normalizationMs = performance.now() - t0;
    if (!normalized.ok) throw new Error(`envelope bench: normalization failed: ${normalized.error.message}`);

    // Stage 2 — decision (W2-003 expansion + W2-002 policy evaluation).
    t0 = performance.now();
    const expansion = expandExperiences(
      {
        candidates: normalized.value,
        items: catalog.value.items,
        realizations: catalog.value.realizations,
        formatPolicy: { allowedFormats: [...allowedFormats] },
        objective: objective.value,
        constraints: [],
      },
      { objectiveFit },
    );
    if (!expansion.ok) throw new Error(`envelope bench: expansion failed: ${expansion.error.message}`);
    const policy = evaluatePolicy({
      experiences: expansion.value.experiences.map((entry) => entry.experience),
      objective: objective.value,
      constraints: [],
      policyId: "bench-policy",
      policyVersion: "1",
    });
    const decisionMs = performance.now() - t0;
    if (!policy.ok) throw new Error(`envelope bench: policy evaluation failed: ${policy.error.message}`);

    // Stage 3 — scheduling (W2-004 decide, the full SWITCH path).
    t0 = performance.now();
    const decision = decide({
      currentState: playingState,
      request,
      scored: policy.value.scored,
      switch: {
        currentExperienceId: currentExperience.experience.experienceId,
        candidateExperienceId: switchCandidate.experience.experienceId,
        expectedImprovement: 0.9,
        interruptionCost: 0.1,
        uncertaintyPenalty: 0.1,
        resumeLoss: 0.05,
        switchThreshold: 0.5,
        suggestThreshold: 0.2,
      },
      resumeTokens: { [currentExperience.experience.experienceId]: BENCH_RESUME_TOKEN },
    });
    const schedulingMs = performance.now() - t0;
    if (!decision.ok) throw new Error(`envelope bench: decide failed: ${decision.error.message}`);

    // Stage 4 — outcome recording (adapter report → contract event →
    // observability recordOutcome → EventStore append; in-memory sink —
    // disk journals are I/O, excluded from the kernel envelope).
    t0 = performance.now();
    const outcome = webflix.toOutcomeEvent(
      {
        playbackId: `bench-pb-${iteration}`,
        at: BENCH_OUTCOME_AT,
        mediaId: switchCandidate.experience.itemId,
        experienceId: switchCandidate.experience.experienceId,
        decisionId: decisionIdOf(iteration),
        event: "completed",
        positionSeconds: 1500,
        totalSeconds: 1500,
      },
      {
        tenant: BENCH_TENANT,
        subject: BENCH_SUBJECT,
        evidenceClass: "controlled-local",
        contextId: context.value.contextId,
      },
    );
    if (!outcome.ok) throw new Error(`envelope bench: outcome mapping failed: ${outcome.error.message}`);
    recorder.recordOutcome({ event: outcome.value });
    store.append(outcome.value);
    const outcomeMs = performance.now() - t0;

    if (measure) {
      normalizationSamples.push(normalizationMs);
      decisionSamples.push(decisionMs);
      schedulingSamples.push(schedulingMs);
      outcomeSamples.push(outcomeMs);
      endToEndSamples.push(normalizationMs + decisionMs + schedulingMs + outcomeMs);
    }

    // --- The envelope surfaces through observability (outside the
    //     measured windows; latency advanced onto the injected clock
    //     from the measured kernel time — the apps/api discipline). ---
    const decisionId = decisionIdOf(iteration);
    const result = DecisionResultSchema.parse({
      decisionId,
      requestId: request.requestId,
      tenant: BENCH_TENANT,
      action: decision.value.action,
      selectedExperience: decision.value.selectedExperience,
      alternatives: [],
      policy: { policyId: "bench-policy", version: "1" },
      scheduleDelta: decision.value.scheduleDelta,
      reasons: decision.value.reasons,
      provenance: { system: "reckon-envelope-bench", version: "0.1.0" },
      at: request.at,
    });
    clock.advance(Math.max(0, Math.round(decisionMs + schedulingMs)));
    recorder.recordDecision({ request, result, latencyMs: decisionMs + schedulingMs });
    recorder.recordSchedulerAction({
      source: "decision",
      action: decision.value.action,
      tenant: BENCH_TENANT,
      decisionId,
      scheduleDelta: decision.value.scheduleDelta,
    });
  };

  for (let i = 0; i < warmup; i++) runOnce(i, false);
  for (let i = warmup; i < warmup + iterations; i++) runOnce(i, true);

  return {
    stages: {
      normalization: statsOf("normalization", normalizationSamples),
      decision: statsOf("decision", decisionSamples),
      scheduling: statsOf("scheduling", schedulingSamples),
      outcomeRecording: statsOf("outcome-recording", outcomeSamples),
      endToEnd: statsOf("end-to-end (decision→schedule+record)", endToEndSamples),
    },
    scale: {
      catalogItems: catalog.value.items.length,
      realizations: catalog.value.realizations.length,
      candidateRows: candidateSet.value.candidates.length,
      ghostRows: ENVELOPE_SCALE.ghostRows,
      expandedExperiences: expansionBaseline.value.experiences.length,
      scoredExperiences: policyBaseline.value.scored.length,
    },
    meta: {
      warmupIterations: warmup,
      measuredIterations: iterations,
      timer: "performance.now (monotonic)",
      percentileMethod: "nearest-rank",
    },
    records: sink.records(),
  };
}

/** Deterministic decision id per iteration (digest-derived, like the
 *  vertical harness). */
function decisionIdOf(iteration: number): string {
  return `dec-${contentDigest({ bench: true, iteration }).slice(0, 24)}`;
}

/** Human-readable one-line-per-stage table (for logs/reports). */
export function formatEnvelopeReport(result: EnvelopeBenchmarkResult): string {
  const lines = [
    `scale: ${result.scale.catalogItems} items / ${result.scale.realizations} realizations / ${result.scale.candidateRows} candidate rows (${result.scale.ghostRows} ghost) / ${result.scale.expandedExperiences} experiences / ${result.scale.scoredExperiences} scored`,
    `iterations: ${result.meta.measuredIterations} measured (${result.meta.warmupIterations} warmup), timer ${result.meta.timer}, ${result.meta.percentileMethod} percentiles`,
    "stage                              p50(ms)   p95(ms)   p99(ms)   max(ms)",
  ];
  for (const stage of [
    result.stages.normalization,
    result.stages.decision,
    result.stages.scheduling,
    result.stages.outcomeRecording,
    result.stages.endToEnd,
  ]) {
    lines.push(
      `${stage.stage.padEnd(34)} ${String(stage.p50).padStart(8)} ${String(stage.p95).padStart(9)} ${String(stage.p99).padStart(9)} ${String(stage.max).padStart(9)}`,
    );
  }
  return lines.join("\n");
}
