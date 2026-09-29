import { describe, it, expect } from "vitest";
import { createReckonClient, isReckonSdkError } from "../src/client.js";
import type { FetchLike } from "../src/client.js";
import { buildInjectServer } from "./inject-server.js";
import {
  buildHarness,
  decisionRequestInput,
  outcomeEventInput,
  planInput,
  TENANT_A,
} from "./harness.js";
import {
  ReckonAuthError,
  ReckonConfigError,
  ReckonNotWiredError,
  ReckonResponseContractError,
  ReckonServerError,
  ReckonTransportError,
  ReckonValidationError,
} from "../src/errors.js";
import { DecisionResultSchema } from "@reckon/contracts";
import type { DecisionHandler } from "../../../apps/api/src/ports.js";

/**
 * W3-002 negative-path coverage: every failure mode surfaces as a TYPED
 * ReckonSdkError — never a raw fetch failure. Evidence class: controlled-local.
 */

describe("W3-002 SDK — client-side validation (no network round trip)", () => {
  it("rejects an invalid request before sending (SDK_REQUEST_INVALID)", async () => {
    let fetchCalled = false;
    const spyFetch: FetchLike = async () => {
      fetchCalled = true;
      throw new Error("fetch must not be called");
    };
    const client = createReckonClient({ baseUrl: "http://reckon.test", apiKey: "k", fetchImpl: spyFetch });
    // Missing idempotencyKey + policySelector → frozen schema rejection.
    const invalid = decisionRequestInput({ idempotencyKey: undefined, policySelector: undefined });
    const error = await client.decisions.request(invalid).catch((e: unknown) => e);
    expect(isReckonSdkError(error)).toBe(true);
    expect(error).toBeInstanceOf(ReckonValidationError);
    expect(error).toMatchObject({ code: "SDK_REQUEST_INVALID" });
    expect((error as ReckonValidationError).issues?.length).toBeGreaterThan(0);
    expect(fetchCalled).toBe(false);
  });

  it("rejects invalid config up front (SDK_CONFIG_ERROR)", () => {
    expect(() => createReckonClient({ baseUrl: "", apiKey: "k" })).toThrow(ReckonConfigError);
    expect(() => createReckonClient({ baseUrl: "http://x", apiKey: "" })).toThrow(ReckonConfigError);
  });

  it("rejects an idempotency-key generator that produces invalid ids", async () => {
    const client = createReckonClient({
      baseUrl: "http://reckon.test",
      apiKey: "k",
      fetchImpl: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      idGenerator: () => "not url safe!",
    });
    const error = await client.plans.create(planInput()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReckonConfigError);
  });
});

describe("W3-002 SDK — server error mapping through the real API", () => {
  it("maps 401 to ReckonAuthError for an unknown key", async () => {
    const harness = buildHarness();
    const client = createReckonClient({ baseUrl: "http://reckon.test", apiKey: "not-a-real-key", fetchImpl: harness.fetch });
    const error = await client.decisions.request(decisionRequestInput()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReckonAuthError);
    expect(error).toMatchObject({ code: "UNAUTHENTICATED", statusCode: 401 });
    await harness.app.close();
  });

  it("maps a server-side 400 VALIDATION_ERROR (idempotency header/body mismatch)", async () => {
    const harness = buildHarness();
    const client = createReckonClient({
      baseUrl: "http://reckon.test",
      apiKey: "sdk-alpha",
      fetchImpl: harness.fetch,
      defaultHeaders: { "idempotency-key": "mismatched-header-key" },
    });
    const error = await client.outcomes.append(outcomeEventInput()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReckonValidationError);
    expect(error).toMatchObject({ code: "VALIDATION_ERROR", statusCode: 400 });
    await harness.app.close();
  });

  it("maps 501 NOT_WIRED for unmounted handler ports", async () => {
    const { app, fetch } = buildInjectServer();
    const client = createReckonClient({ baseUrl: "http://reckon.test", apiKey: "sdk-alpha", fetchImpl: fetch });
    const error = await client.plans.create(planInput({ tenant: { tenantId: TENANT_A } })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReckonNotWiredError);
    expect(error).toMatchObject({ code: "NOT_WIRED", statusCode: 501 });
    await app.close();
  });

  it("maps 500 INTERNAL for a throwing handler", async () => {
    const throwing: DecisionHandler = {
      decide: async () => {
        throw new Error("handler exploded");
      },
    };
    const { app, fetch } = buildInjectServer({ decisionHandler: throwing });
    const client = createReckonClient({ baseUrl: "http://reckon.test", apiKey: "sdk-alpha", fetchImpl: fetch });
    const error = await client.decisions.request(decisionRequestInput()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReckonServerError);
    expect(error).toMatchObject({ code: "INTERNAL", statusCode: 500, serverCode: "INTERNAL" });
    await app.close();
  });

  it("maps 500 HANDLER_TENANT_VIOLATION when a handler leaks a cross-tenant response", async () => {
    // The handler answers with tenant B's result while the authenticated
    // key is tenant A — the API must withhold it (tenant law) → typed 500.
    const leaking: DecisionHandler = {
      decide: async (request) =>
        DecisionResultSchema.parse({
          decisionId: "dec-leak-1",
          requestId: request.requestId,
          tenant: { tenantId: "sdk-tenant-b" },
          action: "SUGGEST",
          policy: { policyId: request.policySelector.policyId, version: request.policySelector.version },
          at: 1,
        }),
    };
    const { app, fetch } = buildInjectServer({ decisionHandler: leaking });
    const client = createReckonClient({ baseUrl: "http://reckon.test", apiKey: "sdk-alpha", fetchImpl: fetch });
    const error = await client.decisions.request(decisionRequestInput()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReckonServerError);
    expect(error).toMatchObject({ code: "HANDLER_TENANT_VIOLATION", statusCode: 500 });
    await app.close();
  });
});

describe("W3-002 SDK — transport failures never leak raw fetch errors", () => {
  const okHeaders = { "content-type": "application/json" };

  it("wraps a rejecting fetch into ReckonTransportError (cause preserved)", async () => {
    const client = createReckonClient({
      baseUrl: "http://reckon.test",
      apiKey: "k",
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED boom");
      },
    });
    const error = await client.decisions.request(decisionRequestInput()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReckonTransportError);
    expect(error).toMatchObject({ code: "SDK_TRANSPORT_ERROR" });
    expect((error as ReckonTransportError).cause).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("ECONNREFUSED boom");
  });

  it("rejects non-JSON responses", async () => {
    const client = createReckonClient({
      baseUrl: "http://reckon.test",
      apiKey: "k",
      fetchImpl: async () => new Response("<html>gateway error</html>", { status: 502, headers: { "content-type": "text/html" } }),
    });
    const error = await client.decisions.request(decisionRequestInput()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReckonTransportError);
    expect(error).toMatchObject({ code: "SDK_TRANSPORT_ERROR", statusCode: 502 });
  });

  it("rejects JSON-declared bodies that are not valid JSON", async () => {
    const client = createReckonClient({
      baseUrl: "http://reckon.test",
      apiKey: "k",
      fetchImpl: async () => new Response("not json at all", { status: 200, headers: okHeaders }),
    });
    const error = await client.decisions.request(decisionRequestInput()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReckonTransportError);
    expect(error).toMatchObject({ code: "SDK_TRANSPORT_ERROR", statusCode: 200 });
  });

  it("rejects error responses without the typed envelope", async () => {
    const client = createReckonClient({
      baseUrl: "http://reckon.test",
      apiKey: "k",
      fetchImpl: async () => new Response(JSON.stringify({ oops: "no envelope" }), { status: 500, headers: okHeaders }),
    });
    const error = await client.decisions.request(decisionRequestInput()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReckonTransportError);
    expect(error).toMatchObject({ code: "SDK_UNEXPECTED_ERROR_SHAPE", statusCode: 500 });
  });
});

describe("W3-002 SDK — response contract enforcement", () => {
  it("rejects a 2xx response that violates the frozen contract", async () => {
    const client = createReckonClient({
      baseUrl: "http://reckon.test",
      apiKey: "k",
      fetchImpl: async () => new Response(JSON.stringify({ hello: "not a decision result" }), { status: 200, headers: { "content-type": "application/json" } }),
    });
    const error = await client.decisions.request(decisionRequestInput()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReckonResponseContractError);
    expect(error).toMatchObject({ code: "SDK_RESPONSE_CONTRACT_VIOLATION", statusCode: 200 });
    expect((error as ReckonResponseContractError).issues?.length).toBeGreaterThan(0);
  });
});
