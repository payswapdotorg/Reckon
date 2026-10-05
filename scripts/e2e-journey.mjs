#!/usr/bin/env node
/**
 * S4-001 — end-to-end journey driver (signup → API key → first
 * recommendation → log entry → analytics entry → webhook event).
 *
 * EVIDENCE CLASS: OBSERVED — every line this script prints comes from a
 * REAL in-process run of the frozen ff4f9bb surface. Nothing is
 * simulated, replayed from a fixture, or paraphrased (Gate Q law: no
 * simulated transcript presented as a real run). The one honest caveat
 * is the composition itself: like packages/sdk/test/harness.ts, this
 * driver boots the REAL apps/api fastify application in-process via
 * buildServer (the injectable composition root) with deterministic
 * handler ports, the REAL in-memory webhook system mounted through the
 * REAL composition path (config.webhooks), and the REAL observability
 * composition (config.observability + InMemoryObservabilitySink — the
 * same seam PgObservabilitySink plugs into in production). HTTP calls
 * ride the real route pipeline through fastify's inject (light-my-request),
 * exactly like the SDK harness and apps/api tests.
 *
 * WHAT IS HONESTLY NOT WIRED on this surface (attempted live, captured
 * verbatim, never faked — the doc maps each to its pending route):
 *   - POST /v1/api-keys (named in apps/web developers-api.ts) — key
 *     provisioning is composition-time (buildServer keys); the first key
 *     issuance IS the signup hop.
 *   - GET /v1/request-logs, GET /v1/decisions (list), GET /v1/outcomes
 *     (list), GET /v1/preferences/events (list), GET /v1/events — the
 *     dashboard/analytics READ routes.
 *
 * NODE STDLIB ONLY (no new dependencies). The TypeScript sources of
 * apps/api / packages/sdk / packages/observability / apps/web analytics
 * libs are loaded through Node's built-in type stripping (Node >= 22.18
 * / 24) plus a node:module registerHooks resolver that maps the repo's
 * NodeNext `.js` import specifiers onto their `.ts` siblings — the same
 * convention tsc uses. @reckon/contracts loads from its built dist
 * (pnpm build first — asserted by the preflight below).
 *
 * Exit contract: 0 iff every hop asserted; non-zero names the failing
 * hop. --json emits the machine-capture report on stdout (human
 * transcript moves to stderr).
 */
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const JSON_MODE = process.argv.includes("--json");

/* ================================================================== *
 * S5-003 — multi-target parameterization (back-compat with S4-001).
 *
 * The S4-001 invocation (`node scripts/e2e-journey.mjs`, optionally
 * --json) is UNCHANGED: no target flags → the local in-process run
 * against the real buildServer composition, byte-for-byte the same
 * hops/assertions/exit contract as the frozen proof.
 *
 * Target flags select the REMOTE journey (same six hops, driven over
 * the real public wire with fetch — no in-process composition):
 *
 *   --api-base <url>   run against this API base (e.g. a self-hosted
 *                      deployment or a preview). Requires key material.
 *   --web-base <url>   recorded in the report (the journey itself is
 *                      API-only; the web surface is verified by
 *                      scripts/verify-production.mjs).
 *   --api-key <key>    journey key for --api-base runs (secret sk_ key;
 *                      NEVER a publishable key). Production runs read
 *                      the key from the environment instead — see below.
 *   --production       shorthand for the four-surface production
 *                      deployment: api-base/web-base pinned to the
 *                      production domains and the key read ONLY from
 *                      RECKON_JOURNEY_API_KEY (secrets never belong on
 *                      an argv line for a production run).
 *
 * Environment:
 *   RECKON_JOURNEY_API_KEY    the Lead-minted journey key (required for
 *                            --production; alternative to --api-key for
 *                            --api-base runs)
 *   RECKON_JOURNEY_TENANT_ID  the tenant the key was provisioned for
 *                            (the RECKON_API_KEYS tuple is
 *                            apiKey:tenantId:scopes — the body-tenant law
 *                            needs the tenant id)
 *   RECKON_JOURNEY_WEB_BASE   default for --web-base
 *
 * REMOTE-MODE HONESTY (Gate Q law — no simulated runs):
 *   - key minting is composition-side (RECKON_API_KEYS on the host —
 *     the Lead provisions; the driver never invents key material), so
 *     the signup hop asserts the PROVISIONED key over the wire instead
 *     of minting one;
 *   - the journey requires a TEST-mode key (sk_test_): the parity
 *     decision uses the quickstart's magic test item, and a live key
 *     would (correctly) be rejected by the live-mode test-hint guard;
 *   - composition-internal assertions (separation-law counter,
 *     observability sink records, the recorded outbound webhook client,
 *     the local S3-002 computation) are NOT wire-observable: the remote
 *     journey asserts their wire-visible equivalents and names the rest;
 *   - the webhook hop accepts the three honest answers a real surface
 *     can give (200 full parity · 501 NOT_WIRED — the production
 *     composition does not mount the webhook system · 404 — the
 *     surface predates S2-002) and records which one it observed;
 *   - this remote code path is labeled UNTESTED-IN-PROD: no production
 *     key material existed in the S5-003 window, so it was verified
 *     against a real loopback wire running the frozen surface (both the full-parity and the no-webhook production-like compositions).
 * ------------------------------------------------------------------ */
const PRODUCTION_API_BASE = "https://reckon-api-phi.vercel.app";
const PRODUCTION_WEB_BASE = "https://reckon-web-nine.vercel.app";

const TARGET_USAGE = `usage: node scripts/e2e-journey.mjs [--json]
       node scripts/e2e-journey.mjs --api-base <url> --tenant-id <id> [--web-base <url>] [--api-key <sk_ key>] [--json]
       node scripts/e2e-journey.mjs --production [--json]   (key from RECKON_JOURNEY_API_KEY, tenant from RECKON_JOURNEY_TENANT_ID)`;

/** Parse the S5-003 target flags. No flags → the local S4-001 in-process mode. */
function parseTargetArgs(argv, env) {
  const args = argv.slice(2);
  const flag = (name) => args.includes(name);
  const value = (name) => {
    const index = args.indexOf(name);
    if (index === -1) return undefined;
    const next = args[index + 1];
    if (next === undefined || next.startsWith("--")) return undefined;
    return next;
  };
  const refuse = (message) => {
    process.stderr.write(`refused: ${message}\n\n${TARGET_USAGE}\n`);
    process.exit(2);
  };
  const assertHttpUrl = (raw, label) => {
    const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("not http(s)");
    } catch {
      refuse(`${label} '${raw}' is not a valid http(s) URL`);
    }
    return trimmed;
  };
  if (flag("--help") || flag("-h")) {
    process.stdout.write(`${TARGET_USAGE}\n`);
    process.exit(0);
  }
  const production = flag("--production");
  const apiBaseRaw = production ? value("--api-base") ?? PRODUCTION_API_BASE : value("--api-base");
  if (apiBaseRaw === undefined && !production) {
    if (value("--web-base") !== undefined) {
      refuse("--web-base without --api-base/--production — the journey is API-only; --web-base records the companion dashboard surface of a remote run");
    }
    return { remote: false };
  }
  const apiBase = assertHttpUrl(apiBaseRaw, "--api-base");
  let webBase = value("--web-base") ?? env.RECKON_JOURNEY_WEB_BASE ?? "";
  if (production && (webBase ?? "").trim() === "") webBase = PRODUCTION_WEB_BASE;
  webBase = (webBase ?? "").trim() === "" ? null : assertHttpUrl(webBase, "--web-base");
  let apiKey = value("--api-key") ?? "";
  const tenantId = (value("--tenant-id") ?? env.RECKON_JOURNEY_TENANT_ID ?? "").trim();
  if (tenantId === "") {
    refuse(
      "a remote journey needs the tenant id the key was provisioned for (--tenant-id or env RECKON_JOURNEY_TENANT_ID — the RECKON_API_KEYS tuple is apiKey:tenantId:scopes, and the body-tenant law enforces the match)",
    );
  }
  if (production) {
    if (apiKey !== "") {
      refuse("--api-key on a --production run — production key material is read from RECKON_JOURNEY_API_KEY, never from argv");
    }
    apiKey = (env.RECKON_JOURNEY_API_KEY ?? "").trim();
    if (apiKey === "") {
      refuse(
        "--production needs key material from env RECKON_JOURNEY_API_KEY (the Lead mints the journey key into RECKON_API_KEYS on the deployment) — the driver never invents key material",
      );
    }
  } else if (apiKey === "") {
    apiKey = (env.RECKON_JOURNEY_API_KEY ?? "").trim();
    if (apiKey === "") {
      refuse("a remote journey needs key material (--api-key or env RECKON_JOURNEY_API_KEY) — the driver never invents key material");
    }
  }
  return { remote: true, production, apiBase, webBase, apiKey, tenantId };
}

const TARGET = parseTargetArgs(process.argv, process.env);

/* ------------------------------------------------------------------ *
 * The .js → .ts source bridge (node:module + node:fs only).
 *
 * Relative `.js` specifiers that fail the default resolution are
 * retried against their `.ts` sibling — exactly the mapping the
 * repo's NodeNext tsc build performs. Bare specifiers (fastify,
 * @reckon/contracts, …) resolve normally through node_modules.
 * ------------------------------------------------------------------ */
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if ((specifier.startsWith(".") || specifier.startsWith("/")) && specifier.endsWith(".js")) {
        const baseUrl = context.parentURL ?? import.meta.url;
        const tsPath = `${specifier.slice(0, -".js".length)}.ts`;
        const candidate = new URL(tsPath, baseUrl).href;
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate, shortCircuit: true };
        }
      }
      throw error;
    }
  },
});

/* -------------------------- preflight ------------------------------ */

const repoRoot = new URL("..", import.meta.url).pathname;
const contractsDist = new URL("../packages/contracts/dist/index.js", import.meta.url).pathname;
if (!existsSync(contractsDist)) {
  process.stderr.write(
    "preflight failed: packages/contracts/dist/index.js is missing — run `pnpm build` before the journey driver\n",
  );
  process.exit(1);
}

function headSha() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/* ---------------------- real repo imports -------------------------- */

const api = await import("../apps/api/src/index.js");
const contracts = await import("../packages/contracts/dist/index.js");
const sdk = await import("../packages/sdk/src/index.js");
const observabilityPkg = await import("../packages/observability/src/index.js");
const ctrLift = await import("../apps/web/src/lib/analytics-ctr-lift.js");

const {
  buildServer,
  mintKeyConfig,
  createInMemoryWebhookSystem,
  ManualWebhookClock,
} = api;
const {
  parseReckonApiKey,
  SecretApiKeySchema,
  WebhookSigningSecretSchema,
  DecisionResultSchema,
  DecisionRequestSchema,
  OutcomeEventSchema,
  PreferenceDeltaSchema,
  WEBHOOK_SIGNATURE_HEADER,
} = contracts;
const { verifyWebhook } = sdk;
const { InMemoryObservabilitySink } = observabilityPkg;
const {
  computeCtrLift,
  ctrCaveats,
  parseDecisionTrailRecord,
  parseOutcomeTrailRecord,
} = ctrLift;

/* --------------------------- run state ----------------------------- */

const PARSED_JOURNEY_KEY = TARGET.remote ? parseReckonApiKey(TARGET.apiKey) : null;

const RUN = {
  workOrder: TARGET.remote ? "S5-003" : "S4-001",
  evidenceClass: TARGET.remote
    ? TARGET.production
      ? "observed (production wire; driver code path untested-in-prod)"
      : "observed (remote wire; driver code path untested-in-prod)"
    : "observed",
  head: headSha(),
  mode: TARGET.remote ? (PARSED_JOURNEY_KEY?.mode ?? "unknown") : "test",
  tenantId: TARGET.remote ? TARGET.tenantId : "journey-s4-001",
  ...(TARGET.remote
    ? {
        target: {
          apiBase: TARGET.apiBase,
          webBase: TARGET.webBase,
          production: TARGET.production,
          journeyKeyRedacted: redact(TARGET.apiKey),
          codePath: "wired in S5-003; verified against a real loopback wire running the frozen surface (full-parity AND no-webhook compositions; no production key material existed in the window)",
        },
      }
    : {}),
  startedAt: new Date().toISOString(),
  steps: [],
};

const HOP_NAMES = {
  1: "signup (account provisioning)",
  2: "api-key (one-time secret)",
  3: "decision (first recommendation)",
  4: "request-log (log entry)",
  5: "analytics (analytics entry)",
  6: "webhook (webhook event)",
};

class JourneyFailure extends Error {
  constructor(step, hop, message) {
    super(message);
    this.step = step;
    this.hop = hop;
  }
}

let currentStep = 0;

/** Human transcript line (stdout, or stderr under --json). */
function emit(line) {
  if (JSON_MODE) process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

/** Assertion: records into the step entry, throws JourneyFailure on false. */
function must(step, condition, description, detail) {
  const entry = RUN.steps.find((candidate) => candidate.step === step);
  const assertion = { description, ...(detail !== undefined ? { detail } : {}) };
  if (entry !== undefined) entry.assertions.push(assertion);
  if (!condition) {
    throw new JourneyFailure(step, HOP_NAMES[step] ?? `step ${step}`, description);
  }
}

function beginStep(step, name, note) {
  currentStep = step;
  RUN.steps.push({ step, name, note, routes: [], artifacts: {}, assertions: [], evidenceClass: "observed" });
  emit("");
  emit(`STEP ${step} ${name}`);
  if (note !== undefined) emit(`  · ${note}`);
}

function note(line) {
  emit(`  · ${line}`);
}

function artifact(step, key, value) {
  const entry = RUN.steps.find((candidate) => candidate.step === step);
  if (entry !== undefined) entry.artifacts[key] = value;
}

function routeTouched(step, route, status) {
  const entry = RUN.steps.find((candidate) => candidate.step === step);
  if (entry !== undefined) entry.routes.push({ route, status });
}

/** Redact a secret to its prefix + last 4 chars (never the token body). */
function redact(secret) {
  if (typeof secret !== "string" || secret.length < 8) return "<redacted>";
  const prefixMatch = /^(sk_(?:live|test)_|pk_(?:live|test)_|whsec_)/.exec(secret);
  const prefix = prefixMatch !== null ? prefixMatch[1] : secret.slice(0, 4);
  return `${prefix}…${secret.slice(-4)}`;
}

/** The headline artifact id for a step (journey-map summary line). */
function primaryArtifact(step) {
  return RUN.steps.find((candidate) => candidate.step === step)?.primary ?? "-";
}

function setPrimary(step, value) {
  const entry = RUN.steps.find((candidate) => candidate.step === step);
  if (entry !== undefined) entry.primary = value;
}

/* ----------------------- harness composition ----------------------- *
 * The packages/sdk/test/harness.ts pattern: REAL buildServer, REAL
 * in-memory webhook system through config.webhooks, REAL observability
 * composition through config.observability, deterministic handler ports
 * (the injectable seams), manual clock seeded at real build time so
 * webhook signature timestamps stay inside the 300s tolerance window.
 * ------------------------------------------------------------------ */

const clock = new ManualWebhookClock(Date.now());

/** Recording outbound webhook client (mirrors apps/api/test/webhook-helpers.ts). */
class RecordingWebhookClient {
  constructor() {
    this.calls = [];
  }
  async post(url, headers, rawBody) {
    const call = { url, headers, rawBody };
    this.calls.push(call);
    return { statusCode: 200, latencyMs: 1 };
  }
}

const webhookClient = new RecordingWebhookClient();
const webhooks = createInMemoryWebhookSystem({
  httpClient: webhookClient,
  clock: () => clock.now(),
});
const sink = new InMemoryObservabilitySink();

const journeyState = {
  decisionHandlerCalls: 0, // proves the SEPARATION LAW: test mode never runs the live handler
  outcomesIngested: [],
  preferencesIngested: [],
};

/** Deterministic handler ports (the harness shape; echo seams over the frozen contracts). */
const handlers = {
  decisionHandler: {
    // Never executed in test mode (canned path) — mounted so the
    // separation-law counter can assert it stayed at zero.
    decide: async (request, auth) =>
      DecisionResultSchema.parse({
        decisionId: `dec-live-${auth.tenantId}-${request.idempotencyKey}`,
        requestId: request.requestId,
        tenant: request.tenant,
        action: "SUGGEST",
        policy: { policyId: request.policySelector.policyId, version: request.policySelector.version },
        at: request.at ?? 1_000,
        reasons: [{ code: "harness", message: "deterministic live-mode handler (unused in test mode)" }],
      }),
  },
  decisionStore: {
    // The LIVE decision store seam — empty by the mode-separation law:
    // this journey's decisions are test-mode and never live state.
    get: async () => null,
  },
  outcomeIngest: {
    ingest: async (event, auth) => {
      journeyState.outcomesIngested.push({ eventId: event.eventId, tenantId: auth.tenantId, mode: auth.mode });
      return event;
    },
  },
  preferenceIngest: {
    ingest: async (delta, auth) => {
      journeyState.preferencesIngested.push({ deltaId: delta.deltaId, tenantId: auth.tenantId, mode: auth.mode });
      return delta;
    },
  },
};

/** One call through the REAL route pipeline (fastify inject — the harness transport). */
async function call(app, method, url, options = {}) {
  const headers = {
    ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    ...(options.key !== undefined ? { authorization: `Bearer ${options.key}` } : {}),
    ...(options.idempotencyKey !== undefined ? { "idempotency-key": options.idempotencyKey } : {}),
    ...(options.headers ?? {}),
  };
  const startedAt = performance.now();
  const res = await app.inject({
    method,
    url,
    ...(options.body !== undefined ? { payload: JSON.stringify(options.body) } : {}),
    headers,
  });
  const latencyMs = Number((performance.now() - startedAt).toFixed(1));
  let body;
  try {
    body = res.json();
  } catch {
    body = res.body;
  }
  return { status: res.statusCode, headers: res.headers, body, latencyMs };
}

/* ================================================================== *
 * S5-003 — THE REMOTE JOURNEY (same six hops over the real public wire)
 *
 * Transport: Node's global fetch (no dependencies). Every assertion is
 * wire-observable; composition-internal assertions from the local mode
 * are named as such and NOT faked. The per-run idempotency salt keeps
 * repeated remote runs (e.g. the Lead re-running --production) from
 * replaying a previous run's entries.
 * ================================================================== */

const REMOTE_FETCH_TIMEOUT_MS = 30_000;

/** One call over the real wire. Returns the same shape as the local `call`. */
async function remoteCall(apiBase, method, url, options = {}) {
  const headers = {
    ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    ...(options.key !== undefined ? { authorization: `Bearer ${options.key}` } : {}),
    ...(options.idempotencyKey !== undefined ? { "idempotency-key": options.idempotencyKey } : {}),
    ...(options.headers ?? {}),
  };
  const startedAt = performance.now();
  let res;
  try {
    res = await fetch(`${apiBase}${url}`, {
      method,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      headers,
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      `network error calling ${method} ${apiBase}${url}: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
    );
  }
  const text = await res.text();
  const latencyMs = Number((performance.now() - startedAt).toFixed(1));
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  const flatHeaders = {};
  for (const [name, value] of res.headers) flatHeaders[name.toLowerCase()] = value;
  return { status: res.status, headers: flatHeaders, body, latencyMs };
}

/** The typed-error check the wire can always make: a machine code envelope. */
function typedErrorOf(response) {
  return typeof response.body === "object" && response.body !== null && typeof response.body.error === "object"
    ? response.body.error
    : null;
}

async function runRemoteJourney(target) {
  const journeyKey = target.apiKey;
  const salt = cryptoRandomId(6);
  const rc = (method, url, options = {}) => remoteCall(target.apiBase, method, url, options);

  emit(`reckon e2e journey driver (${RUN.workOrder} remote mode) — evidence class: ${RUN.evidenceClass}`);
  emit(`head: ${RUN.head} · api-base: ${target.apiBase}${target.webBase !== null ? ` · web-base: ${target.webBase} (companion surface, recorded)` : ""}`);
  emit(`key material: deployment-provisioned (${redact(journeyKey)}, parsed kind=${String(PARSED_JOURNEY_KEY?.kind)} mode=${String(PARSED_JOURNEY_KEY?.mode)}) · tenant ${target.tenantId} — the driver never invents key material`);
  emit(`code path wired in S5-003 and verified over a real loopback wire against the frozen surface (full-parity and no-webhook compositions) — UNTESTED-IN-PROD until the Lead runs it with RECKON_JOURNEY_API_KEY`);
  emit(`not-wired hops are attempted live, captured verbatim and named — never faked`);

  /* ---------------- STEP 1 — signup (account provisioning) ---------------- */

  beginStep(
    1,
    "signup (account provisioning)",
    "remote mode: provisioning is key-issuance-based (apps/api/src/auth.ts — keys are configured, never discovered) — the Lead mints the journey key into RECKON_API_KEYS on the deployment (format 'apiKey:tenantId:scope1,scope2'; sk_test_<42 base62> for the test-mode journey); THE FIRST KEY ISSUANCE IS SIGNUP, and the driver receives it pre-provisioned",
  );

  must(1, PARSED_JOURNEY_KEY !== null && PARSED_JOURNEY_KEY.kind === "secret", "the provisioned key parses as a SECRET key (parseReckonApiKey — sk_live_/sk_test_; pk_ keys never authenticate)", `parsed=${JSON.stringify(PARSED_JOURNEY_KEY)}`);
  must(1, PARSED_JOURNEY_KEY !== null && PARSED_JOURNEY_KEY.mode === "test", "the journey key is TEST mode (sk_test_) — the parity decision uses the quickstart's magic test item, and a live key would (correctly) be rejected by the live-mode test-hint guard (S2-003)", `mode=${String(PARSED_JOURNEY_KEY?.mode)}`);
  must(1, SecretApiKeySchema.safeParse(journeyKey).success, "the provisioned key passes SecretApiKeySchema (the Stripe-grammar shape)");

  const health = await rc("GET", "/healthz");
  must(1, health.status === 200 && health.body?.ok === true, `GET ${target.apiBase}/healthz → 200 {ok:true} on the live deployment`, `status=${health.status}`);
  must(
    1,
    typeof health.body?.version === "string" && health.body.version.length > 0 && typeof health.body?.contractsVersion === "string" && health.body.contractsVersion.length > 0,
    "the liveness envelope carries version + contractsVersion (routes/health.ts frozen shape)",
    `version=${String(health.body?.version)} contractsVersion=${String(health.body?.contractsVersion)}`,
  );
  routeTouched(1, "GET /healthz (deployment liveness probe)", "wired");
  note(`live deployment liveness: ok=true · version=${String(health.body?.version)} · contractsVersion=${String(health.body?.contractsVersion)}`);
  note(`signup artifact: tenant ${target.tenantId} provisioned via RECKON_API_KEYS (the host is the identity authority) · key ${redact(journeyKey)} received one-time by the driver`);
  artifact(1, "signupEvent", { tenantId: target.tenantId, provisioning: "RECKON_API_KEYS (Lead-minted, composition-side)", secretRedacted: redact(journeyKey), mode: PARSED_JOURNEY_KEY?.mode, healthz: { status: health.status, version: health.body?.version, contractsVersion: health.body?.contractsVersion } });
  setPrimary(1, `tenant ${target.tenantId} + ${redact(journeyKey)}`);
  emit("STEP 1 OK — signup hop asserted (pre-provisioned key validated + live liveness envelope)");

  /* ---------------- STEP 2 — API key (one-time secret) ---------------- */

  beginStep(2, "api-key (one-time secret)", "remote mode: the Stripe-grammar key route POST /v1/api-keys is attempted verbatim over the wire (the route apps/web developers-api.ts names as pending); the working secret is the Lead's issuance — the one-time display happened at provisioning time");

  const keyAttempt = await rc("POST", "/v1/api-keys", {
    key: journeyKey,
    body: { name: "Journey key", kind: "secret", mode: "test" },
    idempotencyKey: `journey-key-create-${salt}`,
  });
  must(
    2,
    keyAttempt.status === 404 && typedErrorOf(keyAttempt)?.code === "NOT_FOUND",
    "POST /v1/api-keys answered the documented typed 404 — NOT WIRED (pending route named)",
    `status=${keyAttempt.status} code=${String(typedErrorOf(keyAttempt)?.code)}`,
  );
  routeTouched(2, "POST /v1/api-keys", "not-wired (pending — named in apps/web/src/lib/developers-api.ts PENDING_API_KEY_ROUTES.create)");
  note(`POST /v1/api-keys → 404 NOT_FOUND (pending route; the API-keys manager view shows this same not-wired state)`);

  // The key works over the wire. The honest remote assertion: the probe
  // authenticates (never 401) and its answer is one of the three states
  // a real deployment can hold for the webhook-surface probe.
  const keyProbe = await rc("GET", "/v1/webhooks/endpoints", { key: journeyKey });
  must(2, keyProbe.status !== 401, "authenticated probe GET /v1/webhooks/endpoints — the provisioned key AUTHENTICATES over the wire (never 401)", `status=${keyProbe.status} error=${JSON.stringify(typedErrorOf(keyProbe))}`);
  const probeOutcome =
    keyProbe.status === 200
      ? "full parity — the webhook system is mounted (200 endpoints list)"
      : typedErrorOf(keyProbe)?.code === "NOT_WIRED"
        ? "production-composition structural gap — webhook routes registered but the system is NOT mounted (typed 501 NOT_WIRED; buildProductionServer mounts no webhook system)"
        : typedErrorOf(keyProbe)?.code === "NOT_FOUND"
          ? "surface predates S2-002 — the webhook route family is not registered (typed 404)"
          : "unexpected answer";
  if (keyProbe.status === 200) {
    must(2, Array.isArray(keyProbe.body?.endpoints), "the 200 probe carries the endpoints list shape");
    must(2, keyProbe.headers["x-reckon-mode"] === "test", "authenticated response carries X-Reckon-Mode: test (mode marker law)");
    routeTouched(2, "GET /v1/webhooks/endpoints (authenticated key probe)", "wired");
  } else if (typedErrorOf(keyProbe)?.code === "NOT_WIRED") {
    routeTouched(2, "GET /v1/webhooks/endpoints (authenticated key probe)", "wired (routes registered; system not mounted — typed 501 NOT_WIRED)");
  } else if (typedErrorOf(keyProbe)?.code === "NOT_FOUND") {
    routeTouched(2, "GET /v1/webhooks/endpoints (authenticated key probe)", "not-wired (route family unregistered — the deployed surface predates S2-002)");
  } else {
    must(2, false, "the authenticated probe answered an undocumented shape", `status=${keyProbe.status} body=${JSON.stringify(keyProbe.body).slice(0, 160)}`);
  }
  note(`authenticated probe outcome: ${probeOutcome}`);
  artifact(2, "oneTimeSecret", { redacted: redact(journeyKey), format: "sk_test_<42 base62>", provisioning: "RECKON_API_KEYS (one-time display at provisioning)" });
  artifact(2, "keyProbe", { status: keyProbe.status, outcome: probeOutcome, error: typedErrorOf(keyProbe) });
  setPrimary(2, redact(journeyKey));
  emit("STEP 2 OK — api-key hop asserted (pending route named + the provisioned key authenticates over the wire)");

  /* ---------------- STEP 3 — first recommendation (test mode) ---------------- */

  beginStep(3, "decision (first recommendation)", "remote mode: POST /v1/decisions over the wire with the provisioned test key and the magic item itm_test_suggest (the quickstart's canonical first call) — on a current-surface deployment the canned test-mode engine answers; composition-internal assertions (the separation-law counter) are local-mode only and are NOT faked here");

  const decisionRequest = {
    requestId: `req-journey-${salt}`,
    tenant: { tenantId: target.tenantId },
    subject: { kind: "user", ref: "user-journey" },
    objective: { objectiveId: "obj-relax-1", kind: "relax" },
    attentionPolicy: { policyId: "ap-balanced-1", style: "balanced" },
    context: { contextId: "ctx-journey-1" },
    candidates: {
      setId: `cs-journey-${salt}`,
      candidates: [{ itemId: "itm_test_suggest", realizationIds: ["real-journey-1"], source: "host-retrieval" }],
    },
    policySelector: { policyId: "greedy-v1", version: "1" },
    at: 1_000,
    idempotencyKey: `journey-decision-${salt}`,
  };

  const decision = await rc("POST", "/v1/decisions", { key: journeyKey, body: decisionRequest });
  routeTouched(3, "POST /v1/decisions", "wired");
  must(3, decision.status === 200, "POST /v1/decisions → 200 over the wire", `status=${decision.status} error=${JSON.stringify(typedErrorOf(decision))}`);
  must(3, decision.headers["x-reckon-mode"] === "test", "response carries X-Reckon-Mode: test");
  must(3, decision.body?.mode === "test", 'response payload carries the visible mode marker { mode: "test" }');
  must(3, typeof decision.body?.decisionId === "string" && decision.body.decisionId.startsWith("dec-test-"), "decision id is a canned test id (dec-test_…) — the canned test engine answered", `decisionId=${String(decision.body?.decisionId)}`);
  must(3, decision.body?.action === "SUGGEST", "action = SUGGEST (scenario suggest)");
  must(
    3,
    decision.body?.selectedExperience?.itemId === "itm_test_suggest",
    "selected experience captured (itemId=itm_test_suggest)",
    `selectedExperience=${JSON.stringify(decision.body?.selectedExperience)}`,
  );
  must(3, decision.body?.provenance?.system === "reckon-api-test-mode", "provenance.system = reckon-api-test-mode (in-payload test marker — the wire-visible half of the separation law)");
  note(`separation law (wire-visible half): canned provenance + dec-test_ id + X-Reckon-Mode: test — the composition-internal counter (live handler invocations = 0) is a local-mode assertion and is honestly NOT asserted here`);

  const decisionId = decision.body.decisionId;
  const decisionRead = await rc("GET", `/v1/decisions/${encodeURIComponent(decisionId)}`, { key: journeyKey });
  routeTouched(3, "GET /v1/decisions/{decisionId}", "wired");
  must(3, decisionRead.status === 200 && decisionRead.body?.decisionId === decisionId, "GET /v1/decisions/{id} read-back → the same decision (durable test-store row on the deployment)", `status=${decisionRead.status}`);
  must(3, decisionRead.headers["x-reckon-mode"] === "test", "read-back carries X-Reckon-Mode: test");

  note(`decision envelope: decisionId=${decisionId} · action=${String(decision.body.action)} · mode=${String(decision.body.mode)} · latency=${decision.latencyMs}ms (wire)`);
  artifact(3, "decision", { decisionId, action: decision.body.action, mode: decision.body.mode, selectedExperience: decision.body.selectedExperience, provenance: decision.body.provenance, latencyMs: decision.latencyMs });
  artifact(3, "readBack", { route: `GET /v1/decisions/${decisionId}`, status: decisionRead.status });
  setPrimary(3, decisionId);
  emit("STEP 3 OK — decision hop asserted (canned envelope over the wire + read-back + wire-visible mode markers)");

  /* ---------------- STEP 4 — log entry (request trail) ---------------- */

  beginStep(4, "request-log (log entry)", "remote mode: the request-log surface GET /v1/request-logs is attempted verbatim over the wire; the mode-scoped idempotency trail row is proven by replaying the identical request (the wire-visible trail)");

  const logAttempt = await rc("GET", "/v1/request-logs", { key: journeyKey });
  must(
    4,
    logAttempt.status === 404 && typedErrorOf(logAttempt)?.code === "NOT_FOUND",
    "GET /v1/request-logs answered the documented typed 404 — NOT WIRED (pending route named)",
    `status=${logAttempt.status} code=${String(typedErrorOf(logAttempt)?.code)}`,
  );
  routeTouched(4, "GET /v1/request-logs", "not-wired (pending — named in apps/web/src/lib/developers-api.ts PENDING_REQUEST_LOG_ROUTE)");
  note(`GET /v1/request-logs → 404 NOT_FOUND (pending route; the request-logs view + latency analytics show this same not-wired state)`);

  const decisionReplay = await rc("POST", "/v1/decisions", { key: journeyKey, body: decisionRequest });
  must(4, decisionReplay.status === 200 && decisionReplay.body?.decisionId === decisionId, "identical re-POST replays the SAME decision id (the request row lives in the mode-scoped idempotency store)", `decisionId=${String(decisionReplay.body?.decisionId)}`);
  must(4, decisionReplay.headers["idempotent-replayed"] === "true", "replay carries Idempotent-Replayed: true (the stored response was served — the wire-visible request-log row)");
  note(`idempotency trail row: re-POST → Idempotent-Replayed: true · same decisionId=${decisionId} · first-call latency=${decision.latencyMs}ms · replay latency=${decisionReplay.latencyMs}ms (both wire-observed)`);

  artifact(4, "callRow", { route: "POST /v1/decisions", status: decision.status, mode: "test", latencyMs: decision.latencyMs, source: "wire-observed" });
  artifact(4, "idempotencyRow", { idempotencyKey: decisionRequest.idempotencyKey, replayed: decisionReplay.headers["idempotent-replayed"] === "true", decisionId, replayLatencyMs: decisionReplay.latencyMs });
  artifact(4, "pendingRouteAttempt", { route: "GET /v1/request-logs", status: 404, error: typedErrorOf(logAttempt) });
  setPrimary(4, `${decisionId} (replayed row)`);
  emit("STEP 4 OK — request-log hop asserted (pending route named + wire-visible idempotency replay row)");

  /* ---------------- STEP 5 — analytics entry ---------------- */

  beginStep(5, "analytics (analytics entry)", "remote mode: an outcome reports the step-3 decision back via POST /v1/outcomes over the wire so the funnel/CTR linkage has a real row on the deployment; the pending analytics trail reads are attempted verbatim; the observability linkage record and the S3-002 computation are composition/client-side and are honestly NOT asserted over the wire");

  const outcomeEvent = {
    eventId: `ev-journey-impression-${salt}`,
    tenant: { tenantId: target.tenantId },
    subject: { kind: "user", ref: "user-journey" },
    eventType: "impression",
    occurredAt: Date.now(),
    metrics: { watchRatio: 0.9 },
    evidenceClass: "controlled-local",
    decisionId,
    experienceId: decision.body.selectedExperience?.experienceId,
    idempotencyKey: `journey-outcome-${salt}`,
  };

  const outcome = await rc("POST", "/v1/outcomes", { key: journeyKey, body: outcomeEvent });
  routeTouched(5, "POST /v1/outcomes", "wired");
  must(5, outcome.status === 200 && outcome.body?.eventId === outcomeEvent.eventId, "POST /v1/outcomes → 200 with the eventId echoed", `status=${outcome.status} error=${JSON.stringify(typedErrorOf(outcome))}`);
  must(5, outcome.headers["x-reckon-mode"] === "test", "outcome response carries X-Reckon-Mode: test");
  note(`outcome row: eventId=${outcomeEvent.eventId} · eventType=impression · decisionId=${decisionId} (the funnel/CTR linkage row on the deployment)`);
  note(`observability outcome-linkage record + S3-002 computeCtrLift: NOT wire-observable — local-mode assertions, honestly skipped here (the dashboard analytics views read them through the pending trail routes)`);

  const pendingTrailReads = [
    { route: "GET /v1/decisions", url: "/v1/decisions", lib: "analytics-ctr-lift.ts", constant: "PENDING_DECISION_LIST_ROUTE (ctr-lift + funnel decision trail)" },
    { route: "GET /v1/outcomes", url: "/v1/outcomes", lib: "analytics-ctr-lift.ts", constant: "PENDING_OUTCOME_LIST_ROUTE (ctr-lift + funnel outcome trail)" },
    { route: "GET /v1/preferences/events", url: "/v1/preferences/events", lib: "analytics-funnel.ts", constant: "PENDING_PREFERENCE_DELTA_LIST_ROUTE (funnel preference trail)" },
  ];
  for (const read of pendingTrailReads) {
    const attempt = await rc("GET", read.url, { key: journeyKey });
    must(
      5,
      attempt.status === 404 && typedErrorOf(attempt)?.code === "NOT_FOUND",
      `${read.route} answered the documented typed 404 — NOT WIRED (pending trail read named in apps/web/src/lib/${read.lib}: ${read.constant})`,
      `status=${attempt.status}`,
    );
    routeTouched(5, read.route, `not-wired (pending — apps/web/src/lib/${read.lib} ${read.constant})`);
    note(`${read.route} → 404 NOT_FOUND (pending trail read)`);
  }

  artifact(5, "outcomeRow", { eventId: outcomeEvent.eventId, eventType: "impression", decisionId, experienceId: decision.body.selectedExperience?.experienceId, evidenceClass: "controlled-local" });
  artifact(5, "notWireObservable", ["observability outcome-linkage record", "S3-002 computeCtrLift computation (client-side data layer)"]);
  setPrimary(5, `${outcomeEvent.eventId} → ${decisionId}`);
  emit("STEP 5 OK — analytics hop asserted (real outcome row over the wire + pending trail reads named; composition-internal linkage honestly not asserted)");

  /* ---------------- STEP 6 — webhook event ---------------- */

  beginStep(6, "webhook (webhook event)", "remote mode: register an endpoint over the wire, trigger the journey's own event (POST /v1/preferences/events → preference.updated), retrieve the event and poll the delivery log — the three honest deployment states are accepted and recorded; signature verification needs the delivered bytes (a public receiver URL) and is honestly skipped unless the deployment delivers to one");

  const endpointCreate = await rc("POST", "/v1/webhooks/endpoints", {
    key: journeyKey,
    body: {
      url: "https://journey.example.test/hooks",
      description: "S5-003 remote journey endpoint (unreachable by design — delivery status recorded honestly)",
      eventTypes: [],
    },
    idempotencyKey: `journey-endpoint-${salt}`,
  });

  let webhookMode;
  if (endpointCreate.status === 200) {
    webhookMode = "full-parity";
    routeTouched(6, "POST /v1/webhooks/endpoints", "wired");
    must(6, typeof endpointCreate.body?.id === "string" && endpointCreate.body.id.startsWith("we_"), "endpoint registered over the wire (we_…)");
    must(6, typeof endpointCreate.body?.secret === "string" && endpointCreate.body.secret.startsWith("whsec_"), "one-time signing secret issued over the wire (whsec_… — redacted in the transcript)");
    note(`endpoint registered: id=${String(endpointCreate.body?.id)} · one-time secret ${redact(String(endpointCreate.body?.secret))} (redacted; shown exactly once by the surface)`);
    artifact(6, "endpoint", { id: endpointCreate.body?.id, url: "https://journey.example.test/hooks", secretRedacted: redact(String(endpointCreate.body?.secret)) });
  } else if (typedErrorOf(endpointCreate)?.code === "NOT_WIRED") {
    webhookMode = "production-composition-structural-gap";
    routeTouched(6, "POST /v1/webhooks/endpoints", "wired (routes registered; system not mounted)");
    must(
      6,
      endpointCreate.status === 501 && /WebhookHandler/i.test(String(typedErrorOf(endpointCreate)?.message ?? "")),
      "endpoint registration answered the typed 501 NOT_WIRED naming WebhookHandler.createEndpoint — the PRODUCTION COMPOSITION STRUCTURAL GAP (buildProductionServer mounts no webhook system; apps/api/src/composition.ts)",
      `status=${endpointCreate.status} error=${JSON.stringify(typedErrorOf(endpointCreate))}`,
    );
    note(`POST /v1/webhooks/endpoints → 501 NOT_WIRED (WebhookHandler.createEndpoint) — the production composition mounts no webhook system (documented S5-003 production gap; the in-memory system is the harness/test composition)`);
    artifact(6, "structuralGap", { route: "POST /v1/webhooks/endpoints", status: 501, error: typedErrorOf(endpointCreate), gap: "buildProductionServer (apps/api/src/composition.ts) mounts no config.webhooks — the webhook route family answers typed 501 NOT_WIRED in production" });
  } else if (typedErrorOf(endpointCreate)?.code === "NOT_FOUND") {
    routeTouched(6, "POST /v1/webhooks/endpoints", "not-wired (route family unregistered)");
    must(
      6,
      false,
      "endpoint registration answered typed 404 — the deployed surface PREDATES S2-002 (webhook routes unregistered): the RELEASE-002 wave-2 redeploy has not taken effect on this function (see docs/handoff/e2e-journey-proof.md §Production verification)",
      `status=${endpointCreate.status}`,
    );
  } else {
    must(6, false, "endpoint registration answered an undocumented shape", `status=${endpointCreate.status} body=${JSON.stringify(endpointCreate.body).slice(0, 160)}`);
  }

  if (webhookMode === "full-parity") {
    const preferenceDelta = {
      deltaId: `delta-journey-${salt}`,
      tenant: { tenantId: target.tenantId },
      subject: { kind: "user", ref: "user-journey" },
      dimension: "genre.scifi",
      op: "add",
      value: 0.25,
      model: { modelId: "m-journey", version: "1" },
      timestamp: Date.now(),
    };
    const preference = await rc("POST", "/v1/preferences/events", {
      key: journeyKey,
      body: preferenceDelta,
      idempotencyKey: `journey-pref-${salt}`,
    });
    routeTouched(6, "POST /v1/preferences/events", "wired");
    must(6, preference.status === 200 && preference.body?.deltaId === preferenceDelta.deltaId, "POST /v1/preferences/events → 200 (the emission-seam trigger)", `status=${preference.status}`);

    // The event id is discovered from the delivery log (the wire-visible
    // half of the recorded outbound POST in local mode).
    const deliveries = await rc("GET", "/v1/webhooks/deliveries", { key: journeyKey });
    routeTouched(6, "GET /v1/webhooks/deliveries", "wired");
    must(6, deliveries.status === 200 && Array.isArray(deliveries.body?.deliveries), "GET /v1/webhooks/deliveries → 200 with the delivery log", `status=${deliveries.status}`);
    const prefDelivery = deliveries.body.deliveries.find((row) => row.eventType === "preference.updated" || row.eventId !== undefined);
    must(6, prefDelivery !== undefined, "the delivery log holds the journey's preference.updated delivery row");
    const eventId = prefDelivery?.eventId;
    must(6, typeof eventId === "string" && eventId.startsWith("evt_"), "the delivery row carries the evt_… id", `eventId=${String(eventId)}`);

    const eventRead = await rc("GET", `/v1/webhooks/events/${encodeURIComponent(String(eventId))}`, { key: journeyKey });
    routeTouched(6, "GET /v1/webhooks/events/{eventId}", "wired");
    must(6, eventRead.status === 200 && eventRead.body?.id === eventId && eventRead.body?.type === "preference.updated", "GET /v1/webhooks/events/{id} → the stored thin event (30-day replay retention)", `status=${eventRead.status}`);
    note(`event retrieved: id=${String(eventId)} · type=preference.updated`);
    note(`delivery row: id=${String(prefDelivery?.id)} · status=${String(prefDelivery?.status)} · attempts=${String(prefDelivery?.attempts)} · responseCode=${String(prefDelivery?.responseCode)} — the registered URL (journey.example.test) is unreachable BY DESIGN: a failed/pending delivery status is the honest wire observation, never a fake 200`);
    note(`signature verification: honestly SKIPPED over the wire — it needs the delivered bytes at a receiver the driver controls (the local mode verifies them through the recorded outbound client)`);
    artifact(6, "event", { id: eventId, type: "preference.updated" });
    artifact(6, "delivery", prefDelivery);
    artifact(6, "signatureVerification", { performed: false, reason: "wire mode has no receiver for the delivered bytes; local mode verifies through the recorded outbound client" });
    setPrimary(6, `${String(eventId)} → ${String(prefDelivery?.id)}`);
  } else {
    for (const route of ["POST /v1/preferences/events", "GET /v1/webhooks/events/{eventId}", "GET /v1/webhooks/deliveries"]) {
      routeTouched(6, route, `skipped (${webhookMode === "production-composition-structural-gap" ? "webhook system not mounted — typed 501 recorded" : "route family unregistered"})`);
    }
    note(`webhook hop sub-steps honestly SKIPPED (${webhookMode}): the emission/retrieval/delivery surfaces depend on the webhook system this deployment does not mount — nothing is faked`);
    setPrimary(6, webhookMode === "production-composition-structural-gap" ? "typed 501 NOT_WIRED (structural gap recorded)" : "typed 404 (pre-S2-002 surface)");
  }

  const eventsAttempt = await rc("GET", "/v1/events", { key: journeyKey });
  must(
    6,
    eventsAttempt.status === 404 && typedErrorOf(eventsAttempt)?.code === "NOT_FOUND",
    "GET /v1/events answered the documented typed 404 — NOT WIRED (the events-console aggregate list; named in apps/web developers-api.ts PENDING_EVENT_ROUTES.list)",
    `status=${eventsAttempt.status}`,
  );
  routeTouched(6, "GET /v1/events", "not-wired (pending — named in apps/web/src/lib/developers-api.ts PENDING_EVENT_ROUTES.list)");
  note(`GET /v1/events → 404 NOT_FOUND (pending; the events console shows this same not-wired state today)`);

  emit(`STEP 6 OK — webhook hop asserted (${webhookMode === "full-parity" ? "full parity over the wire" : webhookMode === "production-composition-structural-gap" ? "production-composition structural gap — typed 501 NOT_WIRED recorded, sub-steps honestly skipped" : "pre-S2-002 surface — typed 404"})`);

  /* ---------------------------- summary ---------------------------- */

  const hops = RUN.steps.length;
  emit("");
  emit(
    `JOURNEY COMPLETE (remote): ${hops}/6 hops asserted · webhook hop: ${webhookMode} · exit 0 · head ${RUN.head} · api-base ${target.apiBase}`,
  );
  emit("journey map (step → route → status → captured artifact):");
  for (const step of RUN.steps) {
    for (const entry of step.routes) {
      emit(`  ${step.step} ${step.name} | ${entry.route} | ${entry.status} | ${primaryArtifact(step.step)}`);
    }
  }
  RUN.remoteSummary = { hopsAsserted: hops, webhookMode, apiBase: target.apiBase, webBase: target.webBase };
  return 0;
}

/** Small URL-safe random id (crypto only — no new dependencies). */
function cryptoRandomId(length) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(length);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

/* ================================================================== *
 * THE JOURNEY (every hop asserted; order is the documented order)
 * ================================================================== */

async function main() {
  emit(`reckon e2e journey driver (${RUN.workOrder}) — evidence class: ${RUN.evidenceClass} (real in-process run)`);
  emit(`head: ${RUN.head} · mode: ${RUN.mode} · composition: real apps/api buildServer (the harness pattern)`);
  emit(`not-wired hops are attempted live, captured verbatim and named — never faked`);

  const SCOPES = ["decisions", "outcomes", "plans", "catalog", "webhooks"];
  let app;
  let journeyKey;

  /* ---------------- STEP 1 — signup (account provisioning) ---------------- */

  beginStep(
    1,
    "signup (account provisioning)",
    "no signup/account HTTP route exists on the frozen surface: provisioning is key-issuance-based (apps/api/src/auth.ts — keys are configured, never discovered; the host is the identity authority) — THE FIRST KEY ISSUANCE IS SIGNUP",
  );

  // The repo's provisioning surface: mintKeyConfig (auth.ts) mints a
  // schema-validated StaticKeyConfig; buildServer hashes it into the
  // KeyStore. This issuance creates the tenant's API identity = signup.
  const keyConfig = mintKeyConfig("secret", "test", RUN.tenantId, SCOPES);
  journeyKey = keyConfig.apiKey;
  must(1, SecretApiKeySchema.safeParse(journeyKey).success, "minted key passes SecretApiKeySchema (mintKeyConfig enforces it at issuance)");
  const parsedKey = parseReckonApiKey(journeyKey);
  must(1, parsedKey !== null && parsedKey.kind === "secret" && parsedKey.mode === "test", `parseReckonApiKey → { kind: "secret", mode: "test" }`, `got ${JSON.stringify(parsedKey)}`);
  must(1, keyConfig.tenantId === RUN.tenantId && keyConfig.mode === "test", "minted config carries the journey tenant + mode=test");

  app = buildServer({
    keys: [keyConfig],
    handlers,
    clock: () => clock.now(),
    webhooks,
    observability: { sink, clock: () => clock.now(), evidenceClass: "controlled-local" },
  });

  const health = await call(app, "GET", "/healthz");
  must(1, health.status === 200 && health.body.ok === true, "GET /healthz → 200 {ok:true} on the booted real API", `status=${health.status}`);
  routeTouched(1, "GET /healthz (composition boot probe)", "wired");
  note(`minted first key for tenant ${RUN.tenantId} → ${redact(journeyKey)} (redacted; mode=test, scopes=[${SCOPES.join(" ")}])`);
  note(`booted the REAL in-process API (buildServer composition) — GET /healthz → 200 (version ${String(health.body.version)})`);
  artifact(1, "signupEvent", { tenantId: RUN.tenantId, issuance: "mintKeyConfig → buildServer keys", secretRedacted: redact(journeyKey), mode: "test", scopes: SCOPES });
  artifact(1, "healthz", { status: health.status, body: health.body });
  setPrimary(1, `tenant ${RUN.tenantId} + ${redact(journeyKey)}`);
  emit("STEP 1 OK — signup hop asserted (key-issuance-based provisioning)");

  /* ---------------- STEP 2 — API key (one-time secret) ---------------- */

  beginStep(2, "api-key (one-time secret)", "the Stripe-grammar key route POST /v1/api-keys is attempted verbatim (the route apps/web developers-api.ts names as pending); the working secret is the step-1 composition issuance — captured one-time, redacted");

  const keyAttempt = await call(app, "POST", "/v1/api-keys", {
    key: journeyKey,
    body: { name: "Journey key", kind: "secret", mode: "test" },
    idempotencyKey: "journey-key-create-1",
  });
  must(
    2,
    keyAttempt.status === 404 && keyAttempt.body?.error?.code === "NOT_FOUND",
    "POST /v1/api-keys answered the documented typed 404 — NOT WIRED on the frozen surface (pending route named)",
    `status=${keyAttempt.status} code=${String(keyAttempt.body?.error?.code)}`,
  );
  routeTouched(2, "POST /v1/api-keys", "not-wired (pending — named in apps/web/src/lib/developers-api.ts PENDING_API_KEY_ROUTES.create)");
  note(`POST /v1/api-keys → 404 NOT_FOUND (pending route; the API-keys manager view shows this same not-wired state)`);
  note(`the one-time secret from the composition issuance (never re-displayable — the KeyStore keeps only its sha256): ${redact(journeyKey)}`);

  // The key works: first authenticated call (also proves the webhooks scope).
  const keyProbe = await call(app, "GET", "/v1/webhooks/endpoints", { key: journeyKey });
  must(2, keyProbe.status === 200 && Array.isArray(keyProbe.body?.endpoints) && keyProbe.body.endpoints.length === 0, "authenticated probe GET /v1/webhooks/endpoints → 200 with an empty list (the key works, webhooks scope held)", `status=${keyProbe.status}`);
  must(2, keyProbe.headers["x-reckon-mode"] === "test", "authenticated response carries X-Reckon-Mode: test (mode marker law)");
  routeTouched(2, "GET /v1/webhooks/endpoints (authenticated key probe)", "wired");
  artifact(2, "oneTimeSecret", { redacted: redact(journeyKey), format: "sk_test_<40 base62>", validatedBy: "mintKeyConfig → SecretApiKeySchema" });
  artifact(2, "pendingRouteAttempt", { route: "POST /v1/api-keys", status: 404, error: keyAttempt.body?.error });
  setPrimary(2, redact(journeyKey));
  emit("STEP 2 OK — api-key hop asserted (pending route named + one-time secret captured redacted)");

  /* ---------------- STEP 3 — first recommendation (test mode) ---------------- */

  beginStep(3, "decision (first recommendation)", "POST /v1/decisions with the test key and the magic item itm_test_suggest (the quickstart's canonical first call) — the canned test-mode engine answers, never the live handler");

  const decisionRequest = {
    requestId: "req-journey-1",
    tenant: { tenantId: RUN.tenantId },
    subject: { kind: "user", ref: "user-journey" },
    objective: { objectiveId: "obj-relax-1", kind: "relax" },
    attentionPolicy: { policyId: "ap-balanced-1", style: "balanced" },
    context: { contextId: "ctx-journey-1" },
    candidates: {
      setId: "cs-journey-1",
      candidates: [{ itemId: "itm_test_suggest", realizationIds: ["real-journey-1"], source: "host-retrieval" }],
    },
    policySelector: { policyId: "greedy-v1", version: "1" },
    at: 1_000,
    idempotencyKey: "journey-decision-1",
  };
  must(3, DecisionRequestSchema.safeParse(decisionRequest).success, "decision request passes the frozen DecisionRequestSchema before the call");

  const decision = await call(app, "POST", "/v1/decisions", {
    key: journeyKey,
    body: decisionRequest,
  });
  routeTouched(3, "POST /v1/decisions", "wired");
  must(3, decision.status === 200, "POST /v1/decisions → 200", `status=${decision.status}`);
  must(3, decision.headers["x-reckon-mode"] === "test", "response carries X-Reckon-Mode: test");
  must(3, decision.body?.mode === "test", "response payload carries the visible mode marker { mode: \"test\" }");
  must(3, typeof decision.body?.decisionId === "string" && decision.body.decisionId.startsWith("dec-test-"), "decision id is a canned test id (dec-test_…)", `decisionId=${String(decision.body?.decisionId)}`);
  must(3, decision.body?.action === "SUGGEST", "action = SUGGEST (scenario suggest)");
  must(
    3,
    decision.body?.selectedExperience?.itemId === "itm_test_suggest" && decision.body?.selectedExperience?.realizationId === "real-journey-1",
    "selected experience captured (experienceId + itemId=itm_test_suggest + realizationId)",
    `selectedExperience=${JSON.stringify(decision.body?.selectedExperience)}`,
  );
  must(3, decision.body?.provenance?.system === "reckon-api-test-mode", "provenance.system = reckon-api-test-mode (in-payload test marker)");
  must(3, Array.isArray(decision.body?.reasons) && decision.body.reasons.some((reason) => reason.code === "test.mode"), "reasons carry the test.mode code");
  must(3, decision.headers["idempotency-key"] === "journey-decision-1", "response echoes the idempotency key");

  const decisionId = decision.body.decisionId;
  const selectedExperienceId = decision.body.selectedExperience.experienceId;
  note(`decision envelope: decisionId=${decisionId} · action=${String(decision.body.action)} · mode=${String(decision.body.mode)}`);
  note(`selected experience: ${selectedExperienceId} (item itm_test_suggest, realization real-journey-1)`);

  // Read-back: the decision persisted in the mode-isolated TEST store.
  const decisionRead = await call(app, "GET", `/v1/decisions/${encodeURIComponent(decisionId)}`, { key: journeyKey });
  routeTouched(3, "GET /v1/decisions/{decisionId}", "wired");
  must(3, decisionRead.status === 200 && decisionRead.body?.decisionId === decisionId, "GET /v1/decisions/{id} read-back → the same decision (durable test-store row)", `status=${decisionRead.status}`);
  must(3, decisionRead.body?.mode === "test" && decisionRead.headers["x-reckon-mode"] === "test", "read-back carries the test-mode markers");

  // SEPARATION LAW: the mounted live handler never ran.
  must(3, journeyState.decisionHandlerCalls === 0, "SEPARATION LAW holds: the mounted live decision handler ran 0 times (the canned test engine answered)", `calls=${journeyState.decisionHandlerCalls}`);
  note(`separation law: mounted live decision handler invocations = 0 (test mode never executes live handler state)`);

  artifact(3, "decision", { decisionId, action: decision.body.action, mode: decision.body.mode, selectedExperience: decision.body.selectedExperience, provenance: decision.body.provenance });
  artifact(3, "readBack", { route: `GET /v1/decisions/${decisionId}`, status: decisionRead.status });
  setPrimary(3, decisionId);
  emit("STEP 3 OK — decision hop asserted (canned envelope + test-store read-back + separation law)");

  /* ---------------- STEP 4 — log entry (request trail) ---------------- */

  beginStep(4, "request-log (log entry)", "the request-log surface GET /v1/request-logs is attempted verbatim (the route the dashboard request-logs view and the latency analytics attempt); the real trail rows today's surface keeps for this call are captured");

  const logAttempt = await call(app, "GET", "/v1/request-logs", { key: journeyKey });
  must(
    4,
    logAttempt.status === 404 && logAttempt.body?.error?.code === "NOT_FOUND",
    "GET /v1/request-logs answered the documented typed 404 — NOT WIRED on the frozen surface (pending route named)",
    `status=${logAttempt.status} code=${String(logAttempt.body?.error?.code)}`,
  );
  routeTouched(4, "GET /v1/request-logs", "not-wired (pending — named in apps/web/src/lib/developers-api.ts PENDING_REQUEST_LOG_ROUTE)");
  note(`GET /v1/request-logs → 404 NOT_FOUND (pending route; the request-logs view + latency analytics show this same not-wired state)`);
  note(`call row captured for the first recommendation (driver-observed — the API-reported row arrives with the pending route): route=POST /v1/decisions · status=${decision.status} · mode=test (X-Reckon-Mode) · latency=${decision.latencyMs}ms`);

  // The mode-scoped idempotency trail row: replay the identical request.
  const decisionReplay = await call(app, "POST", "/v1/decisions", {
    key: journeyKey,
    body: decisionRequest,
  });
  must(4, decisionReplay.status === 200 && decisionReplay.body?.decisionId === decisionId, "identical re-POST replays the SAME decision id (the request row lives in the mode-scoped test idempotency store)", `decisionId=${String(decisionReplay.body?.decisionId)}`);
  must(4, decisionReplay.headers["idempotent-replayed"] === "true", "replay carries Idempotent-Replayed: true (the stored response was served)");
  must(4, journeyState.decisionHandlerCalls === 0, "replay did no new decision work (stored response, zero handler invocations)");
  note(`idempotency trail row: re-POST → Idempotent-Replayed: true · same decisionId=${decisionId} · handler invocations still 0`);

  // Honest statement: no observability decision record exists for a
  // test-mode decision (the canned path bypasses the observability-
  // wrapped live handler). Assert it rather than imply otherwise.
  const decisionRecords = sink.byKind("decision");
  must(4, decisionRecords.length === 0, "honest trail shape: 0 observability decision records for the test-mode call (the canned path never executes the observability-wrapped live handler — API-reported latency rows arrive with the pending request-logs route)", `records=${decisionRecords.length}`);

  artifact(4, "callRow", { route: "POST /v1/decisions", status: decision.status, mode: "test", latencyMs: decision.latencyMs, source: "driver-observed" });
  artifact(4, "idempotencyRow", { idempotencyKey: "journey-decision-1", replayed: true, decisionId });
  artifact(4, "pendingRouteAttempt", { route: "GET /v1/request-logs", status: 404, error: logAttempt.body?.error });
  setPrimary(4, `${decisionId} (replayed row)`);
  emit("STEP 4 OK — request-log hop asserted (pending route named + real trail rows captured)");

  /* ---------------- STEP 5 — analytics entry ---------------- */

  beginStep(5, "analytics (analytics entry)", "an outcome reports the step-3 decision back via POST /v1/outcomes so the funnel/CTR linkage has a real row; the analytics trail reads the S3-002 views consume are attempted verbatim; the REAL S3-002 data layer then computes over this journey's rows");

  const outcomeEvent = {
    eventId: "ev-journey-impression-1",
    tenant: { tenantId: RUN.tenantId },
    subject: { kind: "user", ref: "user-journey" },
    eventType: "impression",
    occurredAt: clock.now(),
    metrics: { watchRatio: 0.9 },
    evidenceClass: "controlled-local",
    decisionId,
    experienceId: selectedExperienceId,
    idempotencyKey: "journey-outcome-1",
  };
  must(5, OutcomeEventSchema.safeParse(outcomeEvent).success, "outcome event passes the frozen OutcomeEventSchema before the call");

  const outcome = await call(app, "POST", "/v1/outcomes", { key: journeyKey, body: outcomeEvent });
  routeTouched(5, "POST /v1/outcomes", "wired");
  must(5, outcome.status === 200 && outcome.body?.eventId === "ev-journey-impression-1", "POST /v1/outcomes → 200 with the eventId echoed", `status=${outcome.status}`);
  must(5, outcome.headers["x-reckon-mode"] === "test", "outcome response carries X-Reckon-Mode: test");
  must(5, journeyState.outcomesIngested.length === 1 && journeyState.outcomesIngested[0].mode === "test", "the mounted outcome ingest executed once in test mode (real handler path)");
  note(`outcome row: eventId=ev-journey-impression-1 · eventType=impression · decisionId=${decisionId} (the funnel/CTR linkage row)`);

  // The REAL observability trail row: the outcome-linkage record.
  const linkageRecords = sink.byKind("outcome-linkage");
  const linkage = linkageRecords.find((record) => record.eventId === "ev-journey-impression-1");
  must(5, linkage !== undefined, "the observability sink holds the outcome-linkage record for this outcome (the analytics data layer's linkage row)");
  must(
    5,
    linkage !== undefined && linkage.decisionId === decisionId && linkage.linked === true && linkage.outcomeEvidenceClass === "controlled-local" && typeof linkage.contentDigest === "string",
    "linkage record: decisionId linked · linked=true · evidence class carried · contentDigest present",
    `record=${JSON.stringify(linkage)}`,
  );
  note(`observability outcome-linkage record: recordId=${String(linkage?.recordId)} · linked=true · decisionId=${decisionId}`);

  // Honest statement: an impression outcome in TEST mode does NOT emit
  // recommendation.delivered — the delivery-confirmation lookup resolves
  // the LIVE decision store, which by the separation law holds no test
  // decisions (emission never invents anchors).
  must(5, !webhookClient.calls.some((call_) => call_.rawBody.includes("recommendation.delivered")), "honest emission shape: no recommendation.delivered delivery for the test-mode impression (the live-store anchor lookup finds no test decisions — fields are never invented)");

  // The pending analytics trail reads (attempted verbatim — the exact
  // routes the S3-002 views attempt).
  const pendingTrailReads = [
    { route: "GET /v1/decisions", url: "/v1/decisions", lib: "analytics-ctr-lift.ts", constant: "PENDING_DECISION_LIST_ROUTE (ctr-lift + funnel decision trail)" },
    { route: "GET /v1/outcomes", url: "/v1/outcomes", lib: "analytics-ctr-lift.ts", constant: "PENDING_OUTCOME_LIST_ROUTE (ctr-lift + funnel outcome trail)" },
    { route: "GET /v1/preferences/events", url: "/v1/preferences/events", lib: "analytics-funnel.ts", constant: "PENDING_PREFERENCE_DELTA_LIST_ROUTE (funnel preference trail)" },
  ];
  for (const read of pendingTrailReads) {
    const attempt = await call(app, "GET", read.url, { key: journeyKey });
    must(
      5,
      attempt.status === 404 && attempt.body?.error?.code === "NOT_FOUND",
      `${read.route} answered the documented typed 404 — NOT WIRED (pending trail read named in apps/web/src/lib/${read.lib}: ${read.constant})`,
      `status=${attempt.status}`,
    );
    routeTouched(5, read.route, `not-wired (pending — apps/web/src/lib/${read.lib} ${read.constant})`);
    note(`${read.route} → 404 NOT_FOUND (pending trail read)`);
  }

  // The REAL S3-002 computation over this journey's rows: run the
  // shipped strict wire guards + computeCtrLift (apps/web analytics
  // data layer) on the captured decision + outcome rows.
  const trailDecision = parseDecisionTrailRecord(decisionRead.body);
  const trailOutcome = parseOutcomeTrailRecord(outcome.body);
  must(5, trailDecision !== null, "the journey's decision row parses through the shipped ctr-lift wire guard (the exact guard the pending list read will feed)");
  must(5, trailOutcome !== null, "the journey's outcome row parses through the shipped ctr-lift wire guard");
  const ctr = computeCtrLift([trailDecision], [trailOutcome]);
  must(5, ctr.exposed.decisions === 1 && ctr.exposed.engaged === 0 && ctr.impressions === 1, "the REAL S3-002 CTR-lift computation sees this journey: exposed n=1 (the decision), impressions=1 (the linked impression)");
  must(5, ctr.unexposed.decisions === 0 && ctr.lift.absolutePct === null && ctr.lift.direction === "inconclusive", "honest result for n=1: no baseline → lift null/inconclusive (never fabricated)");
  const caveats = ctrCaveats(ctr);
  must(5, caveats.some((caveat) => caveat.id === "observational") && caveats.some((caveat) => caveat.id.startsWith("small-sample")), "the shipped caveat model renders the observational + small-sample caveats for this n=1 result");
  note(`S3-002 ctr-lift data layer over this journey: exposed={n:1, engaged:0, ctr:0, wilson:[0, ${ctr.exposed.wilsonHigh?.toFixed(3)}]} · unexposed={n:0} · lift=${JSON.stringify(ctr.lift)}`);
  note(`caveats rendered by the shipped model: ${caveats.map((caveat) => caveat.id).join(", ")}`);

  artifact(5, "outcomeRow", { eventId: outcomeEvent.eventId, eventType: "impression", decisionId, experienceId: selectedExperienceId, evidenceClass: "controlled-local" });
  artifact(5, "linkageRecord", linkage);
  artifact(5, "ctrLift", { exposed: ctr.exposed, unexposed: ctr.unexposed, lift: ctr.lift, caveatIds: caveats.map((caveat) => caveat.id) });
  setPrimary(5, `${outcomeEvent.eventId} → ${decisionId}`);
  emit("STEP 5 OK — analytics hop asserted (real outcome row + linkage record + real S3-002 computation + pending trail reads named)");

  /* ---------------- STEP 6 — webhook event ---------------- */

  beginStep(6, "webhook (webhook event)", "register an endpoint (POST /v1/webhooks/endpoints — one-time whsec_ captured), trigger the journey's own event (POST /v1/preferences/events → preference.updated), retrieve the event, poll the delivery log, and verify the signature with the SHIPPED SDK verifyWebhook");

  // 6a. Register the endpoint (empty eventTypes filter = every event type).
  const endpointCreate = await call(app, "POST", "/v1/webhooks/endpoints", {
    key: journeyKey,
    body: {
      url: "https://journey.example.test/hooks",
      description: "S4-001 journey endpoint",
      eventTypes: [],
    },
    idempotencyKey: "journey-endpoint-1",
  });
  routeTouched(6, "POST /v1/webhooks/endpoints", "wired");
  must(6, endpointCreate.status === 200, "POST /v1/webhooks/endpoints → 200 (endpoint registered)", `status=${endpointCreate.status}`);
  const whsec = endpointCreate.body?.secret;
  must(6, typeof whsec === "string" && WebhookSigningSecretSchema.safeParse(whsec).success, "one-time signing secret issued (whsec_…, schema-validated) — captured redacted in the transcript");
  must(6, typeof endpointCreate.body?.id === "string" && endpointCreate.body.id.startsWith("we_"), "endpoint id captured (we_…)");
  const endpointId = endpointCreate.body.id;
  must(6, endpointCreate.body?.tenant?.tenantId === RUN.tenantId && endpointCreate.body?.status === "enabled", "endpoint view carries the journey tenant + status=enabled");
  note(`endpoint registered: id=${endpointId} · one-time secret ${redact(whsec)} (redacted; shown exactly once by the surface)`);

  // Endpoint creation itself publishes webhook.endpoint.created, which
  // fans out to the new endpoint (empty filter matches every type).
  must(6, webhookClient.calls.length === 1 && webhookClient.calls[0]?.rawBody.includes("webhook.endpoint.created"), "the registration published webhook.endpoint.created and the engine delivered it inline (recorded outbound POST #1)", `calls=${webhookClient.calls.length}`);
  note(`lifecycle event webhook.endpoint.created delivered (outbound POST #1 captured with its exact signed bytes)`);

  // 6b. Trigger the journey's own domain event: a preference delta.
  const preferenceDelta = {
    deltaId: "delta-journey-1",
    tenant: { tenantId: RUN.tenantId },
    subject: { kind: "user", ref: "user-journey" },
    dimension: "genre.scifi",
    op: "add",
    value: 0.25,
    model: { modelId: "m-journey", version: "1" },
    timestamp: clock.now(),
  };
  must(6, PreferenceDeltaSchema.safeParse(preferenceDelta).success, "preference delta passes the frozen PreferenceDeltaSchema before the call");
  const preference = await call(app, "POST", "/v1/preferences/events", {
    key: journeyKey,
    body: preferenceDelta,
    idempotencyKey: "journey-pref-1",
  });
  routeTouched(6, "POST /v1/preferences/events", "wired");
  must(6, preference.status === 200 && preference.body?.deltaId === "delta-journey-1", "POST /v1/preferences/events → 200 (the emission-seam trigger)", `status=${preference.status}`);
  must(6, preference.headers["x-reckon-mode"] === "test", "preference response carries X-Reckon-Mode: test");
  must(6, journeyState.preferencesIngested.length === 1, "the mounted preference ingest executed once (the wrapped emission path ran)");

  // 6c. EVENT BEFORE DELIVERY: the event must be retrievable before the
  // delivery log is asserted. The recorded outbound POST #2 carries the
  // preference.updated event; its id is read from the delivered payload.
  must(6, webhookClient.calls.length === 2 && webhookClient.calls[1]?.rawBody.includes("preference.updated"), "preference.updated emitted and delivered (recorded outbound POST #2)");
  const deliveredEvent = JSON.parse(webhookClient.calls[1]?.rawBody ?? "{}");
  const eventId = deliveredEvent?.id;
  must(6, typeof eventId === "string" && eventId.startsWith("evt_"), "the delivered event carries its evt_… id", `eventId=${String(eventId)}`);

  const eventRead = await call(app, "GET", `/v1/webhooks/events/${encodeURIComponent(eventId)}`, { key: journeyKey });
  routeTouched(6, "GET /v1/webhooks/events/{eventId}", "wired");
  must(6, eventRead.status === 200 && eventRead.body?.id === eventId && eventRead.body?.type === "preference.updated", "GET /v1/webhooks/events/{id} → the stored thin event (30-day replay retention)", `status=${eventRead.status}`);
  must(6, eventRead.body?.tenant?.tenantId === RUN.tenantId, "event row carries the journey tenant");
  note(`event retrieved: id=${eventId} · type=preference.updated · tenant=${RUN.tenantId}`);

  // 6d. Poll the deliveries log.
  const deliveries = await call(app, "GET", "/v1/webhooks/deliveries", { key: journeyKey });
  routeTouched(6, "GET /v1/webhooks/deliveries", "wired");
  must(6, deliveries.status === 200 && Array.isArray(deliveries.body?.deliveries), "GET /v1/webhooks/deliveries → 200 with the delivery log", `status=${deliveries.status}`);
  const deliveryRows = deliveries.body.deliveries;
  must(6, deliveryRows.length === 2, "delivery log holds both journey deliveries (webhook.endpoint.created + preference.updated)", `rows=${deliveryRows.length}`);
  const prefDelivery = deliveryRows.find((row) => row.eventId === eventId);
  must(
    6,
    prefDelivery !== undefined && prefDelivery.endpointId === endpointId && prefDelivery.status === "succeeded" && prefDelivery.attempts === 1 && prefDelivery.responseCode === 200 && prefDelivery.error === null && typeof prefDelivery.latencyMs === "number",
    "the preference.updated delivery row: endpointId matches · status=succeeded · attempts=1 · responseCode=200 · error=null · latency recorded",
    `row=${JSON.stringify(prefDelivery)}`,
  );
  note(`delivery row: id=${String(prefDelivery?.id)} · eventId=${eventId} · status=${String(prefDelivery?.status)} · attempts=${String(prefDelivery?.attempts)} · responseCode=${String(prefDelivery?.responseCode)} · latencyMs=${String(prefDelivery?.latencyMs)}`);

  // The dashboard events-console aggregate read (attempted verbatim).
  const eventsAttempt = await call(app, "GET", "/v1/events", { key: journeyKey });
  must(
    6,
    eventsAttempt.status === 404 && eventsAttempt.body?.error?.code === "NOT_FOUND",
    "GET /v1/events answered the documented typed 404 — NOT WIRED (the events-console aggregate list; named in apps/web developers-api.ts PENDING_EVENT_ROUTES.list)",
    `status=${eventsAttempt.status}`,
  );
  routeTouched(6, "GET /v1/events", "not-wired (pending — named in apps/web/src/lib/developers-api.ts PENDING_EVENT_ROUTES.list)");
  note(`GET /v1/events → 404 NOT_FOUND (pending; the events console shows this same not-wired state today)`);

  // 6e. Verify the signature with the SHIPPED algorithm (SDK verifyWebhook
  // — the docs-named re-export of the reference implementation).
  const recorded = webhookClient.calls[1];
  const signatureHeader = recorded.headers[WEBHOOK_SIGNATURE_HEADER];
  must(6, typeof signatureHeader === "string" && signatureHeader.startsWith("t=") && signatureHeader.includes("v1="), "the delivery carried the Reckon-Signature header (t=…,v1=…)");
  const verified = verifyWebhook(recorded.rawBody, signatureHeader, whsec);
  must(6, verified === true, "SHIPPED SDK verifyWebhook(rawBody, Reckon-Signature, whsec_…) → true (HMAC-SHA256 over \"{t}.{rawBody}\", constant-time compare, 300s tolerance)");
  // Negative discriminators — the verifier must actually discriminate.
  const tamperedBody = recorded.rawBody.replace("genre.scifi", "genre.tamprd");
  must(6, tamperedBody !== recorded.rawBody, "tamper control: the body mutation actually changed bytes (never a vacuous no-op)");
  must(6, verifyWebhook(tamperedBody, signatureHeader, whsec) === false, "negative control: a tampered body fails verification");
  must(6, verifyWebhook(recorded.rawBody, signatureHeader, "whsec_00000000000000000000000000000000") === false, "negative control: the wrong secret fails verification");
  // And the lifecycle delivery (#1) verifies too — the secret is per-endpoint.
  const lifecycle = webhookClient.calls[0];
  must(6, verifyWebhook(lifecycle.rawBody, lifecycle.headers[WEBHOOK_SIGNATURE_HEADER], whsec) === true, "the webhook.endpoint.created delivery (#1) also verifies against the same endpoint secret");
  note(`signature verification (shipped verifyWebhook): positive=true · tampered-body=false · wrong-secret=false · lifecycle-delivery=true`);

  artifact(6, "event", { id: eventId, type: "preference.updated", tenantId: RUN.tenantId });
  artifact(6, "endpoint", { id: endpointId, url: "https://journey.example.test/hooks", secretRedacted: redact(whsec) });
  artifact(6, "delivery", prefDelivery);
  artifact(6, "signatureVerification", { positive: true, tamperedBody: false, wrongSecret: false, algorithm: "SDK verifyWebhook (verifyReckonSignature reference implementation)" });
  setPrimary(6, `${eventId} → ${String(prefDelivery?.id)}`);
  emit("STEP 6 OK — webhook hop asserted (endpoint + event + delivery row + shipped-algorithm signature verification)");

  /* ---------------------------- summary ---------------------------- */

  await app.close();

  const hops = RUN.steps.length;
  emit("");
  emit(`JOURNEY COMPLETE: ${hops}/6 hops asserted · exit 0 · head ${RUN.head} · evidence class observed`);
  emit("journey map (step → route → status → captured artifact):");
  for (const step of RUN.steps) {
    for (const entry of step.routes) {
      emit(`  ${step.step} ${step.name} | ${entry.route} | ${entry.status} | ${primaryArtifact(step.step)}`);
    }
  }
  return 0;
}

try {
  // S5-003 dispatch: no target flags → the S4-001 local in-process journey
  // (unchanged); --api-base/--production → the remote journey over the wire.
  const code = TARGET.remote ? await runRemoteJourney(TARGET) : await main();
  if (JSON_MODE) {
    process.stdout.write(`${JSON.stringify({ ...RUN, summary: { hopsAsserted: RUN.steps.length, exit: code } }, null, 2)}\n`);
  }
  process.exit(code);
} catch (error) {
  const step = error instanceof JourneyFailure ? error.step : currentStep;
  const hop = error instanceof JourneyFailure ? error.hop : "(unhandled)";
  const message = error instanceof Error ? error.message : String(error);
  emit("");
  emit(`JOURNEY FAILED${TARGET.remote ? " (remote)" : ""} — step ${step} (${hop}): ${message}`);
  if (!(error instanceof JourneyFailure) && error instanceof Error && error.stack !== undefined) {
    emit(error.stack.split("\n").slice(1, 4).join("\n"));
  }
  if (JSON_MODE) {
    process.stdout.write(
      `${JSON.stringify({ ...RUN, summary: { hopsAsserted: RUN.steps.length, exit: 1 }, failure: { step, hop, message } }, null, 2)}\n`,
    );
  }
  process.exit(1);
}
