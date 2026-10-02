/**
 * NavDrawerProvider — shared open/close state for the mobile navigation
 * drawer (reference §8: sidebar hidden below tablet, hamburger drawer
 * off-canvas). Rendered by the server AppShell; consumed by the client
 * Sidebar (drawer) and SiteHeader (hamburger trigger).
 */
"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface NavDrawerContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const NavDrawerContext = createContext<NavDrawerContextValue | null>(null);

export function NavDrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((current) => !current), []);
  const value = useMemo(() => ({ isOpen, open, close, toggle }), [isOpen, open, close, toggle]);
  return <NavDrawerContext.Provider value={value}>{children}</NavDrawerContext.Provider>;
}

export function useNavDrawer(): NavDrawerContextValue {
  const context = useContext(NavDrawerContext);
  if (context === null) {
    throw new Error("useNavDrawer must be used inside <NavDrawerProvider>");
  }
  return context;
}
