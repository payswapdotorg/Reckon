/**
 * SearchInput — reference §5: rounded-rect, light-gray fill, left magnifier
 * icon, right `⌘K` kbd badge (pill, monospaced, light gray). This is the
 * trigger for the command palette (the global search + command surface is
 * part of the design language, reference §6). Collapses to an icon button
 * at mobile widths (§8).
 */
import { Search } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import styles from "./search-input.module.css";

export interface SearchInputProps extends ComponentPropsWithoutRef<"button"> {
  /** Accessible label for the trigger (default "Search"). */
  label?: string;
}

export function SearchInput({ label = "Search", className, ...props }: SearchInputProps) {
  return (
    <button
      type="button"
      aria-label={`${label} (Command K)`}
      className={`${styles.searchInput}${className ? ` ${className}` : ""}`}
      {...props}
    >
      <Search className={styles.icon} aria-hidden="true" strokeWidth={1.75} size={16} />
      <span className={styles.placeholder}>{label}</span>
      <kbd className={styles.kbd} aria-hidden="true">
        ⌘K
      </kbd>
    </button>
  );
}
