/**
 * Reckon evidence classes — Gate Q (operational honesty) vocabulary.
 *
 * docs/work-items/index.md, Gate Q: "the UI visibly distinguishes
 * observed / controlled-local / fixture / simulated / counterfactual
 * evidence." The five ids below are the frozen vocabulary; the visual
 * treatments live in components/ui/evidence-class-badge.tsx (+ its CSS
 * module) and are deliberately differentiated by hue, border style AND
 * icon so the distinction survives color-vision differences.
 *
 * This module is dependency-free and React-free (testable under the root
 * NodeNext typecheck; consumed by both server and client components).
 */

export const EVIDENCE_CLASSES = [
  {
    id: "observed",
    label: "observed",
    description:
      "Verified from the real runtime — measured behavior, not modeled or assumed.",
    icon: "eye",
    style: "observed",
  },
  {
    id: "controlled-local",
    label: "controlled-local",
    description:
      "Produced by a controlled local harness — real Reckon code over synthetic inputs.",
    icon: "beaker",
    style: "controlledLocal",
  },
  {
    id: "fixture",
    label: "fixture",
    description:
      "Static fixture data — fixed inputs and expected outputs, never a live path.",
    icon: "box",
    style: "fixture",
  },
  {
    id: "simulated",
    label: "simulated",
    description:
      "Simulator or world-model output — generated behavior, not an observation.",
    icon: "cpu",
    style: "simulated",
  },
  {
    id: "counterfactual",
    label: "counterfactual",
    description:
      "Counterfactual estimate — a branch that never executed in the real runtime.",
    icon: "git-branch",
    style: "counterfactual",
  },
] as const;

export type EvidenceClassId = (typeof EVIDENCE_CLASSES)[number]["id"];

export const EVIDENCE_CLASS_IDS: readonly EvidenceClassId[] = EVIDENCE_CLASSES.map(
  (evidenceClass) => evidenceClass.id,
);

export function isEvidenceClassId(value: string): value is EvidenceClassId {
  return (EVIDENCE_CLASS_IDS as readonly string[]).includes(value);
}

export function getEvidenceClass(id: EvidenceClassId): (typeof EVIDENCE_CLASSES)[number] {
  const found = EVIDENCE_CLASSES.find((evidenceClass) => evidenceClass.id === id);
  if (found === undefined) {
    throw new Error(`Unknown evidence class: ${id}`);
  }
  return found;
}
