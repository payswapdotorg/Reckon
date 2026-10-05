/**
 * Workspace registry + app-shell smoke — proves the S3-001 dashboard IA
 * and the foundation studio routes exist as a consistent triple:
 * registry ⇄ app-router page files ⇄ navigation, and that the base +
 * dashboard component sets exist on disk. Together with `next build`
 * (which typechecks the whole app module tree) and the root `tsc`
 * typecheck (which covers this file), this is the shell smoke battery.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DASHBOARD_SECTION_HREFS,
  DEVELOPER_SURFACE_HREFS,
  NAV_GROUPS,
  WORKSPACE_ROUTES,
  breadcrumbTrailFor,
  findWorkspaceRoute,
  getWorkspaceRoute,
  navHintForRoute,
  navRoutesForGroup,
  navTreeForGroup,
  parentWorkspaceRoute,
  requireWorkspaceRoute,
} from "../src/lib/workspace.js";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "../src/app");
const componentsRoot = join(here, "../src/components");
const srcRoot = join(here, "../src");

/** The S3-001 mandate: dashboard IA sections + developer sub-surfaces + foundation workspaces. */
const EXPECTED_ROUTE_ORDER = [
  "/",
  "/recommendations",
  "/models",
  "/data-sources",
  "/analytics",
  "/developers",
  "/developers/keys",
  "/developers/logs",
  "/developers/events",
  "/decisions",
  "/plans",
  "/scheduler",
  "/agents",
  "/research",
  "/integrations",
  "/settings",
] as const;

function pageFileFor(href: string): string {
  return href === "/" ? join(appRoot, "page.tsx") : join(appRoot, `${href}/page.tsx`);
}

describe("workspace registry (S3-001 dashboard IA + foundation routes)", () => {
  it("registers exactly the mandated routes, in order", () => {
    const hrefs = WORKSPACE_ROUTES.map((route) => route.href);
    expect(hrefs).toEqual([...EXPECTED_ROUTE_ORDER]);
  });

  it("the seven dashboard sections are registered", () => {
    expect(DASHBOARD_SECTION_HREFS).toEqual([
      "/",
      "/recommendations",
      "/models",
      "/data-sources",
      "/analytics",
      "/developers",
      "/settings",
    ]);
  });

  it("the three developer sub-surfaces are registered as Developers children", () => {
    expect(DEVELOPER_SURFACE_HREFS).toEqual(["/developers/keys", "/developers/logs", "/developers/events"]);
    for (const href of DEVELOPER_SURFACE_HREFS) {
      expect(requireWorkspaceRoute(href).parentHref).toBe("/developers");
    }
  });

  it("every route carries title, subtitle and empty-state copy", () => {
    for (const route of WORKSPACE_ROUTES) {
      expect(route.title.length).toBeGreaterThan(0);
      expect(route.subtitle.length).toBeGreaterThan(20);
      expect(route.emptyStateReason.length).toBeGreaterThan(10);
      expect(route.navLabel.length).toBeGreaterThan(0);
    }
  });

  it("Home is the landing item and the only ungrouped route", () => {
    expect(WORKSPACE_ROUTES[0]?.href).toBe("/");
    expect(WORKSPACE_ROUTES[0]?.title).toBe("Home");
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

  it("OPERATE groups the dashboard product sections; DEVELOPERS carries keys/logs/events", () => {
    expect(navRoutesForGroup("operate").map((route) => route.href)).toEqual([
      "/recommendations",
      "/models",
      "/data-sources",
      "/analytics",
    ]);
    expect(navRoutesForGroup("developers").map((route) => route.href)).toEqual([
      "/developers",
      "/developers/keys",
      "/developers/logs",
      "/developers/events",
    ]);
  });

  it("the foundation studio groups keep their routes (UI-001 law)", () => {
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
    expect(navRoutesForGroup("account").map((route) => route.href)).toEqual(["/settings"]);
  });
});

describe("nav tree + parent chain (S3-001 nested routes)", () => {
  it("the Developers group renders one parent with its three children", () => {
    const tree = navTreeForGroup("developers");
    expect(tree).toHaveLength(1);
    expect(tree[0]?.route.href).toBe("/developers");
    expect(tree[0]?.children.map((child) => child.href)).toEqual([
      "/developers/keys",
      "/developers/logs",
      "/developers/events",
    ]);
  });

  it("groups without children render flat single-level trees", () => {
    for (const group of ["operate", "build", "intelligence", "integrate", "account"] as const) {
      for (const entry of navTreeForGroup(group)) {
        expect(entry.children).toHaveLength(0);
      }
    }
  });

  it("every parentHref resolves to a registered route in the same group, registered BEFORE its children", () => {
    for (const route of WORKSPACE_ROUTES) {
      if (route.parentHref === undefined) {
        expect(parentWorkspaceRoute(route)).toBeNull();
        continue;
      }
      const parent = parentWorkspaceRoute(route);
      expect(parent, `parent for ${route.href}`).not.toBeNull();
      expect(parent?.navGroup).toBe(route.navGroup);
      const parentIndex = WORKSPACE_ROUTES.findIndex((candidate) => candidate.href === route.parentHref);
      const childIndex = WORKSPACE_ROUTES.findIndex((candidate) => candidate.href === route.href);
      expect(parentIndex).toBeGreaterThan(-1);
      expect(childIndex).toBeGreaterThan(parentIndex);
    }
  });

  it("nav hints: children carry the parent title, top-level the group label, Home is Home", () => {
    expect(navHintForRoute(requireWorkspaceRoute("/developers/keys"))).toBe("Developers");
    expect(navHintForRoute(requireWorkspaceRoute("/"))).toBe("Home");
    expect(navHintForRoute(requireWorkspaceRoute("/recommendations"))).toBe("OPERATE");
    expect(navHintForRoute(requireWorkspaceRoute("/decisions"))).toBe("BUILD");
    expect(navHintForRoute(requireWorkspaceRoute("/settings"))).toBe("ACCOUNT");
  });
});

describe("route resolution + breadcrumbs", () => {
  it("requireWorkspaceRoute returns the route for a registered href and throws otherwise", () => {
    expect(requireWorkspaceRoute("/decisions").title).toBe("Decisions");
    expect(requireWorkspaceRoute("/developers/keys").title).toBe("API keys");
    expect(() => requireWorkspaceRoute("/nope")).toThrow(/No workspace route registered/);
  });

  it("getWorkspaceRoute resolves the MOST SPECIFIC route (nested beats parent)", () => {
    expect(getWorkspaceRoute("/")?.title).toBe("Home");
    expect(getWorkspaceRoute("/developers")?.title).toBe("Developers");
    expect(getWorkspaceRoute("/developers/keys")?.title).toBe("API keys");
    expect(getWorkspaceRoute("/developers/logs")?.title).toBe("Request logs");
    expect(getWorkspaceRoute("/developers/events/extra")?.title).toBe("Events");
    expect(getWorkspaceRoute("/decisions")?.title).toBe("Decisions");
    expect(getWorkspaceRoute("/decisions/")?.title).toBe("Decisions");
    expect(getWorkspaceRoute("/decisions/extra")?.title).toBe("Decisions");
    expect(getWorkspaceRoute("/unknown")).toBeNull();
  });

  it("breadcrumb trails include the parent chain, innermost last", () => {
    expect(breadcrumbTrailFor("/developers/keys").map((route) => route.title)).toEqual([
      "Developers",
      "API keys",
    ]);
    expect(breadcrumbTrailFor("/developers").map((route) => route.title)).toEqual(["Developers"]);
    expect(breadcrumbTrailFor("/").map((route) => route.title)).toEqual(["Home"]);
    expect(breadcrumbTrailFor("/unknown")).toEqual([]);
  });

  it("related-workspace hrefs all resolve to registered routes", () => {
    for (const route of WORKSPACE_ROUTES) {
      for (const href of route.relatedHrefs ?? []) {
        expect(findWorkspaceRoute(href), `related href ${href} on ${route.href}`).not.toBeNull();
      }
    }
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

  it("globals.css exists and declares the dashboard mode tokens", () => {
    const globals = readFileSync(join(appRoot, "globals.css"), "utf8");
    expect(globals).toMatch(/--mode-live:\s*#009768/);
    expect(globals).toMatch(/--mode-test:\s*#dc8b18/);
  });

  it("the dashboard key-proxy route handlers exist", () => {
    expect(existsSync(join(appRoot, "api/dashboard/keys/route.ts"))).toBe(true);
    expect(existsSync(join(appRoot, "api/dashboard/keys/[keyId]/route.ts"))).toBe(true);
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

describe("S3-001 dashboard components exist (smoke)", () => {
  const dashboardComponents = [
    "shell/mode-provider.tsx",
    "shell/mode-toggle.tsx",
    "shell/mode-badge.tsx",
    "home/account-status-card.tsx",
    "home/onboarding-card.tsx",
    "developers/surface-state.tsx",
    "developers/api-keys-manager.tsx",
    "developers/create-key-dialog.tsx",
    "developers/revoke-key-button.tsx",
    "developers/request-logs-card.tsx",
    "developers/events-console.tsx",
  ] as const;

  it.each(dashboardComponents)("src/components/%s exists", (relative) => {
    expect(existsSync(join(componentsRoot, relative)), `missing ${relative}`).toBe(true);
  });

  it("the dashboard component CSS modules exist (colocated)", () => {
    const cssModules = [
      "shell/mode-dialogs.module.css",
      "shell/mode-toggle.module.css",
      "shell/mode-badge.module.css",
      "home/account-status-card.module.css",
      "home/onboarding-card.module.css",
      "developers/surface-state.module.css",
      "developers/api-keys-manager.module.css",
      "developers/create-key-dialog.module.css",
      "developers/request-logs-card.module.css",
      "developers/events-console.module.css",
      "developers/data-table.module.css",
    ] as const;
    for (const relative of cssModules) {
      expect(existsSync(join(componentsRoot, relative)), `missing ${relative}`).toBe(true);
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

  it("lib/developers-surface.ts is server-only and delegates to the pure developers-api module", () => {
    const source = readFileSync(join(here, "../src/lib/developers-surface.ts"), "utf8");
    expect(source).toMatch(/import "server-only"/);
    expect(source).toMatch(/from "\.\/developers-api(\.js)?"/);
  });

  it("the pure developers-api module carries NO server-only import and NO env access", () => {
    const source = readFileSync(join(here, "../src/lib/developers-api.ts"), "utf8");
    expect(source).not.toMatch(/import\s+"server-only"/);
    expect(source).not.toMatch(/process\.env/);
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
