import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryEventStoreAdapter, JsonlFileJournal, ManualClock } from "@reckon/events";
import type { EventStore, TransportFailure } from "@reckon/events";
import type { OutcomeEvent, TenantScope } from "@reckon/contracts";
import { buildServer } from "../src/server.js";
import { wireOutcomeTransport } from "../src/outcome-transport.js";
import type { PartialHandlerPorts } from "../src/ports.js";

/**
 * W3-003 apps/api wiring: the frozen /v1/outcomes route contract stays
 * byte-identical; only the internal plumbing (outcome ingest handler)
 * changes to route through the OutcomeTransport port. Evidence class:
 * controlled-local.
 */

const TENANT = "tenant-a";
const tenant: TenantScope = { tenantId: TENANT };
const KEY = "transport-key-alpha";
const OUTCOMES_KEY = { apiKey: KEY, tenantId: TENANT, scopes: ["outcomes"] as const };

let eventCounter = 0;
function outcomeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  eventCounter += 1;
  return {
    eventId: `ev-${eventCounter}`,
    tenant: { tenantId: TENANT },
    subject: { kind: "user", ref: "user-9" },
    eventType: "completion",
    occurredAt: 2_000,
    metrics: { watchRatio: 0.9 },
    evidenceClass: "production-observed",
    idempotencyKey: `idem-${eventCounter}`,
    ...overrides,
  };
}

function postOutcome(app: ReturnType<typeof buildServer>, payload: unknown, headers: Record<string, string> = {}) {
  return app.inject({
    method: "POST",
    url: "/v1/outcomes",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", ...headers },
    payload: payload as Record<string, unknown>,
  });
}

/** An EventStore facade delegating queries to `store` with an append hook. */
function delegatingStore(
  store: InMemoryEventStoreAdapter,
  append: (event: OutcomeEvent) => ReturnType<InMemoryEventStoreAdapter["append"]>,
): EventStore {
  return {
    append,
    getByDecision: (t, id) => store.getByDecision(t, id),
    getBySubject: (t, s, r) => store.getBySubject(t, s, r),
    getByExperience: (t, id) => store.getByExperience(t, id),
    stream: (t, r) => store.stream(t, r),
    observed: (t, r) => store.observed(t, r),
    research: (t, r) => store.research(t, r),
  };
}

describe("W3-003 apps/api — outcome appends routed through the transport port", () => {
  it("delivers through the transport and echoes the stored event (route contract unchanged)", async () => {
    const store = new InMemoryEventStoreAdapter();
    const wiring = wireOutcomeTransport({ store, clock: new ManualClock(1_000) });
    const app = buildServer({ keys: [OUTCOMES_KEY], handlers: { outcomeIngest: wiring.handler } });

    const body = outcomeBody({ decisionId: "dec-1" });
    const response = await postOutcome(app, body);
    expect(response.statusCode).toBe(200);
    expect(response.headers["idempotency-key"]).toBe(body.idempotencyKey);
    const echoed = response.json();
    expect(echoed).toMatchObject({ eventId: body.eventId, eventType: "completion" });
    expect(echoed.schema).toBe("reckon.outcome-event");

    // Delivered into the store through the transport (receipt observable).
    expect([...store.stream(tenant)]).toHaveLength(1);
    expect(wiring.transport.status(tenant, body.idempotencyKey as string)).toMatchObject({ state: "delivered" });
    await app.close();
  });

  it("duplicate idempotencyKey collapses to the ORIGINAL event across a process restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "reckon-api-transport-"));
    try {
      const journalPath = join(dir, "outcomes.jsonl");
      const store = new InMemoryEventStoreAdapter();

      // "Process 1": a server with its own idempotency map.
      const wiring1 = wireOutcomeTransport({ store, clock: new ManualClock(0), journal: new JsonlFileJournal(journalPath) });
      const app1 = buildServer({ keys: [OUTCOMES_KEY], handlers: { outcomeIngest: wiring1.handler } });
      const original = outcomeBody({ eventId: "ev-original-1", idempotencyKey: "restart-key" });
      const first = await postOutcome(app1, original);
      expect(first.statusCode).toBe(200);
      await app1.close();

      // "Process 2": fresh server (fresh HTTP idempotency map), same
      // store + journal. Re-posting the SAME idempotencyKey with a
      // DIFFERENT eventId must collapse to the original.
      const wiring2 = wireOutcomeTransport({ store, clock: new ManualClock(0), journal: new JsonlFileJournal(journalPath) });
      const app2 = buildServer({ keys: [OUTCOMES_KEY], handlers: { outcomeIngest: wiring2.handler } });
      const replay = outcomeBody({ eventId: "ev-different-2", idempotencyKey: "restart-key" });
      const second = await postOutcome(app2, replay);
      expect(second.statusCode).toBe(200);
      const body = second.json();
      // The duplicate collapsed to the ORIGINAL event.
      expect(body.eventId).toBe("ev-original-1");
      // Still exactly one record in the store.
      expect([...store.stream(tenant)]).toHaveLength(1);
      await app2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("buffered deliveries still answer 200; terminal failures surface, never silently drop", async () => {
    const store = new InMemoryEventStoreAdapter();
    const clock = new ManualClock(0);
    const failures: TransportFailure[] = [];
    // The sink is down: every append throws (transient at the transport).
    const downStore: EventStore = delegatingStore(store, () => {
      throw new Error("store unavailable");
    });
    const wiring = wireOutcomeTransport({
      store: downStore,
      clock,
      maxAttempts: 1,
      onTerminalFailure: (failure) => failures.push(failure),
    });
    const app = buildServer({ keys: [OUTCOMES_KEY], handlers: { outcomeIngest: wiring.handler } });

    const body = outcomeBody();
    const response = await postOutcome(app, body);
    // A delivery that exhausts its attempts within the publish window
    // surfaces as a typed failed receipt — the route still answers 200
    // with the accepted event (async at-least-once semantics) while the
    // failure is retained + surfaced by the transport.
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ eventId: body.eventId });

    expect(wiring.transport.failures()).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ eventId: body.eventId, idempotencyKey: body.idempotencyKey });
    expect(wiring.transport.pending()).toHaveLength(0);
    await app.close();
  });

  it("retry-then-success through the route: backoff + clock + pump deliver the buffered event", async () => {
    const store = new InMemoryEventStoreAdapter();
    const clock = new ManualClock(0);
    let down = true;
    const switchableStore: EventStore = delegatingStore(store, (event) => {
      if (down) throw new Error("temporarily down");
      return store.append(event);
    });
    const wiring = wireOutcomeTransport({ store: switchableStore, clock });
    const app = buildServer({ keys: [OUTCOMES_KEY], handlers: { outcomeIngest: wiring.handler } });

    const body = outcomeBody();
    const response = await postOutcome(app, body);
    expect(response.statusCode).toBe(200); // buffered: accepted
    expect(wiring.transport.pending()).toHaveLength(1);

    // The sink recovers; advance past the backoff and pump.
    down = false;
    clock.advance(100);
    expect(await wiring.transport.pump()).toBe(0);
    expect([...store.stream(tenant)]).toHaveLength(1);
    expect(wiring.transport.status(tenant, body.idempotencyKey as string)).toMatchObject({ state: "delivered" });
    await app.close();
  });

  it("the unwired port still answers 501 NOT_WIRED (route contract untouched)", async () => {
    const app = buildServer({ keys: [OUTCOMES_KEY] });
    const response = await postOutcome(app, outcomeBody());
    expect(response.statusCode).toBe(501);
    expect(response.json()).toMatchObject({ error: { code: "NOT_WIRED" } });
    await app.close();
  });

  it("HTTP idempotent replay still applies on top of the transport (W3-001 contract)", async () => {
    const store = new InMemoryEventStoreAdapter();
    const wiring = wireOutcomeTransport({ store, clock: new ManualClock(0) });
    const app = buildServer({ keys: [OUTCOMES_KEY], handlers: { outcomeIngest: wiring.handler } });

    const body = outcomeBody();
    const first = await postOutcome(app, body);
    const second = await postOutcome(app, body);
    expect(second.statusCode).toBe(200);
    expect(second.headers["idempotent-replay"]).toBe("true");
    expect(second.json()).toEqual(first.json());
    expect([...store.stream(tenant)]).toHaveLength(1);
    await app.close();
  });
});
