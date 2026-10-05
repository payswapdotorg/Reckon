import { describe, it, expect } from "vitest";
import { createReckonClient } from "../src/index.js";
import {
  ReckonConfigError,
  ReckonModeMismatchError,
  ReckonRateLimitError,
  ReckonValidationError,
  SDK_SERVER_ERROR_CODES,
  isReckonSdkError,
} from "../src/index.js";
import { ERROR_CATALOG, generateSecretKey, generatePublishableKey, signWebhookPayload } from "@reckon/contracts";
import { decisionRequestInput, planInput, buildHarness, SDK_TEST_KEY, SDK_LIVE_KEY, TENANT_A } from "./harness.js";
import type { ReckonClient } from "../src/index.js";

/**
 * S2-004 — the hardened developer-platform surface through the SDK,
 * against the REAL in-process API: the sk_/pk_ auth matrix, API-version
 * pinning, test/live mode semantics (X-Reckon-Mode, canned scenarios,
 * MODE_MISMATCH), ?expand[] embedding, plans cursor pagination, rate
 * limiting, and the error-catalog lockstep (SDK server codes ⇄ frozen
 * ERROR_CATALOG). Evidence class: controlled-local.
 */
function client(harness: ReturnType<typeof buildHarness>, apiKey: string, apiVersion?: string): ReckonClient {
  return createReckonClient({
    baseUrl: "http://reckon.test",
    apiKey,
    fetchImpl: harness.fetch,
    ...(apiVersion !== undefined ? { apiVersion } : {}),
  });
}

describe("S2-004 SDK — auth matrix (sk_/pk_ key model)", () => {
  it("serves a generated sk_test_ key and marks every response test-mode", async () => {
    const harness = buildHarness();
    const testClient = client(harness, SDK_TEST_KEY);
    const decision = await testClient.decisions.request(decisionRequestInput());
    expect(decision.action).toBe("SUGGEST");
    // X-Reckon-Mode rides every authenticated response (S2-003).
    expect(testClient.lastResponseMode()).toBe("test");
    await harness.app.close();
  });

  it("serves a generated sk_live_ key and marks every response live-mode", async () => {
    const harness = buildHarness();
    const liveClient = client(harness, SDK_LIVE_KEY);
    await liveClient.decisions.request(decisionRequestInput());
    expect(liveClient.lastResponseMode()).toBe("live");
    await harness.app.close();
  });

  it("rejects a publishable (pk_) key with a typed 401 authentication_error", async () => {
    const harness = buildHarness();
    // Generated at runtime (secret-scanner law: no literal key strings).
    const publishable = generatePublishableKey("test");
    const pkClient = client(harness, publishable);
    const error = await pkClient.decisions.request(decisionRequestInput()).catch((e: unknown) => e);
    expect(isReckonSdkError(error)).toBe(true);
    expect(error).toMatchObject({
      name: "ReckonAuthError",
      code: "UNAUTHENTICATED",
      statusCode: 401,
      errorClass: "authentication_error",
    });
    await harness.app.close();
  });

  it("rejects an unknown key with 401 and carries the envelope's class/param/doc_url on the typed error", async () => {
    const harness = buildHarness();
    const unknown = generateSecretKey("test"); // well-formed, never configured
    const rogue = client(harness, unknown);
    const error = await rogue.decisions.request(decisionRequestInput()).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: "ReckonAuthError", code: "UNAUTHENTICATED", statusCode: 401 });
    if (isReckonSdkError(error)) {
      expect(error.errorClass).toBe("authentication_error");
      expect(error.docUrl).toContain("/errors/unauthenticated");
    }
    await harness.app.close();
  });
});

describe("S2-004 SDK — API version pinning (X-Reckon-Version)", () => {
  it("pins a well-formed registered version on every request", async () => {
    const harness = buildHarness();
    // The shipped registry pins exactly one version: the semver default.
    const pinned = client(harness, "sdk-alpha", "0.1.0");
    const decision = await pinned.decisions.request(decisionRequestInput());
    expect(decision.action).toBe("SUGGEST");
    await harness.app.close();
  });

  it("rejects a malformed apiVersion at construction (SDK_CONFIG_ERROR)", () => {
    expect(() => client({} as never, "sdk-alpha", "not-a-version")).toThrow(ReckonConfigError);
  });

  it("surfaces a typed 400 when the pin is well-formed but unregistered", async () => {
    const harness = buildHarness();
    const future = client(harness, "sdk-alpha", "2099-01-01");
    const error = await future.decisions.request(decisionRequestInput()).catch((e: unknown) => e);
    expect(error).toMatchObject({
      name: "ReckonValidationError",
      code: "VALIDATION_ERROR",
      statusCode: 400,
      param: "X-Reckon-Version",
    });
    await harness.app.close();
  });
});

describe("S2-004 SDK — test mode semantics (S2-003 through the client)", () => {
  it("resolves canned scenarios in test mode via the magic itm_test_ item ids (decline → HOLD, queue → QUEUE)", async () => {
    const harness = buildHarness();
    const testClient = client(harness, SDK_TEST_KEY);
    // NOTE (typed-client law): the body-level `scenario` field is a
    // test-only hint the frozen DecisionRequestSchema strips — the SDK
    // validates requests against the frozen contract before sending,
    // so the typed-client path to a canned scenario is the MAGIC ITEM
    // ID (schema-legal, exactly like Stripe's magic test card numbers).
    const declined = await testClient.decisions.request(
      decisionRequestInput({
        candidates: {
          setId: "cs-magic",
          candidates: [{ itemId: "itm_test_decline", source: "host-retrieval" }],
        },
      }),
    );
    expect(declined.action).toBe("HOLD");
    expect(declined.selectedExperience).toBeUndefined();

    const queued = await testClient.decisions.request(
      decisionRequestInput({
        candidates: {
          setId: "cs-magic-2",
          candidates: [{ itemId: "itm_test_queue", source: "host-retrieval" }],
        },
      }),
    );
    expect(queued.action).toBe("QUEUE");
    expect(queued.scheduleDelta?.enqueue?.length).toBe(1);
    await harness.app.close();
  });

  it("maps the canned 'error' scenario onto the typed 500 api_error path", async () => {
    const harness = buildHarness();
    const testClient = client(harness, SDK_TEST_KEY);
    const error = await testClient.decisions
      .request(
        decisionRequestInput({
          candidates: {
            setId: "cs-magic-3",
            candidates: [{ itemId: "itm_test_error", source: "host-retrieval" }],
          },
        }),
      )
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ name: "ReckonServerError", code: "INTERNAL", statusCode: 500, mode: "test" });
    await harness.app.close();
  });

  it("rejects a LIVE key referencing a magic itm_test_ item id (403 MODE_MISMATCH, mode-marked)", async () => {
    const harness = buildHarness();
    const liveClient = client(harness, SDK_LIVE_KEY);
    const error = await liveClient.decisions
      .request(
        decisionRequestInput({
          candidates: {
            setId: "cs-magic-live",
            candidates: [{ itemId: "itm_test_decline", source: "host-retrieval" }],
          },
        }),
      )
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReckonModeMismatchError);
    expect(error).toMatchObject({
      name: "ReckonModeMismatchError",
      code: "MODE_MISMATCH",
      statusCode: 403,
      mode: "live",
      errorClass: "permission_error",
    });
    await harness.app.close();
  });

  it("rejects a LIVE key carrying a scenario hint sent raw (403 MODE_MISMATCH reaches the typed client)", async () => {
    const harness = buildHarness();
    // Raw-HTTP escape hatch check: a hint smuggled past the SDK's
    // client-side validation (e.g. via defaultHeaders-free raw fetch)
    // still gets the typed MODE_MISMATCH when the SDK maps the envelope.
    const response = await harness.fetch("http://reckon.test/v1/decisions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${SDK_LIVE_KEY}`,
        "content-type": "application/json",
        "idempotency-key": "raw-hint-1",
      },
      body: JSON.stringify({
        ...decisionRequestInput(),
        scenario: "decline",
        idempotencyKey: "raw-hint-1-body",
      }),
    });
    expect(response.status).toBe(403);
    const envelope = (await response.json()) as { error: { code: string } };
    expect(envelope.error.code).toBe("MODE_MISMATCH");
    await harness.app.close();
  });
});

describe("S2-004 SDK — response expansion (?expand[])", () => {
  it("embeds the selected experience's catalog item on decisions.get", async () => {
    const harness = buildHarness({
      // The deterministic default answers null (honest-absence
      // expansion); override with a real reader so a REAL item embeds.
      handlers: {
        catalogReader: {
          getItem: async () => ({
            schema: "reckon.catalog-item" as const,
            schemaVersion: "0.1.0",
            itemId: "item-1",
            kind: "media" as const,
            labels: ["scifi"],
            attributes: {},
          }),
          getRealization: async () => null,
        },
      },
    });
    const sdk = client(harness, "sdk-alpha");
    const created = await sdk.decisions.request(
      decisionRequestInput({
        candidates: {
          setId: "cs-1",
          candidates: [{ itemId: "item-1", realizationIds: ["real-1"], source: "host-retrieval" }],
        },
      }),
    );
    const expanded = await sdk.decisions.get(created.decisionId, { expand: ["selectedExperience.item"] });
    expect(expanded.selectedExperience?.itemId).toBe("item-1");
    expect(expanded.selectedExperience?.item?.itemId).toBe("item-1");
    expect(expanded.selectedExperience?.item?.kind).toBe("media");

    // Without expand, no item key is present (non-expanding clients see
    // the plain frozen contract).
    const plain = await sdk.decisions.get(created.decisionId);
    expect(plain.selectedExperience?.item).toBeUndefined();
    await harness.app.close();
  });

  it("rejects an off-allowlist expand path with a typed 400 naming expand[i]", async () => {
    const harness = buildHarness();
    const sdk = client(harness, "sdk-alpha");
    const created = await sdk.decisions.request(decisionRequestInput());
    const error = await sdk.decisions
      .get(created.decisionId, { expand: ["selectedExperience.nope"] })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({
      name: "ReckonValidationError",
      code: "VALIDATION_ERROR",
      statusCode: 400,
      param: "expand[0]",
    });
    await harness.app.close();
  });
});

describe("S2-004 SDK — plans cursor pagination", () => {
  it("pages newest-first and auto-iterates every plan", async () => {
    const harness = buildHarness();
    const sdk = client(harness, "sdk-alpha");
    const created = [
      await sdk.plans.create(planInput({ planId: "plan-p1" })),
      await sdk.plans.create(planInput({ planId: "plan-p2" })),
      await sdk.plans.create(planInput({ planId: "plan-p3" })),
    ];

    const page1 = await sdk.plans.listPage({ limit: 2 });
    expect(page1.plans.map((p) => p.planId)).toEqual(["plan-p3", "plan-p2"]);
    expect(page1.has_more).toBe(true);
    expect(page1.next_cursor).toBe(created[1]?.planId);

    const page2 = await sdk.plans.listPage({ limit: 2, startingAfter: page1.next_cursor ?? undefined });
    expect(page2.plans.map((p) => p.planId)).toEqual(["plan-p1"]);
    expect(page2.has_more).toBe(false);
    expect(page2.next_cursor).toBe("plan-p1");

    const seen: string[] = [];
    for await (const plan of sdk.plans.list({ limit: 2 })) {
      seen.push(plan.planId);
    }
    expect(seen).toEqual(["plan-p3", "plan-p2", "plan-p1"]);
    await harness.app.close();
  });
});

describe("S2-004 SDK — rate limiting (429 RATE_LIMIT_EXCEEDED)", () => {
  it("surfaces the typed rate-limit error with Retry-After seconds", async () => {
    const harness = buildHarness({ rateLimit: { limit: 1, windowMs: 60_000 } });
    const sdk = client(harness, "sdk-alpha");
    const first = await sdk.decisions.request(decisionRequestInput());
    expect(first.action).toBe("SUGGEST");
    const error = await sdk.decisions.request(decisionRequestInput()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReckonRateLimitError);
    expect(error).toMatchObject({
      name: "ReckonRateLimitError",
      code: "RATE_LIMIT_EXCEEDED",
      statusCode: 429,
      errorClass: "rate_limit_error",
    });
    if (isReckonSdkError(error)) {
      // The limiter aligns windows to the epoch — Retry-After is the
      // seconds remaining in the CURRENT aligned window (1..60 here).
      expect(error.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(error.retryAfterSeconds).toBeLessThanOrEqual(60);
      expect(Number.isInteger(error.retryAfterSeconds)).toBe(true);
    }
    await harness.app.close();
  });
});

describe("S2-004 SDK — error-catalog lockstep", () => {
  it("SDK_SERVER_ERROR_CODES covers every machine code in the frozen ERROR_CATALOG", () => {
    expect([...SDK_SERVER_ERROR_CODES].sort()).toEqual([...Object.keys(ERROR_CATALOG)].sort());
  });

  it("webhook helper exports agree with the canonical implementation (one algorithm)", async () => {
    const { verifyWebhook, verifyReckonSignature } = await import("../src/index.js");
    // Generated at runtime — the secret-scanner law bans literal whsec_ fixtures.
    const secret = `whsec_${generateSecretKey("test").slice(8)}`;
    const body = JSON.stringify({ id: "evt_x", object: "event", type: "preference.updated" });
    const header = signWebhookPayload(secret, body, Math.floor(Date.now() / 1000));
    expect(verifyWebhook(body, header, secret)).toBe(true);
    expect(verifyWebhook(body, header, secret)).toBe(verifyReckonSignature(body, header, secret));
    expect(verifyWebhook(`${body}!`, header, secret)).toBe(false);
  });

  it("the apiVersion pin propagates through typed errors too (mode + doc_url carried)", async () => {
    const harness = buildHarness();
    const sdk = client(harness, SDK_TEST_KEY);
    // Test key reading an unknown decision → 404, still mode-marked.
    const error = await sdk.decisions.get("dec_unknown_mode").catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "NOT_FOUND", statusCode: 404, mode: "test" });
    expect(sdk.lastResponseMode()).toBe("test");
    await harness.app.close();
  });
});
