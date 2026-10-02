/**
 * EvidenceClassBadge — Gate Q vocabulary made visible.
 *
 * The five classes (observed / controlled-local / fixture / simulated /
 * counterfactual) are visually differentiated THREE ways at once so the
 * distinction survives color-vision differences and grayscale printing:
 *   1. hue  (green / teal / amber / gray / salmon — derived from the
 *      reference chart palette, NOT new accent usage: these are semantic
 *      evidence markers, not brand moments);
 *   2. border style (solid = directly grounded, dashed = generated/estimated);
 *   3. icon (eye / beaker / box / cpu / git-branch).
 *
 * On the foundation pages this component appears only inside the Overview
 * "System status" card (per UI-002 work order); UI-003+ workspaces use it
 * on every datum.
 */
import { Box, Cpu, Eye, GitBranch, Beaker, type LucideIcon } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import { getEvidenceClass, type EvidenceClassId } from "@/lib/evidence";
import styles from "./evidence-class-badge.module.css";

const CLASS_ICONS: Record<EvidenceClassId, LucideIcon> = {
  observed: Eye,
  "controlled-local": Beaker,
  fixture: Box,
  simulated: Cpu,
  counterfactual: GitBranch,
};

export interface EvidenceClassBadgeProps extends ComponentPropsWithoutRef<"span"> {
  evidenceClass: EvidenceClassId;
  /** Render the class description as a tooltip (default true). */
  withTitle?: boolean;
}

export function EvidenceClassBadge({
  evidenceClass,
  withTitle = true,
  className,
  ...props
}: EvidenceClassBadgeProps) {
  const definition = getEvidenceClass(evidenceClass);
  const Icon = CLASS_ICONS[evidenceClass];
  const classes = `${styles.badge} ${styles[definition.style]}${
    className ? ` ${className}` : ""
  }`;
  return (
    <span
      className={classes.trim()}
      title={withTitle ? `${definition.label} — ${definition.description}` : undefined}
      {...props}
    >
      <Icon className={styles.icon} aria-hidden="true" strokeWidth={1.75} size={12} />
      <span className={styles.label}>{definition.label}</span>
    </span>
  );
}
