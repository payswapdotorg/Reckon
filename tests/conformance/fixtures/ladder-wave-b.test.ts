/**
 * SIM-004 — the Wave B conformance suite (ladder Levels 9–12).
 *
 * Lives inside tests/conformance/fixtures/** (alongside the SIM-002
 * wave-a gate), which also places this file under the
 * zero-internal-access scanner: every import here is mechanically
 * enforced to be public-surface only (this file therefore imports
 * EXCLUSIVELY from packages/simulation/src and packages/contracts/src —
 * no sibling fixture imports, which the scanner rightly rejects; the
 * API-only and cross-wave batteries that DO need the sibling fixtures
 * live in packages/simulation/test/**, outside the scanned surface).
 *
 * Proves:
 * 1. Per level: the canonical fixture run's conformance verdict matches
 *    the declared expectation — complete for Level 11; honest partials
 *    for Levels 9/10/12 (plan-management COMPOSITION_GAP,
 *    context-snapshots API_GAP, evidence-retrieval COMPOSITION_GAP).
 * 2. Every record/verdict/scorecard parses as a member of the frozen
 *    reckon.complete.* family; internalImports === 0.
 * 3. Evidence honesty: fixture runs never satisfy production-observed
 *    profile floors (per level), and the wave scorecard aggregates
 *    fixture-class evidence only.
 * 4. Determinism + replay across the whole wave, including the ensemble
 *    (3 seeds × 4 levels ⇒ 12 records) scorecard.
 * 5. The doc-drift gate: the machine-generated tables in the SIM-004
 *    report match a fresh canonical re-render byte-for-byte.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  runSimulation,
  replaySimulationRun,
  createFixtureReckonPort,
  aggregateIntegrationEffortScorecard,
  runLadderWaveBLevelFixture,
  runCanonicalLadderWaveB,
  LADDER_WAVE_B_FIXTURES,
  LADDER_WAVE_B_ENSEMBLE_SEEDS,
  renderLadderWaveBScorecardSummary,
  createLevel9FoodDeliveryHost,
  createLevel10MobilityHost,
  createLevel11SocialFeedHost,
  createLevel12FinanceHost,
  level9FoodDeliveryProfile,
  level10MobilityProfile,
  level11SocialFeedProfile,
  level12FinanceProfile,
  level9FoodDeliveryMeta,
  level10MobilityMeta,
  level11SocialFeedMeta,
  level12FinanceMeta,
  type LadderWaveBRun,
} from "../../../packages/simulation/src/index.js";
import {
  ReckonCompleteEnvelopeSchema,
  IntegrationEffortRecordSchema,
  ReckonCompleteConformanceVerdictSchema,
  IntegrationEffortScorecardSchema,
  canonicalJson,
  finalizeReckonCompleteProfile,
} from "../../../packages/contracts/src/index.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const SIM004_DOC = join(REPO_ROOT, "docs/simulations/sim-004-levels-9-12.md");

// The doc-drift markers wrapping the machine-generated tables in the report.
const SIM004_DOC_MARKERS = {
  evidenceBegin:
    "<!-- sim-004:wave-b:evidence:begin (machine-generated — regenerate via @reckon/simulation runCanonicalLadderWaveB) -->",
  evidenceEnd: "<!-- sim-004:wave-b:evidence:end -->",
  gapsBegin: "<!-- sim-004:wave-b:gaps:begin (machine-generated) -->",
  gapsEnd: "<!-- sim-004:wave-b:gaps:end -->",
  scorecardBegin: "<!-- sim-004:wave-b:scorecard:begin (machine-generated) -->",
  scorecardEnd: "<!-- sim-004:wave-b:scorecard:end -->",
} as const;

/** The per-level expectation table (derived from the package's own metas). */
const LEVEL_METAS = [
  level9FoodDeliveryMeta,
  level10MobilityMeta,
  level11SocialFeedMeta,
  level12FinanceMeta,
] as const;
const LEVEL_PROFILES = [
  finalizeReckonCompleteProfile({ ...level9FoodDeliveryProfile }),
  finalizeReckonCompleteProfile({ ...level10MobilityProfile }),
  finalizeReckonCompleteProfile({ ...level11SocialFeedProfile }),
  finalizeReckonCompleteProfile({ ...level12FinanceProfile }),
] as const;
const HOST_FACTORIES = [
  createLevel9FoodDeliveryHost,
  createLevel10MobilityHost,
  createLevel11SocialFeedHost,
  createLevel12FinanceHost,
] as const;

function docSection(doc: string, begin: string, end: string): string {
  const beginIndex = doc.indexOf(begin);
  const endIndex = doc.indexOf(end);
  if (beginIndex < 0 || endIndex < 0 || endIndex < beginIndex) {
    throw new Error("doc-drift markers missing in docs/simulations/sim-004-levels-9-12.md");
  }
  return doc.slice(beginIndex + begin.length, endIndex).replace(/^\r?\n/, "").replace(/\r?\n$/, "");
}

async function runCanonicalLevels(): Promise<readonly LadderWaveBRun[]> {
  const runs: LadderWaveBRun[] = [];
  for (const fixture of LADDER_WAVE_B_FIXTURES) {
    runs.push(await runLadderWaveBLevelFixture(fixture));
  }
  return runs;
}

describe("SIM-004 Wave B: per-level conformance through the public surface", () => {
  it("the canonical level runs match the declared conformance expectations exactly", async () => {
    const runs = await runCanonicalLevels();
    expect(runs).toHaveLength(LEVEL_METAS.length);
    for (let i = 0; i < LEVEL_METAS.length; i += 1) {
      const meta = LEVEL_METAS[i]!;
      const run = runs[i]!.run;
      expect(run.record.ladderLevel).toBe(meta.level);
      expect(run.profile.profileId).toBe(LEVEL_PROFILES[i]!.profileId);
      expect(run.record.hostAdapterId).toBe(meta.hostAdapterId);
      expect(run.verdict.coverage.required).toBe(meta.requiredCapabilities);
      expect(run.verdict.coverage.satisfied).toBe(meta.expectedSatisfied);
      expect(run.verdict.coverage.partial).toBe(meta.expectedPartial);
      expect(run.verdict.coverage.missing).toBe(meta.expectedMissing);
      expect(run.verdict.reckonComplete).toBe(meta.expectedPartial === 0 && meta.expectedMissing === 0);
      expect(run.reckonComplete).toBe(
        meta.expectedPartial === 0 && meta.expectedMissing === 0 && run.record.timing.fullLoopSteps > 0,
      );
      expect(run.verdict.gaps.map((gap) => `${gap.capability}|${gap.friction}`).sort()).toEqual(
        [...meta.expectedGaps].sort(),
      );
      expect(run.record.evidenceClass).toBe("fixture");
      expect(run.record.internalImports).toBe(0);
    }
  });

  it("every wave artifact parses as a member of the frozen reckon.complete.* family", async () => {
    const wave = await runCanonicalLadderWaveB();
    for (const entry of wave.runs) {
      expect(IntegrationEffortRecordSchema.parse(entry.run.record)).toEqual(entry.run.record);
      expect(ReckonCompleteEnvelopeSchema.parse(entry.run.record).schema).toBe(
        "reckon.complete.integration-effort-record",
      );
      expect(ReckonCompleteConformanceVerdictSchema.parse(entry.run.verdict)).toEqual(entry.run.verdict);
      expect(ReckonCompleteEnvelopeSchema.parse(entry.run.verdict).schema).toBe(
        "reckon.complete.conformance-verdict",
      );
    }
    expect(IntegrationEffortScorecardSchema.parse(wave.scorecard)).toEqual(wave.scorecard);
    expect(ReckonCompleteEnvelopeSchema.parse(wave.scorecard).schema).toBe(
      "reckon.complete.integration-effort-scorecard",
    );
  });

  it("fixture evidence never satisfies a production-observed floor, at ANY level", async () => {
    for (let i = 0; i < LEVEL_METAS.length; i += 1) {
      const meta = LEVEL_METAS[i]!;
      const strictProfile = {
        ...LEVEL_PROFILES[i]!,
        profileId: `${LEVEL_PROFILES[i]!.profileId}-strict-probe`,
        requiredEvidenceClass: "production-observed" as const,
      };
      const { host } = HOST_FACTORIES[i]!();
      const run = await runSimulation(
        { seed: "660011", port: createFixtureReckonPort().port },
        { host, profile: strictProfile, steps: 2 },
      );
      expect(run.verdict.reckonComplete).toBe(false);
      expect(run.verdict.evidenceSufficient).toBe(false);
      // Every SUPPORTED capability is wired but the EVIDENCE class is
      // insufficient — OBSERVABILITY_GAP gaps; each partial entry keeps
      // its DECLARED friction verbatim (API_GAP for level 10,
      // COMPOSITION_GAP for levels 9/12) — never a silent pass.
      expect(run.verdict.gaps.filter((gap) => gap.friction === "OBSERVABILITY_GAP")).toHaveLength(
        meta.requiredCapabilities - meta.expectedPartial,
      );
      for (const expectedGap of meta.expectedGaps) {
        const [capability, friction] = expectedGap.split("|") as [string, string];
        expect(
          run.verdict.gaps.filter(
            (gap) => gap.capability === capability && gap.friction === friction,
          ),
        ).toHaveLength(1);
      }
      expect(run.reckonComplete).toBe(false);
    }
  });

  it("the wave replays byte-identically (the replay gate, all four levels)", async () => {
    const runs = await runCanonicalLevels();
    for (let i = 0; i < runs.length; i += 1) {
      const entry = runs[i]!;
      const { host } = HOST_FACTORIES[i]!();
      const replayed = await replaySimulationRun(entry.run.record.replayInputs, {
        host,
        profile: LEVEL_PROFILES[i]!,
        port: createFixtureReckonPort().port,
      });
      expect(canonicalJson(replayed.record)).toBe(canonicalJson(entry.run.record));
      expect(replayed.reckonComplete).toBe(entry.run.reckonComplete);
    }
  });

  it("the wave scorecard stays within-wave honest (three single-domain gaps; no 3-domain candidate INSIDE the wave)", async () => {
    const wave = await runCanonicalLadderWaveB();
    const recurring = wave.scorecard.recurringGaps;
    // Within THIS wave each named gap appears in exactly one domain —
    // the cross-wave composition (cross-wave-3-domain.test.ts) is where
    // the law's three-domain triggers fire.
    expect(recurring.map((gap) => `${gap.capability}|${gap.friction}`).sort()).toEqual([
      "context-snapshots|API_GAP",
      "evidence-retrieval|COMPOSITION_GAP",
      "plan-management|COMPOSITION_GAP",
    ]);
    expect(recurring.every((gap) => gap.domainCount === 1 && !gap.platformUpgradeCandidate)).toBe(true);
    // The aggregate stays fixture-class (aggregation never upgrades evidence).
    expect(wave.runs.every((entry) => entry.run.record.evidenceClass === "fixture")).toBe(true);
  });

  it("the ensemble (3 seeds × 4 levels) aggregates 12 records with the same recurring findings", async () => {
    const records = [];
    for (const seed of LADDER_WAVE_B_ENSEMBLE_SEEDS) {
      for (const fixture of LADDER_WAVE_B_FIXTURES) {
        const entry = await runLadderWaveBLevelFixture(fixture, seed);
        records.push(entry.run.record);
      }
    }
    const scorecard = aggregateIntegrationEffortScorecard(records, {
      scorecardId: "scorecard-sim-004-wave-b-ensemble",
      generatedAt: 60_000,
    });
    expect(scorecard.aggregate.runCount).toBe(12);
    expect(scorecard.aggregate.distinctHosts).toBe(4);
    expect(scorecard.aggregate.distinctLevels).toBe(4);
    for (const [capability, friction] of [
      ["context-snapshots", "API_GAP"],
      ["evidence-retrieval", "COMPOSITION_GAP"],
      ["plan-management", "COMPOSITION_GAP"],
    ] as const) {
      const recurring = scorecard.recurringGaps.find(
        (gap) => gap.capability === capability && gap.friction === friction,
      );
      expect(recurring).toBeDefined();
      expect(recurring!.runCount).toBe(3);
      expect(recurring!.domainCount).toBe(1);
      expect(recurring!.platformUpgradeCandidate).toBe(false);
    }
  });
});

describe("SIM-004 Wave B: the doc-drift gate (machine-checked honesty)", () => {
  it("the report's machine-generated sections match a fresh canonical re-render byte-for-byte", async () => {
    const wave = await runCanonicalLadderWaveB();
    const doc = readFileSync(SIM004_DOC, "utf8");
    expect(docSection(doc, SIM004_DOC_MARKERS.evidenceBegin, SIM004_DOC_MARKERS.evidenceEnd)).toBe(
      wave.markdownTable,
    );
    expect(docSection(doc, SIM004_DOC_MARKERS.gapsBegin, SIM004_DOC_MARKERS.gapsEnd)).toBe(
      wave.markdownGapsTable,
    );
    expect(docSection(doc, SIM004_DOC_MARKERS.scorecardBegin, SIM004_DOC_MARKERS.scorecardEnd)).toBe(
      renderLadderWaveBScorecardSummary(wave.scorecard),
    );
  });
});
