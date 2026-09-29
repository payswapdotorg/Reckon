import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DecisionResultSchema } from "@reckon/contracts";
import {
  ALPHA,
  BETA,
  GAMMA,
  authHeaders,
  buildDefaultServer,
  buildStubServer,
  injectJson,
  validDecisionRequest,
  expectErrorEnvelope,
  seedDecision,
} from "./fixtures.js";
import type { StubServer } from "./fixtures.js";

describe("POST /v1/decisions (wired)", () => {
  let stub: StubServer;

  beforeEach(() => {
    stub = buildStubServer();
  });

  afterEach(async () => {
    await stub.app.close();
  });

  it("returns a DecisionResultSchema-valid body (validated with the imported contract)", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest(),
      headers: authHeaders(ALPHA),
    });
    expect(res.status).toBe(200);
    const parsed = DecisionResultSchema.parse(res.body);
    expect(parsed.schema).toBe("reckon.decision-result");
    expect(parsed.schemaVersion).toBe("0.1.0");
    expect(parsed.action).toBe("SUGGEST");
    expect(parsed.requestId).toBe("req-1");
    expect(parsed.tenant.tenantId).toBe("tenant-a");
  });

  it("derivation is deterministic: decisionId is a pure function of auth tenant + idempotency key", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest({ idempotencyKey: "determinism-check" }),
      headers: authHeaders(ALPHA),
    });
    expect(res.status).toBe(200);
    const parsed = DecisionResultSchema.parse(res.body);
    expect(parsed.decisionId).toBe("dec-tenant-a-determinism-check");
  });
});

describe("GET /v1/decisions/{id}", () => {
  let stub: StubServer;

  beforeEach(() => {
    stub = buildStubServer();
  });

  afterEach(async () => {
    await stub.app.close();
  });

  it("501 NOT_WIRED when no store is mounted (default server)", async () => {
    const app = buildDefaultServer();
    try {
      const res = await injectJson(app, "GET", "/v1/decisions/dec-x", {
        headers: authHeaders(ALPHA),
      });
      expect(res.status).toBe(501);
      expectErrorEnvelope(res.status, res.body, "NOT_WIRED");
      const details = (res.body as { error: { details?: { port?: string } } }).error.details;
      expect(details?.port).toBe("DecisionStore");
    } finally {
      await app.close();
    }
  });

  it("404 typed when the decision id is unknown", async () => {
    const res = await injectJson(stub.app, "GET", "/v1/decisions/dec-unknown", {
      headers: authHeaders(ALPHA),
    });
    expect(res.status).toBe(404);
    expectErrorEnvelope(res.status, res.body, "NOT_FOUND");
  });

  it("200 with a DecisionResultSchema-valid body for the authenticated tenant", async () => {
    seedDecision(stub.state, "tenant-a", "dec-42");
    const res = await injectJson(stub.app, "GET", "/v1/decisions/dec-42", {
      headers: authHeaders(ALPHA),
    });
    expect(res.status).toBe(200);
    const parsed = DecisionResultSchema.parse(res.body);
    expect(parsed.decisionId).toBe("dec-42");
    expect(parsed.schema).toBe("reckon.decision-result");
  });

  it("401 without auth", async () => {
    const res = await injectJson(stub.app, "GET", "/v1/decisions/dec-42", {});
    expect(res.status).toBe(401);
    expectErrorEnvelope(res.status, res.body, "UNAUTHENTICATED");
  });

  it("403 with a key lacking the decisions scope", async () => {
    seedDecision(stub.state, "tenant-c", "dec-c");
    const res = await injectJson(stub.app, "GET", "/v1/decisions/dec-c", {
      headers: authHeaders(GAMMA),
    });
    expect(res.status).toBe(403);
    expectErrorEnvelope(res.status, res.body, "INSUFFICIENT_SCOPE");
  });
});
