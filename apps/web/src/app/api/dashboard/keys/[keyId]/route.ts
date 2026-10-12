/**
 * DELETE /api/dashboard/keys/{keyId} — the studio's server-side proxy for
 * key revocation (TL6-003, rewired to the ACCOUNT API). Attempts the REAL
 * DELETE /v1/account/keys/{keyId} with the cookie's session and returns
 * the typed outcome (same contract as the mint proxy; never a fake
 * success):
 *
 *   200 { ok: true, revoked: true } — only on a real 204
 *   400 { ok: false, failure }      — missing/empty key id
 *   401 { ok: false, failure }      — no/expired session (cookies cleared)
 *   404 → 502 { ok: false, failure }— the API's typed NOT_FOUND (httpStatus carried)
 *   501/502/503 { ok: false, failure }
 */
import { attemptRevokeKey, clearStudioSessionCookies } from "@/lib/account-surface";
import { proxyFailureResponse } from "@/lib/account-proxy";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ keyId: string }> },
): Promise<Response> {
  const { keyId } = await params;
  if (typeof keyId !== "string" || keyId.trim().length === 0) {
    return Response.json(
      {
        ok: false,
        failure: {
          outcome: "error",
          detail: "A key id is required.",
          code: "REQUEST_INVALID",
          param: null,
          pendingRoute: "DELETE /v1/account/keys/{keyId}",
          httpStatus: null,
        },
      },
      { status: 400 },
    );
  }

  const result = await attemptRevokeKey(keyId.trim());
  if (result.ok) {
    return Response.json({ ok: true, revoked: true });
  }
  if (result.failure.outcome === "unauthenticated") {
    // The session is dead server-side — the cookies now lie; clear them.
    await clearStudioSessionCookies();
  }
  return proxyFailureResponse(result.failure);
}
