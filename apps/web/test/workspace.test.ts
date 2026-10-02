/**
 * Workspace registry + app-shell smoke (UI-001) — proves the seven mandated
 * routes exist as a consistent triple: registry ⇄ app-router page files ⇄
 * navigation, and that the base component set from the UI-002 work order
 * exists on disk. Together with `next build` (which typechecks the whole
 * app module tree) and the root `tsc` typecheck (which covers this file),
 * this is the foundation-wave smoke battery.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  NAV_GROUPS,
  WORKSPACE_ROUTES,
  getWorkspaceRoute,
  navRoutesForGroup,
  requireWorkspaceRoute,
} from "../src/lib/workspace.js";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "../src/app");
const componentsRoot = join(here, "../src/components");
const srcRoot = join(here, "../src");

const REQUIRED_ROUTES = [
  "/",
  "/decisions",
  "/plans",
  "/scheduler",
  "/agents",
  "/research",
  "/integrations",
] as const;

function pageFileFor(href: string): string {
  return href === "/" ? join(appRoot, "page.tsx") : join(appRoot, `${href}/page.tsx`);
}

describe("workspace registry (UI-001)", () => {
  it("registers exactly the seven mandated routes", () => {
    const hrefs = WORKSPACE_ROUTES.map((route) => route.href);
    expect(hrefs).toEqual([...REQUIRED_ROUTES]);
  });

  it("every route carries title, subtitle and empty-state copy", () => {
    for (const route of WORKSPACE_ROUTES) {
      expect(route.title.length).toBeGreaterThan(0);
      expect(route.subtitle.length).toBeGreaterThan(20);
      expect(route.emptyStateReason.length).toBeGreaterThan(10);
      expect(route.navLabel.length).toBeGreaterThan(0);
    }
  });

  it("Overview is the landing item and the only ungrouped route", () => {
    expect(WORKSPACE_ROUTES[0]?.href).toBe("/");
    expect(navRoutesForGroup("landing").map((route) => route.href)).toEqual(["/"]);
  });

  it("nav groups carry UPPERCASE labels", () => {
    for (const group of NAV_GROUPS) {
      expect(group.label).toBe(group.label.toUpperCase());
      expect(group.label.length).toBeGreaterThan(2);
    }
  });

  it("every non-landing route belongs to a declared nav group", () => {
    const groupIds = new Set(NAV_GROUPS.map((group) => group.id));
    for (const route of WORKSPACE_ROUTES) {
      if (route.navGroup === "landing") {
        continue;
      }
      expect(groupIds.has(route.navGroup)).toBe(true);
    }
  });

  it("BUILD groups the decisioning surfaces; INTELLIGENCE the research surfaces", () => {
    expect(navRoutesForGroup("build").map((route) => route.href)).toEqual([
      "/decisions",
      "/plans",
      "/scheduler",
    ]);
    expect(navRoutesForGroup("intelligence").map((route) => route.href)).toEqual([
      "/agents",
      "/research",
    ]);
    expect(navRoutesForGroup("integrate").map((route) => route.href)).toEqual(["/integrations"]);
  });

  it("requireWorkspaceRoute returns the route for a registered href and throws otherwise", () => {
    expect(requireWorkspaceRoute("/decisions").title).toBe("Decisions");
    expect(() => requireWorkspaceRoute("/nope")).toThrow(/No workspace route registered/);
  });

  it("getWorkspaceRoute resolves pathnames incl. trailing slashes and returns null for unknowns", () => {
    expect(getWorkspaceRoute("/")?.title).toBe("Overview");
    expect(getWorkspaceRoute("/decisions")?.title).toBe("Decisions");
    expect(getWorkspaceRoute("/decisions/")?.title).toBe("Decisions");
    expect(getWorkspaceRoute("/decisions/extra")?.title).toBe("Decisions");
    expect(getWorkspaceRoute("/unknown")).toBeNull();
  });
});

describe("app-router tree matches the registry (smoke)", () => {
  it("every registered route has a page.tsx", () => {
    for (const route of WORKSPACE_ROUTES) {
      expect(existsSync(pageFileFor(route.href)), `missing ${pageFileFor(route.href)}`).toBe(true);
    }
  });

  it("root layout exists and imports the globals.css token sheet", () => {
    const layoutPath = join(appRoot, "layout.tsx");
    expect(existsSync(layoutPath)).toBe(true);
    expect(readFileSync(layoutPath, "utf8")).toMatch(/globals\.css/);
  });

  it("globals.css exists", () => {
    expect(existsSync(join(appRoot, "globals.css"))).toBe(true);
  });
});

describe("UI-002 base components exist (smoke)", () => {
  const baseComponents = [
    "ui/card.tsx",
    "ui/button.tsx",
    "ui/badge.tsx",
    "ui/search-input.tsx",
    "ui/sidebar-nav.tsx",
    "ui/evidence-class-badge.tsx",
    "shell/app-shell.tsx",
    "shell/sidebar.tsx",
    "shell/site-header.tsx",
    "shell/command-palette.tsx",
    "shell/nav-drawer.tsx",
    "empty-state.tsx",
    "retry-button.tsx",
    "workspace-page.tsx",
    "workspace-placeholder.tsx",
  ] as const;

  it.each(baseComponents)("src/components/%s exists", (relative) => {
    expect(existsSync(join(componentsRoot, relative)), `missing ${relative}`).toBe(true);
  });

  it("every styled base component has a colocated CSS module", () => {
    const styledComponents = baseComponents.filter(
      (relative) => relative !== "shell/nav-drawer.tsx" && relative !== "workspace-placeholder.tsx",
    );
    for (const relative of styledComponents) {
      const cssModule = join(componentsRoot, relative.replace(/\.tsx$/, ".module.css"));
      expect(existsSync(cssModule), `missing ${cssModule}`).toBe(true);
    }
  });
});

describe("SDK seam + §29 law guards", () => {
  it("lib/reckon-client.ts exists, is server-only and only consumes @reckon/sdk", () => {
    const source = readFileSync(join(here, "../src/lib/reckon-client.ts"), "utf8");
    expect(source).toMatch(/import "server-only"/);
    expect(source).toMatch(/from "@reckon\/sdk"/);
    expect(source).toMatch(/createReckonClient/);
    expect(source).not.toMatch(/@reckon\/(persistence|decision|scheduler|experience)/);
  });

  it("lib/reckon-status.ts exists, is server-only and probes the documented healthz route", () => {
    const source = readFileSync(join(here, "../src/lib/reckon-status.ts"), "utf8");
    expect(source).toMatch(/import "server-only"/);
    expect(source).toMatch(/\/healthz/);
  });

  it("no app source imports Reckon domain internals (FINAL TL HANDOFF §29)", () => {
    const forbidden =
      /@reckon\/(persistence|decision|scheduler|experience|events|observability|world-model|simulation|candidates|policies|agents-runtime|organizations)/;
    const violations: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (/\.tsx?$/.test(name)) {
          if (forbidden.test(readFileSync(full, "utf8"))) {
            violations.push(full);
          }
        }
      }
    };
    walk(srcRoot);
    expect(violations, `domain-internal imports found: ${violations.join(", ")}`).toEqual([]);
  });
});
