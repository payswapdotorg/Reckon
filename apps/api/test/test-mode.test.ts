import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DecisionResultSchema,
  TEST_SCENARIOS,
  generateSecretKey,
  parseMagicTestItemId,
  type DecisionResult,
} from "@reckon/contracts";
import { buildServer } from "../src/server.js";
import type { StaticKeyConfig } from "../src/auth.js";
import { stubHandlers, newStubState } from "./fixtures.js";
import {
  ALPHA,
  NEW_SK_LIVE,
  NEW_SK_TEST,
  TENANT_T,
  authHeaders,
  buildDefaultServer,
  buildStubServer,
  injectJson,
  seedDecision,
  validDecisionRequest,
  validOutcomeEvent,
  validPreferenceDelta,
  validPlan,
  validCatalogItem,
  freshIdem,
  expectErrorEnvelope,
} from "./fixtures.js";
import type { StubServer } from "./fixtures.js";

/**
 * S2-003 — Stripe-style TEST MODE. The four acceptance groups:
 *
 * 1. key-mode matrix (live / test / legacy × routes): every
 *    authenticated response carries its mode; test keys drive fully
 *    separated test state;
 * 2. scenario determinism: same input → same canned output (content-
 *    derived ids, no wall clock, no persistence drift);
 * 3. cross-mode rejection: test key touching live data (and vice versa,
 *    and live keys carrying test-mode-only hints) → typed 403
 *    MODE_MISMATCH, both directions;
 * 4. mode marker presence: X-Reckon-Mode header everywhere, `mode:
 *    "test"` on test-mode decision payloads, provenance markers inside.
 */

const TENANT_X = "tenant-x";
const ALL_SCOPES = ["decisions", "outcomes", "plans", "catalog"] as const;

/**
 * Dedicated server where ONE tenant has BOTH a live and a test secret
 * key — the setup that makes cross-mode violations observable (same
 * tenant, different modes) without cross-tenant noise.
 */
interface ModePairServer {
  app: ReturnType<typeof buildServer>;
  state: ReturnType<typeof newStubState>;
  liveKey: string;
  testKey: string;
}

function buildModePairServer(): ModePairServer {
  const state = newStubState();
  const liveKey = generateSecretKey("live");
  const testKey = generateSecretKey("test");
  const keys: StaticKeyConfig[] = [
    { apiKey: liveKey, tenantId: TENANT_X, scopes: [...ALL_SCOPES] },
    { apiKey: testKey, tenantId: TENANT_X, scopes: [...ALL_SCOPES] },
  ];
  const app = buildServer({ keys, handlers: stubHandlers(state) });
  return { app, state, liveKey, testKey };
}

function decisionForTenant(tenantId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return validDecisionRequest({ tenant: { tenantId }, ...overrides });
}

async function postDecision(
  app: ReturnType<typeof buildServer>,
  key: string,
  payload: Record<string, unknown>,
) {
  return injectJson(app, "POST", "/v1/decisions", {
    payload,
    headers: authHeaders(key),
  });
}

describe("test mode: key-mode matrix (live/test/legacy × routes)", () => {
  let stub: StubServer;

  beforeEach(() => {
    stub = buildStubServer();
  });

  afterEach(async () => {
    await stub.app.close();
  });

  it("live keys (sk_live_ and legacy) are marked mode=live on every route family", async () => {
    const cases = await Promise.all([
      injectJson(stub.app, "POST", "/v1/decisions", {
        payload: validDecisionRequest(),
        headers: authHeaders(NEW_SK_LIVE),
      }),
      injectJson(stub.app, "POST", "/v1/outcomes", {
        payload: validOutcomeEvent(),
        headers: authHeaders(NEW_SK_LIVE),
      }),
      injectJson(stub.app, "POST", "/v1/preferences/events", {
        payload: validPreferenceDelta(),
        headers: { ...authHeaders(NEW_SK_LIVE), "idempotency-key": freshIdem("matrix") },
      }),
      injectJson(stub.app, "POST", "/v1/plans", {
        payload: validPlan(),
        headers: { ...authHeaders(NEW_SK_LIVE), "idempotency-key": freshIdem("matrix") },
      }),
      injectJson(stub.app, "POST", "/v1/catalog/items", {
        payload: validCatalogItem(),
        headers: { ...authHeaders(NEW_SK_LIVE), "idempotency-key": freshIdem("matrix") },
      }),
    ]);
    for (const res of cases) {
      expect(res.status).toBe(200);
      expect(res.headers["x-reckon-mode"]).toBe("live");
    }
    // legacy opaque key → live mode by the documented transition default
    const legacy = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest(),
      headers: authHeaders(ALPHA),
    });
    expect(legacy.status).toBe(200);
    expect(legacy.headers["x-reckon-mode"]).toBe("live");
  });

  it("test keys are marked mode=test on every route family (delegated routes keep working)", async () => {
    const cases = await Promise.all([
      injectJson(stub.app, "POST", "/v1/decisions", {
        payload: decisionForTenant(TENANT_T),
        headers: authHeaders(NEW_SK_TEST),
      }),
      injectJson(stub.app, "POST", "/v1/outcomes", {
        payload: validOutcomeEvent({ tenant: { tenantId: TENANT_T } }),
        headers: authHeaders(NEW_SK_TEST),
      }),
      injectJson(stub.app, "POST", "/v1/preferences/events", {
        payload: validPreferenceDelta({ tenant: { tenantId: TENANT_T } }),
        headers: { ...authHeaders(NEW_SK_TEST), "idempotency-key": freshIdem("tm") },
      }),
      injectJson(stub.app, "POST", "/v1/plans", {
        payload: validPlan({ tenant: { tenantId: TENANT_T } }),
        headers: { ...authHeaders(NEW_SK_TEST), "idempotency-key": freshIdem("tm") },
      }),
      injectJson(stub.app, "POST", "/v1/catalog/items", {
        payload: validCatalogItem(),
        headers: { ...authHeaders(NEW_SK_TEST), "idempotency-key": freshIdem("tm") },
      }),
    ]);
    for (const res of cases) {
      expect(res.status).toBe(200);
      expect(res.headers["x-reckon-mode"]).toBe("test");
    }
  });

  it("test-mode decisions work on a DEFAULT server with zero handlers mounted (canned engine, no 501)", async () => {
    const app = buildDefaultServer();
    try {
      const res = await postDecision(app, NEW_SK_TEST, decisionForTenant(TENANT_T));
      expect(res.status).toBe(200);
      expect(res.headers["x-reckon-mode"]).toBe("test");
      const parsed = DecisionResultSchema.parse(res.body);
      expect(parsed.action).toBe("SUGGEST");
      expect(parsed.provenance?.system).toBe("reckon-api-test-mode");
      // the live path on the same server is still 501 NOT_WIRED
      const live = await postDecision(app, NEW_SK_LIVE, validDecisionRequest());
      expect(live.status).toBe(501);
      expectErrorEnvelope(live.status, live.body, "NOT_WIRED");
    } finally {
      await app.close();
    }
  });

  it("test-mode decisions never execute the mounted live decision handler (separation law)", async () => {
    const before = stub.state.decisionCalls;
    const res = await postDecision(stub.app, NEW_SK_TEST, decisionForTenant(TENANT_T));
    expect(res.status).toBe(200);
    expect(stub.state.decisionCalls).toBe(before);
    // live requests still execute it
    await postDecision(stub.app, ALPHA, validDecisionRequest());
    expect(stub.state.decisionCalls).toBe(before + 1);
  });

  it("scope + tenant gates apply unchanged in test mode (test keys are full keys)", async () => {
    const crossTenant = await postDecision(stub.app, NEW_SK_TEST, decisionForTenant("tenant-b"));
    expect(crossTenant.status).toBe(403);
    expectErrorEnvelope(crossTenant.status, crossTenant.body, "TENANT_MISMATCH", "permission_error");
    expect(crossTenant.headers["x-reckon-mode"]).toBe("test");
  });
});

describe("test mode: scenario determinism (canned vocabulary)", () => {
  let stub: StubServer;

  beforeEach(() => {
    stub = buildStubServer();
  });

  afterEach(async () => {
    await stub.app.close();
  });

  it("same input → byte-identical canned output, no persistence drift (fresh idempotency keys)", async () => {
    const payload = decisionForTenant(TENANT_T, { requestId: "req-det-1" });
    const first = await postDecision(stub.app, NEW_SK_TEST, payload);
    const second = await postDecision(stub.app, NEW_SK_TEST, payload);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // distinct idempotency keys (fixtures mint fresh ones) → both EXECUTED,
    // and the outputs are identical: the canned engine is a pure function.
    expect(first.body).toEqual(second.body);
    const parsed = DecisionResultSchema.parse(first.body);
    expect(parsed.decisionId).toMatch(/^dec-test-/);
    // no drift: GET (test scope) returns exactly the canned record
    const got = await injectJson(stub.app, "GET", `/v1/decisions/${parsed.decisionId}`, {
      headers: authHeaders(NEW_SK_TEST),
    });
    expect(got.status).toBe(200);
    expect(got.body).toEqual(first.body);
  });

  it("the full frozen vocabulary maps to its documented canned action", async () => {
    const expectedActions: Record<(typeof TEST_SCENARIOS)[number], string> = {
      default: "SUGGEST",
      suggest: "SUGGEST",
      decline: "HOLD",
      hold: "HOLD",
      queue: "QUEUE",
      continue: "CONTINUE",
      switch: "SWITCH",
      interrupt: "INTERRUPT",
      resume: "RESUME",
      end: "END",
      error: "ERROR",
    };
    for (const scenario of TEST_SCENARIOS) {
      const res = await postDecision(stub.app, NEW_SK_TEST, {
        ...decisionForTenant(TENANT_T, { requestId: `req-${scenario}` }),
        scenario,
      });
      if (scenario === "error") {
        expect(res.status).toBe(500);
        expectErrorEnvelope(res.status, res.body, "INTERNAL", "api_error");
        const details = (res.body as { error: { details?: { scenario?: string } } }).error.details;
        expect(details?.scenario).toBe("error");
      } else {
        expect(res.status).toBe(200);
        const parsed = DecisionResultSchema.parse(res.body);
        expect(parsed.action).toBe(expectedActions[scenario]);
        expect(parsed.reasons.some((reason) => reason.code === `test.scenario.${scenario}`)).toBe(true);
      }
    }
  });

  it("scenario hints: body field, magic item id, and the default fallback", async () => {
    // body field
    const bodyHint = await postDecision(stub.app, NEW_SK_TEST, {
      ...decisionForTenant(TENANT_T, { requestId: "req-hint" }),
      scenario: "decline",
    });
    expect(bodyHint.status).toBe(200);
    expect(DecisionResultSchema.parse(bodyHint.body).action).toBe("HOLD");

    // magic item id (Stripe's magic test card analogue)
    const magicItem = await postDecision(stub.app, NEW_SK_TEST, {
      ...decisionForTenant(TENANT_T, { requestId: "req-magic" }),
      candidates: {
        setId: "cs-test",
        candidates: [{ itemId: "itm_test_decline", realizationIds: ["real-1"], source: "host-retrieval" }],
      },
    });
    expect(magicItem.status).toBe(200);
    const magicParsed = DecisionResultSchema.parse(magicItem.body);
    expect(magicParsed.action).toBe("HOLD");
    expect(magicParsed.decisionId).toMatch(/^dec-test-/);

    // default fallback: no hint → SUGGEST the first candidate
    const fallback = await postDecision(stub.app, NEW_SK_TEST, decisionForTenant(TENANT_T));
    const fallbackParsed = DecisionResultSchema.parse(fallback.body);
    expect(fallbackParsed.action).toBe("SUGGEST");
    expect(fallbackParsed.selectedExperience?.itemId).toBe("item-1");
  });

  it("canned decisions are deterministic functions of the request content (ids, at)", async () => {
    const at = 1_700_000_000_000;
    const payload = decisionForTenant(TENANT_T, { requestId: "req-clock", at });
    const res = await postDecision(stub.app, NEW_SK_TEST, payload);
    expect(res.status).toBe(200);
    const parsed = DecisionResultSchema.parse(res.body);
    expect(parsed.at).toBe(at);
    // different request content → different canned id (content-derived, not sequence)
    const other = await postDecision(stub.app, NEW_SK_TEST, {
      ...payload,
      requestId: "req-clock-2",
      idempotencyKey: freshIdem("det-2"),
    });
    const otherParsed = DecisionResultSchema.parse(other.body);
    expect(otherParsed.decisionId).not.toBe(parsed.decisionId);
  });

  it("unknown scenario values are typed 400s naming the vocabulary", async () => {
    const byField = await postDecision(stub.app, NEW_SK_TEST, {
      ...decisionForTenant(TENANT_T),
      scenario: "explode",
    });
    expect(byField.status).toBe(400);
    expectErrorEnvelope(byField.status, byField.body, "VALIDATION_ERROR", "invalid_request_error");
    const fieldError = (byField.body as { error: { param?: string; details?: { supportedScenarios?: string[] } } }).error;
    expect(fieldError.param).toBe("scenario");
    expect(fieldError.details?.supportedScenarios).toEqual([...TEST_SCENARIOS]);

    const byMagicItem = await postDecision(stub.app, NEW_SK_TEST, {
      ...decisionForTenant(TENANT_T),
      candidates: {
        setId: "cs-test",
        candidates: [{ itemId: "itm_test_nope", realizationIds: ["real-1"], source: "host-retrieval" }],
      },
    });
    expect(byMagicItem.status).toBe(400);
    expectErrorEnvelope(byMagicItem.status, byMagicItem.body, "VALIDATION_ERROR", "invalid_request_error");
    expect(
      (byMagicItem.body as { error: { param?: string } }).error.param,
    ).toBe("candidates");
  });

  it("the vocabulary + magic-id parser hold their contract invariants (contracts source of truth)", () => {
    expect(TEST_SCENARIOS).toContain("default");
    expect(TEST_SCENARIOS).toContain("error");
    expect(parseMagicTestItemId("itm_test_decline")).toEqual({ scenario: "decline" });
    expect(parseMagicTestItemId("itm_test_nope")).toEqual({ scenario: null });
    expect(parseMagicTestItemId("itm_test_")).toEqual({ scenario: null });
    expect(parseMagicTestItemId("item-1")).toBeNull();
    expect(parseMagicTestItemId("itm_testish")).toBeNull();
  });

  it("idempotent replays work inside test mode (mode-scoped replay map)", async () => {
    const key = freshIdem("test-replay");
    const payload = validPreferenceDelta({ tenant: { tenantId: TENANT_T } });
    const first = await injectJson(stub.app, "POST", "/v1/preferences/events", {
      payload,
      headers: { ...authHeaders(NEW_SK_TEST), "idempotency-key": key },
    });
    const replay = await injectJson(stub.app, "POST", "/v1/preferences/events", {
      payload,
      headers: { ...authHeaders(NEW_SK_TEST), "idempotency-key": key },
    });
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.headers["idempotent-replayed"]).toBe("true");
    expect(stub.state.preferenceCalls).toBe(1);
  });
});

describe("test mode: cross-mode rejection (MODE_MISMATCH, both directions)", () => {
  let pair: ModePairServer;

  beforeEach(() => {
    pair = buildModePairServer();
  });

  afterEach(async () => {
    await pair.app.close();
  });

  it("test key hitting live data → typed 403 MODE_MISMATCH (permission_error)", async () => {
    const liveDecision = seedDecision(pair.state, TENANT_X, "dec-live-1", {
      reasons: [{ code: "live-secret", message: "live-only-secret-reason" }],
    });
    const res = await injectJson(pair.app, "GET", "/v1/decisions/dec-live-1", {
      headers: authHeaders(pair.testKey),
    });
    expect(res.status).toBe(403);
    expectErrorEnvelope(res.status, res.body, "MODE_MISMATCH", "permission_error");
    const error = (res.body as { error: { doc_url?: string; details?: Record<string, unknown> } }).error;
    expect(error.doc_url).toBe("https://docs.reckon.dev/errors/mode-mismatch");
    expect(error.details).toMatchObject({ keyMode: "test", dataMode: "live", decisionId: "dec-live-1" });
    // live decision CONTENT never leaks into the test response (only the
    // typed envelope; the id is named on purpose — same-tenant detection)
    expect(JSON.stringify(res.body)).not.toContain("live-only-secret-reason");
    expect(JSON.stringify(res.body)).not.toContain("\"action\"");
    void liveDecision;
  });

  it("live key hitting test data → typed 403 MODE_MISMATCH (the other direction)", async () => {
    const posted = await postDecision(pair.app, pair.testKey, decisionForTenant(TENANT_X));
    expect(posted.status).toBe(200);
    const cannedId = DecisionResultSchema.parse(posted.body).decisionId;
    const res = await injectJson(pair.app, `GET`, `/v1/decisions/${cannedId}`, {
      headers: authHeaders(pair.liveKey),
    });
    expect(res.status).toBe(403);
    expectErrorEnvelope(res.status, res.body, "MODE_MISMATCH", "permission_error");
    expect(
      (res.body as { error: { details?: Record<string, unknown> } }).error.details,
    ).toMatchObject({ keyMode: "live", dataMode: "test", decisionId: cannedId });
  });

  it("live key carrying test-mode-only hints → typed 403 MODE_MISMATCH (scenario field)", async () => {
    const res = await postDecision(pair.app, pair.liveKey, {
      ...decisionForTenant(TENANT_X),
      scenario: "decline",
    });
    expect(res.status).toBe(403);
    expectErrorEnvelope(res.status, res.body, "MODE_MISMATCH", "permission_error");
    const error = (res.body as { error: { param?: string; details?: Record<string, unknown> } }).error;
    expect(error.param).toBe("scenario");
    expect(error.details).toMatchObject({ keyMode: "live", hint: "scenario" });
    expect(pair.state.decisionCalls).toBe(0);
  });

  it("live key referencing a reserved itm_test_ item id → typed 403 MODE_MISMATCH", async () => {
    const res = await postDecision(pair.app, pair.liveKey, {
      ...decisionForTenant(TENANT_X),
      candidates: {
        setId: "cs-live",
        candidates: [{ itemId: "itm_test_hold", realizationIds: ["real-1"], source: "host-retrieval" }],
      },
    });
    expect(res.status).toBe(403);
    expectErrorEnvelope(res.status, res.body, "MODE_MISMATCH", "permission_error");
    const error = (res.body as { error: { param?: string; details?: Record<string, unknown> } }).error;
    expect(error.param).toBe("candidates");
    expect(error.details).toMatchObject({ keyMode: "live", itemId: "itm_test_hold" });
  });

  it("unknown decision ids stay 404 (invisible) in both modes — cross-TENANT stays invisible too", async () => {
    const testMiss = await injectJson(pair.app, "GET", "/v1/decisions/dec-nope", {
      headers: authHeaders(pair.testKey),
    });
    expect(testMiss.status).toBe(404);
    expectErrorEnvelope(testMiss.status, testMiss.body, "NOT_FOUND");

    const liveMiss = await injectJson(pair.app, "GET", "/v1/decisions/dec-nope", {
      headers: authHeaders(pair.liveKey),
    });
    expect(liveMiss.status).toBe(404);

    // another tenant's live data: invisible to the test key (404, never 403)
    seedDecision(pair.state, "tenant-y", "dec-y-1");
    const crossTenant = await injectJson(pair.app, "GET", "/v1/decisions/dec-y-1", {
      headers: authHeaders(pair.testKey),
    });
    expect(crossTenant.status).toBe(404);
    expectErrorEnvelope(crossTenant.status, crossTenant.body, "NOT_FOUND");
  });

  it("idempotency state is mode-scoped: same tenant + same key never replays across modes", async () => {
    const idem = freshIdem("cross-mode");
    const payload = validPreferenceDelta({ tenant: { tenantId: TENANT_X } });
    const liveFirst = await injectJson(pair.app, "POST", "/v1/preferences/events", {
      payload,
      headers: { ...authHeaders(pair.liveKey), "idempotency-key": idem },
    });
    const testSameKey = await injectJson(pair.app, "POST", "/v1/preferences/events", {
      payload,
      headers: { ...authHeaders(pair.testKey), "idempotency-key": idem },
    });
    expect(liveFirst.status).toBe(200);
    expect(testSameKey.status).toBe(200);
    // NOT a replay of the live response: the handler executed again,
    // and the responses carry their own modes.
    expect(testSameKey.headers["idempotent-replayed"]).toBeUndefined();
    expect(liveFirst.headers["x-reckon-mode"]).toBe("live");
    expect(testSameKey.headers["x-reckon-mode"]).toBe("test");
    expect(pair.state.preferenceCalls).toBe(2);

    // and the reverse: a test-mode entry is invisible to the live scope
    const idem2 = freshIdem("cross-mode-2");
    const testFirst = await injectJson(pair.app, "POST", "/v1/preferences/events", {
      payload,
      headers: { ...authHeaders(pair.testKey), "idempotency-key": idem2 },
    });
    const liveSameKey = await injectJson(pair.app, "POST", "/v1/preferences/events", {
      payload,
      headers: { ...authHeaders(pair.liveKey), "idempotency-key": idem2 },
    });
    expect(testFirst.status).toBe(200);
    expect(liveSameKey.status).toBe(200);
    expect(liveSameKey.headers["idempotent-replayed"]).toBeUndefined();
    expect(pair.state.preferenceCalls).toBe(4);
  });
});

describe("test mode: mode marker presence (Stripe-style indicators)", () => {
  let stub: StubServer;

  beforeEach(() => {
    stub = buildStubServer();
  });

  afterEach(async () => {
    await stub.app.close();
  });

  it("X-Reckon-Mode rides on success AND typed errors in both modes; 401 carries none", async () => {
    const success = await postDecision(stub.app, NEW_SK_TEST, decisionForTenant(TENANT_T));
    expect(success.headers["x-reckon-mode"]).toBe("test");

    const badBody = await postDecision(stub.app, NEW_SK_TEST, {
      ...decisionForTenant(TENANT_T),
      idempotencyKey: undefined,
    });
    expect(badBody.status).toBe(400);
    expect(badBody.headers["x-reckon-mode"]).toBe("test");

    const notFound = await injectJson(stub.app, "GET", "/v1/decisions/dec-none", {
      headers: authHeaders(ALPHA),
    });
    expect(notFound.status).toBe(404);
    expect(notFound.headers["x-reckon-mode"]).toBe("live");

    const unauthenticated = await injectJson(stub.app, "POST", "/v1/decisions", {
      payload: validDecisionRequest(),
      headers: { "content-type": "application/json" },
    });
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers["x-reckon-mode"]).toBeUndefined();
  });

  it("test-mode decision payloads carry mode: \"test\" + in-schema provenance/reason markers", async () => {
    const res = await postDecision(stub.app, NEW_SK_TEST, decisionForTenant(TENANT_T));
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown> & { mode?: string };
    expect(body.mode).toBe("test");
    const parsed = DecisionResultSchema.parse(res.body);
    expect(parsed.provenance?.system).toBe("reckon-api-test-mode");
    expect(parsed.reasons.some((reason) => reason.code === "test.mode")).toBe(true);
    // the marker is additive: the payload still validates as the frozen contract
    expect(parsed.schema).toBe("reckon.decision-result");
  });

  it("test-mode GET of a canned decision carries the marker; live responses are unchanged", async () => {
    const posted = await postDecision(stub.app, NEW_SK_TEST, decisionForTenant(TENANT_T));
    const cannedId = DecisionResultSchema.parse(posted.body).decisionId;
    const got = await injectJson(stub.app, "GET", `/v1/decisions/${cannedId}`, {
      headers: authHeaders(NEW_SK_TEST),
    });
    expect(got.status).toBe(200);
    expect((got.body as Record<string, unknown>).mode).toBe("test");

    const live = await postDecision(stub.app, ALPHA, validDecisionRequest());
    expect(live.status).toBe(200);
    expect((live.body as Record<string, unknown>).mode).toBeUndefined();
    const liveParsed: DecisionResult = DecisionResultSchema.parse(live.body);
    expect(liveParsed.provenance?.system).not.toBe("reckon-api-test-mode");
  });

  it("test-mode expansion of a canned decision never reads live catalog state (item: null, honest absence)", async () => {
    const posted = await postDecision(stub.app, NEW_SK_TEST, decisionForTenant(TENANT_T));
    const cannedId = DecisionResultSchema.parse(posted.body).decisionId;
    const got = await injectJson(
      stub.app,
      "GET",
      `/v1/decisions/${cannedId}?${encodeURIComponent("expand[]")}=selectedExperience.item`,
      { headers: authHeaders(NEW_SK_TEST) },
    );
    expect(got.status).toBe(200);
    const body = got.body as { selectedExperience?: { item?: unknown } };
    expect(body.selectedExperience?.item).toBeNull();
    expect(stub.state.catalogReaderTenants).toEqual([]);
  });
});
