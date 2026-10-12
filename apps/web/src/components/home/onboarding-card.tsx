/**
 * OnboardingCard — "Serve your first recommendation" (S3-001 + TL6-003):
 * the Home onboarding card that ties the dashboard to the docs quickstart
 * (the S1-004 docs portal's crown-jewel flow). Steps link to the REAL
 * dashboard surfaces; the code snippet is the SDK's documented usage
 * (packages/sdk — the actual first-call shape, not invented sample
 * code).
 *
 * TL6-003 — the progressive ladder now starts at the ACCOUNT step: the
 * session state is real, server-verified state (read from the studio's
 * session cookie server-side), so step 1 renders the verified signed-in
 * identity — or the create-account/sign-in links when signed out.
 *
 * HONESTY LAW: the REMAINING steps' completion cannot be verified yet —
 * the surfaces that would report it (request logs) are not wired. Those
 * steps render as links with their real state stated, never as fake
 * checkmarks.
 */
import Link from "next/link";
import { ArrowRight, BookOpen, Check, KeyRound, List, UserRound } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import styles from "./onboarding-card.module.css";

export interface OnboardingCardProps {
  /** Docs portal origin (env-overridable, default https://docs.reckon.dev). */
  readonly quickstartHref: string;
  /** Display-safe signed-in account metadata, or null (TL6-003). */
  readonly account: { readonly email: string; readonly fullName: string; readonly tier: string } | null;
}

export function OnboardingCard({ quickstartHref, account }: OnboardingCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Serve your first recommendation</CardTitle>
        <CardDescription>
          The quickstart path, end to end: create your account, create a key, make the call, watch it land. Key creation
          is live; the later steps&apos; progress cannot be verified yet — the request-log surface that would report it
          is not wired (see Developers).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className={styles.steps}>
          <li className={styles.step}>
            <span className={styles.stepNumber} aria-hidden="true">1</span>
            <div className={styles.stepBody}>
              {account !== null ? (
                <>
                  <span className={styles.stepDone}>
                    <Check aria-hidden="true" size={14} strokeWidth={2} className={styles.stepDoneIcon} />
                    Signed in as <code className={styles.stepCode}>{account.email}</code>
                    <span className={styles.stepDoneTier}>({account.tier} tier)</span>
                  </span>
                  <p className={styles.stepNote}>
                    Verified from the studio&apos;s session cookie — the account owns this tenant&apos;s API keys.
                  </p>
                </>
              ) : (
                <>
                  <span className={styles.stepTitle}>Create your account</span>
                  <p className={styles.stepNote}>
                    Signup is progressive — account, then workspace — and signs you in immediately.{" "}
                    <Link href="/signup" className={styles.stepInlineLink}>
                      Create account
                    </Link>{" "}
                    or{" "}
                    <Link href="/login" className={styles.stepInlineLink}>
                      sign in
                    </Link>
                    .
                  </p>
                </>
              )}
            </div>
          </li>
          <li className={styles.step}>
            <span className={styles.stepNumber} aria-hidden="true">2</span>
            <div className={styles.stepBody}>
              <Link href="/developers/keys" className={styles.stepLink}>
                <KeyRound aria-hidden="true" size={14} strokeWidth={1.75} className={styles.stepIcon} />
                Create an API key
                <ArrowRight aria-hidden="true" size={12} strokeWidth={1.75} />
              </Link>
              <p className={styles.stepNote}>
                A secret key (<code className={styles.stepCode}>sk_…</code>) authenticates server-side
                calls. The secret is shown exactly once.
              </p>
            </div>
          </li>
          <li className={styles.step}>
            <span className={styles.stepNumber} aria-hidden="true">3</span>
            <div className={styles.stepBody}>
              <span className={styles.stepTitle}>Make the call</span>
              <pre className={styles.snippet}>
                <code>{`import { createReckonClient } from "@reckon/sdk";

const reckon = createReckonClient({
  baseUrl: "https://your-reckon-api.example.com",
  apiKey: process.env.RECKON_API_KEY!,
});

const result = await reckon.decisions.request({
  requestId: "req-1",
  tenant: { tenantId: "my-tenant" },
  subject: { kind: "user", ref: "user-9" },
  objective: { objectiveId: "obj-1", kind: "relax" },
  attentionPolicy: { policyId: "ap-1", style: "balanced" },
  context: { contextId: "ctx-1" },
  candidates: { setId: "cs-1", candidates: [{ itemId: "item-1", source: "host-retrieval" }] },
  policySelector: { policyId: "greedy-v1" },
  idempotencyKey: "idem-1",
});`}</code>
              </pre>
              <p className={styles.stepNote}>
                The SDK&apos;s documented first call — a decision request with candidates and an
                idempotency key (S2-001 semantics).
              </p>
            </div>
          </li>
          <li className={styles.step}>
            <span className={styles.stepNumber} aria-hidden="true">4</span>
            <div className={styles.stepBody}>
              <Link href="/developers/logs" className={styles.stepLink}>
                <List aria-hidden="true" size={14} strokeWidth={1.75} className={styles.stepIcon} />
                See it in the request logs
                <ArrowRight aria-hidden="true" size={12} strokeWidth={1.75} />
              </Link>
              <p className={styles.stepNote}>
                Method, route, status, latency and the key prefix — cursor-paginated the S2-001 way.
              </p>
            </div>
          </li>
        </ol>
        <p className={styles.docsRow}>
          <BookOpen aria-hidden="true" size={14} strokeWidth={1.75} className={styles.docsIcon} />
          The full quickstart — with integration-option tabs — lives on the{" "}
          <a href={quickstartHref} className={styles.docsLink} rel="noreferrer" target="_blank">
            docs portal
          </a>
          .
        </p>
      </CardContent>
    </Card>
  );
}
