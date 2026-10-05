import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { generateSecretKey, generatePublishableKey, PublishableApiKeySchema } from "@reckon/contracts";
import {
  PENDING_API_KEY_ROUTES,
  PENDING_EVENT_ROUTES,
  PENDING_REQUEST_LOG_ROUTE,
} from "../../../apps/web/src/lib/developers-api.js";
import {
  PENDING_DECISION_LIST_ROUTE,
  PENDING_OUTCOME_LIST_ROUTE,
} from "../../../apps/web/src/lib/analytics-ctr-lift.js";
import { PENDING_PREFERENCE_DELTA_LIST_ROUTE } from "../../../apps/web/src/lib/analytics-funnel.js";
import { WORKSPACE_ROUTES } from "../../../apps/web/src/lib/workspace.js";
import { QUICKSTART_STEPS } from "../../../apps/docs/src/content/quickstart.js";
import {
  headerNav,
  hero,
  products,
} from "../../../apps/marketing/src/lib/marketing-content.js";
import { calculatorCopy } from "../../../apps/marketing/src/lib/pricing-content.js";

/**
 * S4-001 lockstep — the journey-proof doc, the journey driver and the
 * frozen route surface must agree. Doc-drift fails this test.
 *
 * Three sources are machine-compared:
 *
 *  1. THE FROZEN SURFACE — the real buildServer route registrations
 *     (`app.hasRoute`): every route the doc's journey map marks "wired"
 *     must exist; every route it marks "not-wired" must genuinely be
 *     absent, and its name must match the shipped dashboard pending-route
 *     constant verbatim (the constants the dashboard views render).
 *  2. THE DRIVER — `scripts/e2e-journey.mjs` runs for real (child
 *     process, --json machine capture): exit 0, six hops in the
 *     documented order (key before decision, decision before log row,
 *     event before delivery), and its touched-route sequence must equal
 *     the doc's journey map row-for-row.
 *  3. THE DOC — `docs/handoff/e2e-journey-proof.md` parses: its §3
 *     journey map table must equal the expected map below exactly (step,
 *     route, status, order), its §5 not-wired register must name every
 *     pending route, and it must carry the re-run command, the real
 *     transcript and the evidence-class labels.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const DOC_PATH = join(REPO_ROOT, "docs", "handoff", "e2e-journey-proof.md");
const DRIVER_PATH = join(REPO_ROOT, "scripts", "e2e-journey.mjs");

/* ------------------------------------------------------------------ *
 * The expected journey map (the documented order — the lockstep target)
 * ------------------------------------------------------------------ */

export interface ExpectedMapRow {
  readonly step: number;
  /** null = the composition-seam row (signup is key-issuance-based — no HTTP route). */
  readonly route: string | null;
  readonly status: "wired" | "not-wired";
}

export const EXPECTED_JOURNEY_MAP: readonly ExpectedMapRow[] = [
  { step: 1, route: "GET /healthz", status: "wired" },
  { step: 1, route: null, status: "wired" },
  { step: 2, route: "POST /v1/api-keys", status: "not-wired" },
  { step: 2, route: "GET /v1/webhooks/endpoints", status: "wired" },
  { step: 3, route: "POST /v1/decisions", status: "wired" },
  { step: 3, route: "GET /v1/decisions/{decisionId}", status: "wired" },
  { step: 4, route: "GET /v1/request-logs", status: "not-wired" },
  { step: 5, route: "POST /v1/outcomes", status: "wired" },
  { step: 5, route: "GET /v1/decisions", status: "not-wired" },
  { step: 5, route: "GET /v1/outcomes", status: "not-wired" },
  { step: 5, route: "GET /v1/preferences/events", status: "not-wired" },
  { step: 6, route: "POST /v1/webhooks/endpoints", status: "wired" },
  { step: 6, route: "POST /v1/preferences/events", status: "wired" },
  { step: 6, route: "GET /v1/webhooks/events/{eventId}", status: "wired" },
  { step: 6, route: "GET /v1/webhooks/deliveries", status: "wired" },
  { step: 6, route: "GET /v1/events", status: "not-wired" },
];

const EXPECTED_ROUTE_ROWS: readonly ExpectedMapRow[] = EXPECTED_JOURNEY_MAP.filter(
  (row) => row.route !== null,
);

const EXPECTED_HOP_NAMES = [
  "signup (account provisioning)",
  "api-key (one-time secret)",
  "decision (first recommendation)",
  "request-log (log entry)",
  "analytics (analytics entry)",
  "webhook (webhook event)",
] as const;

/** The pending routes + the shipped dashboard constants that name them. */
const PENDING_ROUTE_CONSTANTS: readonly { route: string; constant: string; value: string }[] = [
  { route: "POST /v1/api-keys", constant: "developers-api.ts PENDING_API_KEY_ROUTES.create", value: PENDING_API_KEY_ROUTES.create },
  { route: "GET /v1/request-logs", constant: "developers-api.ts PENDING_REQUEST_LOG_ROUTE", value: PENDING_REQUEST_LOG_ROUTE },
  { route: "GET /v1/decisions", constant: "analytics-ctr-lift.ts PENDING_DECISION_LIST_ROUTE", value: PENDING_DECISION_LIST_ROUTE },
  { route: "GET /v1/outcomes", constant: "analytics-ctr-lift.ts PENDING_OUTCOME_LIST_ROUTE", value: PENDING_OUTCOME_LIST_ROUTE },
  { route: "GET /v1/preferences/events", constant: "analytics-funnel.ts PENDING_PREFERENCE_DELTA_LIST_ROUTE", value: PENDING_PREFERENCE_DELTA_LIST_ROUTE },
  { route: "GET /v1/events", constant: "developers-api.ts PENDING_EVENT_ROUTES.list", value: PENDING_EVENT_ROUTES.list },
];

/* ------------------------------------------------------------------ *
 * Driver runtime report (machine capture)
 * ------------------------------------------------------------------ */

interface JourneyRouteTouch {
  readonly route: string;
  readonly status: string;
}

interface JourneyStepRow {
  readonly step: number;
  readonly name: string;
  readonly routes: readonly JourneyRouteTouch[];
}

interface JourneyReport {
  readonly steps: readonly JourneyStepRow[];
  readonly summary: { readonly hopsAsserted: number; readonly exit: number };
}

function canonicalRoute(label: string): string {
  const match = /^(GET|POST|PUT|DELETE|PATCH) (\/\S+)/.exec(label);
  if (match === null) throw new Error(`driver drift: unrecognized route label '${label}'`);
  return `${match[1]} ${match[2]}`;
}

function canonicalStatus(status: string): "wired" | "not-wired" {
  return status.startsWith("not-wired") ? "not-wired" : "wired";
}

function runDriver(): JourneyReport {
  try {
    const stdout = execFileSync(process.execPath, [DRIVER_PATH, "--json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(stdout) as JourneyReport;
  } catch (error) {
    const failure = error as { status?: number; stderr?: string; message?: string };
    throw new Error(
      `journey driver did not complete (exit ${String(failure.status)}): ${failure.message ?? ""}\n${failure.stderr ?? ""}`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * Doc parsing
 * ------------------------------------------------------------------ */

function docSection(doc: string, headingPrefix: string): string {
  const lines = doc.split("\n");
  const start = lines.findIndex((line) => line.startsWith(headingPrefix));
  if (start < 0) throw new Error(`doc drift: heading not found (expected a line starting with '${headingPrefix}')`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index]?.startsWith("## ")) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function parseJourneyMapRows(doc: string): { step: number; route: string | null; status: string; raw: string }[] {
  const section = docSection(doc, "## 3. Journey map");
  const rows: { step: number; route: string | null; status: string; raw: string }[] = [];
  for (const line of section.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    const stepText = cells[1] ?? "";
    if (!/^[1-6]$/.test(stepText)) continue; // header + separator rows
    const routeCell = cells[4] ?? "";
    const statusCell = cells[5] ?? "";
    const status = statusCell.startsWith("not-wired")
      ? "not-wired"
      : statusCell.startsWith("wired")
        ? "wired"
        : null;
    if (status === null) {
      throw new Error(`doc drift: unrecognized status cell '${statusCell}' in journey-map row: ${line}`);
    }
    const match = /(GET|POST|PUT|DELETE|PATCH) (\/[^\s`]+)/.exec(routeCell);
    rows.push({ step: Number(stepText), route: match === null ? null : `${match[1]} ${match[2]}`, status, raw: line });
  }
  return rows;
}

/** fastify's param syntax: /v1/decisions/{decisionId} → /v1/decisions/:decisionId */
function fastifyUrl(routePath: string): string {
  return routePath.replace(/\{([^}]+)\}/g, ":$1");
}

/* ------------------------------------------------------------------ *
 * The lockstep
 * ------------------------------------------------------------------ */

describe("S4-001 journey lockstep: doc ↔ driver ↔ frozen surface", () => {
  let app: FastifyInstance;
  let report: JourneyReport;
  let doc: string;
  let driverSource: string;

  beforeAll(() => {
    app = buildServer({
      keys: [
        {
          apiKey: generateSecretKey("test"),
          tenantId: "journey-map-lockstep",
          scopes: ["decisions", "outcomes", "webhooks"],
        },
      ],
    });
    doc = readFileSync(DOC_PATH, "utf8");
    driverSource = readFileSync(DRIVER_PATH, "utf8");
    report = runDriver();
  }, 180_000);

  afterAll(async () => {
    await app.close();
  });

  it("the driver completes the real journey: exit 0, six hops, documented order", () => {
    expect(report.summary.exit).toBe(0);
    expect(report.summary.hopsAsserted).toBe(6);
    expect(report.steps.map((step) => step.step)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(report.steps.map((step) => step.name)).toEqual([...EXPECTED_HOP_NAMES]);
  });

  it("driver assertion order: key before decision, decision before log row, event before delivery", () => {
    const stepOf = (route: string): number => {
      const step = report.steps.find((candidate) =>
        candidate.routes.some((touch) => canonicalRoute(touch.route) === route),
      );
      if (step === undefined) throw new Error(`driver drift: route '${route}' was never touched`);
      return step.step;
    };
    // key before decision (the one-time-secret hop precedes the first recommendation)
    expect(stepOf("POST /v1/api-keys")).toBeLessThan(stepOf("POST /v1/decisions"));
    // decision before log row (the first call precedes the request-log read)
    expect(stepOf("POST /v1/decisions")).toBeLessThan(stepOf("GET /v1/request-logs"));
    // event before delivery (within the webhook hop, the event is retrieved before the log is polled)
    const webhookStep = report.steps.find((step) => step.step === 6);
    expect(webhookStep).toBeDefined();
    const routeOrder = (webhookStep?.routes ?? []).map((touch) => canonicalRoute(touch.route));
    expect(routeOrder.indexOf("GET /v1/webhooks/events/{eventId}")).toBeLessThan(
      routeOrder.indexOf("GET /v1/webhooks/deliveries"),
    );
  });

  it("the driver's touched-route sequence equals the documented journey map exactly", () => {
    const runtimeRows = report.steps.flatMap((step) =>
      step.routes.map((touch) => ({
        step: step.step,
        route: canonicalRoute(touch.route),
        status: canonicalStatus(touch.status),
      })),
    );
    expect(runtimeRows).toEqual([...EXPECTED_ROUTE_ROWS]);
  });

  it("every route the doc marks wired exists on the frozen surface; every pending route is genuinely absent", () => {
    for (const row of EXPECTED_ROUTE_ROWS) {
      expect(row.route).not.toBeNull();
      const [method, path] = (row.route as string).split(" ");
      const registered = app.hasRoute({ method, url: fastifyUrl(path) });
      expect(
        { route: row.route, registered },
        `route '${row.route}' is marked '${row.status}' in the journey map`,
      ).toEqual({ route: row.route, registered: row.status === "wired" });
    }
  });

  it("the pending route names match the shipped dashboard constants verbatim", () => {
    for (const entry of PENDING_ROUTE_CONSTANTS) {
      expect(entry.value, `shipped constant ${entry.constant}`).toBe(entry.route);
    }
    // and the constants are exactly what the doc's not-wired register names
    const register = docSection(doc, "## 5. Not-wired register");
    for (const entry of PENDING_ROUTE_CONSTANTS) {
      expect(register).toContain(entry.route);
    }
  });

  it("the doc's journey map table matches the expected map row-for-row (doc-drift fails here)", () => {
    const rows = parseJourneyMapRows(doc);
    expect(rows.map(({ step, route, status }) => ({ step, route, status }))).toEqual([
      ...EXPECTED_JOURNEY_MAP,
    ]);
    // exactly one composition-seam row (signup = key issuance, no HTTP route)
    const compositionRows = rows.filter((row) => row.route === null);
    expect(compositionRows).toHaveLength(1);
    expect(compositionRows[0]?.raw).toContain("mintKeyConfig");
    expect(compositionRows[0]?.raw).toContain("buildServer");
  });

  it("the doc carries the re-run command, the real transcript and the evidence-class labels", () => {
    expect(doc).toContain("node scripts/e2e-journey.mjs");
    const transcript = docSection(doc, "## 4. Captured transcript");
    expect(transcript).toContain("JOURNEY COMPLETE: 6/6 hops asserted");
    const transcriptMarkers = ["STEP 1 signup", "STEP 2 api-key", "STEP 3 decision", "STEP 4 request-log", "STEP 5 analytics", "STEP 6 webhook"];
    let previous = -1;
    for (const marker of transcriptMarkers) {
      const index = transcript.indexOf(marker);
      expect(index, `transcript must contain '${marker}'`).toBeGreaterThan(previous);
      previous = index;
    }
    expect(docSection(doc, "## 7. Evidence classes used in this document")).toContain("observed");
  });

  it("the driver source keeps the six hop sections, once each, in the documented order", () => {
    const markers = [
      "STEP 1 — signup",
      "STEP 2 — API key",
      "STEP 3 — first recommendation",
      "STEP 4 — log entry",
      "STEP 5 — analytics entry",
      "STEP 6 — webhook event",
    ];
    let previous = -1;
    for (const marker of markers) {
      const occurrences = driverSource.split(marker).length - 1;
      expect(occurrences, `driver section '${marker}' must appear exactly once`).toBe(1);
      const index = driverSource.indexOf(marker);
      expect(index).toBeGreaterThan(previous);
      previous = index;
    }
    // The signature verification uses the SHIPPED algorithm (SDK verifyWebhook).
    expect(driverSource).toContain("packages/sdk/src/index.js");
    expect(driverSource).toContain("verifyWebhook");
  });
});

/* ================================================================== *
 * S5-003 lockstep — the driver's multi-target flags, the production
 * verification script, the doc's production sections and the frozen
 * surface must agree (the tests/deployment/verify-deployment.test.ts
 * pattern extended to the four LIVE surfaces). Marker drift in the
 * shipped app sources or in the scripts fails HERE, never in a gate run.
 * ================================================================== */

const VERIFY_PRODUCTION_PATH = join(REPO_ROOT, "scripts", "verify-production.mjs");

/** Extract a `const NAME = ["a","b"];` string array from a script source. */
function stringArrayFrom(source: string, name: string): string[] {
  const match = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(source);
  if (match === null) throw new Error(`script drift: '${name}' array not found`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1] ?? "");
}

describe("S5-003 production lockstep: driver flags ↔ verify-production ↔ doc ↔ frozen surface", () => {
  let s5App: FastifyInstance;
  let s5Key: string;
  let verifyProductionSource: string;
  let docSource: string;
  let driverSourceS5: string;

  const pkProbe = generatePublishableKey("live");

  beforeAll(() => {
    s5Key = generateSecretKey("test");
    s5App = buildServer({
      keys: [
        {
          apiKey: s5Key,
          tenantId: "s5-003-lockstep",
          scopes: ["decisions", "outcomes", "webhooks"],
        },
      ],
    });
    verifyProductionSource = readFileSync(VERIFY_PRODUCTION_PATH, "utf8");
    docSource = readFileSync(DOC_PATH, "utf8");
    driverSourceS5 = readFileSync(DRIVER_PATH, "utf8");
  });

  afterAll(async () => {
    await s5App.close();
  });

  /* ---------------- the driver's target-flag contract ---------------- */

  it("the driver wires the S5-003 target flags and env names (and keeps the local default)", () => {
    for (const marker of [
      "--api-base",
      "--web-base",
      "--tenant-id",
      "--api-key",
      "--production",
      "RECKON_JOURNEY_API_KEY",
      "RECKON_JOURNEY_TENANT_ID",
      "RECKON_JOURNEY_WEB_BASE",
    ]) {
      expect(driverSourceS5, `driver must wire '${marker}'`).toContain(marker);
    }
    // The local default: no target flags → the S4-001 in-process path.
    expect(driverSourceS5).toContain('return { remote: false };');
    // The remote journey exists exactly once and the local main() is kept.
    expect(driverSourceS5.match(/async function runRemoteJourney\(/g)).toHaveLength(1);
    expect(driverSourceS5.match(/async function main\(\)/g)).toHaveLength(1);
    expect(driverSourceS5).toContain(
      'const code = TARGET.remote ? await runRemoteJourney(TARGET) : await main();',
    );
  });

  it("the remote journey handles the three honest webhook-hop deployment states (never fakes one)", () => {
    for (const marker of [
      '"full-parity"',
      '"production-composition-structural-gap"',
      "predates S2-002",
      "NOT_WIRED",
    ]) {
      expect(driverSourceS5, `remote webhook-hop handling must name ${marker}`).toContain(marker);
    }
    // The remote mode honestly names what is NOT wire-observable.
    expect(driverSourceS5).toContain("NOT wire-observable");
    expect(driverSourceS5).toContain("untested-in-prod");
  });

  it("the driver's usage/refusal contract (fast exits, before any heavy imports)", () => {
    const run = (args: string[], env: Record<string, string> = {}) =>
      spawnSync(process.execPath, [DRIVER_PATH, ...args], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 30_000,
        env: { ...process.env, RECKON_JOURNEY_API_KEY: "", RECKON_JOURNEY_TENANT_ID: "", ...env },
      });
    // --help exits 0 with the usage lines.
    const help = run(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("--api-base");
    expect(help.stdout).toContain("--production");
    // --production without env key material refuses (exit 2, names the env var).
    const prod = run(["--production"]);
    expect(prod.status).toBe(2);
    expect(prod.stderr).toContain("RECKON_JOURNEY_API_KEY");
    // --api-key is refused on a --production run (secrets never ride argv).
    const argvKey = run(["--production", "--api-key", "sk_test_x"], {
      RECKON_JOURNEY_TENANT_ID: "some-tenant",
    });
    expect(argvKey.status).toBe(2);
    expect(argvKey.stderr).toContain("never from argv");
    // A malformed --api-base refuses.
    const badUrl = run(["--api-base", "not-a-url"]);
    expect(badUrl.status).toBe(2);
    expect(badUrl.stderr).toContain("not a valid http(s) URL");
    // A remote run without the tenant id refuses (body-tenant law).
    const noTenant = run(["--api-base", "https://example.org"]);
    expect(noTenant.status).toBe(2);
    expect(noTenant.stderr).toContain("RECKON_JOURNEY_TENANT_ID");
    // --web-base without --api-base/--production refuses.
    const lonelyWeb = run(["--web-base", "https://example.org"]);
    expect(lonelyWeb.status).toBe(2);
    expect(lonelyWeb.stderr).toContain("--web-base without --api-base");
  });

  /* -------- verify-production.mjs ↔ the SHIPPED SOURCES (markers) ------ */

  it("the web nav IA the gate probes is exactly the shipped WORKSPACE_ROUTES navLabel rail", () => {
    const scriptNav = stringArrayFrom(verifyProductionSource, "WEB_NAV_IA");
    const shippedRail = WORKSPACE_ROUTES.filter(
      (route) => route.navGroup === "landing" || route.navGroup === "operate" || route.navGroup === "developers" || route.navGroup === "account",
    )
      .filter((route) => !route.parentHref)
      .map((route) => route.navLabel);
    // The S3-001 dashboard rail: Home · Recommendations · Models · Data Sources · Analytics · Developers · Settings
    expect(scriptNav).toEqual([
      "Home",
      "Recommendations",
      "Models",
      "Data Sources",
      "Analytics",
      "Developers",
      "Settings",
    ]);
    expect(scriptNav.every((label) => shippedRail.includes(label))).toBe(true);
    expect(shippedRail).toContain("Settings");
  });

  it("the docs identity + quickstart-tab markers are exactly the shipped constants", () => {
    const identity = stringArrayFrom(verifyProductionSource, "DOCS_IDENTITY_MARKERS");
    expect(identity).toEqual(["Reckon Docs", "Reckon documentation"]);
    const docsPage = readFileSync(join(REPO_ROOT, "apps/docs/src/app/page.tsx"), "utf8");
    expect(docsPage).toContain("Reckon Docs");
    expect(docsPage).toContain("Reckon documentation");

    const scriptTabs = stringArrayFrom(verifyProductionSource, "DOCS_QUICKSTART_TABS");
    const shippedTabs = QUICKSTART_STEPS.flatMap((step) =>
      step.tabs !== undefined ? step.tabs.map((tab) => tab.label) : [],
    );
    expect(scriptTabs).toEqual(["Hosted endpoint", "TypeScript SDK", "Streaming"]);
    expect(shippedTabs).toEqual(scriptTabs);
  });

  it("the marketing brand/nav/calculator/product markers are exactly the shipped copy", () => {
    expect(verifyProductionSource).toContain(JSON.stringify("Recommendation infrastructure"));
    expect(hero.headline[0]).toBe("Recommendation infrastructure");
    const scriptNav = stringArrayFrom(verifyProductionSource, "MARKETING_NAV_LABELS");
    expect(scriptNav).toEqual(headerNav.map((item) => item.label));
    expect(scriptNav).toEqual(["Product", "Docs", "Pricing"]);
    expect(verifyProductionSource).toContain('id="calculator"');
    expect(verifyProductionSource).toContain(JSON.stringify(calculatorCopy.title));
    expect(verifyProductionSource).toContain('"/products/recommendation-api"');
    expect(products[0]?.href).toBe("/products/recommendation-api");
    const calculatorComponent = readFileSync(
      join(REPO_ROOT, "apps/marketing/src/components/marketing/volume-calculator.tsx"),
      "utf8",
    );
    expect(calculatorComponent).toContain('id="calculator"');
  });

  it("the production URL defaults are the four LIVE domains the doc names", () => {
    for (const domain of [
      "https://reckon-api-phi.vercel.app",
      "https://reckon-web-nine.vercel.app",
      "https://reckon-docs.vercel.app",
      "https://reckon-marketing.vercel.app",
    ]) {
      expect(verifyProductionSource).toContain(domain);
      expect(docSource, `the doc §9 must name the LIVE domain ${domain}`).toContain(domain);
    }
  });

  it("the pk_live_ probe is a schema-valid publishable shape (a shape probe, never key material)", () => {
    expect(PublishableApiKeySchema.safeParse(pkProbe).success).toBe(true);
    expect(verifyProductionSource).toContain("pk_live_");
    expect(verifyProductionSource).toContain("never real key material");
  });

  /* ------- the frozen-surface behaviors the drift register measures ----- */

  it("frozen surface: unauthenticated typed 401 carries the FULL S2-001 catalog envelope (class + doc_url)", async () => {
    const res = await s5App.inject({ method: "GET", url: "/v1/decisions/dec-s5-003-lockstep" });
    expect(res.statusCode).toBe(401);
    const error = res.json().error;
    expect(error.code).toBe("UNAUTHENTICATED");
    expect(error.class).toBe("authentication_error");
    expect(typeof error.doc_url).toBe("string");
    expect(error.doc_url.length).toBeGreaterThan(0);
    expect(error.message).toContain("Missing Authorization header");
  });

  it("frozen surface: a pk_live_ key gets the DEDICATED publishable-key rejection", async () => {
    const res = await s5App.inject({
      method: "GET",
      url: "/v1/decisions/dec-s5-003-lockstep",
      headers: { authorization: `Bearer ${pkProbe}` },
    });
    expect(res.statusCode).toBe(401);
    const error = res.json().error;
    expect(error.code).toBe("UNAUTHENTICATED");
    expect(error.class).toBe("authentication_error");
    expect(error.message).toContain("Publishable keys");
    expect(error.message).toContain("sk_live_/sk_test_");
  });

  it("frozen surface: a garbage key gets the typed unknown-key 401", async () => {
    const res = await s5App.inject({
      method: "GET",
      url: "/v1/decisions/dec-s5-003-lockstep",
      headers: { authorization: "Bearer garbage-not-a-reckon-key-shape" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHENTICATED");
    expect(res.json().error.message).toContain("Unknown or invalid API key");
  });

  it("frozen surface: an unsupported X-Reckon-Version WITH a valid key → typed 400 VALIDATION_ERROR naming the header (the machine-verified counterpart of the documented production behavior)", async () => {
    const bad = await s5App.inject({
      method: "GET",
      url: "/v1/decisions/dec-s5-003-lockstep",
      headers: { authorization: `Bearer ${s5Key}`, "x-reckon-version": "2099-99-99" },
    });
    expect(bad.statusCode).toBe(400);
    const error = bad.json().error;
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.class).toBe("invalid_request_error");
    expect(error.param).toBe("X-Reckon-Version");
    expect(error.details?.supportedVersions).toBeDefined();
    // The discriminator: the SAME call without the header passes version
    // negotiation and reaches the handler — the mode-scoped test-store
    // miss (no handler ports mounted in this harness) answers the typed
    // 404 NOT_FOUND, proving the 400 above came from the version check,
    // nothing else.
    const bare = await s5App.inject({
      method: "GET",
      url: "/v1/decisions/dec-s5-003-lockstep",
      headers: { authorization: `Bearer ${s5Key}` },
    });
    expect(bare.statusCode).toBe(404);
    expect(bare.json().error.code).toBe("NOT_FOUND");
    expect(bare.headers["x-reckon-mode"]).toBe("test");
  });

  it("frozen surface: the auth order law — authenticate BEFORE version negotiation (no key + bad version → 401)", async () => {
    const res = await s5App.inject({
      method: "GET",
      url: "/v1/decisions/dec-s5-003-lockstep",
      headers: { "x-reckon-version": "2099-99-99" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHENTICATED");
  });

  it("frozen surface: the S2-002 webhook route family IS registered (the deployed pre-wave-2 surface is not)", () => {
    expect(s5App.hasRoute({ method: "GET", url: "/v1/webhooks/endpoints" })).toBe(true);
    expect(s5App.hasRoute({ method: "POST", url: "/v1/webhooks/endpoints" })).toBe(true);
    expect(s5App.hasRoute({ method: "GET", url: "/v1/webhooks/deliveries" })).toBe(true);
  });

  /* ------------------- the doc's S5-003 structure --------------------- */

  it("the doc carries the S5-003 production sections (verification table, drift register, runbook) — doc-drift fails here", () => {
    const section9 = docSection(docSource, "## 9. Production verification (S5-003)");
    for (const rowId of ["api-1", "api-2", "api-3", "api-4", "api-5", "api-6", "web-1", "web-2", "docs-1", "docs-2", "docs-3", "mkt-1", "mkt-2", "mkt-3", "x-1"]) {
      expect(section9, `§9.1 must carry the ${rowId} row`).toContain(`| ${rowId} |`);
    }
    expect(section9).toContain("13/15 packet assertions green");
    expect(section9).toContain("drift register");
    for (const driftRow of ["| A1 |", "| A2 |", "| A3 |", "| A4 |", "| W1 |", "| W3 |", "| C1 |", "| C2 |"]) {
      expect(section9, `§9.2 must carry the ${driftRow} drift row`).toContain(driftRow);
    }
    const section10 = docSection(docSource, "## 10. Production journey gap analysis + runbook");
    for (const marker of [
      "RECKON_API_KEYS",
      "sk_test_",
      "RECKON_JOURNEY_API_KEY",
      "RECKON_JOURNEY_TENANT_ID",
      "--production",
      "redeploy",
    ]) {
      expect(section10, `§10 runbook must name ${marker}`).toContain(marker);
    }
    expect(docSection(docSource, "## 11. Evidence classes used in the S5-003 sections")).toContain(
      "untested-in-prod",
    );
    expect(docSource).toContain("## 12. Lockstep test (S5-003 extension)");
    // The S4-001 sections stay intact (the addendum law).
    for (const heading of [
      "## 1. What this proves",
      "## 2. Re-run command (exact)",
      "## 3. Journey map (step → surface → route → captured artifact)",
      "## 4. Captured transcript (REAL run — evidence class: observed)",
      "## 5. Not-wired register (the honest hops)",
      "## 6. Dashboard-visibility map (which view shows each captured artifact)",
      "## 7. Evidence classes used in this document",
      "## 8. Lockstep test",
    ]) {
      expect(docSource).toContain(heading);
    }
  });
});
