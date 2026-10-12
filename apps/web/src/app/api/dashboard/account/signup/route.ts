/**
 * POST /api/dashboard/account/signup — the studio's server-side proxy for
 * the signup flow (TL6-003). The browser never talks to the Reckon API
 * directly: it posts here, this handler attempts the REAL
 * POST /v1/account/signup through the account seam and returns the typed
 * outcome:
 *
 *   200 { ok: true, account: { email, fullName, tier } }  — only on a real 201
 *   400 { ok: false, failure }                            — malformed body
 *   401/501/502/503 { ok: false, failure }                — typed API failure
 *
 * On success the reckonsess_ token from the API's show-once response
 * moves STRAIGHT into the httpOnly session cookie — the browser never
 * sees the token at all; only display-safe account metadata returns.
 * Never a fake success (Gate Q).
 */
import { attemptSignup, setStudioSessionCookies } from "@/lib/account-surface";
import { parseJsonBody, proxyFailureResponse } from "@/lib/account-proxy";

export async function POST(request: Request): Promise<Response> {
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const body = parsed.body as Record<string, unknown>;
  const input = {
    email: typeof body["email"] === "string" ? body["email"] : "",
    password: typeof body["password"] === "string" ? body["password"] : "",
    fullName: typeof body["fullName"] === "string" ? body["fullName"] : "",
    workspaceName: typeof body["workspaceName"] === "string" ? body["workspaceName"] : "",
  };

  const result = await attemptSignup(input);
  if (result.ok) {
    const display = await setStudioSessionCookies(result.data);
    return Response.json({ ok: true, account: display });
  }
  return proxyFailureResponse(result.failure);
}
