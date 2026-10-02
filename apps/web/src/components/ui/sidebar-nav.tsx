/**
 * SidebarNav — reference §6: vertical list grouped by UPPERCASE category
 * labels (11–12px, medium weight, wide tracking) with vertical gaps between
 * groups; outline (stroke) icons left of each item; active item gets the
 * darker fill (#26262a → var(--sidebar-accent)) + brighter text.
 *
 * Client component: active-state detection needs the current pathname.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  FlaskConical,
  LayoutDashboard,
  Plug,
  Route,
  Scale,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { NAV_GROUPS, navRoutesForGroup, type WorkspaceRoute } from "@/lib/workspace";
import styles from "./sidebar-nav.module.css";

const NAV_ICONS: Record<WorkspaceRoute["icon"], LucideIcon> = {
  overview: LayoutDashboard,
  decisions: Scale,
  plans: Route,
  scheduler: Timer,
  agents: Bot,
  research: FlaskConical,
  integrations: Plug,
};

function isActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavItem({ route, pathname }: { route: WorkspaceRoute; pathname: string }) {
  const Icon = NAV_ICONS[route.icon];
  const active = isActive(pathname, route.href);
  return (
    <Link
      href={route.href}
      aria-current={active ? "page" : undefined}
      className={active ? `${styles.item} ${styles.itemActive}` : styles.item}
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
      <ul className={styles.list} aria-label="Overview">
        {landing.map((route) => (
          <li key={route.href}>
            <NavItem route={route} pathname={pathname} />
          </li>
        ))}
      </ul>
      {NAV_GROUPS.map((group) => {
        const routes = navRoutesForGroup(group.id);
        if (routes.length === 0) {
          return null;
        }
        return (
          <div key={group.id} className={styles.group}>
            <div className={styles.groupLabel} aria-hidden="true">
              {group.label}
            </div>
            <ul className={styles.list}>
              {routes.map((route) => (
                <li key={route.href}>
                  <NavItem route={route} pathname={pathname} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
