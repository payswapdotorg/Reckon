/**
 * Ads re-rank composition (AD-005) — the SERVER-side composition helpers
 * that call into the @reckon/sdk runtime (`buildAdBearingCandidates`,
 * `adUserValueRewardTerm`). This module deliberately lives APART from the
 * pure, client-safe `ads-view.ts`: the SDK pulls Node crypto, so client
 * components must never import this file — only the server loader
 * (`ads-retrieval.ts`) and server components compose these.
 *
 * THE NO-PARALLEL-RANKING LAW (ADR-005 / AD-004): these helpers map ad
 * query candidates into the EXISTING `CandidateSet` consumed by ONE
 * `DecisionRequest`; they carry retrieval HINTS only. Ranking authority
 * stays with the decision kernel — there is no second ranking
 * implementation anywhere in the web app.
 */
import {
  adUserValueRewardTerm,
  buildAdBearingCandidates,
  type AdQueryResult,
  type DecisionRequestInput,
} from "@reckon/sdk";
import type {
  AdUserValueAssessment,
  CandidateSet,
  CatalogItem,
  Realization,
  HardConstraint,
  TimestampMs,
} from "@reckon/contracts";
import type { AdsScope } from "./ads-view.js";

/* ------------------------------------------------------------------ *
 * Compare / re-rank through the EXISTING decision kernel
 * ------------------------------------------------------------------ */

/**
 * The pure re-rank composition: gate an AD-003 query result's lanes at
 * the caller clock (law 3) and map the gated-in ads into ONE CandidateSet
 * through the SDK's frozen-semantics helper (`buildAdBearingCandidates` —
 * positional rankHint, best scoreHint, per-item constraint projection).
 * NO ranking happens here; ranking authority stays with the decision
 * kernel (ADR-005 "no parallel ad-ranking contract").
 */
export function buildAdRerankPlan(input: {
  readonly queryResult: AdQueryResult;
  readonly at: TimestampMs;
  readonly setId: string;
}): { readonly ok: true; readonly plan: AdRerankPlan } | { readonly ok: false; readonly notes: readonly string[] } {
  try {
    const built = buildAdBearingCandidates({
      setId: input.setId,
      adQueryResult: input.queryResult,
      at: input.at,
    });
    return {
      ok: true,
      plan: {
        candidateSet: built.candidateSet,
        items: built.items,
        realizations: built.realizations,
        itemConstraints: built.itemConstraints,
        userValueByItemId: mergedUserValueByItemId(input.queryResult),
        notes: [...built.notes],
      },
    };
  } catch (cause) {
    // The SDK throws a typed error when the merged set would be empty —
    // the honest "nothing to rank" state (never fabricated).
    const message = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, notes: [message] };
  }
}

export interface AdRerankPlan {
  readonly candidateSet: CandidateSet;
  readonly items: readonly CatalogItem[];
  readonly realizations: readonly Realization[];
  readonly itemConstraints: Readonly<Record<string, readonly HardConstraint[]>>;
  readonly userValueByItemId: Readonly<Record<string, AdUserValueAssessment>>;
  readonly notes: readonly string[];
}

/**
 * Both lanes' declared user value by itemId (law 7 — USER value only; the
 * SDK helper collects the available lane's, the remembered lane's
 * candidates carry their own). Commercial value has no ranking path by
 * design and is deliberately absent.
 */
function mergedUserValueByItemId(result: AdQueryResult): Record<string, AdUserValueAssessment> {
  const merged: Record<string, AdUserValueAssessment> = {};
  for (const candidate of result.remembered) {
    if (candidate.userValue !== undefined) {
      merged[candidate.record.ad.itemId] ??= candidate.userValue;
    }
  }
  for (const candidate of result.available) {
    if (candidate.userValue !== undefined) {
      merged[candidate.ad.itemId] ??= candidate.userValue;
    }
  }
  return merged;
}

/**
 * Compose the DecisionRequest input for the re-rank (the studio's declared
 * composition: a `shop` objective, a `balanced` attention policy, the
 * documented `greedy-v1` policy selector, context BY REFERENCE, and — when
 * resolved ad experiences carry declared user value — the SDK's documented
 * user-value reward term (law 7). Ranking authority stays with the kernel.
 */
export function adRerankDecisionRequest(input: {
  readonly plan: AdRerankPlan;
  readonly scope: AdsScope;
  readonly ids: { readonly requestId: string; readonly idempotencyKey: string; readonly contextId: string; readonly rewardId: string };
  readonly at: TimestampMs;
  readonly experiences: readonly { readonly experienceId: string; readonly itemId: string }[];
}): DecisionRequestInput {
  const rewardTerm = adUserValueRewardTerm({
    experiences: input.experiences,
    userValueByItemId: input.plan.userValueByItemId,
  });
  return {
    requestId: input.ids.requestId,
    tenant: input.scope.tenant,
    subject: input.scope.subject,
    objective: { objectiveId: "obj-ad-compare", kind: "shop", params: {} },
    attentionPolicy: { policyId: "att-ad-compare", style: "balanced", params: {} },
    context: { contextId: input.ids.contextId },
    candidates: input.plan.candidateSet,
    ...(rewardTerm !== null
      ? { reward: { rewardId: input.ids.rewardId, terms: [rewardTerm] } }
      : {}),
    policySelector: { policyId: "greedy-v1", version: "1" },
    at: input.at,
    idempotencyKey: input.ids.idempotencyKey,
  };
}
