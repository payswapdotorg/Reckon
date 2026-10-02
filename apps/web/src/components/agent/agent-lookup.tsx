/**
 * AgentLookup (UI-007) — organization-id retrieval field (GET form,
 * JS-optional, shareable /agents?org=…). Mirrors the other workspaces.
 */
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import styles from "./agent-lookup.module.css";

export interface AgentLookupProps {
  readonly currentId: string | undefined;
}

export function AgentLookup({ currentId }: AgentLookupProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Retrieve an organization</CardTitle>
        <CardDescription>
          Organization lookup by id, through the SDK read surface (
          <code className={styles.inlineCode}>GET /v1/agents/organizations/&#123;id&#125;</code>).
          Leave empty to list the tenant&rsquo;s recent bodies and organizations instead.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action="/agents" method="get" role="search" className={styles.form}>
          <div className={styles.inputWrap}>
            <label htmlFor="org-id-input" className={styles.label}>
              Organization id
            </label>
            <input
              id="org-id-input"
              name="org"
              type="text"
              inputMode="text"
              autoComplete="off"
              defaultValue={currentId ?? ""}
              maxLength={128}
              required
              aria-describedby="org-id-hint"
              className={styles.input}
            />
            <p id="org-id-hint" className={styles.hint}>
              The id the host used when declaring the organization.
            </p>
          </div>
          <Button type="submit">Retrieve organization</Button>
        </form>
      </CardContent>
    </Card>
  );
}
