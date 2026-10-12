/**
 * POST /api/dashboard/ads/forget — the studio's server-side proxy for
 * the terminal ad-forget mutation (AD-005). The browser cannot call the
 * Reckon API directly (the demo key lives only in the server env), so
 * the forget flows post here; this handler attempts the REAL
 * POST /v1/ads/forget through the SDK seam and returns the typed
 * outcome:
 *
 *   200 { ok: true, forgotten: { …AdForgetResult } } — the real result
 *       (forgottenCount + forgottenRecordIds + at, verbatim)
 *   400 { ok: false, failure } — malformed body (the frozen target
 *       vocabulary: record / item / advertiser / all)
 *   502/503 { ok: false, failure } — typed SDK error / not configured
 *
 * Never a fake success (Gate Q): forgetting is terminal (law 2) and the
 * response reports exactly what the API observed.
 */
import { forgetAds } from "@/lib/ads-retrieval";
import { parseAdForgetBody } from "@/lib/ads-view";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, failure: { detail: "the request body must be valid JSON" } },
      { status: 400 },
    );
  }

  const parsed = parseAdForgetBody(body);
  if (!parsed.ok) {
    return Response.json({ ok: false, failure: { detail: parsed.detail } }, { status: 400 });
  }

  const result = await forgetAds(parsed.target, parsed.reason);
  if (result.status === "forgot") {
    return Response.json({
      ok: true,
      forgotten: {
        forgottenCount: result.result.forgottenCount,
        forgottenRecordIds: [...result.result.forgottenRecordIds],
        at: result.result.at,
        detail: `Terminal (law 2): these records can never be retrieved from Personal Ad Memory again. Effect took effect at epoch ${result.result.at}.`,
      },
    });
  }

  // not-configured / typed SDK error — both degrade honestly.
  const status = result.status === "not-configured" ? 503 : 502;
  return Response.json(
    {
      ok: false,
      failure: {
        outcome: result.status === "not-configured" ? "unconfigured" : "error",
        detail:
          result.status === "not-configured"
            ? result.reason
            : `${result.failure.message}${result.failure.statusCode === undefined ? "" : ` (HTTP ${result.failure.statusCode})`}`,
        code: result.status === "not-configured" ? "NOT_CONFIGURED" : result.failure.code,
      },
    },
    { status },
  );
}
