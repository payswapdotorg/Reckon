/**
 * AccountStatusCard — the Home dashboard strip (S3-001): the account's
 * LIVE status (the real /healthz probe, same seam as the System status
 * card) plus the account mode badge and the operator quick links into
 * the dashboard sections.
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
}

const QUICK_LINKS: readonly { readonly href: string; readonly label: string; readonly hint: string; readonly icon: typeof Sparkles }[] = [
  { href: "/recommendations", label: "Recommendations", hint: "What was served", icon: Sparkles },
  { href: "/developers/keys", label: "API keys", hint: "Manage sk_/pk_ keys", icon: KeyRound },
  { href: "/developers/logs", label: "Request logs", hint: "Every API call", icon: List },
  { href: "/developers/events", label: "Events", hint: "Webhook console", icon: Radio },
  { href: "/analytics", label: "Analytics", hint: "S3-002", icon: ChartLine },
];

export function AccountStatusCard({ config, probe }: AccountStatusCardProps) {
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
