/**
 * AD-004 — PROVENANCE + MEMORY ROUND-TRIP: ad decision outcomes flow
 * back through the existing outcomes surface and feed Personal Ad
 * Memory through the AD-002 store port (capture → query → consent
 * gates → terminal forget), with provenance retained at every hop.
 *
 * Evidence class: controlled-local (in-process store + capture; the
 * PG-backed composition proof lives in ad-selection-composition.test.ts).
 *
 * Laws proven here:
 * - LAW 1: capture requires an explicit retention basis (policy-declared).
 * - LAW 2: terminal forget (through the AD-002 store) makes the ad
 *   unretrievable on every later query; a re-encounter is a NEW record.
 * - LAW 5: the captured evidence carries context BY REFERENCE only.
 * - LAW 9: capture provenance is observed-encounter with the REAL
 *   outcome event id + evidence class + occurredAt.
 * - LAW 10: simulated/counterfactual/fixture events are typed skips.
 * - Present-gate: a present-revoked memory is retained but never a
 *   presentation candidate; retain-revoke ⇒ terminal forget (AD-002).
 * - Idempotency: the memory write keys on the event's idempotencyKey.
 */
import { describe, expect, it } from "vitest";
import { finalizeAdMemoryRecord, type AdMemoryRecord, type OutcomeEvent } from "@reckon/contracts";
import { experienceIdFor } from "@reckon/experience";
import { InMemoryAdMemoryStore } from "@reckon/persistence";
import { createAdEncounterCapture, createAdEncounterResolver, type AdEncounterContext } from "../src/ad-memory-capture.js";
import { createRuntimeAdRetrievalHandler, type AdAvailabilityChannel } from "../src/ad-retrieval.js";

const TENANT = { tenantId: "tenant-a" };
const SUBJECT = { kind: "user" as const, ref: "user-9" };
const AT = 10_000;

const CAPTURE_BASIS = {
  kind: "explicit-user-consent" as const,
  establishedAt: 1_000,
  basisRef: "consent-rec-42",
  description: "user opted into ad memory",
};

/* ------------------------------------------------------------------ *
 * Fixtures — a channel-supplied ad the decision path selected
 * ------------------------------------------------------------------ */

const adItem = {
  schema: "reckon.catalog-item" as const,
  schemaVersion: "0.1.0",
  itemId: "ad-roundtrip-deal",
  kind: "advertising" as const,
  labels: ["travel"],
  attributes: { headline: "Weekend in Accra" },
};

const adRealizations = [
  {
    schema: "reckon.realization" as const,
    schemaVersion: "0.1.0",
    realizationId: "real-ad-roundtrip",
    itemId: "ad-roundtrip-deal",
    kind: "display",
    constraints: { formats: ["banner"], durationSeconds: 5 },
  },
];

const channel: AdAvailabilityChannel = {
  channelId: "roundtrip-channel",
  listSupply: async () => [
    {
      ad: adItem,
      realizations: adRealizations,
      availability: { suppliedBy: "roundtrip-exchange" },
      rights: { redistributionPermitted: false, gates: ["brand-safety"], usageRestrictions: [] },
      whyRetrieved: [],
    },
  ],
};

function impressionEvent(overrides: Partial<OutcomeEvent> = {}): OutcomeEvent {
  return {
    schema: "reckon.outcome-event",
    schemaVersion: "0.1.0",
    eventId: "ev-impression-1",
    tenant: TENANT,
    subject: SUBJECT,
    eventType: "impression",
    occurredAt: 9_500,
    evidenceClass: "production-observed",
    metrics: {},
    context: { contextId: "ctx-encounter-7" },
    idempotencyKey: "idem-ev-1",
    ...overrides,
  } as OutcomeEvent;
}

/** The ad experience the expander emits for the banner realization (deterministic id). */
function bannerExperienceId(): string {
  // exp-<digest> — computed the SAME way the expander does (the exported
  // id function); the capture's resolution must agree, so drift fails loudly.
  return experienceIdFor("real-ad-roundtrip", { kind: "banner", params: {} });
}

function buildCapture(options: { policy?: { retentionBasis?: typeof CAPTURE_BASIS; permissions?: { retain: "granted" | "revoked"; present: "granted" | "revoked" } }; resolver?: { resolveAd(event: OutcomeEvent): Promise<AdEncounterContext | null> } } = {}) {
  const store = new InMemoryAdMemoryStore();
  const capture = createAdEncounterCapture({
    store,
    policy: {
      retentionBasis: options.policy?.retentionBasis ?? CAPTURE_BASIS,
      ...(options.policy?.permissions !== undefined ? { permissions: options.policy.permissions } : {}),
    },
    resolver:
      options.resolver !== undefined
        ? options.resolver
        : createAdEncounterResolver({ store, channels: [channel] }),
  });
  const retrieval = createRuntimeAdRetrievalHandler({ store, channels: [channel] });
  return { store, capture, retrieval };
}

/* ------------------------------------------------------------------ *
 * The round-trip
 * ------------------------------------------------------------------ */

describe("AD-004 provenance + memory round-trip", () => {
  it("observed impression → capture → remembered candidate (full loop, provenance retained)", async () => {
    const { store, capture, retrieval } = buildCapture();
    const event = impressionEvent({ experienceId: bannerExperienceId() });

    const result = await capture.capture(event);
    expect(result.captured).toBe(true);
    expect(result.put?.outcome).toBe("inserted");
    const record = result.record as AdMemoryRecord;
    // LAW 9: provenance is the observed encounter itself.
    if (record.provenance.kind !== "observed-encounter") {
      throw new Error("expected observed-encounter provenance");
    }
    expect(record.provenance.evidence.outcomeEventId).toBe("ev-impression-1");
    expect(record.provenance.evidence.evidenceClass).toBe("production-observed");
    expect(record.provenance.evidence.encounteredAt).toBe(9_500);
    // LAW 5: context BY REFERENCE only — the event's own reference, verbatim.
    expect(record.provenance.evidence.context).toEqual({ contextId: "ctx-encounter-7" });
    // LAW 1: the explicit basis rode the policy.
    expect(record.retention.basis.kind).toBe("explicit-user-consent");
    // LAW 8 + rights verbatim.
    expect(record.ad.kind).toBe("advertising");
    expect(record.rights.gates).toEqual(["brand-safety"]);

    // The captured ad is now a REMEMBERED candidate (AD-003 lane).
    const query = await retrieval.query(
      {
        schema: "reckon.ad-query-request",
        schemaVersion: "0.1.0",
        queryId: "q-roundtrip-1",
        tenant: TENANT,
        subject: SUBJECT,
        mode: "remembered",
        filters: { terms: [], labels: [], advertiserRefs: [], campaignRefs: [], surfaces: [] },
        at: AT,
      },
      { keyHash: "", tenantId: TENANT.tenantId, scopes: new Set(["ads"]), mode: "live" } as never,
    );
    expect(query.remembered.map((c) => c.record.ad.itemId)).toEqual(["ad-roundtrip-deal"]);
    expect(query.remembered[0]!.record.recordId).toBe(record.recordId);
  });

  it("LAW 10: simulated / counterfactual / fixture evidence classes are typed skips — never memory", async () => {
    const { capture } = buildCapture();
    for (const evidenceClass of ["simulated", "counterfactual", "fixture"] as const) {
      const result = await capture.capture(impressionEvent({ evidenceClass, experienceId: bannerExperienceId() }));
      expect(result.captured).toBe(false);
      expect(result.reason).toContain(evidenceClass);
    }
  });

  it("non-encounter event types are skipped per the capture policy (impression-only default)", async () => {
    const { capture } = buildCapture();
    const result = await capture.capture(impressionEvent({ eventType: "start", experienceId: bannerExperienceId() }));
    expect(result.captured).toBe(false);
    expect(result.reason).toContain("start");
  });

  it("unresolvable experiences are honest skips (no invented ad context)", async () => {
    const { capture } = buildCapture();
    const result = await capture.capture(impressionEvent({ experienceId: "exp-unknown" }));
    expect(result.captured).toBe(false);
    expect(result.reason).toContain("no ad context resolvable");
  });

  it("idempotent replay: the SAME event replays the SAME memory write (event idempotency key)", async () => {
    const { store, capture } = buildCapture();
    const event = impressionEvent({ experienceId: bannerExperienceId() });
    const first = await capture.capture(event);
    const second = await capture.capture(event);
    expect(first.captured).toBe(true);
    expect(second.captured).toBe(true);
    expect(second.put?.outcome).toBe("duplicate");
    expect((await store.listRemembered(TENANT, SUBJECT, AT)).length).toBe(1);
  });

  it("consent gates: present-revoked memory is retained but never a presentation candidate; retain-revoke forgets terminally", async () => {
    const { store, capture, retrieval } = buildCapture();
    const event = impressionEvent({ experienceId: bannerExperienceId() });
    const captured = (await capture.capture(event)).record as AdMemoryRecord;

    // Present gate: revoke `present` — the memory stays, the lane drops it.
    await store.applyPermissionTransition(TENANT, captured.recordId, {
      capability: "present",
      from: "granted",
      to: "revoked",
      at: AT,
      consentRef: "consent-rec-43",
      reason: "user asked not to see this ad again",
    });
    const afterPresentRevoke = await retrieval.query(
      {
        schema: "reckon.ad-query-request",
        schemaVersion: "0.1.0",
        queryId: "q-present-revoke",
        tenant: TENANT,
        subject: SUBJECT,
        mode: "remembered",
        filters: { terms: [], labels: [], advertiserRefs: [], campaignRefs: [], surfaces: [] },
        at: AT,
      },
      { keyHash: "", tenantId: TENANT.tenantId, scopes: new Set(["ads"]), mode: "live" } as never,
    );
    expect(afterPresentRevoke.remembered).toEqual([]);

    // Retain gate: revoke `retain` — AD-002 forgets terminally.
    await store.applyPermissionTransition(TENANT, captured.recordId, {
      capability: "retain",
      from: "granted",
      to: "revoked",
      at: AT + 1,
      consentRef: "consent-rec-44",
    });
    expect(await store.get(TENANT, captured.recordId)).toBeNull();
  });

  it("LAW 2: terminal forget through the store — gone from every later query; a re-encounter is a NEW record", async () => {
    const { store, capture, retrieval } = buildCapture();
    const event = impressionEvent({ experienceId: bannerExperienceId() });
    const captured = (await capture.capture(event)).record as AdMemoryRecord;

    const forget = await store.forget({
      schema: "reckon.ad-forget-request",
      schemaVersion: "0.1.0",
      requestId: "forget-1",
      tenant: TENANT,
      subject: SUBJECT,
      target: { kind: "record", recordId: captured.recordId },
      reason: "user requested removal",
      at: AT + 2,
      idempotencyKey: "forget-idem-1",
    });
    expect(forget.forgottenCount).toBe(1);

    const query = async () =>
      retrieval.query(
        {
          schema: "reckon.ad-query-request",
          schemaVersion: "0.1.0",
          queryId: "q-after-forget",
          tenant: TENANT,
          subject: SUBJECT,
          mode: "remembered",
          filters: { terms: [], labels: [], advertiserRefs: [], campaignRefs: [], surfaces: [] },
          at: AT,
        },
        { keyHash: "", tenantId: TENANT.tenantId, scopes: new Set(["ads"]), mode: "live" } as never,
      );
    expect((await query()).remembered).toEqual([]);

    // A NEW encounter (new evidence ⇒ new digest) is a legitimate new
    // memory — the forgotten row is untouched and stays unretrievable.
    const reEncounter = await capture.capture(
      impressionEvent({ eventId: "ev-impression-2", idempotencyKey: "idem-ev-2", occurredAt: 12_000, experienceId: bannerExperienceId() }),
    );
    expect(reEncounter.captured).toBe(true);
    expect((reEncounter.record as AdMemoryRecord).recordId).not.toBe(captured.recordId);
    expect((await query()).remembered.map((c) => c.record.ad.itemId)).toEqual(["ad-roundtrip-deal"]);
  });

  it("capture policy permissions start revoked when the deployment declares so (law at the boundary)", async () => {
    const { capture, retrieval } = buildCapture({ policy: { permissions: { retain: "granted", present: "revoked" } } });
    const event = impressionEvent({ experienceId: bannerExperienceId() });
    const result = await capture.capture(event);
    expect(result.captured).toBe(true);
    expect((result.record as AdMemoryRecord).permissions.present).toBe("revoked");
    const query = await retrieval.query(
      {
        schema: "reckon.ad-query-request",
        schemaVersion: "0.1.0",
        queryId: "q-revoked-present",
        tenant: TENANT,
        subject: SUBJECT,
        mode: "remembered",
        filters: { terms: [], labels: [], advertiserRefs: [], campaignRefs: [], surfaces: [] },
        at: AT,
      },
      { keyHash: "", tenantId: TENANT.tenantId, scopes: new Set(["ads"]), mode: "live" } as never,
    );
    // The present-revoked record never becomes a presentation candidate.
    expect(query.remembered).toEqual([]);
  });
});
