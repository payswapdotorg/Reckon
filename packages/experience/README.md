# @reckon/experience

Experience expansion/resolution (Worker 2 lane). Implements **W2-003**:
normalized candidates (W2-001 output) → complete, schema-valid
`Experience` variants, gated by hard constraints with honest exclusion
records.

## What is here

- `ExperienceExpander` port + pure kernel (`expandExperiences`).
- `ObjectiveFitFn` injected port: the ONLY source of
  `objectiveFit.fitScore` (never fabricated).

## Laws enforced

- **Constraint/reward separation** (lock #21): hard constraints gate
  eligibility and are reported as exclusion records with reason codes
  (`excludedBy`); they never influence reward or fit.
- **Schema validity**: every emitted variant is validated with
  `ExperienceSchema` (by construction — the kernel parses the draft
  through the frozen schema).
- **NO-LLM LAW** + determinism: pure, total, deterministic;
  digest-derived experience ids; permutation-invariant outputs.
- **Honest absence**: unavailable normalized candidates produce
  `candidate-unavailable` exclusion records — experiences are never
  invented for them.

## Documented deterministic semantics

### Realization constraint interpretation (host vocabulary)

The frozen `Realization.constraints` record is opaque; this kernel
interprets the following documented keys (anything else is ignored):

| key | type | meaning |
|---|---|---|
| `formats` | `FORMAT_KINDS[]` | deliverable formats; FIRST entry is the base format, the rest are variants. Absent/empty ⇒ base `full`. |
| `durationSeconds` | finite number ≥ 0 | experience duration |
| `deviceClasses` | string[] | required device classes |
| `requiresScreen` / `requiresAudio` | boolean | requirements |
| `minBandwidth` | `low \| medium \| high` | requirement |
| `formatParams` | record keyed by format kind | opaque format params |

Catalog item `availableFrom`/`availableUntil` map to experience
`timing.earliestMs`/`timing.latestMs`.

### Constraint evaluation (fail-closed for hard gates)

Evaluated here: `min-duration`, `max-duration`, `format-required`,
`format-forbidden`, `locale-required`, `device-class-required`. An
UNDECLARED value fails a gate that needs it (e.g. no declared duration
⇒ cannot verify min/max-duration ⇒ excluded — never guessed).

NOT evaluated here (opaque/request-scoped; pass through without
exclusion — the policy engine/host gates them): `time-window`,
`max-cost`, `max-latency`, `catalog-rule`, `policy-rights`, `custom`.

The host format policy (`formatPolicy.allowedFormats`) is checked
first; excluded formats carry `excludedBy: "format-policy"`.

When several gates fail, `excludedBy` is the FIRST failing gate
(format policy, then input constraint order) and `reasons` lists all
failing gate codes in deterministic order.

### Experience ids and dedup

`experienceId = "exp-" + sha256(realizationId, format kind, customKind)
[0..24)`. The same (realization, format) proposed through several
candidate sources emits ONE experience with all `sources` (sorted) and
the strongest hints.

### Ordering

Experiences: `rankHint` descending (absent last), then `experienceId`
ascending. Exclusions: kind, `itemId`, `realizationId`, format kind.

### Objective fit

`objectiveFit` is computed ONLY when an `ObjectiveFitFn` was injected
into `createExperienceExpander({ objectiveFit })`; the fit function
must be pure and return a finite score in `[0, 1]` (violations are
typed `INVALID_INPUT` errors). Without the port the field is absent.

## Cross-package types

`NormalizedCandidate` is imported TYPE-ONLY from `@reckon/decision`
source (`W2-003 depends on W2-001` per the dependency graph). The
import is erased at runtime, so no package.json/lockfile dependency
entry is required (the frozen lockfile forbids new dependency entries).
