/**
 * DecisionLookup (UI-004) — the decision-id retrieval field.
 *
 * A plain HTML GET form (`action="/decisions" method="get"`): the lookup
 * works without client JavaScript, the requested id becomes a shareable
 * URL (`/decisions?id=…`) and the server component re-renders the
 * workspace from real SDK data. Server component by design (no state, no
 * effects).
 *
 * HONESTY: the input's `pattern`/`maxLength` mirror the frozen IdSchema
 * shape (1–128 url-safe chars) as a UX nicety ONLY — the API remains the
 * sole authority; the studio never re-implements contract validation.
 */
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import styles from "./decision-lookup.module.css";

export interface DecisionLookupProps {
  /** The id currently being viewed, kept in the field for refinement. */
  currentId: string | undefined;
}

export function DecisionLookup({ currentId }: DecisionLookupProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Retrieve a decision</CardTitle>
        <CardDescription>
          Decision lookup by id, through the SDK&rsquo;s retrieval surface{" "}
          (<code className={styles.inlineCode}>GET /v1/decisions/&#123;id&#125;</code>). The
          @reckon/sdk decision surface (W3-002) exposes no recent-decisions listing yet —
          request and lookup-by-id are its only operations — so this workspace retrieves one
          decision at a time.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action="/decisions" method="get" role="search" className={styles.form}>
          <div className={styles.inputWrap}>
            <label htmlFor="decision-id-input" className={styles.label}>
              Decision id
            </label>
            <input
              id="decision-id-input"
              name="id"
              type="text"
              className={styles.input}
              defaultValue={currentId ?? ""}
              placeholder="dec-…"
              autoComplete="off"
              spellCheck={false}
              required
              maxLength={128}
              pattern="[A-Za-z0-9][A-Za-z0-9._:-]*"
              title="Reckon ids are url-safe: one letter or digit first, then letters, digits, . _ : -"
              inputMode="text"
            />
          </div>
          <Button type="submit" variant="primary" size="sm" className={styles.submit}>
            Look up decision
          </Button>
        </form>
        <p className={styles.hint}>
          Decision ids come from the decision records themselves — the host that requests a
          decision receives the result (with its <code className={styles.inlineCode}>decisionId</code>)
          and can retrieve it again here.
        </p>
      </CardContent>
    </Card>
  );
}
