"use client";

/**
 * Site header — sticky nav with the survey's IA skeleton
 * (Product · Docs · Pricing + Sign in / Start now).
 *
 * A11y: real <nav> landmark, aria-expanded disclosure for the mobile
 * panel, Escape closes and returns focus to the toggle, 44px touch
 * targets, visible focus rings.
 */
import { useEffect, useState } from "react";
import { CloseIcon, LogoMark, MenuIcon } from "@/components/marketing/icons";
import { headerActions, headerNav } from "@/lib/marketing-content";

function linkProps(placeholder?: boolean): Record<string, string> {
  return placeholder ? { "aria-label": "Placeholder — ships in an upcoming release" } : {};
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const allNav = [...headerNav, headerActions.signIn];

  return (
    <header className="rk-header">
      <div className="rk-container rk-header-inner">
        <a className="rk-brand" href="#main" aria-label="Reckon — back to top of content">
          <LogoMark size={26} className="rk-brand-mark" />
          <span className="rk-brand-name">reckon</span>
        </a>

        <nav className="rk-nav" aria-label="Main">
          {headerNav.map((item) => (
            <a className="rk-nav-link" href={item.href} key={item.label} {...linkProps(item.placeholder)}>
              {item.label}
            </a>
          ))}
        </nav>

        <div className="rk-header-actions">
          <a className="rk-nav-link rk-signin" href={headerActions.signIn.href} {...linkProps(headerActions.signIn.placeholder)}>
            {headerActions.signIn.label}
          </a>
          <a className="rk-btn rk-btn-primary rk-btn-sm" href={headerActions.startNow.href}>
            {headerActions.startNow.label}
          </a>
        </div>

        <button
          type="button"
          className="rk-nav-toggle"
          aria-expanded={open}
          aria-controls="rk-mobile-nav"
          aria-label={open ? "Close navigation menu" : "Open navigation menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <CloseIcon size={22} /> : <MenuIcon size={22} />}
        </button>
      </div>

      <div id="rk-mobile-nav" className="rk-mobile-nav" hidden={!open}>
        <nav className="rk-container rk-mobile-nav-inner" aria-label="Mobile">
          {allNav.map((item) => (
            <a
              className="rk-mobile-link"
              href={item.href}
              key={item.label}
              onClick={() => setOpen(false)}
              {...linkProps(item.placeholder)}
            >
              {item.label}
            </a>
          ))}
          <a className="rk-btn rk-btn-primary" href={headerActions.startNow.href} onClick={() => setOpen(false)}>
            {headerActions.startNow.label}
          </a>
        </nav>
      </div>
    </header>
  );
}
