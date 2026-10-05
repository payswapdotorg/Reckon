#!/usr/bin/env node
/**
 * S4-002 — deployment verification gate (the release gate).
 *
 * The Lead runs this AFTER deploying the four stripe-phase surfaces
 * (see docs/deployment/stripe-phase-release.md for the four-project
 * setup). It probes each deployed surface over the public wire and
 * exits 0 ONLY when all four pass — that exit-0 is the recorded
 * release-gate evidence (final-release-evidence.md §re-run commands).
 *
 * Surfaces and probes (frozen contracts, evidence class: observed):
 *
 *   RECKON_API_URL (apps/api — esbuild function + vercel.json rewrites)
 *     1. GET /healthz → HTTP 200 + {ok:true, version, contractsVersion}
 *        (the frozen liveness envelope, routes/health.ts).
 *     2. GET /v1/decisions/vd-gate-probe with NO Authorization header →
 *        HTTP 401 + typed envelope {error:{code:"UNAUTHENTICATED",
 *        class:"authentication_error"}} — a registered frozen route
 *        (routes/decisions.ts GET /v1/decisions/:decisionId) answering
 *        through the documented auth order (shared.ts: 401 authenticate
 *        first). Proves the frozen route surface + the auth pipeline +
 *        the typed error envelope in one probe.
 *
 *   RECKON_WEB_URL       GET / → HTTP 200 + marker "Reckon Studio"
 *                        (apps/web/src/components/shell/site-header.tsx)
 *   RECKON_DOCS_URL      GET / → HTTP 200 + marker "Reckon documentation"
 *                        (apps/docs/src/app/page.tsx hero eyebrow)
 *   RECKON_MARKETING_URL GET / → HTTP 200 + marker "Recommendation infrastructure"
 *                        (apps/marketing/src/lib/marketing-content.ts hero headline)
 *
 * The three markers are lockstep-checked against the shipped sources by
 * tests/deployment/verify-deployment.test.ts — marker drift fails the
 * battery, never the gate.
 *
 * NODE STDLIB ONLY (no dependencies): global fetch (undici, built into
 * Node >= 22 per the repo engines field) + AbortSignal.timeout.
 *
 * Exit contract:
 *   0  all four surfaces verified (gate PASS)
 *   1  one or more surface probes failed (per-surface FAIL lines above)
 *   2  usage error — missing/malformed env vars (the env-missing case
 *      prints the usage line and exits non-zero; no URLs are claimed)
 */
import { setTimeout as sleep } from "node:timers/promises";

const SCRIPT = "node scripts/verify-deployment.mjs";
const PROBE_DECISION_ID = "vd-gate-probe"; // any id: auth rejects before lookup
const FETCH_TIMEOUT_MS = 15_000; // Vercel cold boot + Neon autosuspend tolerance
const NETWORK_RETRIES = 2; // attempts per probe on network-level errors only

const USAGE = `usage: ${SCRIPT}
Reads the four deployed-surface URLs from the environment (ALL FOUR required):

  RECKON_API_URL         apps/api       — probed: GET /healthz (200 {ok:true,...})
                                          + GET /v1/decisions/{id} unauthenticated
                                          (typed 401 UNAUTHENTICATED envelope)
  RECKON_WEB_URL         apps/web       — probed: GET / → 200 + "Reckon Studio"
  RECKON_DOCS_URL        apps/docs      — probed: GET / → 200 + "Reckon documentation"
  RECKON_MARKETING_URL   apps/marketing — probed: GET / → 200 + "Recommendation infrastructure"

Exit codes: 0 gate PASS (all four surfaces verified) · 1 probe failure
(per-surface FAIL lines) · 2 usage error (missing/malformed env).

This is the S4-002 release gate — run it post-deploy per
docs/deployment/stripe-phase-release.md §Verification gate.`;

/* ------------------------- arg parsing ------------------------------ */

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(USAGE + "\n");
  process.exit(0);
}

const surfaceEnv = [
  { id: "api", env: "RECKON_API_URL" },
  { id: "web", env: "RECKON_WEB_URL" },
  { id: "docs", env: "RECKON_DOCS_URL" },
  { id: "marketing", env: "RECKON_MARKETING_URL" },
];

const missing = surfaceEnv.filter((s) => !(process.env[s.env] ?? "").trim());
if (missing.length > 0) {
  process.stderr.write(
    `env-missing: ${missing.map((s) => s.env).join(", ")} — all four surface URLs are required\n\n`,
  );
  process.stderr.write(USAGE + "\n");
  process.exit(2);
}

const malformed = [];
const bases = new Map();
for (const { id, env } of surfaceEnv) {
  const raw = process.env[env].trim().replace(/\/+$/, "");
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("not http(s)");
    bases.set(id, raw);
  } catch {
    malformed.push(`${env}=${raw}`);
  }
}
if (malformed.length > 0) {
  process.stderr.write(`malformed env (expected an http(s) URL): ${malformed.join(", ")}\n\n`);
  process.stderr.write(USAGE + "\n");
  process.exit(2);
}

/* --------------------------- fetching -------------------------------- */

async function fetchWithRetry(url) {
  let lastError;
  for (let attempt = 1; attempt <= NETWORK_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        cache: "no-store",
        headers: { "user-agent": "reckon-verify-deployment/1 (S4-002 release gate)" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const body = await response.text();
      return { status: response.status, body, finalUrl: response.url };
    } catch (error) {
      lastError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      if (attempt < NETWORK_RETRIES) await sleep(1_000);
    }
  }
  throw new Error(`network error after ${NETWORK_RETRIES} attempts: ${lastError}`);
}

function parseJsonOrThrow(body) {
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`body is not JSON: ${body.slice(0, 120)}`);
  }
}

/* ----------------------------- probes -------------------------------- */

/** Each probe returns a one-line detail string or throws with the reason. */

async function probeApiHealthz(base) {
  const { status, body } = await fetchWithRetry(`${base}/healthz`);
  if (status !== 200) throw new Error(`HTTP ${status} (expected 200)`);
  const json = parseJsonOrThrow(body);
  if (json.ok !== true) throw new Error(`ok=${JSON.stringify(json.ok)} (expected true)`);
  if (typeof json.version !== "string" || json.version.length === 0) {
    throw new Error(`version=${JSON.stringify(json.version)} (expected non-empty string)`);
  }
  if (typeof json.contractsVersion !== "string" || json.contractsVersion.length === 0) {
    throw new Error(`contractsVersion missing (expected non-empty string)`);
  }
  return `200 ok=true version=${json.version} contractsVersion=${json.contractsVersion}`;
}

async function probeApiFrozenRoute401(base) {
  const { status, body } = await fetchWithRetry(`${base}/v1/decisions/${PROBE_DECISION_ID}`);
  if (status !== 401) {
    throw new Error(`HTTP ${status} (expected 401 — the typed unauthenticated envelope)`);
  }
  const json = parseJsonOrThrow(body);
  const error = json.error;
  if (typeof error !== "object" || error === null) {
    throw new Error(`no error envelope in body: ${body.slice(0, 120)}`);
  }
  if (error.code !== "UNAUTHENTICATED") {
    throw new Error(`error.code=${JSON.stringify(error.code)} (expected "UNAUTHENTICATED")`);
  }
  if (error.class !== "authentication_error") {
    throw new Error(
      `error.class=${JSON.stringify(error.class)} (expected "authentication_error")`,
    );
  }
  return `401 error.code=UNAUTHENTICATED error.class=authentication_error (typed envelope on frozen route GET /v1/decisions/{id})`;
}

async function probeContentMarker(base, marker) {
  const { status, body } = await fetchWithRetry(`${base}/`);
  if (status !== 200) throw new Error(`HTTP ${status} (expected 200)`);
  if (!body.includes(marker)) {
    throw new Error(`marker ${JSON.stringify(marker)} absent from the served HTML`);
  }
  return `200 · marker ${JSON.stringify(marker)} present`;
}

const surfaces = [
  {
    id: "api",
    env: "RECKON_API_URL",
    probes: [
      { name: "GET /healthz (frozen liveness envelope)", run: () => probeApiHealthz(bases.get("api")) },
      {
        name: `GET /v1/decisions/${PROBE_DECISION_ID} unauthenticated (frozen-route typed 401 envelope)`,
        run: () => probeApiFrozenRoute401(bases.get("api")),
      },
    ],
  },
  {
    id: "web",
    env: "RECKON_WEB_URL",
    probes: [
      { name: `GET / → 200 + "Reckon Studio"`, run: () => probeContentMarker(bases.get("web"), "Reckon Studio") },
    ],
  },
  {
    id: "docs",
    env: "RECKON_DOCS_URL",
    probes: [
      {
        name: `GET / → 200 + "Reckon documentation"`,
        run: () => probeContentMarker(bases.get("docs"), "Reckon documentation"),
      },
    ],
  },
  {
    id: "marketing",
    env: "RECKON_MARKETING_URL",
    probes: [
      {
        name: `GET / → 200 + "Recommendation infrastructure"`,
        run: () => probeContentMarker(bases.get("marketing"), "Recommendation infrastructure"),
      },
    ],
  },
];

/* ------------------------------ gate --------------------------------- */

process.stdout.write("reckon deployment verification gate (S4-002) — four surfaces, exit 0 only when all pass\n");
for (const { id, env } of surfaceEnv) {
  process.stdout.write(`${id.padEnd(10)} ${env}=${bases.get(id)}\n`);
}
process.stdout.write("\n");

const failed = [];
for (const surface of surfaces) {
  let surfaceOk = true;
  for (const probe of surface.probes) {
    try {
      const detail = await probe.run();
      process.stdout.write(`  PASS ${surface.id} · ${probe.name} → ${detail}\n`);
    } catch (error) {
      surfaceOk = false;
      process.stdout.write(
        `  FAIL ${surface.id} · ${probe.name} → ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }
  if (!surfaceOk) failed.push(surface.id);
}

process.stdout.write("\n");
if (failed.length === 0) {
  process.stdout.write("GATE: PASS — 4/4 surfaces verified (api, web, docs, marketing)\n");
  process.exit(0);
}
process.stdout.write(
  `GATE: FAIL — ${4 - failed.length}/4 surfaces verified; failed: ${failed.join(", ")}\n`,
);
process.exit(1);
