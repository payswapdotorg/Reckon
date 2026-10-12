/**
 * Signup (TL6-003) — the progressive account-creation entry. Server
 * component: sanitizes the `next` target, redirects already-signed-in
 * browsers, and renders the two-step form (account basics → workspace
 * name). Success lands /developers/keys?welcome=1 by default — the
 * product UX's next action (create the first API key).
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignupForm } from "@/components/auth/signup-form";
import { WorkspacePage } from "@/components/workspace-page";
import { getStudioSessionToken } from "@/lib/account-surface";
import { safeNextPath } from "@/lib/auth-view";
import styles from "./signup-page.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create a Reckon API account — signup signs you in immediately and routes you to your first API key.",
};

interface SignupPageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const params = await searchParams;
  const nextPath = safeNextPath(firstParam(params.next));
  const emailParam = firstParam(params.email);
  const initialEmail =
    typeof emailParam === "string" && emailParam.length > 0 && emailParam.length <= 320 && !emailParam.includes(" ")
      ? emailParam
      : "";

  // A signed-in browser has no business on /signup — land the target.
  if ((await getStudioSessionToken()) !== null) {
    redirect(nextPath);
  }

  return (
    <WorkspacePage
      title="Create account"
      subtitle="Progressive signup — your account, then your workspace. You are signed in the moment it exists."
    >
      <div className={styles.cardWrap}>
        <Card>
          <CardHeader>
            <CardTitle>Create your Reckon account</CardTitle>
            <CardDescription>
              The account owns this tenant&apos;s API keys and billing tier (POST /v1/account/signup). The first session
              starts immediately — the token never renders in this browser.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SignupForm nextPath={nextPath} initialEmail={initialEmail} />
          </CardContent>
        </Card>
      </div>
    </WorkspacePage>
  );
}
