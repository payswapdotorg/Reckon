/**
 * Evidence-class vocabulary sanity (Gate Q prep) — the five classes exist,
 * in the mandated order, with unique styles/icons/descriptions, and the
 * badge component's CSS module really carries one distinct class per
 * evidence class so the visual differentiation is structural, not accidental.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EVIDENCE_CLASSES,
  EVIDENCE_CLASS_IDS,
  getEvidenceClass,
  isEvidenceClassId,
} from "../src/lib/evidence.js";

const here = dirname(fileURLToPath(import.meta.url));
const badgeCssPath = join(here, "../src/components/ui/evidence-class-badge.module.css");

describe("evidence classes (Gate Q vocabulary)", () => {
  it("defines exactly the five mandated classes in order", () => {
    expect(EVIDENCE_CLASS_IDS).toEqual([
      "observed",
      "controlled-local",
      "fixture",
      "simulated",
      "counterfactual",
    ]);
  });

  it("every class has a label, a description and an icon", () => {
    for (const evidenceClass of EVIDENCE_CLASSES) {
      expect(evidenceClass.label.length).toBeGreaterThan(2);
      expect(evidenceClass.description.length).toBeGreaterThan(20);
      expect(evidenceClass.icon.length).toBeGreaterThan(2);
    }
  });

  it("style keys are unique — every class is visually distinct at the data level", () => {
    const styles = EVIDENCE_CLASSES.map((evidenceClass) => evidenceClass.style);
    expect(new Set(styles).size).toBe(EVIDENCE_CLASSES.length);
  });

  it("icons are unique across classes", () => {
    const icons = EVIDENCE_CLASSES.map((evidenceClass) => evidenceClass.icon);
    expect(new Set(icons).size).toBe(EVIDENCE_CLASSES.length);
  });

  it("isEvidenceClassId guards the vocabulary", () => {
    expect(isEvidenceClassId("observed")).toBe(true);
    expect(isEvidenceClassId("counterfactual")).toBe(true);
    expect(isEvidenceClassId("guessed")).toBe(false);
    expect(isEvidenceClassId("")).toBe(false);
  });

  it("getEvidenceClass returns definitions and throws on unknown ids", () => {
    expect(getEvidenceClass("fixture").label).toBe("fixture");
    expect(() => getEvidenceClass("made-up" as never)).toThrow(/Unknown evidence class/);
  });
});

describe("EvidenceClassBadge styling (visual differentiation is structural)", () => {
  it("the badge CSS module exists", () => {
    expect(existsSync(badgeCssPath)).toBe(true);
  });

  it("declares one class per evidence-class style key", () => {
    const css = readFileSync(badgeCssPath, "utf8");
    for (const evidenceClass of EVIDENCE_CLASSES) {
      expect(css, `missing .${evidenceClass.style}`).toMatch(
        new RegExp(`^\\.${evidenceClass.style}\\s*\\{`, "m"),
      );
    }
  });

  it("differentiates border styles: solid for grounded classes, dashed for generated/estimated", () => {
    const css = readFileSync(badgeCssPath, "utf8");
    const classBlock = (style: string): string => {
      const match = css.match(new RegExp(`^\\.${style}\\s*\\{([\\s\\S]*?)^\\}`, "m"));
      expect(match, `cannot isolate .${style} block`).not.toBeNull();
      return match?.[1] ?? "";
    };
    for (const grounded of ["observed", "controlledLocal", "fixture"]) {
      expect(classBlock(grounded)).toMatch(/border:\s*1px solid/);
      expect(classBlock(grounded)).not.toMatch(/dashed/);
    }
    for (const generated of ["simulated", "counterfactual"]) {
      expect(classBlock(generated)).toMatch(/border:\s*1px dashed/);
    }
  });
});
