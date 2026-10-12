/**
 * AccountStatusCard — the Home dashboard strip (S3-001): the account's
 * LIVE status (the real /healthz probe, same seam as the System status
 * card) plus the account mode badge and the operator quick links into
 * the dashboard sections.
 *
 * TL6-003: the strip now carries the SESSION row — the display-safe
 * signed-in identity from the studio's session cookie, or the honest
 * signed-out state with the signup/sign-in links. Never the raw token
 * (httpOnly).
 *
 * Server component except the mode badge (a tiny client island — the
 * toggle state is account-level client state).
 */
import Link from "next/link";
import { ArrowRight, KeyRound, List, Radio, Sparkles, ChartLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ModeBadge } from "@/components/shell/mode-badge";
import type { ReckonApiDisplayConfig } from "@/lib/reckon-client";
import type { ReckonApiProbe } from "@/lib/reckon-status";
import styles from "./account-status-card.module.css";

export interface AccountStatusCardProps {
  readonly config: ReckonApiDisplayConfig;
  readonly probe: ReckonApiProbe;
  /** Display-safe signed-in account metadata, or null (TL6-003). */
  readonly account: { readonly email: string; readonly fullName: string; readonly tier: string } | null;
}

const QUICK_LINKS: readonly { readonly href: string; readonly label: string; readonly hint: string; readonly icon: typeof Sparkles }[] = [
  { href: "/recommendations", label: "Recommendations", hint: "What was served", icon: Sparkles },
  { href: "/developers/keys", label: "API keys", hint: "Manage sk_/pk_ keys", icon: KeyRound },
  { href: "/developers/logs", label: "Request logs", hint: "Every API call", icon: List },
  { href: "/developers/events", label: "Events", hint: "Webhook console", icon: Radio },
  { href: "/analytics", label: "Analytics", hint: "S3-002", icon: ChartLine },
];

export function AccountStatusCard({ config, probe, account }: AccountStatusCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className={styles.titleRow}>
          Account status
          <ModeBadge />
        </CardTitle>
        <CardDescription>
          Live state of this account, probed server-side at page request — nothing simulated.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className={styles.rows}>
          <div className={styles.row}>
            <dt className={styles.rowKey}>Studio session</dt>
            <dd className={styles.rowValue}>
              {account !== null ? (
                <>
                  <span className={styles.sessionName}>{account.fullName}</span>
                  <code className={styles.sessionEmail}>{account.email}</code>
                  <Badge uppercase>{account.tier}</Badge>
                </>
              ) : (
                <>
                  <span className={styles.sessionOut}>Not signed in</span>
                  <Link href="/signup" className={styles.sessionLink}>
                    Create account
                  </Link>
                  <Link href="/login" className={styles.sessionLink}>
                    Sign in
                  </Link>
                </>
              )}
            </dd>
          </div>
          <div className={styles.row}>
            <dt className={styles.rowKey}>API endpoint</dt>
            <dd className={styles.rowValue}>
              <code className={styles.code}>{probe.baseUrl}</code>
              {config.demoApiKeyConfigured ? (
                <Badge>demo key configured</Badge>
              ) : (
                <Badge uppercase>RECKON_DEMO_API_KEY not set</Badge>
              )}
            </dd>
          </div>
          <div className={styles.row}>
            <dt className={styles.rowKey}>Reachability</dt>
            <dd className={styles.rowValue}>
              <span className={probe.reachable ? styles.dotOk : styles.dotDown} aria-hidden="true" />
              <span className={styles.probeDetail}>{probe.detail}</span>
            </dd>
          </div>
        </dl>

        <div className={styles.quickLinks}>
          <h3 className={styles.quickLinksTitle}>Quick links</h3>
          <ul className={styles.quickList}>
            {QUICK_LINKS.map((link) => {
              const Icon = link.icon;
              return (
                <li key={link.href}>
                  <Link href={link.href} className={styles.quickLink}>
                    <Icon aria-hidden="true" size={15} strokeWidth={1.75} className={styles.quickIcon} />
                    <span className={styles.quickText}>
                      <span className={styles.quickLabel}>{link.label}</span>
                      <span className={styles.quickHint}>{link.hint}</span>
                    </span>
                    <ArrowRight aria-hidden="true" size={13} strokeWidth={1.75} className={styles.quickArrow} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
