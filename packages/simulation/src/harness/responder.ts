/**
 * The scripted Reckon responder — a deterministic, contract-valid stand-in
 * for the Reckon API at the SDK's injectable fetch seam (SIM-001).
 *
 * EVIDENCE CLASS: fixture. This responder is NOT the real API — it is the
 * fixture side of the conformance proof. What it proves is the HOST side:
 * the host's requests must validate against the REAL frozen zod contracts
 * (the SDK validates requests before sending), and the responder's replies
 * must validate against the same frozen contracts (the SDK validates
 * responses before returning them) — a contract-parity round-trip on both
 * directions of every operation the loop uses.
 *
 * DETERMINISM: every response is a pure function of the request body
 * (ids are derived from content digests; scores from candidate order).
 * No RNG, no clock, no wall time — the SAME request always yields the
 * SAME response, which is what makes replay byte-identical.
 */
import {
  DecisionRequestSchema,
  DecisionResultSchema,
  OutcomeEventSchema,
  PreferenceDeltaSchema,
  CatalogItemSchema,
  RealizationSchema,
  CandidateSetSchema,
  contentDigest,
  type CandidateReference,
  type DecisionRequest,
  type DecisionResult,
  type Experience,
} from "@reckon/contracts";
import { createReckonClient, type FetchLike } from "@reckon/sdk";
import { createSdkPort, createDeterministicIdGenerator } from "./sdk-port.js";
import type { ReckonPublicPort } from "./port.js";

/** Version stamped into responder provenance. */
export const SCRIPTED_RESPONDER_VERSION = "0.1.0";

/** Provenance system name for responder-produced results. */
export const SCRIPTED_RESPONDER_SYSTEM = "@reckon/simulation-fixture-responder";

const CONTENT_TYPE = "application/json";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": CONTENT_TYPE,
      "x-reckon-mode": "test",
    },
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse(status, { error: { code, message } });
}

/** Deterministic id fragment: first 16 hex chars of the content digest. */
function idFragment(value: unknown): string {
  return contentDigest(value).slice(0, 16);
}

/** The decision an honest scripted responder returns for a request. */
export function scriptedDecisionFor(request: DecisionRequest): DecisionResult {
  const candidates = request.candidates.candidates;
  const selected = candidates[0]!;
  const selectedExperience = experienceForCandidate(selected, 0);

  const alternatives = candidates.slice(1).map((candidate, index) => ({
    experienceId: experienceForCandidate(candidate, index + 1).experienceId,
    score: Math.max(0.1, 1 - 0.1 * (index + 1)),
    reason: "scripted fixture ranking: candidate order preserved",
  }));

  const result = {
    schema: "reckon.decision-result",
    schemaVersion: "0.1.0",
    decisionId: `dec-${idFragment({ requestId: request.requestId, setId: request.candidates.setId })}`,
    requestId: request.requestId,
    tenant: request.tenant,
    action: "QUEUE" as const,
    selectedExperience,
    alternatives,
    policy: {
      policyId: request.policySelector.policyId,
      version: request.policySelector.version,
    },
    scheduleDelta: {
      action: "QUEUE" as const,
      enqueue: [selectedExperience.experienceId],
      dequeue: [],
    },
    reasons: [
      {
        code: "fixture-scripted-decision",
        message: "deterministic scripted response; first candidate selected",
      },
    ],
    provenance: {
      system: SCRIPTED_RESPONDER_SYSTEM,
      version: SCRIPTED_RESPONDER_VERSION,
    },
    at: request.at ?? 0,
  };
  // The responder validates its own output against the frozen contract —
  // a scripted response that violates the contract is a harness bug, not
  // a silent pass.
  return DecisionResultSchema.parse(result);
}

/** Build a contract-valid experience for a candidate reference. */
function experienceForCandidate(candidate: CandidateReference, ordinal: number): Experience {
  const realizationId =
    candidate.realizationIds[0] ?? `real-${idFragment(candidate.itemId).slice(0, 12)}`;
  return {
    schema: "reckon.experience",
    schemaVersion: "0.1.0",
    experienceId: `exp-${idFragment({ itemId: candidate.itemId, realizationId, ordinal })}`,
    itemId: candidate.itemId,
    realizationId,
    format: { kind: "card", params: {} },
    duration: 60,
    transformations: [],
    constraints: [],
  };
}

/** Parse a JSON request body, returning `undefined` on invalid JSON. */
function parseBody(body: unknown): unknown {
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** Every request the responder has served (for fixture diagnostics). */
export interface ScriptedResponderCall {
  readonly method: string;
  readonly path: string;
  readonly status: number;
}

export interface ScriptedResponder {
  /** The FetchLike to inject into `createReckonClient`. */
  readonly fetch: FetchLike;
  /** Served calls so far (diagnostics only — not part of effort records). */
  readonly calls: readonly ScriptedResponderCall[];
}

/**
 * Create the scripted responder. Deterministic: identical requests yield
 * identical responses across processes and runs.
 */
export function createScriptedResponder(): ScriptedResponder {
  const calls: ScriptedResponderCall[] = [];
  const fetch: FetchLike = async (url: string, init: { method?: string; body?: unknown } = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const path = new URL(url).pathname;
    const body = parseBody(init.body);

    let response: Response;
    if (method === "POST" && path === "/v1/catalog/items") {
      const parsed = CatalogItemSchema.safeParse(body);
      response = parsed.success
        ? jsonResponse(200, parsed.data)
        : errorResponse(400, "VALIDATION_ERROR", "catalog item failed contract validation");
    } else if (method === "POST" && path === "/v1/catalog/realizations") {
      const parsed = RealizationSchema.safeParse(body);
      response = parsed.success
        ? jsonResponse(200, parsed.data)
        : errorResponse(400, "VALIDATION_ERROR", "realization failed contract validation");
    } else if (method === "POST" && path === "/v1/candidates") {
      const parsed = CandidateSetSchema.safeParse(body);
      response = parsed.success
        ? jsonResponse(200, parsed.data)
        : errorResponse(400, "VALIDATION_ERROR", "candidate set failed contract validation");
    } else if (method === "POST" && path === "/v1/decisions") {
      const parsed = DecisionRequestSchema.safeParse(body);
      response = parsed.success
        ? jsonResponse(200, scriptedDecisionFor(parsed.data))
        : errorResponse(400, "VALIDATION_ERROR", "decision request failed contract validation");
    } else if (method === "POST" && path === "/v1/outcomes") {
      const parsed = OutcomeEventSchema.safeParse(body);
      response = parsed.success
        ? jsonResponse(200, parsed.data)
        : errorResponse(400, "VALIDATION_ERROR", "outcome event failed contract validation");
    } else if (method === "POST" && path === "/v1/preferences/events") {
      const parsed = PreferenceDeltaSchema.safeParse(body);
      response = parsed.success
        ? jsonResponse(200, parsed.data)
        : errorResponse(400, "VALIDATION_ERROR", "preference delta failed contract validation");
    } else {
      response = errorResponse(404, "NOT_FOUND", `no scripted route for ${method} ${path}`);
    }

    calls.push({ method, path, status: response.status });
    return response;
  };
  return { fetch, calls };
}

/**
 * Compose the full fixture public-surface stack: REAL SDK client over the
 * scripted responder, adapted to the harness port. This is exactly what
 * the conformance fixture uses — the host's loop crosses the REAL SDK
 * validation pipeline twice per operation.
 *
 * Deterministic by construction: the injected idGenerator is a counter
 * (never crypto.randomUUID) and the responder is a pure function of the
 * request body.
 */
export function createFixtureReckonPort(options?: {
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly idempotencyPrefix?: string;
}): {
  readonly port: ReckonPublicPort;
  readonly responder: ScriptedResponder;
} {
  const responder = createScriptedResponder();
  const client = createReckonClient({
    baseUrl: options?.baseUrl ?? "https://reckon.fixture.test",
    apiKey: options?.apiKey ?? "rk_test_simulation_fixture",
    fetchImpl: responder.fetch,
    idGenerator: createDeterministicIdGenerator(options?.idempotencyPrefix ?? "idem"),
  });
  return { port: createSdkPort(client), responder };
}
