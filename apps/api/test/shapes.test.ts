import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  CONTRACT_IDS,
  CONTRACT_VERSIONS,
  CONTRACTS_VERSION,
  ExperiencePlanSchema,
  ExperienceSchema,
  OutcomeEventSchema,
  PreferenceDeltaSchema,
  CatalogItemSchema,
  RealizationSchema,
  CandidateSetSchema,
} from "@reckon/contracts";
import {
  ALPHA,
  authHeaders,
  buildStubServer,
  idemHeader,
  injectJson,
  validCandidateSet,
  validCatalogItem,
  validOutcomeEvent,
  validPlan,
  validPreferenceDelta,
  validRealization,
  validReplanRequest,
  validResolveRequest,
  freshIdem,
} from "./fixtures.js";
import type { StubServer } from "./fixtures.js";

/**
 * Success-shape checks per route (stub server): every success response is
 * validated against the REAL imported contract schema and carries the
 * `schema` + `schemaVersion` echo.
 */

describe("success response shapes (schema echo on every route)", () => {
  let stub: StubServer;

  beforeEach(() => {
    stub = buildStubServer();
  });

  afterEach(async () => {
    await stub.app.close();
  });

  it("POST /v1/outcomes echoes the accepted event (contract-valid, auth tenant observed by the port)", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/outcomes", {
      payload: validOutcomeEvent({ metrics: { completionRate: 1 } }),
      headers: authHeaders(ALPHA),
    });
    expect(res.status).toBe(200);
    const parsed = OutcomeEventSchema.parse(res.body);
    expect(parsed.schema).toBe(CONTRACT_IDS.outcomeEvent);
    expect(parsed.schemaVersion).toBe(CONTRACT_VERSIONS[CONTRACT_IDS.outcomeEvent]);
    expect(parsed.eventId).toBe("ev-1");
    expect(parsed.metrics).toEqual({ completionRate: 1 });
    // The ingest port received the authenticated tenant (auth flows to ports).
    expect(stub.state.outcomeTenants).toEqual(["tenant-a"]);
  });

  it("POST /v1/preferences/events echoes the accepted delta", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/preferences/events", {
      payload: validPreferenceDelta({ dimension: "genre.scifi" }),
      headers: idemHeader(freshIdem("pref")),
    });
    expect(res.status).toBe(200);
    const parsed = PreferenceDeltaSchema.parse(res.body);
    expect(parsed.schema).toBe(CONTRACT_IDS.preferenceDelta);
    expect(parsed.schemaVersion).toBe(CONTRACT_VERSIONS[CONTRACT_IDS.preferenceDelta]);
    expect(parsed.dimension).toBe("genre.scifi");
  });

  it("POST /v1/plans returns an ExperiencePlanSchema-valid plan", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/plans", {
      payload: validPlan(),
      headers: idemHeader(freshIdem("plan")),
    });
    expect(res.status).toBe(200);
    const parsed = ExperiencePlanSchema.parse(res.body);
    expect(parsed.schema).toBe(CONTRACT_IDS.experiencePlan);
    expect(parsed.schemaVersion).toBe(CONTRACT_VERSIONS[CONTRACT_IDS.experiencePlan]);
    expect(parsed.planId).toBe("plan-1");
    expect(parsed.version).toBe(0);
  });

  it("POST /v1/plans/{id}/replan returns a contract-valid plan bound to the path id", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/plans/plan-77/replan", {
      payload: validReplanRequest({ trigger: "fatigue-signal" }),
      headers: idemHeader(freshIdem("replan")),
    });
    expect(res.status).toBe(200);
    const parsed = ExperiencePlanSchema.parse(res.body);
    expect(parsed.planId).toBe("plan-77");
    expect(parsed.tenant.tenantId).toBe("tenant-a");
    expect(parsed.replanTriggers).toContain("fatigue-signal");
    expect(parsed.schema).toBe(CONTRACT_IDS.experiencePlan);
  });

  it("POST /v1/catalog/items echoes a contract-valid CatalogItem", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/catalog/items", {
      payload: validCatalogItem(),
      headers: idemHeader(freshIdem("item")),
    });
    expect(res.status).toBe(200);
    const parsed = CatalogItemSchema.parse(res.body);
    expect(parsed.schema).toBe(CONTRACT_IDS.catalogItem);
    expect(parsed.schemaVersion).toBe(CONTRACT_VERSIONS[CONTRACT_IDS.catalogItem]);
    expect(parsed.itemId).toBe("item-1");
    expect(parsed.kind).toBe("media");
  });

  it("POST /v1/catalog/realizations echoes a contract-valid Realization", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/catalog/realizations", {
      payload: validRealization(),
      headers: idemHeader(freshIdem("real")),
    });
    expect(res.status).toBe(200);
    const parsed = RealizationSchema.parse(res.body);
    expect(parsed.schema).toBe(CONTRACT_IDS.realization);
    expect(parsed.schemaVersion).toBe(CONTRACT_VERSIONS[CONTRACT_IDS.realization]);
    expect(parsed.realizationId).toBe("real-1");
  });

  it("POST /v1/candidates returns the set plus the injected schema echo", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/candidates", {
      payload: validCandidateSet(),
      headers: idemHeader(freshIdem("cand")),
    });
    expect(res.status).toBe(200);
    const envelope = res.body as { schema?: string; schemaVersion?: string };
    // API-level echo label (CandidateSet has no standalone contract id).
    expect(envelope.schema).toBe("reckon.candidate-set");
    expect(envelope.schemaVersion).toBe(CONTRACTS_VERSION);
    // The contract-valid part (echo fields are stripped by the schema).
    const parsed = CandidateSetSchema.parse(res.body);
    expect(parsed.setId).toBe("cs-1");
    expect(parsed.candidates).toHaveLength(1);
  });

  it("POST /v1/experiences/resolve returns ExperienceSchema-valid elements + envelope echo", async () => {
    const res = await injectJson(stub.app, "POST", "/v1/experiences/resolve", {
      payload: validResolveRequest(),
      headers: idemHeader(freshIdem("res")),
    });
    expect(res.status).toBe(200);
    const envelope = res.body as {
      schema?: string;
      schemaVersion?: string;
      experiences?: unknown[];
    };
    expect(envelope.schema).toBe(CONTRACT_IDS.experience);
    expect(envelope.schemaVersion).toBe(CONTRACT_VERSIONS[CONTRACT_IDS.experience]);
    expect(envelope.experiences).toHaveLength(1);
    for (const experience of envelope.experiences ?? []) {
      const parsed = ExperienceSchema.parse(experience);
      expect(parsed.schema).toBe(CONTRACT_IDS.experience);
      expect(parsed.itemId).toBe("item-1");
    }
  });

  it("each route family runs its port (all stub handlers exercised)", async () => {
    await injectJson(stub.app, "POST", "/v1/catalog/items", {
      payload: validCatalogItem(),
      headers: idemHeader(freshIdem("a")),
    });
    await injectJson(stub.app, "POST", "/v1/catalog/realizations", {
      payload: validRealization(),
      headers: idemHeader(freshIdem("b")),
    });
    await injectJson(stub.app, "POST", "/v1/candidates", {
      payload: validCandidateSet(),
      headers: idemHeader(freshIdem("c")),
    });
    await injectJson(stub.app, "POST", "/v1/experiences/resolve", {
      payload: validResolveRequest(),
      headers: idemHeader(freshIdem("d")),
    });
    await injectJson(stub.app, "POST", "/v1/plans", {
      payload: validPlan(),
      headers: idemHeader(freshIdem("e")),
    });
    await injectJson(stub.app, "POST", "/v1/plans/plan-1/replan", {
      payload: validReplanRequest(),
      headers: idemHeader(freshIdem("f")),
    });
    expect(stub.state.catalogItemCalls).toBe(1);
    expect(stub.state.realizationCalls).toBe(1);
    expect(stub.state.candidateCalls).toBe(1);
    expect(stub.state.resolveCalls).toBe(1);
    expect(stub.state.planCreateCalls).toBe(1);
    expect(stub.state.replanCalls).toBe(1);
  });
});
