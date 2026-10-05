"use client";

import { useState } from "react";
import type { IntegrationTab } from "@/content/types";
import { CodeBlock } from "./code-block.js";

/**
 * Integration-option tabs (Stripe quickstart pattern): each tab is a
 * complete way to do the step (Hosted endpoint / SDK / Streaming). Tabs
 * are fully keyboard accessible (roving tabindex + arrow keys).
 */
export function CodeTabs({
  tabs,
  groupLabel = "Integration option",
}: {
  tabs: readonly IntegrationTab[];
  groupLabel?: string;
}) {
  const [activeId, setActiveId] = useState<string>(tabs[0]?.id ?? "");
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === activeId),
  );
  const activeTab = tabs[activeIndex];

  function select(index: number) {
    const tab = tabs[index];
    if (tab !== undefined) setActiveId(tab.id);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const last = tabs.length - 1;
    switch (event.key) {
      case "ArrowRight":
        select(activeIndex === last ? 0 : activeIndex + 1);
        break;
      case "ArrowLeft":
        select(activeIndex === 0 ? last : activeIndex - 1);
        break;
      case "Home":
        select(0);
        break;
      case "End":
        select(last);
        break;
      default:
        return;
    }
    event.preventDefault();
    const panel = document.getElementById(`tabpanel-${tabs[activeIndex]?.id ?? ""}`);
    panel?.querySelector<HTMLButtonElement>(".code-copy")?.focus();
  }

  if (activeTab === undefined) return null;

  return (
    <div className="code-tabs">
      <div
        role="tablist"
        aria-label={groupLabel}
        className="code-tablist"
        onKeyDown={onKeyDown}
      >
        {tabs.map((tab, index) => {
          const selected = tab.id === activeTab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`tabpanel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              className="code-tab"
              data-selected={selected ? "true" : "false"}
              onClick={() => select(index)}
            >
              <span className="code-tab-label">{tab.label}</span>
              <span className="code-tab-tagline">{tab.tagline}</span>
            </button>
          );
        })}
      </div>
      {tabs.map((tab) =>
        tab.id === activeTab.id ? (
          <div
            key={tab.id}
            role="tabpanel"
            id={`tabpanel-${tab.id}`}
            aria-labelledby={`tab-${tab.id}`}
            className="code-tabpanel"
          >
            {tab.samples.map((sample, index) => (
              <CodeBlock key={index} sample={sample} />
            ))}
          </div>
        ) : null,
      )}
    </div>
  );
}
