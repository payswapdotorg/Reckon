/**
 * SystemStatusCard — the ONE foundation-page surface where the
 * EvidenceClassBadge may appear (per the UI-002 work order): a small
 * "system status" card demonstrating the five classes while reporting the
 * REAL connection state of this studio instance.
 *
 * Honesty law (Gate Q): every row states what was actually observed. The
 * reachability row carries the `observed` badge because it is a real
 * probe result; the API endpoint row shows configuration (not observation).
 * Nothing here is fabricated.
 */
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EvidenceClassBadge } from "@/components/ui/evidence-class-badge";
import type { ReckonApiDisplayConfig } from "@/lib/reckon-client";
import type { ReckonApiProbe } from "@/lib/reckon-status";
import { EVIDENCE_CLASSES } from "@/lib/evidence";
import styles from "./system-status-card.module.css";

export interface SystemStatusCardProps {
  config: ReckonApiDisplayConfig;
  probe: ReckonApiProbe;
}

export function SystemStatusCard({ config, probe }: SystemStatusCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>System status</CardTitle>
        <CardDescription>
          Live connection state of this Reckon Studio instance — probed server-side at page
          request. Nothing here is simulated.
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
              <span
                className={probe.reachable ? styles.dotOk : styles.dotDown}
                aria-hidden="true"
              />
              <span className={styles.probeDetail}>{probe.detail}</span>
              <EvidenceClassBadge evidenceClass="observed" />
            </dd>
          </div>
          <div className={styles.row}>
            <dt className={styles.rowKey}>Checked at</dt>
            <dd className={styles.rowValue}>
              <time className={styles.code} dateTime={probe.checkedAt}>
                {probe.checkedAt}
              </time>
            </dd>
          </div>
        </dl>

        <div className={styles.evidenceSection}>
          <h4 className={styles.evidenceHeading}>Evidence classes</h4>
          <p className={styles.evidenceNote}>
            Every datum in Reckon Studio carries one of five evidence classes. UI-003 onward
            badges all data this way — a high rank is never presented as observed reality.
          </p>
          <ul className={styles.evidenceList}>
            {EVIDENCE_CLASSES.map((evidenceClass) => (
              <li key={evidenceClass.id} className={styles.evidenceItem}>
                <EvidenceClassBadge evidenceClass={evidenceClass.id} withTitle={false} />
                <span className={styles.evidenceDescription}>{evidenceClass.description}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
