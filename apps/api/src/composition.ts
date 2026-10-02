/**
 * P1-002 — production API composition.
 *
 * Replaces the NotWired defaults with REAL runtime handlers over REAL
 * persistence (FINAL TL HANDOFF §4): the ten /v1 endpoints answer through
 * the actual W2 kernel chain (normalizeCandidates → expandExperiences →
 * evaluatePolicy → decide — NO LLM anywhere) and the @reckon/persistence
 * adapters (PostgreSQL per ADR-001). The route contracts are FROZEN
 * (W3-001) — only the handler ports change, exactly as the port design
 * intends.
 *
 * Composition law (handoff §32 #5): the TL owns shared composition; the
 * decision kernel itself is never touched. Every timestamp visible in
 * contract records is caller-supplied (`request.at`); plan bookkeeping
 * time (updatedAt on replan) comes from the composition clock — host
 * time authority, never invented by the kernel. DecisionResult latency
 * is OMITTED (single samples are not percentiles — measured latency
 * lives in the observability records, W3-004).
 */
import {
  DecisionResultSchema,
  ExperiencePlanSchema,
  FORMAT_KINDS,
  contentDigest,
  type AgentBody,
  type AgentOrganization,
  type CatalogItem,
  type ContextSnapshot,
  type DecisionRequest,
  type DecisionResult,
  type ExperiencePlan,
  type Realization,
  type TenantScope,
} from "@reckon/contracts";
import { normalizeCandidates, evaluatePolicy } from "@reckon/decision";
import { expandExperiences } from "@reckon/experience";
import { decide, type PlanState } from "@reckon/scheduler";
import {
  PgCatalogStore,
  PgContextStore,
  PgDecisionStore,
  PgEventQueries,
  PgEventSink,
  PgIdempotencyStore,
  PgOutboxTransport,
  PgAgentStore,
  PgPlanStore,
  PgResearchJobStore,
  PgPreferenceStore,
  PgPoolExecutor,
  applyMigrations,
  type SqlExecutor,
} from "@reckon/persistence";
import type {
  AdapterDeclarationView,
  PartialHandlerPorts,
  ResearchJobView,
  StoredPlanVersionView,
} from "./ports.js";
import { buildServer } from "./server.js";
import type { ApiConfig } from "./config.js";
import type { ReplanRequest, ResolveRequest, ResolveResponse } from "./envelopes.js";
import type { AuthContext } from "./types.js";
import { PgObservabilitySink } from "./pg-observability.js";

/** Composition clock: host wall-clock in production, manual in tests. */
export type CompositionClock = { now(): number };

export interface ProductionCompositionOptions {
  /** An externally-owned executor (tests reuse one server). */
  readonly executor?: SqlExecutor;
  /** Or a connection string (production: DATABASE_URL). */
  readonly connectionString?: string;
  /** Apply pending migrations on boot (default true — idempotent). */
  readonly migrate?: boolean;
  readonly keys: ApiConfig["keys"];
  readonly apiVersion?: string;
  readonly clock?: CompositionClock;
  readonly logger?: boolean;
}

export interface ProductionComposition {
  readonly app: ReturnType<typeof buildServer>;
  readonly executor: SqlExecutor;
  readonly transport: PgOutboxTransport;
  readonly observability: PgObservabilitySink;
  readonly stores: {
    readonly decisions: PgDecisionStore;
    readonly plans: PgPlanStore;
    readonly catalog: PgCatalogStore;
    readonly preferences: PgPreferenceStore;
    readonly contexts: PgContextStore;
    readonly events: PgEventQueries;
    readonly idempotency: PgIdempotencyStore;
    readonly agents: PgAgentStore;
    readonly researchJobs: PgResearchJobStore;
  };
  close(): Promise<void>;
}

/** Typed composition failure (boot/wiring — surfaced at startup, never per-request). */
export class CompositionError extends Error {
  readonly code = "COMPOSITION_FAILED" as const;
  constructor(message: string) {
    super(message);
    this.name = "CompositionError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** TenantScope from the authenticated request context (tenant law: auth-derived). */
function toAdapterView(declaration: AdapterDeclaration): AdapterDeclarationView {
  return {
    adapterId: declaration.adapterId,
    domain: declaration.domain,
    contractVersion: declaration.contractVersion,
    supportedCapabilities: [...declaration.supportedCapabilities],
    unsupportedCapabilities: [...declaration.unsupportedCapabilities],
    authorizationRequirements: declaration.authorizationRequirements.map((req) => ({
      resource: req.resource,
      requirement: req.requirement,
      enforcedBy: req.enforcedBy,
    })),
    limits: { ...declaration.limits },
    liveVerification: { ...declaration.liveVerification },
    provenance: { ...declaration.provenance },
    failureSemantics: { ...declaration.failureSemantics },
  };
}

import {
  ADVERTISING_ADAPTER_DECLARATION,
  COMMERCE_ADAPTER_DECLARATION,
  GENERIC_MEDIA_ADAPTER_DECLARATION,
  WEBFLIX_ADAPTER_DECLARATION,
} from "@reckon/integrations";
import type { AdapterDeclaration } from "@reckon/integrations";
const ADAPTER_DECLARATIONS = [
  WEBFLIX_ADAPTER_DECLARATION,
  GENERIC_MEDIA_ADAPTER_DECLARATION,
  COMMERCE_ADAPTER_DECLARATION,
  ADVERTISING_ADAPTER_DECLARATION,
] as const;

function toResearchJobView(stored: {
  jobId: string;
  kind: string;
  state: "queued" | "leased" | "done" | "failed";
  payload: unknown;
  resultRef: string | null;
  createdAt: number;
  updatedAt: number;
}): ResearchJobView {
  return {
    jobId: stored.jobId,
    kind: stored.kind,
    state: stored.state,
    payload: stored.payload,
    resultRef: stored.resultRef,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  };
}

function authTenantScope(auth: AuthContext): TenantScope {
  return {
    tenantId: auth.tenantId,
    ...(auth.workspaceId !== undefined ? { workspaceId: auth.workspaceId } : {}),
  };
}

/**
 * Default host format policy: EVERY declared format kind is expandable.
 * Adapters (W3-005..008) restrict this per domain; the domain-neutral
 * production API must not silently exclude declared formats.
 */
const ALL_FORMATS: readonly (typeof FORMAT_KINDS)[number][] = FORMAT_KINDS;

/** Derive the scheduler PlanState from a persisted plan (host-observed truth). */
function planStateOf(plan: ExperiencePlan | null): PlanState {
  if (plan === null) {
    return { status: "idle", queue: [], resumeCheckpoints: [] };
  }
  const queue = plan.queuedExperiences.map((experience) => experience.experienceId);
  if (plan.currentExperience !== undefined) {
    return {
      status: "playing",
      currentExperienceId: plan.currentExperience.experienceId,
      queue,
      resumeCheckpoints: plan.resumeCheckpoints,
    };
  }
  return {
    status: queue.length > 0 ? "queued" : "idle",
    queue,
    resumeCheckpoints: plan.resumeCheckpoints,
  };
}

/**
 * The production decision handler: the REAL kernel chain over persisted
 * catalog/context/plan state. The request itself carries candidates,
 * objective, attention policy, constraints and the caller-supplied `at`.
 */
export function createRuntimeDecisionHandler(handlers: {
  catalog: PgCatalogStore;
  plans: PgPlanStore;
}): NonNullable<PartialHandlerPorts["decisionHandler"]> {
  const { catalog, plans } = handlers;
  return {
    decide: async (request: DecisionRequest): Promise<DecisionResult> => {
      if (request.at === undefined) {
        throw new CompositionError(
          "production decision handler requires caller-supplied `at` (timestamps are never invented)",
        );
      }

      // Host truth from persistence (catalog ingested through /v1/catalog).
      // Context detail flows through the request's own context REFERENCE
      // (kernels consume it from the contract record — no snapshot
      // synthesis, no invention).
      const [items, realizations, plan] = await Promise.all([
        catalog.listItems(request.tenant),
        catalog.listRealizations(request.tenant),
        request.planId !== undefined ? plans.get(request.tenant, request.planId) : Promise.resolve(null),
      ]);

      // Stage 1 — W2-001 candidate normalization over host capability truth.
      const normalized = normalizeCandidates({
        candidates: request.candidates,
        items: [...items],
        realizations: [...realizations],
        tenant: request.tenant,
      });
      if (!normalized.ok) {
        throw new CompositionError(`normalization failed: ${normalized.error.message}`);
      }

      // Stage 2 — W2-003 experience expansion (default host format policy:
      // every declared format; no injected objective-fit — honest absence).
      const expansion = expandExperiences({
        candidates: normalized.value,
        items: [...items],
        realizations: [...realizations],
        formatPolicy: { allowedFormats: ALL_FORMATS },
        objective: request.objective,
        constraints: request.constraints,
      });
      if (!expansion.ok) {
        throw new CompositionError(`expansion failed: ${expansion.error.message}`);
      }
      if (expansion.value.experiences.length === 0) {
        throw new CompositionError("no expandable experiences (all candidates excluded)");
      }

      // Stage 3 — W2-002 policy evaluation (objective-fit evidence only —
      // no reward spec is invented here).
      const policy = evaluatePolicy({
        experiences: expansion.value.experiences.map((entry) => entry.experience),
        objective: request.objective,
        constraints: request.constraints,
        policyId: request.policySelector.policyId,
        policyVersion: request.policySelector.version,
      });
      if (!policy.ok) {
        throw new CompositionError(`policy evaluation failed: ${policy.error.message}`);
      }
      if (policy.value.scored.length === 0) {
        throw new CompositionError("policy evaluation produced no eligible experiences");
      }

      // Stage 4 — the scheduler decision (W2-004) over persisted plan state.
      const schedulerDecision = decide({
        currentState: planStateOf(plan?.plan ?? null),
        request,
        scored: policy.value.scored,
      });
      if (!schedulerDecision.ok) {
        throw new CompositionError(`scheduler decide failed: ${schedulerDecision.error.message}`);
      }

      // Stage 5 — the contract result envelope (schema-validated;
      // uncertainty carried from the winning score entry; deterministic
      // decisionId from content; latency omitted — measured latency is
      // the observability record's job, never a percentile claim).
      const selected = schedulerDecision.value.selectedExperience;
      const alternatives = policy.value.scored
        .filter((entry) => entry.experience.experienceId !== schedulerDecision.value.selectedExperienceId)
        .map((entry) => ({
          experienceId: entry.experience.experienceId,
          score: entry.score,
          ...(entry.uncertainty !== undefined ? { uncertainty: entry.uncertainty } : {}),
        }));
      const decisionId = `dec-${contentDigest({
        requestId: request.requestId,
        action: schedulerDecision.value.action,
        at: request.at,
        selectedId: schedulerDecision.value.selectedExperienceId ?? null,
      }).slice(0, 24)}`;
      const parsedResult = DecisionResultSchema.safeParse({
        decisionId,
        requestId: request.requestId,
        tenant: request.tenant,
        action: schedulerDecision.value.action,
        ...(selected !== undefined ? { selectedExperience: selected } : {}),
        alternatives,
        ...(policy.value.scored[0]?.uncertainty !== undefined
          ? { uncertainty: policy.value.scored[0].uncertainty }
          : {}),
        policy: {
          policyId: request.policySelector.policyId,
          version: request.policySelector.version,
        },
        scheduleDelta: schedulerDecision.value.scheduleDelta,
        reasons: schedulerDecision.value.reasons,
        provenance: { system: "reckon-api-production", version: "0.1.0" },
        at: request.at,
      });
      if (!parsedResult.success) {
        throw new CompositionError(
          `constructed decision result failed schema validation: ${parsedResult.error.message}`,
        );
      }
      return parsedResult.data;
    },
  };
}

/**
 * The production experience resolver: the REAL W2-003 expander over the
 * resolve request's items + realizations (candidate set synthesized from
 * the items themselves — the resolve route exists precisely to expand
 * catalog capability without a prior decision).
 */
export function createRuntimeExperienceResolver(): NonNullable<
  PartialHandlerPorts["experienceResolver"]
> {
  return {
    resolve: async (request: ResolveRequest, auth: AuthContext): Promise<ResolveResponse> => {
      const tenant = authTenantScope(auth);
      const candidateSet = {
        setId: `resolve-${contentDigest({ items: request.items.map((item) => item.itemId) }).slice(0, 24)}`,
        candidates: request.items.map((item) => ({
          itemId: item.itemId,
          realizationIds: request.realizations
            .filter((realization) => realization.itemId === item.itemId)
            .map((realization) => realization.realizationId),
          source: "resolve-route",
        })),
      };
      const normalized = normalizeCandidates({ candidates: candidateSet, items: [...request.items], realizations: [...request.realizations], tenant });
      if (!normalized.ok) {
        throw new CompositionError(`resolve normalization failed: ${normalized.error.message}`);
      }
      const expansion = expandExperiences({
        candidates: normalized.value,
        items: [...request.items],
        realizations: [...request.realizations],
        formatPolicy: { allowedFormats: ALL_FORMATS },
        objective: { objectiveId: "resolve", version: "1", kind: "discover", params: {} },
        constraints: request.constraints ?? [],
      });
      if (!expansion.ok) {
        throw new CompositionError(`resolve expansion failed: ${expansion.error.message}`);
      }
      return { experiences: expansion.value.experiences.map((entry) => entry.experience) };
    },
  };
}

/** The production plan handler: durable create + versioned replan. */
export function createRuntimePlanHandler(handlers: {
  plans: PgPlanStore;
  catalog: PgCatalogStore;
  clock: CompositionClock;
}): NonNullable<PartialHandlerPorts["planHandler"]> {
  const { plans, catalog, clock } = handlers;
  return {
    create: async (plan: ExperiencePlan): Promise<ExperiencePlan> => {
      const parsed = ExperiencePlanSchema.safeParse(plan);
      if (!parsed.success) {
        throw new CompositionError(`plan failed schema validation: ${parsed.error.message}`);
      }
      // Version coherence (UI-005 read surface): the store's first row is
      // version 1 by law (append-only versioning); the stored plan JSON is
      // normalized to carry the SAME version so reads never disagree with
      // the version column.
      const normalized = ExperiencePlanSchema.parse({ ...parsed.data, version: 1 });
      await plans.create(normalized);
      return normalized;
    },
    replan: async (planId: string, request: ReplanRequest, auth: AuthContext): Promise<ExperiencePlan> => {
      const tenant = authTenantScope(auth);
      const current = await plans.get(tenant, planId);
      if (current === null) {
        throw new CompositionError(`plan ${planId} not found for tenant`);
      }
      // Real replanning: candidate expansion (W2-003) re-queues the plan
      // when the replan request carries a candidate set.
      let queuedExperiences = current.plan.queuedExperiences;
      if (request.candidates !== undefined) {
        const items = await catalog.listItems(tenant);
        const realizations = await catalog.listRealizations(tenant);
        const normalized = normalizeCandidates({
          candidates: request.candidates,
          items: [...items],
          realizations: [...realizations],
          tenant,
        });
        if (!normalized.ok) {
          throw new CompositionError(`replan normalization failed: ${normalized.error.message}`);
        }
        const expansion = expandExperiences({
          candidates: normalized.value,
          items: [...items],
          realizations: [...realizations],
          formatPolicy: { allowedFormats: ALL_FORMATS },
          objective: current.plan.objective,
          constraints: [],
        });
        if (!expansion.ok) {
          throw new CompositionError(`replan expansion failed: ${expansion.error.message}`);
        }
        queuedExperiences = expansion.value.experiences.map((entry) => entry.experience);
      }
      // Host clock authority for bookkeeping time (documented); the
      // replan trigger is recorded in the version's reason.
      const now = clock.now();
      const replanned = ExperiencePlanSchema.parse({
        ...current.plan,
        version: current.version + 1,
        queuedExperiences,
        replanTriggers: [...new Set([...current.plan.replanTriggers, request.trigger])],
        updatedAt: now,
      });
      const stored = await plans.replan(replanned, `replan:${request.trigger}`);
      return stored.plan;
    },
    get: async (planId: string, auth: AuthContext): Promise<ExperiencePlan | null> => {
      const tenant = authTenantScope(auth);
      const stored = await plans.get(tenant, planId);
      return stored === null ? null : stored.plan;
    },
    history: async (planId: string, auth: AuthContext): Promise<readonly StoredPlanVersionView[]> => {
      const tenant = authTenantScope(auth);
      const stored = await plans.history(tenant, planId);
      return stored.map((entry) => ({
        plan: entry.plan,
        reason: entry.reason,
        version: entry.version,
      }));
    },
    listRecent: async (auth: AuthContext, limit?: number): Promise<readonly ExperiencePlan[]> => {
      const tenant = authTenantScope(auth);
      const stored = await plans.listRecent(tenant, limit);
      return stored.map((entry) => entry.plan);
    },
  };
}

/**
 * Build the PRODUCTION server: every handler port mounted with a real
 * implementation over real persistence. One call, one deployment.
 */
export async function buildProductionServer(
  options: ProductionCompositionOptions,
): Promise<ProductionComposition> {
  const executor =
    options.executor ??
    new PgPoolExecutor({ connectionString: options.connectionString ?? process.env.DATABASE_URL });
  if (options.migrate !== false) {
    await applyMigrations(executor);
  }

  const clock: CompositionClock = options.clock ?? { now: () => Date.now() };
  const catalog = new PgCatalogStore(executor);
  const contexts = new PgContextStore(executor);
  const plans = new PgPlanStore(executor);
  const agents = new PgAgentStore(executor);
  const researchJobs = new PgResearchJobStore(executor, { now: clock.now });
  const decisions = new PgDecisionStore(executor);
  const preferences = new PgPreferenceStore(executor);
  const events = new PgEventQueries(executor);
  const idempotency = new PgIdempotencyStore(executor);

  const sink = new PgEventSink({ executor });
  const transport = new PgOutboxTransport({
    executor,
    sink,
    clock,
    onTerminalFailure: (failure) => {
      process.stderr.write(
        `[production] outcome transport terminal failure: ${failure.eventId}: ${failure.reason.message}\n`,
      );
    },
  });
  const observability = new PgObservabilitySink({ executor, clock: { now: () => clock.now() } });

  const decisionHandler = createRuntimeDecisionHandler({ catalog, plans });
  const handlers: PartialHandlerPorts = {
    decisionHandler: {
      // Persist decisions behind the idempotent route: the handler runs
      // the kernel chain; persistence wraps it with the digest law
      // (same request digest → idempotent; different → typed conflict).
      decide: async (request, auth) => {
        const result = await decisionHandler.decide(request, auth);
        await decisions.put(result, contentDigest(request));
        return result;
      },
    },
    decisionStore: {
      get: async (tenantId: string, decisionId: string) => decisions.get(tenantId, decisionId),
    },
    outcomeIngest: {
      // The frozen outcome-transport ingest semantics (delivered/
      // duplicate → the sink-stored event; buffered → the accepted
      // event with at-least-once delivery continuing through the outbox
      // pump). Wired inline: the durable transport's pending()/status()
      // surface is async-native (documented divergence from the
      // sync-port test infrastructure — the ROUTE contract is unchanged).
      ingest: async (event) => {
        const receipt = await transport.publish(event);
        if (receipt.status === "delivered" || receipt.status === "duplicate") {
          return receipt.event;
        }
        return event;
      },
    },
    preferenceIngest: {
      ingest: async (delta) => {
        await preferences.append(delta);
        return delta;
      },
    },
    integrationHandler: {
      listAdapters: async () => ADAPTER_DECLARATIONS.map((declaration) => toAdapterView(declaration)),
    },
    researchHandler: {
      enqueue: async (job, auth) => {
        const stored = await researchJobs.enqueue({
          jobId: job.jobId,
          tenant: authTenantScope(auth),
          kind: job.kind,
          payload: job.payload ?? null,
        });
        return toResearchJobView(stored);
      },
      get: async (jobId, auth) => {
        const stored = await researchJobs.get(jobId);
        if (stored === undefined) return null;
        if (stored.tenant.tenantId !== auth.tenantId) return null;
        return toResearchJobView(stored);
      },
      list: async (auth, limit, state) => {
        const stored = await researchJobs.listRecent(authTenantScope(auth), limit, state);
        return stored.map(toResearchJobView);
      },
    },
    agentHandler: {
      createBody: async (body, auth) => {
        await agents.putBody(authTenantScope(auth), body);
        return body;
      },
      getBody: async (bodyId, auth) =>
        (await agents.getBody(authTenantScope(auth), bodyId))?.body ?? null,
      listBodies: async (auth, limit) =>
        (await agents.listBodies(authTenantScope(auth), limit)).map((entry) => entry.body),
      createOrganization: async (organization, auth) => {
        await agents.putOrganization(authTenantScope(auth), organization);
        return organization;
      },
      getOrganization: async (organizationId, auth) =>
        (await agents.getOrganization(authTenantScope(auth), organizationId))?.organization ?? null,
      listOrganizations: async (auth, limit) =>
        (await agents.listOrganizations(authTenantScope(auth), limit)).map(
          (entry) => entry.organization,
        ),
    },
    planHandler: createRuntimePlanHandler({ plans, catalog, clock }),
    catalogItemIngest: {
      ingest: async (item: CatalogItem, auth: AuthContext) => {
        await catalog.putItem(authTenantScope(auth), item);
        return item;
      },
    },
    realizationIngest: {
      ingest: async (realization: Realization, auth: AuthContext) => {
        await catalog.putRealization(authTenantScope(auth), realization);
        return realization;
      },
    },
    candidatesHandler: {
      // Candidate submissions are schema-validated by the route; the
      // candidate set enters decisions through POST /v1/decisions (the
      // authoritative state list does not include candidate sets —
      // handoff §4 — so there is nothing to persist here).
      submit: async (set) => set,
    },
    experienceResolver: createRuntimeExperienceResolver(),
  };

  const app = buildServer({
    apiVersion: options.apiVersion,
    keys: options.keys,
    handlers,
    idempotencyStore: idempotency,
    logger: options.logger,
    observability: {
      sink: observability,
      clock: () => clock.now(),
      evidenceClass: "controlled-local",
    },
  });

  return {
    app,
    executor,
    transport,
    observability,
    stores: { decisions, plans, catalog, preferences, contexts, events, idempotency, agents, researchJobs },
    async close() {
      await app.close();
      await observability.close();
      await executor.close();
    },
  };
}
