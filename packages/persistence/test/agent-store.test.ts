/**
 * UI-007 — PgAgentStore over a REAL PostgreSQL server: versioned
 * append-only agent body + organization declarations, tenant from caller
 * scope (catalog pattern). Evidence class: controlled-local.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentBodySchema, AgentOrganizationSchema } from "@reckon/contracts";
import { PgAgentStore, StateIdConflictError } from "../src/index.js";
import { startTestPostgres, type TestPostgres } from "./pg-harness.js";

function makeBody(overrides: Record<string, unknown> = {}) {
  return AgentBodySchema.parse({
    schema: "reckon.agent-body",
    schemaVersion: "0.1.0",
    bodyId: "body-1",
    version: "1",
    role: { roleId: "researcher", description: "Finds candidate evidence." },
    observations: [],
    tools: [],
    permissions: [],
    memoryInterfaces: [],
    actions: [],
    budgets: [],
    ...overrides,
  });
}

function makeOrganization(overrides: Record<string, unknown> = {}) {
  const generalist = makeBody({ bodyId: "body-gen", role: { roleId: "generalist", description: "Root." } });
  const researcher = makeBody({ bodyId: "body-res", role: { roleId: "researcher", description: "Finds." } });
  return AgentOrganizationSchema.parse({
    schema: "reckon.agent-organization",
    schemaVersion: "0.1.0",
    organizationId: "org-1",
    version: "1",
    bodies: [generalist, researcher],
    edges: [
      { edgeId: "e1", fromBodyId: "body-gen", toBodyId: "body-res", kind: "delegate" },
    ],
    memoryTopology: { sharedMemories: [], privateMemories: [] },
    modelAssignments: [
      { bodyId: "body-gen", modelAdapterId: "router-1", modelId: "m-small" },
    ],
    budgets: [],
    terminationRules: [{ kind: "task-complete" }],
    ...overrides,
  });
}

const TENANT = { tenantId: "tenant-agents" };

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startTestPostgres();
}, 120_000);

afterAll(async () => {
  await pg.stop();
}, 60_000);

describe("UI-007 PgAgentStore — bodies", () => {
  it("put + get round-trip; latest version wins; list newest-first bounded", async () => {
    const store = new PgAgentStore(pg.executor, () => 1_000);
    await store.putBody(TENANT, makeBody({ bodyId: "b-old", version: "1" }));
    await store.putBody(TENANT, makeBody({ bodyId: "b-old", version: "2" }));
    await store.putBody(TENANT, makeBody({ bodyId: "b-new", version: "1" }));
    const store2 = new PgAgentStore(pg.executor, () => 2_000);
    await store2.putBody(TENANT, makeBody({ bodyId: "b-new", version: "9" }));

    const latest = await store.getBody(TENANT, "b-new");
    expect(latest?.body.version).toBe("9");
    expect(await store.getBody(TENANT, "no-such")).toBeNull();

    const list = await store.listBodies(TENANT);
    expect(list.map((entry) => entry.body.bodyId)).toEqual(["b-new", "b-old"]);
    expect(list[0]?.body.version).toBe("9");
    expect((await store.listBodies(TENANT, 1)).map((e) => e.body.bodyId)).toEqual(["b-new"]);
    expect(await store.listBodies({ tenantId: "other" })).toEqual([]);
  });

  it("idempotent re-put of identical content; conflicting re-put is a typed error", async () => {
    const store = new PgAgentStore(pg.executor, () => 3_000);
    const body = makeBody({ bodyId: "b-idem", version: "5" });
    await store.putBody(TENANT, body);
    await expect(store.putBody(TENANT, body)).resolves.toMatchObject({ storedAt: 0 });
    await expect(
      store.putBody(TENANT, makeBody({ bodyId: "b-idem", version: "5", role: { roleId: "critic", description: "Different." } })),
    ).rejects.toThrow(StateIdConflictError);
  });
});

describe("UI-007 PgAgentStore — organizations", () => {
  it("put + get round-trip; version-append; tenant isolation; list bounded", async () => {
    const store = new PgAgentStore(pg.executor, () => 4_000);
    await store.putOrganization(TENANT, makeOrganization({ organizationId: "o-1", version: "1" }));
    await store.putOrganization(TENANT, makeOrganization({ organizationId: "o-1", version: "2" }));
    await store.putOrganization(TENANT, makeOrganization({ organizationId: "o-2", version: "1" }));

    const latest = await store.getOrganization(TENANT, "o-1");
    expect(latest?.organization.version).toBe("2");
    expect(latest?.organization.bodies).toHaveLength(2);
    expect(latest?.organization.edges[0]?.kind).toBe("delegate");
    expect(await store.getOrganization(TENANT, "no-such")).toBeNull();
    expect(await store.getOrganization({ tenantId: "other" }, "o-1")).toBeNull();

    const list = await store.listOrganizations(TENANT);
    expect(list.map((entry) => entry.organization.organizationId)).toEqual(["o-1", "o-2"]);
    expect((await store.listOrganizations(TENANT, 1)).map((e) => e.organization.organizationId)).toEqual(["o-1"]);
    expect(await store.listOrganizations({ tenantId: "other" })).toEqual([]);
  });
});
