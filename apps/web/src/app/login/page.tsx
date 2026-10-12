/**
 * Login (TL6-003) — the session entry point. Server component: resolves
 * the honest notice (why the user landed here: expired session, a
 * protected-route bounce, a completed sign-out), sanitizes the `next`
 * target, and redirects already-signed-in browsers to their target (a
 * signed-in browser has nothing to do here).
 *
 * The page renders inside the studio shell (additive law: no app-tree
 * restructuring in this wave — the standalone-auth-layout candidate is
 * recorded in docs/ux/tl6-003-dashboard-auth.md).
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/components/auth/login-form";
import { WorkspacePage } from "@/components/workspace-page";
import { getStudioSessionToken } from "@/lib/account-surface";
import { isLoginNoticeReason, loginNoticeFor, safeNextPath } from "@/lib/auth-view";
import styles from "./login-page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Reckon Studio to manage this account's API keys.",
};

interface LoginPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = safeNextPath(firstParam(params.next));
  const reason = firstParam(params.reason);
  const emailParam = firstParam(params.email);
  const initialEmail =
    typeof emailParam === "string" && emailParam.length > 0 && emailParam.length <= 320 && !emailParam.includes(" ")
      ? emailParam
      : "";

  // A signed-in browser has no business on /login — land the target.
  if ((await getStudioSessionToken()) !== null) {
    redirect(nextPath);
  }

  const notice = isLoginNoticeReason(reason) ? loginNoticeFor(reason) : null;

  return (
    <WorkspacePage title="Sign in" subtitle="The session entry for this Reckon Studio browser.">
      <div className={styles.cardWrap}>
        <Card>
          <CardHeader>
            <CardTitle>Sign in to Reckon</CardTitle>
            <CardDescription>
              Sessions are minted by the API (POST /v1/account/login) and held in an httpOnly cookie — 7-day lifetime,
              revoked on sign-out.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm nextPath={nextPath} notice={notice} initialEmail={initialEmail} />
          </CardContent>
        </Card>
      </div>
    </WorkspacePage>
  );
}
