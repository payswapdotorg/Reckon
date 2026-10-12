# Reckon-Complete Simulation Harness — Driver Guide

Status: ACTIVE (SIM-001)  
Package: `@reckon/simulation` (`packages/simulation/src/harness/**`)  
Profile spec: `docs/simulations/reckon-complete-profile.md` · Scorecard: `docs/simulations/scorecard.md`

The harness is the driver API a synthetic host uses to become Reckon-Complete through Reckon's PUBLIC surface only. It imports only `@reckon/contracts` + `@reckon/sdk` (enforced by `tests/conformance/zero-internal-access.test.ts`).

## The lifecycle (the ladder's target onboarding flow)

```
register a capability manifest
  → connect sources (catalog items + realizations via POST /v1/catalog/*)
  → per step: submit candidates (POST /v1/candidates)
      → decision request (POST /v1/decisions, objective/policy/constraints declared in-request)
      → host presents (host-owned authority)
      → outcome returned (POST /v1/outcomes)
      → preference delta (POST /v1/preferences/events)
  → conformance verdict + IntegrationEffortRecord (+ replay inputs)
```

## Minimal usage (see `tests/conformance/fixtures/minimal-static-picker-host.ts`)

```ts
import {
  runSimulation, replaySimulationRun, createFixtureReckonPort,
} from "@reckon/simulation";
import { finalizeReckonCompleteProfile } from "@reckon/contracts";

// 1. The host implements SimulationHostAdapter (manifest + catalog +
//    per-step inputs + presentation reactions + outcomes + glue LOC).
const host: SimulationHostAdapter = { /* ... */ };

// 2. The profile declares the capabilities the host must cover.
const profile = finalizeReckonCompleteProfile({
  profileId: "profile-level-1",
  name: "Static catalog picker",
  ladderLevel: 1,
  requiredCapabilities: [{ capability: "decision-request" }, /* ... */],
  requiredEvidenceClass: "fixture",
  declaredAt: 1_000,
});

// 3. The Reckon side: the REAL SDK client over the scripted fixture
//    responder (contract-valid both directions; replace with a real
//    deployment port for controlled-local/staging evidence classes).
const { port } = createFixtureReckonPort();

// 4. Run — deterministic given (seed, host, profile, steps, config).
const run = await runSimulation(
  { seed: "42", port, faultRate: 0.2, maxRetries: 2,
    clock: { startMs: 0, stepMs: 1000 } },
  { host, profile, steps: 5 },
);

run.reckonComplete;   // true iff verdict complete ∧ internalImports=0 ∧ full loop
run.record;           // IntegrationEffortRecord (frozen contract, checksummed)
run.verdict;          // ReckonCompleteConformanceVerdict
run.manifest;         // the sealed CapabilityManifest
run.calls;            // raw PortCallRecord[] (the measurement log)
run.replayInputs;     // { seed, manifestChecksum, hostAdapterId, ... }
```

Reuse a fixed configuration across runs with `createSimulationHarness(config).run(options)` — each run gets a fresh clock/RNG, so identical inputs yield byte-identical artifacts; vary the seed for ensembles.

## The seams

| Seam | Module | Notes |
|---|---|---|
| `ReckonPublicPort` | `harness/port.ts` | The ONLY Reckon touchpoint — typed over frozen contracts; 6 operations (route-annotated). |
| `createSdkPort(client)` | `harness/sdk-port.ts` | Adapts a real `@reckon/sdk` `ReckonClient`. |
| `createFixtureReckonPort()` | `harness/responder.ts` | Real SDK + scripted FetchLike responder (fixture evidence; deterministic ids — never `crypto.randomUUID`). |
| `createRecordingPort(config)` | `harness/recording.ts` | Latency draws, seeded faults, classified bounded retries, call log. |
| `SimulationHostAdapter` | `harness/host-adapter.ts` | The synthetic host: manifest, catalog, per-step inputs, reactions, outcomes, honest glue declaration. |
| `SimClock` | `harness/clock.ts` | Injected virtual monotonic clock — no wall time anywhere. |
| seeded RNG | `../rng.js` (W1) | SplitMix64 via `createRng`/`normalizeSeed`/`deriveSeed`. |

## Determinism laws (mechanically enforced)

1. No `Date.now` / `Math.random` / `new Date` / hrtime in harness paths — token-scanned by `tests/conformance/zero-internal-access.test.ts`; time = `SimClock`, randomness = seeded RNG.
2. Every id is content-derived (`contentDigest` fragments) or counter-based — the SDK's idempotency-key generator is injected (`createDeterministicIdGenerator`).
3. Latency model: success attempts `5 + rng.below(45)` virtual ms; faulted attempts `3 + rng.below(7)`; retry backoff `10·2^attempt` (fixed formula).
4. Percentiles are NEAREST-RANK (`percentile.ts`) — byte-reproducible from the call log alone.

Same seed + same host adapter + same profile/config ⇒ byte-identical `IntegrationEffortRecord`, verdict, and call log (canonical-JSON digest equality — asserted by `packages/simulation/test/harness.test.ts`).

## Failure/retry semantics

- Injected transport faults: probability `faultRate` per attempt (seeded draws, in call order).
- Retry classification (frozen in `recording.ts`): ONLY transient failures retry — injected faults and the SDK's transport/5xx-class codes (`SDK_TRANSPORT_ERROR`, `SDK_UNEXPECTED_ERROR_SHAPE`, `RATE_LIMIT_EXCEEDED`, `INTERNAL`, `HANDLER_RESPONSE_INVALID`, `NOT_WIRED`). Deterministic request failures (validation, auth, tenant/scope, idempotency, 404) are TERMINAL: one attempt, `PortCallFailedError`, honestly recorded.
- A failed step never crashes the run: the driver records it and continues (resilience measurement). `failures.exhaustedCount` counts every call that never succeeded.
- A failed candidate-set ingestion does not block the decision — the request carries the candidate set inline.

## The replay gate

Every record carries `replayInputs`: `{ seed, manifestChecksum, hostAdapterId, harnessVersion, steps, faultRate, maxRetries, clockStartMs, clockStepMs }`.

```ts
const replayed = await replaySimulationRun(run.record.replayInputs, {
  host, profile, port: createFixtureReckonPort().port,
});
// canonicalJson(replayed.record) === canonicalJson(run.record)
```

`replaySimulationRun` is a GATE, not a convenience: it throws `SimulationReplayMismatchError` on harness-version drift or manifest-checksum mismatch. A run that cannot be replayed deterministically from its recorded inputs is a harness bug, not a flake.

## Measured fields → record

API operations + SDK methods (from the call log), glue LOC (host-declared), `internalImports: 0` (enforced by the scanner), timing to first decision / full loop (virtual clock, `0` = not achieved), p50/p95 latency (successful calls, nearest-rank), failure/retry counts, capability coverage (declared vs supported), evidence class, per-gap friction categories, replay inputs, content checksum.

## What the fixture proves — and what it does NOT

The scripted responder proves the HOST side and the CONTRACT parity (the SDK validates every request and response against the frozen zod contracts). It is `fixture`-class evidence: it does NOT prove a live deployment. Higher classes require a real port (in-process API via `createInjectFetch` — `@reckon/sdk/testing` — is `controlled-local`; a real deployment is `staging`/`production-observed`). Fixture runs against production-evidence profiles are honestly INCOMPLETE (`OBSERVABILITY_GAP`).
