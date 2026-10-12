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
  type HardConstraint,
  type Realization,
  type TenantScope,
} from "@reckon/contracts";
import { normalizeCandidates, evaluatePolicy } from "@reckon/decision";
import { expandExperiences } from "@reckon/experience";
import { decide, type PlanState } from "@reckon/scheduler";
import {
  PgAccountKeyStore,
  PgAccountSessionStore,
  PgAccountStore,
  PgAdMemoryStore,
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
  PgWebhookDeliveryStore,
  PgWebhookEndpointStore,
  PgWebhookEventStore,
  applyMigrations,
  type SqlExecutor,
  type WebhookSecretEncryptionKey,
} from "@reckon/persistence";
import type {
  AdapterDeclarationView,
  PartialHandlerPorts,
  ResearchJobView,
  StoredPlanVersionView,
} from "./ports.js";
import { buildServer } from "./server.js";
import type { ApiConfig } from "./config.js";
// TL6-001: the self-serve account surface (layered auth + routes).
import { LayeredKeyAuthenticator } from "./auth.js";
import { registerAccountRoutes } from "./routes/account.js";
import type { ReplanRequest, ResolveRequest, ResolveResponse } from "./envelopes.js";
import type { AuthContext } from "./types.js";
import { PgObservabilitySink } from "./pg-observability.js";
// TL6-002: the production webhook mount — the SAME delivery engine the
// in-memory wave ships, now over PostgreSQL stores. The signing secret
// is encrypted at rest (AES-256-GCM) by PgWebhookEndpointStore; the
// outbound POST rides the shipped fetch-based client. The migration
// (m006_webhooks) creates the tenant-scoped tables + indexes.
import { createInMemoryWebhookSystem } from "./webhooks/in-memory.js";
import { FetchWebhookHttpClient } from "./webhooks/http.js";
// AD-003: the ad-retrieval runtime — the /v1/ads route family over the
// AD-002 Personal Ad Memory store port (PgAdMemoryStore in production)
// plus the host/provider availability channels composed for the
// available lane (none by default — an honest empty lane, never faked
// supply; see docs/architecture/ad-retrieval.md).
import {
  createRuntimeAdRetrievalHandler,
  type AdAvailabilityChannel,
} from "./ad-retrieval.js";
// AD-004: the ad-selection composition — ad-lane catalog truth for
// ad candidates the host declared in a DecisionRequest (resolved from
// the SAME memory + channel sources AD-003 queries, at the request
// clock), plus the ad-encounter memory capture (observed outcomes →
// Personal Ad Memory through the AD-002 store port). See
// docs/architecture/ad-selection.md.
import {
  createAdSelectionSource,
  isAdCandidateSource,
  type AdSelectionSource,
} from "./ad-selection.js";
import {
  createAdEncounterCapture,
  createAdEncounterResolver,
  type AdEncounterCapturePolicy,
  type AdEncounterResolver,
} from "./ad-memory-capture.js";

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
  /** TL6-001: per-key rate limiting for the production server (flat limit + tier ladder). */
  readonly rateLimit?: ApiConfig["rateLimit"];
  readonly apiVersion?: string;
  readonly clock?: CompositionClock;
  readonly logger?: boolean;
  /**
   * TL6-002: the AES-256 key used to encrypt webhook signing secrets at
   * rest. Required for production composition (when DATABASE_URL is
   * present) — the webhook mount refuses to boot without it (honesty
   * law: never fall back to plaintext silently). Tests inject a
   * deterministic 32-byte key. The composition never logs the key.
   */
  readonly webhookEncryptionKey?: WebhookSecretEncryptionKey;
  /**
   * TL6-002: the outbound webhook HTTP client (default: the shipped
   * fetch-based client). Tests inject a recording/failing client to
   * assert delivery semantics without a real receiver URL.
   */
  readonly webhookHttpClient?: import("./webhooks/ports.js").WebhookHttpClient;
  /**
   * AD-003: host/provider availability channels for the /v1/ads query
   * AVAILABLE lane (the AdAvailability surface — declarations, never
   * observations). Absent/empty = the lane is honestly empty with a
   * disclosed note (never faked supply, never catalog-derived
   * availability — rights are never inferred from catalog presence,
   * architecture-lock #23). AD-004: the SAME channels also back the
   * decision-path ad-selection source and the default encounter
   * resolver (one composed supply seam, no second channel registry).
   */
  readonly adAvailabilityChannels?: readonly AdAvailabilityChannel[];
  /**
   * AD-004: the ad-encounter memory capture — when provided, observed
   * outcome events for ad experiences (per the policy's event types)
   * flow into Personal Ad Memory through the AD-002 store port, with
   * the deployment-declared retention basis (law 1: REQUIRED here —
   * capture is never silently defaulted). Absent = outcomes still
   * ingest normally; nothing is captured.
   */
  readonly adMemoryCapture?: {
    readonly policy: AdEncounterCapturePolicy;
    /** Custom resolver (default: memory + the composed availability channels, by experienceId). */
    readonly resolver?: AdEncounterResolver;
  };
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
    // TL6-001: the self-serve account surface.
    readonly accounts: PgAccountStore;
    readonly accountKeys: PgAccountKeyStore;
    readonly accountSessions: PgAccountSessionStore;
    // TL6-002: the production webhook mount (PG stores + the engine).
    readonly webhookEndpoints: PgWebhookEndpointStore;
    readonly webhookEvents: PgWebhookEventStore;
    readonly webhookDeliveries: PgWebhookDeliveryStore;
    // AD-003: Personal Ad Memory (the remembered-lane source for /v1/ads).
    readonly adMemory: PgAdMemoryStore;
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
 * Structural read seams for the runtime decision handler (AD-004:
 * type-level widening of the handler's parameters so in-process tests
 * can mount the REAL handler over non-PG stores — PgCatalogStore and
 * PgPlanStore satisfy both structurally; zero runtime change).
 */
export interface CatalogReadAccess {
  listItems(tenant: TenantScope): Promise<readonly CatalogItem[]>;
  listRealizations(tenant: TenantScope): Promise<readonly Realization[]>;
}

export interface PlanReadAccess {
  get(tenant: TenantScope, planId: string): Promise<{ plan: ExperiencePlan; version: number } | null>;
}

/**
 * The production decision handler: the REAL kernel chain over persisted
 * catalog/context/plan state. The request itself carries candidates,
 * objective, attention policy, constraints and the caller-supplied `at`.
 *
 * AD-004: when the request DECLARES ad candidacy (candidate source ∈
 * the frozen ad-lane vocabulary — the output of the SDK's
 * `buildAdBearingCandidates` over an AD-003 query result, or any host
 * mapping that uses the same sources), the handler resolves ad-lane
 * catalog truth through the optional `adSelection` source (the SAME
 * memory + availability-channel seams the /v1/ads routes read, at the
 * request clock) and merges it with the persisted catalog (catalog
 * truth first; ad-lane truth fills gaps — deterministic). Ads then flow
 * through the ONE kernel chain as ordinary candidates carrying
 * provenance: no second ranking, no ad-specific scoring.
 */
export function createRuntimeDecisionHandler(handlers: {
  catalog: CatalogReadAccess;
  plans: PlanReadAccess;
  adSelection?: AdSelectionSource;
}): NonNullable<PartialHandlerPorts["decisionHandler"]> {
  const { catalog, plans, adSelection } = handlers;
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

      // AD-004 — ad-lane truth for DECLARED ad candidates only. The host
      // declared the candidacy (ad-lane candidate sources in the request's
      // candidate set); this resolves the items/realizations/constraints
      // those candidates need from the ad lane at the request clock. No
      // ad candidates declared ⇒ this stage is a no-op (organic requests
      // are byte-identical to the pre-AD-004 path).
      const catalogItemIds = new Set(items.map((item) => item.itemId));
      let adItems: CatalogItem[] = [];
      let adRealizations: Realization[] = [];
      let itemConstraints: Record<string, readonly HardConstraint[]> = {};
      const declaredAdItemIds = [
        ...new Set(
          request.candidates.candidates
            .filter((candidate) => isAdCandidateSource(candidate.source))
            .map((candidate) => candidate.itemId),
        ),
      ];
      if (adSelection !== undefined && declaredAdItemIds.length > 0) {
        const adTruth = await adSelection.resolve({
          tenant: request.tenant,
          subject: request.subject,
          at: request.at,
          itemIds: declaredAdItemIds,
        });
        // Catalog truth wins; ad-lane truth fills the gaps (an ad the host
        // ALSO ingested to the catalog resolves from the catalog).
        adItems = adTruth.items.filter((item) => !catalogItemIds.has(item.itemId));
        const catalogRealizationIds = new Set(realizations.map((r) => r.realizationId));
        adRealizations = adTruth.realizations.filter((r) => !catalogRealizationIds.has(r.realizationId));
        itemConstraints = adTruth.itemConstraints as Record<string, readonly HardConstraint[]>;
      }

      // Stage 1 — W2-001 candidate normalization over host capability truth
      // (catalog + resolved ad-lane truth — one candidate universe).
      const normalized = normalizeCandidates({
        candidates: request.candidates,
        items: [...items, ...adItems],
        realizations: [...realizations, ...adRealizations],
        tenant: request.tenant,
      });
      if (!normalized.ok) {
        throw new CompositionError(`normalization failed: ${normalized.error.message}`);
      }

      // Stage 2 — W2-003 experience expansion (default host format policy:
      // every declared format; no injected objective-fit — honest absence;
      // AD-004: per-item constraints projected from declared ad eligibility
      // ride the experience's own frozen constraint surface).
      const expansion = expandExperiences({
        candidates: normalized.value,
        items: [...items, ...adItems],
        realizations: [...realizations, ...adRealizations],
        formatPolicy: { allowedFormats: ALL_FORMATS },
        objective: request.objective,
        constraints: request.constraints,
        ...(Object.keys(itemConstraints).length > 0 ? { itemConstraints } : {}),
      });
      if (!expansion.ok) {
        throw new CompositionError(`expansion failed: ${expansion.error.message}`);
      }
      if (expansion.value.experiences.length === 0) {
        throw new CompositionError("no expandable experiences (all candidates excluded)");
      }

      // Stage 3 — W2-002 policy evaluation. The request's declared reward
      // spec is passed through VERBATIM when present (AD-004 composition
      // fix — the frozen DecisionRequest carries `reward` and the policy
      // engine is its one legitimate consumer; dropping it silently
      // discarded host-declared evidence. Still no default: absent reward
      // ⇒ objective-fit evidence only, engagement never implicitly
      // rewarded — lock #22 unchanged).
      const policy = evaluatePolicy({
        experiences: expansion.value.experiences.map((entry) => entry.experience),
        objective: request.objective,
        constraints: request.constraints,
        ...(request.reward !== undefined ? { reward: request.reward } : {}),
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
        // AD-004: per-item constraints on the resolve surface — the same
        // projection the decision path applies to declared ad eligibility.
        ...(request.itemConstraints !== undefined && Object.keys(request.itemConstraints).length > 0
          ? { itemConstraints: request.itemConstraints as Record<string, readonly HardConstraint[]> }
          : {}),
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
  // AD-003: Personal Ad Memory over the same SqlExecutor port (the
  // m007_ad_memory migration ships with applyMigrations — same boot
  // discipline as every other store; no ad-specific boot code).
  const adMemory = new PgAdMemoryStore(executor);

  const sink = new PgEventSink({ executor });
  // TL6-001: the self-serve account surface — real durable stores (ADR-001;
  // the composition always has persistence), the layered authenticator
  // (static env keys FIRST, DB-minted account keys on miss) and the
  // session-authenticated /v1/account route family.
  const accounts = new PgAccountStore(executor, () => clock.now());
  const accountKeys = new PgAccountKeyStore(executor, () => clock.now());
  const accountSessions = new PgAccountSessionStore(executor, () => clock.now());
  const keyStore = new LayeredKeyAuthenticator(options.keys ?? [], accountKeys);

  // TL6-002: the production webhook mount — the SAME delivery engine
  // the in-memory wave ships (createInMemoryWebhookSystem is the
  // frozen delivery engine: emission seam, signing, deterministic
  // retry pump, terminal-never-dropped). The PG stores plug into the
  // SAME port seam the in-memory adapters filled — the engine never
  // changed; only its backing store did. The signing secret is
  // encrypted at rest by PgWebhookEndpointStore (AES-256-GCM); the
  // raw key NEVER appears in SQL parameters after creation and NEVER
  // in logs (the encryption key is held in memory by the store only).
  // Honesty law: refuse to boot the webhook mount without a valid
  // encryption key (never fall back to plaintext silently).
  const webhookEncryptionKey = options.webhookEncryptionKey;
  if (webhookEncryptionKey === undefined) {
    throw new CompositionError(
      "production composition requires WEBHOOK_SECRET_ENCRYPTION_KEY to mount the webhook system (honesty law: never fall back to plaintext signing secrets)",
    );
  }
  const webhookEndpoints = new PgWebhookEndpointStore(executor, webhookEncryptionKey);
  const webhookEvents = new PgWebhookEventStore(executor);
  const webhookDeliveries = new PgWebhookDeliveryStore(executor);
  const webhookHttpClient =
    options.webhookHttpClient ?? new FetchWebhookHttpClient();
  const webhooks = createInMemoryWebhookSystem({
    httpClient: webhookHttpClient,
    clock: () => clock.now(),
    endpointStore: webhookEndpoints,
    eventStore: webhookEvents,
    deliveryStore: webhookDeliveries,
  });

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

  // AD-004: the ad-selection source — the SAME memory store + composed
  // availability channels the /v1/ads routes read, now also backing the
  // decision path's ad-candidate truth resolution (activated only when a
  // request declares ad-lane candidates).
  const adSelectionChannels: readonly AdAvailabilityChannel[] = options.adAvailabilityChannels ?? [];
  const adSelection = createAdSelectionSource({ store: adMemory, channels: adSelectionChannels });

  // AD-004: the optional ad-encounter memory capture (observed outcome
  // events → Personal Ad Memory through the AD-002 store port). Never
  // defaulted: a deployment that wants capture declares its retention
  // basis (law 1). The default resolver is the same memory + channel seam.
  const adCapture =
    options.adMemoryCapture !== undefined
      ? createAdEncounterCapture({
          store: adMemory,
          policy: options.adMemoryCapture.policy,
          resolver:
            options.adMemoryCapture.resolver ??
            createAdEncounterResolver({ store: adMemory, channels: adSelectionChannels }),
        })
      : undefined;

  const decisionHandler = createRuntimeDecisionHandler({ catalog, plans, adSelection });
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
        // AD-004: the ad-encounter memory capture — AFTER the outcome is
        // durable, best-effort by construction (a capture failure is
        // logged and never fails the outcome: the outcome stream is the
        // source of truth; memory is derived from it).
        if (adCapture !== undefined) {
          try {
            const captured = await adCapture.capture(event);
            if (captured.captured && captured.put?.outcome === "inserted") {
              process.stderr.write(
                `[production] ad encounter captured: ${event.eventId} → ${captured.put.record?.recordId ?? "<tombstone>"}\n`,
              );
            }
          } catch (error) {
            process.stderr.write(
              `[production] ad encounter capture failed (outcome unaffected): ${event.eventId}: ${error instanceof Error ? error.message : String(error)}\n`,
            );
          }
        }
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
    // AD-003: the ad-retrieval runtime — remembered lane through the
    // AD-002 store port, available lane through the composed host
    // availability channels (honest empty lane when none are wired).
    adRetrievalHandler: createRuntimeAdRetrievalHandler({
      store: adMemory,
      ...(options.adAvailabilityChannels !== undefined && options.adAvailabilityChannels.length > 0
        ? { channels: options.adAvailabilityChannels }
        : {}),
    }),
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
    // S2-001: catalog reads for `?expand[]=…item` reference resolution —
    // the SAME PgCatalogStore the ingest routes write through, so an
    // expanded item is the persisted truth (not a second read model).
    catalogReader: {
      getItem: async (tenant, itemId) => catalog.getItem(tenant, itemId),
      getRealization: async (tenant, realizationId) => catalog.getRealization(tenant, realizationId),
    },
    experienceResolver: createRuntimeExperienceResolver(),
  };

  const app = buildServer({
    apiVersion: options.apiVersion,
    keys: options.keys,
    // TL6-001: the layered authenticator replaces the plain static
    // KeyStore (static env keys answer FIRST, byte-identically; DB
    // account keys resolve on miss).
    keyStore,
    handlers,
    idempotencyStore: idempotency,
    logger: options.logger,
    // TL6-001: tier-aware rate limiting when the deployment enables it.
    ...(options.rateLimit !== undefined ? { rateLimit: options.rateLimit } : {}),
    // S2-001: the composition clock drives the idempotency window (and
    // the opt-in rate limiter) in production — host time authority.
    clock: () => clock.now(),
    observability: {
      sink: observability,
      clock: () => clock.now(),
      evidenceClass: "controlled-local",
    },
    // TL6-002: the production webhook system — endpoint CRUD + delivery
    // engine + the domain emission seam, all over PostgreSQL stores.
    // buildServer mounts config.webhooks as the webhookHandler port
    // AND decorates the wired decision/outcome/preference handlers to
    // emit thin events (schedule.executed / recommendation.delivered /
    // preference.updated) — see apps/api/src/server.ts.
    webhooks,
  });

  // TL6-001: mount the account routes (session-auth family) on the SAME
  // app — a separate pipeline from the key-auth contract routes.
  registerAccountRoutes(app, { accounts, keys: accountKeys, sessions: accountSessions });

  return {
    app,
    executor,
    transport,
    observability,
    stores: {
      decisions,
      plans,
      catalog,
      preferences,
      contexts,
      events,
      idempotency,
      agents,
      researchJobs,
      accounts,
      accountKeys,
      accountSessions,
      // TL6-002: the production webhook mount — the PG stores the
      // delivery engine drives. Exposed for direct test/e2e assertions
      // (the engine itself is reachable through the wired WebhookSystem
      // → config.webhooks → deps.handlers.webhookHandler).
      webhookEndpoints,
      webhookEvents,
      webhookDeliveries,
      // AD-003: Personal Ad Memory — exposed for direct test/e2e
      // assertions (the route family reaches it through the wired
      // adRetrievalHandler).
      adMemory,
    },
    async close() {
      await app.close();
      await observability.close();
      await executor.close();
    },
  };
}
