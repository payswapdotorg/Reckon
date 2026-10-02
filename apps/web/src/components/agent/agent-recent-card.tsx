/**
 * AgentRecentCard (UI-007) — the no-id default: recent bodies +
 * organizations from GET /v1/agents/*. Honest empty/error states (Gate Q);
 * organization rows deep-link into the graph view.
 */
import { TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AgentListings, AgentRetrieval } from "@/lib/agent-retrieval";
import styles from "./agent-recent-card.module.css";

export interface AgentRecentCardProps {
  readonly listings: AgentListings | undefined;
  readonly apiKeyNotConfigured: boolean;
}

function stateNote(retrieval: AgentRetrieval<unknown> | undefined): string | null {
  if (retrieval === undefined || retrieval.status === "idle") return null;
  if (retrieval.status === "not-configured") {
    return "Listing unavailable in this studio configuration — the server-side SDK client is not configured (RECKON_DEMO_API_KEY).";
  }
  if (retrieval.status === "error") {
    return `Listing failed — ${retrieval.message}${retrieval.statusCode === undefined ? "" : ` (HTTP ${retrieval.statusCode})`}. Typed SDK error code: ${retrieval.code}.`;
  }
  if (!Array.isArray(retrieval.value) || retrieval.value.length === 0) {
    return "The listing succeeded and the tenant has declared none yet — create one through the API (POST /v1/agents/bodies|organizations).";
  }
  return null;
}

export function AgentRecentCard({ listings, apiKeyNotConfigured }: AgentRecentCardProps) {
  const orgs =
    listings !== undefined && listings.organizations.status === "found"
      ? listings.organizations.value
      : [];
  const bodies =
    listings !== undefined && listings.bodies.status === "found" ? listings.bodies.value : [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent agent declarations</CardTitle>
        <CardDescription>
          The tenant&rsquo;s bodies and organizations, latest version each (
          <code className={styles.inlineCode}>GET /v1/agents/*</code>). Select an organization to
          open its graph and body cards.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {apiKeyNotConfigured ? (
          <p className={styles.warnRow}>
            <TriangleAlert className={styles.warnIcon} aria-hidden />
            <span>
              No demo API key is configured in this studio — listings will report the precise
              configuration failure rather than fabricate data.
            </span>
          </p>
        ) : null}
        <h4 className={styles.sectionTitle}>Organizations</h4>
        {stateNote(listings?.organizations) !== null ? (
          <p className={styles.note}>{stateNote(listings?.organizations)}</p>
        ) : (
          <ul className={styles.list}>
            {orgs.map((org) => (
              <li key={`${org.organizationId}-${org.version}`} className={styles.item}>
                <a
                  href={`/agents?org=${encodeURIComponent(org.organizationId)}`}
                  className={styles.link}
                >
                  <code className={styles.mono}>{org.organizationId}</code>
                  <span className={styles.meta}>
                    <Badge>v{org.version}</Badge>
                    <span>{org.bodies.length} bodies</span>
                    <span>{org.edges.length} edges</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
        <h4 className={styles.sectionTitle}>Bodies</h4>
        {stateNote(listings?.bodies) !== null ? (
          <p className={styles.note}>{stateNote(listings?.bodies)}</p>
        ) : (
          <ul className={styles.list}>
            {bodies.map((body) => (
              <li key={`${body.bodyId}-${body.version}`} className={styles.item}>
                <span className={styles.bodyRow}>
                  <code className={styles.mono}>{body.bodyId}</code>
                  <span className={styles.meta}>
                    <Badge>v{body.version}</Badge>
                    <span>{body.role.roleId}</span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
