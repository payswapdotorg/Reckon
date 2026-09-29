/**
 * W2-003 — Experience expansion/resolution.
 *
 * Frozen architecture §6 (candidate/experience separation):
 * `candidate items → experience expansion → policy → schedule`. This
 * module turns NORMALIZED candidates (W2-001 output) plus host-declared
 * catalog/realization truth into complete, schema-valid `Experience`
 * variants (base format + realization-declared variants).
 *
 * Laws enforced here:
 * - Every emitted variant is a COMPLETE `Experience` per the frozen
 *   schema (validated with `ExperienceSchema`).
 * - CONSTRAINT/REWARD SEPARATION (lock #21): hard constraints gate
 *   eligibility and are reported as exclusion records with reason codes
 *   (`excludedBy`); they never influence reward/fit.
 * - Objective fit (`objectiveFit.fitScore`) is computed ONLY when an
 *   explicit fit function was injected (`ObjectiveFitFn` port) —
 *   otherwise it is absent. NEVER fabricated.
 * - Determinism: same inputs ⇒ byte-identical outputs; canonical
 *   ordering and digest-based experience ids make the output
 *   permutation-invariant.
 * - No LLM anywhere on this path (NO-LLM LAW).
 *
 * Documented interpretation of the opaque host fields:
 * - `realization.constraints.formats`: array of FORMAT_KINDS this
 *   realization can deliver. The FIRST entry is the base format; the
 *   rest are variants. Absent/empty ⇒ base format "full".
 * - `realization.constraints.durationSeconds`: number — estimated
 *   duration of the experience.
 * - `realization.constraints.deviceClasses` / `requiresScreen` /
 *   `requiresAudio` / `minBandwidth`: experience requirements.
 * - `realization.constraints.formatParams`: record keyed by format kind
 *   → format params (opaque passthrough).
 * - `catalogItem.availableFrom` / `availableUntil` → experience
 *   `timing.earliestMs` / `timing.latestMs`.
 *
 * Constraint evaluation policy (documented, fail-closed for hard gates):
 * - Evaluated here: min-duration, max-duration, format-required,
 *   format-forbidden, locale-required, device-class-required.
 * - An UNDECLARED value fails a hard gate that needs it (e.g. an
 *   experience without a declared duration cannot prove compliance with
 *   min-duration/max-duration — hard constraints gate eligibility, so
 *   unverifiable = excluded, never guessed).
 * - NOT evaluated here (opaque to this kernel / request-scoped):
 *   time-window, max-cost, max-latency, catalog-rule, policy-rights,
 *   custom. They pass through without exclusion — the policy engine
 *   (W2-002) and the host evaluate them.
 */
import {
  CatalogItemSchema,
  contentDigest,
  ExperienceSchema,
  FORMAT_KINDS,
  ObjectiveSchema,
  RealizationSchema,
  type CatalogItem,
  type Experience,
  type FormatDescriptor,
  type HardConstraint,
  type Id,
  type Objective,
  type Realization,
} from "@reckon/contracts";
// Type-only cross-package import (W2-003 depends on W2-001 per the
// dependency graph). Erased at runtime; no package.json/lockfile change
// (the frozen lockfile forbids new dependency entries).
import type { NormalizedCandidate } from "../../decision/src/index.js";
import type { Result } from "./errors.js";
import { invalidInput } from "./errors.js";

export type FormatKind = (typeof FORMAT_KINDS)[number];

const FORMAT_KIND_SET: ReadonlySet<string> = new Set(FORMAT_KINDS);

/** Host format policy: only these format kinds may be expanded. */
export interface FormatPolicy {
  allowedFormats: readonly FormatKind[];
}

export interface ExpandInput {
  /** Normalized candidates (W2-001 output). */
  candidates: NormalizedCandidate[];
  items: CatalogItem[];
  realizations: Realization[];
  formatPolicy: FormatPolicy;
  objective: Objective;
  /** Hard constraints gating eligibility (separate from reward). */
  constraints: HardConstraint[];
}

/**
 * Injected objective-fit port. MUST be pure (same inputs ⇒ same score)
 * and return a finite score in [0, 1]. Supplied by the host/policy
 * layer; the expander never invents fit scores.
 */
export type ObjectiveFitFn = (experience: Experience, objective: Objective) => number;

/** An emitted experience with retrieval provenance. */
export interface ExpandedExperience {
  experience: Experience;
  /** All candidate sources that proposed this item (sorted, deduped). */
  sources: string[];
  rankHint?: number;
  scoreHint?: number;
}

/** A normalized candidate that could not expand (honest absence). */
export interface CandidateExclusion {
  kind: "candidate-unavailable";
  itemId: Id;
  source: string;
  excludedBy: "unavailable";
  detail: string;
}

/** A concrete (item, realization, format) variant excluded by a gate. */
export interface ExperienceExclusion {
  kind: "experience-excluded";
  itemId: Id;
  realizationId: Id;
  format: FormatDescriptor;
  /** First failing gate (deterministic: format policy, then input
   *  constraint order). */
  excludedBy: string;
  /** All failing gate codes in deterministic order. */
  reasons: string[];
  detail: string;
}

export type ExclusionRecord = CandidateExclusion | ExperienceExclusion;

export interface ExpansionOutput {
  experiences: ExpandedExperience[];
  exclusions: ExclusionRecord[];
}

export type ExpandResult = Result<ExpansionOutput>;

/** The experience-expansion port (W2-003). Pure, total, deterministic. */
export interface ExperienceExpander {
  expand(input: ExpandInput): ExpandResult;
}

interface Emitted {
  experience: Experience;
  sources: Set<string>;
  rankHint?: number;
  scoreHint?: number;
}

function mergeMax(existing: number | undefined, incoming: number | undefined): number | undefined {
  if (existing === undefined) return incoming;
  if (incoming === undefined) return existing;
  return existing >= incoming ? existing : incoming;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Duration in seconds for constraint evaluation. ISO-8601 duration
 *  strings are NOT parsed by this kernel (honest: undeclared ⇒ the
 *  duration-dependent gates fail closed). */
function durationSeconds(experience: Experience): number | undefined {
  const d = experience.duration;
  if (d === undefined) return undefined;
  if (typeof d === "number") return Number.isFinite(d) && d >= 0 ? d : undefined;
  return undefined; // ISO-8601 string — not interpreted (documented)
}

interface GateFailure {
  code: string;
  message: string;
}

/** Evaluate the constraint kinds this kernel owns. Fail-closed on
 *  undeclared values; opaque kinds pass through (documented). */
function evaluateGates(experience: Experience, constraints: HardConstraint[]): GateFailure[] {
  const failures: GateFailure[] = [];
  for (const constraint of constraints) {
    switch (constraint.kind) {
      case "min-duration": {
        const duration = durationSeconds(experience);
        if (duration === undefined || duration < constraint.seconds) {
          failures.push({
            code: "min-duration",
            message:
              duration === undefined
                ? `duration undeclared; cannot verify min-duration ${constraint.seconds}s`
                : `duration ${duration}s < min-duration ${constraint.seconds}s`,
          });
        }
        break;
      }
      case "max-duration": {
        const duration = durationSeconds(experience);
        if (duration === undefined || duration > constraint.seconds) {
          failures.push({
            code: "max-duration",
            message:
              duration === undefined
                ? `duration undeclared; cannot verify max-duration ${constraint.seconds}s`
                : `duration ${duration}s > max-duration ${constraint.seconds}s`,
          });
        }
        break;
      }
      case "format-required": {
        const matches =
          experience.format.kind === constraint.format ||
          experience.format.customKind === constraint.format;
        if (!matches) {
          failures.push({
            code: "format-required",
            message: `format ${experience.format.kind} != required ${constraint.format}`,
          });
        }
        break;
      }
      case "format-forbidden": {
        const matches =
          experience.format.kind === constraint.format ||
          experience.format.customKind === constraint.format;
        if (matches) {
          failures.push({
            code: "format-forbidden",
            message: `format ${experience.format.kind} is forbidden`,
          });
        }
        break;
      }
      case "locale-required": {
        if (experience.locale !== constraint.locale) {
          failures.push({
            code: "locale-required",
            message: `locale ${experience.locale ?? "undeclared"} != required ${constraint.locale}`,
          });
        }
        break;
      }
      case "device-class-required": {
        const classes = experience.requirements?.deviceClass ?? [];
        if (!classes.includes(constraint.deviceClass)) {
          failures.push({
            code: "device-class-required",
            message: `device classes [${classes.join(", ")}] do not include ${constraint.deviceClass}`,
          });
        }
        break;
      }
      default:
        // time-window, max-cost, max-latency, catalog-rule,
        // policy-rights, custom — opaque/request-scoped: pass through.
        break;
    }
  }
  return failures;
}

/** Deterministic, collision-safe experience id for a
 *  (realization, format) pair. */
function experienceIdFor(realizationId: string, format: FormatDescriptor): string {
  const digest = contentDigest({
    realizationId,
    kind: format.kind,
    customKind: format.customKind ?? null,
  });
  return `exp-${digest.slice(0, 24)}`;
}

interface RealizationInterpretation {
  formats: FormatKind[];
  durationSeconds?: number;
  deviceClasses?: string[];
  requiresScreen?: boolean;
  requiresAudio?: boolean;
  minBandwidth?: "low" | "medium" | "high";
  formatParams: Record<string, unknown>;
}

/** Interpret the host-supplied realization constraints (documented
 *  vocabulary). Malformed declarations are typed errors — never
 *  guessed, never silently coerced. */
function interpretRealization(
  realization: Realization,
  path: string,
  issues: { path: string; message: string }[],
): RealizationInterpretation {
  const c = realization.constraints ?? {};
  const out: RealizationInterpretation = { formats: ["full"], formatParams: {} };

  const rawFormats = c["formats"];
  if (rawFormats !== undefined) {
    if (!Array.isArray(rawFormats) || rawFormats.some((f) => typeof f !== "string" || !FORMAT_KIND_SET.has(f))) {
      issues.push({
        path: `${path}.constraints.formats`,
        message: "must be an array of FORMAT_KINDS strings",
      });
    } else {
      const deduped: string[] = [];
      for (const f of rawFormats) {
        if (!deduped.includes(f)) deduped.push(f);
      }
      out.formats = deduped.length > 0 ? (deduped as FormatKind[]) : ["full"];
    }
  }

  const rawDuration = c["durationSeconds"];
  if (rawDuration !== undefined) {
    if (!isFiniteNumber(rawDuration) || rawDuration < 0) {
      issues.push({ path: `${path}.constraints.durationSeconds`, message: "must be a finite non-negative number" });
    } else {
      out.durationSeconds = rawDuration;
    }
  }

  const rawDevices = c["deviceClasses"];
  if (rawDevices !== undefined) {
    if (
      !Array.isArray(rawDevices) ||
      rawDevices.some((d) => typeof d !== "string" || d.length < 1 || d.length > 32)
    ) {
      issues.push({ path: `${path}.constraints.deviceClasses`, message: "must be an array of device-class strings" });
    } else {
      out.deviceClasses = Array.from(new Set(rawDevices));
    }
  }

  const rawScreen = c["requiresScreen"];
  if (rawScreen !== undefined) {
    if (typeof rawScreen !== "boolean") {
      issues.push({ path: `${path}.constraints.requiresScreen`, message: "must be boolean" });
    } else {
      out.requiresScreen = rawScreen;
    }
  }

  const rawAudio = c["requiresAudio"];
  if (rawAudio !== undefined) {
    if (typeof rawAudio !== "boolean") {
      issues.push({ path: `${path}.constraints.requiresAudio`, message: "must be boolean" });
    } else {
      out.requiresAudio = rawAudio;
    }
  }

  const rawBandwidth = c["minBandwidth"];
  if (rawBandwidth !== undefined) {
    if (rawBandwidth !== "low" && rawBandwidth !== "medium" && rawBandwidth !== "high") {
      issues.push({ path: `${path}.constraints.minBandwidth`, message: "must be low | medium | high" });
    } else {
      out.minBandwidth = rawBandwidth;
    }
  }

  const rawParams = c["formatParams"];
  if (rawParams !== undefined) {
    if (rawParams === null || typeof rawParams !== "object" || Array.isArray(rawParams)) {
      issues.push({ path: `${path}.constraints.formatParams`, message: "must be an object keyed by format kind" });
    } else {
      out.formatParams = rawParams as Record<string, unknown>;
    }
  }

  return out;
}

/** Light structural validation of normalized candidates (kernel types,
 *  not zod schemas — the W2-001 normalizer is the upstream authority). */
function validateNormalizedCandidates(
  candidates: unknown,
  issues: { path: string; message: string }[],
): asserts candidates is NormalizedCandidate[] {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    issues.push({ path: "candidates", message: "must be a non-empty array of normalized candidates" });
    return;
  }
  candidates.forEach((candidate, index) => {
    const path = `candidates[${index}]`;
    if (candidate === null || typeof candidate !== "object") {
      issues.push({ path, message: "must be an object" });
      return;
    }
    const c = candidate as Record<string, unknown>;
    if (typeof c["itemId"] !== "string" || c["itemId"].length < 1) {
      issues.push({ path: `${path}.itemId`, message: "must be a non-empty string" });
    }
    if (typeof c["source"] !== "string" || c["source"].length < 1) {
      issues.push({ path: `${path}.source`, message: "must be a non-empty string" });
    }
    if (!Array.isArray(c["realizationIds"]) || c["realizationIds"].some((r) => typeof r !== "string")) {
      issues.push({ path: `${path}.realizationIds`, message: "must be an array of ids" });
    }
    if (!Array.isArray(c["labels"]) || c["labels"].some((l) => typeof l !== "string")) {
      issues.push({ path: `${path}.labels`, message: "must be an array of strings" });
    }
    const availability = c["availability"];
    if (
      availability === null ||
      typeof availability !== "object" ||
      typeof (availability as Record<string, unknown>)["available"] !== "boolean"
    ) {
      issues.push({ path: `${path}.availability`, message: "must be { available: boolean }" });
    }
    for (const hint of ["rankHint", "scoreHint"] as const) {
      const value = c[hint];
      if (value !== undefined && !isFiniteNumber(value)) {
        issues.push({ path: `${path}.${hint}`, message: "must be a finite number when present" });
      }
    }
  });
}

function compareExperiences(a: ExpandedExperience, b: ExpandedExperience): number {
  const rankA = a.rankHint ?? Number.NEGATIVE_INFINITY;
  const rankB = b.rankHint ?? Number.NEGATIVE_INFINITY;
  if (rankA !== rankB) return rankB - rankA;
  const idA = a.experience.experienceId;
  const idB = b.experience.experienceId;
  if (idA !== idB) return idA < idB ? -1 : 1;
  return 0;
}

function compareExclusions(a: ExclusionRecord, b: ExclusionRecord): number {
  const keyOf = (x: ExclusionRecord): string[] =>
    x.kind === "candidate-unavailable"
      ? [x.kind, x.itemId, x.source, ""]
      : [x.kind, x.itemId, x.realizationId, x.format.kind];
  const ka = keyOf(a);
  const kb = keyOf(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Pure, total, deterministic experience expansion (the W2-003 kernel).
 * `deps.objectiveFit` is the injected ObjectiveFitFn port — when absent,
 * `objectiveFit` is omitted from every experience (never fabricated).
 */
export function expandExperiences(
  input: ExpandInput,
  deps: { objectiveFit?: ObjectiveFitFn } = {},
): ExpandResult {
  if (input === null || typeof input !== "object") {
    return invalidInput("expand: input must be an object");
  }
  const issues: { path: string; message: string }[] = [];

  validateNormalizedCandidates(input.candidates, issues);

  const parsedItems = CatalogItemSchema.array().safeParse(input.items ?? []);
  if (!parsedItems.success) {
    issues.push(
      ...parsedItems.error.issues.map((i) => ({ path: `items.${i.path.join(".")}`, message: i.message })),
    );
  }
  const parsedRealizations = RealizationSchema.array().safeParse(input.realizations ?? []);
  if (!parsedRealizations.success) {
    issues.push(
      ...parsedRealizations.error.issues.map((i) => ({
        path: `realizations.${i.path.join(".")}`,
        message: i.message,
      })),
    );
  }
  const parsedObjective = ObjectiveSchema.safeParse(input.objective);
  if (!parsedObjective.success) {
    issues.push(
      ...parsedObjective.error.issues.map((i) => ({ path: `objective.${i.path.join(".")}`, message: i.message })),
    );
  }
  if (input.constraints !== undefined && !Array.isArray(input.constraints)) {
    issues.push({ path: "constraints", message: "must be an array of hard constraints" });
  }

  // Format policy: non-empty allowlist of known format kinds.
  const allowed = input.formatPolicy?.allowedFormats;
  if (
    !Array.isArray(allowed) ||
    allowed.length === 0 ||
    allowed.some((f) => typeof f !== "string" || !FORMAT_KIND_SET.has(f))
  ) {
    issues.push({
      path: "formatPolicy.allowedFormats",
      message: "must be a non-empty array of FORMAT_KINDS",
    });
  }

  if (issues.length > 0) {
    return invalidInput("expand: invalid input", issues);
  }

  // Issues are empty here, so every parse below succeeded; the ternary
  // fallbacks exist only to satisfy control-flow narrowing.
  const items = parsedItems.success ? parsedItems.data : [];
  const realizations = parsedRealizations.success ? parsedRealizations.data : [];
  const objective = parsedObjective.success ? parsedObjective.data : (undefined as never);
  const constraints = (input.constraints ?? []) as HardConstraint[];
  const allowedFormats: ReadonlySet<string> = new Set(allowed as FormatKind[]);

  // Host truth indexes (first occurrence wins — deterministic).
  const itemsById = new Map<string, CatalogItem>();
  for (const it of items) {
    if (!itemsById.has(it.itemId)) itemsById.set(it.itemId, it);
  }
  const realizationsById = new Map<string, Realization>();
  for (const r of realizations) {
    if (!realizationsById.has(r.realizationId)) realizationsById.set(r.realizationId, r);
  }

  // Interpret every realization once (malformed declarations already
  // surfaced as typed errors above).
  const interpretationIssues: { path: string; message: string }[] = [];
  const interpretedById = new Map<string, RealizationInterpretation>();
  for (const r of realizations) {
    interpretedById.set(r.realizationId, interpretRealization(r, `realizations.${r.realizationId}`, interpretationIssues));
  }
  if (interpretationIssues.length > 0) {
    return invalidInput("expand: invalid realization constraints", interpretationIssues);
  }

  const emitted = new Map<string, Emitted>();
  const exclusions: ExclusionRecord[] = [];

  for (const candidate of input.candidates) {
    if (!candidate.availability.available) {
      // Honest absence: the normalizer said this candidate has no host
      // capability truth — record it, never invent experiences.
      exclusions.push({
        kind: "candidate-unavailable",
        itemId: candidate.itemId,
        source: candidate.source,
        excludedBy: "unavailable",
        detail: `candidate unavailable: ${candidate.availability.reason ?? "unknown"}`,
      });
      continue;
    }

    for (const realizationId of candidate.realizationIds) {
      const realization = realizationsById.get(realizationId);
      if (!realization) {
        // Normalized candidates reference realizations present in the
        // input (W2-001 contract); a dangling reference is malformed.
        return invalidInput(`expand: candidate references unknown realization ${realizationId}`);
      }
      const item = itemsById.get(candidate.itemId);
      if (!item) {
        return invalidInput(`expand: candidate references unknown item ${candidate.itemId}`);
      }
      const interpretation = interpretedById.get(realizationId);
      if (!interpretation) {
        return invalidInput(`expand: realization ${realizationId} not interpreted`);
      }

      const formats: FormatDescriptor[] = interpretation.formats.map((kind) => ({
        kind,
        params: (interpretation.formatParams[kind] as Record<string, unknown> | undefined) ?? {},
      }));

      for (const format of formats) {
        // Gate 1: host format policy.
        if (!allowedFormats.has(format.kind)) {
          exclusions.push({
            kind: "experience-excluded",
            itemId: candidate.itemId,
            realizationId,
            format,
            excludedBy: "format-policy",
            reasons: ["format-policy"],
            detail: `format ${format.kind} not in allowed formats`,
          });
          continue;
        }

        // Construct the complete draft experience.
        const draft: Record<string, unknown> = {
          experienceId: experienceIdFor(realizationId, format),
          itemId: candidate.itemId,
          realizationId,
          format,
        };
        if (realization.locale !== undefined) draft["locale"] = realization.locale;
        if (interpretation.durationSeconds !== undefined) {
          draft["duration"] = interpretation.durationSeconds;
        }
        if (item.availableFrom !== undefined || item.availableUntil !== undefined) {
          const timing: Record<string, unknown> = {};
          if (item.availableFrom !== undefined) timing["earliestMs"] = item.availableFrom;
          if (item.availableUntil !== undefined) timing["latestMs"] = item.availableUntil;
          draft["timing"] = timing;
        }
        if (
          interpretation.deviceClasses !== undefined ||
          interpretation.requiresScreen !== undefined ||
          interpretation.requiresAudio !== undefined ||
          interpretation.minBandwidth !== undefined
        ) {
          const requirements: Record<string, unknown> = {
            deviceClass: interpretation.deviceClasses ?? [],
          };
          if (interpretation.requiresScreen !== undefined) {
            requirements["requiresScreen"] = interpretation.requiresScreen;
          }
          if (interpretation.requiresAudio !== undefined) {
            requirements["requiresAudio"] = interpretation.requiresAudio;
          }
          if (interpretation.minBandwidth !== undefined) {
            requirements["minBandwidth"] = interpretation.minBandwidth;
          }
          draft["requirements"] = requirements;
        }

        // Schema-validate the draft — emitted experiences are complete
        // `Experience` records by construction.
        const parsed = ExperienceSchema.safeParse(draft);
        if (!parsed.success) {
          return invalidInput(
            `expand: constructed experience failed schema validation (${realizationId}/${format.kind})`,
            parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          );
        }
        const base: Experience = parsed.data;

        // Gate 2: hard constraints (separate from reward).
        const failures = evaluateGates(base, constraints);
        if (failures.length > 0) {
          exclusions.push({
            kind: "experience-excluded",
            itemId: candidate.itemId,
            realizationId,
            format,
            excludedBy: failures[0].code,
            reasons: failures.map((f) => f.code),
            detail: failures.map((f) => `${f.code}: ${f.message}`).join("; "),
          });
          continue;
        }

        // Objective fit: ONLY from the injected port (never fabricated).
        let experience: Experience = base;
        if (deps.objectiveFit) {
          const fitScore = deps.objectiveFit(base, objective);
          if (!isFiniteNumber(fitScore) || fitScore < 0 || fitScore > 1) {
            return invalidInput(
              `expand: objective fit function returned ${String(fitScore)} for ${base.experienceId}; expected finite [0, 1]`,
            );
          }
          experience = {
            ...base,
            objectiveFit: { objective, fitScore, notes: [] },
          };
        }

        // Dedup by experienceId across candidates (same item+realization
        // proposed by several sources emits ONE experience).
        const existing = emitted.get(base.experienceId);
        if (existing) {
          existing.sources.add(candidate.source);
          const rankHint = mergeMax(existing.rankHint, candidate.rankHint);
          const scoreHint = mergeMax(existing.scoreHint, candidate.scoreHint);
          if (rankHint !== undefined) existing.rankHint = rankHint;
          if (scoreHint !== undefined) existing.scoreHint = scoreHint;
        } else {
          emitted.set(base.experienceId, {
            experience,
            sources: new Set([candidate.source]),
            rankHint: candidate.rankHint,
            scoreHint: candidate.scoreHint,
          });
        }
      }
    }
  }

  const experiences: ExpandedExperience[] = Array.from(emitted.values()).map((e) => {
    const out: ExpandedExperience = {
      experience: e.experience,
      sources: Array.from(e.sources).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)),
    };
    if (e.rankHint !== undefined) out.rankHint = e.rankHint;
    if (e.scoreHint !== undefined) out.scoreHint = e.scoreHint;
    return out;
  });
  experiences.sort(compareExperiences);
  exclusions.sort(compareExclusions);

  return { ok: true, value: { experiences, exclusions } };
}

/** Factory for the expander port. `deps.objectiveFit` is the injected
 *  ObjectiveFitFn; omit it to get experiences without fit scores. */
export function createExperienceExpander(
  deps: { objectiveFit?: ObjectiveFitFn } = {},
): ExperienceExpander {
  return { expand: (input: ExpandInput) => expandExperiences(input, deps) };
}
