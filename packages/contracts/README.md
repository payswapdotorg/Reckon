# Reckon Contracts

TL3-owned canonical public contract package.

This package is the only authority for shared schemas/types used by workers and generated SDKs.

Required contract families are defined in `docs/architecture/contracts.md`:

- DecisionRequest / DecisionResult
- Experience
- OutcomeEvent
- PreferenceDelta
- AgentBody
- AgentOrganization
- ExperiencePlan
- ContextSnapshot
- CatalogItem / Realization references
- Constraint / Reward / Policy references

Schema source, TypeScript types, JSON Schema/OpenAPI projections and compatibility rules must have one canonical source. Workers consume the published contract; they do not invent local competing types.
