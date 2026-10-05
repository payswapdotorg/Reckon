import {
  DEFAULT_TEST_SCENARIO,
  DecisionResultSchema,
  ExperienceSchema,
  MAGIC_TEST_ITEM_PREFIX,
  TEST_SCENARIOS,
  TestScenarioSchema,
  contentDigest,
  parseMagicTestItemId,
  type DecisionRequest,
  type DecisionResult,
  type Experience,
  type KeyMode,
  type ScheduleAction,
  type TestScenario,
} from "@reckon/contracts";
import { ApiError, ERROR_CODES } from "./errors.js";
import type { DecisionStore } from "./ports.js";
import type { AuthContext } from "./types.js";

/**
 * TEST MODE (S2-003) — Stripe-style test/live separation semantics.
 *
 * Laws implemented here (the S2-001 seam `AuthContext.mode` plugs into
 * exactly this module):
 *
 * 1. SEPARATED TEST STATE. A test-mode request (test key) runs against
 *    state that is separate BY CONSTRUCTION:
 *      - the idempotency map used for test traffic is a DISTINCT store
 *        instance (see server.ts / routes/shared.ts) — a test key can
 *    never replay a live response and vice versa;
 *      - the recommendation path (POST /v1/decisions) NEVER executes the
 *        mounted live decision handler in test mode: it resolves a
 *        canned scenario and records into the mode-isolated
 *        TestModeDecisionStore below. Live keys can never read it
 *        (cross-mode reads are typed MODE_MISMATCH — both directions,
 *        see routes/decisions.ts).
 *
 * 2. CANNED SCENARIOS. Test-mode decision behavior is deterministic: a
 *    scenario is resolved from (a) an explicit body-level `scenario`
 *    string field (stripped by the frozen contract schema — a pure test
 *    hint), (b) a magic `itm_test_<scenario>` candidate item id, or
 *    (c) the `default` fallback. The vocabulary is frozen in
 *    @reckon/contracts (`TEST_SCENARIOS`) and documented in
 *    apps/api/README.md — the docs portal's future test-mode page is
 *    generated from that single source.
 *
 * 3. LIVE-MODE HINT GUARD. Scenario hints are test-mode-only: a LIVE
 *    key carrying a `scenario` field or an `itm_test_` item id on the
 *    decision path is rejected with a typed 403 MODE_MISMATCH
 *    (cross-mode protection; the catalog entry is in @reckon/contracts).
 *
 * 4. MODE MARKERS. Test-mode decision responses carry `mode: "test"`
 *    next to the contract payload and `provenance.system:
 *    "reckon-api-test-mode"` inside it; every authenticated /v1
 *    response carries the `X-Reckon-Mode` header (set in the auth
 *    preHandler) — test traffic is always identifiable.
 *
 * Determinism contract: canned decisionIds and experience ids are pure
 * functions of the request content (contentDigest); `at` comes from the
 * request (default 0) — never the wall clock. Same input → same canned
 * output, no persistence drift.
 */

/** Provenance marker for canned test-mode decisions (schema-valid, in-payload). */
export const TEST_MODE_PROVENANCE_SYSTEM = "reckon-api-test-mode";

/** Deterministic fallback `at` for canned decisions whose request omits it. */
const CANNED_AT_DEFAULT = 0;

/** Scenario → canned scheduler action (the `error` scenario throws instead). */
const SCENARIO_ACTIONS: Readonly<Record<Exclude<TestScenario, "error">, ScheduleAction>> = {
  default: "SUGGEST",
  suggest: "SUGGEST",
  decline: "HOLD",
  hold: "HOLD",
  queue: "QUEUE",
  continue: "CONTINUE",
  switch: "SWITCH",
  interrupt: "INTERRUPT",
  resume: "RESUME",
  end: "END",
};

/** Typed cross-mode violation (stable code: MODE_MISMATCH, class permission_error, HTTP 403). */
function modeMismatch(
  keyMode: KeyMode,
  details: Record<string, unknown>,
  param?: string,
  message?: string,
): ApiError {
  return new ApiError(
    ERROR_CODES.MODE_MISMATCH,
    403,
    message ?? `Mode mismatch: this ${keyMode}-mode request is not allowed to touch the other mode's data or semantics`,
    { keyMode, ...details },
    param,
  );
}

/* ------------------------------------------------------------------ *
 * Live-mode hint guard (cross-mode protection, direction live→test)
 * ------------------------------------------------------------------ */

/**
 * Reject test-mode-only hints on LIVE decision requests (raw body peek,
 * pre-validation — mirrors the tenant peek ordering): a string
 * `scenario` field or any `itm_test_` candidate item id is a typed 403
 * MODE_MISMATCH. Non-string `scenario` values are ignored (the frozen
 * schema strips unknown fields either way).
 */
export function assertNoTestHintsInLiveMode(auth: AuthContext, rawBody: unknown): void {
  if (auth.mode !== "live") return;
  if (rawBody === null || typeof rawBody !== "object" || Array.isArray(rawBody)) return;

  const scenario = (rawBody as { scenario?: unknown }).scenario;
  if (typeof scenario === "string") {
    throw modeMismatch(
      "live",
      {
        hint: "scenario",
        note: "scenario hints are test-mode-only; use an sk_test_ key or remove the scenario field",
      },
      "scenario",
      "Mode mismatch: a live-mode key cannot carry the test-mode-only 'scenario' hint",
    );
  }

  const candidates = (rawBody as { candidates?: { candidates?: unknown } }).candidates?.candidates;
  if (Array.isArray(candidates)) {
    for (const candidate of candidates) {
      if (candidate === null || typeof candidate !== "object") continue;
      const itemId = (candidate as { itemId?: unknown }).itemId;
      if (typeof itemId === "string" && itemId.startsWith(MAGIC_TEST_ITEM_PREFIX)) {
        throw modeMismatch(
          "live",
          {
            hint: "test-item-id",
            itemId,
            note: `item ids with the '${MAGIC_TEST_ITEM_PREFIX}' prefix are reserved for test mode`,
          },
          "candidates",
          `Mode mismatch: a live-mode key cannot reference the reserved test item id '${itemId}'`,
        );
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * Scenario resolution (hints → canned scenario)
 * ------------------------------------------------------------------ */

export interface ResolvedScenario {
  readonly scenario: TestScenario;
  /** Where the scenario came from — surfaced in error details / docs. */
  readonly source: "body-field" | "magic-item-id" | "default";
}

function unknownScenarioError(value: string, param: string, extra?: Record<string, unknown>): ApiError {
  return new ApiError(
    ERROR_CODES.VALIDATION_ERROR,
    400,
    `Unknown test scenario '${value}' (supported scenarios: ${TEST_SCENARIOS.join(", ")})`,
    { supportedScenarios: [...TEST_SCENARIOS], ...extra },
    param,
  );
}

/**
 * Resolve the canned scenario for a test-mode decision request.
 * Priority: body `scenario` field > magic `itm_test_<scenario>` item id
 * > `default`. Unknown values are typed 400s naming the vocabulary.
 */
export function resolveTestScenario(rawBody: unknown, request: DecisionRequest): ResolvedScenario {
  const scenarioHint =
    rawBody !== null && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? (rawBody as { scenario?: unknown }).scenario
      : undefined;
  if (typeof scenarioHint === "string") {
    const parsed = TestScenarioSchema.safeParse(scenarioHint);
    if (!parsed.success) {
      throw unknownScenarioError(scenarioHint, "scenario", { hint: "scenario" });
    }
    return { scenario: parsed.data, source: "body-field" };
  }
  for (const candidate of request.candidates.candidates) {
    const parsed = parseMagicTestItemId(candidate.itemId);
    if (parsed === null) continue;
    if (parsed.scenario === null) {
      throw unknownScenarioError(candidate.itemId.slice(MAGIC_TEST_ITEM_PREFIX.length), "candidates", {
        hint: "test-item-id",
        itemId: candidate.itemId,
      });
    }
    return { scenario: parsed.scenario, source: "magic-item-id" };
  }
  return { scenario: DEFAULT_TEST_SCENARIO, source: "default" };
}

/* ------------------------------------------------------------------ *
 * Canned decision construction (deterministic)
 * ------------------------------------------------------------------ */

function cannedExperience(
  candidate: { readonly itemId: string; readonly realizationIds: readonly string[] },
  scenario: TestScenario,
): Experience {
  const realizationId =
    candidate.realizationIds[0] ??
    `real-test-${contentDigest({ itemId: candidate.itemId, scenario }).slice(0, 16)}`;
  return ExperienceSchema.parse({
    experienceId: `exp-test-${contentDigest({ itemId: candidate.itemId, realizationId, scenario }).slice(0, 20)}`,
    itemId: candidate.itemId,
    realizationId,
    format: { kind: "full", params: {} },
  });
}

/**
 * Build the deterministic canned DecisionResult for a test-mode
 * scenario (the `error` scenario throws a typed 500 instead — see
 * executeTestModeDecision). Pure function of (request, scenario):
 * no wall clock, no randomness, no store reads.
 */
export function cannedDecision(request: DecisionRequest, scenario: TestScenario): DecisionResult {
  if (scenario === "error") {
    throw new ApiError(
      ERROR_CODES.INTERNAL,
      500,
      "Canned test-mode scenario 'error': simulated internal failure for client error-path testing",
      { scenario, testMode: true },
    );
  }
  const action = SCENARIO_ACTIONS[scenario];
  const candidates = request.candidates.candidates;
  const experiences = candidates.map((candidate) => cannedExperience(candidate, scenario));
  const selectedExperienceIndex =
    scenario === "switch" ? Math.min(1, experiences.length - 1) : 0;
  const selects = action === "SUGGEST" || action === "SWITCH" || action === "RESUME";

  const scheduleDelta =
    action === "QUEUE"
      ? { action, enqueue: experiences.map((experience) => experience.experienceId) }
      : action === "INTERRUPT"
        ? {
            action,
            resumeCheckpoint: {
              experienceId: experiences[0]?.experienceId ?? "",
              resumeToken: "test-resume-token",
            },
          }
        : undefined;

  const decisionId = `dec-test-${contentDigest({
    requestId: request.requestId,
    scenario,
    tenant: request.tenant,
    itemIds: candidates.map((candidate) => candidate.itemId),
  }).slice(0, 24)}`;

  return DecisionResultSchema.parse({
    decisionId,
    requestId: request.requestId,
    tenant: request.tenant,
    action,
    ...(selects && experiences[selectedExperienceIndex] !== undefined
      ? { selectedExperience: experiences[selectedExperienceIndex] }
      : {}),
    alternatives: experiences
      .filter((_, index) => !(selects && index === selectedExperienceIndex))
      .map((experience) => ({
        experienceId: experience.experienceId,
        reason: `test scenario '${scenario}' did not select this candidate`,
      })),
    policy: { policyId: request.policySelector.policyId, version: request.policySelector.version },
    ...(scheduleDelta !== undefined ? { scheduleDelta } : {}),
    reasons: [
      {
        code: "test.mode",
        message: "Canned test-mode decision: deterministic, never persisted to live state",
      },
      { code: `test.scenario.${scenario}`, message: `Scenario '${scenario}' → action ${action}` },
    ],
    provenance: { system: TEST_MODE_PROVENANCE_SYSTEM, version: "0.1.0" },
    at: request.at ?? CANNED_AT_DEFAULT,
  });
}

/* ------------------------------------------------------------------ *
 * Test-mode state (separate storage scope — mode-isolated by construction)
 * ------------------------------------------------------------------ */

/**
 * In-memory, tenant-scoped store for canned TEST-mode decisions. Only
 * the test-mode decision path writes/reads it; live keys reach it only
 * through the cross-mode probe in routes/decisions.ts (which turns a
 * hit into a typed MODE_MISMATCH, never a payload). Per-process state:
 * durable test-state infrastructure is the future dashboard wave's
 * surface (documented in apps/api/README.md limitations).
 */
export class TestModeDecisionStore implements DecisionStore {
  readonly #entries = new Map<string, DecisionResult>();

  /** Record (or idempotently overwrite — same content, same id) a canned decision. */
  record(decision: DecisionResult): void {
    this.#entries.set(`${decision.tenant.tenantId}|${decision.decisionId}`, decision);
  }

  async get(tenantId: string, decisionId: string): Promise<DecisionResult | null> {
    return this.#entries.get(`${tenantId}|${decisionId}`) ?? null;
  }

  get size(): number {
    return this.#entries.size;
  }
}

/**
 * Execute a test-mode decision: resolve the scenario, build the canned
 * result (never the mounted live handler — SEPARATION LAW), and record
 * it into the test-mode store so GET /v1/decisions/{id} works in test
 * mode without touching live state.
 */
export function executeTestModeDecision(
  testStore: TestModeDecisionStore,
  rawBody: unknown,
  request: DecisionRequest,
): DecisionResult {
  const resolved = resolveTestScenario(rawBody, request);
  const result = cannedDecision(request, resolved.scenario);
  testStore.record(result);
  return result;
}

/**
 * Probe LIVE state from a test-mode request (cross-mode detection):
 * returns the live decision when it exists for the SAME tenant, null
 * when it does not. An unmounted live store (501 NOT_WIRED) is treated
 * as "no live data" — the probe is a detection aid, never a client
 * surface. Used by GET /v1/decisions/{id} to answer cross-mode reads
 * with a typed MODE_MISMATCH instead of a silent 404.
 */
export async function probeLiveDecision(
  liveStore: DecisionStore,
  tenantId: string,
  decisionId: string,
): Promise<DecisionResult | null> {
  try {
    return await liveStore.get(tenantId, decisionId);
  } catch (error) {
    if (error instanceof ApiError && error.code === ERROR_CODES.NOT_WIRED) return null;
    throw error;
  }
}

/** Cross-mode mismatch for the GET path: key mode vs the mode of the data found. */
export function crossModeMismatch(keyMode: KeyMode, dataMode: KeyMode, decisionId: string): ApiError {
  return modeMismatch(
    keyMode,
    { dataMode, decisionId },
    undefined,
    `Mode mismatch: decision '${decisionId}' is ${dataMode}-mode data and cannot be read with a ${keyMode}-mode key`,
  );
}

/**
 * Mode marker injection (Stripe-style visible test-mode indicator): the
 * test-mode response payload gets a top-level `mode: "test"` sibling
 * next to the (schema-validated) contract object. Additive — clients
 * that ignore it see no change; zod parsing strips it.
 */
export function markTestMode<T extends object>(payload: T): T & { mode: "test" } {
  return { ...payload, mode: "test" as const };
}
