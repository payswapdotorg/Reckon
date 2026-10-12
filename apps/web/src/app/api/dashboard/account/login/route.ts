/**
 * POST /api/dashboard/account/login — the studio's server-side proxy for
 * the login flow (TL6-003). Attempts the REAL POST /v1/account/login
 * through the account seam:
 *
 *   200 { ok: true, account: { email, fullName, tier } }  — only on a real 200
 *   400 { ok: false, failure }                            — malformed body
 *   401 { ok: false, failure }                            — invalid credentials (typed)
 *   501/502/503 { ok: false, failure }                    — not-wired / API error / unreachable
 *
 * The fresh reckonsess_ token moves straight into the httpOnly cookie;
 * the response carries display-safe account metadata only. The API's
 * typed 401 (invalid email or password) passes through as-is — the
 * studio never guesses which part failed.
 */
import { attemptLogin, setStudioSessionCookies } from "@/lib/account-surface";
import { parseJsonBody, proxyFailureResponse } from "@/lib/account-proxy";

export async function POST(request: Request): Promise<Response> {
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const body = parsed.body as Record<string, unknown>;
  const input = {
    email: typeof body["email"] === "string" ? body["email"] : "",
    password: typeof body["password"] === "string" ? body["password"] : "",
  };

  const result = await attemptLogin(input);
  if (result.ok) {
    const display = await setStudioSessionCookies(result.data);
    return Response.json({ ok: true, account: display });
  }
  return proxyFailureResponse(result.failure);
}
