/**
 * AD-002 — Personal Ad Memory store over a REAL PostgreSQL server
 * (embedded-postgres PG 18 binaries, real pg driver wire protocol — the
 * SAME path used against Neon in deployment; evidence class
 * controlled-local) PLUS the in-memory TEST-INFRASTRUCTURE twin: the
 * SAME law-mapped behavioral suite runs against BOTH implementations
 * (production = PostgreSQL per ADR-001; the in-memory adapter is test
 * infrastructure only — behavioral equivalence is asserted, not
 * assumed).
 *
 * LAW MAP (every one of the ten ad-memory privacy laws, ADR-005, gets
 * at least one STORE-level test — run against both implementations):
 *
 * - Law 1  (retention requires an explicit basis):
 *     "law 1 — rejects a basis-less retention at the boundary"
 *     + PG-specific basis_kind audit-column proof.
 * - Law 2  (forget means unretrievable):
 *     "law 2 — forget is terminal and unretrievable on every read path…"
 *     "revoking retain FORGETS the record terminally…"
 *     "a re-encounter AFTER forget writes a NEW record… the forgotten row
 *      stays forgotten forever" + PG tombstone-row proof.
 * - Law 3  (expired ≠ currently available):
 *     "law 3 — expiry is evaluated against the CALLER clock…"
 *     "the full retention union persists verbatim…"
 * - Law 4  (encounter is not a redistribution license):
 *     "law 4 — rights persist verbatim; the store never infers or
 *      mutates rights"
 * - Law 5  (no silent raw location/attention persistence):
 *     "law 5 — raw location/attention/sensor payloads cannot persist…"
 *     + PG raw record_json proof.
 * - Law 6  (no inferred sensitive attributes):
 *     "law 6 — no inferred audience attributes: injected audience fields
 *      are stripped at the boundary and never persist"
 * - Law 7  (user value separate from commercial value; no ranking
 *     authority in the store):
 *     "law 7 — the store is not a ranking authority: remembered-lane
 *      order is deterministic and chronological, never value-based"
 * - Law 8  (advertising stays identifiable):
 *     "law 8 — an ad cannot masquerade as an ordinary item…"
 * - Law 9  (remembered vs provider-supplied provenance):
 *     "law 9 — provenance is stored and returned UNCHANGED for both
 *      lanes"
 * - Law 10 (same evidence classes as the rest of Reckon):
 *     "law 10 — only observed evidence classes are accepted…"
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AdForgetRequestSchema,
  finalizeAdMemoryRecord,
  type AdForgetRequest,
  type AdMemoryRecord,
  type AdPermissionTransition,
  type AdRightsConstraints,
  type SubjectReference,
  type TenantScope,
} from "@reckon/contracts";
import {
  AdMemoryRecordInvalidError,
  AdMemoryTransitionRejectedError,
  InMemoryAdMemoryStore,
  PgAdMemoryStore,
  type AdMemoryStore,
} from "../src/index.js";
import { startTestPostgres, type TestPostgres } from "./pg-harness.js";
import { tenantA, tenantB } from "./fixtures.js";

/* ------------------------------------------------------------------ *
 * Fixtures (contract-valid, modeled on packages/contracts/test/ads.test.ts)
 * ------------------------------------------------------------------ */

const subject = (ref: string): SubjectReference => ({ kind: "user", ref });

const defaultBasis = { kind: "explicit-user-consent" as const, establishedAt: 1_000, basisRef: "consent-42" };

interface MakeRecordOptions {
  readonly tenant?: TenantScope;
  readonly subjectRef?: string;
  readonly itemId?: string;
  readonly advertiserRef?: string;
  readonly outcomeEventId?: string;
  readonly encounteredAt?: number;
  readonly recordedAt?: number;
  readonly expiresAt?: number;
  readonly retentionState?: "active" | "expired" | "forgotten";
  readonly permissionRetain?: "granted" | "revoked";
  readonly permissionPresent?: "granted" | "revoked";
  readonly rights?: AdRightsConstraints;
  readonly adAttributes?: Record<string, unknown>;
  readonly provenance?: "observed-encounter" | "provider-supplied";
  readonly idempotencyKey?: string;
}

let fixtureSeq = 0;
function fixtureId(prefix: string): string {
  fixtureSeq += 1;
  return `${prefix}-${fixtureSeq}`;
}

function makeRecordInput(options: MakeRecordOptions = {}) {
  const state = options.retentionState ?? "active";
  const retention =
    state === "expired"
      ? { state: "expired" as const, basis: defaultBasis, retainedAt: 1_000, expiresAt: 50_000, expiredAt: 60_000 }
      : state === "forgotten"
        ? {
            state: "forgotten" as const,
            basis: defaultBasis,
            retainedAt: 1_000,
            forgottenAt: 900,
            forgetReason: "written pre-forgotten",
          }
        : {
            state: "active" as const,
            basis: defaultBasis,
            retainedAt: 1_000,
            ...(options.expiresAt !== undefined ? { expiresAt: options.expiresAt } : {}),
          };
  return {
    tenant: options.tenant ?? tenantA,
    subject: subject(options.subjectRef ?? "user-9"),
    ad: {
      itemId: options.itemId ?? fixtureId("ad-item"),
      kind: "advertising" as const,
      labels: ["travel"],
      attributes: options.adAttributes ?? { headline: "Stay in Accra" },
    },
    realizations: [],
    lineage: {
      source: "host-ad-server",
      advertiserRef: options.advertiserRef ?? "adv-default",
      campaignRef: "camp-1",
      creativeRefs: ["cr-1"],
    },
    retention,
    permissions: {
      retain: options.permissionRetain ?? "granted",
      present: options.permissionPresent ?? "granted",
      history: [],
    },
    provenance:
      options.provenance === "provider-supplied"
        ? { kind: "provider-supplied" as const, availability: { suppliedBy: "host-ad-exchange" } }
        : {
            kind: "observed-encounter" as const,
            evidence: {
              outcomeEventId: options.outcomeEventId ?? fixtureId("ev"),
              evidenceClass: "production-observed" as const,
              encounteredAt: options.encounteredAt ?? 1_000,
              context: { contextId: "ctx-1" },
              surface: "in-stream",
            },
          },
    rights: options.rights ?? { redistributionPermitted: false, gates: ["host-rights-gate"], usageRestrictions: [] },
    recordedAt: options.recordedAt ?? 2_000,
  };
}

function makeRecord(options: MakeRecordOptions = {}): AdMemoryRecord {
  return finalizeAdMemoryRecord(makeRecordInput(options), options.idempotencyKey);
}

function makeForget(
  target: AdForgetRequest["target"],
  options: { subjectRef?: string; tenant?: TenantScope; at?: number; reason?: string } = {},
): AdForgetRequest {
  return AdForgetRequestSchema.parse({
    requestId: fixtureId("forget-req"),
    tenant: options.tenant ?? tenantA,
    subject: subject(options.subjectRef ?? "user-9"),
    target,
    ...(options.reason !== undefined ? { reason: options.reason } : {}),
    at: options.at ?? 5_000,
    idempotencyKey: fixtureId("forget-idem"),
  });
}

/* ------------------------------------------------------------------ *
 * The law-mapped behavioral suite — runs against BOTH implementations
 * ------------------------------------------------------------------ */

function runAdMemoryStoreLaws(label: string, newStore: () => AdMemoryStore): void {
  describe(`${label} — boundary laws (1, 5, 6, 8, 10)`, () => {
    it("law 1 — rejects a basis-less retention at the boundary (typed AdMemoryRecordInvalidError naming the missing basis)", async () => {
      const store = newStore();
      const record = makeRecord({ subjectRef: "u-law1" });
      const retentionWithoutBasis = { ...(record.retention as object) };
      delete (retentionWithoutBasis as { basis?: unknown }).basis;
      const basisless = { ...record, retention: retentionWithoutBasis } as unknown as AdMemoryRecord;
      await expect(store.put(basisless)).rejects.toBeInstanceOf(AdMemoryRecordInvalidError);
      const caught = await store.put(basisless).catch((e: unknown) => e as Error);
      expect(caught).toBeInstanceOf(AdMemoryRecordInvalidError);
      expect((caught as AdMemoryRecordInvalidError).message).toMatch(/basis/i);
      // nothing persisted
      expect(await store.listRemembered(tenantA, subject("u-law1"), 10_000)).toHaveLength(0);
    });

    it("law 5 — raw location/attention/sensor payloads cannot persist: injected evidence fields are stripped at the boundary", async () => {
      const store = newStore();
      const record = makeRecord({ subjectRef: "u-law5" });
      const evidence =
        record.provenance.kind === "observed-encounter" ? record.provenance.evidence : undefined;
      expect(evidence).toBeDefined();
      const injected = {
        ...record,
        provenance: {
          ...record.provenance,
          evidence: {
            ...evidence!,
            location: { lat: 5.6, lng: -0.19 },
            attention: "focused",
            sensors: { accelerometer: [1, 2, 3] },
          },
        },
      } as unknown as AdMemoryRecord;
      const put = await store.put(injected);
      expect(put.outcome).toBe("inserted");
      const stored = await store.get(tenantA, record.recordId);
      expect(stored).not.toBeNull();
      const storedEvidence =
        stored!.provenance.kind === "observed-encounter" ? stored!.provenance.evidence : undefined;
      expect(storedEvidence).toBeDefined();
      expect(storedEvidence && "location" in storedEvidence).toBe(false);
      expect(storedEvidence && "attention" in storedEvidence).toBe(false);
      expect(storedEvidence && "sensors" in storedEvidence).toBe(false);
      const serialized = JSON.stringify(stored);
      expect(serialized).not.toContain("location");
      expect(serialized).not.toContain("accelerometer");
    });

    it("law 6 — no inferred audience attributes: injected audience fields are stripped at the boundary and never persist", async () => {
      const store = newStore();
      const record = makeRecord({ subjectRef: "u-law6" });
      const injected = {
        ...record,
        audienceAttributes: { inferredInterests: ["travel", "luxury"], sensitive: true },
        inferredSegments: ["luxury-traveler"],
      } as unknown as AdMemoryRecord;
      const put = await store.put(injected);
      expect(put.outcome).toBe("inserted");
      const stored = await store.get(tenantA, record.recordId);
      expect(stored).not.toBeNull();
      expect(stored && "audienceAttributes" in stored).toBe(false);
      expect(JSON.stringify(stored)).not.toContain("inferredSegments");
      // the record shape is EXACTLY the frozen schema's field set — no store-added fields
      expect(Object.keys(stored!).sort()).toEqual(
        [
          "ad",
          "contentDigest",
          "lineage",
          "permissions",
          "provenance",
          "realizations",
          "recordId",
          "recordedAt",
          "retention",
          "rights",
          "schema",
          "schemaVersion",
          "subject",
          "tenant",
        ].sort(),
      );
    });

    it("law 8 — an ad cannot masquerade as an ordinary item: non-advertising kind is a typed boundary rejection", async () => {
      const store = newStore();
      const record = makeRecord({ subjectRef: "u-law8" });
      await store.put(record);
      const notAnAd = { ...record, ad: { ...record.ad, kind: "media" } } as unknown as AdMemoryRecord;
      await expect(store.put(notAnAd)).rejects.toBeInstanceOf(AdMemoryRecordInvalidError);
      const caught = await store.put(notAnAd).catch((e: unknown) => e as Error);
      expect(caught).toBeInstanceOf(AdMemoryRecordInvalidError);
      expect((caught as AdMemoryRecordInvalidError).message).toMatch(/kind|advertising/i);
      // the valid record persists with the advertising literal verbatim
      const stored = await store.get(tenantA, record.recordId);
      expect(stored?.ad.kind).toBe("advertising");
    });

    it("law 10 — only observed evidence classes are accepted: simulated/counterfactual/fixture encounters are typed rejections", async () => {
      const store = newStore();
      const record = makeRecord({ subjectRef: "u-law10" });
      const evidence =
        record.provenance.kind === "observed-encounter" ? record.provenance.evidence : undefined;
      expect(evidence).toBeDefined();
      for (const badClass of ["simulated", "counterfactual", "fixture"] as const) {
        const bad = {
          ...record,
          provenance: {
            ...record.provenance,
            evidence: { ...evidence!, evidenceClass: badClass },
          },
        } as unknown as AdMemoryRecord;
        await expect(store.put(bad)).rejects.toBeInstanceOf(AdMemoryRecordInvalidError);
        const caught = await store.put(bad).catch((e: unknown) => e as Error);
        expect(caught).toBeInstanceOf(AdMemoryRecordInvalidError);
        expect((caught as AdMemoryRecordInvalidError).message).toMatch(/evidenceClass/i);
      }
    });

    it("finalize-before-write is enforced: a forged contentDigest or recordId is a typed rejection", async () => {
      const store = newStore();
      const record = makeRecord({ subjectRef: "u-forge" });
      const forgedDigest = { ...record, contentDigest: "f".repeat(64) } as AdMemoryRecord;
      await expect(store.put(forgedDigest)).rejects.toBeInstanceOf(AdMemoryRecordInvalidError);
      const forgedId = { ...record, recordId: `admem-${"0".repeat(24)}` } as AdMemoryRecord;
      await expect(store.put(forgedId)).rejects.toBeInstanceOf(AdMemoryRecordInvalidError);
    });
  });

  describe(`${label} — retrieval laws (2, 3)`, () => {
    it("law 2 — forget is terminal and unretrievable on every read path; re-writing identical content never resurrects", async () => {
      const store = newStore();
      const subjectRef = "u-law2";
      const record = makeRecord({ subjectRef });
      const put = await store.put(record);
      expect(put.outcome).toBe("inserted");

      const forget = await store.forget(
        makeForget({ kind: "record", recordId: record.recordId }, { subjectRef, reason: "user asked", at: 7_000 }),
      );
      expect(forget.forgottenCount).toBe(1);
      expect(forget.forgottenRecordIds).toEqual([record.recordId]);
      expect(forget.at).toBe(7_000);

      // every read path returns nothing
      expect(await store.get(tenantA, record.recordId)).toBeNull();
      expect(await store.listRemembered(tenantA, subject(subjectRef), 10_000)).toHaveLength(0);

      // re-writing the IDENTICAL content is a duplicate that does NOT resurrect
      const rePut = await store.put(record);
      expect(rePut.outcome).toBe("duplicate");
      expect(rePut.record).toBeNull();
      expect(rePut.forgottenAt).toBe(7_000);
      expect(await store.get(tenantA, record.recordId)).toBeNull();

      // permission transitions on a forgotten record are rejected — no un-forget path
      await expect(
        store.applyPermissionTransition(tenantA, record.recordId, {
          capability: "present",
          from: "granted",
          to: "revoked",
          at: 8_000,
        }),
      ).rejects.toBeInstanceOf(AdMemoryTransitionRejectedError);

      // idempotent re-forget: nothing left to transition
      const again = await store.forget(makeForget({ kind: "record", recordId: record.recordId }, { subjectRef }));
      expect(again.forgottenCount).toBe(0);
    });

    it("law 3 — expiry is evaluated against the CALLER clock: retrievable before expiry, suppressed at/after, no writes between", async () => {
      const store = newStore();
      const subjectRef = "u-law3";
      const record = makeRecord({ subjectRef, expiresAt: 10_000 });
      await store.put(record);
      const subj = subject(subjectRef);
      expect((await store.listRemembered(tenantA, subj, 9_999)).map((r) => r.recordId)).toEqual([record.recordId]);
      // the contract boundary: expiresAt <= at suppresses (isAdMemoryRetrievable)
      expect(await store.listRemembered(tenantA, subj, 10_000)).toHaveLength(0);
      expect(await store.listRemembered(tenantA, subj, 500_000)).toHaveLength(0);
      // rewinding the clock brings it back — the store holds NO hidden clock state
      expect((await store.listRemembered(tenantA, subj, 9_999)).map((r) => r.recordId)).toEqual([record.recordId]);
    });

    it("law 3 — a structurally expired retention never enters the remembered lane at any clock (but stays verbatim for audit)", async () => {
      const store = newStore();
      const subjectRef = "u-law3b";
      const lapsed = makeRecord({ subjectRef, retentionState: "expired", itemId: "ad-lapsed" });
      await store.put(lapsed);
      expect(await store.get(tenantA, lapsed.recordId)).toEqual(lapsed);
      for (const at of [1_000, 10_000, 1_000_000]) {
        expect(await store.listRemembered(tenantA, subject(subjectRef), at)).toHaveLength(0);
      }
    });

    it("a record written already-forgotten is stored but never retrievable (full union verbatim, law 2)", async () => {
      const store = newStore();
      const record = makeRecord({ subjectRef: "u-pre-forgotten", retentionState: "forgotten" });
      const put = await store.put(record);
      expect(put.outcome).toBe("inserted");
      expect(await store.get(tenantA, record.recordId)).toBeNull();
      expect(await store.listRemembered(tenantA, subject("u-pre-forgotten"), 10_000)).toHaveLength(0);
    });
  });

  describe(`${label} — verbatim laws (4, 7, 9)`, () => {
    it("law 4 — rights persist verbatim; the store never infers, upgrades or mutates rights", async () => {
      const store = newStore();
      const subjectRef = "u-law4";
      const record = makeRecord({ subjectRef, itemId: "ad-rights-1" });
      await store.put(record);
      expect((await store.get(tenantA, record.recordId))?.rights).toEqual(record.rights);
      expect((await store.get(tenantA, record.recordId))?.rights.redistributionPermitted).toBe(false);

      // host-DECLARED rights round-trip equally verbatim (no downgrade either)
      const declaredTrue = makeRecord({
        subjectRef,
        itemId: "ad-rights-2",
        rights: { redistributionPermitted: true, gates: [], usageRestrictions: ["email-only"] },
      });
      await store.put(declaredTrue);
      expect((await store.get(tenantA, declaredTrue.recordId))?.rights).toEqual(declaredTrue.rights);

      // no store operation mutates rights
      const after = await store.applyPermissionTransition(tenantA, declaredTrue.recordId, {
        capability: "present",
        from: "granted",
        to: "revoked",
        at: 3_000,
      });
      expect(after.effect).toBe("updated");
      if (after.effect !== "updated") throw new Error("unreachable");
      expect(after.record.rights).toEqual(declaredTrue.rights);
    });

    it("law 7 — the store is not a ranking authority: remembered-lane order is deterministic and chronological, never value-based", async () => {
      const store = newStore();
      const subjectRef = "u-law7";
      // a commercially "valuable" payload rides in the OPAQUE attributes —
      // the store must not branch on it (no ranking state exists).
      const lowValue = makeRecord({
        subjectRef,
        itemId: "ad-value-low",
        recordedAt: 1_000,
        adAttributes: { headline: "A", bid: 0.01, ecpm: 0.1 },
      });
      const highValue = makeRecord({
        subjectRef,
        itemId: "ad-value-high",
        recordedAt: 2_000,
        adAttributes: { headline: "B", bid: 50, ecpm: 9.9 },
      });
      await store.put(lowValue);
      await store.put(highValue);
      const lane = await store.listRemembered(tenantA, subject(subjectRef), 3_000);
      expect(lane.map((r) => r.recordId)).toEqual([lowValue.recordId, highValue.recordId]); // recordedAt ASC — not value
      // stable across repeated queries
      expect((await store.listRemembered(tenantA, subject(subjectRef), 3_000)).map((r) => r.recordId)).toEqual([
        lowValue.recordId,
        highValue.recordId,
      ]);
      // same recordedAt ⇒ deterministic recordId tie-break regardless of put order
      const tieA = makeRecord({ subjectRef: "u-law7tie", itemId: "ad-tie-a", recordedAt: 5_000 });
      const tieB = makeRecord({ subjectRef: "u-law7tie", itemId: "ad-tie-b", recordedAt: 5_000 });
      await store.put(tieB);
      await store.put(tieA);
      const tieLane = await store.listRemembered(tenantA, subject("u-law7tie"), 6_000);
      const ids = tieLane.map((r) => r.recordId);
      expect(ids).toEqual([...ids].sort());
    });

    it("law 9 — provenance is stored and returned UNCHANGED for both lanes (observed encounter vs provider-supplied)", async () => {
      const store = newStore();
      const subjectRef = "u-law9";
      const observed = makeRecord({ subjectRef, itemId: "ad-obs-1", outcomeEventId: "ev-law9", encounteredAt: 1_500 });
      const supplied = makeRecord({ subjectRef, itemId: "ad-sup-1", provenance: "provider-supplied" });
      await store.put(observed);
      await store.put(supplied);
      expect((await store.get(tenantA, observed.recordId))?.provenance).toEqual(observed.provenance);
      expect((await store.get(tenantA, supplied.recordId))?.provenance).toEqual(supplied.provenance);
      // both lanes coexist in the remembered lane, each with its own provenance
      const lane = await store.listRemembered(tenantA, subject(subjectRef), 4_000);
      expect(lane.map((r) => r.recordId).sort()).toEqual([observed.recordId, supplied.recordId].sort());
      // store operations never rewrite provenance
      const transitioned = await store.applyPermissionTransition(tenantA, supplied.recordId, {
        capability: "present",
        from: "granted",
        to: "revoked",
        at: 5_000,
      });
      expect(transitioned.effect).toBe("updated");
      if (transitioned.effect !== "updated") throw new Error("unreachable");
      expect(transitioned.record.provenance).toEqual(supplied.provenance);
    });
  });

  describe(`${label} — upsert policy ((subject, itemId) current-upsert — the documented AD-002 freedom)`, () => {
    it("idempotent writes — identical content re-put is a no-op returning the stored record", async () => {
      const store = newStore();
      const subjectRef = "u-idem";
      const record = makeRecord({ subjectRef, idempotencyKey: "idem-key-1" });
      const first = await store.put(record);
      expect(first.outcome).toBe("inserted");
      expect(first.supersededRecordId).toBeNull();
      const second = await store.put(record);
      expect(second.outcome).toBe("duplicate");
      expect(second.record).toEqual(first.record);
      expect(await store.listRemembered(tenantA, subject(subjectRef), 10_000)).toHaveLength(1);
    });

    it("a re-encounter with NEW evidence supersedes the previous current record — one current per (subject, itemId)", async () => {
      const store = newStore();
      const subjectRef = "u-upsert";
      const itemId = "ad-hotel-1";
      const first = makeRecord({ subjectRef, itemId, outcomeEventId: "ev-enc-1" });
      const second = makeRecord({ subjectRef, itemId, outcomeEventId: "ev-enc-2" });
      expect(second.recordId).not.toBe(first.recordId); // new evidence ⇒ new digest ⇒ new id

      const putFirst = await store.put(first);
      expect(putFirst.supersededRecordId).toBeNull();
      const putSecond = await store.put(second);
      expect(putSecond.outcome).toBe("inserted");
      expect(putSecond.supersededRecordId).toBe(first.recordId);

      // exactly ONE current record in the remembered lane: the newest
      expect((await store.listRemembered(tenantA, subject(subjectRef), 10_000)).map((r) => r.recordId)).toEqual([
        second.recordId,
      ]);
      // the superseded record stays verbatim and readable by id (audit)
      expect(await store.get(tenantA, first.recordId)).toEqual(first);

      // re-putting the OLD content is a duplicate no-op — supersession is NOT re-applied
      const replay = await store.put(first);
      expect(replay.outcome).toBe("duplicate");
      expect((await store.listRemembered(tenantA, subject(subjectRef), 10_000)).map((r) => r.recordId)).toEqual([
        second.recordId,
      ]);

      // a third encounter supersedes the second
      const third = makeRecord({ subjectRef, itemId, outcomeEventId: "ev-enc-3" });
      const putThird = await store.put(third);
      expect(putThird.supersededRecordId).toBe(second.recordId);
    });

    it("a re-encounter AFTER forget writes a NEW record; the forgotten content can never return", async () => {
      const store = newStore();
      const subjectRef = "u-reforget";
      const itemId = "ad-hotel-2";
      const first = makeRecord({ subjectRef, itemId, outcomeEventId: "ev-rf-1" });
      await store.put(first);
      await store.forget(makeForget({ kind: "item", itemId }, { subjectRef, at: 6_000 }));
      expect(await store.get(tenantA, first.recordId)).toBeNull();

      // brand-new encounter after the forget: different evidence ⇒ different id ⇒ a legitimate NEW memory
      const second = makeRecord({ subjectRef, itemId, outcomeEventId: "ev-rf-2", recordedAt: 7_000 });
      expect(second.recordId).not.toBe(first.recordId);
      const put = await store.put(second);
      expect(put.outcome).toBe("inserted");
      expect(put.supersededRecordId).toBeNull(); // forgotten rows are never superseded
      expect((await store.listRemembered(tenantA, subject(subjectRef), 8_000)).map((r) => r.recordId)).toEqual([
        second.recordId,
      ]);

      // the OLD content can NEVER come back (law 2)
      const resurrect = await store.put(first);
      expect(resurrect.outcome).toBe("duplicate");
      expect(resurrect.record).toBeNull();
      expect(resurrect.forgottenAt).toBe(6_000);
    });
  });

  describe(`${label} — forget targets (record / item / advertiser / all)`, () => {
    it("targets scope exactly; other subjects and tenants are untouched; already-forgotten rows are not re-counted", async () => {
      const store = newStore();
      const subjectRef = "u-targets";
      const otherSubject = "u-targets-other";
      const itemX = "ad-tgt-x"; // adv-7 (two records: current + superseded)
      const itemY = "ad-tgt-y"; // adv-7
      const itemZ = "ad-tgt-z"; // adv-8
      const rx1 = makeRecord({ subjectRef, itemId: itemX, advertiserRef: "adv-7", outcomeEventId: "ev-t1" });
      const rx2 = makeRecord({ subjectRef, itemId: itemX, advertiserRef: "adv-7", outcomeEventId: "ev-t2" });
      const ry = makeRecord({ subjectRef, itemId: itemY, advertiserRef: "adv-7", outcomeEventId: "ev-t3" });
      const rz = makeRecord({ subjectRef, itemId: itemZ, advertiserRef: "adv-8", outcomeEventId: "ev-t4" });
      const rOther = makeRecord({ subjectRef: otherSubject, itemId: itemX, advertiserRef: "adv-7", outcomeEventId: "ev-t5" });
      const rTenantB = makeRecord({ tenant: tenantB, subjectRef, itemId: itemX, advertiserRef: "adv-7", outcomeEventId: "ev-t6" });
      for (const record of [rx1, rx2, ry, rz, rOther, rTenantB]) {
        await store.put(record);
      }

      // record target under the WRONG subject scope matches nothing (subject scoping by construction)
      const wrongSubject = await store.forget(makeForget({ kind: "record", recordId: rx1.recordId }, { subjectRef: otherSubject }));
      expect(wrongSubject.forgottenCount).toBe(0);

      // advertiser target: both X records (current + superseded) and Y — not Z, not the other subject, not tenant B
      const byAdvertiser = await store.forget(
        makeForget({ kind: "advertiser", advertiserRef: "adv-7" }, { subjectRef, at: 9_000, reason: "no more adv-7" }),
      );
      expect(byAdvertiser.forgottenCount).toBe(3);
      expect([...byAdvertiser.forgottenRecordIds].sort()).toEqual([rx1.recordId, rx2.recordId, ry.recordId].sort());
      expect(await store.get(tenantA, rz.recordId)).not.toBeNull();
      expect(await store.get(tenantA, rOther.recordId)).not.toBeNull();
      expect(await store.get(tenantB, rTenantB.recordId)).not.toBeNull();

      // item target on Z
      const byItem = await store.forget(makeForget({ kind: "item", itemId: itemZ }, { subjectRef }));
      expect(byItem.forgottenRecordIds).toEqual([rz.recordId]);

      // record target under the RIGHT subject scope
      const byRecord = await store.forget(makeForget({ kind: "record", recordId: rOther.recordId }, { subjectRef: otherSubject }));
      expect(byRecord.forgottenCount).toBe(1);

      // 'all' for the main subject: everything is already forgotten → idempotent zero
      const allAgain = await store.forget(makeForget({ kind: "all" }, { subjectRef }));
      expect(allAgain.forgottenCount).toBe(0);

      // tenant B untouched throughout
      expect(await store.get(tenantB, rTenantB.recordId)).not.toBeNull();
    });
  });

  describe(`${label} — permission state (append-only history, retain/present gates)`, () => {
    it("history is append-only and persisted in full; present-revoke gates retrieval; re-grant restores it", async () => {
      const store = newStore();
      const subjectRef = "u-perm";
      const record = makeRecord({ subjectRef });
      await store.put(record);
      const subj = subject(subjectRef);

      const presentRevoke: AdPermissionTransition = {
        capability: "present",
        from: "granted",
        to: "revoked",
        at: 3_000,
        reason: "user paused this ad",
        consentRef: "consent-77",
      };
      const afterRevoke = await store.applyPermissionTransition(tenantA, record.recordId, presentRevoke);
      expect(afterRevoke.effect).toBe("updated");
      if (afterRevoke.effect !== "updated") throw new Error("unreachable");
      expect(afterRevoke.record.permissions.present).toBe("revoked");
      expect(afterRevoke.record.permissions.retain).toBe("granted");
      expect(afterRevoke.record.permissions.history).toEqual([presentRevoke]); // verbatim, in order
      // present-revoked records are excluded from the remembered lane (present gate)
      expect(await store.listRemembered(tenantA, subj, 4_000)).toHaveLength(0);
      // ...but remain readable by id (memory kept, presentation suppressed)
      expect(await store.get(tenantA, record.recordId)).not.toBeNull();

      // re-grant: append-only history grows; the record returns to the lane
      const presentGrant: AdPermissionTransition = { capability: "present", from: "revoked", to: "granted", at: 5_000 };
      const afterGrant = await store.applyPermissionTransition(tenantA, record.recordId, presentGrant);
      expect(afterGrant.effect).toBe("updated");
      if (afterGrant.effect !== "updated") throw new Error("unreachable");
      expect(afterGrant.record.permissions.history).toEqual([presentRevoke, presentGrant]);
      expect((await store.listRemembered(tenantA, subj, 6_000)).map((r) => r.recordId)).toEqual([record.recordId]);
    });

    it("a record written with retain already revoked is stored verbatim and simply never retrievable", async () => {
      const store = newStore();
      const subjectRef = "u-perm-prerevoked";
      const record = makeRecord({ subjectRef, permissionRetain: "revoked" });
      await store.put(record);
      expect(await store.get(tenantA, record.recordId)).toEqual(record); // memory kept, verbatim
      expect(await store.listRemembered(tenantA, subject(subjectRef), 10_000)).toHaveLength(0); // never a candidate
    });

    it("revoking retain FORGETS the record terminally (contract law, ads.ts §6 / ADR-003) — no un-forget exists", async () => {
      const store = newStore();
      const subjectRef = "u-perm-retain";
      const record = makeRecord({ subjectRef });
      await store.put(record);
      const retainRevoke: AdPermissionTransition = {
        capability: "retain",
        from: "granted",
        to: "revoked",
        at: 8_000,
        reason: "user revoked retention",
      };
      const result = await store.applyPermissionTransition(tenantA, record.recordId, retainRevoke);
      expect(result.effect).toBe("forgotten");
      if (result.effect !== "forgotten") throw new Error("unreachable");
      expect(result.recordId).toBe(record.recordId);
      expect(result.forgottenAt).toBe(8_000);
      expect(await store.get(tenantA, record.recordId)).toBeNull();
      expect(await store.listRemembered(tenantA, subject(subjectRef), 9_000)).toHaveLength(0);
      // NO transition can follow — not even a re-grant of retain (terminal)
      await expect(
        store.applyPermissionTransition(tenantA, record.recordId, { capability: "retain", from: "revoked", to: "granted", at: 10_000 }),
      ).rejects.toBeInstanceOf(AdMemoryTransitionRejectedError);
      // re-writing identical content cannot resurrect
      const rePut = await store.put(record);
      expect(rePut.outcome).toBe("duplicate");
      expect(rePut.forgottenAt).toBe(8_000);
    });

    it("a mismatched `from` state is rejected (history cannot be rewritten); unknown records and cross-tenant scopes too", async () => {
      const store = newStore();
      const subjectRef = "u-perm-mismatch";
      const record = makeRecord({ subjectRef });
      await store.put(record);
      await expect(
        store.applyPermissionTransition(tenantA, record.recordId, { capability: "present", from: "revoked", to: "granted", at: 3_000 }),
      ).rejects.toBeInstanceOf(AdMemoryTransitionRejectedError);
      // history unchanged after the rejection
      const fetched = await store.get(tenantA, record.recordId);
      expect(fetched?.permissions.history).toEqual([]);
      // unknown record id in this tenant scope
      await expect(
        store.applyPermissionTransition(tenantA, "admem-unknown00000000000000", { capability: "present", from: "granted", to: "revoked", at: 3_000 }),
      ).rejects.toBeInstanceOf(AdMemoryTransitionRejectedError);
      // cross-tenant: tenantB cannot touch tenantA's record
      await expect(
        store.applyPermissionTransition(tenantB, record.recordId, { capability: "present", from: "granted", to: "revoked", at: 3_000 }),
      ).rejects.toBeInstanceOf(AdMemoryTransitionRejectedError);
    });
  });

  describe(`${label} — tenant / workspace / subject scoping`, () => {
    it("tenant scoping by construction — cross-tenant get/list/forget miss", async () => {
      const store = newStore();
      const subjectRef = "u-tenant";
      const record = makeRecord({ subjectRef });
      await store.put(record);
      expect(await store.get(tenantB, record.recordId)).toBeNull();
      expect(await store.listRemembered(tenantB, subject(subjectRef), 10_000)).toHaveLength(0);
      const forget = await store.forget(makeForget({ kind: "all" }, { tenant: tenantB, subjectRef }));
      expect(forget.forgottenCount).toBe(0);
      expect(await store.get(tenantA, record.recordId)).not.toBeNull(); // untouched by tenantB's forget
    });

    it("workspace isolation inside a tenant", async () => {
      const store = newStore();
      const subjectRef = "u-ws";
      const wsTenant: TenantScope = { tenantId: "tenant-a", workspaceId: "ws-9" };
      const inWs = makeRecord({ tenant: wsTenant, subjectRef, itemId: "ad-ws-1" });
      await store.put(inWs);
      expect(await store.get(tenantA, inWs.recordId)).toBeNull();
      expect(await store.get(wsTenant, inWs.recordId)).not.toBeNull();
      expect(await store.listRemembered(tenantA, subject(subjectRef), 10_000)).toHaveLength(0);
      expect(await store.listRemembered(wsTenant, subject(subjectRef), 10_000)).toHaveLength(1);
    });

    it("the digest scopes by subject: the same ad under another subject is an independent record", async () => {
      const store = newStore();
      const itemId = "ad-shared-item";
      const forUser1 = makeRecord({ subjectRef: "u-digest-1", itemId, outcomeEventId: "ev-shared" });
      const forUser2 = makeRecord({ subjectRef: "u-digest-2", itemId, outcomeEventId: "ev-shared" });
      expect(forUser2.recordId).not.toBe(forUser1.recordId);
      await store.put(forUser1);
      await store.put(forUser2);
      expect(await store.get(tenantA, forUser1.recordId)).not.toBeNull();
      expect(await store.get(tenantA, forUser2.recordId)).not.toBeNull();
    });
  });

  describe(`${label} — retrieval query shape (the AD-003 lane)`, () => {
    it("listRemembered returns current, active, permission-passing, unexpired records with an optional limit cap", async () => {
      const store = newStore();
      const subjectRef = "u-lane";
      const a = makeRecord({ subjectRef, itemId: "ad-lane-a", recordedAt: 1_000 });
      const b = makeRecord({ subjectRef, itemId: "ad-lane-b", recordedAt: 2_000 });
      const c = makeRecord({ subjectRef, itemId: "ad-lane-c", recordedAt: 3_000 });
      await store.put(a);
      await store.put(b);
      await store.put(c);
      const lane = await store.listRemembered(tenantA, subject(subjectRef), 4_000);
      expect(lane.map((r) => r.recordId)).toEqual([a.recordId, b.recordId, c.recordId]);
      const limited = await store.listRemembered(tenantA, subject(subjectRef), 4_000, { limit: 2 });
      expect(limited.map((r) => r.recordId)).toEqual([a.recordId, b.recordId]);
      // the lane embeds full records (self-describing for AD-003)
      expect(lane[0]).toEqual(a);
    });

    it("the full retention union persists verbatim (active ± expiry, expired, forgotten)", async () => {
      const store = newStore();
      const plain = makeRecord({ subjectRef: "u-retention", itemId: "ad-ret-1" });
      const expiring = makeRecord({ subjectRef: "u-retention", itemId: "ad-ret-2", expiresAt: 20_000 });
      const expired = makeRecord({ subjectRef: "u-retention-b", retentionState: "expired", itemId: "ad-ret-3" });
      const forgottenAtWrite = makeRecord({ subjectRef: "u-retention-c", retentionState: "forgotten", itemId: "ad-ret-4" });
      await store.put(plain);
      await store.put(expiring);
      await store.put(expired);
      await store.put(forgottenAtWrite);
      expect(await store.get(tenantA, plain.recordId)).toEqual(plain);
      expect(await store.get(tenantA, expiring.recordId)).toEqual(expiring);
      expect(await store.get(tenantA, expired.recordId)).toEqual(expired);
      expect(await store.get(tenantA, forgottenAtWrite.recordId)).toBeNull(); // verbatim in storage, never retrieved
    });
  });
}

/* ------------------------------------------------------------------ *
 * Server bootstrap (shared by the PG suites in this file — one per file)
 * ------------------------------------------------------------------ */

let server: TestPostgres;

beforeAll(async () => {
  server = await startTestPostgres();
}, 120_000);

afterAll(async () => {
  await server.stop();
}, 60_000);

describe("AD-002 PgAdMemoryStore (production, real PostgreSQL — controlled-local)", () => {
  runAdMemoryStoreLaws("PgAdMemoryStore", () => new PgAdMemoryStore(server.executor));
});

describe("AD-002 PgAdMemoryStore — PG-specific structural proofs (raw SQL evidence)", () => {
  it("m007 columns mirror the parsed record: audit projections, never a second schema", async () => {
    const store = new PgAdMemoryStore(server.executor);
    const record = makeRecord({ subjectRef: "u-pg-columns", expiresAt: 30_000, advertiserRef: "adv-pg" });
    await store.put(record);
    const rows = await server.executor.query(
      `SELECT item_id, lineage_advertiser_ref, retention_state, basis_kind, expires_at, forgotten_at,
              permission_retain, permission_present, provenance_kind, recorded_at, idempotency_key,
              content_digest, superseded_by_record_id
       FROM ad_memory_records WHERE record_id = $1`,
      [record.recordId],
    );
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.item_id).toBe(record.ad.itemId);
    expect(row.lineage_advertiser_ref).toBe("adv-pg");
    expect(row.retention_state).toBe("active");
    expect(row.basis_kind).toBe("explicit-user-consent"); // law 1 audit column
    expect(Number(row.expires_at)).toBe(30_000);
    expect(row.forgotten_at).toBeNull();
    expect(row.permission_retain).toBe("granted");
    expect(row.permission_present).toBe("granted");
    expect(row.provenance_kind).toBe("observed-encounter");
    expect(Number(row.recorded_at)).toBe(record.recordedAt);
    expect(row.content_digest).toBe(record.contentDigest);
    expect(row.superseded_by_record_id).toBeNull();
  });

  it("an identical re-put writes no second row (COUNT(*) stays 1)", async () => {
    const store = new PgAdMemoryStore(server.executor);
    const record = makeRecord({ subjectRef: "u-pg-count" });
    await store.put(record);
    await store.put(record);
    const rows = await server.executor.query(
      `SELECT COUNT(*)::int AS n FROM ad_memory_records WHERE record_id = $1`,
      [record.recordId],
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it("law 5 physical proof: the persisted record_json contains no location/attention/sensor keys", async () => {
    const store = new PgAdMemoryStore(server.executor);
    const record = makeRecord({ subjectRef: "u-pg-law5" });
    const evidence = record.provenance.kind === "observed-encounter" ? record.provenance.evidence : undefined;
    const injected = {
      ...record,
      provenance: {
        ...record.provenance,
        evidence: { ...evidence!, location: { lat: 5.6 }, attention: "focused", sensors: { accel: 1 } },
      },
    } as unknown as AdMemoryRecord;
    await store.put(injected);
    const rows = await server.executor.query(
      `SELECT record_json::text AS payload FROM ad_memory_records WHERE record_id = $1`,
      [record.recordId],
    );
    const payload = String(rows[0]?.payload);
    expect(payload).not.toContain("location");
    expect(payload).not.toContain("attention");
    expect(payload).not.toContain("sensors");
    expect(payload).not.toContain("accel");
  });

  it("law 2 physical proof: the forgotten row is retained as a tombstone with carried basis + forgottenAt", async () => {
    const store = new PgAdMemoryStore(server.executor);
    const subjectRef = "u-pg-law2";
    const record = makeRecord({ subjectRef, expiresAt: 40_000 });
    await store.put(record);
    await store.forget(makeForget({ kind: "record", recordId: record.recordId }, { subjectRef, at: 12_345, reason: "gone" }));
    const rows = await server.executor.query(
      `SELECT retention_state, forgotten_at, record_json::jsonb -> 'retention' AS retention
       FROM ad_memory_records WHERE record_id = $1`,
      [record.recordId],
    );
    expect(rows.length).toBe(1); // the row is NOT deleted — the tombstone persists
    const row = rows[0]!;
    expect(row.retention_state).toBe("forgotten");
    expect(Number(row.forgotten_at)).toBe(12_345);
    const retention = row.retention as { state?: string; basis?: { kind?: string }; forgottenAt?: number; forgetReason?: string; expiresAt?: number };
    expect(retention.state).toBe("forgotten");
    expect(retention.basis?.kind).toBe("explicit-user-consent"); // carried basis (law 1)
    expect(retention.forgottenAt).toBe(12_345);
    expect(retention.forgetReason).toBe("gone");
    expect(retention.expiresAt).toBe(40_000); // carried for the audit trail
  });

  it("upsert policy physical proof: the previous current row is marked superseded_by_record_id", async () => {
    const store = new PgAdMemoryStore(server.executor);
    const subjectRef = "u-pg-supersede";
    const itemId = "ad-pg-super";
    const first = makeRecord({ subjectRef, itemId, outcomeEventId: "ev-pg-1" });
    const second = makeRecord({ subjectRef, itemId, outcomeEventId: "ev-pg-2" });
    await store.put(first);
    await store.put(second);
    const rows = await server.executor.query(
      `SELECT superseded_by_record_id, superseded_at FROM ad_memory_records WHERE record_id = $1`,
      [first.recordId],
    );
    expect(rows[0]?.superseded_by_record_id).toBe(second.recordId);
    expect(Number(rows[0]?.superseded_at)).toBe(second.recordedAt);
  });

  it("the ad_memory_records_current_item partial unique index structurally forbids a second current row", async () => {
    const store = new PgAdMemoryStore(server.executor);
    const record = makeRecord({ subjectRef: "u-pg-guard" });
    await store.put(record);
    const rows = await server.executor.query(
      `SELECT tenant_id, workspace_id, subject_kind, subject_ref, item_id, basis_kind, recorded_at, record_json, content_digest
       FROM ad_memory_records WHERE record_id = $1`,
      [record.recordId],
    );
    const src = rows[0]!;
    // A raw clone with a different recordId but the SAME (tenant, subject,
    // item) and no supersession — exactly the second-current shape the
    // index exists to make impossible.
    await expect(
      server.executor.query(
        `INSERT INTO ad_memory_records (
           record_id, tenant_id, workspace_id, subject_kind, subject_ref, item_id,
           lineage_advertiser_ref, retention_state, basis_kind, expires_at, forgotten_at,
           permission_retain, permission_present, provenance_kind, recorded_at,
           idempotency_key, record_json, content_digest
         )
         VALUES ($1,$2,$3,$4,$5,$6,NULL,'active',$7,NULL,NULL,'granted','granted','observed-encounter',$8,NULL,$9::jsonb,$10)`,
        [
          "admem-rawclone0000000000000",
          src.tenant_id,
          src.workspace_id,
          src.subject_kind,
          src.subject_ref,
          src.item_id,
          src.basis_kind,
          src.recorded_at,
          src.record_json,
          src.content_digest,
        ],
      ),
    ).rejects.toThrow(/ad_memory_records_current_item/);
  });
});

describe("AD-002 InMemoryAdMemoryStore (TEST INFRASTRUCTURE — behavioral twin)", () => {
  runAdMemoryStoreLaws("InMemoryAdMemoryStore", () => new InMemoryAdMemoryStore());
});
