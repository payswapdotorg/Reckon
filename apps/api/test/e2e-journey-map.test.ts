import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { generateSecretKey } from "@reckon/contracts";
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
