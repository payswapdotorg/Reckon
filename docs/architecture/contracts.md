# Reckon Contracts

Status: FROZEN WITH ARCHITECTURE 0.1

These are the seams workers must implement against.

## Core public contracts

### DecisionRequest

- tenant/workspace
- subject reference
- objective
- attention policy
- context snapshot
- candidate references
- constraints
- current experience, if any
- plan state, if any
- policy/version selector
- idempotency key

### DecisionResult

- decision id
- selected experience
- action
- alternatives summary
- confidence/uncertainty metadata
- policy/version
- schedule delta
- reasons/explanations suitable for the host
- provenance
- latency/cost metadata

### Experience

- item reference
- realization reference
- format
- locale
- duration
- timing constraints
- objective fit
- device/context requirements
- transformation requirements
- availability window

### OutcomeEvent

- decision id
- experience id
- event type
- occurrence time
- context reference
- subject reference
- host evidence/provenance
- value/metric payload
- idempotency key

### PreferenceDelta

- subject
- dimension/key
- old/new value or update operation
- scope/context
- confidence delta
- provenance
- expiry/decay
- model/version
- timestamp

### AgentBody

- body id/version
- role contract
- observations
- tools
- permissions
- memory interfaces
- action interface
- budget
- latency limits
- evaluator
- simulator implementation
- real implementation

### AgentOrganization

- organization id/version
- body nodes
- communication/delegation edges
- shared/private memory topology
- model assignment
- budgets
- termination rules
- evaluator
- capability dependencies

### ExperiencePlan

- plan id/version
- current experience
- queued experiences
- planning horizon
- replan triggers
- interruption policy
- resume checkpoints
- objective
- attention policy

## Contract rules

1. All public contracts are versioned.
2. IDs are immutable.
3. Digests are deterministic.
4. Timestamps are caller-supplied where deterministic replay matters.
5. Tenant scope is explicit.
6. Provider-specific types do not leak into core contracts.
7. Constraints are separate from reward.
8. Outcome records are append-oriented; corrections reference earlier records.
9. Simulated/counterfactual outcomes are typed and cannot masquerade as observed outcomes.
10. Any SDK contract must be usable without an LLM.

## Proposed API operations

### Runtime

- `POST /v1/decisions`
- `POST /v1/outcomes`
- `POST /v1/preferences/events`
- `POST /v1/plans`
- `POST /v1/plans/{id}/replan`
- `GET /v1/decisions/{id}`

### Catalog/experience

- `POST /v1/catalog/items`
- `POST /v1/catalog/realizations`
- `POST /v1/candidates`
- `POST /v1/experiences/resolve`

### Research

- `POST /v1/lab/runs`
- `GET /v1/lab/runs/{id}`
- `POST /v1/lab/runs/{id}/cancel`
- `POST /v1/policies/evaluate`
- `POST /v1/organizations/search`

Final HTTP/SDK field names are owned by TL3 until schema freeze.

## Compatibility

A provider integration may expose richer metadata through adapter-private fields, but the core consumes only declared normalized capability contracts.

OpenAPI/JSON Schema/TypeScript representations should be generated from one canonical schema source once TL3 freezes it.
