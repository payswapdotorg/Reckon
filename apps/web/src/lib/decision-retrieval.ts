/**
 * Decision retrieval loader (UI-004) — the server-side data path for the
 * Decisions workspace.
 *
 * Consumes the SDK EXCLUSIVELY through the foundation seam
 * (`getReckonClient()` from `@/lib/reckon-client`, itself `server-only`
 * over `createReckonClient`). The retrieval surface used here is the
 * SDK's decision lookup:
 *
 *   GET /v1/decisions/{decisionId}  →  reckon.decision-result
 *   (apps/api/src/routes/decisions.ts + packages/sdk/src/client.ts)
 *
 * The SDK (W3-002) exposes no recent-decisions listing — decision.request
 * (POST) and decision lookup (GET by id) are the only operations — so
 * this workspace retrieves one decision at a time by id.
 *
 * HONESTY LAW: this loader never throws and never fabricates. Every
 * failure mode surfaces as a typed, display-safe result (SDK error code +
 * message, exactly as the typed ReckonSdkError carries them) so the page
 * can render the precise reason (Gate Q).
 */
import "server-only";

import { isReckonSdkError, type DecisionResult } from "@reckon/sdk";
import { getReckonClient, ReckonClientNotConfiguredError } from "./reckon-client";

export type DecisionRetrieval =
  | { readonly status: "idle" }
  | {
      readonly status: "not-configured";
      readonly requestedId: string;
      readonly reason: string;
    }
  | {
      readonly status: "error";
      readonly requestedId: string;
      /** Typed SDK error code (ReckonSdkError.code) or "UNEXPECTED". */
      readonly code: string;
      readonly message: string;
      /** HTTP status when the server answered. */
      readonly statusCode: number | undefined;
    }
  | {
      readonly status: "found";
      readonly requestedId: string;
      readonly decision: DecisionResult;
    };

/**
 * Retrieve one decision by id through the SDK seam. Never throws — every
 * outcome (including configuration failures and typed SDK errors) is
 * returned as data the workspace renders honestly.
 */
export async function retrieveDecision(decisionId: string): Promise<DecisionRetrieval> {
  try {
    const decision = await getReckonClient().decisions.get(decisionId);
    return { status: "found", requestedId: decisionId, decision };
  } catch (error) {
    if (error instanceof ReckonClientNotConfiguredError) {
      return {
        status: "not-configured",
        requestedId: decisionId,
        reason: error.message,
      };
    }
    if (isReckonSdkError(error)) {
      return {
        status: "error",
        requestedId: decisionId,
        code: error.code,
        message: error.message,
        statusCode: error.statusCode,
      };
    }
    return unexpected(decisionId, error);
  }
}

function unexpected(decisionId: string, error: unknown): DecisionRetrieval {
  const message =
    error instanceof Error
      ? error.message
      : "an untyped failure occurred while retrieving the decision";
  return {
    status: "error",
    requestedId: decisionId,
    code: "UNEXPECTED",
    message,
    statusCode: undefined,
  };
}
