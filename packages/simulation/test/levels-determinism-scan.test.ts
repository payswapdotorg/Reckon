/**
 * SIM-002 — the determinism token scan for the levels module.
 *
 * tests/conformance/zero-internal-access.test.ts (SIM-001, off-surface
 * for W1) mechanically scans harness/** + conformance fixtures for
 * wall-clock/unseeded-randomness tokens. The SIM-002 level hosts live
 * in packages/simulation/src/levels/** — INSIDE the W1 surface but
 * OUTSIDE that scan's roots. This suite closes the gap from within the
 * package: the same token laws, applied to src/levels/**, so the level
 * hosts are mechanically proven to obey the no-wall-clock / no-Math.random
 * law (in addition to the byte-identity proofs in levels.test.ts).
 *
 * Also proves the positive side: the levels module declares its glue
 * adapter markers (the honest-glue recount anchors).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const LEVELS_SRC = dirname(fileURLToPath(import.meta.url)).replace("/test", "/src/levels");

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

const WALL_CLOCK_TOKENS: Array<[RegExp, string]> = [
  [/Date\.now\(/, "Date.now("],
  [/Math\.random\(/, "Math.random("],
  [/\bnew\s+Date\(/, "new Date("],
  [/performance\.now\(/, "performance.now("],
  [/process\.hrtime/, "process.hrtime"],
  [/crypto\.randomUUID\(/, "crypto.randomUUID("],
];

describe("SIM-002 levels determinism token scan (W1 law, package-local)", () => {
  const files = listTsFiles(LEVELS_SRC);

  it("scans the non-empty levels module surface", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it("no wall-clock or unseeded randomness tokens in any level module", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const [re, label] of WALL_CLOCK_TOKENS) {
        if (re.test(source)) offenders.push(`${file} contains ${label}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every level host module carries the honest-glue adapter markers", () => {
    const levelModules = files.filter((file) => /level-\d/.test(file));
    expect(levelModules).toHaveLength(4);
    for (const file of levelModules) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("// --- glue:adapter:begin");
      expect(source).toContain("// --- glue:adapter:end");
    }
  });
});
