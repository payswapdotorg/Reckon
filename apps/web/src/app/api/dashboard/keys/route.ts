/**
 * POST /api/dashboard/keys — the studio's server-side proxy for key
 * minting (TL6-003, rewired to the ACCOUNT API). The browser cannot call
 * the Reckon API directly (the reckonsess_ token lives in the httpOnly
 * cookie), so the mint flow posts here; this handler attempts the REAL
 * POST /v1/account/keys through the account seam with the cookie's
 * session and returns the typed outcome:
 *
 *   200 { ok: true, key: { …metadata, key: RAW } } — only on a real 201;
 *       the RAW key crosses to the browser EXACTLY ONCE (the reveal UX)
 *   400 { ok: false, failure }                     — malformed body
 *   401 { ok: false, failure }                     — no/expired session
 *       (the stale cookies are cleared — they no longer tell the truth)
 *   501/502/503 { ok: false, failure }             — not-wired / API error / unreachable
 *
 * Never a fake success, never a fabricated secret (Gate Q).
 */
import { attemptCreateKey, clearStudioSessionCookies } from "@/lib/account-surface";
import { parseJsonBody, parseMintKeyBody, proxyFailureResponse } from "@/lib/account-proxy";

export async function POST(request: Request): Promise<Response> {
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const mint = parseMintKeyBody(parsed.body);
  if (!mint.ok) {
    return Response.json(
      {
        ok: false,
        failure: {
          outcome: "error",
          detail: mint.detail,
          code: "REQUEST_INVALID",
          param: null,
          pendingRoute: "POST /v1/account/keys",
          httpStatus: null,
        },
      },
      { status: 400 },
    );
  }

  const result = await attemptCreateKey(mint.input);
  if (result.ok) {
    // The RAW key rides this one response (show-once law); the frozen
    // AccountKeyCreated shape carries metadata + key.
    return Response.json({ ok: true, key: result.data });
  }
  if (result.failure.outcome === "unauthenticated") {
    // The session is dead server-side — the cookies now lie; clear them.
    await clearStudioSessionCookies();
  }
  return proxyFailureResponse(result.failure);
}
