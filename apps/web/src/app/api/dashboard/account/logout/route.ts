/**
 * POST /api/dashboard/account/logout — the studio's server-side proxy for
 * logout (TL6-003). Attempts the REAL POST /v1/account/logout with the
 * session cookie's token and reports the observed outcome HONESTLY:
 *
 *   200 { ok: true, detail? } — the API revoked the session (204), OR the
 *                               session was already invalid server-side
 *                               (401 — clearing the cookies is then the
 *                               truthful act), OR no session cookie was
 *                               present at all;
 *   501/502/503 { ok: false, failure } — the API could not be reached or
 *                               answered with another typed failure: the
 *                               cookies are KEPT (the session is still
 *                               alive server-side — stranding a valid
 *                               session to fake a logout would be the
 *                               silent fallback Gate Q forbids) and the
 *                               operator may retry.
 */
import { attemptLogout, clearStudioSessionCookies } from "@/lib/account-surface";
import { proxyFailureResponse } from "@/lib/account-proxy";

export async function POST(): Promise<Response> {
  const result = await attemptLogout();
  if (result.ok) {
    await clearStudioSessionCookies();
    return Response.json({ ok: true, detail: "The session was revoked on the API and cleared from this browser." });
  }
  if (result.failure.outcome === "unauthenticated") {
    // The API says the session no longer exists server-side — the local
    // cookies are now a lie, so clearing them is the honest act.
    await clearStudioSessionCookies();
    return Response.json({
      ok: true,
      detail: "The session had already expired or been revoked — the local session state is cleared.",
    });
  }
  return proxyFailureResponse(result.failure);
}
