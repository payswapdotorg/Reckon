/**
 * AdvertisingMark — law 8 made visible (AD-005): advertising is ALWAYS
 * explicitly identifiable, anywhere it could coexist with ordinary
 * recommendations. Every ad card in the Ads section carries this mark,
 * and any kernel result row that maps to an ordinary (non-ad) candidate
 * deliberately does NOT — the visual treatments differ on sight.
 *
 * Treatment: the reference chart-2 amber family (the commercial-signal
 * hue — distinct from the emerald brand accent, which never marks
 * advertising) + a Megaphone outline icon + the word "Advertising".
 * The label is always rendered (color/icon are redundant channels).
 */
import { Megaphone } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import styles from "./advertising-mark.module.css";

export interface AdvertisingMarkProps extends ComponentPropsWithoutRef<"span"> {
  /** Compact form for dense rows (icon + "Ad"); default full ("Advertising"). */
  compact?: boolean;
}

export function AdvertisingMark({ compact = false, className, ...props }: AdvertisingMarkProps) {
  const classes = `${styles.mark}${compact ? ` ${styles.compact}` : ""}${
    className ? ` ${className}` : ""
  }`;
  return (
    <span
      className={classes}
      title="This is advertising — explicitly identified, and always distinct from ordinary recommendations (law 8)."
      {...props}
    >
      <Megaphone className={styles.icon} aria-hidden="true" strokeWidth={1.75} size={12} />
      <span className={styles.label}>{compact ? "Ad" : "Advertising"}</span>
    </span>
  );
}
