/**
 * AdProvenanceBadge — law 9 made visible (AD-005): EVERY ad card carries
 * its origin class, one of three unconfusable treatments:
 *
 *   remembered        — retained in Personal Ad Memory from an OBSERVED
 *                       encounter (chart-1 green family, solid border,
 *                       History icon);
 *   retrieved         — retained in memory but seeded from supply
 *                       (provenance provider-supplied inside the
 *                       remembered lane; chart-4 teal family, dashed
 *                       border, Package icon);
 *   provider-supplied — newly declared available by a host/provider
 *                       channel, never in memory (chart-5 gray family,
 *                       dashed border, Signal icon).
 *
 * Following the EvidenceClassBadge accessibility law: hue + border style
 * + icon triple-differentiation, so the distinction survives
 * color-vision differences and grayscale — and the LABEL is always
 * rendered as the ultimate distinguisher. Hues derive from the reference
 * chart palette (semantic markers, not brand moments).
 */
import { History, Package, Signal, type LucideIcon } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import { AD_ORIGIN_BADGES, type AdOriginClass } from "@/lib/ads-view";
import styles from "./ad-provenance-badge.module.css";

const ORIGIN_ICONS: Record<AdOriginClass, LucideIcon> = {
  remembered: History,
  retrieved: Package,
  "provider-supplied": Signal,
};

export interface AdProvenanceBadgeProps extends ComponentPropsWithoutRef<"span"> {
  origin: AdOriginClass;
  /** Render the origin explanation as a tooltip (default true). */
  withTitle?: boolean;
}

export function AdProvenanceBadge({
  origin,
  withTitle = true,
  className,
  ...props
}: AdProvenanceBadgeProps) {
  const definition = AD_ORIGIN_BADGES[origin];
  const Icon = ORIGIN_ICONS[origin];
  const classes = `${styles.badge} ${styles[origin]}${className ? ` ${className}` : ""}`;
  return (
    <span
      className={classes}
      title={withTitle ? definition.detail : undefined}
      {...props}
    >
      <Icon className={styles.icon} aria-hidden="true" strokeWidth={1.75} size={12} />
      <span className={styles.label}>{definition.label}</span>
    </span>
  );
}
