/**
 * DELETE /api/dashboard/keys/{keyId} — the studio's server-side proxy
 * for key revocation (S3-001). Attempts the REAL DELETE
 * /v1/api-keys/{id} through the honest seam and returns the typed
 * outcome (same contract as the create proxy; never a fake success).
 */
import { fetchRevokeApiKey } from "@/lib/developers-surface";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ keyId: string }> },
): Promise<Response> {
  const { keyId } = await params;
  if (typeof keyId !== "string" || keyId.trim().length === 0) {
    return Response.json(
      { ok: false, failure: { outcome: "error", detail: "A key id is required.", pendingRoute: "DELETE /v1/api-keys/{id}", httpStatus: null } },
      { status: 400 },
    );
  }

  const result = await fetchRevokeApiKey(keyId.trim());
  if (result.ok) {
    return Response.json({ ok: true, revoked: true });
  }
  const status = result.failure.outcome === "unconfigured" || result.failure.outcome === "unreachable"
    ? 503
    : result.failure.outcome === "not-wired"
      ? 501
      : 502;
  return Response.json({ ok: false, failure: result.failure }, { status });
}
