# tests/e2e — end-to-end vertical acceptance (W3 lane)

Worker 3 owns end-to-end vertical and cross-domain acceptance tests.
Fixture evidence must remain labeled.

## Current coverage (W3-002 + W3-003 + W3-004)

`vertical.test.ts` composes the REAL repository implementations —
`@reckon/sdk` client, `apps/api` route pipeline (auth/tenant/scope/zod
validation/idempotent replay), the W3-003 `BufferedTransport` with a JSONL
journal, the wave-1 `InMemoryEventStoreAdapter` sink, and the W3-004
observability sinks — in-process via `app.inject`. Only the handler PORTS
(the injectable seams by design) are deterministic test doubles.

The vertical proves:

1. catalog item + realization upsert, candidate submission, experience
   resolution through the SDK;
2. decision request → SUGGEST + schedule delta;
3. outcome append linked to the decision, delivered at-least-once through
   the transport into the store (receipt `delivered`, exactly one stored
   record with content digest);
4. the durable journal records the append-only evidence
   (enqueue → terminal);
5. observability records: capability per handler port, decision record
   with latency 25ms measured from the injected clock, scheduler-action
   record from the schedule delta, outcome-linkage record
   (eventId ↔ decisionId), digest-verified on read;
6. preference delta + plan create alongside;
7. tenant isolation end-to-end (cross-tenant body → typed 403 through the
   SDK; tenant streams stay disjoint).

EVIDENCE CLASS: controlled-local. This is fixture/in-process evidence —
it proves the composed repository software, NOT a live provider
integration or production deployment (AGENTS.md "Production truth").
