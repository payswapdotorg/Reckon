/**
 * SIM-005 — the CROSS-WAVE 3-DOMAIN LAW evaluation, extended through
 * Wave C (the W1 Wave-C-1 mandate).
 *
 * The ladder law: "When the same gap appears in at least three domains,
 * upgrade the common platform primitive and replay earlier levels."
 * Wave C-1 composes the full ladder through level 16 — Wave A levels
 * 1–4 (SIM-002 canonical fixture runs) + the SIM-003 integration-case
 * records (levels 5–8) + Wave B levels 9–12 (SIM-004 canonical fixture
 * runs) + Wave C levels 13–16 (SIM-005 canonical fixture runs) — so the
 * law is evaluated here on the cross-wave record set through Wave C.
 *
 * This battery proves:
 * 1. The composition is the honest full record set: 4 + 24 + 4 + 4
 *    records across 16 distinct ladder levels, all fixture-class
 *    evidence, all zero-internal-access.
 * 2. THE NEW TRIGGER (machine-checked): evidence-retrieval|
 *    COMPOSITION_GAP recurs in domains {12, 13, 16} — finance (Wave B)
 *    + healthcare (Wave C) + enterprise workflow (Wave C) — reaching
 *    domainCount 3 ⇒ the frozen scorecard machinery flags
 *    platformUpgradeCandidate TRUE. SIM-005 records the candidate; it
 *    does NOT upgrade the platform (that belongs to TL3 / the ACR
 *    process).
 * 3. The standing candidates persist and only GAIN domains: plan-
 *    management|COMPOSITION_GAP {5, 8, 9} → {5, 8, 9, 14, 16}
 *    (education + enterprise workflow); context-snapshots|API_GAP
 *    {2, 4, 10} unchanged.
 * 4. ADDITIVITY (the union-compatible aggregation law): the Waves A+B
 *    entries keep their domains and run counts exactly — composing the
 *    Wave C records JOINS the register without altering any pre-Wave-C
 *    entry (asserted by direct comparison against the SIM-004
 *    crossWaveRecurringGaps composition of the same A+B records).
 * 5. The register is a deterministic pure function of the record set.
 * 6. The doc-drift gate: the register table embedded in
 *    docs/simulations/sim-005-levels-13-16.md matches a fresh re-render
 *    byte-for-byte.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  runCanonicalLadderWaveA,
  runCanonicalLadderWaveB,
  runCanonicalLadderWaveC,
  runIntegrationCase,
  crossWaveRecurringGaps,
  crossWaveRecurringGapsThroughWaveC,
  renderCrossWaveRecurringGapsThroughWaveCTable,
} from "../src/index.js";
import type { IntegrationEffortRecord } from "@reckon/contracts";
import { level5Scenarios } from "../../../tests/conformance/fixtures/integration-cases/level5-media.js";
import { level6Scenarios } from "../../../tests/conformance/fixtures/integration-cases/level6-ads.js";
import { level7Scenarios } from "../../../tests/conformance/fixtures/integration-cases/level7-marketplace.js";
import { level8Scenarios } from "../../../tests/conformance/fixtures/integration-cases/level8-travel.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const SIM005_DOC = join(REPO_ROOT, "docs/simulations/sim-005-levels-13-16.md");

const CROSS_WAVE_MARKERS = {
  begin: "<!-- sim-005:cross-wave:begin (machine-generated — regenerate via @reckon/simulation crossWaveRecurringGapsThroughWaveC over the canonical Wave A + SIM-003 + Wave B + Wave C records) -->",
  end: "<!-- sim-005:cross-wave:end -->",
} as const;

interface CrossWaveGroups {
  readonly waveALevels: readonly IntegrationEffortRecord[];
  readonly sim003IntegrationCases: readonly IntegrationEffortRecord[];
  readonly waveB: readonly IntegrationEffortRecord[];
  readonly waveC: readonly IntegrationEffortRecord[];
}

async function composeCrossWaveRecords(): Promise<CrossWaveGroups> {
  const waveA = await runCanonicalLadderWaveA();
  const waveB = await runCanonicalLadderWaveB();
  const waveC = await runCanonicalLadderWaveC();
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
    waveC: waveC.runs.map((entry) => entry.run.record),
  };
}

describe("SIM-005 cross-wave through Wave C: the 3-domain law over the composed ladder", () => {
  it("the composition is the honest full record set (4 + 24 + 4 + 4 records, 16 levels, fixture class)", async () => {
    const groups = await composeCrossWaveRecords();
    const records = [...groups.waveALevels, ...groups.sim003IntegrationCases, ...groups.waveB, ...groups.waveC];
    expect(records).toHaveLength(36);
    expect(new Set(records.map((record) => record.ladderLevel))).toEqual(
      new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
    );
    expect(records.every((record) => record.evidenceClass === "fixture")).toBe(true);
    expect(records.every((record) => record.internalImports === 0)).toBe(true);
  });

  it("THE NEW TRIGGER: evidence-retrieval|COMPOSITION_GAP {12, 13, 16} reaches three domains", async () => {
    const groups = await composeCrossWaveRecords();
    const register = crossWaveRecurringGapsThroughWaveC(groups);
    const byKey = new Map(register.map((gap) => [`${gap.capability}|${gap.friction}`, gap]));

    // The Wave-B finance hit (12) meets Wave C's healthcare (13) and
    // enterprise-workflow (16) hits: the third domain ⇒ the NEW
    // platform-upgrade candidate recorded by SIM-005.
    const evidence = byKey.get("evidence-retrieval|COMPOSITION_GAP")!;
    expect(evidence).toBeDefined();
    expect(evidence.ladderLevels).toEqual([12, 13, 16]);
    expect(evidence.domainCount).toBe(3);
    expect(evidence.runCount).toBe(3);
    expect(evidence.platformUpgradeCandidate).toBe(true);

    // Exactly three candidates in the composed register — no more, no
    // less (the honest trigger list for TL3).
    expect(register.filter((gap) => gap.platformUpgradeCandidate)).toHaveLength(3);
  });

  it("the standing candidates persist and only GAIN domains (plans {5,8,9,14,16}; context {2,4,10} unchanged)", async () => {
    const groups = await composeCrossWaveRecords();
    const register = crossWaveRecurringGapsThroughWaveC(groups);
    const byKey = new Map(register.map((gap) => [`${gap.capability}|${gap.friction}`, gap]));

    // plan-management: the SIM-003/Wave-B candidate {5, 8, 9} gains the
    // education (14) and enterprise-workflow (16) domains.
    const plans = byKey.get("plan-management|COMPOSITION_GAP")!;
    expect(plans).toBeDefined();
    expect(plans.ladderLevels).toEqual([5, 8, 9, 14, 16]);
    expect(plans.domainCount).toBe(5);
    expect(plans.runCount).toBe(5);
    expect(plans.platformUpgradeCandidate).toBe(true);

    // context-snapshots: the standing Wave-B candidate, unchanged.
    const context = byKey.get("context-snapshots|API_GAP")!;
    expect(context).toBeDefined();
    expect(context.ladderLevels).toEqual([2, 4, 10]);
    expect(context.domainCount).toBe(3);
    expect(context.runCount).toBe(3);
    expect(context.platformUpgradeCandidate).toBe(true);
  });

  it("ADDITIVITY: the Waves A+B entries are unchanged by composing Wave C (the union-compatible aggregation)", async () => {
    const groups = await composeCrossWaveRecords();
    // The SIM-004 composition (Waves A+B only, no Wave C)…
    const before = crossWaveRecurringGaps({
      waveALevels: groups.waveALevels,
      sim003IntegrationCases: groups.sim003IntegrationCases,
      waveB: groups.waveB,
    });
    // …and the SIM-005 composition through Wave C.
    const after = crossWaveRecurringGapsThroughWaveC(groups);
    const beforeByKey = new Map(before.map((gap) => [`${gap.capability}|${gap.friction}`, gap]));
    const afterByKey = new Map(after.map((gap) => [`${gap.capability}|${gap.friction}`, gap]));

    // Every pre-Wave-C entry survives with its run count intact.
    expect(afterByKey.size).toBeGreaterThanOrEqual(beforeByKey.size);
    for (const [key, beforeGap] of beforeByKey) {
      const afterGap = afterByKey.get(key);
      expect(afterGap).toBeDefined();
      expect(afterGap!.runCount).toBe(beforeGap.runCount + countWaveCRunsOfGap(key, groups.waveC));
    }
    // The single-domain pre-Wave-C gaps stay single-domain (Wave C
    // declares none of them); the standing candidates only gain
    // DOMAINS, never lose or reorder their pre-Wave-C levels.
    for (const [key, beforeGap] of beforeByKey) {
      const afterGap = afterByKey.get(key)!;
      expect(afterGap.ladderLevels.slice(0, beforeGap.ladderLevels.length)).toEqual(beforeGap.ladderLevels);
      expect(afterGap.domainCount).toBeGreaterThanOrEqual(beforeGap.domainCount);
    }
    expect(beforeByKey.get("ad-memory|COMPOSITION_GAP")!.ladderLevels).toEqual([6]);
    expect(afterByKey.get("ad-memory|COMPOSITION_GAP")!.ladderLevels).toEqual([6]);
    expect(beforeByKey.get("decision-retrieval|COMPOSITION_GAP")!.ladderLevels).toEqual([7]);
    expect(afterByKey.get("decision-retrieval|COMPOSITION_GAP")!.ladderLevels).toEqual([7]);
  });

  it("the register is a deterministic pure function of the composed record set", async () => {
    const first = crossWaveRecurringGapsThroughWaveC(await composeCrossWaveRecords());
    const second = crossWaveRecurringGapsThroughWaveC(await composeCrossWaveRecords());
    expect(renderCrossWaveRecurringGapsThroughWaveCTable(first)).toBe(
      renderCrossWaveRecurringGapsThroughWaveCTable(second),
    );
  });

  it("the report's cross-wave register matches a fresh re-render byte-for-byte (the doc-drift gate)", async () => {
    const register = crossWaveRecurringGapsThroughWaveC(await composeCrossWaveRecords());
    const doc = readFileSync(SIM005_DOC, "utf8");
    const beginIndex = doc.indexOf(CROSS_WAVE_MARKERS.begin);
    const endIndex = doc.indexOf(CROSS_WAVE_MARKERS.end);
    expect(beginIndex).toBeGreaterThanOrEqual(0);
    expect(endIndex).toBeGreaterThan(beginIndex);
    const section = doc
      .slice(beginIndex + CROSS_WAVE_MARKERS.begin.length, endIndex)
      .replace(/^\r?\n/, "")
      .replace(/\r?\n$/, "");
    expect(section).toBe(renderCrossWaveRecurringGapsThroughWaveCTable(register));
  });
});

/** How many Wave C records carry the given capability|friction gap. */
function countWaveCRunsOfGap(key: string, waveC: readonly IntegrationEffortRecord[]): number {
  const [capability, friction] = key.split("|") as [string, string];
  return waveC.filter((record) =>
    record.gaps.some((gap) => gap.capability === capability && gap.friction === friction),
  ).length;
}
