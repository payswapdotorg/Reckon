/**
 * DecisionWorkspace (UI-004) — the full retrieved-decision view, composed
 * of the five surface cards in the workspace's reading order:
 *
 *   1. The decision          — action, confidence, policy, why-trail
 *   2. Current context       — device · objective · attention · session
 *   3. Current experience    — the selected experience by its action role
 *   4. Candidates vs decision— alternatives: considered vs filtered
 *   5. Costs & consequences  — uncertainty, schedule delta, latency
 *
 * Every card renders only what the retrieved record carries (Gate Q);
 * every section is server-rendered from the SDK result.
 */
import type { DecisionResult } from "@reckon/sdk";
import { AlternativesCard } from "./alternatives-card.js";
import { CostsConsequencesCard } from "./costs-consequences-card.js";
import { CurrentContextCard } from "./current-context-card.js";
import { CurrentExperienceCard } from "./current-experience-card.js";
import { DecisionSummaryCard } from "./decision-summary-card.js";
import styles from "./decision-workspace.module.css";

export interface DecisionWorkspaceProps {
  decision: DecisionResult;
}

export function DecisionWorkspace({ decision }: DecisionWorkspaceProps) {
  return (
    <div className={styles.workspace}>
      <DecisionSummaryCard decision={decision} />
      <CurrentContextCard decision={decision} />
      <CurrentExperienceCard decision={decision} />
      <AlternativesCard decision={decision} />
      <CostsConsequencesCard decision={decision} />
    </div>
  );
}
