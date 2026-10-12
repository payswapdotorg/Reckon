/**
 * SIM-002 — the Wave A conformance suite (ladder Levels 1–4).
 *
 * Lives inside tests/conformance/fixtures/** (the W1 slice of the
 * conformance home — the root tests/conformance/*.test.ts suites are
 * W3's), which also places this file under the zero-internal-access
 * scanner: every import here is mechanically enforced to be
 * public-surface only (this file therefore imports EXCLUSIVELY from
 * packages/simulation/src and packages/contracts/src — no sibling
 * fixture imports, which the scanner rightly rejects).
 *
 * The conformance home (tests/conformance/README.md) runs this proof
 * that the four SIM-002 synthetic hosts go through Reckon's PUBLIC
 * surface exactly as the ladder's target onboarding flow prescribes,
 * with honest verdicts, honest gaps, honest evidence classes, and the
 * machine-checked doc-drift gate against docs/simulations/
 * sim-002-levels-1-4.md.
 *
 * Proves:
 * 1. Per level: the canonical fixture run's conformance verdict matches
 *    the declared expectation — complete for Levels 1/3; an honest
 *    context-snapshots API_GAP partial for Levels 2/4 (the wave finding).
 * 2. Every record/verdict/scorecard parses as a member of the frozen
 *    reckon.complete.* family; internalImports === 0.
 * 3. Evidence honesty: fixture runs never satisfy production-observed
 *    profile floors (per level), and the wave scorecard aggregates
 *    fixture-class evidence only.
 * 4. The 3-domain law: context-snapshots|API_GAP recurs across exactly
 *    two domains (2, 4) — recurring, NOT yet a platform-upgrade
 *    candidate (the honest wave result).
 * 5. Determinism + replay across the whole wave, including the ensemble
 *    (3 seeds × 4 levels ⇒ 12 records) scorecard.
 * 6. The doc-drift gate: the machine-generated tables in the SIM-002
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
  runLadderLevelFixture,
  runCanonicalLadderWaveA,
  LADDER_WAVE_A_FIXTURES,
  LADDER_WAVE_A_ENSEMBLE_SEEDS,
  renderLadderWaveAScorecardSummary,
  createLevel1StaticCatalogHost,
  createLevel2ContentFeedHost,
  createLevel3StorefrontHost,
  createLevel4NotificationsHost,
  level1StaticCatalogProfile,
  level2ContentFeedProfile,
  level3StorefrontProfile,
  level4NotificationsProfile,
  level1StaticCatalogMeta,
  level2ContentFeedMeta,
  level3StorefrontMeta,
  level4NotificationsMeta,
  type LadderWaveRun,
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
const SIM002_DOC = join(REPO_ROOT, "docs/simulations/sim-002-levels-1-4.md");

// The doc-drift markers wrapping the machine-generated tables in the report.
const SIM002_DOC_MARKERS = {
  evidenceBegin:
    "<!-- sim-002:wave-a:evidence:begin (machine-generated — regenerate via @reckon/simulation runCanonicalLadderWaveA) -->",
  evidenceEnd: "<!-- sim-002:wave-a:evidence:end -->",
  gapsBegin: "<!-- sim-002:wave-a:gaps:begin (machine-generated) -->",
  gapsEnd: "<!-- sim-002:wave-a:gaps:end -->",
  scorecardBegin: "<!-- sim-002:wave-a:scorecard:begin (machine-generated) -->",
  scorecardEnd: "<!-- sim-002:wave-a:scorecard:end -->",
} as const;

/** The per-level expectation table (derived from the package's own metas). */
const LEVEL_METAS = [
  level1StaticCatalogMeta,
  level2ContentFeedMeta,
  level3StorefrontMeta,
  level4NotificationsMeta,
] as const;
const LEVEL_PROFILES = [
  finalizeReckonCompleteProfile({ ...level1StaticCatalogProfile }),
  finalizeReckonCompleteProfile({ ...level2ContentFeedProfile }),
  finalizeReckonCompleteProfile({ ...level3StorefrontProfile }),
  finalizeReckonCompleteProfile({ ...level4NotificationsProfile }),
] as const;
const HOST_FACTORIES = [
  createLevel1StaticCatalogHost,
  createLevel2ContentFeedHost,
  createLevel3StorefrontHost,
  createLevel4NotificationsHost,
] as const;

function docSection(doc: string, begin: string, end: string): string {
  const beginIndex = doc.indexOf(begin);
  const endIndex = doc.indexOf(end);
  if (beginIndex < 0 || endIndex < 0 || endIndex < beginIndex) {
    throw new Error("doc-drift markers missing in docs/simulations/sim-002-levels-1-4.md");
  }
  return doc.slice(beginIndex + begin.length, endIndex).replace(/^\r?\n/, "").replace(/\r?\n$/, "");
}

async function runCanonicalLevels(): Promise<readonly LadderWaveRun[]> {
  const runs: LadderWaveRun[] = [];
  for (const fixture of LADDER_WAVE_A_FIXTURES) {
    runs.push(await runLadderLevelFixture(fixture));
  }
  return runs;
}

describe("SIM-002 Wave A: per-level conformance through the public surface", () => {
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
    const wave = await runCanonicalLadderWaveA();
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
        { seed: "550011", port: createFixtureReckonPort().port },
        { host, profile: strictProfile, steps: 2 },
      );
      expect(run.verdict.reckonComplete).toBe(false);
      expect(run.verdict.evidenceSufficient).toBe(false);
      // Every SUPPORTED capability is wired but the EVIDENCE class is
      // insufficient — OBSERVABILITY_GAP gaps; a partial entry keeps its
      // declared friction (API_GAP) verbatim — never a silent pass.
      expect(run.verdict.gaps.filter((gap) => gap.friction === "OBSERVABILITY_GAP")).toHaveLength(
        meta.requiredCapabilities - meta.expectedPartial,
      );
      expect(run.verdict.gaps.filter((gap) => gap.friction === "API_GAP")).toHaveLength(meta.expectedPartial);
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

  it("the wave scorecard applies the 3-domain law honestly (context-snapshots|API_GAP: 2 domains, not yet an upgrade candidate)", async () => {
    const wave = await runCanonicalLadderWaveA();
    const recurring = wave.scorecard.recurringGaps;
    expect(recurring).toHaveLength(1);
    expect(recurring[0]!.capability).toBe("context-snapshots");
    expect(recurring[0]!.friction).toBe("API_GAP");
    expect(recurring[0]!.ladderLevels).toEqual([2, 4]);
    expect(recurring[0]!.domainCount).toBe(2);
    expect(recurring[0]!.runCount).toBe(2);
    expect(recurring[0]!.platformUpgradeCandidate).toBe(false);
    // The aggregate stays fixture-class (aggregation never upgrades evidence).
    expect(wave.runs.every((entry) => entry.run.record.evidenceClass === "fixture")).toBe(true);
  });

  it("the ensemble (3 seeds × 4 levels) aggregates 12 records with the same recurring finding", async () => {
    const records = [];
    for (const seed of LADDER_WAVE_A_ENSEMBLE_SEEDS) {
      for (const fixture of LADDER_WAVE_A_FIXTURES) {
        const entry = await runLadderLevelFixture(fixture, seed);
        records.push(entry.run.record);
      }
    }
    const scorecard = aggregateIntegrationEffortScorecard(records, {
      scorecardId: "scorecard-sim-002-wave-a-ensemble",
      generatedAt: 60_000,
    });
    expect(scorecard.aggregate.runCount).toBe(12);
    expect(scorecard.aggregate.distinctHosts).toBe(4);
    expect(scorecard.aggregate.distinctLevels).toBe(4);
    const recurring = scorecard.recurringGaps.find(
      (gap) => gap.capability === "context-snapshots" && gap.friction === "API_GAP",
    );
    expect(recurring).toBeDefined();
    expect(recurring!.runCount).toBe(6);
    expect(recurring!.domainCount).toBe(2);
    expect(recurring!.platformUpgradeCandidate).toBe(false);
  });
});

describe("SIM-002 Wave A: the doc-drift gate (machine-checked honesty)", () => {
  it("the report's machine-generated sections match a fresh canonical re-render byte-for-byte", async () => {
    const wave = await runCanonicalLadderWaveA();
    const doc = readFileSync(SIM002_DOC, "utf8");
    expect(docSection(doc, SIM002_DOC_MARKERS.evidenceBegin, SIM002_DOC_MARKERS.evidenceEnd)).toBe(
      wave.markdownTable,
    );
    expect(docSection(doc, SIM002_DOC_MARKERS.gapsBegin, SIM002_DOC_MARKERS.gapsEnd)).toBe(
      wave.markdownGapsTable,
    );
    expect(docSection(doc, SIM002_DOC_MARKERS.scorecardBegin, SIM002_DOC_MARKERS.scorecardEnd)).toBe(
      renderLadderWaveAScorecardSummary(wave.scorecard),
    );
  });
});
