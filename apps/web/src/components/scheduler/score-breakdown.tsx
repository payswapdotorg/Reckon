/**
 * ScoreBreakdown (UI-006) — candidates with exactly what the contract
 * carries: score, uncertainty cells, reason, exclusion gate.
 *
 * HONESTY LAW: absent values render as em-dash gaps; NO net-switching-value
 * arithmetic is computed (the contract has no structured switch-cost
 * fields — the hero above states this). Excluded candidates stay visible
 * with their `excludedBy` gate — why an alternative did NOT qualify is as
 * important as why the winner did.
 */
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { scoreRowCells, type ScoreRow } from "@/lib/scheduler-view";
import styles from "./score-breakdown.module.css";

export interface ScoreBreakdownProps {
  readonly scores: readonly ScoreRow[];
}

export function ScoreBreakdown({ scores }: ScoreBreakdownProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Score breakdown</CardTitle>
        <CardDescription>
          Every alternative with exactly the fields the frozen contract carries — score,
          uncertainty cells, reason and the exclusion gate. Gaps (&ldquo;—&rdquo;) mean the
          deciding policy did not provide that field; nothing is computed or inferred here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {scores.length === 0 ? (
          <p className={styles.empty}>
            This decision recorded no alternatives — the contract allows an empty alternatives
            array (e.g. a HOLD with no candidates evaluated).
          </p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">experience</th>
                <th scope="col">score</th>
                <th scope="col">uncertainty</th>
                <th scope="col">reason</th>
                <th scope="col">excluded by</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((row) => {
                const cells = scoreRowCells(row);
                return (
                  <tr key={row.experienceId} className={row.excludedBy !== null ? styles.excluded : ""}>
                    <td data-label="experience">
                      <code className={styles.id}>{row.experienceId}</code>
                    </td>
                    <td data-label="score" className={styles.num}>{cells.score}</td>
                    <td data-label="uncertainty" className={styles.cells}>{cells.uncertainty}</td>
                    <td data-label="reason" className={styles.cells}>{cells.reason}</td>
                    <td data-label="excluded by">
                      {row.excludedBy === null ? (
                        <span className={styles.num}>—</span>
                      ) : (
                        <Badge>{row.excludedBy}</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
