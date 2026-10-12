/**
 * Ads retrieval loader (AD-005) — the server-side data path for the Ads
 * section, through the SDK seam EXCLUSIVELY (`getReckonClient()` from
 * `@/lib/reckon-client`, itself `server-only` over `createReckonClient`).
 * The surfaces consumed are the FROZEN public ad surface (AD-003):
 *
 *   POST /v1/ads/query   → reckon.ad-query-result (both lanes, law 9)
 *   POST /v1/ads/forget  → reckon.ad-forget-result (terminal, law 2)
 *   POST /v1/decisions   → the EXISTING decision kernel (the re-rank —
 *                          AD-004's one-pipeline composition, never a
 *                          second ranking in the UI)
 *   POST /v1/experiences/resolve → the documented ad-experience bridge
 *
 * SCOPE (the demo lane): ad queries are subject-scoped (the memory is the
 * SUBJECT's Personal Ad Memory). The studio resolves its scope from the
 * server environment — `RECKON_DEMO_TENANT_ID` (default "demo") and
 * `RECKON_DEMO_SUBJECT_REF` (default "demo-user"), the seed-demo lane's
 * own vocabulary. Both are non-secret, display-safe labels.
 *
 * CLOCK LAW (law 3 / contract rule #4): `at` is REQUIRED and
 * caller-supplied. The loader supplies `Date.now()` at request time, or
 * the URL's pinned `?at=` replay clock when present — deterministic
 * replay for a shareable URL, never a hidden server-side now.
 *
 * HONESTY LAW (Gate Q): this loader never throws and never fabricates.
 * Every failure (not-configured, typed SDK error, untyped failure)
 * surfaces as typed display-safe data the pages render verbatim.
 */
import "server-only";

import {
  isReckonSdkError,
  type AdQueryResult,
  type AdForgetResult,
  type DecisionResult,
  type Experience,
} from "@reckon/sdk";
import type { AdMemoryRecord } from "@reckon/contracts";
import { getReckonClient, ReckonClientNotConfiguredError } from "./reckon-client";
import {
  adQueryRequestInput,
  type AdsQueryFormParams,
  type AdsScope,
  type AdForgetTargetLike,
} from "./ads-view.js";
import { buildAdRerankPlan, adRerankDecisionRequest, type AdRerankPlan } from "./ads-rerank.js";

/* ------------------------------------------------------------------ *
 * Scope (demo lane)
 * ------------------------------------------------------------------ */

/** The demo-lane subject/tenant the studio queries for (display-safe). */
export function adsDemoScope(): AdsScope {
  const tenantId = process.env.RECKON_DEMO_TENANT_ID?.trim() || "demo";
  const subjectRef = process.env.RECKON_DEMO_SUBJECT_REF?.trim() || "demo-user";
  return { tenant: { tenantId }, subject: { kind: "user", ref: subjectRef } };
}

/** Fresh id under a stable prefix (IdSchema: url-safe, 1–128 chars). */
function freshId(prefix: string): string {
  const uuid = globalThis.crypto.randomUUID();
  return `${prefix}-${uuid.replace(/-/g, "").slice(0, 20)}`;
}

/** The evaluation clock: the URL's pinned replay clock, or now. */
export function adsClockFor(params: AdsQueryFormParams): number {
  return params.atMs ?? Date.now();
}

/* ------------------------------------------------------------------ *
 * Failure classification (typed, display-safe)
 * ------------------------------------------------------------------ */

export interface AdsFailure {
  readonly code: string;
  readonly message: string;
  readonly statusCode: number | undefined;
}

function classifyAdsFailure(error: unknown): AdsFailure {
  if (isReckonSdkError(error)) {
    return { code: error.code, message: error.message, statusCode: error.statusCode };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: "UNEXPECTED", message, statusCode: undefined };
}

function notConfigured(): AdsFailure & { readonly reason: string } {
  return {
    code: "NOT_CONFIGURED",
    message:
      "RECKON_DEMO_API_KEY is not set — the Ads section cannot build a server-side SDK client.",
    statusCode: undefined,
    reason:
      "RECKON_DEMO_API_KEY is not set — the Ads section cannot build a server-side SDK client.",
  };
}

/* ------------------------------------------------------------------ *
 * Ad query (both lanes / remembered / available)
 * ------------------------------------------------------------------ */

export type AdQueryRetrieval =
  | { readonly status: "idle" }
  | { readonly status: "not-configured"; readonly reason: string }
  | { readonly status: "error"; readonly failure: AdsFailure }
  | {
      readonly status: "answered";
      readonly result: AdQueryResult;
      /** The evaluation clock actually used (echoed for the view). */
      readonly at: number;
      readonly scope: AdsScope;
    };

/**
 * Run one ad query through the SDK. `mode` rides the normalized form
 * params (default `both`). Never throws; the typed failure surfaces
 * verbatim (Gate Q).
 */
export async function queryAds(
  params: AdsQueryFormParams,
): Promise<AdQueryRetrieval> {
  const at = adsClockFor(params);
  const scope = adsDemoScope();
  try {
    const result = await getReckonClient().ads.query(
      adQueryRequestInput(params, scope, { queryId: freshId("adq") }, at),
    );
    return { status: "answered", result, at, scope };
  } catch (error) {
    if (error instanceof ReckonClientNotConfiguredError) {
      return { status: "not-configured", reason: error.message };
    }
    return { status: "error", failure: classifyAdsFailure(error) };
  }
}

/* ------------------------------------------------------------------ *
 * Ad Memory record detail (UX_DX_GAP: no get-by-id route — resolved
 * through the remembered lane's full listing)
 * ------------------------------------------------------------------ */

export type AdRecordRetrieval =
  | { readonly status: "not-configured"; readonly reason: string }
  | { readonly status: "error"; readonly failure: AdsFailure }
  | { readonly status: "not-retrievable"; readonly requestedId: string }
  | {
      readonly status: "found";
      readonly requestedId: string;
      readonly record: AdMemoryRecord;
      readonly at: number;
    };

/**
 * Resolve one Personal Ad Memory record by id. The public surface has no
 * get-record-by-id route (recorded as a UX_DX_GAP — AD-002's `get` is a
 * store port, not HTTP), so the detail page resolves the record through
 * the remembered lane at the request clock and finds it by recordId.
 *
 * A record that does not appear is NOT retrievable by law: forgotten
 * (law 2, terminal), expired at the clock (law 3), permission-revoked,
 * or unknown. The view states exactly that set — never a fabricated
 * reason.
 */
export async function retrieveAdRecord(recordId: string): Promise<AdRecordRetrieval> {
  const at = Date.now();
  const scope = adsDemoScope();
  try {
    const result = await getReckonClient().ads.query(
      adQueryRequestInput(
        { text: undefined, mode: "remembered", labels: [], surfaces: [], encounteredFromMs: undefined, encounteredUntilMs: undefined, limit: undefined, atMs: undefined },
        scope,
        { queryId: freshId("adr") },
        at,
      ),
    );
    const record = result.remembered.find((candidate) => candidate.record.recordId === recordId);
    if (record === undefined) {
      return { status: "not-retrievable", requestedId: recordId };
    }
    return { status: "found", requestedId: recordId, record: record.record, at };
  } catch (error) {
    if (error instanceof ReckonClientNotConfiguredError) {
      return { status: "not-configured", reason: error.message };
    }
    return { status: "error", failure: classifyAdsFailure(error) };
  }
}

/* ------------------------------------------------------------------ *
 * Forget (the public surface's permission-changing op — law 2)
 * ------------------------------------------------------------------ */

export type AdForgetRetrieval =
  | { readonly status: "not-configured"; readonly reason: string }
  | { readonly status: "error"; readonly failure: AdsFailure }
  | { readonly status: "forgot"; readonly result: AdForgetResult };

/**
 * Forget retained ads (terminal, law 2) through the SDK. The caller clock
 * is supplied HERE (the mutation proxy's own request time); the frozen
 * contract REQUIRES the body-level idempotencyKey (fresh per call).
 */
export async function forgetAds(
  target: AdForgetTargetLike,
  reason: string | undefined,
): Promise<AdForgetRetrieval> {
  const at = Date.now();
  const scope = adsDemoScope();
  try {
    const result = await getReckonClient().ads.forget({
      requestId: freshId("adf"),
      tenant: scope.tenant,
      subject: scope.subject,
      target,
      ...(reason !== undefined ? { reason } : {}),
      at,
      idempotencyKey: freshId("adf-idem"),
    });
    return { status: "forgot", result };
  } catch (error) {
    if (error instanceof ReckonClientNotConfiguredError) {
      return { status: "not-configured", reason: error.message };
    }
    return { status: "error", failure: classifyAdsFailure(error) };
  }
}

/* ------------------------------------------------------------------ *
 * Compare / re-rank through the EXISTING decision kernel
 * ------------------------------------------------------------------ */

export type AdRerankRetrieval =
  | { readonly status: "idle" }
  | { readonly status: "not-configured"; readonly reason: string }
  | { readonly status: "query-error"; readonly failure: AdsFailure }
  /** The lanes yielded no currently-eligible ad candidates at the clock. */
  | { readonly status: "no-candidates"; readonly notes: readonly string[]; readonly at: number }
  | {
      readonly status: "error";
      /** Which stage failed: resolve (experience expansion) or decision (the kernel). */
      readonly stage: "resolve" | "decision";
      readonly failure: AdsFailure;
    }
  | {
      readonly status: "answered";
      readonly queryResult: AdQueryResult;
      readonly decision: DecisionResult;
      readonly experiences: readonly Experience[];
      readonly at: number;
      readonly notes: readonly string[];
    };

/**
 * The compare/re-rank flow (AD-004's one-pipeline composition, never a
 * second ranking): query both lanes → gate + map into ONE CandidateSet
 * (`buildAdBearingCandidates`, SDK) → resolve the ad experiences →
 * declare the ads' USER value through the documented reward term → ONE
 * DecisionRequest through the kernel. The kernel's order is returned
 * verbatim; the UI only presents it.
 */
export async function requestAdRerank(params: AdsQueryFormParams): Promise<AdRerankRetrieval> {
  const at = adsClockFor(params);
  const scope = adsDemoScope();
  const client = getReckonClient();

  let queryResult: AdQueryResult;
  try {
    queryResult = await client.ads.query(
      adQueryRequestInput(params, scope, { queryId: freshId("adq") }, at),
    );
  } catch (error) {
    if (error instanceof ReckonClientNotConfiguredError) {
      return { status: "not-configured", reason: error.message };
    }
    return { status: "query-error", failure: classifyAdsFailure(error) };
  }

  const planOutcome = buildAdRerankPlan({ queryResult, at, setId: freshId("adcs") });
  if (!planOutcome.ok) {
    return { status: "no-candidates", notes: planOutcome.notes, at };
  }
  const plan: AdRerankPlan = planOutcome.plan;

  let experiences: readonly Experience[] = [];
  if (plan.items.length > 0) {
    try {
      const itemConstraints: Record<string, import("@reckon/contracts").HardConstraint[]> = {};
      for (const [itemId, constraints] of Object.entries(plan.itemConstraints)) {
        itemConstraints[itemId] = [...constraints];
      }
      const resolved = await client.experiences.resolve({
        items: [...plan.items],
        realizations: [...plan.realizations],
        ...(Object.keys(itemConstraints).length > 0 ? { itemConstraints } : {}),
      });
      experiences = resolved.experiences;
    } catch (error) {
      // Honest degradation: the re-rank CAN proceed without the reward
      // bridge (objective-fit evidence only) — but the resolve failure is
      // disclosed, never swallowed silently.
      const failure = classifyAdsFailure(error);
      if (failure.code === "NOT_CONFIGURED") {
        return { status: "not-configured", reason: failure.message };
      }
      return { status: "error", stage: "resolve", failure };
    }
  }

  try {
    const decision = await client.decisions.request(
      adRerankDecisionRequest({
        plan,
        scope,
        ids: {
          requestId: freshId("adrq"),
          idempotencyKey: freshId("adrq-idem"),
          contextId: freshId("adctx"),
          rewardId: "ad-compare-user-value",
        },
        at,
        experiences,
      }),
    );
    return {
      status: "answered",
      queryResult,
      decision,
      experiences,
      at,
      notes: [
        ...plan.notes,
        ...(experiences.length === 0
          ? ["no ad experiences resolved — the kernel scored objective-fit evidence only"]
          : []),
      ],
    };
  } catch (error) {
    return { status: "error", stage: "decision", failure: classifyAdsFailure(error) };
  }
}
