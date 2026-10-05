"use client";

import { useEffect, useState } from "react";
import type { TocEntry } from "@/content/types";

/**
 * Right-hand "On this page" rail (Stripe docs pattern). Tracks the active
 * heading with an IntersectionObserver; the initial active state is the
 * first heading (set via the state initializer — no setState in effects,
 * so no cascading renders).
 */
export function OnThisPage({ headings }: { headings: readonly TocEntry[] }) {
  const [activeId, setActiveId] = useState<string>(headings[0]?.id ?? "");

  useEffect(() => {
    if (headings.length === 0) return;
    const elements = headings
      .map((heading) => document.getElementById(heading.id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;
    // Without IntersectionObserver support the rail keeps its initial
    // state (first heading) — still a usable, honest TOC.
    if (typeof IntersectionObserver === "undefined") return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visible.add(entry.target.id);
          } else {
            visible.delete(entry.target.id);
          }
        }
        // Prefer the first heading (document order) that is visible.
        const firstVisible = headings.find((heading) => visible.has(heading.id));
        if (firstVisible !== undefined) {
          setActiveId(firstVisible.id);
        } else if (visible.size === 0) {
          // Scrolled past everything visible: keep the nearest above.
          const scrollBottom = window.scrollY + window.innerHeight;
          let nearest: { id: string; top: number } | undefined;
          for (const el of elements) {
            if (el.getBoundingClientRect().top + window.scrollY < scrollBottom - 120) {
              nearest = { id: el.id, top: el.getBoundingClientRect().top };
            }
          }
          if (nearest !== undefined) setActiveId(nearest.id);
        }
      },
      { rootMargin: "-72px 0px -60% 0px", threshold: 0 },
    );
    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <nav className="docs-toc" aria-label="On this page">
      <p className="toc-title">On this page</p>
      <ul className="toc-list">
        {headings.map((heading) => (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
              className={`toc-link toc-level-${heading.level}`}
              data-active={heading.id === activeId ? "true" : "false"}
              aria-current={heading.id === activeId ? "true" : undefined}
            >
              {heading.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
