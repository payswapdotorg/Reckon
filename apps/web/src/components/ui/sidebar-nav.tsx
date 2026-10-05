/**
 * SidebarNav — reference §6: vertical list grouped by UPPERCASE category
 * labels (11–12px, medium weight, wide tracking) with vertical gaps between
 * groups; outline (stroke) icons left of each item; active item gets the
 * darker fill (#26262a → var(--sidebar-accent)) + brighter text.
 *
 * S3-001: renders the dashboard IA — OPERATE/DEVELOPERS groups lead,
 * the foundation studio groups follow, ACCOUNT (Settings) closes the
 * rail. The Developers section carries nested children (API keys,
 * Request logs, Events): the child gets aria-current + active fill; the
 * parent gets the section-active fill while any child is open.
 *
 * Client component: active-state detection needs the current pathname.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  Boxes,
  ChartLine,
  Database,
  FlaskConical,
  House,
  KeyRound,
  List,
  Plug,
  Radio,
  Route,
  Scale,
  Settings,
  Sparkles,
  Terminal,
  Timer,
  type LucideIcon,
} from "lucide-react";
import {
  NAV_GROUPS,
  getWorkspaceRoute,
  navRoutesForGroup,
  navTreeForGroup,
  type WorkspaceRoute,
} from "@/lib/workspace";
import styles from "./sidebar-nav.module.css";

const NAV_ICONS: Record<WorkspaceRoute["icon"], LucideIcon> = {
  home: House,
  recommendations: Sparkles,
  models: Boxes,
  dataSources: Database,
  analytics: ChartLine,
  developers: Terminal,
  apiKeys: KeyRound,
  requestLogs: List,
  events: Radio,
  decisions: Scale,
  plans: Route,
  scheduler: Timer,
  agents: Bot,
  research: FlaskConical,
  integrations: Plug,
  settings: Settings,
};
function isActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

interface NavItemProps {
  readonly route: WorkspaceRoute;
  readonly pathname: string;
  /** Nested children render indented (developer sub-surfaces). */
  readonly nested?: boolean;
}

function NavItem({ route, pathname, nested = false }: NavItemProps) {
  const Icon = NAV_ICONS[route.icon];
  const active = isActive(pathname, route.href);
  // aria-current only on the exact resolved route (a parent section is
  // visually active while a child is open, but is not "the page").
  const exact = getWorkspaceRoute(pathname)?.href === route.href;
  const classes = [
    styles.item,
    nested ? styles.itemNested : "",
    active ? styles.itemActive : "",
  ]
    .filter((entry) => entry.length > 0)
    .join(" ");
  return (
    <Link
      href={route.href}
      aria-current={exact ? "page" : undefined}
      className={classes}
    >
      <Icon className={styles.itemIcon} aria-hidden="true" strokeWidth={1.75} size={16} />
      <span>{route.navLabel}</span>
    </Link>
  );
}

export function SidebarNav() {
  const pathname = usePathname() ?? "/";
  const landing = navRoutesForGroup("landing");
  return (
    <nav aria-label="Workspaces" className={styles.nav}>
      <ul className={styles.list} aria-label="Home">
        {landing.map((route) => (
          <li key={route.href}>
            <NavItem route={route} pathname={pathname} />
          </li>
        ))}
      </ul>
      {NAV_GROUPS.map((group) => {
        const tree = navTreeForGroup(group.id);
        if (tree.length === 0) {
          return null;
        }
        return (
          <div key={group.id} className={styles.group}>
            <div className={styles.groupLabel} aria-hidden="true">
              {group.label}
            </div>
            <ul className={styles.list}>
              {tree.map((entry) => (
                <li key={entry.route.href}>
                  <NavItem route={entry.route} pathname={pathname} />
                  {entry.children.length > 0 ? (
                    <ul className={styles.list} aria-label={`${entry.route.title} surfaces`}>
                      {entry.children.map((child) => (
                        <li key={child.href}>
                          <NavItem route={child} pathname={pathname} nested />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
