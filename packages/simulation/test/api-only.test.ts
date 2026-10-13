/**
 * SIM-004 — the API-only measurement acceptance suite (W3 lane, Wave B
 * mandate: "W3 validates the public API/SDK across representative
 * levels").
 *
 * The scenarios live in tests/conformance/fixtures/api-only/level9-12.ts
 * (the conformance-fixtures home — the SIM-001 zero-internal-access
 * scanner mechanically enforces that the fixture imports ONLY the
 * public surface). This battery proves, through the REAL `@reckon/sdk`
 * client over the scripted fixture responder:
 *
 * 1. REQUEST/RESPONSE BEHAVIOR: every successful call is a full contract
 *    round-trip (the SDK validates the request against the frozen zod
 *    contract before sending, the response after receiving); the call
 *    log carries exactly the six standard-loop public operations.
 * 2. FAILURE/RETRY CLASSIFICATION: contract-invalid requests fail
 *    TERMINALLY (SDK_REQUEST_INVALID, attempts 1 — never retried) while
 *    the run continues honestly; seeded transport-fault storms are
 *    transient (bounded classified retries, zero exhaustion).
 * 3. CAPABILITY COVERAGE: the manifest × profile verdict per scenario,
 *    with the same honest partials the adapter-side wave measured.
 * 4. MEASUREMENT FIELDS: glue, timing, p50/p95 over successful calls
 *    only, evidence class `fixture`, internalImports 0.
 * 5. DETERMINISM + THE REPLAY GATE: same config ⇒ byte-identical
 *    records; replayApiOnlyScenario reproduces the byte-identical
 *    record; harness-version drift is a typed mismatch error.
 * 6. GLUE HONESTY: the fixture's declared glue equals a mechanical
 *    recount of its scenario sections (marker-delimited, comment-
 *    stripped, non-blank).
 * 7. THE SDK SURFACE PROBES: the beyond-surface public SDK methods
 *    exist and validate requests both ways, but the composed fixture
 *    path has no route (NOT_FOUND, terminal) — the honest COMPOSITION_
 *    GAP reading from the API-only side.
 * 8. EVIDENCE HONESTY: a production-observed evidence floor is honestly
 *    unmet (OBSERVABILITY_GAP) — fixture runs never masquerade.
 * 9. THE DOC-DRIFT GATE: the report's machine-generated API-only
 *    tables match a fresh re-render byte-for-byte.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  runApiOnlyScenario,
  replayApiOnlyScenario,
  runApiOnlySuite,
  probePublicSdkSurface,
  renderApiOnlyMarkdownTable,
  renderSdkSurfaceProbesTable,
  ApiOnlyReplayMismatchError,
  API_ONLY_HARNESS_VERSION,
  type ApiOnlyScenario,
  type ApiOnlyRunResult,
} from "../src/index.js";
import {
  API_ONLY_LEVEL_ENTRIES,
  API_ONLY_TERMINAL_PROBE_ENTRY,
  API_ONLY_RESILIENCE_ENTRIES,
} from "../../../tests/conformance/fixtures/api-only/level9-12.js";
import {
  IntegrationEffortRecordSchema,
  ReckonCompleteEnvelopeSchema,
  canonicalJson,
} from "@reckon/contracts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const SIM004_DOC = join(REPO_ROOT, "docs/simulations/sim-004-levels-9-12.md");
const API_ONLY_FIXTURE = join(
  REPO_ROOT,
  "tests/conformance/fixtures/api-only/level9-12.ts",
);

const SIM004_DOC_MARKERS = {
  apiOnlyBegin:
    "<!-- sim-004:api-only:evidence:begin (machine-generated — regenerate via @reckon/simulation runApiOnlySuite over API_ONLY_LEVEL_ENTRIES) -->",
  apiOnlyEnd: "<!-- sim-004:api-only:evidence:end -->",
  probesBegin: "<!-- sim-004:api-only:probes:begin (machine-generated) -->",
  probesEnd: "<!-- sim-004:api-only:probes:end -->",
} as const;

function docSection(doc: string, begin: string, end: string): string {
  const beginIndex = doc.indexOf(begin);
  const endIndex = doc.indexOf(end);
  if (beginIndex < 0 || endIndex < 0 || endIndex < beginIndex) {
    throw new Error("doc-drift markers missing in docs/simulations/sim-004-levels-9-12.md");
  }
  return doc.slice(beginIndex + begin.length, endIndex).replace(/^\r?\n/, "").replace(/\r?\n$/, "");
}

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

// ---------------------------------------------------------------------------
// Glue recount machinery (the fixture's documented counting method)
// ---------------------------------------------------------------------------

function stripComments(text: string): string {
  let out = "";
  let inLineComment = false;
  let inBlockComment = false;
  let inString: string | null = null;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    const next = i + 1 < text.length ? text[i + 1]! : null;
    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out += ch;
      }
      i += 1;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      if (ch === "\n") out += ch;
      i += 1;
      continue;
    }
    if (inString !== null) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function countNonBlankLines(text: string): number {
  return text.split("\n").filter((line) => line.trim().length > 0).length;
}

/** The fixture's documented glue counting method, mechanized. */
function apiOnlyGlueRecount(scenarioId: string): {
  loc: number;
  customAdapterLoc: number;
  functions: number;
} {
  const source = readFileSync(API_ONLY_FIXTURE, "utf8");
  const begin = source.indexOf(`// ===== api-only scenario: ${scenarioId} `);
  const end = source.indexOf(`// ===== end api-only scenario: ${scenarioId} `);
  if (begin < 0 || end < 0 || end < begin) {
    throw new Error(`scenario section markers missing for ${scenarioId}`);
  }
  const section = source.slice(begin, end);
  const stripped = stripComments(section);
  const loc = countNonBlankLines(stripped);
  const adapterBegin = section.indexOf("// ~ adapter-map:begin");
  const adapterEnd = section.indexOf("// ~ adapter-map:end");
  const customAdapterLoc =
    adapterBegin >= 0 && adapterEnd > adapterBegin
      ? countNonBlankLines(stripComments(section.slice(adapterBegin, adapterEnd)))
      : 0;
  // camelCase named builder functions: function declarations plus
  // const-arrow builders (SCREAMING_SNAKE constants are domain data).
  const functionDecls = stripped.match(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+[a-z][A-Za-z0-9_]*/g) ?? [];
  const arrowBuilders = stripped.match(/(?:^|\n)\s*const\s+[a-z][A-Za-z0-9_]*\s*=\s*(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>/g) ?? [];
  return { loc, customAdapterLoc, functions: functionDecls.length + arrowBuilders.length };
}

// ---------------------------------------------------------------------------
// The battery
// ---------------------------------------------------------------------------

async function runEntry(entry: { readonly config: { readonly seed: string }; readonly scenario: ApiOnlyScenario }): Promise<ApiOnlyRunResult> {
  return runApiOnlyScenario(entry.config, entry.scenario);
}

describe("SIM-004 API-only: the four representative level scenarios (request/response behavior)", () => {
  const EXPECTED = [
    { level: 9, scenarioId: "l9-food-dispatch", gaps: ["plan-management|COMPOSITION_GAP"], complete: false },
    { level: 10, scenarioId: "l10-spatial-dispatch", gaps: ["context-snapshots|API_GAP"], complete: false },
    { level: 11, scenarioId: "l11-feed-page", gaps: [] as string[], complete: true },
    { level: 12, scenarioId: "l12-offer-audit", gaps: ["evidence-retrieval|COMPOSITION_GAP"], complete: false },
  ] as const;

  for (let i = 0; i < API_ONLY_LEVEL_ENTRIES.length; i += 1) {
    const entry = API_ONLY_LEVEL_ENTRIES[i]!;
    const expected = EXPECTED[i]!;
    const scenario = entry.scenario;

    it(`scenario ${expected.scenarioId} (level ${expected.level}): every record is a frozen family member with honest fields`, async () => {
      const result = await runEntry(entry);
      const record = result.record;
      expect(IntegrationEffortRecordSchema.parse(record)).toEqual(record);
      expect(ReckonCompleteEnvelopeSchema.parse(record).schema).toBe(
        "reckon.complete.integration-effort-record",
      );
      expect(record.ladderLevel).toBe(expected.level);
      expect(record.evidenceClass).toBe("fixture");
      expect(record.internalImports).toBe(0);
      expect(record.harnessVersion).toBe(API_ONLY_HARNESS_VERSION);
      // API-only surface: the SAME six public operations as the
      // adapter-side harness — the host IS the script.
      expect(record.apiOperations).toEqual(STANDARD_OPERATIONS);
      expect(record.sdkMethods).toEqual(STANDARD_SDK_METHODS);
    });

    it(`scenario ${expected.scenarioId}: contract round-trips = successful calls; p50/p95 sample them`, async () => {
      const result = await runEntry(entry);
      const successful = result.calls.filter((call) => call.status === "ok");
      expect(result.contractRoundTrips).toBe(successful.length);
      expect(result.record.latency.samples).toBe(successful.length);
      expect(result.record.latency.p50Ms).toBeLessThanOrEqual(result.record.latency.p95Ms);
      // Zero faults in the canonical battery: zero failures, zero retries.
      expect(result.record.failures.count).toBe(0);
      expect(result.record.failures.retryCount).toBe(0);
      expect(result.clientValidationFailures).toBe(0);
    });

    it(`scenario ${expected.scenarioId}: first decision and full loop both land at step 1 (immediate presentation)`, async () => {
      const result = await runEntry(entry);
      expect(result.record.timing.firstDecisionSteps).toBe(1);
      expect(result.record.timing.fullLoopSteps).toBe(1);
      expect(result.record.timing.firstDecisionMs).toBeGreaterThan(0);
      expect(result.record.timing.fullLoopMs).toBeGreaterThanOrEqual(result.record.timing.firstDecisionMs);
    });

    it(`scenario ${expected.scenarioId}: the capability verdict matches the honest expectation`, async () => {
      const result = await runEntry(entry);
      expect(result.verdict.gaps.map((gap) => `${gap.capability}|${gap.friction}`).sort()).toEqual(
        [...expected.gaps].sort(),
      );
      expect(result.reckonComplete).toBe(expected.complete);
      expect(result.verdict.reckonComplete).toBe(expected.complete);
    });

    it(`scenario ${expected.scenarioId}: glue is declared honestly (mechanical recount of the section)`, async () => {
      const result = await runEntry(entry);
      const recount = apiOnlyGlueRecount(scenario.scenarioId);
      expect(result.record.glue.loc).toBe(recount.loc);
      expect(result.record.glue.customAdapterLoc).toBe(recount.customAdapterLoc);
      expect(result.record.glue.functions).toBe(recount.functions);
    });

    it(`scenario ${expected.scenarioId}: same config ⇒ byte-identical record (determinism)`, async () => {
      const first = await runEntry(entry);
      const second = await runEntry(entry);
      expect(canonicalJson(first.record)).toBe(canonicalJson(second.record));
      expect(canonicalJson(first.calls)).toBe(canonicalJson(second.calls));
      expect(canonicalJson(first.steps)).toBe(canonicalJson(second.steps));
    });

    it(`scenario ${expected.scenarioId}: replayApiOnlyScenario reproduces the byte-identical record (the replay gate)`, async () => {
      const original = await runEntry(entry);
      const replayed = await replayApiOnlyScenario(original.replayInputs, { scenario });
      expect(canonicalJson(replayed.record)).toBe(canonicalJson(original.record));
      expect(replayed.reckonComplete).toBe(original.reckonComplete);
    });

    it(`scenario ${expected.scenarioId}: a different seed ⇒ different run, same manifest and coverage`, async () => {
      const first = await runEntry(entry);
      const second = await runApiOnlyScenario(
        { seed: "8800" + String(expected.level) },
        scenario,
      );
      expect(canonicalJson(second.record)).not.toBe(canonicalJson(first.record));
      expect(second.record.capabilityCoverage).toEqual(first.record.capabilityCoverage);
      expect(second.manifest.checksum).toBe(first.manifest.checksum);
    });
  }
});

describe("SIM-004 API-only: failure/retry classification", () => {
  it("contract-invalid requests fail TERMINALLY (never retried) and the run continues honestly", async () => {
    const result = await runApiOnlyScenario(
      API_ONLY_TERMINAL_PROBE_ENTRY.config,
      API_ONLY_TERMINAL_PROBE_ENTRY.scenario,
    );
    // Step 3 carries the empty candidate set: both the candidates call
    // and the decision call fail CLIENT-SIDE contract validation.
    expect(result.clientValidationFailures).toBe(2);
    expect(result.record.failures.count).toBe(2);
    expect(result.record.failures.retriedCount).toBe(0);
    expect(result.record.failures.retryCount).toBe(0);
    // Terminal = attempts 1 (the frozen retryable set excludes
    // SDK_REQUEST_INVALID — a deterministic bad request must not retry).
    const failed = result.calls.filter((call) => call.status === "error");
    expect(failed).toHaveLength(2);
    for (const call of failed) {
      expect(call.errorCode).toBe("SDK_REQUEST_INVALID");
      expect(call.attempts).toBe(1);
    }
    // The run continues: steps 1, 2 and 4 complete; only step 3 records
    // the terminal error.
    expect(result.steps.map((step) => step.terminalError)).toEqual([
      undefined,
      undefined,
      "SDK_REQUEST_INVALID",
      undefined,
    ]);
    expect(result.steps[0]!.decisionOk).toBe(true);
    expect(result.steps[3]!.decisionOk).toBe(true);
    expect(result.steps[2]!.decisionOk).toBe(false);
  });

  it("seeded transport-fault storms are transient: bounded classified retries, zero exhaustion", async () => {
    for (const entry of API_ONLY_RESILIENCE_ENTRIES) {
      const result = await runApiOnlyScenario(entry.config, entry.scenario);
      expect(result.record.failures.count).toBeGreaterThan(0);
      expect(result.record.failures.retryCount).toBeGreaterThanOrEqual(result.record.failures.count);
      expect(result.record.failures.exhaustedCount).toBe(0);
      // Every recovered call retried within the configured bound.
      for (const call of result.calls) {
        expect(call.attempts).toBeLessThanOrEqual(entry.config.maxRetries + 1);
      }
      // p50/p95 still come from successful calls only.
      expect(result.record.latency.samples).toBe(
        result.calls.filter((call) => call.status === "ok").length,
      );
    }
  });

  it("resilience runs reproduce byte-identically (faults are seeded draws)", async () => {
    for (const entry of API_ONLY_RESILIENCE_ENTRIES) {
      const first = await runApiOnlyScenario(entry.config, entry.scenario);
      const second = await runApiOnlyScenario(entry.config, entry.scenario);
      expect(canonicalJson(first.record)).toBe(canonicalJson(second.record));
      expect(canonicalJson(first.calls)).toBe(canonicalJson(second.calls));
    }
  });

  it("the replay gate rejects harness-version drift with the typed error", async () => {
    const original = await runApiOnlyScenario(
      API_ONLY_LEVEL_ENTRIES[0]!.config,
      API_ONLY_LEVEL_ENTRIES[0]!.scenario,
    );
    const tampered = { ...original.replayInputs, harnessVersion: "sim-004-api-only-0.0.0-drifted" };
    await expect(
      replayApiOnlyScenario(tampered, { scenario: API_ONLY_LEVEL_ENTRIES[0]!.scenario }),
    ).rejects.toBeInstanceOf(ApiOnlyReplayMismatchError);
  });
});

describe("SIM-004 API-only: the public-SDK surface probes (beyond the composed path)", () => {
  it("the three beyond-surface SDK methods exist, validate requests, and report the composed-path gap honestly", async () => {
    const probes = await probePublicSdkSurface();
    expect(probes).toHaveLength(3);
    expect(probes.map((probe) => probe.sdkMethod).sort()).toEqual([
      "ads.query",
      "decisions.get",
      "plans.create",
    ]);
    for (const probe of probes) {
      // The SDK seam EXISTS: the request body passed client-side
      // contract validation (requestBuilt) and the call came back with
      // a TYPED error code (NOT_FOUND — the fixture port has no route).
      expect(probe.requestBuilt).toBe(true);
      expect(probe.outcome).toBe("NOT_FOUND");
      expect(probe.classification).toBe("terminal");
      expect(probe.note).toContain("COMPOSITION_GAP");
    }
  });

  it("the probe table is a deterministic pure function of the probes", async () => {
    const first = await probePublicSdkSurface();
    const second = await probePublicSdkSurface();
    expect(renderSdkSurfaceProbesTable(first)).toBe(renderSdkSurfaceProbesTable(second));
    expect(renderSdkSurfaceProbesTable(first).split("\n").slice(2)).toHaveLength(3);
  });
});

describe("SIM-004 API-only: suite aggregation, evidence honesty, and the doc-drift gate", () => {
  it("runApiOnlySuite seals the four canonical records into one scorecard", async () => {
    const suite = await runApiOnlySuite(
      API_ONLY_LEVEL_ENTRIES.map((entry) => ({ config: entry.config, scenario: entry.scenario })),
      { scorecardId: "scorecard-sim-004-api-only" },
    );
    expect(suite.records).toHaveLength(4);
    expect(suite.scorecard.schema).toBe("reckon.complete.integration-effort-scorecard");
    expect(suite.scorecard.aggregate.runCount).toBe(4);
    expect(suite.scorecard.aggregate.distinctHosts).toBe(4);
    expect(suite.scorecard.aggregate.distinctLevels).toBe(4);
    // Every record in the sealed aggregate is fixture-class evidence.
    expect(suite.records.every((record) => record.evidenceClass === "fixture")).toBe(true);
    // The evidence table is a deterministic pure function of the runs.
    const rerendered = await runApiOnlySuite(
      API_ONLY_LEVEL_ENTRIES.map((entry) => ({ config: entry.config, scenario: entry.scenario })),
      { scorecardId: "scorecard-sim-004-api-only" },
    );
    expect(renderApiOnlyMarkdownTable(suite.runs)).toBe(renderApiOnlyMarkdownTable(rerendered.runs));
  });

  it("fixture evidence never satisfies a production-observed profile floor (the API-only driver too)", async () => {
    const scenario = API_ONLY_LEVEL_ENTRIES[2]!.scenario; // the complete one
    const strictScenario: ApiOnlyScenario = {
      ...scenario,
      profile: {
        ...scenario.profile,
        profileId: "profile-api-l11-strict-probe",
        requiredEvidenceClass: "production-observed",
      },
    };
    const result = await runApiOnlyScenario({ seed: "3111" }, strictScenario);
    expect(result.verdict.reckonComplete).toBe(false);
    expect(result.verdict.evidenceSufficient).toBe(false);
    expect(result.verdict.gaps.every((gap) => gap.friction === "OBSERVABILITY_GAP")).toBe(true);
    expect(result.reckonComplete).toBe(false);
  });

  it("the report's machine-generated API-only sections match a fresh re-render byte-for-byte", async () => {
    const doc = readFileSync(SIM004_DOC, "utf8");
    expect(docSection(doc, SIM004_DOC_MARKERS.apiOnlyBegin, SIM004_DOC_MARKERS.apiOnlyEnd)).toBe(
      renderApiOnlyMarkdownTable(
        (await runApiOnlySuite(
          API_ONLY_LEVEL_ENTRIES.map((entry) => ({ config: entry.config, scenario: entry.scenario })),
          { scorecardId: "scorecard-sim-004-api-only" },
        )).runs,
      ),
    );
    expect(docSection(doc, SIM004_DOC_MARKERS.probesBegin, SIM004_DOC_MARKERS.probesEnd)).toBe(
      renderSdkSurfaceProbesTable(await probePublicSdkSurface()),
    );
  });
});
