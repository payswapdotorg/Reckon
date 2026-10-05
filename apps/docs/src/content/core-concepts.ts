/**
 * Core concepts content (S1-004): the Reckon vertical from
 * docs/development/implementation-rules.md —
 *
 *   catalog → context → candidates → experience → decision → schedule →
 *   outcome → preference delta
 *
 * Each entry reflects the real frozen architecture
 * (docs/architecture/reckon-frozen-architecture.md §3) and links to the
 * frozen contract that formalizes it (packages/contracts).
 */

import type { ConceptEntry, TocEntry } from "./types.js";
import {
  candidateSetExample,
  catalogItemExample,
  contextSnapshotExample,
  decisionRequestExample,
  decisionResultExample,
  jsonOf,
  outcomeEventExample,
  preferenceDeltaExample,
} from "./fixtures/index.js";

export const CONCEPTS_HEADINGS: readonly TocEntry[] = [
  { id: "the-reckon-loop", label: "The Reckon loop", level: 2 },
  { id: "concepts", label: "Concepts", level: 2 },
  { id: "catalog", label: "Catalog item", level: 3 },
  { id: "context", label: "Context snapshot", level: 3 },
  { id: "candidates", label: "Candidate set", level: 3 },
  { id: "experience", label: "Experience", level: 3 },
  { id: "decision", label: "Decision", level: 3 },
  { id: "schedule", label: "Schedule & plans", level: 3 },
  { id: "outcome", label: "Outcome event", level: 3 },
  { id: "preference-delta", label: "Preference delta", level: 3 },
  { id: "two-speed-runtimes", label: "Two-speed runtimes", level: 2 },
  { id: "host-authority", label: "Host authority", level: 2 },
  { id: "evidence-classes", label: "Evidence classes", level: 2 },
];

export const LOOP_STEPS: readonly { label: string; learning?: boolean }[] = [
  { label: "catalog" },
  { label: "context" },
  { label: "candidates" },
  { label: "experience" },
  { label: "decision" },
  { label: "schedule" },
  { label: "outcome" },
  { label: "preference delta", learning: true },
];

export const CONCEPTS: readonly ConceptEntry[] = [
  {
    id: "catalog",
    term: "Catalog item",
    tagline: "the host-owned things Reckon can recommend",
    contract: { id: "reckon.catalog-item", version: "0.1.0" },
    summary: [
      "A catalog item is whatever the host sells, plays, shows or sends: media, a product, an ad, an article, a notification, an offer. The host owns the catalog — Reckon stores a typed shadow of each item and never branches on its contents.",
      "Labels and the `attributes` payload are host vocabulary and stay opaque to the core. A [realization](#realization) describes one concrete way the item can be delivered (a stream source, a locale, a provider, a channel).",
    ],
    fields: [
      ["`itemId`", "opaque id", "Host-assigned, immutable, URL-safe."],
      ["`kind`", "enum", "`media` · `commerce` · `advertising` · `notification` · `article` · `other`"],
      ["`labels`", "string[]", "Host-defined tags; core never branches on them."],
      ["`attributes`", "record", "Opaque host payload (title, duration, price…)."],
      ["`availableFrom` / `availableUntil`", "epoch ms?", "Availability window."],
    ],
    example: {
      caption: "A media item in the `demo` tenant catalog.",
      json: jsonOf(catalogItemExample),
    },
  },
  {
    id: "context",
    term: "Context snapshot",
    tagline: "typed point-in-time state — no raw sensor data",
    contract: { id: "reckon.context-snapshot", version: "0.1.0" },
    summary: [
      "The context snapshot is a typed, privacy-gated description of the moment a decision is made: time and day-part, device class, screen and audio route, network class, host activity signals, estimated attention, session position, and fatigue/interruption state.",
      "Sensitive raw sensor data is **not** required. Location is included only when explicitly permitted and necessary (ADR-003), and stays coarse by default.",
    ],
    fields: [
      ["`time`", "object?", "`localTime`, `timezone`, `dayPart`"],
      ["`device`", "object?", "`class` (phone/tablet/desktop/tv/…), `screenAvailable`, `audioRoute`"],
      ["`network`", "object?", "`class` (offline/metered/wifi/cellular), `bandwidthHint`"],
      ["`attention`", "object?", "`availableMs`, `quality` (full/partial/background/…)"],
      ["`fatigue`", "object?", "`repetitionLevel`, `recentInterruptions`"],
      ["`location`", "object?", "Only when `permitted: true` — coarse by default."],
    ],
    example: {
      caption:
        "An evening, phone-on-wifi context. Note what is absent: no location, no raw sensors.",
      json: jsonOf(contextSnapshotExample),
    },
  },
  {
    id: "candidates",
    term: "Candidate set",
    tagline: "the eligible set — retrieval proposes, Reckon decides",
    contract: { id: "reckon.decision-request", version: "0.1.0" },
    summary: [
      "Reckon does not crawl your catalog at request time. Your retrieval systems (and approved exploration providers) propose the eligible candidate set; the decision policy selects from it. Retrieval `rankHint` and `scoreHint` are hints — they inform, but never replace, the decision.",
      "This separation keeps the fast runtime low-latency and lets you keep using the search/retrieval infrastructure you already trust.",
    ],
    fields: [
      ["`setId`", "opaque id", "Identifies the set for this request."],
      ["`candidates[]`", "array", "`itemId`, optional `realizationIds`, `source`, `rankHint`, `scoreHint`"],
      ["`source`", "string", "Which retrieval system proposed the candidate."],
    ],
    example: {
      caption: "Two host-retrieval candidates plus one exploration candidate.",
      json: jsonOf(candidateSetExample),
    },
  },
  {
    id: "experience",
    term: "Experience",
    tagline: "a concrete presentation of an item",
    contract: { id: "reckon.experience", version: "0.1.0" },
    summary: [
      "An experience binds an item and one of its realizations to a format (`full`, `clip`, `card`, `push`, `in-feed`, …), a duration, timing constraints, device requirements and objective-fit metadata. The decision result hands you an experience, not a bare item id — everything needed to render it is in the payload.",
      "Experiences are also the unit of scheduling: plans queue, switch, interrupt and resume experiences.",
    ],
    fields: [
      ["`itemId` / `realizationId`", "opaque ids", "What to present and how to deliver it."],
      ["`format.kind`", "enum", "`full` · `clip` · `card` · `push` · `in-feed` · `notification` · … (17 kinds)"],
      ["`timing`", "object?", "`earliestMs`, `latestMs`, availability window"],
      ["`objectiveFit`", "object?", "`fitScore` 0–1 and notes for the declared objective"],
      ["`requirements`", "object?", "Device, screen, audio, bandwidth requirements"],
    ],
    example: {
      caption: "The selected experience from the quickstart decision — a calm 20-minute card.",
      json: jsonOf(decisionResultExample.selectedExperience),
    },
  },
  {
    id: "decision",
    term: "Decision",
    tagline: "one policy run — the atomic unit of the API",
    contract: { id: "reckon.decision-result", version: "0.1.0" },
    summary: [
      "A decision request names the subject, objective, attention policy, context, candidate set and a versioned `policySelector`; the decision result returns a scheduler action, the selected experience, alternatives, uncertainty, machine-readable reasons, provenance and latency/cost metadata.",
      "Requests are idempotent and deterministic-replayable (`at` is caller-supplied where determinism matters). Results are immutable — a changed context means a new decision, never a mutation.",
    ],
    fields: [
      ["`action`", "enum", "`HOLD` · `CONTINUE` · `QUEUE` · `SUGGEST` · `SWITCH` · `INTERRUPT` · `RESUME` · `END`"],
      ["`selectedExperience`", "experience?", "What to present (absent when action is `HOLD`)."],
      ["`alternatives[]`", "array", "Non-selected experiences with `excludedBy` when a rule removed them."],
      ["`uncertainty`", "object?", "confidence · spread · disagreement · oodScore"],
      ["`reasons[]`", "array", "`{ code, message }` pairs — stable codes for UI, prose for humans."],
      ["`scheduleDelta`", "object?", "Plan changes this decision ordered."],
    ],
    example: {
      caption: "A `SUGGEST` decision from the quickstart.",
      json: jsonOf(decisionResultExample),
    },
  },
  {
    id: "schedule",
    term: "Schedule & plans",
    tagline: "sequences of experiences that survive new observations",
    summary: [
      "Where a single decision answers \"what now?\", an experience plan answers \"what next?\" — a versioned horizon of planned decisions that is explicitly replanned when context, outcomes or preferences change. Every replan appends a version with its trigger; history is never rewritten.",
      "The scheduler evaluates the eight actions against interruption policy, fatigue and attention: it can `HOLD` (do nothing), `CONTINUE`, `QUEUE` a future experience, `SUGGEST` now, `SWITCH` mid-experience, `INTERRUPT` with a resume checkpoint, `RESUME` from one, or `END` the plan.",
    ],
  },
  {
    id: "outcome",
    term: "Outcome event",
    tagline: "what actually happened — the loop's ground truth",
    contract: { id: "reckon.outcome-event", version: "0.1.0" },
    summary: [
      "After you deliver an experience, report what happened: `impression`, `start`, `completion`, `abandonment`, `skip`, `purchase`, `explicit-feedback`, … (18 typed kinds, plus `custom`). Events reference the decision and experience they belong to and carry a numeric `metrics` payload.",
      "Two laws keep outcomes honest: corrections are **append-only** (a correction event points at the record it corrects — nothing is overwritten), and every event declares its `evidenceClass` — `simulated` and `counterfactual` outcomes are typed so they can never masquerade as observed production evidence.",
    ],
    example: {
      caption: "A production-observed completion, ~20 minutes after the decision.",
      json: jsonOf(outcomeEventExample),
    },
  },
  {
    id: "preference-delta",
    term: "Preference delta",
    tagline: "a learned change to preference state — with receipts",
    contract: { id: "reckon.preference-delta", version: "0.1.0" },
    summary: [
      "Learning writes append-only deltas, not opaque state blobs: each delta names a `dimension`, an operation (`set`, `add`, `multiply`, `decay`, `remove`, `merge`), old/new values, the confidence change it produced, its scope and temporal validity, decay semantics, and the exact model lineage that produced it.",
      "Because deltas are typed and auditable, a host can answer \"why does the user see this?\" with a chain: decision → outcome → delta → model version.",
    ],
    example: {
      caption: "Learning nudged `topic.calm-nature` up after the completion event.",
      json: jsonOf(preferenceDeltaExample),
    },
  },
];

export const TWO_SPEED_ROWS: readonly (readonly string[])[] = [
  ["Latency", "Low — no required LLM call on the hot path", "Durable — jobs, not requests"],
  ["Determinism", "Deterministic enough to debug and audit", "Seeded and reproducible"],
  ["Execution", "Synchronous request/response", "Resumable, budgeted, artifact-versioned"],
  ["Counterfactuals", "Not represented on the hot path", "Explicit — never confused with observed data"],
  ["Examples", "Serve a decision · report an outcome", "Model drift studies · offline evaluation · replays"],
];

export const HOST_AUTHORITY_BULLETS: readonly string[] = [
  "The host owns identity, consent, catalog, provider access, rights and entitlements, delivery and playback, payment, and policy.",
  "Reckon consumes host-declared objectives and attention policies — it never silently infers sensitive attributes, and an attention optimization never becomes a maximum-engagement objective.",
  "Location and other sensitive context appear only when explicitly permitted (ADR-003).",
  "The provider-neutral core contains no provider-specific branches; provider vocabulary stays at the adapter seam.",
];

export const EVIDENCE_ROWS: readonly (readonly string[])[] = [
  ["`production-observed`", "Real traffic, real users. The only class that counts as product acceptance."],
  ["`staging`", "Staging environment observations."],
  ["`controlled-local`", "Controlled local harness runs."],
  ["`simulated`", "Simulated outcomes — research only, typed separately from observed classes."],
  ["`counterfactual`", "What-if analysis — research only."],
  ["`fixture`", "Test fixtures — never live-provider evidence."],
];

export const CONCEPTS_SEE_ALSO: readonly string[] = [
  "Run the whole loop yourself in the [quickstart](/get-started/quickstart).",
  "See the exact request/response envelopes in the [API reference](/api-reference/authentication).",
  "Let Reckon push you the loop's events: [webhooks](/webhooks).",
];
