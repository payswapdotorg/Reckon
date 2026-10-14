/**
 * SIM-006 — the Wave C conformance suite (ladder Levels 17–20).
 *
 * Lives inside tests/conformance/fixtures/** (alongside the SIM-002
 * wave-a gate and the SIM-004 wave-b gate), which also places this file
 * under the zero-internal-access scanner: every import here is
 * mechanically enforced to be public-surface only (this file therefore
 * imports EXCLUSIVELY from packages/simulation/src and
 * packages/contracts/src — no sibling fixture imports, which the scanner
 * rightly rejects; the wave-C acceptance battery that needs package-
 * local machinery lives in packages/simulation/test/levels-wave-c.test.ts,
 * outside the scanned surface).
 *
 * Proves:
 * 1. Per level: the canonical fixture run's conformance verdict is
 *    Reckon-Complete (12/12 at every level — the honest incompleteness
 *    lives in the law-mandated AUXILIARY runs: the Level 17
 *    single-agent baseline completes; the agent-delegation and
 *    webhook-delivery probes carry one declared partial each; the
 *    Level 20 capability-churn phase carries one declared missing).
 * 2. Every record/verdict/scorecard parses as a member of the frozen
 *    reckon.complete.* family; internalImports === 0.
 * 3. Evidence honesty: fixture runs never satisfy production-observed
 *    profile floors (per level), and the wave scorecard aggregates
 *    fixture-class evidence only.
 * 4. Determinism + replay across the whole wave (canonical + auxiliary
 *    runs), including the ensemble (3 seeds × 4 levels ⇒ 12 records)
 *    scorecard.
 * 5. The within-wave 3-domain law: each named gap appears in exactly
 *    one domain — no platform-upgrade candidate fires inside Wave C
 *    alone (the cross-wave composition is TL3/SIM-007's).
 * 6. The doc-drift gates: the machine-generated tables in the four
 *    SIM-006 case docs and the Wave C scorecard section match a fresh
 *    canonical re-render byte-for-byte.
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
  runLadderWaveCAuxCase,
  runCanonicalLadderWaveC,
  LADDER_WAVE_C_FIXTURES,
  LADDER_WAVE_C_AUX_CASES,
  LADDER_WAVE_C_ENSEMBLE_SEEDS,
  renderLadderWaveCLevelDocTables,
  renderLadderWaveCScorecardSummary,
  createLevel17MultiAgentHost,
  createLevel17SingleAgentBaselineHost,
  createLevel17AgentDelegationProbeHost,
  createLevel18MultiSurfaceHost,
  createLevel18WebhookDeliveryProbeHost,
  createLevel19ResourceConstrainedHost,
  createLevel20StormwatchHost,
  level17MultiAgentProfile,
  level17SingleAgentBaselineProfile,
  level17AgentDelegationProbeProfile,
  level18MultiSurfaceProfile,
  level18WebhookDeliveryProbeProfile,
  level19ResourceConstrainedProfile,
  level20AdversarialProfile,
  level17MultiAgentMeta,
  level17SingleAgentBaselineMeta,
  level17AgentDelegationProbeMeta,
  level18MultiSurfaceMeta,
  level18WebhookDeliveryProbeMeta,
  level19ResourceConstrainedMeta,
  level20AdversarialMeta,
  level20ChurnDegradedMeta,
  type LadderWaveCRun,
  type LadderWaveCAuxRun,
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
const CASE_DOCS_DIR = join(REPO_ROOT, "docs/simulations/integration-cases");
const SCORECARD_DOC = join(REPO_ROOT, "docs/simulations/scorecard.md");

// The doc-drift marker pairs wrapping the machine-generated tables.
function markers(namespace: string, section: string, regenerate: boolean): { begin: string; end: string } {
  return {
    begin: `<!-- ${namespace}:${section}:begin (machine-generated${regenerate ? " — regenerate via @reckon/simulation runCanonicalLadderWaveC" : ""}) -->`,
    end: `<!-- ${namespace}:${section}:end -->`,
  };
}

const CASE_DOC_TABLES = [
  {
    level: 17,
    file: "level17-multi-agent.md",
    hasAux: true,
    hasGaps: true,
  },
  {
    level: 18,
    file: "level18-multi-surface.md",
    hasAux: true,
    hasGaps: true,
  },
  {
    level: 19,
    file: "level19-resource-constrained.md",
    hasAux: false,
    hasGaps: false,
  },
  {
    level: 20,
    file: "level20-adversarial.md",
    hasAux: true,
    hasGaps: true,
  },
] as const;

/** The per-level expectation table (derived from the package's own metas). */
const LEVEL_METAS = [
  level17MultiAgentMeta,
  level18MultiSurfaceMeta,
  level19ResourceConstrainedMeta,
  level20AdversarialMeta,
] as const;
const LEVEL_PROFILES = [
  finalizeReckonCompleteProfile({ ...level17MultiAgentProfile }),
  finalizeReckonCompleteProfile({ ...level18MultiSurfaceProfile }),
  finalizeReckonCompleteProfile({ ...level19ResourceConstrainedProfile }),
  finalizeReckonCompleteProfile({ ...level20AdversarialProfile }),
] as const;
const HOST_FACTORIES = [
  createLevel17MultiAgentHost,
  createLevel18MultiSurfaceHost,
  createLevel19ResourceConstrainedHost,
  createLevel20StormwatchHost,
] as const;

function docSection(doc: string, begin: string, end: string): string {
  const beginIndex = doc.indexOf(begin);
  const endIndex = doc.indexOf(end);
  if (beginIndex < 0 || endIndex < 0 || endIndex < beginIndex) {
    throw new Error(`doc-drift markers missing: ${begin}`);
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

/** The fresh host factory for an auxiliary case (kind-dispatched). */
function auxHostFactory(caseKey: string) {
  switch (caseKey) {
    case "level17-single-agent-baseline":
      return createLevel17SingleAgentBaselineHost;
    case "level17-probe-agent-delegation":
      return createLevel17AgentDelegationProbeHost;
    case "level18-probe-webhook-delivery":
      return createLevel18WebhookDeliveryProbeHost;
    case "level20-churn-degraded":
      return () => createLevel20StormwatchHost({ capabilityPhase: "degraded" });
    default:
      throw new Error(`unknown aux case ${caseKey}`);
  }
}

function auxProfileFor(caseKey: string) {
  switch (caseKey) {
    case "level17-single-agent-baseline":
      return finalizeReckonCompleteProfile({ ...level17SingleAgentBaselineProfile });
    case "level17-probe-agent-delegation":
      return finalizeReckonCompleteProfile({ ...level17AgentDelegationProbeProfile });
    case "level18-probe-webhook-delivery":
      return finalizeReckonCompleteProfile({ ...level18WebhookDeliveryProbeProfile });
    case "level20-churn-degraded":
      return finalizeReckonCompleteProfile({ ...level20AdversarialProfile });
    default:
      throw new Error(`unknown aux case ${caseKey}`);
  }
}

describe("SIM-006 Wave C: per-level conformance through the public surface", () => {
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
      expect(run.verdict.reckonComplete).toBe(true);
      expect(run.reckonComplete).toBe(true);
      expect(run.verdict.gaps).toEqual([]);
      expect(run.record.gaps).toEqual([]);
      expect(run.record.evidenceClass).toBe("fixture");
      expect(run.record.internalImports).toBe(0);
    }
  });

  it("the auxiliary runs match their declared honest expectations (baseline, probes, churn)", async () => {
    const expected = [
      { meta: level17SingleAgentBaselineMeta, complete: true, gaps: [] as string[] },
      { meta: level17AgentDelegationProbeMeta, complete: false, gaps: ["agent-delegation|COMPOSITION_GAP"] },
      { meta: level18WebhookDeliveryProbeMeta, complete: false, gaps: ["webhook-delivery|COMPOSITION_GAP"] },
      { meta: level20ChurnDegradedMeta, complete: false, gaps: ["preference-feedback|ADAPTER_GAP"] },
    ] as const;
    const auxRuns: LadderWaveCAuxRun[] = [];
    for (const auxCase of LADDER_WAVE_C_AUX_CASES) {
      auxRuns.push(await runLadderWaveCAuxCase(auxCase));
    }
    expect(auxRuns).toHaveLength(expected.length);
    for (let i = 0; i < expected.length; i += 1) {
      const entry = auxRuns[i]!;
      const want = expected[i]!;
      const run = entry.run;
      expect(run.record.ladderLevel).toBe(want.meta.level);
      expect(run.record.hostAdapterId).toBe(want.meta.hostAdapterId);
      expect(run.verdict.coverage.required).toBe(want.meta.requiredCapabilities);
      expect(run.verdict.coverage.satisfied).toBe(want.meta.expectedSatisfied);
      expect(run.verdict.coverage.partial).toBe(want.meta.expectedPartial);
      expect(run.verdict.coverage.missing).toBe(want.meta.expectedMissing);
      expect(run.verdict.reckonComplete).toBe(want.complete);
      expect(run.reckonComplete).toBe(want.complete);
      expect(run.verdict.gaps.map((gap) => `${gap.capability}|${gap.friction}`).sort()).toEqual(
        [...want.gaps].sort(),
      );
      expect(run.record.evidenceClass).toBe("fixture");
      expect(run.record.internalImports).toBe(0);
    }
  });

  it("every wave artifact parses as a member of the frozen reckon.complete.* family", async () => {
    const wave = await runCanonicalLadderWaveC();
    for (const entry of [...wave.runs, ...wave.auxRuns]) {
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
        { seed: "660013", port: createFixtureReckonPort().port },
        { host, profile: strictProfile, steps: 2 },
      );
      expect(run.verdict.reckonComplete).toBe(false);
      expect(run.verdict.evidenceSufficient).toBe(false);
      // Every SUPPORTED capability is wired but the EVIDENCE class is
      // insufficient — OBSERVABILITY_GAP gaps; never a silent pass.
      expect(run.verdict.gaps.filter((gap) => gap.friction === "OBSERVABILITY_GAP")).toHaveLength(
        meta.requiredCapabilities - meta.expectedPartial,
      );
      expect(run.reckonComplete).toBe(false);
    }
  });

  it("the wave replays byte-identically (the replay gate: canonical + auxiliary runs)", async () => {
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
    for (const auxCase of LADDER_WAVE_C_AUX_CASES) {
      const original = await runLadderWaveCAuxCase(auxCase);
      const replayed = await replaySimulationRun(original.run.record.replayInputs, {
        host: auxHostFactory(auxCase.caseKey)().host,
        profile: auxProfileFor(auxCase.caseKey),
        port: createFixtureReckonPort().port,
      });
      expect(canonicalJson(replayed.record)).toBe(canonicalJson(original.run.record));
      expect(replayed.reckonComplete).toBe(original.run.reckonComplete);
    }
  });

  it("the wave scorecard stays within-wave honest (three single-domain gaps; no 3-domain candidate INSIDE the wave)", async () => {
    const wave = await runCanonicalLadderWaveC();
    const recurring = wave.scorecard.recurringGaps;
    // Within THIS wave each named gap appears in exactly one domain —
    // the cross-wave composition (Wave A + SIM-003 + Wave B + W1's
    // levels 13–16 + Wave C) is TL3/SIM-007's reconciliation; the
    // merged-wave candidates already on record are unchanged by it.
    expect(recurring.map((gap) => `${gap.capability}|${gap.friction}`).sort()).toEqual([
      "agent-delegation|COMPOSITION_GAP",
      "preference-feedback|ADAPTER_GAP",
      "webhook-delivery|COMPOSITION_GAP",
    ]);
    expect(recurring.every((gap) => gap.domainCount === 1 && !gap.platformUpgradeCandidate)).toBe(true);
    // The aggregate stays fixture-class (aggregation never upgrades evidence).
    expect(
      [...wave.runs, ...wave.auxRuns].every((entry) => entry.run.record.evidenceClass === "fixture"),
    ).toBe(true);
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
      scorecardId: "scorecard-sim-006-wave-c-ensemble",
      generatedAt: 80_000,
    });
    expect(scorecard.aggregate.runCount).toBe(12);
    expect(scorecard.aggregate.distinctHosts).toBe(4);
    expect(scorecard.aggregate.distinctLevels).toBe(4);
    // The ensemble's canonical runs are gap-free at every seed (the
    // verdict mechanics are manifest-driven, seed-independent).
    expect(scorecard.recurringGaps).toEqual([]);
  });
});

describe("SIM-006 Wave C: the doc-drift gates (machine-checked honesty)", () => {
  it("the four case docs' machine-generated sections match a fresh canonical re-render byte-for-byte", async () => {
    const wave = await runCanonicalLadderWaveC();
    for (const caseDoc of CASE_DOC_TABLES) {
      const doc = readFileSync(join(CASE_DOCS_DIR, caseDoc.file), "utf8");
      const tables = renderLadderWaveCLevelDocTables(wave.runs, wave.auxRuns, caseDoc.level);
      const canonicalMarkers = markers(`sim-006:level${caseDoc.level}`, "canonical", true);
      expect(docSection(doc, canonicalMarkers.begin, canonicalMarkers.end)).toBe(tables.canonical);
      if (caseDoc.hasAux) {
        const auxMarkers = markers(`sim-006:level${caseDoc.level}`, "aux", false);
        expect(docSection(doc, auxMarkers.begin, auxMarkers.end)).toBe(tables.aux);
      } else {
        expect(tables.aux).toBe("");
      }
      if (caseDoc.hasGaps) {
        const gapsMarkers = markers(`sim-006:level${caseDoc.level}`, "gaps", false);
        expect(docSection(doc, gapsMarkers.begin, gapsMarkers.end)).toBe(tables.gaps);
      } else {
        expect(tables.gaps).toBe("");
      }
    }
  });

  it("the scorecard doc's Wave C section matches a fresh canonical re-render byte-for-byte", async () => {
    const wave = await runCanonicalLadderWaveC();
    const doc = readFileSync(SCORECARD_DOC, "utf8");
    const evidence = markers("sim-006:wave-c", "evidence", true);
    expect(docSection(doc, evidence.begin, evidence.end)).toBe(wave.markdownTable);
    const aux = markers("sim-006:wave-c", "aux", false);
    expect(docSection(doc, aux.begin, aux.end)).toBe(wave.markdownAuxTable);
    const gaps = markers("sim-006:wave-c", "gaps", false);
    expect(docSection(doc, gaps.begin, gaps.end)).toBe(wave.markdownGapsTable);
    const scorecard = markers("sim-006:wave-c", "scorecard", false);
    expect(docSection(doc, scorecard.begin, scorecard.end)).toBe(
      renderLadderWaveCScorecardSummary(wave.scorecard),
    );
  });
});
