/**
 * CommandPalette — reference §6: command palette (⌘K) with
 * "Search for a command to run…" placeholder; the global search + command
 * surface is part of the design language. The foundation palette is honest
 * and small: it lists the REAL workspace routes (no fabricated search
 * results), filters them as you type, and navigates on Enter.
 *
 * Client component. Keyboard model: ⌘K/Ctrl+K toggles, Escape closes,
 * ↑/↓ move, Enter navigates. Clicking the overlay closes.
 */
"use client";

import { ArrowDown, ArrowUp, CornerDownLeft, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { WORKSPACE_ROUTES, type WorkspaceRoute } from "@/lib/workspace";
import styles from "./command-palette.module.css";

export interface CommandPaletteProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}

interface PaletteCommand {
  readonly route: WorkspaceRoute;
  readonly keywords: string;
}

const COMMANDS: readonly PaletteCommand[] = WORKSPACE_ROUTES.map((route) => ({
  route,
  keywords: `${route.title} ${route.navLabel} ${route.subtitle} ${route.navGroup}`.toLowerCase(),
}));

export function CommandPalette({ open, onOpen, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return COMMANDS;
    }
    return COMMANDS.filter((command) => command.keywords.includes(needle));
  }, [query]);

  // Global keyboard shortcuts: ⌘K / Ctrl+K toggles the palette.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) {
          onClose();
        } else {
          onOpen();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpen, onClose]);

  // Focus the input whenever the palette opens; reset transient state on close.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      inputRef.current?.focus();
    }
  }, [open]);

  function navigate(command: PaletteCommand | undefined) {
    if (!command) {
      return;
    }
    onClose();
    router.push(command.route.href);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (results.length === 0 ? 0 : (current + 1) % results.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (results.length === 0 ? 0 : (current - 1 + results.length) % results.length));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      navigate(results[activeIndex]);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div
      className={styles.overlay}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className={styles.palette}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.inputRow}>
          <Search className={styles.inputIcon} aria-hidden="true" strokeWidth={1.75} size={16} />
          <input
            ref={inputRef}
            type="text"
            className={styles.input}
            placeholder="Search for a command to run…"
            aria-label="Search for a command to run"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
          />
        </div>
        <ul className={styles.resultList} role="listbox" aria-label="Commands">
          {results.map((command, index) => (
            <li key={command.route.href} role="option" aria-selected={index === activeIndex}>
              <button
                type="button"
                className={index === activeIndex ? `${styles.result} ${styles.resultActive}` : styles.result}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => navigate(command)}
              >
                <span className={styles.resultGroup}>{command.route.navGroup}</span>
                <span className={styles.resultTitle}>{command.route.title}</span>
                <span className={styles.resultHint}>{command.route.subtitle}</span>
              </button>
            </li>
          ))}
          {results.length === 0 ? (
            <li className={styles.empty}>
              No commands match “{query.trim()}” — the palette lists the real Reckon workspaces.
            </li>
          ) : null}
        </ul>
        <div className={styles.footer}>
          <span className={styles.footerHint}>
            <ArrowUp aria-hidden="true" size={11} />
            <ArrowDown aria-hidden="true" size={11} />
            navigate
          </span>
          <span className={styles.footerHint}>
            <CornerDownLeft aria-hidden="true" size={11} />
            open
          </span>
          <span className={styles.footerHint}>
            <kbd className={styles.footerKbd}>esc</kbd>
            close
          </span>
        </div>
      </div>
    </div>
  );
}
