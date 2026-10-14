/**
 * AD-006 — deployment-verification LOCKSTEP (the S4-002
 * `tests/deployment/verify-deployment.test.ts` precedent): the ad-lane
 * deployment verification doc (docs/deployment/ad-lane-verification.md)
 * records the PRODUCTION probes with exact commands, verbatim outputs and
 * honest limitations. This lockstep keeps that doc from drifting:
 *
 *  1. The doc exists and records the probe COMMANDS for the ad-lane
 *     routes, the frozen health surfaces and the S4-002 gate run.
 *  2. The recorded outputs are present VERBATIM (the FUNCTION_INVOCATION_FAILED
 *     observations for the API; the 200s for web/docs/marketing) — the
 *     honesty law: what was observed is what is written.
 *  3. The gate outcome is recorded as FAIL (exit 1) — a red deployment
 *     check is never hidden by a green source-level battery.
 *  4. The production URLs recorded in the doc match the repository's
 *     documented production deployments (final-release-evidence.md).
 *  5. The operator promotion checklist exists (what WOULD constitute
 *     ad-lane production proof) — the doc never ends at the failure.
 *
 * EVIDENCE CLASS: controlled-local (doc-to-source lockstep; the probes
 * themselves were production-observed on 2026-10-14 and are recorded in
 * the doc this test locks).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

const read = (relative: string): string => readFileSync(join(repoRoot, relative), "utf8");

const DEPLOYMENT_DOC = "docs/deployment/ad-lane-verification.md";
const RELEASE_EVIDENCE = "docs/handoff/final-release-evidence.md";
const RUNBOOK = "docs/deployment/runbook.md";

describe("AD-006 deployment verification doc lockstep (docs/deployment/ad-lane-verification.md)", () => {
  const doc = read(DEPLOYMENT_DOC);

  it("records the ad-lane probe commands and the frozen health probes exactly", () => {
    expect(doc).toContain("curl -sS -m 15 -w \"\\nHTTP_CODE=%{http_code}\\n\" https://reckon-api-phi.vercel.app/healthz");
    expect(doc).toContain("https://reckon-api-phi.vercel.app/readyz");
    expect(doc).toContain("POST /v1/ads/query");
    expect(doc).toContain("POST /v1/ads/forget");
    expect(doc).toContain("/v1/decisions/ad006-deploy-probe");
    // Unauthenticated probes carry a request BODY (the frozen ad request
    // shapes) — the probe is a real route probe, not a bare TCP check.
    expect(doc).toContain("reckon.ad-query-request");
    expect(doc).toContain("reckon.ad-forget-request");
  });

  it("records the observed API failure VERBATIM (what was observed is what is written)", () => {
    expect(doc).toContain("FUNCTION_INVOCATION_FAILED");
    expect(doc).toContain("HTTP_CODE=500");
    // The failure is recorded as persistent across the probe window
    // (timestamps of the first and last confirmation).
    expect(doc).toContain("06:29");
    expect(doc).toContain("06:33");
    // DNS resolves (the failure is function-invocation, not name
    // resolution) — the doc records that fact too.
    expect(doc.toLowerCase()).toContain("dns resolution is healthy");
    expect(doc).toContain("216.198.79.3");
  });

  it("records the healthy surfaces and the gate outcomes honestly", () => {
    // The three non-API surfaces: observed 200.
    expect(doc).toContain("https://reckon-web-nine.vercel.app/");
    expect(doc).toContain("https://reckon-docs.vercel.app/");
    expect(doc).toContain("https://reckon-marketing.vercel.app/");
    expect(doc).toContain("HTTP_CODE=200");
    // The S4-002 gate run is recorded with its FAIL verdict + exit code.
    expect(doc).toContain("GATE: FAIL — 3/4 surfaces verified; failed: api");
    expect(doc).toContain("(exit code 1)");
    // The S5-003 pass is recorded with its summary line.
    expect(doc).toContain("8/16 packet assertions green");
  });

  it("states the honest verdict: no production-serving claim, no fabricated evidence", () => {
    expect(doc).toContain("## 3. Verdict (honest)");
    expect(doc).toContain("The production API deployment is NOT currently serving.");
    expect(doc).toContain("No ad-lane production-serving claim is made by AD-006.");
    // The red deployment check is explicitly NOT hidden by the green
    // source-level battery (the handoff's deployment-truth law).
    expect(doc).toMatch(/does not and\s+cannot override it/);
    // The credential honesty: the sandbox holds no deployment secrets.
    expect(doc).toMatch(/no Vercel or\s+Neon credentials/);
  });

  it("carries the operator promotion checklist (what would constitute ad-lane production proof)", () => {
    expect(doc).toContain("## 4. What WOULD constitute ad-lane production proof");
    expect(doc).toContain("/readyz");
    expect(doc).toContain("wired");
    expect(doc).toContain("verify-deployment.mjs");
    expect(doc).toContain("verify-production.mjs");
    expect(doc).toContain("production-observed");
  });

  it("records the source-level battery that backs the verification (controlled-local, not production)", () => {
    expect(doc).toContain("## 5. Source-level battery backing this verification");
    expect(doc).toContain("tests/e2e/ad-lane-e2e.test.ts");
    expect(doc).toContain("controlled-local");
    // The doc never promotes the battery to production truth.
    expect(doc).toMatch(/production acceptance of the ad lane remains\s+OPEN/);
  });

  it("the production URLs match the repository's documented deployments", () => {
    const release = read(RELEASE_EVIDENCE);
    // Every URL the ad-lane doc probes is a URL the release evidence
    // documents as the production deployment.
    for (const url of [
      "https://reckon-api-phi.vercel.app",
      "https://reckon-web-nine.vercel.app",
      "https://reckon-docs.vercel.app",
      "https://reckon-marketing.vercel.app",
    ]) {
      expect(doc).toContain(url);
      expect(release).toContain(url);
    }
    // The topology table cites the runbook (documented facts, not
    // assumptions).
    expect(doc).toContain("docs/deployment/runbook.md");
    expect(read(RUNBOOK)).toContain("reckon-api-phi.vercel.app");
    // Upstash/R2 honestly recorded as not deployed (the runbook's
    // free-tier posture).
    expect(doc).toContain("Not deployed");
  });
});
