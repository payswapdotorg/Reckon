# ADR-003 — Consent and Privacy Boundary

**Status:** ACCEPTED / FROZEN

## Decision

Identity and consent remain host-owned authorities.

Reckon consumes explicit grants and normalized context capabilities.

Cross-device Personal Agent learning is opt-in.

Default synchronization is derived learning state/deltas rather than unrestricted raw telemetry.

## Rules

- no hidden cross-device tracking;
- no silent sensitive-attribute inference;
- raw sensors are not a core requirement;
- revocation stops future use of a capability;
- every context capability identifies authorization scope.