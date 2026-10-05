import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { buildHarness, SDK_TEST_KEY, SDK_LIVE_KEY } from "./harness.js";
import type { SdkTestHarness } from "./harness.js";

/**
 * S2-004 — the PYTHON reference client against the REAL API over REAL
 * HTTP: this harness boots the actual fastify app on an ephemeral TCP
 * port (webhook system wired through the real composition path), then
 * runs sdks/python/test_reckon.py (the docs-matrix suite) and
 * sdks/python/test_verify_webhook.py (the signature matrix) as python3
 * subprocesses with the base URL + generated keys injected via env.
 *
 * TRANSPORT LAW (the reason for the async execFile): the API server
 * lives in THIS process — a synchronous spawn would freeze the event
 * loop and the python client's HTTP requests would hang forever. The
 * child runs async so the server keeps serving while we wait.
 *
 * Self-skipping env gaps (the S2-002 convention — a named gap, never a
 * failure): no python3 on PATH, or python3 without the `requests`
 * package (the client's only dependency).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PYTHON_DIR = join(HERE, "..", "..", "..", "sdks", "python");
const execFileAsync = promisify(execFile);

function pythonAvailable(): boolean {
  // A one-shot sync probe at module scope is safe (no server up yet).
  const probe = spawnSync("python3", ["-c", "import requests"], { encoding: "utf8" });
  return probe.status === 0 && !probe.error;
}

const HAS_PYTHON = pythonAvailable();

let harness: SdkTestHarness;
let baseUrl: string;

beforeAll(async () => {
  if (!HAS_PYTHON) return;
  harness = buildHarness({ webhooks: true });
  await harness.app.listen({ port: 0, host: "127.0.0.1" });
  const address = harness.app.server?.address() as AddressInfo | null;
  if (address === null || typeof address !== "object") {
    throw new Error("python-sdk harness: the API server did not report its address");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (HAS_PYTHON && harness !== undefined) {
    await harness.app.close();
  }
});

interface PythonRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runPython(file: string): Promise<PythonRun> {
  try {
    const { stdout, stderr } = await execFileAsync("python3", [join(PYTHON_DIR, file)], {
      cwd: PYTHON_DIR,
      encoding: "utf8",
      timeout: 110_000,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        RECKON_BASE_URL: baseUrl,
        RECKON_TEST_KEY: SDK_TEST_KEY,
        RECKON_LIVE_KEY: SDK_LIVE_KEY,
      },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string; killed?: boolean };
    return {
      code: failure.code ?? (failure.killed === true ? 124 : 1),
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? String(error),
    };
  }
}

describe("S2-004 python reference client — docs-matrix against the real API over HTTP", () => {
  it.skipIf(!HAS_PYTHON)(
    "test_reckon.py: quickstart loop + test mode + version pinning + errors + webhooks (endpoint CRUD, pagination, events, replay, delivery log)",
    async () => {
      const result = await runPython("test_reckon.py");
      expect(result.code, `python suite failed:\n${result.stdout}\n${result.stderr}`).toBe(0);
      // unittest prints its tally on stderr; surface it in failures.
      expect(result.stderr).toContain("Ran ");
      expect(result.stderr.split("\n")).toContain("OK");
    },
  );

  it.skipIf(!HAS_PYTHON)("test_verify_webhook.py: the signature accept/reject matrix (canonical algorithm)", async () => {
    const result = await runPython("test_verify_webhook.py");
    expect(result.code, `python suite failed:\n${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stderr).toContain("OK");
  });

  it.skipIf(HAS_PYTHON)(
    "names its env gap when python3 or the requests package is absent (the suite self-skips, never fails)",
    () => {
      // When python3 (or the requests package) is missing this test
      // RUNS and documents the named gap; the python suites above are
      // the ones that self-skip.
      expect(HAS_PYTHON).toBe(false);
    },
  );
});
