/**
 * ResearchQueueCard (UI-008) — the durable research-job queue (ADR-004):
 * queued/leased/done/failed with lease semantics, from the real API
 * surface (GET /v1/research/jobs). State badges are visually distinct;
 * the §13 experiment fields (seed, world-model, policy, performance…)
 * have NO frozen contract — that absence is stated, never fabricated.
 */
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { stateCounts } from "@/lib/research-view";
import type { ResearchJobsListing } from "@/lib/research-retrieval";
import styles from "./research-queue-card.module.css";

const STATE_CLASS: Record<string, string> = {
  queued: styles.stateQueued,
  leased: styles.stateLeased,
  done: styles.stateDone,
  failed: styles.stateFailed,
};

export interface ResearchQueueCardProps {
  readonly listing: ResearchJobsListing | undefined;
  readonly apiKeyNotConfigured: boolean;
}

export function ResearchQueueCard({ listing, apiKeyNotConfigured }: ResearchQueueCardProps) {
  const jobs = listing !== undefined && listing.status === "found" ? listing.jobs : undefined;
  const counts = jobs === undefined ? null : stateCounts(jobs);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Research job queue</CardTitle>
        <CardDescription>
          The durable FIFO queue behind the research runtime (
          <code className={styles.inlineCode}>GET /v1/research/jobs</code>) — jobs are leased to
          workers, completed with a result reference, or failed honestly. The §13 experiment
          fields (seed, world-model version, policy, reward, constraints, performance,
          robustness, calibration, baseline, artifacts) have no frozen contract yet: they surface
          through job payloads and research-runtime artifacts, and this workspace states their
          absence rather than fabricating them.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {listing === undefined ? null : listing.status === "not-configured" ? (
          <p className={styles.note}>
            Queue listing unavailable in this studio configuration — the server-side SDK client is
            not configured (RECKON_DEMO_API_KEY).
          </p>
        ) : listing.status === "error" ? (
          <p className={styles.note}>
            Queue listing failed — {listing.message}
            {listing.statusCode === undefined ? "" : ` (HTTP ${listing.statusCode})`}. Typed SDK
            error code: {listing.code}.
          </p>
        ) : jobs !== undefined && jobs.length === 0 ? (
          <p className={styles.note}>
            The listing succeeded and the tenant has no research jobs — enqueue one through the API
            (POST /v1/research/jobs) and it will appear here.
          </p>
        ) : jobs !== undefined ? (
          <>
            {counts !== null ? (
              <div className={styles.countRow}>
                <span className={styles.count}>
                  <Badge className={STATE_CLASS.queued}>queued {counts.queued}</Badge>
                </span>
                <span className={styles.count}>
                  <Badge className={STATE_CLASS.leased}>leased {counts.leased}</Badge>
                </span>
                <span className={styles.count}>
                  <Badge className={STATE_CLASS.done}>done {counts.done}</Badge>
                </span>
                <span className={styles.count}>
                  <Badge className={STATE_CLASS.failed}>failed {counts.failed}</Badge>
                </span>
              </div>
            ) : null}
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">job</th>
                  <th scope="col">kind</th>
                  <th scope="col">state</th>
                  <th scope="col">result</th>
                  <th scope="col">updated</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.jobId}>
                    <td data-label="job">
                      <code className={styles.id}>{job.jobId}</code>
                    </td>
                    <td data-label="kind" className={styles.mono}>
                      {job.kind}
                    </td>
                    <td data-label="state">
                      <Badge className={STATE_CLASS[job.state] ?? ""}>{job.state}</Badge>
                    </td>
                    <td data-label="result" className={styles.mono}>
                      {job.resultRef ?? "—"}
                    </td>
                    <td data-label="updated" className={styles.mono}>
                      {new Date(job.updatedAt).toISOString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
        {apiKeyNotConfigured ? (
          <p className={styles.warnRow}>No demo API key configured — listings will fail honestly.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
