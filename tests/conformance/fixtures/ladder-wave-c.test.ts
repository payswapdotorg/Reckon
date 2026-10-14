/**
 * SIM-005 — the Wave C-1 conformance suite (ladder Levels 13–16).
 *
 * Lives inside tests/conformance/fixtures/** (alongside the SIM-002
 * wave-a and SIM-004 wave-b gates), which also places this file under
 * the zero-internal-access scanner: every import here is mechanically
 * enforced to be public-surface only (this file therefore imports
 * EXCLUSIVELY from packages/simulation/src and packages/contracts/src —
 * no sibling fixture imports, which the scanner rightly rejects; the
 * cross-wave battery that DOES need the sibling SIM-003 fixtures lives
 * in packages/simulation/test/**, outside the scanned surface).
 *
 * Proves:
 * 1. Per level: the canonical fixture run's conformance verdict matches
 *    the declared expectation — complete for Level 15; honest partials
 *    for Levels 13/14/16 (evidence-retrieval COMPOSITION_GAP,
 *    plan-management COMPOSITION_GAP, plan-management +
 *    evidence-retrieval COMPOSITION_GAP).
 * 2. Every record/verdict/scorecard parses as a member of the frozen
 *    reckon.complete.* family; internalImports === 0 and exactly the
 *    standard six public operations at every level (zero internal
 *    Reckon access — the SIM-001 law).
 * 3. Evidence honesty: fixture runs never satisfy production-observed
 *    profile floors (per level), and the wave scorecard aggregates
 *    fixture-class evidence only.
 * 4. Determinism + the replay gate across the whole wave, including the
 *    ensemble (3 seeds × 4 levels ⇒ 12 records) scorecard.
 * 5. The doc-drift gate: the machine-generated tables in the SIM-005
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
  runLadderWaveCLevelFixture,
  runCanonicalLadderWaveC,
  LADDER_WAVE_C_FIXTURES,
  LADDER_WAVE_C_ENSEMBLE_SEEDS,
  renderLadderWaveCScorecardSummary,
  createLevel13HealthcareHost,
  createLevel14EducationHost,
  createLevel15B2bSaasHost,
  createLevel16EnterpriseWorkflowHost,
  level13HealthcareProfile,
  level14EducationProfile,
  level15B2bSaasProfile,
  level16EnterpriseWorkflowProfile,
  level13HealthcareMeta,
  level14EducationMeta,
  level15B2bSaasMeta,
  level16EnterpriseWorkflowMeta,
  type LadderWaveCRun,
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
const SIM005_DOC = join(REPO_ROOT, "docs/simulations/sim-005-levels-13-16.md");

// The doc-drift markers wrapping the machine-generated tables in the report.
const SIM005_DOC_MARKERS = {
  evidenceBegin:
    "<!-- sim-005:wave-c:evidence:begin (machine-generated — regenerate via @reckon/simulation runCanonicalLadderWaveC) -->",
  evidenceEnd: "<!-- sim-005:wave-c:evidence:end -->",
  gapsBegin: "<!-- sim-005:wave-c:gaps:begin (machine-generated) -->",
  gapsEnd: "<!-- sim-005:wave-c:gaps:end -->",
  scorecardBegin: "<!-- sim-005:wave-c:scorecard:begin (machine-generated) -->",
  scorecardEnd: "<!-- sim-005:wave-c:scorecard:end -->",
} as const;

/** The per-level expectation table (derived from the package's own metas). */
const LEVEL_METAS = [
  level13HealthcareMeta,
  level14EducationMeta,
  level15B2bSaasMeta,
  level16EnterpriseWorkflowMeta,
] as const;
const LEVEL_PROFILES = [
  finalizeReckonCompleteProfile({ ...level13HealthcareProfile }),
  finalizeReckonCompleteProfile({ ...level14EducationProfile }),
  finalizeReckonCompleteProfile({ ...level15B2bSaasProfile }),
  finalizeReckonCompleteProfile({ ...level16EnterpriseWorkflowProfile }),
] as const;
const HOST_FACTORIES = [
  createLevel13HealthcareHost,
  createLevel14EducationHost,
  createLevel15B2bSaasHost,
  createLevel16EnterpriseWorkflowHost,
] as const;

function docSection(doc: string, begin: string, end: string): string {
  const beginIndex = doc.indexOf(begin);
  const endIndex = doc.indexOf(end);
  if (beginIndex < 0 || endIndex < 0 || endIndex < beginIndex) {
    throw new Error("doc-drift markers missing in docs/simulations/sim-005-levels-13-16.md");
  }
  return doc.slice(beginIndex + begin.length, endIndex).replace(/^\r?\n/, "").replace(/\r?\n$/, "");
}

async function runCanonicalLevels(): Promise<readonly LadderWaveCRun[]> {
  const runs: LadderWaveCRun[] = [];
  for (const fixture of LADDER_WAVE_C_FIXTURES) {
    runs.push(await runLadderWaveCLevelFixture(fixture));
  }
  return runs;
}

describe("SIM-005 Wave C-1: per-level conformance through the public surface", () => {
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
    const wave = await runCanonicalLadderWaveC();
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
        { seed: "770055", port: createFixtureReckonPort().port },
        { host, profile: strictProfile, steps: 2 },
      );
      expect(run.verdict.reckonComplete).toBe(false);
      expect(run.verdict.evidenceSufficient).toBe(false);
      // Every SUPPORTED capability is wired but the EVIDENCE class is
      // insufficient — OBSERVABILITY_GAP gaps; each partial entry keeps
      // its DECLARED friction verbatim (COMPOSITION_GAP for levels
      // 13/14/16) — never a silent pass.
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

  it("the wave scorecard stays within-wave honest (two two-domain gaps; no 3-domain candidate INSIDE the wave)", async () => {
    const wave = await runCanonicalLadderWaveC();
    const recurring = wave.scorecard.recurringGaps;
    // Within THIS wave each named gap appears in exactly two domains —
    // the cross-wave composition (cross-wave-through-wave-c.test.ts)
    // is where the law's three-domain triggers fire.
    expect(recurring.map((gap) => `${gap.capability}|${gap.friction}`).sort()).toEqual([
      "evidence-retrieval|COMPOSITION_GAP",
      "plan-management|COMPOSITION_GAP",
    ]);
    expect(recurring.every((gap) => gap.domainCount === 2 && !gap.platformUpgradeCandidate)).toBe(true);
    // The aggregate stays fixture-class (aggregation never upgrades evidence).
    expect(wave.runs.every((entry) => entry.run.record.evidenceClass === "fixture")).toBe(true);
  });

  it("zero internal Reckon access: internalImports === 0 and exactly the standard six public operations at every level", async () => {
    const runs = await runCanonicalLevels();
    const STANDARD_OPERATIONS = [
      "POST /v1/candidates",
      "POST /v1/catalog/items",
      "POST /v1/catalog/realizations",
      "POST /v1/decisions",
      "POST /v1/outcomes",
      "POST /v1/preferences/events",
    ];
    const STANDARD_SDK_METHODS = [
      "candidates.submit",
      "catalog.upsertItem",
      "catalog.upsertRealization",
      "decisions.request",
      "outcomes.append",
      "preferences.appendDelta",
    ];
    for (const entry of runs) {
      const record = entry.run.record;
      expect(record.internalImports).toBe(0);
      // The standard decision loop — the SAME six public operations at
      // every level: ladder complexity grows HOST-side, not Reckon-side.
      expect(record.apiOperations).toEqual(STANDARD_OPERATIONS);
      expect(record.sdkMethods).toEqual(STANDARD_SDK_METHODS);
      expect(record.evidenceClass).toBe("fixture");
    }
  });

  it("the ensemble (3 seeds × 4 levels) aggregates 12 records with the same recurring findings", async () => {
    const records = [];
    for (const seed of LADDER_WAVE_C_ENSEMBLE_SEEDS) {
      for (const fixture of LADDER_WAVE_C_FIXTURES) {
        const entry = await runLadderWaveCLevelFixture(fixture, seed);
        records.push(entry.run.record);
      }
    }
    const scorecard = aggregateIntegrationEffortScorecard(records, {
      scorecardId: "scorecard-sim-005-wave-c-ensemble",
      generatedAt: 60_000,
    });
    expect(scorecard.aggregate.runCount).toBe(12);
    expect(scorecard.aggregate.distinctHosts).toBe(4);
    expect(scorecard.aggregate.distinctLevels).toBe(4);
    for (const [capability, friction] of [
      ["evidence-retrieval", "COMPOSITION_GAP"],
      ["plan-management", "COMPOSITION_GAP"],
    ] as const) {
      const recurring = scorecard.recurringGaps.find(
        (gap) => gap.capability === capability && gap.friction === friction,
      );
      expect(recurring).toBeDefined();
      // Each gap lives in exactly TWO of the wave's domains (levels
      // 13+16 and 14+16); the ensemble multiplies run counts (6), not
      // domain counts — the 3-domain law counts DISTINCT domains.
      expect(recurring!.runCount).toBe(6);
      expect(recurring!.domainCount).toBe(2);
      expect(recurring!.platformUpgradeCandidate).toBe(false);
    }
  });
});

describe("SIM-005 Wave C-1: the doc-drift gate (machine-checked honesty)", () => {
  it("the report's machine-generated sections match a fresh canonical re-render byte-for-byte", async () => {
    const wave = await runCanonicalLadderWaveC();
    const doc = readFileSync(SIM005_DOC, "utf8");
    expect(docSection(doc, SIM005_DOC_MARKERS.evidenceBegin, SIM005_DOC_MARKERS.evidenceEnd)).toBe(
      wave.markdownTable,
    );
    expect(docSection(doc, SIM005_DOC_MARKERS.gapsBegin, SIM005_DOC_MARKERS.gapsEnd)).toBe(
      wave.markdownGapsTable,
    );
    expect(docSection(doc, SIM005_DOC_MARKERS.scorecardBegin, SIM005_DOC_MARKERS.scorecardEnd)).toBe(
      renderLadderWaveCScorecardSummary(wave.scorecard),
    );
  });
});
