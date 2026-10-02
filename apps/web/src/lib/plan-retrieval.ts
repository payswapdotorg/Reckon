/**
 * Plan retrieval loader (UI-005) — the server-side data path for the Plans
 * workspace.
 *
 * Consumes the SDK EXCLUSIVELY through the foundation seam
 * (`getReckonClient()` from `@/lib/reckon-client`, itself `server-only`
 * over `createReckonClient`). The read surface:
 *
 *   GET /v1/plans/{planId}            → reckon.experience-plan (latest)
 *   GET /v1/plans/{planId}/history    → version chain + replan reasons
 *   GET /v1/plans?limit=N             → recent plans (latest each)
 *
 * HONESTY LAW: this loader never throws and never fabricates. Every
 * failure mode surfaces as typed, display-safe data so the page renders
 * the precise reason (Gate Q).
 */
import "server-only";

import { isReckonSdkError, type ExperiencePlan, type PlanVersionEntry } from "@reckon/sdk";
import { getReckonClient, ReckonClientNotConfiguredError } from "./reckon-client";

export type PlanRetrieval =
  | { readonly status: "idle" }
  | { readonly status: "not-configured"; readonly requestedId: string; readonly reason: string }
  | {
      readonly status: "error";
      readonly requestedId: string;
      readonly code: string;
      readonly message: string;
      readonly statusCode: number | undefined;
    }
  | {
      readonly status: "found";
      readonly requestedId: string;
      readonly plan: ExperiencePlan;
      readonly history: readonly PlanVersionEntry[];
    };

export type RecentPlans =
  | { readonly status: "not-configured" }
  | {
      readonly status: "error";
      readonly code: string;
      readonly message: string;
      readonly statusCode: number | undefined;
    }
  | { readonly status: "listed"; readonly plans: readonly ExperiencePlan[] };

function classify(error: unknown): { code: string; message: string; statusCode: number | undefined } {
  if (isReckonSdkError(error)) {
    return { code: error.code, message: error.message, statusCode: error.statusCode };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: "UNEXPECTED", message, statusCode: undefined };
}

/** Retrieve one plan (latest version) + its full replan history by id. */
export async function retrievePlan(planId: string): Promise<PlanRetrieval> {
  try {
    const client = getReckonClient();
    const [plan, history] = await Promise.all([
      client.plans.get(planId),
      client.plans.history(planId).catch(() => [] as readonly PlanVersionEntry[]),
    ]);
    return { status: "found", requestedId: planId, plan, history };
  } catch (error) {
    if (error instanceof ReckonClientNotConfiguredError) {
      return {
        status: "not-configured",
        requestedId: planId,
        reason: error.message,
      };
    }
    const { code, message, statusCode } = classify(error);
    return { status: "error", requestedId: planId, code, message, statusCode };
  }
}

/** List recent plans (latest version each) for the configured tenant. */
export async function listRecentPlans(limit = 20): Promise<RecentPlans> {
  try {
    const plans = await getReckonClient().plans.listRecent({ limit });
    return { status: "listed", plans };
  } catch (error) {
    if (error instanceof ReckonClientNotConfiguredError) {
      return { status: "not-configured" };
    }
    const { code, message, statusCode } = classify(error);
    return { status: "error", code, message, statusCode };
  }
}

/** Normalize a ?id= query param to a plan id (empty → undefined). */
export function normalizePlanId(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 128) : undefined;
}
