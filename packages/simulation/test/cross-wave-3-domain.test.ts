/**
 * SIM-004 — the CROSS-WAVE 3-DOMAIN LAW evaluation (the Wave B mandate).
 *
 * The ladder law: "When the same gap appears in at least three domains,
 * upgrade the common platform primitive and replay earlier levels."
 * Wave B is the first wave that can compose the FULL ladder so far —
 * Wave A levels 1–4 (SIM-002 canonical fixture runs) + the SIM-003
 * integration-case records (levels 5–8) + Wave B levels 9–12 (SIM-004
 * canonical fixture runs) — so the law is evaluated here on the
 * cross-wave record set, not on any single wave.
 *
 * This battery proves:
 * 1. The composition is the honest full record set: 4 + 24 + 4 records
 *    across 12 distinct ladder levels, all fixture-class evidence.
 * 2. THE TRIGGERS (machine-checked): context-snapshots|API_GAP recurs
 *    in domains {2, 4, 10} and plan-management|COMPOSITION_GAP recurs
 *    in domains {5, 8, 9} — both reach domainCount 3 ⇒ the frozen
 *    scorecard machinery flags platformUpgradeCandidate TRUE. SIM-004
 *    records the candidates; it does NOT upgrade the platform (that
 *    belongs to TL3 / the ACR process).
 * 3. The other named gaps honestly stay at domainCount 1 (recurring in
 *    NO three domains — not candidates).
 * 4. The register is a deterministic pure function of the record set.
 * 5. The doc-drift gate: the register table embedded in
 *    docs/simulations/sim-004-levels-9-12.md matches a fresh re-render
 *    byte-for-byte.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  runCanonicalLadderWaveA,
  runCanonicalLadderWaveB,
  runIntegrationCase,
  crossWaveRecurringGaps,
  renderCrossWaveRecurringGapsTable,
} from "../src/index.js";
import type { IntegrationEffortRecord } from "@reckon/contracts";
import { level5Scenarios } from "../../../tests/conformance/fixtures/integration-cases/level5-media.js";
import { level6Scenarios } from "../../../tests/conformance/fixtures/integration-cases/level6-ads.js";
import { level7Scenarios } from "../../../tests/conformance/fixtures/integration-cases/level7-marketplace.js";
import { level8Scenarios } from "../../../tests/conformance/fixtures/integration-cases/level8-travel.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const SIM004_DOC = join(REPO_ROOT, "docs/simulations/sim-004-levels-9-12.md");

const CROSS_WAVE_MARKERS = {
  begin: "<!-- sim-004:cross-wave:begin (machine-generated — regenerate via @reckon/simulation crossWaveRecurringGaps over the canonical Wave A + SIM-003 + Wave B records) -->",
  end: "<!-- sim-004:cross-wave:end -->",
} as const;

async function composeCrossWaveRecords(): Promise<{
  readonly waveALevels: readonly IntegrationEffortRecord[];
  readonly sim003IntegrationCases: readonly IntegrationEffortRecord[];
  readonly waveB: readonly IntegrationEffortRecord[];
}> {
  const waveA = await runCanonicalLadderWaveA();
  const waveB = await runCanonicalLadderWaveB();
  const sim003: IntegrationEffortRecord[] = [];
  for (const scenario of [
    ...level5Scenarios,
    ...level6Scenarios,
    ...level7Scenarios,
    ...level8Scenarios,
  ]) {
    const { run } = await runIntegrationCase(scenario);
    sim003.push(run.record);
  }
  return {
    waveALevels: waveA.runs.map((entry) => entry.run.record),
    sim003IntegrationCases: sim003,
    waveB: waveB.runs.map((entry) => entry.run.record),
  };
}

describe("SIM-004 cross-wave: the 3-domain law over the full composed ladder", () => {
  it("the composition is the honest full record set (4 + 24 + 4 records, 12 levels, fixture class)", async () => {
    const groups = await composeCrossWaveRecords();
    const records = [...groups.waveALevels, ...groups.sim003IntegrationCases, ...groups.waveB];
    expect(records).toHaveLength(32);
    expect(new Set(records.map((record) => record.ladderLevel))).toEqual(
      new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    );
    expect(records.every((record) => record.evidenceClass === "fixture")).toBe(true);
    expect(records.every((record) => record.internalImports === 0)).toBe(true);
  });

  it("THE TRIGGERS: context-snapshots|API_GAP {2,4,10} and plan-management|COMPOSITION_GAP {5,8,9} reach three domains", async () => {
    const groups = await composeCrossWaveRecords();
    const register = crossWaveRecurringGaps(groups);
    const byKey = new Map(register.map((gap) => [`${gap.capability}|${gap.friction}`, gap]));

    // The Wave-A context-snapshots API_GAP (domains 2+4) meets Wave B's
    // level-10 hit: the third domain ⇒ the platform-upgrade candidate.
    const context = byKey.get("context-snapshots|API_GAP")!;
    expect(context).toBeDefined();
    expect(context.ladderLevels).toEqual([2, 4, 10]);
    expect(context.domainCount).toBe(3);
    expect(context.runCount).toBe(3);
    expect(context.platformUpgradeCandidate).toBe(true);

    // The SIM-003 plan-management COMPOSITION_GAP (domains 5+8) meets
    // Wave B's level-9 hit: the third domain ⇒ the candidate.
    const plans = byKey.get("plan-management|COMPOSITION_GAP")!;
    expect(plans).toBeDefined();
    expect(plans.ladderLevels).toEqual([5, 8, 9]);
    expect(plans.domainCount).toBe(3);
    expect(plans.runCount).toBe(3);
    expect(plans.platformUpgradeCandidate).toBe(true);

    // Exactly two candidates in the composed register — no more, no
    // less (the honest trigger list for TL3).
    expect(register.filter((gap) => gap.platformUpgradeCandidate)).toHaveLength(2);
  });

  it("the other named gaps honestly stay single-domain (not candidates)", async () => {
    const groups = await composeCrossWaveRecords();
    const register = crossWaveRecurringGaps(groups);
    const nonCandidates = register.filter((gap) => !gap.platformUpgradeCandidate);
    expect(nonCandidates.map((gap) => `${gap.capability}|${gap.friction}`).sort()).toEqual([
      "ad-memory|COMPOSITION_GAP",
      "decision-retrieval|COMPOSITION_GAP",
      "evidence-retrieval|COMPOSITION_GAP",
    ]);
    expect(nonCandidates.every((gap) => gap.domainCount === 1)).toBe(true);
  });

  it("the register is a deterministic pure function of the composed record set", async () => {
    const first = crossWaveRecurringGaps(await composeCrossWaveRecords());
    const second = crossWaveRecurringGaps(await composeCrossWaveRecords());
    expect(renderCrossWaveRecurringGapsTable(first)).toBe(renderCrossWaveRecurringGapsTable(second));
  });

  it("the report's cross-wave register matches a fresh re-render byte-for-byte (the doc-drift gate)", async () => {
    const register = crossWaveRecurringGaps(await composeCrossWaveRecords());
    const doc = readFileSync(SIM004_DOC, "utf8");
    const beginIndex = doc.indexOf(CROSS_WAVE_MARKERS.begin);
    const endIndex = doc.indexOf(CROSS_WAVE_MARKERS.end);
    expect(beginIndex).toBeGreaterThanOrEqual(0);
    expect(endIndex).toBeGreaterThan(beginIndex);
    const section = doc
      .slice(beginIndex + CROSS_WAVE_MARKERS.begin.length, endIndex)
      .replace(/^\r?\n/, "")
      .replace(/\r?\n$/, "");
    expect(section).toBe(renderCrossWaveRecurringGapsTable(register));
  });
});
