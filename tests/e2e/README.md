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

## Current coverage (W3-009 cross-domain E2E)

`cross-domain.test.ts` (+ `cross-domain-harness.ts`, the composition
harness) drives the four reference adapters — WebFlix (W3-005), generic
media (W3-006), commerce (W3-007), advertising (W3-008) — through the
REAL runtimes with NO LLM anywhere:

1. **Four-domain vertical E2E** — per adapter, the full chain runs
   through the real runtimes: adapter-mapped context → candidates →
   experience expansion (real W2-001 + W2-003 kernels behind the frozen
   resolve route) → decision (real W2-001/002/003/004 kernel chain
   behind the frozen decisions route) → schedule delta → observed
   outcome (real W3-003 transport + journal + store) → preference deltas
   in the adapter's OWN vocabulary — with the observability records as
   the evidence trail: decision latency measured from the injected clock
   around the real kernel work, scheduler-action records, outcome
   linkage, integration-capability records, digest-verified on read.
2. **Cross-domain interleaving** — ONE deployment (one app, one
   domain-neutral decision handler, one scheduler runtime, ONE shared
   plan state) serves all four tenants; eight decisions interleave
   QUEUE → SUGGEST → INTERRUPT → HOLD → SWITCH → INTERRUPT → RESUME →
   END across domains (a commerce host action interrupts a WEBFLIX
   experience; an advertising switch checkpoints it; a WEBFLIX decision
   resumes an ADVERTISING creative; a generic-media request ends the
   shared plan). Every action's observability trail is asserted and
   every outcome is linkage-verified, including an honestly UNLINKED
   observation and the honest absence of outcomes for non-binding
   SUGGEST/HOLD decisions.
3. **Static domain-neutrality** — the core kernel sources
   (scheduler/decision/experience) contain no domain vocabulary: no
   domain branch exists to take.

The shared proof vocabulary lives in
`packages/integrations/test/conformance-table.ts` (extended in W3-009
with the SUGGEST-band numbers, `hostSuggest`, `hostInterrupt`, `hostEnd`
closures and the richer observation channel).
