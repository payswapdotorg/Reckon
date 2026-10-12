/**
 * SessionStatusCard — the account-access surface for Home and Settings
 * (TL6-003). Server-rendered from the studio's real session state:
 *
 *  - signed in → the display-safe account (email, name, tier), the
 *    session lifetime note and the sign-out affordance (the raw
 *    reckonsess_ token never appears — it lives in the httpOnly cookie);
 *  - signed out → the honest state plus the sign-up / sign-in CTAs and
 *    the pointer to the account-owned key management.
 *
 * Server component (only the sign-out button is a client island).
 */
import Link from "next/link";
import { KeyRound, LogIn, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { StudioAccountDisplay } from "@/lib/account-surface";
import styles from "./session-status-card.module.css";

export interface SessionStatusCardProps {
  /** The display-safe account metadata, or null when signed out. */
  readonly account: StudioAccountDisplay | null;
  /** Which surface this card renders on (used in the heading). */
  readonly surfaceName: "Home" | "Settings";
}

export function SessionStatusCard({ account, surfaceName }: SessionStatusCardProps) {
  if (account === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className={styles.titleRow}>
            <UserRound aria-hidden="true" size={16} strokeWidth={1.75} />
            Account access
          </CardTitle>
          <CardDescription>
            This browser has no Reckon session. Signup creates the account and signs you in immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className={styles.signedOutRow}>
            <p className={styles.signedOutNote}>
              Managing this account&apos;s <code className={styles.code}>sk_</code>/<code className={styles.code}>pk_</code> keys
              requires a session — the keys surface redirects here until you sign in.
            </p>
            <div className={styles.ctaRow}>
              <Button href="/signup" variant="primary" size="md" leadingIcon={<LogIn aria-hidden="true" size={14} />}>
                Create account
              </Button>
              <Button href="/login" variant="secondary" size="md">
                Sign in
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className={styles.titleRow}>
          <UserRound aria-hidden="true" size={16} strokeWidth={1.75} />
          Account access
        </CardTitle>
        <CardDescription>
          {surfaceName} view of this browser&apos;s Reckon session — probed from the studio&apos;s session cookie, never fabricated.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className={styles.rows}>
          <div className={styles.row}>
            <dt className={styles.rowKey}>Signed in as</dt>
            <dd className={styles.rowValue}>
              <span className={styles.accountName}>{account.fullName}</span>
              <span className={styles.accountEmail}>{account.email}</span>
            </dd>
          </div>
          <div className={styles.row}>
            <dt className={styles.rowKey}>Billing tier</dt>
            <dd className={styles.rowValue}>
              <Badge uppercase>{account.tier}</Badge>
              <span className={styles.tierNote}>
                Per-minute rate limits branch on the tier the API reports for the account&apos;s keys.
              </span>
            </dd>
          </div>
          <div className={styles.row}>
            <dt className={styles.rowKey}>Session</dt>
            <dd className={styles.rowValue}>
              <span className={styles.sessionNote}>
                httpOnly cookie, 7-day lifetime enforced by the API. The raw token is never rendered.
              </span>
            </dd>
          </div>
        </dl>
        <div className={styles.actionsRow}>
          <Button href="/developers/keys" variant="secondary" size="md" leadingIcon={<KeyRound aria-hidden="true" size={14} />}>
            Manage API keys
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
