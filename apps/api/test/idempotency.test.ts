import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { InMemoryIdempotencyStore } from "../src/idempotency.js";
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

  it("same key with a DIFFERENT body → 422 IDEMPOTENCY_CONFLICT (S2-001 typed invalid_request_error)", async () => {
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
    expect(second.status).toBe(422);
    expectErrorEnvelope(second.status, second.body, "IDEMPOTENCY_CONFLICT", "invalid_request_error");
    const error = (second.body as { error: { details?: { idempotencyKey?: string }; param?: string } }).error;
    expect(error.details?.idempotencyKey).toBe(key);
    expect(error.param).toBe("idempotency-key");
    expect(stub.state.decisionCalls).toBe(1);
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

describe("idempotency: S2-001 full semantics", () => {
  it("replays carry Idempotent-Replayed: true (plus the legacy lowercase header)", async () => {
    const stub = buildStubServer();
    try {
      const key = "s2-replayed-header-1";
      const first = await injectJson(stub.app, "POST", "/v1/decisions", {
        payload: validDecisionRequest({ idempotencyKey: key }),
        headers: authHeaders(ALPHA),
      });
      expect(first.status).toBe(200);
      expect(first.headers["idempotent-replayed"]).toBeUndefined(); // first response is not a replay
      const second = await injectJson(stub.app, "POST", "/v1/decisions", {
        payload: validDecisionRequest({ idempotencyKey: key }),
        headers: authHeaders(ALPHA),
      });
      expect(second.status).toBe(200);
      expect(second.headers["idempotent-replayed"]).toBe("true");
      expect(second.headers["idempotent-replay"]).toBe("true");
      expect(stub.state.decisionCalls).toBe(1);
    } finally {
      await stub.app.close();
    }
  });

  it("24h window: a stored response older than the window is forgotten (fresh execution, even with a different body)", async () => {
    let now = 1_000_000;
    const stub = buildStubServer({ clock: () => now });
    try {
      const key = "window-key-1";
      const first = await injectJson(stub.app, "POST", "/v1/decisions", {
        payload: validDecisionRequest({ idempotencyKey: key, requestId: "req-A" }),
        headers: authHeaders(ALPHA),
      });
      expect(first.status).toBe(200);

      // Advance JUST inside the window: still a replay.
      now += 24 * 60 * 60 * 1000 - 1;
      const stillReplay = await injectJson(stub.app, "POST", "/v1/decisions", {
        payload: validDecisionRequest({ idempotencyKey: key, requestId: "req-A" }),
        headers: authHeaders(ALPHA),
      });
      expect(stillReplay.status).toBe(200);
      expect(stillReplay.headers["idempotent-replayed"]).toBe("true");
      expect(stub.state.decisionCalls).toBe(1);

      // Advance PAST the window: the key is forgotten — even a DIFFERENT
      // body executes fresh (no 422).
      now += 2;
      const fresh = await injectJson(stub.app, "POST", "/v1/decisions", {
        payload: validDecisionRequest({ idempotencyKey: key, requestId: "req-B" }),
        headers: authHeaders(ALPHA),
      });
      expect(fresh.status).toBe(200);
      expect(fresh.headers["idempotent-replayed"]).toBeUndefined();
      expect(stub.state.decisionCalls).toBe(2);
    } finally {
      await stub.app.close();
    }
  });

  it("InMemoryIdempotencyStore: custom window + clock drive eviction", async () => {
    let now = 500;
    const store = new InMemoryIdempotencyStore({ clock: () => now, windowMs: 100 });
    await store.store("tenant", "POST /v1/x", "key-1", "digest-1", { statusCode: 200, body: { ok: true } });
    expect(store.size).toBe(1);
    now += 99;
    expect((await store.lookup("tenant", "POST /v1/x", "key-1"))?.requestDigest).toBe("digest-1");
    now += 1;
    expect(await store.lookup("tenant", "POST /v1/x", "key-1")).toBeUndefined();
    expect(store.size).toBe(0);
  });
});
