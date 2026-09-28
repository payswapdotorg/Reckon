# Worker 3 Handoff — API / SDK / Integrations / Proof

## Owned paths

- §apps/api/**§
- §packages/sdk/**§
- §packages/integrations/**§
- §packages/observability/**§
- §tests/e2e/**§
- §tests/conformance/**§

## Sequence

1. W3-001 API/auth/tenant boundary
2. W3-002 SDK
3. W3-003 event/outcome transport
4. W3-004 observability
5. W3-005 WebFlix reference adapter
6. W3-006 generic media adapter
7. W3-007 commerce adapter
8. W3-008 advertising adapter
9. W3-009 cross-domain conformance
10. W3-010 performance/load
11. W3-011 production readiness

## Integration principles

WebFlix is the first intended real consumer.

The WebFlix adapter consumes normalized Item, Realization, Experience, Decision, Schedule and Outcome contracts and never imports WebFlix internal persistence.

Generic media must prove the same contracts without WebFlix vocabulary.

Commerce proves product → offer/realization → experience → decision → schedule → outcome.

Advertising proves creative → placement/format → experience → show/defer/interrupt → outcome.

Host systems remain authoritative for identity, consent, catalog, rights, provider access, delivery, campaign policy and payment.

## SDK

The SDK must work without an LLM and must not expose internal database schemas.

## Observability

Record decision latency, policy/model version, uncertainty, cost, outcome linkage, integration capability, errors and scheduler actions.

## Production proof

Fixture evidence never proves a live provider integration. Real acceptance requires actual authorization, observed output, measured performance, failure behavior and explicit limitations.

## Completion evidence

Exact SHA/diff/tests plus cross-domain conformance and production-readiness evidence.