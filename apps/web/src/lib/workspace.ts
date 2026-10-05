/**
 * Reckon Studio workspace registry — the single source for the S3-001
 * dashboard information architecture plus the foundation studio
 * workspaces, their titles/subtitles, honest empty-state copy, sidebar
 * grouping and parent/child structure.
 *
 * S3-001 IA (docs/surveys/stripe-com-survey.md §1/§5, dashboard model):
 * the operator dashboard sections — Home · Recommendations · Models ·
 * Data Sources · Analytics · Developers · Settings — lead the rail,
 * with the developer platform surfaces (API keys, request logs, events)
 * as children of the Developers section. The six foundation studio
 * workspaces (UI-001) keep their hrefs and remain below the dashboard
 * groups; Settings closes the rail in the ACCOUNT group (reference §6
 * arrangement language).
 *
 * Dependency-free and React-free by design: consumed by server components
 * (page metadata), client components (nav active state, breadcrumbs) and
 * the root NodeNext typecheck via test/workspace.test.ts.
 *
 * Icon names are string ids mapped to lucide outline icons inside the
 * components (this module must not import React).
 */

export type NavIconId =
  | "home"
  | "recommendations"
  | "models"
  | "dataSources"
  | "analytics"
  | "developers"
  | "apiKeys"
  | "requestLogs"
  | "events"
  | "decisions"
  | "plans"
  | "scheduler"
  | "agents"
  | "research"
  | "integrations"
  | "settings";

export type NavGroupId =
  | "landing"
  | "operate"
  | "developers"
  | "build"
  | "intelligence"
  | "integrate"
  | "account";

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
  /**
   * Parent section href for nested routes (developer sub-surfaces).
   * The parent must be registered, live in the same nav group and
   * precede its children. Undefined for top-level routes.
   */
  readonly parentHref?: string;
  /**
   * Existing workspace hrefs that already surface related data — rendered
   * as honest "related surfaces" links on placeholder section pages so an
   * operator can reach live views without waiting for the section itself.
   */
  readonly relatedHrefs?: readonly string[];
}

export const WORKSPACE_ROUTES: readonly WorkspaceRoute[] = [
  {
    href: "/",
    title: "Home",
    navLabel: "Home",
    subtitle:
      "The operator home — account live status, the path to your first recommendation, and the decision loop, in one place.",
    emptyStateReason:
      "connect the API — account status, onboarding progress and decision activity appear here once the Reckon API answers.",
    navGroup: "landing",
    icon: "home",
  },
  {
    href: "/recommendations",
    title: "Recommendations",
    navLabel: "Recommendations",
    subtitle:
      "Every recommendation served — the decision behind it, the experience chosen, and the outcome that followed.",
    emptyStateReason:
      "the recommendation monitor arrives with the operator dashboard backend — until then, live decision records are viewable by id in Decisions.",
    navGroup: "operate",
    icon: "recommendations",
    relatedHrefs: ["/decisions", "/plans", "/scheduler"],
  },
  {
    href: "/models",
    title: "Models",
    navLabel: "Models",
    subtitle:
      "The model registry — providers, adapters, assignments and their verified capability versus declared capability.",
    emptyStateReason:
      "the model registry arrives with the operator dashboard backend — agent bodies (including model assignments) are viewable in Agents.",
    navGroup: "operate",
    icon: "models",
    relatedHrefs: ["/agents"],
  },
  {
    href: "/data-sources",
    title: "Data Sources",
    navLabel: "Data Sources",
    subtitle:
      "Catalogs, event streams and adapter inputs — what Reckon knows about, where it came from, and what it has been used for.",
    emptyStateReason:
      "the data-source registry arrives with the operator dashboard backend — adapter capability cards are viewable in Integrations.",
    navGroup: "operate",
    icon: "dataSources",
    relatedHrefs: ["/integrations"],
  },
  {
    href: "/analytics",
    title: "Analytics",
    navLabel: "Analytics",
    subtitle:
      "CTR lift, latency percentiles, drift indicators and funnels — measured on real traffic, never fabricated.",
    emptyStateReason:
      "connect the API — each view states its real evidence class here: observed data when a surface answers, the pending route named when it does not.",
    navGroup: "operate",
    icon: "analytics",
    relatedHrefs: ["/research"],
  },
  {
    href: "/developers",
    title: "Developers",
    navLabel: "Developers",
    subtitle:
      "The developer platform surface — API keys, request logs and the webhook events console over the versioned Reckon API.",
    emptyStateReason:
      "connect the API — the developer surfaces report their real state here and on their own pages.",
    navGroup: "developers",
    icon: "developers",
  },
  {
    href: "/developers/keys",
    title: "API keys",
    navLabel: "API keys",
    subtitle:
      "Create, inspect and revoke the account's sk_/pk_ keys — secrets are shown exactly once, at creation time.",
    emptyStateReason:
      "connect the API — key records appear here once the key-management surface answers.",
    navGroup: "developers",
    icon: "apiKeys",
    parentHref: "/developers",
  },
  {
    href: "/developers/logs",
    title: "Request logs",
    navLabel: "Request logs",
    subtitle:
      "Every API request as it happened — method, route, status, latency and the key that made it, cursor-paginated.",
    emptyStateReason:
      "connect the API — request logs appear here once the request-log surface answers.",
    navGroup: "developers",
    icon: "requestLogs",
    parentHref: "/developers",
  },
  {
    href: "/developers/events",
    title: "Events",
    navLabel: "Events",
    subtitle:
      "Webhook events sent for the account — type, delivery status and replay, the S2-002 surface.",
    emptyStateReason:
      "connect the API — webhook events appear here once the events surface answers.",
    navGroup: "developers",
    icon: "events",
    parentHref: "/developers",
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
  {
    href: "/settings",
    title: "Settings",
    navLabel: "Settings",
    subtitle:
      "Account settings — workspace identity, defaults and danger-zone controls.",
    emptyStateReason:
      "the account settings surface arrives with the operator dashboard backend — the test/live mode toggle already lives in the sidebar.",
    navGroup: "account",
    icon: "settings",
  },
];

/**
 * Sidebar navigation groups. Group labels render UPPERCASE with wide
 * tracking (reference §4/§6). The S3-001 dashboard sections lead
 * (OPERATE, DEVELOPERS), the foundation studio workspaces follow
 * (BUILD, INTELLIGENCE, INTEGRATE) and ACCOUNT closes the rail — the
 * reference app's arrangement language (§6: "ACCOUNT → Settings").
 */
export const NAV_GROUPS: readonly { readonly id: NavGroupId; readonly label: string }[] = [
  { id: "operate", label: "OPERATE" },
  { id: "developers", label: "DEVELOPERS" },
  { id: "build", label: "BUILD" },
  { id: "intelligence", label: "INTELLIGENCE" },
  { id: "integrate", label: "INTEGRATE" },
  { id: "account", label: "ACCOUNT" },
];

/** Routes per nav group, in registry order. The landing route renders ungrouped first. */
export function navRoutesForGroup(groupId: NavGroupId): readonly WorkspaceRoute[] {
  return WORKSPACE_ROUTES.filter((route) => route.navGroup === groupId);
}

/**
 * One nav tree entry: a top-level route plus its nested children (routes
 * whose parentHref points at it), both in registry order.
 */
export interface NavTreeEntry {
  readonly route: WorkspaceRoute;
  readonly children: readonly WorkspaceRoute[];
}

/** Parent/child nav tree for a group (top-level routes with nested children). */
export function navTreeForGroup(groupId: NavGroupId): readonly NavTreeEntry[] {
  const routes = navRoutesForGroup(groupId);
  const parents = routes.filter((route) => route.parentHref === undefined);
  return parents.map((parent) => ({
    route: parent,
    children: routes.filter((child) => child.parentHref === parent.href),
  }));
}

/** The parent route for a nested route, or null for top-level routes. */
export function parentWorkspaceRoute(route: WorkspaceRoute): WorkspaceRoute | null {
  if (route.parentHref === undefined) {
    return null;
  }
  return WORKSPACE_ROUTES.find((candidate) => candidate.href === route.parentHref) ?? null;
}

/** Registry lookup by exact href — null when unknown. */
export function findWorkspaceRoute(href: string): WorkspaceRoute | null {
  return WORKSPACE_ROUTES.find((candidate) => candidate.href === href) ?? null;
}

/**
 * Resolve a pathname to its workspace route, MOST SPECIFIC FIRST: the
 * longest matching href wins, so `/developers/keys` resolves to the API
 * keys page rather than its parent `/developers` section. Returns null
 * for unknown paths.
 */
export function getWorkspaceRoute(pathname: string): WorkspaceRoute | null {
  if (pathname === "/") {
    return WORKSPACE_ROUTES.find((route) => route.href === "/") ?? null;
  }
  const candidates = WORKSPACE_ROUTES.filter(
    (route) => route.href !== "/" && (route.href === pathname || pathname.startsWith(`${route.href}/`)),
  );
  if (candidates.length === 0) {
    return null;
  }
  return candidates.reduce((best, route) => (route.href.length > best.href.length ? route : best));
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

/**
 * Friendly nav hint for a route — where it sits in the IA. Nested routes
 * carry their parent section's title ("Developers"); top-level routes
 * carry their nav group label ("OPERATE"). Used by the command palette's
 * result rows and any "you are here" surface.
 */
export function navHintForRoute(route: WorkspaceRoute): string {
  const parent = parentWorkspaceRoute(route);
  if (parent !== null) {
    return parent.title;
  }
  if (route.navGroup === "landing") {
    return "Home";
  }
  return NAV_GROUPS.find((group) => group.id === route.navGroup)?.label ?? route.navGroup.toUpperCase();
}

/**
 * Breadcrumb trail for a pathname: the resolved route followed by its
 * parent chain (innermost last). The root crumb ("Reckon Studio") is
 * added by the header, not here.
 */
export function breadcrumbTrailFor(pathname: string): readonly WorkspaceRoute[] {
  const route = getWorkspaceRoute(pathname);
  if (route === null) {
    return [];
  }
  const parent = parentWorkspaceRoute(route);
  return parent === null ? [route] : [parent, route];
}

/** The dashboard section routes (the S3-001 IA), in registry order. */
export const DASHBOARD_SECTION_HREFS: readonly string[] = [
  "/",
  "/recommendations",
  "/models",
  "/data-sources",
  "/analytics",
  "/developers",
  "/settings",
];

/** The developer sub-surface routes (children of the Developers section). */
export const DEVELOPER_SURFACE_HREFS: readonly string[] = [
  "/developers/keys",
  "/developers/logs",
  "/developers/events",
];
