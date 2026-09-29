/**
 * Default FeatureAssembler implementation (W1-004).
 *
 * Stateless and pure: no store, no clock, no side effects. Validation
 * of every input record happens HERE (real frozen zod schemas from
 * @reckon/contracts + the structural preference-snapshot check), so
 * downstream family functions receive only schema-valid data and can
 * stay trivially deterministic.
 */
import {
  CatalogItemSchema,
  ContextSnapshotSchema,
  ExperienceSchema,
  OutcomeEventSchema,
  RealizationSchema,
  contentDigest,
  type CatalogItem,
  type ContextSnapshot,
  type Experience,
  type OutcomeEvent,
  type Realization,
} from "@reckon/contracts";
import type {
  FeatureAssembler,
  FeatureInput,
  FeatureVector,
  PreferenceSnapshotInput,
} from "./port.js";
import { FEATURE_FAMILIES, type FeatureFamilyName } from "./port.js";
import {
  contextFeatures,
  experienceFeatures,
  itemFeatures,
  preferenceFeatures,
  realizationFeatures,
  temporalFeatures,
  uncertaintyFeatures,
} from "./families.js";
import {
  FeaturePreferenceSnapshotError,
  FeatureValidationError,
  toValidationIssues,
} from "./errors.js";

/** Recursively freeze a plain record tree. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

function validateRecord(
  label: string,
  index: number,
  schema: { safeParse: (input: unknown) => { success: boolean; error?: unknown } },
  input: unknown,
): void {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new FeatureValidationError(
      `${label}[${index}] failed its frozen schema`,
      toValidationIssues(result.error),
      { family: label, index }
    );
  }
}

/** Structural validation of the preference snapshot contract. */
function validatePreferenceSnapshot(preferences: PreferenceSnapshotInput): void {
  const issues: { path: string; message: string; code: string }[] = [];
  if (preferences === null || typeof preferences !== "object") {
    throw new FeaturePreferenceSnapshotError("preferences must be an object", [
      { path: "preferences", message: "must be an object", code: "invalid_type" },
    ]);
  }
  if (!Array.isArray(preferences.stable)) {
    issues.push({ path: "stable", message: "must be an array", code: "invalid_type" });
  }
  if (!Array.isArray(preferences.situational)) {
    issues.push({ path: "situational", message: "must be an array", code: "invalid_type" });
  }
  if (issues.length > 0) {
    throw new FeaturePreferenceSnapshotError("preference snapshot has an invalid shape", issues);
  }
  for (const [listName, list] of [
    ["stable", preferences.stable],
    ["situational", preferences.situational],
  ] as const) {
    for (let i = 0; i < list.length; i++) {
      const dim = list[i]!;
      if (dim === null || typeof dim !== "object") {
        issues.push({ path: `${listName}[${i}]`, message: "must be an object", code: "invalid_type" });
        continue;
      }
      if (typeof dim.dimension !== "string" || dim.dimension.length === 0) {
        issues.push({
          path: `${listName}[${i}].dimension`,
          message: "must be a non-empty string",
          code: "invalid_type",
        });
      }
      const value = dim.value;
      if (typeof value !== "number" && typeof value !== "string" && typeof value !== "boolean" && value !== null) {
        issues.push({
          path: `${listName}[${i}].value`,
          message: "must be number|string|boolean|null",
          code: "invalid_union",
        });
      }
      const confidence = dim.confidence;
      if (typeof confidence !== "number" || Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
        issues.push({
          path: `${listName}[${i}].confidence`,
          message: "must be a number in [0, 1]",
          code: "too_big_or_small",
        });
      }
    }
  }
  if (issues.length > 0) {
    throw new FeaturePreferenceSnapshotError("preference snapshot dimension(s) invalid", issues);
  }
}

/**
 * Create the default (pure, deterministic) FeatureAssembler.
 *
 * ```ts
 * const assembler = createFeatureAssembler();
 * const vector = assembler.assemble(input);
 * ```
 */
export function createFeatureAssembler(): FeatureAssembler {
  return {
    assemble(input: FeatureInput): FeatureVector {
      // 1. Validate every input record against its frozen schema.
      validateRecord("contextSnapshot", 0, ContextSnapshotSchema, input.contextSnapshot);
      input.items.forEach((item, index) =>
        validateRecord("item", index, CatalogItemSchema, item)
      );
      (input.realizations ?? []).forEach((realization: Realization, index: number) =>
        validateRecord("realization", index, RealizationSchema, realization)
      );
      (input.experiences ?? []).forEach((experience: Experience, index: number) =>
        validateRecord("experience", index, ExperienceSchema, experience)
      );
      (input.recentEvents ?? []).forEach((event: OutcomeEvent, index: number) =>
        validateRecord("recentEvent", index, OutcomeEventSchema, event)
      );
      if (input.preferences !== undefined) {
        validatePreferenceSnapshot(input.preferences);
      }

      // 2. Parse to canonical frozen copies (defensive: caller-side
      //    mutation after assemble can never reach the vector's inputs).
      const contextSnapshot: ContextSnapshot = ContextSnapshotSchema.parse(input.contextSnapshot);
      const items: CatalogItem[] = input.items.map((item) => CatalogItemSchema.parse(item));
      const realizations: Realization[] | undefined = input.realizations?.map((r) =>
        RealizationSchema.parse(r)
      );
      const experiences: Experience[] | undefined = input.experiences?.map((e) =>
        ExperienceSchema.parse(e)
      );
      const recentEvents: OutcomeEvent[] | undefined = input.recentEvents?.map((event) =>
        OutcomeEventSchema.parse(event)
      );

      // 3. Assemble the families in the fixed order.
      const results = {
        item: itemFeatures(items),
        realization: realizationFeatures(realizations ?? []),
        experience: experienceFeatures(experiences ?? []),
        preference: preferenceFeatures(input.preferences),
        context: contextFeatures(contextSnapshot),
        temporal: temporalFeatures(recentEvents, input.at),
        uncertainty: uncertaintyFeatures(input.preferences),
      };
      const families: Record<FeatureFamilyName, number[]> = Object.freeze({
        item: results.item.values,
        realization: results.realization.values,
        experience: results.experience.values,
        preference: results.preference.values,
        context: results.context.values,
        temporal: results.temporal.values,
        uncertainty: results.uncertainty.values,
      });
      const names: Record<FeatureFamilyName, string[]> = Object.freeze({
        item: results.item.names,
        realization: results.realization.names,
        experience: results.experience.names,
        preference: results.preference.names,
        context: results.context.names,
        temporal: results.temporal.names,
        uncertainty: results.uncertainty.names,
      });

      // 4. Integrity: values/names stay parallel per family.
      for (const family of FEATURE_FAMILIES) {
        if (families[family].length !== names[family].length) {
          throw new FeatureValidationError(
            `family ${family} produced misaligned values/names`,
            [{ path: family, message: "values.length !== names.length", code: "alignment" }],
            { family }
          );
        }
      }

      // 5. Deterministic digest over the semantic content of the vector.
      const digest = contentDigest({
        subject: input.subject,
        tenant: input.tenant,
        at: input.at,
        families,
        names,
      });

      const vector: FeatureVector = {
        subject: input.subject,
        tenant: input.tenant,
        at: input.at,
        families: deepFreeze(families),
        names: deepFreeze(names),
        digest,
      };
      return deepFreeze(vector);
    },
  };
}
