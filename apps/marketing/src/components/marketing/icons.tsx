/**
 * Reckon marketing — dependency-free inline SVG icon set.
 *
 * Custom-drawn (lucide-style stroke geometry) instead of importing a icon
 * package: the monorepo `apps/marketing` build must add zero new runtime
 * dependencies, and the two build targets ship different lucide majors.
 * Every icon is a pure presentational SVG: aria-hidden, currentColor.
 */
import type { SVGProps } from "react";
import type { ProductIconKind } from "@/lib/marketing-content";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 24, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: "false" as const,
    ...rest,
  };
}

/** Brand mark: one input signal routed to a chosen output (the decision). */
export function LogoMark({ size = 26, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path
        d="M6.9 11.1c4-2.6 7.1-3.9 10.2-4.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.55"
      />
      <path
        d="M6.9 12.9c4 2.6 7.1 3.9 10.2 4.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.55"
      />
      <path
        d="M6.6 10.9c4.4-1.2 8.2-1.2 11 .4"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M6.6 13.1c4.4 1.2 8.2 1.2 11-.4"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="4.6" cy="12" r="2.5" fill="currentColor" stroke="none" />
      <circle cx="19.4" cy="6.2" r="1.6" fill="currentColor" stroke="none" opacity="0.9" />
      <circle cx="19.4" cy="17.8" r="1.6" fill="currentColor" stroke="none" opacity="0.5" />
    </svg>
  );
}

export function ArrowRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 12h14" />
      <path d="M13 6.5 18.5 12 13 17.5" />
    </svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 8.5h16" />
      <path d="M4 15.5h16" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 12.5 9 17l10.5-10.5" />
    </svg>
  );
}

/** Terminal prompt — the Recommendation API. */
export function ApiIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4.5" width="18" height="15" rx="3" />
      <path d="M7 9.5 9.5 12 7 14.5" />
      <path d="M12.5 15h4.5" />
    </svg>
  );
}

/** Person + affinity spark — Personalization. */
export function PersonalizationIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="10" cy="8.5" r="3.5" />
      <path d="M3.5 19.5c1.4-3.4 3.9-5 6.5-5 1.6 0 3.1.5 4.4 1.6" />
      <path d="M17 4.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" />
    </svg>
  );
}

/** Clock with send arc — Scheduling. */
export function SchedulingIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="11" cy="12" r="7.5" />
      <path d="M11 8.5V12l2.5 2" />
      <path d="M19.5 5.5c.8 1.3 1.2 2.6 1.3 4" />
    </svg>
  );
}

/** Rising signal with proof dots — Analytics. */
export function AnalyticsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 4.5v15h16" />
      <path d="M7.5 15.5 12 10.5l3 2.5 4.5-5.5" />
      <circle cx="19.5" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export const productIcons: Record<ProductIconKind, (props: IconProps) => React.ReactElement> = {
  api: ApiIcon,
  personalization: PersonalizationIcon,
  scheduling: SchedulingIcon,
  analytics: AnalyticsIcon,
};
