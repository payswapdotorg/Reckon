/**
 * CurrentExperienceCard (UI-004) — what the subject is experiencing: the
 * decision record's `selectedExperience`, labeled by its role under the
 * action (the scheduler populates it differently per action — switch
 * target, continued current, suggestion, queued item…; HOLD/END select
 * none).
 *
 * Renders the full frozen `reckon.experience` shape as returned: ids,
 * format, locale, duration, timing, objective fit, requirements,
 * transformations and constraints. Every optional field that the record
 * does not carry renders as an explicit "not provided" — never guessed.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EvidenceClassBadge } from "@/components/ui/evidence-class-badge";
import type { ReactNode } from "react";
import type { DecisionResult, Experience } from "@reckon/sdk";
import {
  constraintView,
  formatDurationValue,
  formatEpochMs,
  formatExactNumber,
  objectiveKindLabel,
  opaqueEntries,
  selectedExperienceRole,
} from "@/lib/decision-view";
import { CodeValue, FieldRow, FieldRows, MutedNote, NotProvided } from "./decision-fields.js";
import styles from "./current-experience-card.module.css";

export interface CurrentExperienceCardProps {
  decision: DecisionResult;
}

export function CurrentExperienceCard({ decision }: CurrentExperienceCardProps) {
  const role = selectedExperienceRole(decision.action);
  const experience = decision.selectedExperience;

  return (
    <Card>
      <CardHeader>
        <div className={styles.titleRow}>
          <CardTitle>Current experience</CardTitle>
          <EvidenceClassBadge evidenceClass="observed" />
        </div>
        <CardDescription>
          {role.note}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className={styles.roleHeading}>{role.heading}</div>
        {experience === undefined ? (
          <MutedNote>
            No selected experience on this record — the action&rsquo;s schedule consequences
            (if any) are listed under Costs &amp; consequences, and the evaluated alternatives
            under Candidates vs decision.
          </MutedNote>
        ) : (
          <ExperienceDetail experience={experience} />
        )}
      </CardContent>
    </Card>
  );
}

function ExperienceDetail({ experience }: { experience: Experience }) {
  const formatParams = opaqueEntries(experience.format.params);
  const objectiveFit = experience.objectiveFit;
  const objective = objectiveFit?.objective;
  const fitNotes = objectiveFit?.notes ?? [];
  const requirements = experience.requirements;
  const timing = experience.timing;
  const constraints = experience.constraints;

  return (
    <>
      <FieldRows>
        <FieldRow label="Experience">
          <CodeValue>{experience.experienceId}</CodeValue>
        </FieldRow>
        <FieldRow label="Item · realization">
          <CodeValue>{experience.itemId}</CodeValue>
          <CodeValue>{experience.realizationId}</CodeValue>
        </FieldRow>
        <FieldRow label="Format">
          <CodeValue>
            {experience.format.kind === "custom" && experience.format.customKind !== undefined
              ? experience.format.customKind
              : experience.format.kind}
          </CodeValue>
          {formatParams.length === 0 ? null : (
            <span className={styles.paramChips}>
              {formatParams.map((entry) => (
                <code key={entry.key} className={styles.paramChip}>
                  {entry.key}: {entry.value}
                </code>
              ))}
            </span>
          )}
        </FieldRow>
        <FieldRow label="Locale">
          {experience.locale === undefined ? (
            <NotProvided />
          ) : (
            <CodeValue>{experience.locale}</CodeValue>
          )}
        </FieldRow>
        <FieldRow label="Duration">
          {experience.duration === undefined ? (
            <NotProvided />
          ) : (
            <CodeValue>{formatDurationValue(experience.duration)}</CodeValue>
          )}
        </FieldRow>
      </FieldRows>

      {timing === undefined ? null : (
        <SubSection heading="Timing">
          <FieldRows>
            <FieldRow label="Earliest">
              {timing.earliestMs === undefined ? (
                <NotProvided />
              ) : (
                <CodeValue>{formatEpochMs(timing.earliestMs)}</CodeValue>
              )}
            </FieldRow>
            <FieldRow label="Latest">
              {timing.latestMs === undefined ? (
                <NotProvided />
              ) : (
                <CodeValue>{formatEpochMs(timing.latestMs)}</CodeValue>
              )}
            </FieldRow>
            <FieldRow label="Availability window">
              {timing.availabilityWindow === undefined ? (
                <NotProvided />
              ) : (
                <span className={styles.valueNote}>
                  <code>{formatEpochMs(timing.availabilityWindow.fromMs)}</code> →{" "}
                  <code>{formatEpochMs(timing.availabilityWindow.untilMs)}</code>
                </span>
              )}
            </FieldRow>
          </FieldRows>
        </SubSection>
      )}

      {objectiveFit === undefined ? (
        <SubSection heading="Objective fit">
          <NotProvided note="this experience carries no objective-fit metadata — the deciding policy did not attach one (honest absence, not zero fit)" />
        </SubSection>
      ) : (
        <SubSection heading="Objective fit">
          <FieldRows>
            <FieldRow label="Objective">
              {objective === undefined ? (
                <NotProvided />
              ) : (
                <>
                  <CodeValue>{objectiveKindLabel(objective.kind, objective.customKind)}</CodeValue>
                  <span className={styles.valueNote}>
                    <code>{objective.objectiveId}</code> · version <code>{objective.version}</code>
                  </span>
                </>
              )}
            </FieldRow>
            <FieldRow label="Fit score">
              {objectiveFit.fitScore === undefined ? (
                <NotProvided />
              ) : (
                <>
                  <CodeValue>{formatExactNumber(objectiveFit.fitScore)}</CodeValue>
                  <span className={styles.valueNote}>0–1, as returned by the policy</span>
                </>
              )}
            </FieldRow>
            {fitNotes.length === 0 ? null : (
              <FieldRow label="Notes">
                <ul className={styles.fitNotes}>
                  {fitNotes.map((note) => (
                    <li key={note} className={styles.fitNoteItem}>
                      {note}
                    </li>
                  ))}
                </ul>
              </FieldRow>
            )}
          </FieldRows>
        </SubSection>
      )}

      {requirements === undefined ? (
        <SubSection heading="Requirements">
          <NotProvided note="this experience declares no device/context requirements" />
        </SubSection>
      ) : (
        <SubSection heading="Requirements">
          <FieldRows>
            <FieldRow label="Device class">
              {requirements.deviceClass.length === 0 ? (
                <NotProvided />
              ) : (
                requirements.deviceClass.map((deviceClass) => (
                  <CodeValue key={deviceClass}>{deviceClass}</CodeValue>
                ))
              )}
            </FieldRow>
            <FieldRow label="Screen">
              {requirements.requiresScreen === undefined ? (
                <NotProvided />
              ) : (
                <span>{requirements.requiresScreen ? "required" : "not required"}</span>
              )}
            </FieldRow>
            <FieldRow label="Audio">
              {requirements.requiresAudio === undefined ? (
                <NotProvided />
              ) : (
                <span>{requirements.requiresAudio ? "required" : "not required"}</span>
              )}
            </FieldRow>
            <FieldRow label="Min bandwidth">
              {requirements.minBandwidth === undefined ? (
                <NotProvided />
              ) : (
                <CodeValue>{requirements.minBandwidth}</CodeValue>
              )}
            </FieldRow>
          </FieldRows>
        </SubSection>
      )}

      {experience.transformations.length === 0 ? null : (
        <SubSection heading="Transformations (host-executed)">
          <ul className={styles.transformationList}>
            {experience.transformations.map((transformation) => (
              <li key={transformation.kind} className={styles.transformationItem}>
                <CodeValue>{transformation.kind}</CodeValue>
                {opaqueEntries(transformation.params).length === 0 ? null : (
                  <span className={styles.paramChips}>
                    {opaqueEntries(transformation.params).map((entry) => (
                      <code key={entry.key} className={styles.paramChip}>
                        {entry.key}: {entry.value}
                      </code>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </SubSection>
      )}

      {constraints.length === 0 ? null : (
        <SubSection heading="Constraints">
          <ul className={styles.constraintList}>
            {constraints.map((constraint, index) => {
              const view = constraintView(constraint);
              return (
                <li key={`${constraint.kind}-${index}`} className={styles.constraintItem}>
                  <span className={styles.constraintLabel}>{view.label}</span>
                  <span className={styles.constraintDetail}>{view.detail}</span>
                </li>
              );
            })}
          </ul>
          <p className={styles.constraintNote}>
            Declared exactly as the record carries them — the constraint kernel evaluates these;
            this view never judges pass or fail.
          </p>
        </SubSection>
      )}
    </>
  );
}

function SubSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className={styles.subSection}>
      <h4 className={styles.subSectionHeading}>{heading}</h4>
      {children}
    </section>
  );
}
