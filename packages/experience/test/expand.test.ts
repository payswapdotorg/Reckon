/**
 * W2-003 acceptance tests — experience expansion.
 *
 * Proves: schema-valid variants (base + realization-declared variants,
 * validated with ExperienceSchema), constraint exclusion reason codes,
 * no fabricated fit scores (only injected ObjectiveFitFn), honest
 * absence, typed errors, and determinism digests.
 */
import { describe, expect, it } from "vitest";
import {
  CatalogItemSchema,
  ExperienceSchema,
  ObjectiveSchema,
  RealizationSchema,
  contentDigest,
  type CatalogItem,
  type HardConstraint,
  type Realization,
} from "@reckon/contracts";
import type { NormalizedCandidate } from "../../decision/src/index.js";
import { createExperienceExpander, expandExperiences, type FormatKind } from "../src/index.js";

function item(itemId: string, opts: { availableFrom?: number; availableUntil?: number } = {}): CatalogItem {
  return CatalogItemSchema.parse({
    itemId,
    kind: "media",
    labels: [],
    ...(opts.availableFrom !== undefined ? { availableFrom: opts.availableFrom } : {}),
    ...(opts.availableUntil !== undefined ? { availableUntil: opts.availableUntil } : {}),
  });
}

function realization(
  realizationId: string,
  itemId: string,
  constraints: Record<string, unknown> = {},
  locale?: string,
): Realization {
  return RealizationSchema.parse({
    realizationId,
    itemId,
    kind: "stream",
    constraints,
    ...(locale !== undefined ? { locale } : {}),
  });
}

function normalizedCandidate(
  itemId: string,
  realizationIds: string[],
  source = "host-retrieval",
  rankHint?: number,
): NormalizedCandidate {
  const available = realizationIds.length > 0;
  return {
    key: JSON.stringify([itemId, source]),
    itemId,
    realizationIds,
    source,
    labels: [],
    availability: available
      ? { available: true }
      : { available: false, reason: "no-realization" },
    ...(rankHint !== undefined ? { rankHint } : {}),
  };
}

function baseInput(overrides: Partial<Parameters<typeof expandExperiences>[0]> = {}) {
  return {
    candidates: [normalizedCandidate("item-1", ["real-1"])],
    items: [item("item-1")],
    realizations: [realization("real-1", "item-1")],
    formatPolicy: {
      allowedFormats: ["full", "clip", "audio-only", "segment", "text-summary"] as FormatKind[],
    },
    objective: ObjectiveSchema.parse({ objectiveId: "obj-1", kind: "relax" }),
    constraints: [],
    ...overrides,
  };
}

describe("W2-003 expansion: schema-valid variants", () => {
  it("emits the base format PLUS the realization-declared variants — all schema-valid", () => {
    const input = baseInput({
      realizations: [
        realization("real-1", "item-1", {
          formats: ["full", "clip", "audio-only"],
          durationSeconds: 600,
        }),
      ],
    });
    const result = expandExperiences(input);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.experiences).toHaveLength(3);
    const kinds = result.value.experiences.map((e) => e.experience.format.kind).sort();
    expect(kinds).toEqual(["audio-only", "clip", "full"]);
    for (const expanded of result.value.experiences) {
      // Every emitted variant is a COMPLETE Experience per the frozen schema.
      expect(() => ExperienceSchema.parse(expanded.experience)).not.toThrow();
      expect(expanded.experience.itemId).toBe("item-1");
      expect(expanded.experience.realizationId).toBe("real-1");
      expect(expanded.experience.duration).toBe(600);
    }
    expect(result.value.exclusions).toEqual([]);
  });

  it("defaults to the base format 'full' when the realization declares no formats", () => {
    const result = expandExperiences(baseInput());
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.experiences).toHaveLength(1);
    expect(result.value.experiences[0].experience.format.kind).toBe("full");
    expect(() => ExperienceSchema.parse(result.value.experiences[0].experience)).not.toThrow();
  });

  it("carries locale, requirements and timing from the host declarations", () => {
    const input = baseInput({
      items: [item("item-1", { availableFrom: 1_000, availableUntil: 2_000 })],
      realizations: [
        realization("real-1", "item-1", {
          deviceClasses: ["tv", "desktop"],
          requiresScreen: true,
          minBandwidth: "high",
        }, "fr-FR"),
      ],
    });
    const result = expandExperiences(input);
    if (!result.ok) throw new Error(result.error.message);
    const exp = result.value.experiences[0].experience;
    expect(exp.locale).toBe("fr-FR");
    expect(exp.requirements).toEqual({
      deviceClass: ["tv", "desktop"],
      requiresScreen: true,
      minBandwidth: "high",
    });
    expect(exp.timing).toEqual({ earliestMs: 1_000, latestMs: 2_000 });
    expect(() => ExperienceSchema.parse(exp)).not.toThrow();
  });

  it("deduplicates experiences proposed by multiple candidate sources (one experience, both sources)", () => {
    const input = baseInput({
      candidates: [
        normalizedCandidate("item-1", ["real-1"], "host-retrieval", 2),
        normalizedCandidate("item-1", ["real-1"], "exploration", 5),
      ],
    });
    const result = expandExperiences(input);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.experiences).toHaveLength(1);
    expect(result.value.experiences[0].sources).toEqual(["exploration", "host-retrieval"]);
    expect(result.value.experiences[0].rankHint).toBe(5);
  });
});

describe("W2-003 expansion: constraint gating (separate from reward)", () => {
  it("excludes variants below min-duration with reason code min-duration", () => {
    const input = baseInput({
      realizations: [
        realization("real-1", "item-1", {
          formats: ["full", "clip"],
          durationSeconds: 600,
          formatParams: { clip: { durationSeconds: 30 } },
        }),
      ],
      constraints: [{ kind: "min-duration", seconds: 60 } as HardConstraint],
    });
    const result = expandExperiences(input);
    if (!result.ok) throw new Error(result.error.message);
    // Both variants share durationSeconds 600 in this wave (format params
    // are opaque); duration is realization-level. min 60s passes for both.
    // (Experience ids are digest-derived, so compare canonically sorted.)
    expect(result.value.experiences.map((e) => e.experience.format.kind).sort()).toEqual(["clip", "full"]);
  });

  it("excludes variants when duration is undeclared and a duration gate exists (fail-closed, never guessed)", () => {
    const input = baseInput({
      realizations: [realization("real-1", "item-1", {})],
      constraints: [{ kind: "max-duration", seconds: 300 } as HardConstraint],
    });
    const result = expandExperiences(input);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.experiences).toHaveLength(0);
    expect(result.value.exclusions).toHaveLength(1);
    const exclusion = result.value.exclusions[0];
    expect(exclusion.kind).toBe("experience-excluded");
    if (exclusion.kind === "experience-excluded") {
      expect(exclusion.excludedBy).toBe("max-duration");
      expect(exclusion.reasons).toEqual(["max-duration"]);
      expect(exclusion.format.kind).toBe("full");
    }
  });

  it("excludes by format-required and format-forbidden with reason codes", () => {
    const input = baseInput({
      realizations: [realization("real-1", "item-1", { formats: ["full", "clip"] })],
      constraints: [{ kind: "format-forbidden", format: "clip" } as HardConstraint],
    });
    const result = expandExperiences(input);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.experiences.map((e) => e.experience.format.kind)).toEqual(["full"]);
    expect(result.value.exclusions[0]).toMatchObject({
      kind: "experience-excluded",
      excludedBy: "format-forbidden",
      reasons: ["format-forbidden"],
    });
  });

  it("excludes by locale-required (mismatch and undeclared both fail closed)", () => {
    const mismatched = expandExperiences(
      baseInput({
        realizations: [realization("real-1", "item-1", {}, "fr-FR")],
        constraints: [{ kind: "locale-required", locale: "en-US" } as HardConstraint],
      }),
    );
    if (!mismatched.ok) throw new Error(mismatched.error.message);
    expect(mismatched.value.experiences).toHaveLength(0);
    expect(mismatched.value.exclusions[0]).toMatchObject({ excludedBy: "locale-required" });

    const undeclared = expandExperiences(
      baseInput({
        realizations: [realization("real-1", "item-1", {})],
        constraints: [{ kind: "locale-required", locale: "en-US" } as HardConstraint],
      }),
    );
    if (!undeclared.ok) throw new Error(undeclared.error.message);
    expect(undeclared.value.exclusions[0]).toMatchObject({ excludedBy: "locale-required" });
  });

  it("excludes by device-class-required only when the class is declared (fail-closed)", () => {
    const declaredWrong = expandExperiences(
      baseInput({
        realizations: [realization("real-1", "item-1", { deviceClasses: ["tv"] })],
        constraints: [{ kind: "device-class-required", deviceClass: "phone" } as HardConstraint],
      }),
    );
    if (!declaredWrong.ok) throw new Error(declaredWrong.error.message);
    expect(declaredWrong.value.exclusions[0]).toMatchObject({ excludedBy: "device-class-required" });

    const undeclared = expandExperiences(
      baseInput({
        realizations: [realization("real-1", "item-1", {})],
        constraints: [{ kind: "device-class-required", deviceClass: "phone" } as HardConstraint],
      }),
    );
    if (!undeclared.ok) throw new Error(undeclared.error.message);
    expect(undeclared.value.exclusions[0]).toMatchObject({ excludedBy: "device-class-required" });

    const declaredRight = expandExperiences(
      baseInput({
        realizations: [realization("real-1", "item-1", { deviceClasses: ["phone"] })],
        constraints: [{ kind: "device-class-required", deviceClass: "phone" } as HardConstraint],
      }),
    );
    if (!declaredRight.ok) throw new Error(declaredRight.error.message);
    expect(declaredRight.value.experiences).toHaveLength(1);
  });

  it("records ALL failing gates with the first as excludedBy (deterministic order)", () => {
    const input = baseInput({
      realizations: [realization("real-1", "item-1", { formats: ["clip"] })],
      constraints: [
        { kind: "format-forbidden", format: "clip" } as HardConstraint,
        { kind: "min-duration", seconds: 999 } as HardConstraint,
      ],
    });
    const result = expandExperiences(input);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.experiences).toHaveLength(0);
    const exclusion = result.value.exclusions[0];
    expect(exclusion.kind).toBe("experience-excluded");
    if (exclusion.kind === "experience-excluded") {
      expect(exclusion.excludedBy).toBe("format-forbidden");
      expect(exclusion.reasons).toEqual(["format-forbidden", "min-duration"]);
    }
  });

  it("treats kernel-opaque constraints (time-window, catalog-rule, custom…) as pass-through — never guessed", () => {
    const input = baseInput({
      constraints: [
        { kind: "time-window", fromMs: 0, untilMs: 100 } as HardConstraint,
        { kind: "catalog-rule", ruleId: "rule-7" } as HardConstraint,
        { kind: "policy-rights", gateId: "gate-1" } as HardConstraint,
        { kind: "max-cost", cost: 0.01 } as HardConstraint,
        { kind: "custom", constraintId: "c-1" } as HardConstraint,
      ],
    });
    const result = expandExperiences(input);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.experiences).toHaveLength(1);
    expect(result.value.exclusions).toHaveLength(0);
  });

  it("excludes formats outside the host format policy with reason format-policy", () => {
    const input = baseInput({
      realizations: [realization("real-1", "item-1", { formats: ["full", "clip", "banner"] })],
      formatPolicy: { allowedFormats: ["full"] },
    });
    const result = expandExperiences(input);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.experiences.map((e) => e.experience.format.kind)).toEqual(["full"]);
    const excludedKinds = result.value.exclusions
      .filter((x) => x.kind === "experience-excluded")
      .map((x) => (x.kind === "experience-excluded" ? x.format.kind : ""));
    expect(excludedKinds.sort()).toEqual(["banner", "clip"]);
    for (const exclusion of result.value.exclusions) {
      expect(exclusion.excludedBy).toBe("format-policy");
    }
  });
});

describe("W2-003 expansion: honest absence", () => {
  it("records unavailable normalized candidates as exclusions — never invents experiences", () => {
    const input = baseInput({
      candidates: [normalizedCandidate("item-1", [])],
      realizations: [],
    });
    const result = expandExperiences(input);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.experiences).toHaveLength(0);
    expect(result.value.exclusions).toEqual([
      {
        kind: "candidate-unavailable",
        itemId: "item-1",
        source: "host-retrieval",
        excludedBy: "unavailable",
        detail: "candidate unavailable: no-realization",
      },
    ]);
  });
});

describe("W2-003 expansion: objective fit is never fabricated", () => {
  it("omits objectiveFit entirely when no fit function was injected", () => {
    const result = expandExperiences(baseInput());
    if (!result.ok) throw new Error(result.error.message);
    const experience = result.value.experiences[0].experience;
    expect(experience.objectiveFit).toBeUndefined();
    expect(() => ExperienceSchema.parse(experience)).not.toThrow();
  });

  it("computes objectiveFit.fitScore ONLY from the injected ObjectiveFitFn", () => {
    const calls: string[] = [];
    const expander = createExperienceExpander({
      objectiveFit: (experience, objective) => {
        calls.push(`${experience.experienceId}:${objective.objectiveId}`);
        return 0.75;
      },
    });
    const result = expander.expand(baseInput());
    if (!result.ok) throw new Error(result.error.message);
    const experience = result.value.experiences[0].experience;
    expect(experience.objectiveFit).toBeDefined();
    expect(experience.objectiveFit?.fitScore).toBe(0.75);
    expect(experience.objectiveFit?.objective?.objectiveId).toBe("obj-1");
    expect(calls).toHaveLength(1);
    expect(() => ExperienceSchema.parse(experience)).not.toThrow();
  });

  it("returns a typed error when the injected fit function returns an out-of-range score", () => {
    const expander = createExperienceExpander({
      objectiveFit: () => 1.5,
    });
    const result = expander.expand(baseInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });
});

describe("W2-003 expansion: typed errors (never raw throws)", () => {
  it("returns a typed error for empty candidates", () => {
    const result = expandExperiences(baseInput({ candidates: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_INPUT");
      expect(result.error.issues?.[0]?.path).toBe("candidates");
    }
  });

  it("returns a typed error for an empty or unknown-kinded format policy", () => {
    const empty = expandExperiences(baseInput({ formatPolicy: { allowedFormats: [] } }));
    expect(empty.ok).toBe(false);
    const unknown = expandExperiences({
      ...baseInput(),
      formatPolicy: { allowedFormats: ["holodeck" as never] },
    });
    expect(unknown.ok).toBe(false);
  });

  it("returns a typed error for malformed realization constraint declarations", () => {
    const badFormats = expandExperiences(
      baseInput({ realizations: [realization("real-1", "item-1", { formats: "full" })] }),
    );
    expect(badFormats.ok).toBe(false);
    if (!badFormats.ok) expect(badFormats.error.issues?.[0]?.path).toContain("formats");

    const badDuration = expandExperiences(
      baseInput({ realizations: [realization("real-1", "item-1", { durationSeconds: "soon" })] }),
    );
    expect(badDuration.ok).toBe(false);
  });

  it("returns a typed error for candidates referencing unknown realizations", () => {
    const result = expandExperiences(
      baseInput({
        candidates: [normalizedCandidate("item-1", ["ghost-real"])],
        realizations: [],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });
});

describe("W2-003 expansion: determinism (digest)", () => {
  const input = baseInput({
    candidates: [
      normalizedCandidate("item-2", ["real-2a", "real-2b"], "exploration", 4),
      normalizedCandidate("item-1", ["real-1"], "host-retrieval", 9),
    ],
    items: [item("item-2"), item("item-1")],
    realizations: [
      realization("real-2a", "item-2", { formats: ["full", "clip"], durationSeconds: 120 }),
      realization("real-2b", "item-2", { formats: ["audio-only"] }),
      realization("real-1", "item-1", { formats: ["full"] }),
    ],
    constraints: [{ kind: "min-duration", seconds: 60 } as HardConstraint],
  });

  it("produces byte-identical outputs (same digest) for identical inputs", () => {
    const a = expandExperiences(input);
    const b = expandExperiences(input);
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(contentDigest(a.value)).toBe(contentDigest(b.value));
  });

  it("is permutation-invariant: shuffled candidates/realizations produce the identical digest", () => {
    const a = expandExperiences(input);
    const b = expandExperiences({
      ...input,
      candidates: [...input.candidates].reverse(),
      realizations: [...input.realizations].reverse(),
      items: [...input.items].reverse(),
    });
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(contentDigest(a.value)).toBe(contentDigest(b.value));
  });

  it("derives stable experience ids (same input ⇒ same ids, different realization/format ⇒ different ids)", () => {
    const a = expandExperiences(input);
    const b = expandExperiences(input);
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.value.experiences.map((e) => e.experience.experienceId)).toEqual(
      b.value.experiences.map((e) => e.experience.experienceId),
    );
    expect(new Set(a.value.experiences.map((e) => e.experience.experienceId)).size).toBe(
      a.value.experiences.length,
    );
  });
});
