/**
 * AdsQueryForm (AD-005) — the Ad Query surface: a plain HTML GET form
 * (`action` provided by the page, `method="get"`), so a query works
 * without client JavaScript and the query becomes a shareable URL
 * (`/ads?…&mode=…`). The server component re-renders both lanes from
 * real SDK data at the URL's clock.
 *
 * Surface: `q` (raw query text — e.g. "What laptop ads have I seen?"),
 * `mode` (remembered / available / both), optional structured filters
 * (`labels`, `surfaces`, `from`, `until`, `limit`) and the optional `at`
 * replay clock (epoch ms — pinning it makes the evaluation
 * deterministic; omitting it evaluates at request time).
 *
 * HONESTY: the input bounds mirror the frozen AdQueryRequest bounds as a
 * UX nicety ONLY — the API remains the sole authority; the studio never
 * re-implements contract validation.
 */
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdsQueryFormParams } from "@/lib/ads-view";
import styles from "./ads-query-form.module.css";

export interface AdsQueryFormProps {
  /** The form's target route (this page). */
  readonly action: string;
  /** The current query params, kept in the fields for refinement. */
  readonly params: AdsQueryFormParams;
  /**
   * Pin the lane mode (hides the Lanes selector): the remembered and
   * provider-supplied pages pin their lane — the form never offers a
   * control the page would override (law 9 mode discipline). When
   * provided, a hidden input carries the pinned mode.
   */
  readonly fixedMode?: AdsQueryFormParams["mode"];
}

export function AdsQueryForm({ action, params, fixedMode }: AdsQueryFormProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Query your ad memory and current supply</CardTitle>
        <CardDescription>
          Ask in plain language (&ldquo;What laptop ads have I seen?&rdquo;, &ldquo;the hotel ad I
          saw last week&rdquo;) or filter structurally. Remembered ads and provider-supplied ads
          answer in SEPARATE lanes with distinct provenance (law 9) — never merged. Retrieval runs
          through <code className={styles.inlineCode}>POST /v1/ads/query</code>; any re-ranking is
          the decision kernel&rsquo;s, on the Compare page.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} method="get" role="search" className={styles.form}>
          {fixedMode !== undefined ? (
            <input type="hidden" name="mode" value={fixedMode} />
          ) : null}
          <div className={styles.inputWrap}>
            <label htmlFor="ads-q-input" className={styles.label}>
              Query
            </label>
            <input
              id="ads-q-input"
              name="q"
              type="text"
              className={styles.queryInput}
              defaultValue={params.text ?? ""}
              placeholder="What laptop ads have I seen?"
              autoComplete="off"
              maxLength={1024}
            />
          </div>

          {fixedMode === undefined ? (
            <div className={styles.modeWrap}>
              <label htmlFor="ads-mode-input" className={styles.label}>
                Lanes
              </label>
              <select id="ads-mode-input" name="mode" className={styles.input} defaultValue={params.mode}>
                <option value="both">Both lanes</option>
                <option value="remembered">Remembered only</option>
                <option value="available">Provider-supplied only</option>
              </select>
            </div>
          ) : null}

          <div className={styles.filterWrap}>
            <label htmlFor="ads-labels-input" className={styles.label}>
              Labels (comma-separated)
            </label>
            <input
              id="ads-labels-input"
              name="labels"
              type="text"
              className={styles.input}
              defaultValue={params.labels.length > 0 ? params.labels.join(",") : ""}
              placeholder="travel, electronics"
              autoComplete="off"
              maxLength={512}
            />
          </div>

          <div className={styles.filterWrap}>
            <label htmlFor="ads-surfaces-input" className={styles.label}>
              Surfaces (comma-separated)
            </label>
            <input
              id="ads-surfaces-input"
              name="surfaces"
              type="text"
              className={styles.input}
              defaultValue={params.surfaces.length > 0 ? params.surfaces.join(",") : ""}
              placeholder="home, search"
              autoComplete="off"
              maxLength={512}
            />
          </div>

          <div className={styles.filterWrap}>
            <label htmlFor="ads-from-input" className={styles.label}>
              Encountered from (epoch ms)
            </label>
            <input
              id="ads-from-input"
              name="from"
              type="number"
              min={1}
              className={styles.input}
              defaultValue={params.encounteredFromMs ?? ""}
              placeholder="1760000000000"
              autoComplete="off"
            />
          </div>

          <div className={styles.filterWrap}>
            <label htmlFor="ads-until-input" className={styles.label}>
              Encountered until (epoch ms)
            </label>
            <input
              id="ads-until-input"
              name="until"
              type="number"
              min={1}
              className={styles.input}
              defaultValue={params.encounteredUntilMs ?? ""}
              placeholder="1770000000000"
              autoComplete="off"
            />
          </div>

          <div className={styles.limitWrap}>
            <label htmlFor="ads-limit-input" className={styles.label}>
              Limit
            </label>
            <input
              id="ads-limit-input"
              name="limit"
              type="number"
              min={1}
              max={100}
              className={styles.input}
              defaultValue={params.limit ?? ""}
              placeholder="20"
              autoComplete="off"
            />
          </div>

          <div className={styles.atWrap}>
            <label htmlFor="ads-at-input" className={styles.label}>
              Replay clock (epoch ms, optional)
            </label>
            <input
              id="ads-at-input"
              name="at"
              type="number"
              min={1}
              className={styles.input}
              defaultValue={params.atMs ?? ""}
              placeholder="now (request time)"
              autoComplete="off"
            />
          </div>

          <Button type="submit" variant="primary" size="sm" className={styles.submit}>
            Query ads
          </Button>
        </form>
        <p className={styles.hint}>
          Pinning the replay clock makes the evaluation deterministic (the same memory + the same
          clock answers the same, every time — expiry and availability are evaluated against it).
          Semantic matching is lexical and disclosed on every result; there is no hidden ranker.
        </p>
      </CardContent>
    </Card>
  );
}
