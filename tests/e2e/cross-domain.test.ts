/**
 * W3-009 — cross-domain end-to-end conformance (tests/e2e).
 *
 * THREE proofs over the REAL repository runtimes (SDK → apps/api route
 * pipeline → W2 kernels → W3-003 transport → W3-004 observability), with
 * the four reference adapters as the fronts and NO LLM anywhere:
 *
 * 1. FOUR-DOMAIN VERTICAL E2E — for EACH of WebFlix (media), generic
 *    media, commerce and advertising, the full chain runs through the
 *    real runtimes: adapter-mapped context → candidates → experience
 *    expansion → decision → schedule → observed outcome → preference
 *    delta, with the observability records as the evidence trail
 *    (decision latency measured from the injected clock around the real
 *    kernel work, scheduler action recorded, outcome linked, preference
 *    deltas in the adapter's OWN vocabulary).
 *
 * 2. CROSS-DOMAIN INTERLEAVING — ONE deployment (one app, one
 *    domain-neutral decision handler, one scheduler runtime, ONE shared
 *    plan state) serves all four domains. Eight decisions interleave:
 *    webflix QUEUE → commerce SUGGEST → commerce INTERRUPT (of a
 *    WEBFLIX experience) → generic-media HOLD → advertising SWITCH
 *    (media → advertising creative, resume checkpoint on the media
 *    experience) → advertising INTERRUPT (with token) → webflix RESUME
 *    (of the ADVERTISING experience) → generic-media END. Every action's
 *    observability trail is asserted and every outcome is linkage-
 *    verified (including an honestly UNLINKED observation and the
 *    honest absence of outcomes for non-binding SUGGEST/HOLD).
 *
 * 3. DOMAIN-NEUTRALITY (static) — the core kernel sources (scheduler,
 *    decision, experience) contain no domain vocabulary: the runtimes
 *    have no domain branch to take.
 *
 * Evidence class: controlled-local (fixture/in-process — proves the
 * composed repository software, NOT a live provider integration).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DecisionResult, Experience } from "../../packages/contracts/src/index.js";
import type { ObservabilityRecord } from "../../packages/observability/src/index.js";
import {
  buildConformanceTable,
  CONFORMANCE_SUGGEST_NUMBERS,
  CONFORMANCE_SWITCH_NUMBERS,
  T0,
} from "../../packages/integrations/test/conformance-table.js";
import type { ConformanceBinding } from "../../packages/integrations/test/conformance-table.js";
import {
  adapterFrontedDecisionRequest,
  createCrossDomainApp,
  expectDecisionTrail,
  expectOutcomeLinked,
  mustOk,
  outcomeLinkageRecords,
  type CrossDomainApp,
} from "./cross-domain-harness.js";

const TABLE = buildConformanceTable();

// ---------------------------------------------------------------------------
// Shared E2E constants (deterministic, caller-supplied timestamps only)
// ---------------------------------------------------------------------------

const E2E_SUBJECT = { kind: "user" as const, ref: "e2e-cross-1" };

/** Decision times: one per decision in either scenario. */
const ET1 = T0 + 3_600_000;
const ET2 = T0 + 3_660_000;
const ET3 = T0 + 3_700_000;
const ET4 = T0 + 3_760_000;
const ET5 = T0 + 3_800_000;
const ET6 = T0 + 3_860_000;
const ET7 = T0 + 3_900_000;
const ET8 = T0 + 3_960_000;
const ET9 = T0 + 4_000_000;

let unique = 0;
function e2eId(prefix: string): string {
  unique += 1;
  return `${prefix}-${unique}`;
}

/** The tenant of a binding in this suite (one tenant per domain). */
function tenantOf(binding: ConformanceBinding): { tenantId: string } {
  return { tenantId: `e2e-${binding.label}` };
}

// ---------------------------------------------------------------------------
// Proof 1 — the four-domain vertical E2E (one `it` per reference adapter)
// ---------------------------------------------------------------------------

describe("W3-009 cross-domain E2E — four-domain vertical through the real runtimes", () => {
  for (const binding of TABLE) {
    it(`${binding.label}: context → candidates → experience → decision → schedule → outcome → preference delta, with the full observability trail`, async () => {
      const tenant = tenantOf(binding);
      const app: CrossDomainApp = createCrossDomainApp({
        fronts: new Map([[tenant.tenantId, { binding }]]),
        keys: [{ apiKey: `key-${binding.label}`, tenantId: tenant.tenantId }],
      });
      try {
        const client = app.client(tenant.tenantId);

        // Stage 1 — catalog: the adapter's mapped items + realizations
        // upsert through the real route pipeline.
        for (const item of binding.items) {
          const upserted = await client.catalog.upsertItem(item);
          expect(upserted.schema).toBe("reckon.catalog-item");
        }
        for (const realization of binding.realizations) {
          const upserted = await client.catalog.upsertRealization(realization);
          expect(upserted.schema).toBe("reckon.realization");
        }

        // Stage 2 — candidates: the adapter's mapped candidate set
        // (including the ghost row) submitted through the real route.
        const submitted = await client.candidates.submit(binding.candidateSet);
        expect(submitted.candidates).toHaveLength(binding.candidateSet.candidates.length);

        // Stage 3 — experience expansion through the REAL W2-001 + W2-003
        // kernels behind the resolve route (adapter-fronted data).
        const resolved = await client.experiences.resolve({
          items: binding.items,
          realizations: binding.realizations,
        });
        expect(resolved.experiences).toHaveLength(binding.expectedExperienceCount);
        const alphaExperiences = resolved.experiences.filter((e) => e.itemId === binding.alphaItemId);
        const betaExperiences = resolved.experiences.filter((e) => e.itemId === binding.betaItemId);
        expect(alphaExperiences.length).toBeGreaterThan(0);
        expect(betaExperiences.length).toBeGreaterThan(0);

        // Stage 4 — decision 1 (idle, balanced): QUEUE the best candidate.
        const request1 = adapterFrontedDecisionRequest({
          tenant,
          subject: E2E_SUBJECT,
          binding,
          at: ET1,
          requestId: e2eId("req"),
          idempotencyKey: e2eId("idem"),
        });
        const decision1: DecisionResult = await client.decisions.request(request1);
        expect(decision1.action).toBe("QUEUE");
        expect(decision1.selectedExperience?.itemId).toBe(binding.alphaItemId);
        expect(decision1.scheduleDelta?.enqueue).toHaveLength(1);
        expect(decision1.scheduleDelta?.enqueue[0]).toBe(decision1.selectedExperience?.experienceId);
        const alphaExperience = decision1.selectedExperience as Experience;
        const queuedId = alphaExperience.experienceId;

        // Honest absence: the ghost retrieval row excluded by the kernel.
        const run1 = app.driver.runs[0];
        expect(
          run1?.expansion.exclusions.some(
            (exclusion) => exclusion.kind === "candidate-unavailable" && exclusion.itemId === binding.ghostItemId,
          ),
        ).toBe(true);

        // Stage 5 — the host-authoritative start (play/tune/present/show).
        app.driver.applyHostIntents(mustOk(binding.hostStart(queuedId, app.driver.planState)));
        expect(app.driver.planState.status).toBe("playing");
        expect(app.driver.planState.currentExperienceId).toBe(queuedId);

        // Stage 6 — decision 2 (playing + shared switch numbers + resume
        // token): SWITCH to beta with a resume checkpoint.
        const betaExperience = betaExperiences[0] as Experience;
        app.driver.applyHostIntents(
          mustOk(binding.hostSwitch(queuedId, betaExperience.experienceId, app.driver.planState)),
        );
        app.driver.supplyResumeTokens({ [queuedId]: binding.resumeToken });
        const request2 = adapterFrontedDecisionRequest({
          tenant,
          subject: E2E_SUBJECT,
          binding,
          at: ET2,
          requestId: e2eId("req"),
          idempotencyKey: e2eId("idem"),
          currentExperience: alphaExperience,
        });
        const decision2: DecisionResult = await client.decisions.request(request2);
        expect(decision2.action).toBe("SWITCH");
        expect(decision2.selectedExperience?.itemId).toBe(binding.betaItemId);
        expect(decision2.scheduleDelta?.resumeCheckpoint).toMatchObject({
          experienceId: queuedId,
          resumeToken: binding.resumeToken,
        });
        expect(app.driver.planState.status).toBe("playing");
        expect(app.driver.planState.currentExperienceId).toBe(betaExperience.experienceId);

        // Stage 7 — the observed completion outcome linked to decision 2,
        // delivered through the real transport into the real store.
        const outcome = mustOk(
          binding.toOutcomeEvent({
            itemId: binding.betaItemId,
            experienceId: decision2.selectedExperience?.experienceId,
            decisionId: decision2.decisionId,
            reportId: `e2e-obs-${binding.label}`,
            tenant,
            subject: E2E_SUBJECT,
            at: ET3,
          }),
        );
        const stored = await client.outcomes.append(outcome);
        expect(stored.eventType).toBe("completion");
        expect(stored.evidenceClass).toBe("controlled-local");
        expect(app.transport.status(tenant, outcome.idempotencyKey)).toMatchObject({
          state: "delivered",
          attempts: 1,
        });
        const stream = [...app.store.stream(tenant)];
        expect(stream).toHaveLength(1);
        expect(stream[0]?.event.decisionId).toBe(decision2.decisionId);
        expect(stream[0]?.contentDigest).toMatch(/^[0-9a-f]{64}$/);
        const journal = app.readJournal();
        expect(journal.map((record) => record.kind)).toEqual(["enqueue", "terminal"]);

        // Stage 8 — preference deltas close the loop in the adapter's OWN
        // vocabulary, appended through the real preferences route.
        const betaItem = binding.items.find((item) => item.itemId === binding.betaItemId);
        if (betaItem === undefined) throw new Error(`cross-domain E2E: beta item missing for ${binding.label}`);
        const deltas = mustOk(binding.toPreferenceDeltas(outcome, betaItem));
        expect(deltas.length).toBeGreaterThan(0);
        for (const delta of deltas) {
          await client.preferences.appendDelta(delta);
        }
        expect(app.preferenceDeltas).toHaveLength(deltas.length);
        for (const delta of app.preferenceDeltas) {
          expect(delta.dimension).toMatch(
            new RegExp(`^${binding.deltaDimensionPrefix.replace(/\./g, "\\.")}:`),
          );
        }

        // Stage 9 — THE EVIDENCE TRAIL: decision latency recorded (measured
        // from the injected clock around the real kernel work), scheduler
        // actions recorded (QUEUE + SWITCH), outcome linked — all
        // digest-verified on read by the JSONL sink.
        const records = app.readObservability();
        expectDecisionTrail(records, {
          requestId: request1.requestId,
          decisionId: decision1.decisionId,
          action: "QUEUE",
          scheduleDelta: decision1.scheduleDelta,
        });
        expectDecisionTrail(records, {
          requestId: request2.requestId,
          decisionId: decision2.decisionId,
          action: "SWITCH",
          scheduleDelta: decision2.scheduleDelta,
        });
        expectOutcomeLinked(records, outcome);
        expect(
          records.filter((record) => record.kind === "integration-capability" && record.available).length,
        ).toBe(7);
        expect(records.filter((record) => record.kind === "integration-capability")).toHaveLength(11);
        expect(records.filter((record) => record.kind === "error")).toHaveLength(0);
      } finally {
        await app.destroy();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Proof 2 — cross-domain interleaving through ONE runtime + ONE plan state
// ---------------------------------------------------------------------------

describe("W3-009 cross-domain E2E — interleaved domains through one decision/scheduler runtime", () => {
  it("interleaves all four domains over one shared plan state exercising QUEUE, SUGGEST, INTERRUPT, HOLD, SWITCH, RESUME and END with per-action outcome linkage", async () => {
    const [webflix, media, commerce, advertising] = TABLE;
    if (webflix === undefined || media === undefined || commerce === undefined || advertising === undefined) {
      throw new Error("cross-domain E2E: conformance table must have four bindings");
    }
    const tenants = {
      webflix: { tenantId: "e2e-webflix" },
      media: { tenantId: "e2e-generic-media" },
      commerce: { tenantId: "e2e-commerce" },
      advertising: { tenantId: "e2e-advertising" },
    };
    const app: CrossDomainApp = createCrossDomainApp({
      fronts: new Map([
        [tenants.webflix.tenantId, { binding: webflix }],
        [tenants.media.tenantId, { binding: media }],
        [tenants.commerce.tenantId, { binding: commerce }],
        [tenants.advertising.tenantId, { binding: advertising }],
      ]),
      keys: [
        { apiKey: "key-xd-webflix", tenantId: tenants.webflix.tenantId },
        { apiKey: "key-xd-media", tenantId: tenants.media.tenantId },
        { apiKey: "key-xd-commerce", tenantId: tenants.commerce.tenantId },
        { apiKey: "key-xd-advertising", tenantId: tenants.advertising.tenantId },
      ],
    });
    try {
      const webflixClient = app.client(tenants.webflix.tenantId);
      const mediaClient = app.client(tenants.media.tenantId);
      const commerceClient = app.client(tenants.commerce.tenantId);
      const advertisingClient = app.client(tenants.advertising.tenantId);

      // Discover the interleave targets through the real resolve route.
      const commerceResolved = await commerceClient.experiences.resolve({
        items: commerce.items,
        realizations: commerce.realizations,
      });
      const advertisingResolved = await advertisingClient.experiences.resolve({
        items: advertising.items,
        realizations: advertising.realizations,
      });
      const commerceBetaExperience = commerceResolved.experiences.find(
        (e) => e.itemId === commerce.betaItemId,
      ) as Experience;
      const adBetaExperience = advertisingResolved.experiences.find(
        (e) => e.itemId === advertising.betaItemId,
      ) as Experience;

      // --- D1 [webflix] idle + balanced ⇒ QUEUE the media alpha experience.
      const d1 = await webflixClient.decisions.request(
        adapterFrontedDecisionRequest({
          tenant: tenants.webflix,
          subject: E2E_SUBJECT,
          binding: webflix,
          at: ET1,
          requestId: e2eId("req"),
          idempotencyKey: e2eId("idem"),
        }),
      );
      expect(d1.action).toBe("QUEUE");
      expect(d1.selectedExperience?.itemId).toBe(webflix.alphaItemId);
      const alphaExperience = d1.selectedExperience as Experience;
      const alphaExpId = alphaExperience.experienceId;
      expect(app.driver.planState.status).toBe("queued");

      // Outcome linkage for the QUEUE action: the host starts the queued
      // media experience and observes the start, linked to decision 1.
      app.driver.applyHostIntents(mustOk(webflix.hostStart(alphaExpId, app.driver.planState)));
      expect(app.driver.planState.status).toBe("playing");
      const o1 = mustOk(
        webflix.toOutcomeEvent({
          itemId: webflix.alphaItemId,
          experienceId: alphaExpId,
          decisionId: d1.decisionId,
          reportId: "e2e-pb-started",
          event: "started",
          tenant: tenants.webflix,
          subject: E2E_SUBJECT,
          at: ET3,
        }),
      );
      await webflixClient.outcomes.append(o1);

      // --- D2 [commerce] playing(media) + suggest-band numbers ⇒ SUGGEST a
      //     commerce experience (non-binding: never interrupts the media).
      app.driver.applyHostIntents(
        mustOk(commerce.hostSuggest(alphaExpId, commerceBetaExperience.experienceId, app.driver.planState)),
      );
      const d2 = await commerceClient.decisions.request(
        adapterFrontedDecisionRequest({
          tenant: tenants.commerce,
          subject: E2E_SUBJECT,
          binding: commerce,
          at: ET4,
          requestId: e2eId("req"),
          idempotencyKey: e2eId("idem"),
          currentExperience: alphaExperience,
        }),
      );
      expect(d2.action).toBe("SUGGEST");
      expect(d2.selectedExperience?.experienceId).toBe(commerceBetaExperience.experienceId);
      expect(app.driver.planState.status).toBe("playing"); // unchanged
      expect(app.driver.planState.currentExperienceId).toBe(alphaExpId);

      // --- D3 [commerce host suspends] playing(media) ⇒ INTERRUPT the
      //     WEBFLIX experience via the commerce host action (no token —
      //     honest no-checkpoint interruption).
      app.driver.applyHostIntents(
        mustOk(commerce.hostInterrupt(alphaExpId, app.driver.planState)),
      );
      const d3 = await commerceClient.decisions.request(
        adapterFrontedDecisionRequest({
          tenant: tenants.commerce,
          subject: E2E_SUBJECT,
          binding: commerce,
          at: ET5,
          requestId: e2eId("req"),
          idempotencyKey: e2eId("idem"),
          currentExperience: alphaExperience,
        }),
      );
      expect(d3.action).toBe("INTERRUPT");
      expect(d3.selectedExperience?.experienceId).toBe(alphaExpId);
      expect(app.driver.planState.status).toBe("interrupted");
      expect(app.driver.planState.interruptedExperienceId).toBe(alphaExpId);
      expect(app.driver.planState.resumeCheckpoints).toHaveLength(0); // no token supplied

      // --- D4 [generic-media] interrupted(media), no checkpoints, no
      //     switch input ⇒ HOLD (the runtime holds across domains).
      const d4 = await mediaClient.decisions.request(
        adapterFrontedDecisionRequest({
          tenant: tenants.media,
          subject: E2E_SUBJECT,
          binding: media,
          at: ET6,
          requestId: e2eId("req"),
          idempotencyKey: e2eId("idem"),
          currentExperience: alphaExperience,
        }),
      );
      expect(d4.action).toBe("HOLD");
      expect(app.driver.planState.status).toBe("interrupted"); // unchanged

      // Outcome linkage for the HOLD action: the media host observes a
      // hop that NO decision caused — honestly UNLINKED (linked: false).
      const o2 = mustOk(
        media.toOutcomeEvent({
          itemId: media.betaItemId,
          reportId: "e2e-pl-hopped",
          event: "hopped",
          tenant: tenants.media,
          subject: E2E_SUBJECT,
          at: ET6,
        }),
      );
      expect(o2.decisionId).toBeUndefined();
      await mediaClient.outcomes.append(o2);

      // --- D5 [advertising] interrupted(media) + switch numbers net 0.65 ⇒
      //     SWITCH from the WEBFLIX experience to an ADVERTISING creative,
      //     checkpointing the media experience (caller-supplied token).
      app.driver.applyHostIntents(
        mustOk(advertising.hostSwitch(alphaExpId, adBetaExperience.experienceId, app.driver.planState)),
      );
      app.driver.supplyResumeTokens({ [alphaExpId]: advertising.resumeToken });
      const d5 = await advertisingClient.decisions.request(
        adapterFrontedDecisionRequest({
          tenant: tenants.advertising,
          subject: E2E_SUBJECT,
          binding: advertising,
          at: ET7,
          requestId: e2eId("req"),
          idempotencyKey: e2eId("idem"),
          currentExperience: alphaExperience,
        }),
      );
      expect(d5.action).toBe("SWITCH");
      expect(d5.selectedExperience?.experienceId).toBe(adBetaExperience.experienceId);
      expect(d5.scheduleDelta?.resumeCheckpoint).toMatchObject({
        experienceId: alphaExpId, // the WEBFLIX experience, checkpointed by a cross-domain switch
        resumeToken: advertising.resumeToken,
      });
      expect(app.driver.planState.status).toBe("playing");
      expect(app.driver.planState.currentExperienceId).toBe(adBetaExperience.experienceId);
      expect(app.driver.planState.resumeCheckpoints).toHaveLength(1);

      // Outcome linkage for the SWITCH action: the ad server observes the
      // viewed-through creative, linked to decision 5.
      const o3 = mustOk(
        advertising.toOutcomeEvent({
          itemId: advertising.betaItemId,
          experienceId: adBetaExperience.experienceId,
          decisionId: d5.decisionId,
          reportId: "e2e-imp-viewed",
          event: "viewed-through",
          tenant: tenants.advertising,
          subject: E2E_SUBJECT,
          at: ET7,
        }),
      );
      await advertisingClient.outcomes.append(o3);

      // --- D6 [advertising host cuts] playing(ad) ⇒ INTERRUPT the
      //     advertising experience WITH a caller-supplied resume token.
      const cutToken = "e2e-cut-token-1";
      app.driver.applyHostIntents(
        mustOk(advertising.hostInterrupt(adBetaExperience.experienceId, app.driver.planState, cutToken)),
      );
      const d6 = await advertisingClient.decisions.request(
        adapterFrontedDecisionRequest({
          tenant: tenants.advertising,
          subject: E2E_SUBJECT,
          binding: advertising,
          at: ET8,
          requestId: e2eId("req"),
          idempotencyKey: e2eId("idem"),
          currentExperience: adBetaExperience,
        }),
      );
      expect(d6.action).toBe("INTERRUPT");
      expect(app.driver.planState.status).toBe("interrupted");
      expect(app.driver.planState.interruptedExperienceId).toBe(adBetaExperience.experienceId);
      expect(app.driver.planState.resumeCheckpoints).toHaveLength(2); // media + ad

      // Outcome linkage for the second INTERRUPT: the ad server observes
      // the subject left mid-spot, linked to decision 6.
      const o4 = mustOk(
        advertising.toOutcomeEvent({
          itemId: advertising.betaItemId,
          experienceId: adBetaExperience.experienceId,
          decisionId: d6.decisionId,
          reportId: "e2e-imp-left",
          event: "left",
          tenant: tenants.advertising,
          subject: E2E_SUBJECT,
          at: ET8,
        }),
      );
      await advertisingClient.outcomes.append(o4);

      // --- D7 [webflix] interrupted(ad), checkpoint present ⇒ RESUME the
      //     ADVERTISING experience through a WEBFLIX-fronted decision.
      const d7 = await webflixClient.decisions.request(
        adapterFrontedDecisionRequest({
          tenant: tenants.webflix,
          subject: E2E_SUBJECT,
          binding: webflix,
          at: ET9,
          requestId: e2eId("req"),
          idempotencyKey: e2eId("idem"),
          currentExperience: adBetaExperience,
        }),
      );
      expect(d7.action).toBe("RESUME");
      // The contract result honestly carries NO selectedExperience: the
      // resume target (an advertising creative) is not among THIS
      // webflix request's candidates — the kernel evidence carries the
      // selectedExperienceId and the resume checkpoint instead.
      expect(d7.selectedExperience).toBeUndefined();
      const resumeRun = app.driver.runs[6];
      expect(resumeRun?.decision.selectedExperienceId).toBe(adBetaExperience.experienceId);
      expect(resumeRun?.decision.resume).toMatchObject({
        experienceId: adBetaExperience.experienceId,
        resumeToken: cutToken,
      });
      expect(app.driver.planState.status).toBe("playing");
      expect(app.driver.planState.currentExperienceId).toBe(adBetaExperience.experienceId);

      // Outcome linkage for the RESUME action: the spot restarts, linked
      // to decision 7.
      const o5 = mustOk(
        advertising.toOutcomeEvent({
          itemId: advertising.betaItemId,
          experienceId: adBetaExperience.experienceId,
          decisionId: d7.decisionId,
          reportId: "e2e-imp-restarted",
          event: "spot-started",
          tenant: tenants.advertising,
          subject: E2E_SUBJECT,
          at: ET9,
        }),
      );
      await advertisingClient.outcomes.append(o5);

      // --- D8 [generic-media host stops] playing(ad) ⇒ END the shared plan.
      app.driver.applyHostIntents(mustOk(media.hostEnd(app.driver.planState)));
      const d8 = await mediaClient.decisions.request(
        adapterFrontedDecisionRequest({
          tenant: tenants.media,
          subject: E2E_SUBJECT,
          binding: media,
          at: ET9 + 60_000,
          requestId: e2eId("req"),
          idempotencyKey: e2eId("idem"),
          currentExperience: adBetaExperience,
        }),
      );
      expect(d8.action).toBe("END");
      expect(app.driver.planState.status).toBe("ended");

      // Outcome linkage for the END action: the webflix player observes
      // the abandoned (checkpointed) media experience, linked to decision 8.
      const o6 = mustOk(
        webflix.toOutcomeEvent({
          itemId: webflix.alphaItemId,
          experienceId: alphaExpId,
          decisionId: d8.decisionId,
          reportId: "e2e-pb-abandoned",
          event: "abandoned",
          tenant: tenants.webflix,
          subject: E2E_SUBJECT,
          at: ET9 + 120_000,
        }),
      );
      await webflixClient.outcomes.append(o6);

      // Preference deltas close the loop for BOTH signs: the completion of
      // the ad creative (positive affinity) and the abandonment of the
      // media experience (negative affinity).
      const adBetaItem = advertising.items.find((item) => item.itemId === advertising.betaItemId) ?? undefined;
      if (adBetaItem === undefined) throw new Error("cross-domain E2E: ad beta item missing");
      const positiveDeltas = mustOk(advertising.toPreferenceDeltas(o3, adBetaItem));
      const webflixAlphaItem = webflix.items.find((item) => item.itemId === webflix.alphaItemId);
      if (webflixAlphaItem === undefined) throw new Error("cross-domain E2E: webflix alpha item missing");
      const negativeDeltas = mustOk(webflix.toPreferenceDeltas(o6, webflixAlphaItem));
      expect(positiveDeltas.length).toBeGreaterThan(0);
      expect(negativeDeltas.length).toBeGreaterThan(0);
      expect(negativeDeltas.every((delta) => typeof delta.value === "number" && delta.value < 0)).toBe(true);
      for (const delta of positiveDeltas) await advertisingClient.preferences.appendDelta(delta);
      for (const delta of negativeDeltas) await webflixClient.preferences.appendDelta(delta);
      expect(app.preferenceDeltas).toHaveLength(positiveDeltas.length + negativeDeltas.length);

      // --- THE EVIDENCE TRAIL (asserted per action) -------------------------
      const records = app.readObservability();

      // One decision record + one scheduler-action record per decision,
      // with MEASURED latency and the emitted action, in scenario order.
      const decisions = [d1, d2, d3, d4, d5, d6, d7, d8];
      const requestIds = app.driver.runs.map((run) => run.request.requestId);
      expect(app.driver.runs).toHaveLength(8);
      const expectedActions = ["QUEUE", "SUGGEST", "INTERRUPT", "HOLD", "SWITCH", "INTERRUPT", "RESUME", "END"];
      for (let i = 0; i < decisions.length; i++) {
        expectDecisionTrail(records, {
          requestId: requestIds[i] as string,
          decisionId: (decisions[i] as DecisionResult).decisionId,
          action: expectedActions[i] as string,
          scheduleDelta: (decisions[i] as DecisionResult).scheduleDelta,
        });
      }
      expect(
        records
          .filter(
            (record): record is Extract<ObservabilityRecord, { kind: "scheduler-action" }> =>
              record.kind === "scheduler-action" && record.source === "decision",
          )
          .map((record) => record.action),
      ).toEqual(expectedActions);

      // The scheduler-action record of the cross-domain SWITCH names the
      // interrupted WEBFLIX experience; the RESUME names the ADVERTISING
      // experience it returned the subject to.
      const switchRecord = records.find(
        (record): record is Extract<ObservabilityRecord, { kind: "scheduler-action" }> =>
          record.kind === "scheduler-action" && record.decisionId === d5.decisionId,
      );
      expect(switchRecord).toMatchObject({ interruptedExperienceId: alphaExpId, enqueuedCount: 0, dequeuedCount: 0 });

      // Outcome linkage per action: QUEUE→o1, SWITCH→o3, INTERRUPT→o4,
      // RESUME→o5, END→o6 linked; the HOLD observation o2 honestly
      // UNLINKED; the non-binding SUGGEST decision d2 and the HOLD
      // decision d4 have NO linked outcome at all.
      for (const outcome of [o1, o3, o4, o5, o6]) {
        expectOutcomeLinked(records, outcome);
      }
      const unlinked = records.filter(
        (record): record is Extract<ObservabilityRecord, { kind: "outcome-linkage" }> =>
          record.kind === "outcome-linkage" && record.eventId === o2.eventId,
      );
      expect(unlinked).toHaveLength(1);
      expect(unlinked[0]).toMatchObject({ linked: false, eventType: "skip", outcomeEvidenceClass: "controlled-local" });
      expect(unlinked[0]?.decisionId).toBeUndefined();
      expect(outcomeLinkageRecords(records, d2.decisionId)).toHaveLength(0);
      expect(outcomeLinkageRecords(records, d4.decisionId)).toHaveLength(0);

      // The outcomes landed in the OWNING tenants' streams (tenant
      // isolation holds under interleaving); 6 events, 4 terminal journal
      // closures per enqueue, zero errors in the trail.
      expect([...app.store.stream(tenants.webflix)]).toHaveLength(2);
      expect([...app.store.stream(tenants.advertising)]).toHaveLength(3);
      expect([...app.store.stream(tenants.media)]).toHaveLength(1);
      expect([...app.store.stream(tenants.commerce)]).toHaveLength(0);
      expect(app.readJournal().filter((record) => record.kind === "terminal")).toHaveLength(6);
      expect(records.filter((record) => record.kind === "error")).toHaveLength(0);

      // The shared plan state went queued → playing → interrupted →
      // interrupted → playing → interrupted → playing → ended across
      // FOUR domains through ONE runtime (domain-neutral by construction:
      // the handler resolves only host data by tenant — never a code
      // branch on domain).
      expect(
        app.driver.runs.map((run) => run.decision.transition.fromStatus),
      ).toEqual(["idle", "playing", "playing", "interrupted", "interrupted", "playing", "interrupted", "playing"]);
      expect(
        app.driver.runs.map((run) => run.decision.transition.toStatus),
      ).toEqual(["queued", "playing", "interrupted", "interrupted", "playing", "interrupted", "playing", "ended"]);
    } finally {
      await app.destroy();
    }
  });

  it("proves the interleave used the SAME shared switch-number bands (SEPARATION LAW constants)", () => {
    // Sanity companion: the interleaved scenario's verdicts come from the
    // SHARED caller-supplied numbers, identical across adapters.
    expect(CONFORMANCE_SWITCH_NUMBERS.expectedImprovement
      - CONFORMANCE_SWITCH_NUMBERS.interruptionCost
      - CONFORMANCE_SWITCH_NUMBERS.uncertaintyPenalty
      - CONFORMANCE_SWITCH_NUMBERS.resumeLoss).toBeGreaterThan(CONFORMANCE_SWITCH_NUMBERS.switchThreshold);
    const suggestNet = CONFORMANCE_SUGGEST_NUMBERS.expectedImprovement
      - CONFORMANCE_SUGGEST_NUMBERS.interruptionCost
      - CONFORMANCE_SUGGEST_NUMBERS.uncertaintyPenalty
      - CONFORMANCE_SUGGEST_NUMBERS.resumeLoss;
    expect(suggestNet).toBeGreaterThan(CONFORMANCE_SUGGEST_NUMBERS.suggestThreshold);
    expect(suggestNet).toBeLessThan(CONFORMANCE_SUGGEST_NUMBERS.switchThreshold);
  });
});

// ---------------------------------------------------------------------------
// Proof 3 — static domain-neutrality of the core runtimes
// ---------------------------------------------------------------------------

describe("W3-009 cross-domain E2E — the core runtimes are domain-neutral", () => {
  it("contains no domain vocabulary in the scheduler/decision/experience kernel sources (no domain branch exists)", () => {
    // Read-only scan of the Worker-2 kernel lane: none of the four
    // domains' vocabulary may appear in the core runtime sources. (The
    // generic word "playback" is deliberately not in the list: it names
    // the active experience in one scheduler comment, not a domain.)
    const kernelFiles = [
      "packages/scheduler/src/errors.ts",
      "packages/scheduler/src/state.ts",
      "packages/scheduler/src/switch-evaluator.ts",
      "packages/scheduler/src/interruption-policy.ts",
      "packages/scheduler/src/scheduler.ts",
      "packages/decision/src/errors.ts",
      "packages/decision/src/normalize.ts",
      "packages/decision/src/policy-engine.ts",
      "packages/decision/src/policy-port.ts",
      "packages/experience/src/errors.ts",
      "packages/experience/src/expand.ts",
    ];
    const forbidden = [
      "webflix",
      "commerce",
      "advertis",
      "shopper",
      "creative",
      "banner",
      "campaign",
      "merchandis",
      "genre",
      "viewing",
      "listening",
      "storefront",
      "playlist",
    ];
    const offenders: string[] = [];
    for (const file of kernelFiles) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      // Comments stripped (the integrations conformance vocabulary law
      // strips comments before matching; same discipline here).
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
      for (const word of forbidden) {
        if (new RegExp(`\\b${word}`, "i").test(code)) {
          offenders.push(`${file}: ${word}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
