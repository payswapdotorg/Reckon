# @reckon/features

Feature assembly (W1-004). Pure, deterministic, stateless.

## Laws implemented

- **No-future-leakage**: temporal features read ONLY events with
  `occurredAt <= at`. Dropped future events are counted explicitly
  (`temporal.droppedFutureCount`) so leakage is observable, never silent.
- **Determinism**: identical inputs ⇒ identical `families`, `names` and
  `digest` (`contentDigest` over the canonical form of
  `{ subject, tenant, at, families, names }`).
- **Provider neutrality** (architecture lock #3): host vocabulary (labels,
  realization kinds, locales) enters ONLY through stable sha256-based
  hashed buckets — no provider vocabulary in type/field/file names.
- **Privacy** (ADR-003): location contributes ONLY an explicit
  permitted-flag — never the location value.

## Families (fixed order)

`item`, `realization`, `experience`, `preference`, `context`, `temporal`,
`uncertainty` — each a pure named function in `src/families.ts`. For every
family `f`: `families[f][k]` is the value of feature `names[f][k]`.

- `item`: per item — kind code, label count, 16-bucket label counts
  (commutative), availability flag, attribute count.
- `realization`: per realization — hashed kind/locale buckets, constraint
  count.
- `experience`: per experience — format code, duration presence/seconds,
  locale, screen/audio requirements, min bandwidth, timing, counts,
  objective fit.
- `preference`: aggregates over the preference snapshot (counts, mean
  confidences, numeric magnitudes).
- `context`: typed enum codes (day part, device class, audio route,
  network, bandwidth, attention quality) + raw numeric signals. Absent
  optionals use the documented −1 marker (or a presence flag).
- `temporal`: recency/frequency over time-filtered recent events,
  including per-event-type counts over the frozen `OUTCOME_EVENT_TYPES`.
- `uncertainty`: dimension count, mean/min/max confidence, spread,
  low-confidence fraction.

## Port / implementation

- `FeatureAssembler` (port): `assemble(input: FeatureInput): FeatureVector`.
- `createFeatureAssembler()` — the default pure implementation (no store,
  no clock). `FeatureInput` carries `subject, tenant, at, contextSnapshot,
  items, realizations?, experiences?, preferences?, recentEvents?`.

## Preference snapshot contract

`preferences` is a STRUCTURAL type (`PreferenceSnapshotInput`) that is
field-compatible with the snapshot returned by `@reckon/preferences` —
deliberately NOT a workspace dependency, so this wave adds no lockfile
entries; the composition root (TL3-owned, later wave) wires the stores
together.

## Errors

Typed only: `FeatureValidationError` (contract records),
`FeaturePreferenceSnapshotError` (structural preference snapshot) —
discriminated by `code` on `FeaturesError`.
