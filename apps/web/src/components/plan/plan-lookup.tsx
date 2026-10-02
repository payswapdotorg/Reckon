/**
 * PlanLookup (UI-005) — the plan-id retrieval field.
 *
 * A plain HTML GET form (`action="/plans" method="get"`): the lookup works
 * without client JavaScript, the requested id becomes a shareable URL
 * (`/plans?id=…`) and the server component re-renders the workspace from
 * real SDK data. Mirrors the Decision workspace lookup (UI-004).
 *
 * HONESTY: the input's pattern/maxLength mirror the frozen IdSchema shape
 * (1–128 url-safe chars) as a UX nicety ONLY — the API remains the sole
 * authority; the studio never re-implements contract validation.
 */
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import styles from "./plan-lookup.module.css";

export interface PlanLookupProps {
  readonly currentId: string | undefined;
}

export function PlanLookup({ currentId }: PlanLookupProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Retrieve a plan</CardTitle>
        <CardDescription>
          Plan lookup by id, through the SDK read surface (
          <code className={styles.inlineCode}>GET /v1/plans/&#123;id&#125;</code>,{" "}
          <code className={styles.inlineCode}>/history</code>,{" "}
          <code className={styles.inlineCode}>GET /v1/plans</code>). Leave empty to list the
          tenant&rsquo;s recent plans instead.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action="/plans" method="get" role="search" className={styles.form}>
          <div className={styles.inputWrap}>
            <label htmlFor="plan-id-input" className={styles.label}>
              Plan id
            </label>
            <input
              id="plan-id-input"
              name="id"
              type="text"
              inputMode="text"
              autoComplete="off"
              defaultValue={currentId ?? ""}
              maxLength={128}
              required
              aria-describedby="plan-id-hint"
              className={styles.input}
            />
            <p id="plan-id-hint" className={styles.hint}>
              The id the host used when creating the plan.
            </p>
          </div>
          <Button type="submit">Retrieve plan</Button>
        </form>
      </CardContent>
    </Card>
  );
}
