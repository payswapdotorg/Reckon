/**
 * Overview workspace data loading (UI-003).
 *
 * The ONLY way this module obtains decision state is the studio's
 * server-only SDK seam (`getReckonClient` → `@reckon/sdk`), per FINAL TL
 * HANDOFF §29 and the apps/web law: consume @reckon/sdk + frozen contract
 * types only; never a database, never domain internals.
 *
 * HONESTY LAW (Gate Q): the SDK surface (W3-002) is write + read-by-id —
 * there is no "latest decision", no decision list, no plan read, no
 * outcome list, no metrics/integrations/learning surface. This module
 * therefore exposes exactly one real read (`decisions.get(id)`) and maps
 * every failure to a typed, honest failure describing what actually
 * happened. It never fabricates, infers, or synthesizes decision state.
 */
import "server-only";
import {
  isReckonSdkError,
  ReckonAuthError,
  ReckonNotFoundError,
  ReckonNotWiredError,
  ReckonResponseContractError,
  ReckonScopeError,
  ReckonTenantMismatchError,
  ReckonTransportError,
  ReckonValidationError,
  type DecisionResult,
} from "@reckon/sdk";
import { ReckonClientNotConfiguredError, getReckonClient } from "./reckon-client";

/** Honest failure taxonomy for the by-id decision read. */
export type NextActionFailureKind =
  | "not-configured"
  | "unreachable"
  | "unauthenticated"
  | "not-found"
  | "tenant-mismatch"
  | "insufficient-scope"
  | "invalid-request"
  | "not-wired"
  | "contract-violation"
  | "unknown";

export interface NextActionFailure {
  readonly kind: NextActionFailureKind;
  /** The typed SDK error code (`SdkErrorCode`), when the failure came from the SDK. */
  readonly code: string | null;
  /** What actually happened — the SDK's own message, verbatim. Never rewritten into a fake reason. */
  readonly message: string;
}

export type NextActionResult =
  | { readonly status: "idle" }
  | {
      readonly status: "loaded";
      readonly decision: DecisionResult;
      /** Server-side read time (ISO) — when the studio actually fetched the answer. */
      readonly fetchedAt: string;
    }
  | {
      readonly status: "failed";
      readonly decisionId: string;
      readonly failure: NextActionFailure;
    };

/**
 * Normalize the `?decision=` query parameter into a decision id (or null
 * when absent/blank). Accepts the app-router `string | string[]` shape and
 * takes the first value — no interpretation beyond trimming whitespace.
 */
export function normalizeDecisionId(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mapFailure(error: unknown): NextActionFailure {
  if (error instanceof ReckonNotFoundError) {
    return { kind: "not-found", code: error.code, message: error.message };
  }
  if (error instanceof ReckonAuthError) {
    return { kind: "unauthenticated", code: error.code, message: error.message };
  }
  if (error instanceof ReckonTenantMismatchError) {
    return { kind: "tenant-mismatch", code: error.code, message: error.message };
  }
  if (error instanceof ReckonScopeError) {
    return { kind: "insufficient-scope", code: error.code, message: error.message };
  }
  if (error instanceof ReckonTransportError) {
    return { kind: "unreachable", code: error.code, message: error.message };
  }
  if (error instanceof ReckonValidationError) {
    return { kind: "invalid-request", code: error.code, message: error.message };
  }
  if (error instanceof ReckonNotWiredError) {
    return { kind: "not-wired", code: error.code, message: error.message };
  }
  if (error instanceof ReckonResponseContractError) {
    return { kind: "contract-violation", code: error.code, message: error.message };
  }
  if (isReckonSdkError(error)) {
    return { kind: "unknown", code: error.code, message: error.message };
  }
  return {
    kind: "unknown",
    code: null,
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Load the "what should happen next" answer for a decision id through the
 * SDK seam (`GET /v1/decisions/{decisionId}`). Never throws: every outcome
 * — including an absent demo key — is returned as an honest result state.
 */
export async function loadNextAction(decisionId: string | null): Promise<NextActionResult> {
  if (decisionId === null) {
    return { status: "idle" };
  }

  let client: ReturnType<typeof getReckonClient>;
  try {
    client = getReckonClient();
  } catch (error) {
    if (error instanceof ReckonClientNotConfiguredError) {
      return {
        status: "failed",
        decisionId,
        failure: {
          kind: "not-configured",
          code: null,
          message:
            "RECKON_DEMO_API_KEY is not set — the studio cannot build a server-side SDK client, so no decision can be read.",
        },
      };
    }
    return { status: "failed", decisionId, failure: mapFailure(error) };
  }

  try {
    const decision = await client.decisions.get(decisionId);
    return { status: "loaded", decision, fetchedAt: new Date().toISOString() };
  } catch (error) {
    return { status: "failed", decisionId, failure: mapFailure(error) };
  }
}
