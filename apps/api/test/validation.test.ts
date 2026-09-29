import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ALPHA,
  authHeaders,
  buildStubServer,
  injectJson,
  validDecisionRequest,
  validPreferenceDelta,
  expectErrorEnvelope,
  freshIdem,
  idemHeader,
} from "./fixtures.js";
import type { StubServer } from "./fixtures.js";

/** Body-shape failures outside the per-route matrix: parsing, headers, envelope shape. */

describe("validation: request body handling", () => {
  let stub: StubServer;

  beforeEach(() => {
    stub = buildStubServer();
  });

  afterEach(async () => {
    await stub.app.close();
  });

  it("malformed JSON body → 400 VALIDATION_ERROR envelope (not a fastify default error)", async () => {
    const res = await stub.app.inject({
      method: "POST",
      url: "/v1/decisions",
      payload: '{"requestId": "broken",',
      headers: authHeaders(ALPHA),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe("VALIDATION_ERROR");
    expectErrorEnvelope(res.statusCode, body, "VALIDATION_ERROR");
  });

  it("non-JSON content type → 400 typed envelope", async () => {
    const res = await stub.app.inject({
      method: "POST",
      url: "/v1/catalog/items",
      payload: "itemId=x&kind=media",
      headers: { ...idemHeader(freshIdem()), "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res.statusCode).toBe(400);
    expectErrorEnvelope(res.statusCode, res.json(), "VALIDATION_ERROR");
  });

  it("missing body entirely → 400 VALIDATION_ERROR", async () => {
    const res = await stub.app.inject({
      method: "POST",
      url: "/v1/decisions",
      headers: authHeaders(ALPHA),
    });
    expect(res.statusCode).toBe(400);
    expectErrorEnvelope(res.statusCode, res.json(), "VALIDATION_ERROR");
  });

  it("body that is an array instead of object → 400 with issues", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: [1, 2, 3],
      headers: authHeaders(ALPHA),
    });
    expect(res.status).toBe(400);
    expectErrorEnvelope(res.status, res.body, "VALIDATION_ERROR");
  });

  it("unknown extra fields are stripped (zod default), not rejected", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest({ someFutureField: "hello" }),
      headers: authHeaders(ALPHA),
    });
    expect(res.status).toBe(200);
  });
});

describe("validation: idempotency key request rules", () => {
  let stub: StubServer;

  beforeEach(() => {
    stub = buildStubServer();
  });

  afterEach(async () => {
    await stub.app.close();
  });

  it("missing Idempotency-Key header on header-required routes → 400", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/preferences/events", {
      payload: validPreferenceDelta(),
      headers: authHeaders(ALPHA),
    });
    expect(res.status).toBe(400);
    expectErrorEnvelope(res.status, res.body, "VALIDATION_ERROR");
  });

  it("invalid Idempotency-Key header value → 400 (real IdSchema rules)", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/preferences/events", {
      payload: validPreferenceDelta(),
      headers: authHeaders(ALPHA, { "idempotency-key": "not url safe!" }),
    });
    expect(res.status).toBe(400);
    expectErrorEnvelope(res.status, res.body, "VALIDATION_ERROR");
  });

  it("Idempotency-Key header disagreeing with body idempotencyKey → 400", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest(),
      headers: authHeaders(ALPHA, { "idempotency-key": "different-key" }),
    });
    expect(res.status).toBe(400);
    expectErrorEnvelope(res.status, res.body, "VALIDATION_ERROR");
  });

  it("Idempotency-Key header agreeing with body idempotencyKey is accepted", async () => {
    const body = validDecisionRequest();
    const res = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: body,
      headers: authHeaders(ALPHA, { "idempotency-key": String(body.idempotencyKey) }),
    });
    expect(res.status).toBe(200);
  });
});

describe("validation: unknown routes use the typed 404 envelope", () => {
  it("GET /v1/nope → 404 NOT_FOUND envelope", async () => {
    const { app } = buildStubServer();
    try {
      const res = await injectJson(app, "GET", "/v1/nope", { headers: authHeaders(ALPHA) });
      expect(res.status).toBe(404);
      expectErrorEnvelope(res.status, res.body, "NOT_FOUND");
    } finally {
      await app.close();
    }
  });

  it("unauthenticated unknown route still returns the typed 404 (no auth on route-not-found)", async () => {
    const { app } = buildStubServer();
    try {
      const res = await injectJson(app, "GET", "/v1/nope", {});
      expect(res.status).toBe(404);
      expectErrorEnvelope(res.status, res.body, "NOT_FOUND");
    } finally {
      await app.close();
    }
  });

  it("wrong method on a known path → typed 404 (fastify semantics)", async () => {
    const { app } = buildStubServer();
    try {
      const res = await injectJson(app, "GET", "/v1/outcomes", { headers: authHeaders(ALPHA) });
      expect(res.status).toBe(404);
      expectErrorEnvelope(res.status, res.body, "NOT_FOUND");
    } finally {
      await app.close();
    }
  });
});
