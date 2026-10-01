/**
 * W3-007/W3-008 — the top-level cross-adapter conformance suite
 * (tests/conformance — the Worker-3 conformance home declared by
 * tests/conformance/README.md: "contract/conformance suites used by
 * media, commerce and advertising consumers").
 *
 * ONE shared conformance table (packages/integrations/test/
 * conformance-table.ts), FOUR reference adapters — WebFlix (W3-005),
 * generic media (W3-006), commerce (W3-007), advertising (W3-008) —
 * proving that all four satisfy the SAME frozen normalized contracts
 * and the SAME vertical shape through the REAL Worker-2 kernels:
 *
 *   media:      media item → realization → experience → play/switch
 *   commerce:   product → offer/realization → experience → present/swap
 *   advertising: creative → placement/format → experience → show/rotate/cut
 *
 * For every binding this suite proves (parameterized over the table):
 * 1. mapped records parse the SAME frozen zod schemas with the frozen
 *    contract id + schemaVersion headers;
 * 2. the identical vertical stage sequence completes through the real
 *    kernels — QUEUE (decision 1, idle + balanced) → host-
 *    authoritative start → SWITCH (decision 2, shared caller-supplied
 *    numbers + resume checkpoint) → observed completion outcome →
 *    preference deltas — with honest absence for unknown retrieval
 *    rows and NO LLM anywhere;
 * 3. the outcome evidence class is observed (controlled-local) and
 *    the preference deltas carry the adapter's OWN affinity
 *    vocabulary, never another domain's;
 * 4. all four adapters' records are shape-identical per contract kind
 *    (checked against the WebFlix reference binding).
 *
 * Fixture evidence only — every adapter declaration says fixture-only;
 * nothing here proves a live provider integration.
 */
import { describe, expect, it } from "vitest";
// Top-level tests are outside the workspace packages: the established
// repository pattern (tests/e2e) imports package sources relatively.
import {
  CatalogItemSchema,
  CandidateSetSchema,
  ContextSnapshotSchema,
  AttentionPolicySchema,
  DecisionRequestSchema,
  DecisionResultSchema,
  ExperienceSchema,
  ObjectiveSchema,
  OutcomeEventSchema,
  PreferenceDeltaSchema,
  RealizationSchema,
  CONTRACT_IDS,
} from "../../packages/contracts/src/index.js";
import { expectShapeIdentical, expectValid } from "../../packages/integrations/test/helpers.js";
import {
  buildConformanceTable,
  runConformanceVerticals,
  type ConformanceBinding,
  type ConformanceVerticalArtifacts,
} from "../../packages/integrations/test/conformance-table.js";

const TABLE = buildConformanceTable();
const REFERENCE = TABLE[0] as ConformanceBinding; // webflix — the shape reference
const VERTICALS = runConformanceVerticals(TABLE);

function artifactsOf(binding: ConformanceBinding): ConformanceVerticalArtifacts {
  const artifacts = VERTICALS.get(binding.label);
  if (artifacts === undefined) throw new Error(`missing vertical artifacts for ${binding.label}`);
  return artifacts;
}

describe("cross-adapter conformance: four reference adapters, the same normalized contracts", () => {
  for (const binding of TABLE) {
    it(`${binding.label}: maps a ${binding.domain} fixture into schema-valid frozen contracts with the frozen headers`, () => {
      expect(binding.items).toHaveLength(3);
      expect(binding.realizations).toHaveLength(3);
      expect(binding.candidateSet.candidates).toHaveLength(4);
      for (const item of binding.items) {
        expectValid(CatalogItemSchema, item);
        expect(item.schema).toBe(CONTRACT_IDS.catalogItem);
        expect(item.kind).toBe(binding.domain);
      }
      for (const realization of binding.realizations) {
        expectValid(RealizationSchema, realization);
        expect(realization.schema).toBe(CONTRACT_IDS.realization);
      }
      expectValid(ContextSnapshotSchema, binding.context);
      expectValid(CandidateSetSchema, binding.candidateSet);
      expectValid(ObjectiveSchema, binding.objective);
      expectValid(AttentionPolicySchema, binding.attentionPolicy);
      expect(binding.attentionPolicy.style).toBe("balanced"); // shared vertical invariant
    });
  }

  for (const binding of TABLE) {
    it(`${binding.label}: completes the identical vertical stage sequence (QUEUE → host start → SWITCH → observed outcome → deltas) through the real W2 kernels`, () => {
      const { run1, startIntents, run2, outcome, deltas } = artifactsOf(binding);

      // Stage 1 — experiences: schema-valid, expected count, honest
      // absence for the unknown retrieval row.
      expect(run1.expansion.experiences).toHaveLength(binding.expectedExperienceCount);
      for (const entry of run1.expansion.experiences) {
        expectValid(ExperienceSchema, entry.experience);
      }
      expect(
        run1.expansion.exclusions.some(
          (exclusion) => exclusion.kind === "candidate-unavailable" && exclusion.itemId === binding.ghostItemId,
        ),
      ).toBe(true);

      // Stage 2 — decision 1: QUEUE the best candidate (balanced
      // policy from idle; the scheduler never auto-starts).
      expectValid(DecisionRequestSchema, run1.request);
      const result1 = expectValid(DecisionResultSchema, run1.result);
      expect(result1.action).toBe("QUEUE");
      expect(run1.decision.selectedExperience?.itemId).toBe(binding.alphaItemId);
      expect(run1.rewardApplied).toBe(false);

      // Stage 3 — the host-authoritative start (play/tune/present/
      // show: the HOST starts, never the scheduler).
      expect(startIntents.planState?.status).toBe("playing");
      expect(startIntents.planState?.currentExperienceId).toBe(run1.decision.selectedExperienceId);

      // Stage 4 — decision 2: SWITCH via the shared caller-supplied
      // numbers, with a caller-supplied resume checkpoint.
      expectValid(DecisionRequestSchema, run2.request);
      const result2 = expectValid(DecisionResultSchema, run2.result);
      expect(result2.action).toBe("SWITCH");
      expect(run2.decision.selectedExperience?.itemId).toBe(binding.betaItemId);
      expect(run2.decision.resumeCheckpointSlot?.resumeToken).toBe(binding.resumeToken);

      // Stage 5 — the observed completion outcome, linked to decision 2.
      const observed = expectValid(OutcomeEventSchema, outcome);
      expect(observed.eventType).toBe("completion");
      expect(observed.evidenceClass).toBe("controlled-local");
      expect(observed.decisionId).toBe(run2.result.decisionId);
      expect(observed.experienceId).toBe(run2.decision.selectedExperienceId);

      // Stage 6 — preference deltas close the loop, in the adapter's
      // own vocabulary.
      expect(deltas.length).toBeGreaterThan(0);
      for (const delta of deltas) {
        const parsed = expectValid(PreferenceDeltaSchema, delta);
        expect(parsed.dimension).toMatch(new RegExp(`^${binding.deltaDimensionPrefix.replace(/\./g, "\\.")}:`));
      }
    });
  }

  it("all four adapters produce shape-identical records for every contract kind on the vertical", () => {
    const referenceArtifacts = artifactsOf(REFERENCE);
    for (const binding of TABLE) {
      const { run1, run2, outcome, deltas } = artifactsOf(binding);

      // Mapped records.
      for (let i = 0; i < 3; i++) {
        expectShapeIdentical(
          `${binding.label}.catalogItem[${i}]`,
          binding.items[i],
          REFERENCE.items[i],
        );
        expectShapeIdentical(
          `${binding.label}.realization[${i}]`,
          binding.realizations[i],
          REFERENCE.realizations[i],
        );
      }
      expectShapeIdentical(`${binding.label}.contextSnapshot`, binding.context, REFERENCE.context);
      expectShapeIdentical(`${binding.label}.candidateSet`, binding.candidateSet, REFERENCE.candidateSet);
      expectShapeIdentical(`${binding.label}.objective`, binding.objective, REFERENCE.objective);
      expectShapeIdentical(`${binding.label}.attentionPolicy`, binding.attentionPolicy, REFERENCE.attentionPolicy);

      // Vertical records.
      const experienceCount = Math.min(
        binding.expectedExperienceCount,
        referenceArtifacts.run1.expansion.experiences.length,
      );
      for (let i = 0; i < experienceCount; i++) {
        expectShapeIdentical(
          `${binding.label}.experience[${i}]`,
          run1.expansion.experiences[i]?.experience,
          referenceArtifacts.run1.expansion.experiences[i]?.experience,
        );
      }
      expectShapeIdentical(`${binding.label}.decisionRequest#1`, run1.request, referenceArtifacts.run1.request);
      expectShapeIdentical(`${binding.label}.decisionResult#1`, run1.result, referenceArtifacts.run1.result);
      expectShapeIdentical(`${binding.label}.decisionRequest#2`, run2.request, referenceArtifacts.run2.request);
      expectShapeIdentical(`${binding.label}.decisionResult#2`, run2.result, referenceArtifacts.run2.result);
      expectShapeIdentical(`${binding.label}.outcomeEvent`, outcome, referenceArtifacts.outcome);
      expect(deltas).toHaveLength(referenceArtifacts.deltas.length);
      for (let i = 0; i < deltas.length; i++) {
        expectShapeIdentical(
          `${binding.label}.preferenceDelta[${i}]`,
          deltas[i],
          referenceArtifacts.deltas[i],
        );
      }
    }
  });

  it("covers all four domains with distinct fixture-only, host-authoritative adapters", () => {
    expect(TABLE.map((binding) => binding.domain)).toEqual(["media", "media", "commerce", "advertising"]);
    expect(new Set(TABLE.map((binding) => binding.declaration.adapterId)).size).toBe(4);
    for (const binding of TABLE) {
      expect(binding.declaration.liveVerification.status).toBe("fixture-only");
      expect(binding.declaration.liveVerification.evidenceClass).toBe("fixture");
      expect(binding.declaration.provenance.dataOwnership).toBe("host");
      // Identity, consent, rights, catalog authoring, provider access,
      // delivery and payment are NEVER adapter capabilities.
      for (const capability of ["identity", "consent-management", "rights-verification", "catalog-authoring"]) {
        expect(binding.declaration.unsupportedCapabilities).toContain(capability);
      }
    }
  });
});
