/**
 * CurrentContextCard (UI-004) — the decision context view (FINAL TL
 * HANDOFF §9: device · objective · attention · session).
 *
 * HONESTY LAW (this is the core of the card): the decision-retrieval
 * surface returns the decision RESULT record — it does not echo the
 * decision request's context snapshot. Of the four §9 context fields,
 * only the OBJECTIVE is carried (inside the selected experience's
 * objective-fit metadata, when the deciding policy attached one). Device,
 * attention policy and session live on the decision request (a contextId
 * reference + request fields) and are NOT part of the retrieved record —
 * so this card renders them as explicit "not provided" absences, never
 * as guessed values (Gate Q).
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EvidenceClassBadge } from "@/components/ui/evidence-class-badge";
import type { DecisionResult } from "@reckon/sdk";
import { objectiveKindLabel, opaqueEntries } from "@/lib/decision-view";
import { CodeValue, FieldRow, FieldRows, MutedNote, NotProvided } from "./decision-fields";
import styles from "./current-context-card.module.css";

export interface CurrentContextCardProps {
  decision: DecisionResult;
}

export function CurrentContextCard({ decision }: CurrentContextCardProps) {
  const objective = decision.selectedExperience?.objectiveFit?.objective;
  const objectiveParams = objective === undefined ? [] : opaqueEntries(objective.params);

  return (
    <Card>
      <CardHeader>
        <div className={styles.titleRow}>
          <CardTitle>Current context</CardTitle>
          <EvidenceClassBadge evidenceClass="observed" />
        </div>
        <CardDescription>
          The decision&rsquo;s frame — what the request context carried into the decision, as
          far as the retrieved record shows it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldRows>
          <FieldRow label="Objective">
            {objective === undefined ? (
              <NotProvided note="this record carries no objective-fit objective for the selected experience (the request&rsquo;s declared objective is not echoed back by the retrieval surface)" />
            ) : (
              <>
                <CodeValue>{objectiveKindLabel(objective.kind, objective.customKind)}</CodeValue>
                <span className={styles.valueNote}>
                  objective <code>{objective.objectiveId}</code> · version{" "}
                  <code>{objective.version}</code>
                </span>
                {objectiveParams.length === 0 ? null : (
                  <span className={styles.paramChips}>
                    {objectiveParams.map((entry) => (
                      <code key={entry.key} className={styles.paramChip}>
                        {entry.key}: {entry.value}
                      </code>
                    ))}
                  </span>
                )}
              </>
            )}
          </FieldRow>
          <FieldRow label="Device">
            <NotProvided note="the decision-result contract carries no context snapshot — device class lives on the decision request, which the retrieval surface does not return" />
          </FieldRow>
          <FieldRow label="Attention policy">
            <NotProvided note="the attention policy (style + limits) is a decision-request field — not part of the retrieved decision record" />
          </FieldRow>
          <FieldRow label="Session">
            <NotProvided note="session identity is submitted with the request as a context reference — the decision result does not echo it" />
          </FieldRow>
        </FieldRows>
        <MutedNote>
          Context grounding that the record DOES carry: the subject&rsquo;s decision was scoped
          to tenant <code className={styles.inlineCode}>{decision.tenant.tenantId}</code>
          {decision.tenant.workspaceId === undefined ? null : (
            <>
              {" "}
              (workspace <code className={styles.inlineCode}>{decision.tenant.workspaceId}</code>)
            </>
          )}{" "}
          for request <code className={styles.inlineCode}>{decision.requestId}</code>, decided at{" "}
          <code className={styles.inlineCode}>
            {new Date(decision.at).toISOString()}
          </code>
          . When the API later returns request context, those fields render here — until then
          the absences above are the honest state.
        </MutedNote>
      </CardContent>
    </Card>
  );
}
