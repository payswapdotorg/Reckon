/**
 * Reckon Studio workspace registry — the single source for the seven
 * foundation routes (UI-001), their titles/subtitles (Reckon's own product
 * copy, per FINAL TL HANDOFF §8–§14) and the sidebar navigation grouping
 * (You-Platform arrangement language per docs/ux/you-platform-reference.md
 * §6: uppercase category groups, Overview as the landing item).
 *
 * Dependency-free and React-free by design: consumed by server components
 * (page metadata), client components (nav active state, breadcrumbs) and
 * the root NodeNext typecheck via test/workspace.test.ts.
 *
 * Icon names are string ids mapped to lucide outline icons inside the
 * components (this module must not import React).
 */

export type NavIconId =
  | "overview"
  | "decisions"
  | "plans"
  | "scheduler"
  | "agents"
  | "research"
  | "integrations";

export type NavGroupId = "landing" | "build" | "intelligence" | "integrate";

export interface WorkspaceRoute {
  /** App-router path. Must have a matching page under src/app. */
  readonly href: string;
  /** Page H1 + document title (sentence case, Reckon's own vocabulary). */
  readonly title: string;
  /** Nav item label (defaults to the title). */
  readonly navLabel: string;
  /** Page subtitle — what this workspace shows once the API is connected. */
  readonly subtitle: string;
  /** Honest empty-state reason shown while no data is loaded. */
  readonly emptyStateReason: string;
  /** Which sidebar group the route belongs to ("landing" renders first, ungrouped). */
  readonly navGroup: NavGroupId;
  /** Outline icon id for the sidebar nav. */
  readonly icon: NavIconId;
}

export const WORKSPACE_ROUTES: readonly WorkspaceRoute[] = [
  {
    href: "/",
    title: "Overview",
    navLabel: "Overview",
    subtitle:
      "What should happen next — decision activity, active plans, recent outcomes, policy performance and learning state, in one place.",
    emptyStateReason:
      "connect the API — decision activity, plans, outcomes and learning state appear here once the Reckon API answers.",
    navGroup: "landing",
    icon: "overview",
  },
  {
    href: "/decisions",
    title: "Decisions",
    navLabel: "Decisions",
    subtitle:
      "Context, candidates, experiences and the selected decision — with policy, uncertainty, constraints and switching cost in the open.",
    emptyStateReason:
      "connect the API — requested decisions and their full context → candidates → experience → action trail appear here.",
    navGroup: "build",
    icon: "decisions",
  },
  {
    href: "/plans",
    title: "Plans",
    navLabel: "Plans",
    subtitle:
      "Rolling experience plans — now, next, queued, opportunity and the future horizon, with replan triggers and resume checkpoints.",
    emptyStateReason:
      "connect the API — experience plans and their timeline positions appear here.",
    navGroup: "build",
    icon: "plans",
  },
  {
    href: "/scheduler",
    title: "Scheduler",
    navLabel: "Scheduler",
    subtitle:
      "Ranking is not permission to interrupt — hold, suggest, switch, interrupt and resume decisions, each with its costs spelled out.",
    emptyStateReason:
      "connect the API — scheduler actions and interruption economics appear here.",
    navGroup: "build",
    icon: "scheduler",
  },
  {
    href: "/agents",
    title: "Agents",
    navLabel: "Agents",
    subtitle:
      "Agent bodies and organizations — roles, model assignments, tools, budgets, latency limits and their evaluation record.",
    emptyStateReason:
      "connect the API — agent bodies and organization graphs appear here.",
    navGroup: "intelligence",
    icon: "agents",
  },
  {
    href: "/research",
    title: "Research",
    navLabel: "Research",
    subtitle:
      "The learning ladder — experiments across supervised, bandit, offline, simulated and bounded-live rungs, with evidence classes and calibration.",
    emptyStateReason:
      "connect the API — experiments, their evidence classes and calibration results appear here.",
    navGroup: "intelligence",
    icon: "research",
  },
  {
    href: "/integrations",
    title: "Integrations",
    navLabel: "Integrations",
    subtitle:
      "Capability cards for every adapter — what each integration can do, and what has actually been verified live versus declared.",
    emptyStateReason:
      "connect the API — adapter capability cards with live verification status appear here.",
    navGroup: "integrate",
    icon: "integrations",
  },
];

/**
 * Sidebar navigation groups. Group labels render UPPERCASE with wide
 * tracking (reference §4/§6); the grouping follows the Reckon mapping
 * from reference §6 — not the reference app's own item names.
 */
export const NAV_GROUPS: readonly { readonly id: NavGroupId; readonly label: string }[] = [
  { id: "build", label: "BUILD" },
  { id: "intelligence", label: "INTELLIGENCE" },
  { id: "integrate", label: "INTEGRATE" },
];

/** Routes per nav group, in registry order. The landing route renders ungrouped first. */
export function navRoutesForGroup(groupId: NavGroupId): readonly WorkspaceRoute[] {
  return WORKSPACE_ROUTES.filter((route) => route.navGroup === groupId);
}

export function getWorkspaceRoute(pathname: string): WorkspaceRoute | null {
  if (pathname === "/") {
    return WORKSPACE_ROUTES.find((route) => route.href === "/") ?? null;
  }
  return (
    WORKSPACE_ROUTES.find(
      (route) => route.href !== "/" && (route.href === pathname || pathname.startsWith(`${route.href}/`)),
    ) ?? null
  );
}

/**
 * Guaranteed registry lookup by exact href — throws loudly (at build time,
 * since pages call it at module scope) if the registry and the route tree
 * ever drift apart. Tests assert consistency both ways.
 */
export function requireWorkspaceRoute(href: string): WorkspaceRoute {
  const route = WORKSPACE_ROUTES.find((candidate) => candidate.href === href);
  if (route === undefined) {
    throw new Error(`No workspace route registered for href "${href}"`);
  }
  return route;
}
