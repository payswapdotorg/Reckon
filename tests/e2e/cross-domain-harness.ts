/**
 * W3-009 — the cross-domain E2E composition harness (test infrastructure).
 *
 * Composes the REAL repository runtimes into one in-process deployment:
 *
 *   SDK client → apps/api route pipeline (auth/tenant/scope/zod
 *   validation/idempotency) → decision handler running the REAL W2
 *   kernels (normalizeCandidates → expandExperiences → evaluatePolicy →
 *   decide) over ADAPTER-MAPPED contract data → W3-003 outcome transport
 *   (BufferedTransport + JSONL journal → EventStore) with the W3-004
 *   observability wrappers emitting the evidence trail.
 *
 * The handler PORTS are the injectable seams by design (apps/api/src/
 * ports.ts); everything behind them here is real repository code:
 * - the decision handler is DOMAIN-NEUTRAL — it resolves the adapter
 *   front by tenant id and runs the identical kernel chain for every
 *   domain (no domain branch anywhere in the handler or the kernels);
 * - the experience resolver runs the real W2-003 expander;
 * - the plan state and host intents enter through a driver that models
 *   the host-observed plan truth and the adapter-mapped host actions
 *   (play/queue → planState truth; switch/interrupt/end/tokens →
 *   scheduler inputs; HOST-AUTHORITY LAW and SEPARATION LAW preserved);
 * - the injected clock advances by the REAL measured kernel time inside
 *   each decision, so the observability decision records carry measured
 *   latency (latencySource: "injected-clock" — never invented).
 *
 * NO LLM anywhere. Caller-supplied timestamps only. Fixture evidence:
 * controlled-local — this proves the composed repository software, not a
 * live provider integration (AGENTS.md "Production truth").
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer, wireOutcomeTransport } from "../../apps/api/src/index.js";
import type { PartialHandlerPorts } from "../../apps/api/src/index.js";
import { createReckonClient, createInjectFetch } from "../../packages/sdk/src/index.js";
import type { ReckonClient } from "../../packages/sdk/src/index.js";
import { InMemoryEventStoreAdapter, JsonlFileJournal, ManualClock } from "../../packages/events/src/index.js";
import { JsonlFileObservabilitySink, ObservabilityRecorder } from "../../packages/observability/src/index.js";
import type { ObservabilityRecord } from "../../packages/observability/src/index.js";
import type {
  DecisionRequest,
  Experience,
  OutcomeEvent,
  PreferenceDelta,
  ScheduleDelta,
  SubjectReference,
  TenantScope,
} from "../../packages/contracts/src/index.js";
import { normalizeCandidates } from "../../packages/decision/src/index.js";
import { expandExperiences } from "../../packages/experience/src/index.js";
import type { PlanState, SwitchEvaluationInput } from "../../packages/scheduler/src/index.js";
import type { JournalRecord } from "../../packages/events/src/journal.js";
import type { HostSchedulerIntents } from "../../packages/integrations/src/index.js";
import { idleState, runVertical, unwrapVertical } from "../../packages/integrations/test/vertical.js";
import type { VerticalOutput } from "../../packages/integrations/test/vertical.js";
import type { ConformanceBinding } from "../../packages/integrations/test/conformance-table.js";

// ---------------------------------------------------------------------------
// The runtime driver — host-observed plan truth + per-decision host intents
// ---------------------------------------------------------------------------

/** The scheduler inputs a host decision request carries (SEPARATION LAW:
 *  every switch number and resume token is caller-supplied). */
export interface RuntimeIntents {
  switch?: SwitchEvaluationInput;
  resumeTokens?: Record<string, string>;
  endRequested?: boolean;
  interruptRequested?: boolean;
}

/**
 * The driver that sits where a real host integration would sit: it holds
 * the plan state the runtime observes (host-authoritative starts/queues
 * are plan-state TRUTH) and the adapter-mapped host intents the NEXT
 * decision consumes. It also records every kernel run as evidence.
 */
export class KernelRuntimeDriver {
  #planState: PlanState = idleState();
  #intents: RuntimeIntents = {};
  #runs: VerticalOutput[] = [];

  get planState() {
    return this.#planState;
  }

  /** The kernel runs executed through this driver (evidence trail). */
  get runs(): readonly VerticalOutput[] {
    return this.#runs;
  }

  /**
   * Apply adapter-mapped host intents: a `planState` (host-authoritative
   * play/queue) becomes the observed plan truth; switch/interrupt/end
   * flags and resume tokens become the inputs the NEXT decision consumes.
   */
  applyHostIntents(intents: HostSchedulerIntents): void {
    if (intents.planState !== undefined) {
      this.#planState = intents.planState;
    }
    this.#intents = {
      ...(intents.switch !== undefined ? { switch: intents.switch } : {}),
      ...(intents.interruptRequested !== undefined ? { interruptRequested: intents.interruptRequested } : {}),
      ...(intents.endRequested !== undefined ? { endRequested: intents.endRequested } : {}),
      ...(intents.resumeTokens !== undefined ? { resumeTokens: intents.resumeTokens } : {}),
    };
  }

  /** Supply caller-side resume tokens alongside an already-applied intent
   *  (the conformance pattern: tokens ride with the switch evaluation). */
  supplyResumeTokens(tokens: Record<string, string>): void {
    this.#intents = { ...this.#intents, resumeTokens: { ...this.#intents.resumeTokens, ...tokens } };
  }

  /** Consume the pending intents (a decision consumes them exactly once). */
  consume(): RuntimeIntents {
    const pending = this.#intents;
    this.#intents = {};
    return pending;
  }

  /** The runtime's own transition becomes the observed plan truth. */
  observeRuntimeTransition(nextState: VerticalOutput["decision"]["nextState"]): void {
    this.#planState = nextState;
  }

  /** Record one kernel run for the evidence trail. */
  recordRun(run: VerticalOutput): void {
    this.#runs.push(run);
  }
}

// ---------------------------------------------------------------------------
// The domain-neutral decision handler (real kernels, adapter-fronted)
// ---------------------------------------------------------------------------

/** Unwrap an adapter result for the E2E happy path (typed failure → throw). */
export function mustOk<T>(
  result: { ok: true; value: T } | { ok: false; error: { message: string } },
  label = "adapter step",
): T {
  if (!result.ok) {
    throw new Error(`cross-domain E2E: ${label} failed: ${result.error.message}`);
  }
  return result.value;
}

/** One adapter front registered against a tenant of the deployment. */
export interface AdapterFront {
  /** The conformance binding (adapter-mapped contract records + closures). */
  readonly binding: ConformanceBinding;
}

/**
 * The decision handler: DOMAIN-NEUTRAL by construction. It resolves the
 * adapter front by tenant and runs the identical real-kernel vertical
 * for every domain — the only per-domain data is the adapter's own
 * mapped contracts (items, realizations, objective, fit policy), which
 * is host data, not a code branch.
 */
function createRuntimeDecisionHandler(
  fronts: Map<string, AdapterFront>,
  driver: KernelRuntimeDriver,
  clock: ManualClock,
): NonNullable<PartialHandlerPorts["decisionHandler"]> {
  return {
    decide: async (request: DecisionRequest) => {
      const front = fronts.get(request.tenant.tenantId);
      if (front === undefined) {
        throw new Error(`cross-domain E2E: no adapter front registered for tenant ${request.tenant.tenantId}`);
      }
      if (request.at === undefined) {
        throw new Error("cross-domain E2E: caller-supplied `at` is required (timestamps are never invented)");
      }
      const binding = front.binding;
      const startedAt = performance.now();
      const run = unwrapVertical(
        runVertical({
          tenant: request.tenant,
          subject: request.subject,
          objective: binding.objective,
          attentionPolicy: request.attentionPolicy,
          context: binding.context,
          candidateSet: request.candidates,
          items: binding.items,
          realizations: binding.realizations,
          constraints: request.constraints,
          allowedFormats: binding.allowedFormats,
          objectiveFit: binding.objectiveFit,
          policySelector: request.policySelector,
          at: request.at,
          requestId: request.requestId,
          idempotencyKey: request.idempotencyKey,
          startState: driver.planState,
          ...(request.currentExperience !== undefined ? { currentExperience: request.currentExperience } : {}),
          intents: driver.consume(),
        }),
      );
      // The injected clock advances by the REAL measured kernel time so
      // the observability decision record carries measured latency.
      clock.advance(Math.max(0, Math.round(performance.now() - startedAt)));
      driver.recordRun(run);
      driver.observeRuntimeTransition(run.decision.nextState);
      return run.result;
    },
  };
}

/**
 * The experience resolver: the REAL W2-001 + W2-003 kernels behind the
 * frozen resolve route. Route semantics: expand the submitted items and
 * realizations; retrieval rows are derived from the submission itself
 * (each item proposes all of its realizations).
 */
function createRuntimeExperienceResolver(
  fronts: Map<string, AdapterFront>,
): NonNullable<PartialHandlerPorts["experienceResolver"]> {
  return {
    resolve: async (request, auth) => {
      const front = fronts.get(auth.tenantId);
      if (front === undefined) {
        throw new Error(`cross-domain E2E: no adapter front registered for tenant ${auth.tenantId}`);
      }
      const binding = front.binding;
      const rows = request.items.map((item) => ({
        itemId: item.itemId,
        realizationIds: request.realizations
          .filter((realization) => realization.itemId === item.itemId)
          .map((realization) => realization.realizationId),
        source: "experiences-resolve",
      }));
      const normalized = normalizeCandidates({
        candidates: {
          setId: `resolve-${auth.tenantId}`,
          candidates: rows,
        },
        items: request.items,
        realizations: request.realizations,
        tenant: { tenantId: auth.tenantId },
      });
      if (!normalized.ok) {
        throw new Error(`cross-domain E2E: resolve normalization failed: ${normalized.error.message}`);
      }
      const expansion = expandExperiences(
        {
          candidates: normalized.value,
          items: request.items,
          realizations: request.realizations,
          formatPolicy: { allowedFormats: binding.allowedFormats },
          objective: binding.objective,
          constraints: request.constraints ?? [],
        },
        { objectiveFit: binding.objectiveFit },
      );
      if (!expansion.ok) {
        throw new Error(`cross-domain E2E: resolve expansion failed: ${expansion.error.message}`);
      }
      return { experiences: expansion.value.experiences.map((entry) => entry.experience) };
    },
  };
}

// ---------------------------------------------------------------------------
// The composed deployment
// ---------------------------------------------------------------------------

export interface CrossDomainKey {
  readonly apiKey: string;
  readonly tenantId: string;
}

export interface CrossDomainAppOptions {
  /** tenantId → adapter front (the deployment's host bindings). */
  readonly fronts: ReadonlyMap<string, AdapterFront>;
  /** One API key per tenant (the deployment is multi-tenant). */
  readonly keys: readonly CrossDomainKey[];
}

/** One composed cross-domain deployment (real runtimes, in-process). */
export interface CrossDomainApp {
  /** The Fastify app (close() it when done). */
  readonly app: ReturnType<typeof buildServer>;
  /** The SDK client of a tenant (created lazily, deterministic ids). */
  client(tenantId: string): ReckonClient;
  /** The runtime driver (plan truth + host intents + kernel evidence). */
  readonly driver: KernelRuntimeDriver;
  /** The real event store the outcome transport delivers into. */
  readonly store: InMemoryEventStoreAdapter;
  /** The shared injected clock (transport + observability + decisions). */
  readonly clock: ManualClock;
  /** The transport wiring (receipt/status surface). */
  readonly transport: ReturnType<typeof wireOutcomeTransport>["transport"];
  /** Preference deltas ingested through the preferences route. */
  readonly preferenceDeltas: readonly PreferenceDelta[];
  /** Digest-verified observability records (the evidence trail). */
  readObservability(): readonly ObservabilityRecord[];
  /** The durable outcome journal records (append-only evidence). */
  readJournal(): readonly JournalRecord[];
  /** Tear down: close the app and remove the temporary evidence files. */
  destroy(): Promise<void>;
}

/** Compose one cross-domain deployment over the real repository runtimes. */
export function createCrossDomainApp(options: CrossDomainAppOptions): CrossDomainApp {
  const dir = mkdtempSync(join(tmpdir(), "reckon-xdomain-"));
  const journalPath = join(dir, "outcomes.jsonl");
  const observabilityPath = join(dir, "records.jsonl");

  const store = new InMemoryEventStoreAdapter();
  const clock = new ManualClock(1_000);
  const driver = new KernelRuntimeDriver();
  const preferenceDeltas: PreferenceDelta[] = [];

  // Deterministic observability ids (stable evidence replay).
  let recordId = 0;
  const idGenerator = () => `e2e-rec-${(recordId += 1)}`;
  let sdkId = 0;
  const sdkIdGenerator = () => `e2e-sdk-${(sdkId += 1)}`;

  const failureRecorder = new ObservabilityRecorder({
    sink: new JsonlFileObservabilitySink(observabilityPath),
    clock: () => clock.now(),
    idGenerator,
  });
  const wiring = wireOutcomeTransport({
    store,
    clock,
    journal: new JsonlFileJournal(journalPath),
    onTerminalFailure: (failure) =>
      failureRecorder.recordError({
        scope: "transport",
        code: "TRANSPORT_TERMINAL_FAILURE",
        message: failure.reason.message,
        tenant: failure.event.tenant,
      }),
  });

  const fronts = new Map(options.fronts);
  const handlers: PartialHandlerPorts = {
    decisionHandler: createRuntimeDecisionHandler(fronts, driver, clock),
    outcomeIngest: wiring.handler,
    preferenceIngest: {
      ingest: async (delta: PreferenceDelta) => {
        preferenceDeltas.push(delta);
        return delta;
      },
    },
    catalogItemIngest: { ingest: async (item) => item },
    realizationIngest: { ingest: async (realization) => realization },
    candidatesHandler: { submit: async (set) => set },
    experienceResolver: createRuntimeExperienceResolver(fronts),
  };

  const app = buildServer({
    apiVersion: "e2e-xdomain",
    keys: options.keys.map((key) => ({
      apiKey: key.apiKey,
      tenantId: key.tenantId,
      scopes: ["decisions", "outcomes", "plans", "catalog"] as const,
    })),
    handlers,
    observability: {
      sink: new JsonlFileObservabilitySink(observabilityPath),
      clock: () => clock.now(),
      idGenerator,
    },
  });

  const clients = new Map<string, ReckonClient>();
  const keyByTenant = new Map(options.keys.map((key) => [key.tenantId, key.apiKey]));

  return {
    app,
    driver,
    store,
    clock,
    transport: wiring.transport,
    preferenceDeltas,
    client(tenantId: string): ReckonClient {
      const existing = clients.get(tenantId);
      if (existing !== undefined) return existing;
      const apiKey = keyByTenant.get(tenantId);
      if (apiKey === undefined) {
        throw new Error(`cross-domain E2E: no API key registered for tenant ${tenantId}`);
      }
      const client = createReckonClient({
        baseUrl: "http://reckon-xdomain-e2e.test",
        apiKey,
        fetchImpl: createInjectFetch(app),
        idGenerator: sdkIdGenerator,
      });
      clients.set(tenantId, client);
      return client;
    },
    readObservability(): readonly ObservabilityRecord[] {
      return new JsonlFileObservabilitySink(observabilityPath).readAll();
    },
    readJournal() {
      return new JsonlFileJournal(journalPath).readAll();
    },
    async destroy() {
      await app.close(); // the SDK clients hold no open resources
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// Request builders (adapter-fronted: the mapped contracts ARE the request)
// ---------------------------------------------------------------------------

export interface DecisionRequestSpec {
  readonly tenant: TenantScope;
  readonly subject: SubjectReference;
  readonly binding: ConformanceBinding;
  readonly at: number;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly currentExperience?: Experience;
  readonly policyId?: string;
}

/** Build the SDK decision request from the adapter's mapped contracts. */
export function adapterFrontedDecisionRequest(spec: DecisionRequestSpec) {
  return {
    requestId: spec.requestId,
    tenant: spec.tenant,
    subject: spec.subject,
    objective: spec.binding.objective,
    attentionPolicy: spec.binding.attentionPolicy,
    context: { contextId: spec.binding.context.contextId },
    candidates: spec.binding.candidateSet,
    ...(spec.currentExperience !== undefined ? { currentExperience: spec.currentExperience } : {}),
    policySelector: { policyId: spec.policyId ?? "e2e-cross-domain", version: "1" },
    at: spec.at,
    idempotencyKey: spec.idempotencyKey,
  };
}

// ---------------------------------------------------------------------------
// Observability trail helpers (the W3-009 evidence standard)
// ---------------------------------------------------------------------------

/** Every decision record for a request id (there is exactly one on the
 *  happy path — the evidence the W3-009 standard asserts on). */
export function decisionRecords(records: readonly ObservabilityRecord[], requestId: string) {
  return records.filter(
    (record): record is Extract<ObservabilityRecord, { kind: "decision" }> =>
      record.kind === "decision" && record.requestId === requestId,
  );
}

/** Every scheduler-action record for a decision id. */
export function schedulerActionRecords(records: readonly ObservabilityRecord[], decisionId: string) {
  return records.filter(
    (record): record is Extract<ObservabilityRecord, { kind: "scheduler-action" }> =>
      record.kind === "scheduler-action" && record.decisionId === decisionId,
  );
}

/** Every outcome-linkage record for a decision id. */
export function outcomeLinkageRecords(records: readonly ObservabilityRecord[], decisionId: string) {
  return records.filter(
    (record): record is Extract<ObservabilityRecord, { kind: "outcome-linkage" }> =>
      record.kind === "outcome-linkage" && record.decisionId === decisionId,
  );
}

/**
 * Assert the full W3-009 evidence standard for one decision: the decision
 * record exists with MEASURED latency (injected-clock source), the
 * scheduler-action record exists for the emitted action, and — when an
 * outcome event was appended — the outcome-linkage record links it.
 * Returns the asserted records.
 */
export function expectDecisionTrail(
  records: readonly ObservabilityRecord[],
  decision: { requestId: string; decisionId: string; action: string; scheduleDelta?: ScheduleDelta },
): { decision: Extract<ObservabilityRecord, { kind: "decision" }>; schedulerAction: Extract<ObservabilityRecord, { kind: "scheduler-action" }> } {
  const decisions = decisionRecords(records, decision.requestId);
  if (decisions.length !== 1) {
    throw new Error(
      `evidence trail: expected exactly one decision record for request ${decision.requestId}, found ${decisions.length}`,
    );
  }
  const decisionRecord = decisions[0];
  if (
    decisionRecord.latencySource !== "injected-clock" ||
    decisionRecord.status !== "ok" ||
    typeof decisionRecord.latencyMs !== "number" ||
    decisionRecord.latencyMs < 0 ||
    decisionRecord.action !== decision.action ||
    decisionRecord.decisionId !== decision.decisionId ||
    decisionRecord.policy?.policyId !== "e2e-cross-domain"
  ) {
    throw new Error(`evidence trail: decision record does not meet the standard: ${JSON.stringify(decisionRecord)}`);
  }
  const actions = schedulerActionRecords(records, decision.decisionId);
  if (actions.length !== 1) {
    throw new Error(
      `evidence trail: expected exactly one scheduler-action record for decision ${decision.decisionId}, found ${actions.length}`,
    );
  }
  const schedulerRecord = actions[0];
  if (
    schedulerRecord.source !== "decision" ||
    schedulerRecord.action !== decision.action ||
    schedulerRecord.enqueuedCount !== (decision.scheduleDelta?.enqueue.length ?? 0) ||
    schedulerRecord.dequeuedCount !== (decision.scheduleDelta?.dequeue.length ?? 0)
  ) {
    throw new Error(`evidence trail: scheduler-action record does not match the decision: ${JSON.stringify(schedulerRecord)}`);
  }
  return { decision: decisionRecord, schedulerAction: schedulerRecord };
}

/** Assert an outcome event is linked to its decision in the evidence trail. */
export function expectOutcomeLinked(
  records: readonly ObservabilityRecord[],
  outcome: OutcomeEvent,
): Extract<ObservabilityRecord, { kind: "outcome-linkage" }> {
  const linkages = records.filter(
    (record): record is Extract<ObservabilityRecord, { kind: "outcome-linkage" }> =>
      record.kind === "outcome-linkage" && record.eventId === outcome.eventId,
  );
  if (linkages.length !== 1) {
    throw new Error(
      `evidence trail: expected exactly one outcome-linkage record for event ${outcome.eventId}, found ${linkages.length}`,
    );
  }
  const linkage = linkages[0];
  if (
    linkage.decisionId !== outcome.decisionId ||
    linkage.linked !== (outcome.decisionId !== undefined) ||
    linkage.eventType !== outcome.eventType ||
    linkage.outcomeEvidenceClass !== outcome.evidenceClass
  ) {
    throw new Error(`evidence trail: outcome-linkage record does not match the event: ${JSON.stringify(linkage)}`);
  }
  return linkage;
}
