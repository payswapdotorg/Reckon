/**
 * SIM-001 — the ZERO-INTERNAL-ACCESS proof + the determinism token scan.
 *
 * The Reckon-Complete definition (ladder doc):
 *   "…with zero internal-package imports and no domain logic added to
 *    the Reckon kernel."
 *
 * This suite enforces it MECHANICALLY over the harness surface:
 *
 * 1. Every import specifier in `packages/simulation/src/**` (the harness
 *    + the W1 simulator) and `tests/conformance/fixtures/**` (the
 *    synthetic hosts) is scanned. ALLOWED:
 *      - `@reckon/contracts`, `@reckon/sdk` (the public surfaces)
 *      - `zod` / `zod/v4` (type-level only), `vitest`, `node:*` builtins
 *      - relative imports that resolve INSIDE packages/simulation,
 *        or into packages/contracts/src or packages/sdk/src (public
 *        sources — the established tests/ pattern)
 *    FORBIDDEN: any other `@reckon/*` package, any deep import into an
 *    internal package (decision/context/events/features/integrations/
 *    learning/observability/organization/persistence/preferences/
 *    scheduler/experience/agents), anything under apps/.
 *
 * 2. DETERMINISM LAW: no `Date.now`, `Math.random`, `new Date`, wall-
 *    clock or hrtime reads in harness paths (`packages/simulation/src/
 *    harness/**` + the conformance fixtures) — time/randomness must be
 *    injected (SimClock / seeded RNG).
 *
 * A missing capability on the public surface is recorded as an API_GAP /
 * PLATFORM_UPGRADE_CANDIDATE finding — never hacked around with an
 * internal import (see docs/simulations/reckon-complete-profile.md).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const SIMULATION_SRC = resolve(REPO_ROOT, "packages/simulation/src");
const HARNESS_SRC = resolve(REPO_ROOT, "packages/simulation/src/harness");
const CONFORMANCE_FIXTURES = resolve(__dirname, "fixtures");

/** Recursively list .ts files (skipping node_modules/dist). */
function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Extract every static + dynamic import specifier from a source file. */
function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const fromRe = /\bfrom\s*["']([^"']+)["']/g;
  const dynamicRe = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  const sideEffectRe = /^\s*import\s*["']([^"']+)["']/gm;
  for (const re of [fromRe, dynamicRe, sideEffectRe]) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      specifiers.push(match[1]!);
    }
  }
  return specifiers;
}

/** The frozen import policy for harness + fixture surfaces. */
const ALLOWED_BARE = new Set([
  "@reckon/contracts",
  "@reckon/sdk",
  "zod",
  "zod/v4",
  "vitest",
]);

function classifySpecifier(
  specifier: string,
  fromFile: string,
): { ok: true } | { ok: false; reason: string } {
  if (specifier.startsWith("node:")) return { ok: true };
  if (specifier.startsWith("@reckon/")) {
    if (ALLOWED_BARE.has(specifier)) return { ok: true };
    return {
      ok: false,
      reason: `internal workspace package import "${specifier}" — the harness may import ONLY @reckon/contracts and @reckon/sdk`,
    };
  }
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const resolved = specifier.startsWith("/")
      ? resolve(REPO_ROOT, `.${specifier}`)
      : resolve(dirname(fromFile), specifier);
    const rel = relative(REPO_ROOT, resolved);
    if (rel.startsWith("packages/simulation/")) return { ok: true };
    if (rel.startsWith("packages/contracts/src/")) return { ok: true };
    if (rel.startsWith("packages/sdk/src/")) return { ok: true };
    return {
      ok: false,
      reason: `relative import "${specifier}" resolves outside the allowed surfaces (to ${rel}) — deep/internal package access is forbidden`,
    };
  }
  if (ALLOWED_BARE.has(specifier)) return { ok: true };
  return {
    ok: false,
    reason: `non-allowlisted dependency "${specifier}" — the harness surface is contracts+SDK only`,
  };
}

describe("zero-internal-access proof (SIM-001 law)", () => {
  const scannedRoots = [SIMULATION_SRC, CONFORMANCE_FIXTURES];

  it("scans a non-empty surface", () => {
    const files = scannedRoots.flatMap((root) => listTsFiles(root));
    expect(files.length).toBeGreaterThan(10);
  });

  it("every import in packages/simulation/src + conformance fixtures is public-surface only", () => {
    const violations: string[] = [];
    let importCount = 0;
    for (const root of scannedRoots) {
      for (const file of listTsFiles(root)) {
        const source = readFileSync(file, "utf8");
        for (const specifier of importSpecifiers(source)) {
          importCount += 1;
          const verdict = classifySpecifier(specifier, file);
          if (!verdict.ok) {
            violations.push(`${relative(REPO_ROOT, file)}: ${verdict.reason}`);
          }
        }
      }
    }
    expect(importCount).toBeGreaterThan(20);
    if (violations.length > 0) {
      throw new Error(
        `ZERO-INTERNAL-ACCESS VIOLATIONS (${violations.length}):\n${violations.join("\n")}`,
      );
    }
  });

  it("no internal kernel package name even APPEARS in an import of the harness surface", () => {
    const internalPackages = [
      "@reckon/decision",
      "@reckon/context",
      "@reckon/events",
      "@reckon/features",
      "@reckon/integrations",
      "@reckon/learning",
      "@reckon/observability",
      "@reckon/organization",
      "@reckon/persistence",
      "@reckon/preferences",
      "@reckon/scheduler",
      "@reckon/experience",
      "@reckon/agents",
    ];
    const offenders: string[] = [];
    for (const root of scannedRoots) {
      for (const file of listTsFiles(root)) {
        const source = readFileSync(file, "utf8");
        for (const specifier of importSpecifiers(source)) {
          if (internalPackages.includes(specifier)) {
            offenders.push(`${relative(REPO_ROOT, file)} imports ${specifier}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("determinism token scan (SIM-001 law)", () => {
  const WALL_CLOCK_TOKENS: Array<[RegExp, string]> = [
    [/Date\.now\(/, "Date.now("],
    [/Math\.random\(/, "Math.random("],
    [/\bnew\s+Date\(/, "new Date("],
    [/performance\.now\(/, "performance.now("],
    [/process\.hrtime/, "process.hrtime"],
  ];

  const harnessFiles = [...listTsFiles(HARNESS_SRC), ...listTsFiles(CONFORMANCE_FIXTURES)];

  it("scans the harness + fixture files", () => {
    expect(harnessFiles.length).toBeGreaterThanOrEqual(10);
  });

  it("no wall-clock or unseeded randomness in harness paths", () => {
    const offenders: string[] = [];
    for (const file of harnessFiles) {
      const source = readFileSync(file, "utf8");
      for (const [re, label] of WALL_CLOCK_TOKENS) {
        if (re.test(source)) {
          offenders.push(`${relative(REPO_ROOT, file)} contains ${label}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the harness explicitly injects clock + seed (the positive proof)", () => {
    const driverSource = readFileSync(join(HARNESS_SRC, "driver.ts"), "utf8");
    expect(driverSource).toContain("createSimClock");
    expect(driverSource).toContain("createRng");
    expect(driverSource).toContain("normalizeSeed");
    const responderSource = readFileSync(join(HARNESS_SRC, "responder.ts"), "utf8");
    // The deterministic SDK id generator replaces crypto.randomUUID.
    expect(responderSource).toContain("createDeterministicIdGenerator");
  });
});
