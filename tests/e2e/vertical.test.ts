import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer, wireOutcomeTransport } from "../../apps/api/src/index.js";
import type { HandlerPorts } from "../../apps/api/src/ports.js";
import type { ExperiencePlan } from "../../packages/contracts/src/index.js";
import { createReckonClient, createInjectFetch } from "../../packages/sdk/src/index.js";
import type { DecisionRequestInput, OutcomeEventInput } from "../../packages/sdk/src/client.js";
import { InMemoryEventStoreAdapter, JsonlFileJournal, ManualClock } from "../../packages/events/src/index.js";
import { JsonlFileObservabilitySink, ObservabilityRecorder } from "../../packages/observability/src/index.js";
import { DecisionResultSchema, ExperiencePlanSchema, ExperienceSchema } from "../../packages/contracts/src/index.js";
import type { OutcomeEvent, TenantScope } from "../../packages/contracts/src/index.js";

/**
 * W3 end-to-end vertical (W3-002 + W3-003 + W3-004 composed):
 * SDK → apps/api (auth/tenant/validation/idempotency) → outcome transport
 * → EventStore sink (+ JSONL journal) — with observability records
 * emitted along the way. Evidence class: controlled-local. The API app,
 * route pipeline, transport, journals and sinks are the REAL repository
 * implementations; only the handler ports are deterministic test doubles
 * (the injectable seams by design).
 */

const TENANT_A = "e2e-tenant-a";
const TENANT_B = "e2e-tenant-b";
const KEY_A = "e2e-key-a";
const KEY_B = "e2e-key-b";
const tenantA: TenantScope = { tenantId: TENANT_A };

const KEYS = [
  { apiKey: KEY_A, tenantId: TENANT_A, scopes: ["decisions", "outcomes", "plans", "catalog"] as const },
  { apiKey: KEY_B, tenantId: TENANT_B, scopes: ["decisions", "outcomes", "plans", "catalog"] as const },
];

let unique = 0;
function id(prefix: string): string {
  unique += 1;
  return `${prefix}-${unique}`;
}

function decisionInput(overrides: Record<string, unknown> = {}): DecisionRequestInput {
  return {
    requestId: id("req"),
    tenant: { tenantId: TENANT_A },
    subject: { kind: "user", ref: "user-9" },
    objective: { objectiveId: "obj-1", kind: "relax" },
    attentionPolicy: { policyId: "ap-1", style: "balanced" },
    context: { contextId: "ctx-1" },
    candidates: {
      setId: id("cs"),
      candidates: [{ itemId: "item-1", realizationIds: ["real-1"], source: "host-retrieval" }],
    },
    policySelector: { policyId: "greedy-v1", version: "2" },
    idempotencyKey: id("idem"),
    ...overrides,
  } as DecisionRequestInput;
}

function outcomeInput(overrides: Record<string, unknown> = {}): OutcomeEventInput {
  return {
    eventId: id("ev"),
    tenant: { tenantId: TENANT_A },
    subject: { kind: "user", ref: "user-9" },
    eventType: "completion",
    occurredAt: 2_000,
    metrics: { watchRatio: 0.93 },
    evidenceClass: "production-observed",
    experienceId: "exp-item-1-real-1",
    idempotencyKey: id("outcome"),
    ...overrides,
  } as OutcomeEventInput;
}

describe("W3 e2e vertical — SDK → API → transport → store, with observability", () => {
  it("runs the full decision → schedule → outcome loop with durable evidence", async () => {
    const dir = mkdtempSync(join(tmpdir(), "reckon-e2e-"));
    try {
      const journalPath = join(dir, "outcomes.jsonl");
      const observabilityPath = join(dir, "records.jsonl");

      // The composition: real store + real transport + real journal +
      // real observability sink, all behind the real API app.
      const store = new InMemoryEventStoreAdapter();
      const clock = new ManualClock(1_000);
      const failureRecorder = new ObservabilityRecorder({
        sink: new JsonlFileObservabilitySink(observabilityPath),
        clock: () => clock.now(),
      });
      const wiring = wireOutcomeTransport({
        store,
        clock,
        journal: new JsonlFileJournal(journalPath),
        onTerminalFailure: (failure) =>
          failureRecorder.recordError({
            scope: "transport",
            code: "TRANSPORT_TERMINAL_FAILURE",
            message: failure.reason.message,
            tenant: failure.event.tenant,
          }),
      });

      const decisionHandler: HandlerPorts["decisionHandler"] = {
        decide: async (request) => {
          clock.advance(25); // deterministic handler work
          return DecisionResultSchema.parse({
            decisionId: `dec-${request.idempotencyKey}`,
            requestId: request.requestId,
            tenant: request.tenant,
            action: "SUGGEST",
            selectedExperience: {
              experienceId: "exp-item-1-real-1",
              itemId: "item-1",
              realizationId: "real-1",
              format: { kind: "full", params: {} },
            },
            uncertainty: { confidence: 0.8, method: "ensemble" },
            policy: { policyId: request.policySelector.policyId, version: request.policySelector.version },
            scheduleDelta: { action: "SUGGEST", enqueue: ["exp-item-1-real-1"], dequeue: [] },
            at: clock.now(),
          });
        },
      };

      const app = buildServer({
        apiVersion: "e2e",
        keys: KEYS,
        handlers: {
          decisionHandler,
          outcomeIngest: wiring.handler,
          catalogItemIngest: { ingest: async (item) => item },
          realizationIngest: { ingest: async (realization) => realization },
          candidatesHandler: { submit: async (set) => set },
          experienceResolver: {
            resolve: async (request) => ({
              experiences: request.realizations.map((r) =>
                ExperienceSchema.parse({
                  experienceId: `exp-${r.itemId}-${r.realizationId}`,
                  itemId: r.itemId,
                  realizationId: r.realizationId,
                  format: { kind: "full", params: {} },
                }),
              ),
            }),
          },
          preferenceIngest: { ingest: async (delta) => delta },
          planHandler: {
            create: async (plan) => plan,
            get: async () => null,
            history: async () =>
              [] as readonly { plan: ExperiencePlan; version: number; reason: string | null }[],
            listRecent: async () => [],
            replan: async (planId, request) =>
              ExperiencePlanSchema.parse({
                planId,
                version: 1,
                tenant: { tenantId: TENANT_A },
                subject: { kind: "user", ref: "user-9" },
                objective: { objectiveId: "obj-1", kind: "relax" },
                attentionPolicy: { policyId: "ap-1", style: "mindful" },
                queuedExperiences: [],
                replanTriggers: [request.trigger],
                createdAt: 0,
                updatedAt: 1,
              }),
          },
        },
        observability: {
          sink: new JsonlFileObservabilitySink(observabilityPath),
          clock: () => clock.now(),
          idGenerator: (() => {
            let n = 0;
            return () => `rec-${(n += 1)}`;
          })(),
        },
      });

      const client = createReckonClient({
        baseUrl: "http://reckon-e2e.test",
        apiKey: KEY_A,
        fetchImpl: createInjectFetch(app),
      });

      // 1. Catalog: item + realization upserts.
      const item = await client.catalog.upsertItem({
        itemId: "item-1",
        kind: "media",
        labels: ["scifi"],
        attributes: { year: 2024 },
      });
      expect(item.schema).toBe("reckon.catalog-item");
      const realization = await client.catalog.upsertRealization({
        realizationId: "real-1",
        itemId: "item-1",
        kind: "stream",
      });
      expect(realization.schema).toBe("reckon.realization");

      // 2. Candidate submission + experience resolution.
      const candidates = await client.candidates.submit({
        setId: "cs-e2e",
        candidates: [{ itemId: "item-1", realizationIds: ["real-1"], source: "host-retrieval" }],
      });
      expect(candidates.candidates).toHaveLength(1);
      const resolved = await client.experiences.resolve({
        items: [{ itemId: "item-1", kind: "media" }],
        realizations: [{ realizationId: "real-1", itemId: "item-1", kind: "stream" }],
      });
      expect(resolved.experiences[0]?.experienceId).toBe("exp-item-1-real-1");

      // 3. Decision request → SUGGEST with a schedule delta.
      const decision = await client.decisions.request(decisionInput());
      expect(decision.action).toBe("SUGGEST");
      expect(decision.scheduleDelta?.enqueue).toEqual(["exp-item-1-real-1"]);

      // 4. Outcome append linked to the decision — delivered through the
      //    transport into the store.
      const event = await client.outcomes.append(outcomeInput({ decisionId: decision.decisionId }));
      expect(event.eventType).toBe("completion");
      expect(wiring.transport.status(tenantA, event.idempotencyKey)).toMatchObject({
        state: "delivered",
        attempts: 1,
      });
      const stored = [...store.stream(tenantA)];
      expect(stored).toHaveLength(1);
      expect(stored[0]?.event.decisionId).toBe(decision.decisionId);
      expect(stored[0]?.contentDigest).toMatch(/^[0-9a-f]{64}$/);

      // 5. The durable journal holds the append-only evidence.
      const journal = new JsonlFileJournal(journalPath).readAll();
      expect(journal.map((record) => record.kind)).toEqual(["enqueue", "terminal"]);
      expect(journal[0]).toMatchObject({ kind: "enqueue", eventId: event.eventId });

      // 6. Observability: capability + decision (latency 25 from the
      //    injected clock) + scheduler-action + outcome-linkage records,
      //    digest-verified on read.
      const records = new JsonlFileObservabilitySink(observabilityPath).readAll();
      expect(records.filter((r) => r.kind === "integration-capability")).toHaveLength(13);
      const decisionRecord = records.find((r) => r.kind === "decision");
      expect(decisionRecord).toMatchObject({
        decisionId: decision.decisionId,
        policy: { policyId: "greedy-v1", version: "2" },
        latencyMs: 25,
        latencySource: "injected-clock",
        status: "ok",
      });
      const schedulerRecord = records.find((r) => r.kind === "scheduler-action");
      expect(schedulerRecord).toMatchObject({
        source: "decision",
        action: "SUGGEST",
        decisionId: decision.decisionId,
        enqueuedCount: 1,
      });
      const linkage = records.find((r) => r.kind === "outcome-linkage");
      expect(linkage).toMatchObject({
        eventId: event.eventId,
        decisionId: decision.decisionId,
        linked: true,
      });

      // 7. Preference delta + plan lifecycle still work alongside.
      await client.preferences.appendDelta({
        deltaId: id("delta"),
        tenant: { tenantId: TENANT_A },
        subject: { kind: "user", ref: "user-9" },
        dimension: "genre.scifi",
        op: "add",
        value: 0.25,
        model: { modelId: "m-1", version: "3" },
        timestamp: 5_000,
      });
      await client.plans.create({
        planId: id("plan"),
        tenant: { tenantId: TENANT_A },
        subject: { kind: "user", ref: "user-9" },
        objective: { objectiveId: "obj-1", kind: "relax" },
        attentionPolicy: { policyId: "ap-1", style: "mindful" },
        replanTriggers: ["outcome-observed"],
        createdAt: 0,
        updatedAt: 1,
      });

      await app.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tenant isolation holds end-to-end: tenant B never sees tenant A's data", async () => {
    const store = new InMemoryEventStoreAdapter();
    const wiring = wireOutcomeTransport({ store, clock: new ManualClock(0) });
    const decisionHandler: HandlerPorts["decisionHandler"] = {
      decide: async (request) =>
        DecisionResultSchema.parse({
          decisionId: `dec-${request.tenant.tenantId}-${request.idempotencyKey}`,
          requestId: request.requestId,
          tenant: request.tenant,
          action: "HOLD",
          policy: { policyId: request.policySelector.policyId, version: request.policySelector.version },
          at: 1,
        }),
    };
    const app = buildServer({
      keys: KEYS,
      handlers: {
        decisionHandler,
        outcomeIngest: wiring.handler,
      },
    });

    const alpha = createReckonClient({ baseUrl: "http://reckon-e2e.test", apiKey: KEY_A, fetchImpl: createInjectFetch(app) });
    const beta = createReckonClient({ baseUrl: "http://reckon-e2e.test", apiKey: KEY_B, fetchImpl: createInjectFetch(app) });

    const aDecision = await alpha.decisions.request(decisionInput());
    const bDecision = await beta.decisions.request(
      decisionInput({ tenant: { tenantId: TENANT_B } }),
    );
    expect(aDecision.tenant.tenantId).toBe(TENANT_A);
    expect(bDecision.tenant.tenantId).toBe(TENANT_B);

    // Cross-tenant body → typed tenant mismatch error through the SDK.
    await expect(
      beta.outcomes.append(outcomeInput({ tenant: { tenantId: TENANT_A } })),
    ).rejects.toMatchObject({ code: "TENANT_MISMATCH", statusCode: 403 });

    // Tenant A's outcome never lands in tenant B's stream.
    await alpha.outcomes.append(outcomeInput({ decisionId: aDecision.decisionId }));
    expect([...store.stream({ tenantId: TENANT_B })]).toHaveLength(0);
    expect([...store.stream(tenantA)]).toHaveLength(1);
    const stored: OutcomeEvent = [...store.stream(tenantA)][0]!.event;
    expect(stored.decisionId).toBe(aDecision.decisionId);

    await app.close();
  });
});
