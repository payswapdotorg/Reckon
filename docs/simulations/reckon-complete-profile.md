# Reckon-Complete Conformance Profile

Status: ACTIVE (SIM-001)  
Owner: TL3  
Contracts: `packages/contracts/src/reckon-complete.ts` (frozen, additive)  
Schemas: `packages/contracts/schemas/reckon-complete-*.schema.json`, `integration-effort-*.schema.json`  
Harness: `packages/simulation/src/harness/**`  
Guide: `docs/simulations/harness-guide.md` · `docs/simulations/scorecard.md`

## Definition (verbatim from the ladder doc)

A host is Reckon-Complete for a declared profile when it can exercise the required Reckon decision loop using only public contracts, generated schemas, API/SDK surfaces, and a declared capability manifest, with zero internal-package imports and no domain logic added to the Reckon kernel.

## The `reckon.complete.*` discriminator family

| Contract id | Purpose |
|---|---|
| `reckon.complete.profile-declaration` | The host archetype's REQUIRED capabilities (+ evidence floor). |
| `reckon.complete.capability-manifest` | The host's versioned, checksummed declaration of what it SUPPORTS. |
| `reckon.complete.conformance-verdict` | The machine-checkable profile × manifest coverage envelope. |
| `reckon.complete.integration-effort-record` | ONE measured harness run (the measurement unit of the ladder). |
| `reckon.complete.integration-effort-scorecard` | The aggregate over a wave of runs (the 3-domain law lives here). |

Every member is a zod schema in `reckon-complete.ts`, exported through `@reckon/contracts`, and emitted as a JSON Schema (draft 2020-12) by `pnpm run generate:schemas` (byte-stable by construction — canonical JSON, sorted keys). The exhaustive family union is `ReckonCompleteEnvelopeSchema` (discriminated on `schema`); its ids are frozen in `RECKON_COMPLETE_CONTRACT_IDS`.

## Frozen vocabularies (literal unions in code — never free-form strings)

### Capability names — `RECKON_COMPLETE_CAPABILITIES` (20)

`tenant-identity`, `catalog-registration`, `realization-declaration`, `candidate-retrieval`, `context-snapshots`, `objective-declaration`, `constraint-declaration`, `attention-policy`, `decision-request`, `decision-retrieval`, `experience-resolution`, `plan-management`, `schedule-execution`, `outcome-return`, `preference-feedback`, `evidence-retrieval`, `webhook-delivery`, `ad-memory`, `agent-delegation`, `conformance-verification`

Derived from the ladder's target onboarding flow and the public API/SDK surface (`POST /v1/decisions`, `/v1/outcomes`, `/v1/catalog/items`, `/v1/catalog/realizations`, `/v1/candidates`, `/v1/preferences/events`, plans, webhooks, AD-001 ad memory, agent bodies/organizations).

### Evidence classes — `RECKON_COMPLETE_EVIDENCE_CLASSES`

The frozen primitives vocabulary, single source: `fixture`, `controlled-local`, `staging`, `production-observed`, `simulated`, `counterfactual`.

Sufficiency semantics (`evidenceClassSatisfies`, frozen):
- observed requirements are satisfied by observed classes of equal or greater strength (`fixture` < `controlled-local` < `staging` < `production-observed`);
- `simulated`/`counterfactual` NEVER satisfy an observed requirement, and observed evidence NEVER substitutes for a required research class — research requirements need exact matches.

### Friction categories — `RECKON_COMPLETE_FRICTION_CATEGORIES` (11, exact ladder list)

`CONTRACT_GAP`, `API_GAP`, `SDK_GAP`, `COMPOSITION_GAP`, `PERSISTENCE_GAP`, `CAPABILITY_GAP`, `ADAPTER_GAP`, `OBSERVABILITY_GAP`, `UX_DX_GAP`, `HOST_RESPONSIBILITY`, `RIGHTS_POLICY_BOUNDARY`

### Support statuses — `RECKON_COMPLETE_SUPPORT_STATUSES`

`supported`, `partial`, `gap`. Structural law: every `partial`/`gap` manifest entry REQUIRES a `friction` category (discriminated union on `status` — machine-checkable in the generated schema). A `gap` entry carries NO evidence class (nothing is wired).

## Profile declaration

```
ReckonCompleteProfileDeclaration
├─ profileId, name, description?, ladderLevel? (1..20)
├─ requiredCapabilities: [{ capability, minimumEvidenceClass? }]   (unique, ≥ 1)
├─ requiredEvidenceClass?    (profile-wide floor; per-capability overrides it)
└─ declaredAt                (caller-supplied — deterministic replay rule #4)
```

## Capability manifest

```
ReckonCompleteCapabilityManifest
├─ manifestId, manifestVersion
├─ hostSystem: { hostId, name, hostAdapterId, version }   (hostAdapterId = REPLAY identity)
├─ declaredAt
├─ supportedCapabilities: [ (discriminated on status)
│    supported → { capability, evidenceClass!, apiOperations[], sdkMethods[], notes? }
│    partial   → { capability, evidenceClass!, friction!, apiOperations[], sdkMethods[], notes? }
│    gap       → { capability, friction!, notes? } ]
└─ checksum   (sha256 over canonical content minus manifestId + checksum)
```

`finalizeReckonCompleteCapabilityManifest(content, manifestId)` parses, enforces capability uniqueness, and seals the checksum. Same content ⇒ same checksum (content-scoped, id-independent).

## Conformance verdict

`evaluateReckonCompleteConformance(profile, manifest)` is the frozen categorization semantics:

| Situation | State | Friction |
|---|---|---|
| Required capability not declared in the manifest | `missing` | `CAPABILITY_GAP` |
| Manifest entry `status: "gap"` | `missing` | the DECLARED friction (verbatim) |
| Manifest entry `status: "partial"` | `partial` | the DECLARED friction (verbatim) |
| Supported but evidence below the required class | `satisfied` (coverage) but incomplete | `OBSERVABILITY_GAP` |

`reckonComplete` = every required capability satisfied AND evidence sufficient. `finalizeReckonCompleteConformanceVerdict({verdictId, measuredAt, profile, manifest})` assembles the envelope.

Run-level completion (harness): verdict complete AND `internalImports === 0` AND the full loop completed within the run.

## Zero-internal-access law

The harness and the conformance fixtures import ONLY `@reckon/contracts` and `@reckon/sdk` (plus intra-package relatives, `zod` types, `node:*`). Enforced mechanically by `tests/conformance/zero-internal-access.test.ts`, which scans every import specifier of `packages/simulation/src/**` and `tests/conformance/fixtures/**` and fails on any internal package import or deep non-public resolution. A required capability missing from the public surface is an **API_GAP / PLATFORM_UPGRADE_CANDIDATE finding** (see the findings section of the SIM-001 completion report), never an internal import.

## Laws encoded structurally

1. Evidence honesty — `simulated`/`counterfactual` never satisfy observed requirements (union-level, machine-checkable in the artifacts).
2. Manifest integrity — every manifest is content-checksummed; finalization computes it deterministically.
3. Honest partials/gaps — friction categories are structurally required on non-supported manifest entries.
4. Replay identity — `hostAdapterId` + seed + manifest checksum (+ run config) determine a run byte-exactly (see the harness guide).
