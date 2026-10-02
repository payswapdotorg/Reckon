/**
 * AdapterCapabilityCard (UI-009) — one §14 capability card per adapter,
 * from the REAL declaration surface. The §14 honesty law is structural:
 * a provider is NEVER "connected" merely because the mapper exists —
 * the declaration's liveVerification.status is fixture-only until a real
 * provider path is verified, and the card displays exactly that.
 */
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdapterDeclarationView } from "@reckon/sdk";
import styles from "./adapter-capability-card.module.css";

export interface AdapterCapabilityCardProps {
  readonly adapter: AdapterDeclarationView;
}

export function AdapterCapabilityCard({ adapter }: AdapterCapabilityCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <code className={styles.id}>{adapter.adapterId}</code>
        </CardTitle>
        <CardDescription>
          {adapter.domain} domain · maps into contract v{adapter.contractVersion}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className={styles.verification}>
          <span className={styles.verificationLabel}>live verification</span>
          <Badge className={styles.fixtureBadge}>{adapter.liveVerification.status}</Badge>
          <span className={styles.evidenceClass}>
            evidence class: <strong>{adapter.liveVerification.evidenceClass}</strong>
          </span>
          <span className={styles.note}>{adapter.liveVerification.note}</span>
        </div>

        <h4 className={styles.sectionTitle}>Capabilities</h4>
        <ul className={styles.capabilities}>
          {adapter.supportedCapabilities.map((capability) => (
            <li key={capability} className={styles.capability}>
              {capability}
            </li>
          ))}
        </ul>
        {adapter.unsupportedCapabilities.length > 0 ? (
          <>
            <h4 className={styles.sectionTitle}>Explicitly not provided (host-authoritative)</h4>
            <ul className={styles.capabilities}>
              {adapter.unsupportedCapabilities.map((capability) => (
                <li key={capability} className={`${styles.capability} ${styles.unsupported}`}>
                  {capability}
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <h4 className={styles.sectionTitle}>Authorization requirements</h4>
        <ul className={styles.requirements}>
          {adapter.authorizationRequirements.map((requirement) => (
            <li key={requirement.resource} className={styles.requirement}>
              <code className={styles.resource}>{requirement.resource}</code>
              <span>{requirement.requirement}</span>
              <Badge>{requirement.enforcedBy}</Badge>
            </li>
          ))}
        </ul>

        <h4 className={styles.sectionTitle}>Declared limits</h4>
        <dl className={styles.limits}>
          <div>
            <dt>max items / import</dt>
            <dd>{adapter.limits.maxItemsPerImport}</dd>
          </div>
          <div>
            <dt>realizations / item</dt>
            <dd>{adapter.limits.maxRealizationsPerItem}</dd>
          </div>
          <div>
            <dt>candidates / set</dt>
            <dd>{adapter.limits.maxCandidatesPerSet}</dd>
          </div>
          <div>
            <dt>mapping latency budget</dt>
            <dd>{adapter.limits.mappingLatencyBudgetMs} ms</dd>
          </div>
        </dl>

        <h4 className={styles.sectionTitle}>Failure semantics</h4>
        <dl className={styles.semantics}>
          {Object.entries(adapter.failureSemantics).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        <p className={styles.provenanceNote}>
          Provenance: host-authoritative ({Object.values(adapter.provenance).length} declared
          sources — the adapter maps host records, it never owns them).
        </p>
      </CardContent>
    </Card>
  );
}
