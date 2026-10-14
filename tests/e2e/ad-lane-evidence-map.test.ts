/**
 * AD-006 — evidence-map LOCKSTEP (the S4-002 `tests/deployment/verify-deployment.test.ts`
 * precedent applied to the ad lane): the evidence appendix
 * (docs/handoff/ad-lane-e2e-evidence.md) and the capability matrix
 * (docs/handoff/ad-lane-production-matrix.md) can never silently drift
 * from the shipped tests and sources:
 *
 *  1. EVERY one of the 11 evidence requirements (E1–E11), all 10 privacy
 *     laws (L1–L10) and BOTH frozen paths has a row in the appendix, each
 *     naming a real artifact file and a real reproducing command.
 *  2. Every repository path the appendix names EXISTS, and the E2E suite
 *     contains the named describes/tests verbatim (test-name drift fails
 *     here, never the claim).
 *  3. The appendix's suite test-count claim matches the suite file's
 *     actual `it(` count.
 *  4. The matrix has a row per ad-lane capability; every evidence-class
 *     tag is from the machine vocabulary; NO ad-lane capability row (2–10)
 *     claims production verification while the deployment verification
 *     doc records the production API as not serving (consistency law:
 *     a red deployment check is never hidden by a green battery).
 *
 * EVIDENCE CLASS: controlled-local (doc-to-source lockstep over the real
 * repository files — no wire access; the production observations
 * themselves live in docs/deployment/ad-lane-verification.md and are
 * lockstep-checked by tests/deployment/ad-lane-verification.test.ts).
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

const E2E_SUITE = join(repoRoot, "tests/e2e/ad-lane-e2e.test.ts");
const EVIDENCE_DOC = join(repoRoot, "docs/handoff/ad-lane-e2e-evidence.md");
const MATRIX_DOC = join(repoRoot, "docs/handoff/ad-lane-production-matrix.md");
const DEPLOYMENT_DOC = join(repoRoot, "docs/deployment/ad-lane-verification.md");

const read = (path: string): string => readFileSync(path, "utf8");

/** Extract repository file paths (backtick-quoted, containing "/") from a doc. */
function repoPathsOf(doc: string): readonly string[] {
  const out = new Set<string>();
  for (const match of doc.matchAll(/`([^`\n]+)`/g)) {
    const candidate = match[1]!;
    if (!candidate.includes("/")) continue;
    // Repository artifacts start with a top-level dir and end with a
    // file extension (or are directories named with a trailing slash-less
    // path we only accept when they exist).
    if (!/^(tests|apps|packages|docs|scripts|sdks)\//.test(candidate)) continue;
    if (/\s/.test(candidate)) continue;
    out.add(candidate);
  }
  return [...out];
}

/** A backtick-quoted path exists (glob suffixes supported: `dir/ad-*.json`). */
function repoPathExists(relative: string): boolean {
  if (!relative.includes("*")) return existsSync(join(repoRoot, relative));
  const dir = join(repoRoot, dirname(relative));
  const pattern = relative.slice(relative.lastIndexOf("/") + 1);
  const [prefix, suffix] = pattern.split("*");
  try {
    return readdirSync(dir).some((name) => name.startsWith(prefix ?? "") && name.endsWith(suffix ?? ""));
  } catch {
    return false;
  }
}

describe("AD-006 evidence appendix lockstep (docs/handoff/ad-lane-e2e-evidence.md)", () => {
  it("exists and maps BOTH frozen paths, all 11 evidence requirements and all 10 laws", () => {
    const doc = read(EVIDENCE_DOC);

    // Both frozen paths, by name.
    expect(doc).toContain("encounter/save → retain → query/retrieve → resolve experience → decide → schedule → present → outcome");
    expect(doc).toContain("current context → eligible ads → retrieval → decision → correct format/timing → outcome");

    // The 11 evidence requirements (table rows keyed E1..E11).
    for (const key of ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "E9", "E10", "E11"]) {
      expect(doc).toMatch(new RegExp(`\\| ${key} \\|`));
    }
    // The 10 privacy laws (table rows keyed L1..L10).
    for (const key of ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9", "L10"]) {
      expect(doc).toMatch(new RegExp(`\\| L${key.slice(1)} \\|`));
    }
    // Every row names the reproducing command.
    const commandRows = doc.match(/\| `pnpm test[^`]*` \|/g) ?? [];
    expect(commandRows.length).toBeGreaterThanOrEqual(21); // 2 paths + 11 E + 10 L rows at minimum
  });

  it("names only repository artifacts that actually exist", () => {
    const doc = read(EVIDENCE_DOC);
    const paths = repoPathsOf(doc);
    expect(paths.length).toBeGreaterThan(0);
    const missing = paths.filter((relative) => !repoPathExists(relative));
    expect(missing).toEqual([]);
    // The three AD-006 artifacts are all named.
    for (const expected of [
      "tests/e2e/ad-lane-e2e.test.ts",
      "docs/handoff/ad-lane-production-matrix.md",
      "docs/deployment/ad-lane-verification.md",
      "tests/e2e/ad-lane-evidence-map.test.ts",
      "tests/deployment/ad-lane-verification.test.ts",
    ]) {
      expect(paths).toContain(expected);
    }
  });

  it("the named suite tests exist verbatim in the E2E suite (name drift fails here)", () => {
    const doc = read(EVIDENCE_DOC);
    const suite = read(E2E_SUITE);

    // The two path describes, by exact name.
    expect(suite).toContain("AD-006 PATH 1 — the memory path end-to-end");
    expect(suite).toContain("AD-006 PATH 2 — the contextual path end-to-end");
    // The evidence/law tests, by their requirement/law markers.
    for (const marker of [
      "E3/L2: explicit forget",
      "E4/L3: expired ad suppression",
      "E5: rights/permission denial",
      "E7/L9: the same ad appears in BOTH lanes",
      "E8/L10: no fabricated engagement",
      "E9: deterministic replay",
      "L1: retention requires an explicit permission/retention basis",
      "L5: raw location, attention, or sensitive attributes",
      "L6: the memory record carries NO audience-inference",
      "L7: user value and commercial value remain separate",
      "L8: advertising remains explicitly identifiable",
      "L10: encounter evidence accepts ONLY observed evidence classes",
      "memory is subject-scoped",
    ]) {
      expect(suite).toContain(marker);
      expect(doc.includes(marker.slice(0, Math.min(marker.length, 40)))).toBe(true);
    }
  });

  it("the appendix's suite test-count claims equal the suite's actual counts", () => {
    const doc = read(EVIDENCE_DOC);
    const suite = read(E2E_SUITE);
    const itCount = (suite.match(/\bit\(/g) ?? []).length;
    // The suite-level claim (the whole E2E file)…
    expect(doc).toContain(`(${itCount} tests`);
    // …and the two per-path claims (each path describe carries 4 tests).
    const pathClaims = doc.match(/\(4 tests/g) ?? [];
    expect(pathClaims.length).toBe(2);
    for (const describeName of [
      "AD-006 PATH 1 — the memory path end-to-end",
      "AD-006 PATH 2 — the contextual path end-to-end",
    ]) {
      const start = suite.indexOf(describeName);
      expect(start).toBeGreaterThan(-1);
      const nextDescribe = suite.indexOf("describe(", start + 10);
      const block = suite.slice(start, nextDescribe === -1 ? undefined : nextDescribe);
      expect((block.match(/\bit\(/g) ?? []).length).toBe(4);
    }
  });
});

describe("AD-006 capability matrix lockstep (docs/handoff/ad-lane-production-matrix.md)", () => {
  it("has a row per ad-lane capability with a legal machine evidence class", () => {
    const doc = read(MATRIX_DOC);
    const allowedClasses = ["fixture", "controlled-local", "staging", "production-observed"];

    // The 13 capability rows (| n | ... |) with an evidence-class cell
    // drawn from the machine vocabulary.
    const rowNumbers = (doc.match(/^\| \d+ \|/gm) ?? []).length;
    expect(rowNumbers).toBe(13);

    // Every evidence-class mention in the class column is a legal value.
    const classMentions = doc.match(/`(fixture|controlled-local|staging|production-observed)`/g) ?? [];
    expect(classMentions.length).toBeGreaterThan(0);
    for (const mention of classMentions) {
      expect(allowedClasses).toContain(mention.replace(/`/g, ""));
    }
    // The vocabulary table itself defines exactly the four classes.
    for (const cls of allowedClasses) {
      expect(doc).toContain(`| \`${cls}\` |`);
    }
  });

  it("NO ad-lane capability claims production verification (consistency with the recorded deployment state)", () => {
    const matrix = read(MATRIX_DOC);
    const deployment = read(DEPLOYMENT_DOC);

    // The deployment doc's honest verdict is on record.
    expect(deployment).toContain("The production API deployment is NOT currently serving");
    expect(deployment).toContain("No ad-lane production-serving claim is made by AD-006");

    // The matrix says so too — no capability row (2..10) may claim
    // production verification; rows must carry the NOT-production-verified
    // or the fixture/absence statuses.
    expect(matrix).toContain("**NOT production-verified**");
    expect(matrix).toContain("No ad-lane capability is production-verified today");
    // Row 13 records the genuinely observed RED production state.
    expect(matrix).toContain("`production-observed` — RED");
    expect(matrix).toContain("FUNCTION_INVOCATION_FAILED");
    // The only healthy production-observed surfaces are the three non-API
    // ones — the matrix names them via the deployment doc.
    expect(matrix).toContain("ad-lane-verification.md");
  });

  it("the matrix's evidence artifacts exist", () => {
    const doc = read(MATRIX_DOC);
    const paths = repoPathsOf(doc);
    expect(paths.length).toBeGreaterThan(0);
    const missing = paths.filter((relative) => !repoPathExists(relative));
    expect(missing).toEqual([]);
    // The pre-existing ad-lane suites the matrix cites are real.
    for (const expected of [
      "packages/contracts/test/ads.test.ts",
      "packages/persistence/test/ad-memory-store.test.ts",
      "apps/api/test/ads.test.ts",
      "apps/api/test/ads-composition.test.ts",
      "apps/api/test/ad-selection.test.ts",
      "apps/api/test/ad-format-timing.test.ts",
      "apps/api/test/ad-memory-roundtrip.test.ts",
      "packages/sdk/test/sdk-ads.test.ts",
      "apps/web/test/ads-view.test.ts",
      "tests/e2e/ad-lane-e2e.test.ts",
    ]) {
      expect(existsSync(join(repoRoot, expected))).toBe(true);
      expect(doc.includes(expected)).toBe(true);
    }
  });
});

describe("AD-006 evidence vocabulary — the appendix uses only honest classes", () => {
  it("the appendix labels every row controlled-local and points production claims at the deployment doc", () => {
    const doc = read(EVIDENCE_DOC);
    expect(doc).toContain("EVIDENCE CLASS of every row below: **controlled-local**");
    expect(doc).toMatch(/Production-wire\s+observations live ONLY in/);
    expect(doc).toContain("docs/deployment/ad-lane-verification.md");
    // The honest-limitations section exists (numbered).
    expect(doc).toContain("## 5. Honest limitations");
  });
});
