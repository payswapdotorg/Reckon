# @reckon/observability

Append-only, digest-stamped observability records for the Reckon
decision → schedule → outcome flow (work item W3-004).

**Laws**

- **Append-only (calibration law)**: records are immutable frozen trees carrying a `contentDigest` (canonical JSON → sha256, from `@reckon/contracts`) over their own content; sinks never rewrite, update or remove historical records.
- **Contract-typed inputs**: every recorded contract object (`DecisionRequest`, `DecisionResult`, `OutcomeEvent`, `ScheduleDelta`) is validated against the REAL frozen zod schemas — invalid inputs raise typed `ObservabilityInputError`, never raw throws.
- **Deterministic**: record timestamps come from an injected clock; record ids from an injectable generator; latency is caller-computed from the injected clock and stamped `latencySource: "injected-clock"`.
- **Honest evidence**: every record carries an explicit `evidenceClass` label (default `controlled-local`).

## Record kinds

| kind | covers |
| --- | --- |
| `decision` | latency, policy/model version, uncertainty, cost, status (ok/error) |
| `outcome-linkage` | outcome eventId ↔ decision id linkage, experienceId, evidence class, transport status |
| `scheduler-action` | HOLD/CONTINUE/QUEUE/SUGGEST/SWITCH/INTERRUPT/RESUME/END + enqueue/dequeue counts + interrupted experience |
| `integration-capability` | capability wired/available (e.g. `handler:decisionHandler`) |
| `error` | route/handler/transport/sink failures (tenant omitted pre-authentication) |

## Usage

```ts
import { InMemoryObservabilitySink, ObservabilityRecorder } from "@reckon/observability";

const sink = new InMemoryObservabilitySink(); // TEST INFRASTRUCTURE
const recorder = new ObservabilityRecorder({ sink, clock: () => Date.now() });

recorder.recordDecision({ request, result, latencyMs });
recorder.recordOutcome({ event, transportStatus: "delivered" });
recorder.recordSchedulerAction({ source: "decision", action: "SUGGEST", tenant, scheduleDelta });
recorder.recordIntegrationCapability({ integration: "@reckon/api", capability: "handler:x", available: true });
recorder.recordError({ scope: "route", code: "NOT_WIRED", message: "…" });
```

## apps/api composition

`buildServer({ observability: { sink, clock, idGenerator?, evidenceClass? } })`:

- wraps the WIRED decision handler (latency from the injected clock + decision record + scheduler-action record when the result carries a `scheduleDelta`);
- wraps the WIRED outcome ingest handler (outcome-linkage record for the event the route responds with — for transport-backed handlers that is the duplicate-collapsed ORIGINAL);
- emits one integration-capability record per handler port (`available: wired`);
- emits error records (scope `route`) for 4xx/5xx responses — recorded safely so telemetry can never mask the real error envelope.

```ts
import { buildServer } from "@reckon/api";
import { InMemoryObservabilitySink } from "@reckon/observability";

const app = buildServer({
  keys,
  handlers: { decisionHandler, outcomeIngest },
  observability: { sink: new InMemoryObservabilitySink(), clock: () => Date.now() },
});
```

## Adapters (both TEST INFRASTRUCTURE, controlled-local)

- `InMemoryObservabilitySink` — frozen defensive copies, append order preserved.
- `JsonlFileObservabilitySink` — one canonical-JSON line per record; `readAll()` digest-verifies every line (tampered lines raise typed `ObservabilityRecordCorruptError`).

Production telemetry backends are later waves. Everything here is controlled-local evidence; it does not prove a production deployment.
