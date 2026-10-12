/**
 * GET /api/dashboard/account/expire?next=… — the expired-session exit
 * (TL6-003). Server components cannot clear cookies (cookie writes are
 * route-handler-only), so a page that observes a 401 from the account
 * API redirects here; this handler clears BOTH session cookies and
 * forwards to /login?reason=expired with a sanitized next target.
 *
 * The `next` param is sanitized through the same open-redirect guard as
 * the login flow (safeNextPath) — an absolute/protocol-relative target
 * collapses to "/".
 */
import { redirect } from "next/navigation";
import { clearStudioSessionCookies } from "@/lib/account-surface";
import { safeNextPath } from "@/lib/auth-view";

export async function GET(request: Request): Promise<never> {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"));
  await clearStudioSessionCookies();
  const target = `/login?reason=expired&next=${encodeURIComponent(next)}`;
  redirect(target);
}
