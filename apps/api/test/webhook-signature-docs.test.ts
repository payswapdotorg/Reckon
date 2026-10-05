import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import * as esbuild from "esbuild";
import { SIGNATURE_VERIFY_PY, SIGNATURE_VERIFY_TS } from "../../../apps/docs/src/content/webhooks.js";
import { signWebhookPayload, verifyReckonSignature } from "@reckon/contracts";

/**
 * S2-002 — SIGNATURE LOCKSTEP WITH THE DOCS: the TypeScript and Python
 * verification samples published on the docs portal
 * (apps/docs/src/content/webhooks.ts — imported here directly, so the
 * test runs against the EXACT code a customer copies) must accept and
 * reject identically with the shipped implementation:
 *
 * - the TS sample is compiled (esbuild) and imported — then fed a
 *   matrix of signatures produced by OUR signer;
 * - the Python sample is written to a temp module and executed with
 *   python3 over the same matrix (skipped gracefully when no python3 —
 *   an env gap, not a failure);
 * - the exported verifyReckonSignature must agree with the TS
 *   reference on every case (tolerance window, tampering, wrong
 *   secret, malformed headers, constant-time behaviors).
 */

const SECRET = "whsec_lockstep_secret_0123456789abcdef";
const BODY = JSON.stringify({
  id: "evt_lockstep_1",
  object: "event",
  type: "preference.updated",
  created: 1769998921000,
  tenant: { tenantId: "demo" },
  data: { object: { deltaId: "delta-1", subject: { kind: "user", ref: "usr_1" }, dimension: "topic.calm", op: "add", modelId: "m", modelVersion: "1" } },
});

interface SignatureCase {
  readonly name: string;
  readonly body: string;
  readonly header: string;
  readonly secret: string;
  readonly expect: boolean;
  /** The Python sample may legitimately RAISE where the TS sample returns false (weaker input guard). */
  readonly pythonMayRaise?: boolean;
}

function buildMatrix(): SignatureCase[] {
  const nowSec = Math.floor(Date.now() / 1000);
  const sign = (skewSeconds: number, body: string = BODY, secret: string = SECRET): string =>
    signWebhookPayload(secret, body, nowSec + skewSeconds);
  return [
    { name: "fresh signature", body: BODY, header: sign(0), secret: SECRET, expect: true },
    { name: "boundary age (299s old)", body: BODY, header: sign(-299), secret: SECRET, expect: true },
    { name: "tampered body (trailing byte)", body: `${BODY} `, header: sign(0), secret: SECRET, expect: false },
    { name: "tampered body (mutated json)", body: BODY.replace("delta-1", "delta-2"), header: sign(0), secret: SECRET, expect: false },
    { name: "wrong secret", body: BODY, header: sign(0), secret: "whsec_wrong_secret_0123456789abcdef", expect: false },
    { name: "stale t (302s old)", body: BODY, header: sign(-302), secret: SECRET, expect: false },
    { name: "future t (302s ahead)", body: BODY, header: sign(302), secret: SECRET, expect: false },
    { name: "missing t", body: BODY, header: `v1=${"0".repeat(64)}`, secret: SECRET, expect: false },
    { name: "missing v1", body: BODY, header: "t=1769997725", secret: SECRET, expect: false },
    { name: "garbage header", body: BODY, header: "nonsense", secret: SECRET, expect: false },
    { name: "empty header", body: BODY, header: "", secret: SECRET, expect: false },
    { name: "non-numeric t", body: BODY, header: `t=banana,v1=${"0".repeat(64)}`, secret: SECRET, expect: false, pythonMayRaise: true },
    { name: "wrong signature (equal length)", body: BODY, header: sign(0).replace(/v1=[0-9a-f]{64}/, `v1=${"0".repeat(64)}`), secret: SECRET, expect: false },
    { name: "short signature", body: BODY, header: `t=${nowSec},v1=abcd`, secret: SECRET, expect: false },
    { name: "non-hex signature", body: BODY, header: `t=${nowSec},v1=${"z".repeat(64)}`, secret: SECRET, expect: false },
    { name: "extra fields tolerated", body: BODY, header: `v0=extra,t=${nowSec},${sign(0).split(",")[1] ?? ""}`, secret: SECRET, expect: true },
  ];
}

/* ------------------- the TS sample, compiled + imported ------------------- */

let tempDir: string;
let docsTsVerify: (rawBody: string, header: string, secret: string, toleranceSeconds?: number) => boolean;

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "reckon-webhook-lockstep-"));
  // The docs module's `.code` is the UNESCAPED source exactly as the
  // portal renders it; esbuild compiles it to importable ESM.
  const compiled = esbuild.transformSync(SIGNATURE_VERIFY_TS.code, { loader: "ts", format: "esm" });
  const modulePath = join(tempDir, "verify-reckon-signature.mjs");
  writeFileSync(modulePath, compiled.code, "utf8");
  const mod = (await import(pathToFileURL(modulePath).href)) as {
    verifyReckonSignature: typeof docsTsVerify;
  };
  docsTsVerify = mod.verifyReckonSignature;
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("docs lockstep: the published TypeScript sample", () => {
  it("compiles and exports the documented function", () => {
    expect(typeof docsTsVerify).toBe("function");
  });

  it("accepts/rejects every matrix case exactly as specified", () => {
    for (const testCase of buildMatrix()) {
      expect(docsTsVerify(testCase.body, testCase.header, testCase.secret), `TS sample: ${testCase.name}`).toBe(
        testCase.expect,
      );
    }
  });

  it("agrees with the shipped verifyReckonSignature on every case (and on a random-body sweep)", () => {
    for (const testCase of buildMatrix()) {
      expect(verifyReckonSignature(testCase.body, testCase.header, testCase.secret), `ours: ${testCase.name}`).toBe(
        testCase.expect,
      );
    }
    // Randomized agreement sweep: 25 random bodies, fresh timestamps.
    for (let index = 0; index < 25; index += 1) {
      const body = JSON.stringify({ i: index, s: Math.random().toString(36).slice(2), n: Math.random() });
      const header = signWebhookPayload(SECRET, body, Math.floor(Date.now() / 1000));
      expect(verifyReckonSignature(body, header, SECRET)).toBe(docsTsVerify(body, header, SECRET));
    }
  });
});

/* ------------------- the Python sample, executed ------------------- */

function pythonAvailable(): boolean {
  const probe = spawnSync("python3", ["-c", "import hashlib, hmac, time"], { encoding: "utf8" });
  return probe.status === 0 && !probe.error;
}

const HAS_PYTHON = pythonAvailable();

async function runPythonSample(cases: readonly SignatureCase[]): Promise<unknown[]> {
  const modulePath = join(tempDir, "verify_reckon_signature.py");
  writeFileSync(modulePath, SIGNATURE_VERIFY_PY.code, "utf8");
  const driverPath = join(tempDir, "driver.py");
  writeFileSync(
    driverPath,
    [
      "import json, sys",
      `sys.path.insert(0, ${JSON.stringify(tempDir)})`,
      "from verify_reckon_signature import verify_reckon_signature",
      "cases = json.load(open(sys.argv[1]))",
      "out = []",
      "for c in cases:",
      "    body = c['body'].encode()",
      "    try:",
      "        out.append({'ok': verify_reckon_signature(body, c['header'], c['secret'])})",
      "    except Exception as e:",
      "        out.append({'raised': type(e).__name__ + ': ' + str(e)})",
      "print(json.dumps(out))",
    ].join("\n"),
    "utf8",
  );
  const casesPath = join(tempDir, "cases.json");
  writeFileSync(casesPath, JSON.stringify(cases.map((c) => ({ body: c.body, header: c.header, secret: c.secret }))), "utf8");
  const stdout = execFileSync("python3", [driverPath, casesPath], { encoding: "utf8" });
  return JSON.parse(stdout) as unknown[];
}

describe("docs lockstep: the published Python sample", () => {
  it.skipIf(!HAS_PYTHON)(
    "accepts/rejects the same matrix (raises count as reject where the TS sample is more defensive)",
    async () => {
      const matrix = buildMatrix();
      const verdicts = await runPythonSample(matrix);
      expect(verdicts).toHaveLength(matrix.length);
      matrix.forEach((testCase, index) => {
        const verdict = verdicts[index] as { ok?: boolean; raised?: string };
        if (testCase.pythonMayRaise === true && verdict.raised !== undefined) {
          // The Python sample crashes on non-numeric t (int(t)); the TS
          // sample and our helper reject it with false. Both are
          // "reject" outcomes — the samples differ only in mechanism.
          expect(testCase.expect).toBe(false);
          return;
        }
        expect(verdict.raised, `Python sample raised on '${testCase.name}': ${verdict.raised ?? ""}`).toBeUndefined();
        expect(verdict.ok, `Python sample: ${testCase.name}`).toBe(testCase.expect);
      });
    },
  );

  it.skipIf(!HAS_PYTHON)(
    "known inter-sample divergences: uppercase hex v1 and header whitespace — TS trims/decodes hex, Python compares raw strings",
    async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      // Divergence 1 — uppercase hex v1: the TS sample hex-DECODES both
      // sides before comparing (case-insensitive); the Python sample
      // compares the lowercase hexdigest string against the raw v1
      // (case-sensitive). The shipped helper follows the TS REFERENCE
      // (Buffer hex-decode semantics); real signatures are always
      // lowercase, so the divergence only matters for receivers that
      // uppercase the header.
      const upperHeader = signWebhookPayload(SECRET, BODY, nowSec).replace(
        /v1=([0-9a-f]+)/,
        (_match, hex: string) => `v1=${hex.toUpperCase()}`,
      );
      expect(verifyReckonSignature(BODY, upperHeader, SECRET)).toBe(true);
      expect(docsTsVerify(BODY, upperHeader, SECRET)).toBe(true);
      const [upper] = (await runPythonSample([
        { name: "uppercase", body: BODY, header: upperHeader, secret: SECRET, expect: false },
      ])) as { ok?: boolean }[];
      expect(upper?.ok).toBe(false);

      // Divergence 2 — whitespace around comma-separated fields: the
      // TS sample trims keys/values; the Python sample does not (its
      // `" t"` key lookup misses). Same reference-alignment as above.
      const spacedHeader = `v0=extra, t=${nowSec} , ${signWebhookPayload(SECRET, BODY, nowSec).split(",")[1] ?? ""}`;
      expect(verifyReckonSignature(BODY, spacedHeader, SECRET)).toBe(true);
      expect(docsTsVerify(BODY, spacedHeader, SECRET)).toBe(true);
      const [spaced] = (await runPythonSample([
        { name: "spaced", body: BODY, header: spacedHeader, secret: SECRET, expect: false },
      ])) as { ok?: boolean }[];
      expect(spaced?.ok).toBe(false);
    },
  );
});

describe("docs lockstep: our signer produces what the samples verify", () => {
  it("every generated header matches the documented format exactly", () => {
    for (let index = 0; index < 10; index += 1) {
      const header = signWebhookPayload(SECRET, BODY, Math.floor(Date.now() / 1000));
      expect(header).toMatch(/^t=\d{10},v1=[0-9a-f]{64}$/);
    }
  });

  it("signature bytes are the HMAC over `${t}.${rawBody}` — verified with the docs TS sample itself", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const header = signWebhookPayload(SECRET, BODY, nowSec);
    const t = header.split(",")[0]?.slice(2) ?? "";
    // Recompute with node:crypto directly (independent of our signer).
    const expected = createHmac("sha256", SECRET).update(`${t}.${BODY}`, "utf8").digest("hex");
    expect(header).toBe(`t=${t},v1=${expected}`);
    expect(docsTsVerify(BODY, header, SECRET)).toBe(true);
  });
});
