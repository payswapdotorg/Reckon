import { describe, it, expect, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * S4-002 lockstep — the deployment verification gate
 * (`scripts/verify-deployment.mjs`) must keep agreeing with:
 *
 *  1. THE SHIPPED SURFACES — the content markers the gate probes for
 *     must exist verbatim in the shipped app sources (marker drift in
 *     apps/web / apps/docs / apps/marketing fails here, never in the
 *     Lead's post-deploy gate run).
 *  2. THE ARG CONTRACT — missing env prints the usage line naming all
 *     four required variables and exits non-zero; --help exits 0.
 *  3. THE PROBE SHAPE — against stub servers that speak the frozen
 *     response shapes (api /healthz envelope + typed 401 envelope; the
 *     three HTML markers) the gate passes 4/4 and exits 0; a surface
 *     answering the wrong shape produces its per-surface FAIL line and
 *     exit 1.
 *
 * EVIDENCE CLASS: controlled-local (stub servers; the gate's assertions
 * on the real frozen shapes are cross-checked against the shipped
 * sources in §1 — the same law as the S4-001 journey-map lockstep).
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const scriptPath = join(repoRoot, "scripts", "verify-deployment.mjs");

const MARKERS = [
  {
    id: "web",
    marker: "Reckon Studio",
    source: join(repoRoot, "apps/web/src/components/shell/site-header.tsx"),
  },
  {
    id: "docs",
    marker: "Reckon documentation",
    source: join(repoRoot, "apps/docs/src/app/page.tsx"),
  },
  {
    id: "marketing",
    marker: "Recommendation infrastructure",
    source: join(repoRoot, "apps/marketing/src/lib/marketing-content.ts"),
  },
] as const;

/* ---------------------- stub servers (frozen shapes) ------------------ */

const servers: Server[] = [];

interface ServerResponseStub {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body: string): void;
}

function startStub(handler: (req: { url: string }, res: ServerResponseStub) => void): Promise<string> {
  const server = createServer(handler as never);
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function apiStubUrl(): Promise<string> {
  return startStub((req, res) => {
    if (req.url === "/healthz") {
      res.setHeader("content-type", "application/json");
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, version: "0.1.0", contractsVersion: "1.2.0" }));
      return;
    }
    if (req.url === "/v1/decisions/vd-gate-probe") {
      res.setHeader("content-type", "application/json");
      res.statusCode = 401;
      res.end(
        JSON.stringify({
          error: {
            class: "authentication_error",
            code: "UNAUTHENTICATED",
            message: "Missing Authorization header (expected 'Authorization: Bearer <key>')",
          },
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end("");
  });
}

function htmlStubUrl(body: string): Promise<string> {
  return startStub((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.statusCode = 200;
    res.end(`<!doctype html><html lang="en"><body>${body}</body></html>`);
  });
}

afterAll(async () => {
  await Promise.all(
    servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

/* --------------------------- spawn helper ----------------------------- */

interface GateRun {
  code: number;
  stdout: string;
  stderr: string;
}

function runGate(env: NodeJS.ProcessEnv): Promise<GateRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/* ------------------------------- tests -------------------------------- */

describe("S4-002 deployment gate — marker lockstep against the shipped sources", () => {
  for (const { id, marker, source } of MARKERS) {
    it(`${id} marker ${JSON.stringify(marker)} exists verbatim in the shipped source`, () => {
      const text = readFileSync(source, "utf8");
      expect(text.includes(marker)).toBe(true);
    });
  }
});

describe("S4-002 deployment gate — arg contract", () => {
  it("missing env: usage line naming all four variables, exit non-zero", async () => {
    const env: NodeJS.ProcessEnv = {};
    for (const key of [
      "RECKON_API_URL",
      "RECKON_WEB_URL",
      "RECKON_DOCS_URL",
      "RECKON_MARKETING_URL",
    ]) {
      env[key] = "";
    }
    const run = await runGate(env);
    expect(run.code).not.toBe(0);
    const combined = run.stdout + run.stderr;
    expect(combined).toContain("env-missing");
    for (const key of [
      "RECKON_API_URL",
      "RECKON_WEB_URL",
      "RECKON_DOCS_URL",
      "RECKON_MARKETING_URL",
    ]) {
      expect(combined).toContain(key);
    }
    expect(combined).toContain("usage: node scripts/verify-deployment.mjs");
  });

  it("--help: usage on stdout, exit 0", async () => {
    const child = spawn(process.execPath, [scriptPath, "--help"], { cwd: repoRoot });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    expect(code).toBe(0);
    expect(stdout).toContain("usage: node scripts/verify-deployment.mjs");
    expect(stdout).toContain("RECKON_API_URL");
    expect(stderr).toBe("");
  });

  it("malformed URL: usage error, exit non-zero", async () => {
    const run = await runGate({
      RECKON_API_URL: "not-a-url",
      RECKON_WEB_URL: "https://web.example",
      RECKON_DOCS_URL: "https://docs.example",
      RECKON_MARKETING_URL: "https://marketing.example",
    });
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain("malformed env");
  });
});

describe("S4-002 deployment gate — probe shape over stub servers", () => {
  it("all four surfaces answering the frozen shapes → GATE: PASS, exit 0", async () => {
    const [apiUrl, webUrl, docsUrl, marketingUrl] = await Promise.all([
      apiStubUrl(),
      htmlStubUrl("<h1>Reckon Studio</h1>"),
      htmlStubUrl('<p class="page-eyebrow">Reckon documentation</p>'),
      htmlStubUrl("<h1>Recommendation infrastructure</h1>"),
    ]);
    const run = await runGate({
      RECKON_API_URL: apiUrl,
      RECKON_WEB_URL: webUrl,
      RECKON_DOCS_URL: docsUrl,
      RECKON_MARKETING_URL: marketingUrl,
    });
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("PASS api · GET /healthz");
    expect(run.stdout).toContain("200 ok=true version=0.1.0");
    expect(run.stdout).toContain("PASS api · GET /v1/decisions/vd-gate-probe");
    expect(run.stdout).toContain("401 error.code=UNAUTHENTICATED error.class=authentication_error");
    expect(run.stdout).toContain('PASS web · GET / → 200 + "Reckon Studio"');
    expect(run.stdout).toContain('PASS docs · GET / → 200 + "Reckon documentation"');
    expect(run.stdout).toContain('PASS marketing · GET / → 200 + "Recommendation infrastructure"');
    expect(run.stdout).toContain("GATE: PASS — 4/4 surfaces verified");
  });

  it("a surface missing its marker → per-surface FAIL line + GATE: FAIL, exit 1", async () => {
    const [apiUrl, webUrl, docsUrl, marketingUrl] = await Promise.all([
      apiStubUrl(),
      htmlStubUrl("<h1>Reckon Studio</h1>"),
      htmlStubUrl("<p>Reckon documentation</p>"),
      htmlStubUrl("<h1>Some other site entirely</h1>"), // marker absent
    ]);
    const run = await runGate({
      RECKON_API_URL: apiUrl,
      RECKON_WEB_URL: webUrl,
      RECKON_DOCS_URL: docsUrl,
      RECKON_MARKETING_URL: marketingUrl,
    });
    expect(run.code).toBe(1);
    expect(run.stdout).toContain("FAIL marketing");
    expect(run.stdout).toContain('marker "Recommendation infrastructure" absent');
    expect(run.stdout).toContain("GATE: FAIL — 3/4 surfaces verified; failed: marketing");
    expect(run.stdout).toContain("PASS web");
    expect(run.stdout).toContain("PASS docs");
  });

  it("api answering the wrong healthz shape → per-surface FAIL line, exit 1", async () => {
    const badApiUrl = await startStub((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: false }));
    });
    const [webUrl, docsUrl, marketingUrl] = await Promise.all([
      htmlStubUrl("Reckon Studio"),
      htmlStubUrl("Reckon documentation"),
      htmlStubUrl("Recommendation infrastructure"),
    ]);
    const run = await runGate({
      RECKON_API_URL: badApiUrl,
      RECKON_WEB_URL: webUrl,
      RECKON_DOCS_URL: docsUrl,
      RECKON_MARKETING_URL: marketingUrl,
    });
    expect(run.code).toBe(1);
    expect(run.stdout).toContain("FAIL api · GET /healthz");
    expect(run.stdout).toContain("ok=false");
    expect(run.stdout).toContain("GATE: FAIL — 3/4 surfaces verified; failed: api");
  });
});
