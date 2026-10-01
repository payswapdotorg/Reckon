/**
 * W3-007/W3-008 — cross-adapter conformance proof (four adapters).
 *
 * Extends the W3-006 two-adapter proof to ALL FOUR reference adapters:
 * WebFlix (W3-005), generic media (W3-006), commerce (W3-007) and
 * advertising (W3-008) — driven by ONE shared conformance table
 * (conformance-table.ts) of domain-different, structurally parallel
 * fixtures: different host naming (media items/genres/playback
 * options, programs/topics/renditions, products/categories/offers,
 * creatives/topics/placements), same frozen contracts.
 *
 * Concretely, for every contract kind produced on the vertical —
 * CatalogItem, Realization, ContextSnapshot, CandidateSet, Objective,
 * AttentionPolicy, Experience, DecisionRequest, DecisionResult,
 * OutcomeEvent, PreferenceDelta — this suite proves:
 * 1. EVERY adapter's records parse against the SAME frozen zod schema.
 * 2. EVERY record carries the frozen contract id + schemaVersion
 *    headers.
 * 3. EVERY adapter's records are structurally identical (shape
 *    signature comparison over every non-opaque field — the contracts'
 *    own host-opaque record fields are excluded by design).
 * 4. EVERY adapter completes the identical vertical stage sequence
 *    (QUEUE → host start → SWITCH → observed completion outcome →
 *    preference deltas) through the real W2 kernels, with honest
 *    absence for unknown retrieval rows.
 *
 * Additionally it proves the vocabulary isolation laws (media.ts
 * contains no WebFlix vocabulary; commerce.ts contains no media or
 * advertising vocabulary; advertising.ts contains no media or commerce
 * vocabulary) and the host-boundary law (every adapter module's
 * static imports are limited to the frozen contracts, type-only
 * kernel seams and local modules — never host persistence).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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
  CONTRACT_VERSIONS,
} from "@reckon/contracts";
import {
  WEBFLIX_ADAPTER_DECLARATION,
  GENERIC_MEDIA_ADAPTER_DECLARATION,
  COMMERCE_ADAPTER_DECLARATION,
  ADVERTISING_ADAPTER_DECLARATION,
} from "../src/index.js";
import { expectShapeIdentical, expectValid } from "./helpers.js";
import {
  buildConformanceTable,
  runConformanceVerticals,
  type ConformanceBinding,
  type ConformanceVerticalArtifacts,
} from "./conformance-table.js";

const HERE = dirname(fileURLToPath(import.meta.url));

const TABLE = buildConformanceTable();
const REFERENCE = TABLE[0] as ConformanceBinding; // webflix — the shape reference
const VERTICALS = runConformanceVerticals(TABLE);

// ---------------------------------------------------------------------------
// 1. Schema-identity of mapped records (parameterized over the table)
// ---------------------------------------------------------------------------

describe("W3 cross-adapter conformance: schema-identical contract records from domain-different fixtures", () => {
  for (const binding of TABLE) {
    it(`${binding.label}: maps its fixture into schema-valid frozen contracts with the frozen headers`, () => {
      expect(binding.items).toHaveLength(3);
      expect(binding.realizations).toHaveLength(3);
      for (let i = 0; i < 3; i++) {
        const item = expectValid(CatalogItemSchema, binding.items[i]);
        expect(item.schema).toBe(CONTRACT_IDS.catalogItem);
        expect(item.schemaVersion).toBe(CONTRACT_VERSIONS[CONTRACT_IDS.catalogItem]);
        expect(item.kind).toBe(binding.domain === "media" ? "media" : binding.domain);
        const realization = expectValid(RealizationSchema, binding.realizations[i]);
        expect(realization.schema).toBe(CONTRACT_IDS.realization);
        expectShapeIdentical(
          `${binding.label}.catalogItem[${i}]`,
          item,
          expectValid(CatalogItemSchema, REFERENCE.items[i]),
        );
        expectShapeIdentical(
          `${binding.label}.realization[${i}]`,
          realization,
          expectValid(RealizationSchema, REFERENCE.realizations[i]),
        );
      }

      const context = expectValid(ContextSnapshotSchema, binding.context);
      expect(context.schema).toBe(CONTRACT_IDS.contextSnapshot);
      expectShapeIdentical(`${binding.label}.contextSnapshot`, context, expectValid(ContextSnapshotSchema, REFERENCE.context));

      const candidateSet = expectValid(CandidateSetSchema, binding.candidateSet);
      expectShapeIdentical(`${binding.label}.candidateSet`, candidateSet, expectValid(CandidateSetSchema, REFERENCE.candidateSet));

      const objective = expectValid(ObjectiveSchema, binding.objective);
      expectShapeIdentical(`${binding.label}.objective`, objective, expectValid(ObjectiveSchema, REFERENCE.objective));

      const attentionPolicy = expectValid(AttentionPolicySchema, binding.attentionPolicy);
      // Every binding declares a BALANCED attention policy on the
      // conformance fixture (the shared vertical invariant).
      expect(attentionPolicy.style).toBe("balanced");
      expectShapeIdentical(
        `${binding.label}.attentionPolicy`,
        attentionPolicy,
        expectValid(AttentionPolicySchema, REFERENCE.attentionPolicy),
      );

      // Every adapter declares fixture-only live verification and
      // host-authoritative boundaries.
      expect(binding.declaration.liveVerification.status).toBe("fixture-only");
      expect(binding.declaration.provenance.dataOwnership).toBe("host");
    });
  }

  it("every pair of adapters maps to the same contract ids and versions", () => {
    for (const binding of TABLE) {
      expect(binding.items[0]?.schema).toBe(REFERENCE.items[0]?.schema);
      expect(binding.realizations[0]?.schema).toBe(REFERENCE.realizations[0]?.schema);
      expect(binding.items[0]?.schemaVersion).toBe(REFERENCE.items[0]?.schemaVersion);
    }
    expect(TABLE.map((b) => b.declaration.adapterId)).toEqual([
      WEBFLIX_ADAPTER_DECLARATION.adapterId,
      GENERIC_MEDIA_ADAPTER_DECLARATION.adapterId,
      COMMERCE_ADAPTER_DECLARATION.adapterId,
      ADVERTISING_ADAPTER_DECLARATION.adapterId,
    ]);
    expect(new Set(TABLE.map((b) => b.declaration.adapterId)).size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 2. The identical vertical through the real kernels, every adapter
// ---------------------------------------------------------------------------

describe("W3 cross-adapter conformance: identical vertical stages through the real kernels", () => {
  function artifactsOf(binding: ConformanceBinding): ConformanceVerticalArtifacts {
    const artifacts = VERTICALS.get(binding.label);
    if (artifacts === undefined) throw new Error(`missing vertical artifacts for ${binding.label}`);
    return artifacts;
  }
  const referenceArtifacts = artifactsOf(REFERENCE);

  for (const binding of TABLE) {
    it(`${binding.label}: completes QUEUE → host start → SWITCH → observed outcome → deltas with shape-identical records`, () => {
      const { run1, startIntents, run2, outcome, deltas } = artifactsOf(binding);

      // --- Stage: experiences (schema-valid, shape-identical, expected count).
      expect(run1.expansion.experiences).toHaveLength(binding.expectedExperienceCount);
      expect(binding.expectedExperienceCount).toBe(REFERENCE.expectedExperienceCount);
      for (let i = 0; i < binding.expectedExperienceCount; i++) {
        const experience = expectValid(ExperienceSchema, run1.expansion.experiences[i]?.experience);
        expect(experience.schema).toBe(CONTRACT_IDS.experience);
        expectShapeIdentical(
          `${binding.label}.experience[${i}]`,
          experience,
          expectValid(ExperienceSchema, referenceArtifacts.run1.expansion.experiences[i]?.experience),
        );
      }
      // Honest absence: the ghost retrieval row is an exclusion, never
      // an invented experience.
      const ghostExclusion = run1.expansion.exclusions.find(
        (exclusion) => exclusion.kind === "candidate-unavailable" && exclusion.itemId === binding.ghostItemId,
      );
      expect(ghostExclusion).toBeDefined();
      expect(ghostExclusion?.detail).toContain("no-catalog-item");

      // --- Stage: decision request + result #1 (QUEUE).
      const request1 = expectValid(DecisionRequestSchema, run1.request);
      expectShapeIdentical(`${binding.label}.decisionRequest#1`, request1, expectValid(DecisionRequestSchema, referenceArtifacts.run1.request));
      const result1 = expectValid(DecisionResultSchema, run1.result);
      expect(result1.schema).toBe(CONTRACT_IDS.decisionResult);
      expect(result1.action).toBe("QUEUE");
      expect(run1.rewardApplied).toBe(false); // objective-fit evidence only (lock #22)
      expect(run1.decision.selectedExperience?.itemId).toBe(binding.alphaItemId);
      expectShapeIdentical(`${binding.label}.decisionResult#1`, result1, expectValid(DecisionResultSchema, referenceArtifacts.run1.result));

      // --- Stage: host start (host-authoritative, balanced policy —
      //     the scheduler queued, the HOST starts).
      expect(startIntents.planState?.status).toBe("playing");
      expect(startIntents.planState?.currentExperienceId).toBe(run1.decision.selectedExperienceId);

      // --- Stage: decision request + result #2 (SWITCH via the shared
      //     caller-supplied numbers, resume checkpoint recorded).
      const request2 = expectValid(DecisionRequestSchema, run2.request);
      expectShapeIdentical(`${binding.label}.decisionRequest#2`, request2, expectValid(DecisionRequestSchema, referenceArtifacts.run2.request));
      const result2 = expectValid(DecisionResultSchema, run2.result);
      expect(result2.action).toBe("SWITCH");
      expect(run2.decision.selectedExperience?.itemId).toBe(binding.betaItemId);
      expect(run2.decision.resumeCheckpointSlot?.resumeToken).toBe(binding.resumeToken);
      expectShapeIdentical(`${binding.label}.decisionResult#2`, result2, expectValid(DecisionResultSchema, referenceArtifacts.run2.result));

      // --- Stage: observed completion outcome for the switched-to item.
      const observed = expectValid(OutcomeEventSchema, outcome);
      expect(observed.schema).toBe(CONTRACT_IDS.outcomeEvent);
      expect(observed.eventType).toBe("completion"); // every binding's completion-shaped observation
      expect(observed.evidenceClass).toBe("controlled-local"); // observed class, honestly labeled
      expect(observed.decisionId).toBe(run2.result.decisionId);
      expectShapeIdentical(`${binding.label}.outcomeEvent`, observed, expectValid(OutcomeEventSchema, referenceArtifacts.outcome));

      // --- Stage: preference deltas from the observed outcome — the
      //     adapter's OWN vocabulary, never another domain's.
      expect(deltas.length).toBeGreaterThan(0);
      for (let i = 0; i < deltas.length; i++) {
        const delta = expectValid(PreferenceDeltaSchema, deltas[i]);
        expect(delta.dimension).toMatch(new RegExp(`^${binding.deltaDimensionPrefix.replace(/\./g, "\\.")}:`));
        const referenceDelta = referenceArtifacts.deltas[i];
        if (referenceDelta === undefined) continue;
        expectShapeIdentical(
          `${binding.label}.preferenceDelta[${i}]`,
          delta,
          expectValid(PreferenceDeltaSchema, referenceDelta),
        );
      }
      // Same label counts by construction (beta items carry exactly
      // two mapped labels in every fixture).
      expect(deltas).toHaveLength(referenceArtifacts.deltas.length);
    });
  }

  it("every vertical used the SAME shared caller-supplied switch numbers (SEPARATION LAW)", () => {
    for (const binding of TABLE) {
      const { run2 } = artifactsOf(binding);
      expect(run2.decision.reasons.some((r) => r.code === "switch-net-positive")).toBe(true);
      // Net 0.9 − 0.1 − 0.1 − 0.05 = 0.65 > switchThreshold 0.5 ⇒ SWITCH.
      expect(run2.decision.action).toBe("SWITCH");
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Vocabulary isolation (the cross-domain laws)
// ---------------------------------------------------------------------------

describe("W3 vocabulary isolation", () => {
  /** Strip comments (block + line) — doc headers may REFERENCE the
   *  other work items (governance documentation, not domain
   *  vocabulary); identifiers, strings and mapped values must not
   *  contain foreign domain naming. */
  function codeOnly(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/[^\n]*/gm, "");
  }

  it("every adapter module is free of the other domains' vocabulary", () => {
    for (const binding of TABLE) {
      const source = readFileSync(resolve(HERE, binding.sourceModule), "utf8");
      const code = codeOnly(source);
      for (const pattern of binding.forbiddenVocabulary) {
        // Word-boundary match (case-insensitive); entries are regex
        // sources so governance terms like "production truth"
        // (AGENTS.md evidence-class vocabulary) are excluded from the
        // commerce-word check via a negative lookahead.
        const match = new RegExp(`\\b${pattern}`, "i").exec(code);
        expect(
          match === null,
          `${binding.sourceModule} contains forbidden vocabulary "${match?.[0] ?? pattern}"`,
        ).toBe(true);
      }
    }
  });

  it("generic media adapter code contains no WebFlix vocabulary and adapter ids stay distinct", () => {
    const mediaSource = readFileSync(resolve(HERE, "../src/media.ts"), "utf8");
    const code = codeOnly(mediaSource);
    expect(code.toLowerCase()).not.toContain("webflix");
    expect(GENERIC_MEDIA_ADAPTER_DECLARATION.adapterId).not.toBe(WEBFLIX_ADAPTER_DECLARATION.adapterId);
    expect(COMMERCE_ADAPTER_DECLARATION.adapterId).not.toBe(WEBFLIX_ADAPTER_DECLARATION.adapterId);
    expect(COMMERCE_ADAPTER_DECLARATION.adapterId).not.toBe(ADVERTISING_ADAPTER_DECLARATION.adapterId);
    expect(ADVERTISING_ADAPTER_DECLARATION.adapterId).not.toBe(GENERIC_MEDIA_ADAPTER_DECLARATION.adapterId);
  });

  it("affinity delta dimensions never leak another domain's vocabulary", () => {
    const dimensionPrefixes = TABLE.map((binding) => binding.deltaDimensionPrefix);
    for (const binding of TABLE) {
      const { deltas } = VERTICALS.get(binding.label) as ConformanceVerticalArtifacts;
      for (const delta of deltas) {
        for (const otherPrefix of dimensionPrefixes) {
          if (otherPrefix === binding.deltaDimensionPrefix) continue;
          expect(delta.dimension).not.toContain(otherPrefix);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Host-boundary law (no host-internal persistence imports)
// ---------------------------------------------------------------------------

describe("W3 host-boundary law: adapter modules import only frozen contracts, kernel seams and local modules", () => {
  const ALLOWED_SPECIFIERS = new Set([
    "@reckon/contracts",
    "./errors.js",
    "./declaration.js",
    "./internal.js",
    "./webflix.js",
    "./media.js",
    "./commerce.js",
    "./advertising.js",
    "./index.js",
    "../../scheduler/src/index.js",
    "../../experience/src/index.js",
    "../../decision/src/index.js",
  ]);

  function importSpecifiersOf(source: string): string[] {
    const specifiers: string[] = [];
    const pattern = /from\s+["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      specifiers.push(match[1]);
    }
    return specifiers;
  }

  it("every adapter module declares only boundary-safe static imports", () => {
    for (const file of [
      "../src/webflix.ts",
      "../src/media.ts",
      "../src/commerce.ts",
      "../src/advertising.ts",
    ]) {
      const source = readFileSync(resolve(HERE, file), "utf8");
      const specifiers = importSpecifiersOf(source);
      expect(specifiers.length).toBeGreaterThan(0);
      for (const specifier of specifiers) {
        expect(
          ALLOWED_SPECIFIERS.has(specifier),
          `${file} imports non-allowlisted module "${specifier}"`,
        ).toBe(true);
      }
      // No host-internal module can ever appear: every specifier is
      // allowlisted above, and none starts with a host package prefix.
      for (const specifier of specifiers) {
        expect(
          specifier.startsWith("@webflix/") ||
            specifier.startsWith("@commerce/") ||
            specifier.startsWith("@advertiser/") ||
            specifier.includes("persistence"),
        ).toBe(false);
      }
    }
  });
});
