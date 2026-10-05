import { describe, expect, it } from "vitest";
import {
  CandidateSetSchema,
  CatalogItemSchema,
  ContextSnapshotSchema,
  DecisionRequestSchema,
  DecisionResultSchema,
  ExperienceSchema,
  OutcomeEventSchema,
  PreferenceDeltaSchema,
  RealizationSchema,
} from "@reckon/contracts";
import {
  candidateSetExample,
  catalogItemExample,
  contextSnapshotExample,
  decisionRequestExample,
  decisionResultExample,
  jsonOf,
  outcomeEventExample,
  preferenceDeltaExample,
  realizationExample,
  selectedExperienceExample,
} from "../src/content/fixtures/index.js";

/**
 * S1-004 docs-contract law: every example payload shown in the docs is
 * validated against the REAL frozen schemas from @reckon/contracts, so
 * code samples can never drift from the wire contracts.
 */

describe("docs contract fixtures (quickstart + reference payloads)", () => {
  it("decision request satisfies reckon.decision-request", () => {
    const result = DecisionRequestSchema.safeParse(decisionRequestExample);
    expect(result.success, JSON.stringify(result, null, 2)).toBe(true);
  });

  it("decision result satisfies reckon.decision-result", () => {
    const result = DecisionResultSchema.safeParse(decisionResultExample);
    expect(result.success, JSON.stringify(result, null, 2)).toBe(true);
  });

  it("selected experience satisfies reckon.experience", () => {
    const result = ExperienceSchema.safeParse(selectedExperienceExample);
    expect(result.success, JSON.stringify(result, null, 2)).toBe(true);
  });

  it("outcome event satisfies reckon.outcome-event", () => {
    const result = OutcomeEventSchema.safeParse(outcomeEventExample);
    expect(result.success, JSON.stringify(result, null, 2)).toBe(true);
  });

  it("preference delta satisfies reckon.preference-delta", () => {
    const result = PreferenceDeltaSchema.safeParse(preferenceDeltaExample);
    expect(result.success, JSON.stringify(result, null, 2)).toBe(true);
  });

  it("context snapshot satisfies reckon.context-snapshot (and sends no location)", () => {
    const result = ContextSnapshotSchema.safeParse(contextSnapshotExample);
    expect(result.success, JSON.stringify(result, null, 2)).toBe(true);
    // ADR-003: the docs example demonstrates the privacy default.
    expect(contextSnapshotExample.location).toBeUndefined();
  });

  it("catalog item satisfies reckon.catalog-item", () => {
    const result = CatalogItemSchema.safeParse(catalogItemExample);
    expect(result.success, JSON.stringify(result, null, 2)).toBe(true);
  });

  it("realization satisfies reckon.realization", () => {
    const result = RealizationSchema.safeParse(realizationExample);
    expect(result.success, JSON.stringify(result, null, 2)).toBe(true);
  });

  it("candidate set satisfies the candidate-set contract", () => {
    const result = CandidateSetSchema.safeParse(candidateSetExample);
    expect(result.success, JSON.stringify(result, null, 2)).toBe(true);
  });

  it("jsonOf renders stable, parseable JSON for code blocks", () => {
    for (const value of [
      decisionRequestExample,
      decisionResultExample,
      outcomeEventExample,
      preferenceDeltaExample,
      contextSnapshotExample,
      catalogItemExample,
      realizationExample,
      selectedExperienceExample,
    ]) {
      expect(JSON.parse(jsonOf(value))).toEqual(value);
    }
  });

  it("the demo vertical is internally consistent (ids cross-reference)", () => {
    expect(decisionResultExample.requestId).toBe(decisionRequestExample.requestId);
    expect(decisionResultExample.tenant).toEqual(decisionRequestExample.tenant);
    expect(decisionResultExample.selectedExperience?.itemId).toBe(
      catalogItemExample.itemId,
    );
    expect(outcomeEventExample.decisionId).toBe(decisionResultExample.decisionId);
    expect(outcomeEventExample.experienceId).toBe(
      decisionResultExample.selectedExperience?.experienceId,
    );
    expect(candidateSetExample.candidates[0]?.itemId).toBe(catalogItemExample.itemId);
  });
});
