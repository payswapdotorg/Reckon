# Reckon Public Contract Map

Status: FROZEN WITH ARCHITECTURE 0.1 / CONTRACT-001

Maps every public contract (packages/contracts) to its owning API
operation and SDK surface. Generated JSON Schemas live in
`packages/contracts/schemas/` — OpenAPI documents and SDK types MUST be
generated from those (or the zod source), never hand-written in parallel.

## Contracts → API operations

| Contract | Schema file | Runtime API | Research API |
|---|---|---|---|
| DecisionRequest | decision-request.schema.json | `POST /v1/decisions` | — |
| DecisionResult | decision-result.schema.json | `POST /v1/decisions` (response), `GET /v1/decisions/{id}` | — |
| OutcomeEvent | outcome-event.schema.json | `POST /v1/outcomes` | — |
| PreferenceDelta | preference-delta.schema.json | `POST /v1/preferences/events` | — |
| ExperiencePlan | experience-plan.schema.json | `POST /v1/plans`, `POST /v1/plans/{id}/replan` | — |
| CatalogItem | catalog-item.schema.json | `POST /v1/catalog/items` | — |
| Realization | realization.schema.json | `POST /v1/catalog/realizations` | — |
| CandidateSet (embedded) | decision-request.schema.json | `POST /v1/candidates` | — |
| Experience | experience.schema.json | `POST /v1/experiences/resolve` | — |
| ContextSnapshot | context-snapshot.schema.json | embedded in DecisionRequest | — |
| AgentBody | agent-body.schema.json | — | `POST /v1/organizations/search` inputs |
| AgentOrganization | agent-organization.schema.json | — | `POST /v1/organizations/search` |

## Contract ownership

- `packages/contracts/**` — TL3-owned (CONTRACT-001). Workers consume; changes require an Architecture Change Record.
- Runtime HTTP field names — frozen at first API release by W3-001 against these schemas (TL3 review required).
- SDK types — generated from the same source (W3-002).

## Versioning rules

1. Every contract object carries `schema` (contract id) and `schemaVersion`.
2. `CONTRACT_VERSIONS` in `packages/contracts/src/version.ts` is the registry of truth.
3. Breaking changes: new major version + ACR; additive changes: minor bump; both land via TL3 merge only.
4. Digests: `canonicalJson` + `contentDigest` (packages/contracts/src/serialization.ts) are the deterministic form for artifact lineage.
