/**
 * Decision workspace view helpers (UI-004).
 *
 * Pure, dependency-free, React-free presentation derivation for the
 * Decisions workspace. Types come from the frozen public surface only —
 * `@reckon/sdk` (which re-exports the contract types) plus `@reckon/contracts`
 * TYPE imports for the shapes the SDK does not re-export.
 *
 * HONESTY LAWS (Gate Q / "no fake confidence"):
 *  - values are FORMATTED, never computed, never invented;
 *  - numbers render exactly as the contract returned them (String(n));
 *  - absent contract fields stay absent — callers render "not provided";
 *  - no decision/policy/evaluation logic is reimplemented here: the
 *    scheduler kernel decides; this module only labels what it returned.
 */
import type { ScheduleAction } from "@reckon/sdk";
import type {
  AlternativeSummary,
  Duration,
  HardConstraint,
  Uncertainty,
} from "@reckon/contracts";

/* ------------------------------------------------------------------ *
 * Request param normalization                                          *
 * ------------------------------------------------------------------ */

/**
 * Normalize the `?id=` search param into a single decision id, or
 * `undefined` when none was requested. Duplicate params take the first
 * value (browsers never emit duplicates from this form).
 */
export function normalizeDecisionIdParam(
  raw: string | string[] | undefined,
): string | undefined {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== "string") {
    return undefined;
  }
  const trimmed = first.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/* ------------------------------------------------------------------ *
 * Exact-value formatting                                               *
 * ------------------------------------------------------------------ */

/** Render an epoch-ms timestamp as an unambiguous ISO-8601 UTC string. */
export function formatEpochMs(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Format a number EXACTLY as the contract returned it — no rounding, no
 * percentage invention, no unit re-interpretation. `String(n)` is the
 * faithful minimal representation of a wire number.
 */
export function formatExactNumber(value: number): string {
  return String(value);
}

/** Render an opaque contract value without inventing structure. */
export function stringifyOpaque(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  const json = JSON.stringify(value);
  return json === undefined ? String(value) : json;
}

/** Flatten an opaque record into displayable key/value chips. */
export function opaqueEntries(
  record: Record<string, unknown> | undefined,
): { key: string; value: string }[] {
  if (record === undefined) {
    return [];
  }
  return Object.entries(record).map(([key, value]) => ({
    key,
    value: stringifyOpaque(value),
  }));
}

/* ------------------------------------------------------------------ *
 * Duration                                                             *
 * ------------------------------------------------------------------ */

const ISO_DURATION =
  /^P(?!$)(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)D)?(?:T(?!$)(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/**
 * Format a contract `Duration` (whole seconds OR an ISO-8601 duration
 * string) into compact human units WITHOUT rounding away precision —
 * `PT4M13S` → "4m 13s", `212` → "3m 32s", `12.5` → "12.5s". Anything the
 * parser cannot read renders as the raw contract string (never invented).
 */
export function formatDurationValue(duration: Duration): string {
  if (typeof duration === "number") {
    return formatSecondsExact(duration);
  }
  const match = ISO_DURATION.exec(duration);
  if (match === null) {
    return duration;
  }
  const [years, months, days, hours, minutes, seconds] = match
    .slice(1)
    .map((group) => (group === undefined ? undefined : Number(group)));
  const parts: string[] = [];
  if (years !== undefined) {
    parts.push(`${trimNumber(years)}y`);
  }
  if (months !== undefined) {
    parts.push(`${trimNumber(months)}mo`);
  }
  if (days !== undefined) {
    parts.push(`${trimNumber(days)}d`);
  }
  if (hours !== undefined) {
    parts.push(`${trimNumber(hours)}h`);
  }
  if (minutes !== undefined) {
    parts.push(`${trimNumber(minutes)}m`);
  }
  if (seconds !== undefined) {
    parts.push(`${trimNumber(seconds)}s`);
  }
  return parts.length > 0 ? parts.join(" ") : duration;
}

function formatSecondsExact(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return String(totalSeconds);
  }
  if (totalSeconds < 60) {
    return `${trimNumber(totalSeconds)}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - totalMinutes * 60;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes - hours * 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (seconds > 0) {
    parts.push(`${trimNumber(seconds)}s`);
  }
  return parts.length > 0 ? parts.join(" ") : `${trimNumber(totalSeconds)}s`;
}

/** Drop trailing ".0" noise the contract never carried. */
function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

/* ------------------------------------------------------------------ *
 * Scheduler action vocabulary (labels only — the kernel decides)      *
 * ------------------------------------------------------------------ */

/**
 * Plain-language meaning of each scheduler action, phrased from the
 * frozen contract's own semantics (SCHEDULE_ACTIONS in
 * @reckon/contracts/decision). Presentation copy, not decision logic.
 */
export const ACTION_COPY: Readonly<Record<ScheduleAction, string>> = {
  HOLD: "hold — do nothing new right now; the current state stands.",
  CONTINUE: "continue — keep going with the current experience.",
  QUEUE: "queue — add the selected experience to the queue for later.",
  SUGGEST: "suggest — offer the selected experience without interrupting.",
  SWITCH: "switch — replace the current experience with the selected one.",
  INTERRUPT: "interrupt — stop the current experience; a resume checkpoint may be kept.",
  RESUME: "resume — return the subject to their interrupted experience.",
  END: "end — the plan is over; no further actions.",
};

/**
 * What `selectedExperience` means under each action (the scheduler
 * populates it differently per action — see the frozen decision-result
 * contract: it is optional, and absent means "this action selects
 * nothing").
 */
export function selectedExperienceRole(action: ScheduleAction): {
  heading: string;
  note: string;
} {
  switch (action) {
    case "HOLD":
      return {
        heading: "No experience selected",
        note: "HOLD selects nothing — the decision leaves the current state untouched.",
      };
    case "CONTINUE":
      return {
        heading: "Current experience",
        note: "What the subject is experiencing right now — this decision keeps it going.",
      };
    case "QUEUE":
      return {
        heading: "Queued experience",
        note: "The selected experience is queued for upcoming presentation.",
      };
    case "SUGGEST":
      return {
        heading: "Suggested experience",
        note: "Suggested, non-binding — the subject is not interrupted.",
      };
    case "SWITCH":
      return {
        heading: "Switch target",
        note: "The decision switches the subject to this experience.",
      };
    case "INTERRUPT":
      return {
        heading: "Interrupted experience",
        note: "The experience being interrupted — a resume checkpoint may follow.",
      };
    case "RESUME":
      return {
        heading: "Resumed experience",
        note: "The subject returns to this experience from its checkpoint.",
      };
    case "END":
      return {
        heading: "No experience selected",
        note: "END terminates the plan; no experience is selected.",
      };
  }
}

/* ------------------------------------------------------------------ *
 * Uncertainty (as returned — never computed)                          *
 * ------------------------------------------------------------------ */

export interface UncertaintyEntry {
  readonly field: "confidence" | "spread" | "disagreement" | "oodScore" | "method";
  readonly label: string;
  /** Exact value as returned; undefined = the record did not carry it. */
  readonly value: string | undefined;
}

/**
 * Flatten a contract `Uncertainty` into display entries. Every field is
 * OPTIONAL in the frozen contract: absent stays absent — the workspace
 * renders "not provided", never a derived or inferred value.
 */
export function uncertaintyEntries(uncertainty: Uncertainty): UncertaintyEntry[] {
  return [
    {
      field: "confidence",
      label: "confidence",
      value:
        uncertainty.confidence === undefined
          ? undefined
          : formatExactNumber(uncertainty.confidence),
    },
    {
      field: "spread",
      label: "spread",
      value:
        uncertainty.spread === undefined ? undefined : formatExactNumber(uncertainty.spread),
    },
    {
      field: "disagreement",
      label: "disagreement",
      value:
        uncertainty.disagreement === undefined
          ? undefined
          : formatExactNumber(uncertainty.disagreement),
    },
    {
      field: "oodScore",
      label: "ood score",
      value:
        uncertainty.oodScore === undefined
          ? undefined
          : formatExactNumber(uncertainty.oodScore),
    },
    {
      field: "method",
      label: "method",
      value: uncertainty.method,
    },
  ];
}

/** Compact one-line summary of the fields an alternative's uncertainty carries. */
export function uncertaintySummary(uncertainty: Uncertainty): string | undefined {
  const parts = uncertaintyEntries(uncertainty)
    .filter((entry): entry is UncertaintyEntry & { value: string } => entry.value !== undefined)
    .map((entry) => `${entry.label} ${entry.value}`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/* ------------------------------------------------------------------ *
 * Alternatives                                                         *
 * ------------------------------------------------------------------ */

export interface AlternativeView {
  readonly alternative: AlternativeSummary;
  /** True when the record names the gate that excluded this alternative. */
  readonly excluded: boolean;
}

/**
 * Partition alternatives by the contract's own signal: `excludedBy` names
 * the constraint/gate that filtered the experience. Alternatives without
 * it were considered by the deciding policy.
 */
export function partitionAlternatives(
  alternatives: readonly AlternativeSummary[],
): { considered: AlternativeView[]; filtered: AlternativeView[] } {
  const considered: AlternativeView[] = [];
  const filtered: AlternativeView[] = [];
  for (const alternative of alternatives) {
    const view: AlternativeView = {
      alternative,
      excluded: alternative.excludedBy !== undefined,
    };
    if (view.excluded) {
      filtered.push(view);
    } else {
      considered.push(view);
    }
  }
  return { considered, filtered };
}

/* ------------------------------------------------------------------ *
 * Hard constraints (labels for what the record declares)              *
 * ------------------------------------------------------------------ */

/**
 * Render one hard constraint as a label + detail, reading ONLY its own
 * declared fields. The constraint kernel evaluates these; this view
 * never judges pass/fail.
 */
export function constraintView(constraint: HardConstraint): {
  label: string;
  detail: string;
} {
  switch (constraint.kind) {
    case "time-window": {
      const from = constraint.fromMs === undefined ? "…" : formatEpochMs(constraint.fromMs);
      const until = constraint.untilMs === undefined ? "…" : formatEpochMs(constraint.untilMs);
      return { label: "time window", detail: `${from} → ${until}` };
    }
    case "min-duration":
      return {
        label: "min duration",
        detail: `≥ ${formatDurationValue(constraint.seconds)}`,
      };
    case "max-duration":
      return {
        label: "max duration",
        detail: `≤ ${formatDurationValue(constraint.seconds)}`,
      };
    case "format-required":
      return { label: "format required", detail: constraint.format };
    case "format-forbidden":
      return { label: "format forbidden", detail: constraint.format };
    case "locale-required":
      return { label: "locale required", detail: constraint.locale };
    case "device-class-required":
      return { label: "device class required", detail: constraint.deviceClass };
    case "max-cost":
      return {
        label: "max cost",
        detail:
          constraint.currency === undefined
            ? `≤ ${formatExactNumber(constraint.cost)}`
            : `≤ ${formatExactNumber(constraint.cost)} ${constraint.currency}`,
      };
    case "max-latency":
      return {
        label: "max latency",
        detail: `≤ ${formatExactNumber(constraint.latencyMs)}ms`,
      };
    case "catalog-rule":
      return { label: "catalog rule", detail: constraint.ruleId };
    case "policy-rights":
      return { label: "rights gate", detail: constraint.gateId };
    case "custom":
      return { label: "custom gate", detail: constraint.constraintId };
  }
}

/* ------------------------------------------------------------------ *
 * Objective display                                                    *
 * ------------------------------------------------------------------ */

/** Label for an objective kind, surfacing customKind when the host used one. */
export function objectiveKindLabel(kind: string, customKind: string | undefined): string {
  return kind === "custom" && customKind !== undefined ? customKind : kind;
}
