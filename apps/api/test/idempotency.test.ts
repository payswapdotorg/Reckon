import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ALPHA,
  BETA,
  authHeaders,
  buildDefaultServer,
  buildStubServer,
  idemHeader,
  injectJson,
  validDecisionRequest,
  validOutcomeEvent,
  validPreferenceDelta,
  expectErrorEnvelope,
} from "./fixtures.js";
import type { StubServer } from "./fixtures.js";

/**
 * Determinism + idempotency: a store-and-replay map returns the ORIGINAL
 * response for a repeated key; the same key with a different body is a 409
 * IDEMPOTENCY_CONFLICT; replays are tenant- and route-scoped; the key is
 * echoed in responses (header + body where the contract carries it).
 */

describe("idempotency: replay", () => {
  let stub: StubServer;

  beforeEach(() => {
    stub = buildStubServer();
  });

  afterEach(async () => {
    await stub.app.close();
  });

  it("repeated body-level key returns the ORIGINAL response (handler runs once)", async () => {
    const key = "replay-key-1";
    const first = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest({ idempotencyKey: key }),
      headers: authHeaders(ALPHA),
    });
    expect(first.status).toBe(200);
    expect(stub.state.decisionCalls).toBe(1);

    const second = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest({ idempotencyKey: key }),
      headers: authHeaders(ALPHA),
    });
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(stub.state.decisionCalls).toBe(1);
    expect(second.headers["idempotent-replay"]).toBe("true");
    expect(second.headers["idempotency-key"]).toBe(key);
  });

  it("first response carries the idempotency-key echo header and no replay marker", async () => {
    const key = "echo-key-1";
    const res = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest({ idempotencyKey: key }),
      headers: authHeaders(ALPHA),
    });
    expect(res.status).toBe(200);
    expect(res.headers["idempotency-key"]).toBe(key);
    expect(res.headers["idempotent-replay"]).toBeUndefined();
  });

  it("header-required route replays via Idempotency-Key header", async () => {
    const key = "pref-replay-1";
    const first = await injectJson(stub.app, "POST", "/v1/preferences/events", {
      payload: validPreferenceDelta(),
      headers: idemHeader(key),
    });
    expect(first.status).toBe(200);
    expect(stub.state.preferenceCalls).toBe(1);
    const second = await injectJson(stub.app, "POST", "/v1/preferences/events", {
      payload: validPreferenceDelta(),
      headers: idemHeader(key),
    });
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(stub.state.preferenceCalls).toBe(1);
    expect(second.headers["idempotent-replay"]).toBe("true");
  });

  it("semantically identical body with reordered JSON keys still replays (canonical digest)", async () => {
    const key = "reorder-key-1";
    const base = validDecisionRequest({ idempotencyKey: key }) as Record<string, unknown>;
    const first = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: base,
      headers: authHeaders(ALPHA),
    });
    expect(first.status).toBe(200);
    // Same fields, different insertion order → identical canonical JSON.
    const reordered: Record<string, unknown> = {};
    for (const field of ["idempotencyKey", "policySelector", "candidates", "context", "attentionPolicy", "objective", "subject", "tenant", "requestId"]) {
      reordered[field] = base[field];
    }
    const second = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: reordered,
      headers: authHeaders(ALPHA),
    });
    expect(second.status).toBe(200);
    expect(second.headers["idempotent-replay"]).toBe("true");
    expect(stub.state.decisionCalls).toBe(1);
  });
});

describe("idempotency: conflicts and scoping", () => {
  let stub: StubServer;

  beforeEach(() => {
    stub = buildStubServer();
  });

  afterEach(async () => {
    await stub.app.close();
  });

  it("same key with a DIFFERENT body → 409 IDEMPOTENCY_CONFLICT", async () => {
    const key = "conflict-key-1";
    const first = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest({ idempotencyKey: key, requestId: "req-A" }),
      headers: authHeaders(ALPHA),
    });
    expect(first.status).toBe(200);
    const second = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest({ idempotencyKey: key, requestId: "req-B" }),
      headers: authHeaders(ALPHA),
    });
    expect(second.status).toBe(409);
    expectErrorEnvelope(second.status, second.body, "IDEMPOTENCY_CONFLICT");
    const details = (second.body as { error: { details?: { idempotencyKey?: string } } }).error.details;
    expect(details?.idempotencyKey).toBe(key);
  });

  it("the same key on a different route is independent (no 409, no replay)", async () => {
    const key = "cross-route-key-1";
    const decision = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest({ idempotencyKey: key }),
      headers: authHeaders(ALPHA),
    });
    expect(decision.status).toBe(200);
    const outcome = await injectJson(stub.app, "POST", "/v1/outcomes", {
      payload: validOutcomeEvent({ idempotencyKey: key }),
      headers: authHeaders(ALPHA),
    });
    expect(outcome.status).toBe(200);
    expect(outcome.headers["idempotent-replay"]).toBeUndefined();
    expect(stub.state.outcomeCalls).toBe(1);
  });

  it("replays are tenant-scoped: another tenant with the same key executes fresh", async () => {
    const key = "tenant-scope-key-1";
    const first = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest({ idempotencyKey: key, tenant: { tenantId: "tenant-a" } }),
      headers: authHeaders(ALPHA),
    });
    expect(first.status).toBe(200);
    expect(stub.state.decisionCalls).toBe(1);

    const second = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest({ idempotencyKey: key, tenant: { tenantId: "tenant-b" } }),
      headers: authHeaders(BETA),
    });
    expect(second.status).toBe(200);
    // Fresh execution for tenant-b: different decision, no replay marker.
    expect(second.headers["idempotent-replay"]).toBeUndefined();
    expect(stub.state.decisionCalls).toBe(2);
    const firstBody = first.body as { decisionId?: string };
    const secondBody = second.body as { decisionId?: string };
    expect(firstBody.decisionId).toContain("tenant-a");
    expect(secondBody.decisionId).toContain("tenant-b");
  });

  it("501 NotWired responses are never stored: repeated key re-executes", async () => {
    const app = buildDefaultServer();
    try {
      const key = "notwired-key-1";
      const first = await injectJson(app, "POST", "/v1/decisions", {
        payload: validDecisionRequest({ idempotencyKey: key }),
        headers: authHeaders(ALPHA),
      });
      expect(first.status).toBe(501);
      const second = await injectJson(app, "POST", "/v1/decisions", {
        payload: validDecisionRequest({ idempotencyKey: key }),
        headers: authHeaders(ALPHA),
      });
      expect(second.status).toBe(501);
      expect(second.headers["idempotent-replay"]).toBeUndefined();
      expectErrorEnvelope(second.status, second.body, "NOT_WIRED");
    } finally {
      await app.close();
    }
  });
});
