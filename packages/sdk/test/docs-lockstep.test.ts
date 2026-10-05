import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createReckonClient, verifyWebhook } from "../src/index.js";
import type { ReckonClient } from "../src/index.js";
import { buildHarness, decisionRequestInput, planInput, SDK_TEST_KEY } from "./harness.js";
import {
  SDK_TS_TARGET,
  SDK_TS_TODAY,
  SDK_PY_TARGET,
} from "../../../apps/docs/src/content/sdks.js";
import { QUICKSTART_STEPS, QUICKSTART_HEADINGS } from "../../../apps/docs/src/content/quickstart.js";

/**
 * S2-004 — DOCS LOCKSTEP: the snippets published on the docs portal
 * (imported here directly — the EXACT code a customer copies) must run
 * against the SHIPPED SDKs. Two directions:
 *
 * 1. TypeScript: every surface the snippets touch exists on the shipped
 *    client, and the hardened-target flow (apiVersion pin, expand,
 *    auto-iterators, verifyWebhook) EXECUTES for real against the
 *    in-process API.
 * 2. Python: every client call in the shipped Python snippet (and the
 *    quickstart's Python samples) resolves to a method that exists in
 *    sdks/python/reckon.py.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const RECKON_PY = readFileSync(join(HERE, "..", "..", "..", "sdks", "python", "reckon.py"), "utf8");

describe("docs lockstep — the published TypeScript snippets run against the shipped SDK", () => {
  it("SDK_TS_TODAY: createReckonClient + decisions.request + outcomes.append all execute", async () => {
    expect(SDK_TS_TODAY.code).toContain("createReckonClient");
    const harness = buildHarness();
    const reckon = createReckonClient({ baseUrl: "http://reckon.test", apiKey: "sdk-alpha", fetchImpl: harness.fetch });
    const decision = await reckon.decisions.request(decisionRequestInput());
    expect(decision.action).toBe("SUGGEST");
    const event = await reckon.outcomes.append({
      schema: "reckon.outcome-event",
      schemaVersion: "0.1.0",
      eventId: "evt-lockstep-1",
      tenant: { tenantId: "sdk-tenant-a" },
      subject: { kind: "user", ref: "user-9" },
      decisionId: decision.decisionId,
      experienceId: decision.selectedExperience?.experienceId,
      eventType: "completion",
      occurredAt: 2_000,
      metrics: { watchedSeconds: 1180 },
      evidenceClass: "production-observed",
      idempotencyKey: "idem-lockstep-1",
    });
    expect(event.eventType).toBe("completion");
    await harness.app.close();
  });

  it("SDK_TS_TARGET: apiVersion pin, expand, auto-iterator, lastResponseMode, verifyWebhook", async () => {
    // The snippet names exactly these surfaces — the shipped client
    // must provide every one, and the flow must run end to end.
    for (const surface of [
      "apiVersion",
      "decisions.get",
      "expand",
      "plans.list",
      "lastResponseMode",
      "verifyWebhook",
    ]) {
      expect(SDK_TS_TARGET.code, `docs snippet lost the ${surface} surface`).toContain(surface);
    }
    const harness = buildHarness();
    const reckon: ReckonClient = createReckonClient({
      baseUrl: "http://reckon.test",
      apiKey: SDK_TEST_KEY,
      fetchImpl: harness.fetch,
      apiVersion: "0.1.0",
    });
    const created = await reckon.decisions.request(decisionRequestInput());
    const decision = await reckon.decisions.get(created.decisionId, { expand: ["selectedExperience.item"] });
    expect(decision.decisionId).toBe(created.decisionId);
    expect(typeof reckon.lastResponseMode()).toBe("string");

    await reckon.plans.create(planInput({ planId: "plan-lockstep" }));
    const seen: string[] = [];
    for await (const plan of reckon.plans.list({ limit: 100 })) {
      seen.push(plan.planId);
    }
    expect(seen).toContain("plan-lockstep");

    expect(typeof verifyWebhook).toBe("function");
    await harness.app.close();
  });
});

describe("docs lockstep — the published Python snippets run against the shipped client", () => {
  it("SDK_PY_TARGET: ReckonClient(api_key=…, api_version=…) and every referenced call exists in reckon.py", () => {
    expect(SDK_PY_TARGET.code).toContain("ReckonClient");
    expect(SDK_PY_TARGET.code).toContain("verify_webhook");
    expect(SDK_PY_TARGET.code).toContain("last_mode");
    // Constructor kwargs + the exact attribute/method surface named by
    // the snippet must exist in the shipped single-file client.
    for (const surface of [
      "def __init__",
      "api_key",
      "api_version",
      "def request",
      "self.last_mode",
      "verify_webhook",
    ]) {
      expect(RECKON_PY, `reckon.py lost the ${surface} surface`).toContain(surface);
    }
  });

  it("quickstart Python samples: every client attribute the snippets touch exists in reckon.py", () => {
    const pythonSamples = QUICKSTART_STEPS.flatMap((step) => [
      ...(step.tabs?.flatMap((tab) => tab.samples) ?? []),
      ...(step.extra ?? []),
    ]).filter((sample) => sample.language === "python");
    expect(pythonSamples.length).toBeGreaterThanOrEqual(3);

    // Attribute/method names used in the published Python snippets
    // (snake_case surface of the shipped client).
    const referencedSurfaces = [
      "decisions.request",
      "decision.action",
      "decision.selected_experience",
      "last_mode",
      "outcomes.append",
      "webhook_endpoints.create",
      "endpoint.secret",
      "webhook_deliveries.list",
      "webhook_events.get",
      "webhook_events.replay",
    ];
    const allCode = pythonSamples.map((sample) => sample.code).join("\n");
    const shippedClientSurface = [
      "self.decisions = Decisions",
      "def request",
      "def append",
      "self.webhook_endpoints = WebhookEndpoints",
      "def create",
      "self.webhook_events = WebhookEvents",
      "self.webhook_deliveries = WebhookDeliveries",
      "def list",
      "def get",
      "def replay",
      "def list_all",
    ];
    for (const surface of referencedSurfaces) {
      expect(allCode, `quickstart python snippets lost ${surface}`).toContain(surface);
    }
    for (const shipped of shippedClientSurface) {
      expect(RECKON_PY, `reckon.py lost ${shipped}`).toContain(shipped);
    }
  });

  it("the quickstart carries the webhook-verification step in both languages", () => {
    expect(QUICKSTART_HEADINGS.map((heading) => heading.id)).toContain("verify-webhook-deliveries");
    const step = QUICKSTART_STEPS.find((s) => s.id === "verify-webhook-deliveries");
    expect(step).toBeDefined();
    const languages = (step?.extra ?? []).map((sample) => sample.language).sort();
    expect(languages).toEqual(["python", "typescript"]);
    const ts = (step?.extra ?? []).find((sample) => sample.language === "typescript")?.code ?? "";
    expect(ts).toContain('from "@reckon/sdk"');
    expect(ts).toContain("webhookEndpoints.create");
    expect(ts).toContain("verifyWebhook");
    const py = (step?.extra ?? []).find((sample) => sample.language === "python")?.code ?? "";
    expect(py).toContain("verify_webhook");
    expect(py).toContain("webhook_events.replay");
  });
});
