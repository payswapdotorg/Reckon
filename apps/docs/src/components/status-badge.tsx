/**
 * Lifecycle status pill for documented surfaces (honest-degradation law
 * applied to docs: the portal marks TARGET-contract surfaces instead of
 * claiming they are live).
 */

export type StatusVariant = "live" | "target";

export function StatusBadge({
  variant,
  label,
}: {
  variant: StatusVariant;
  label: string;
}) {
  return (
    <span className={`status-badge status-${variant}`}>
      <span className="status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

/** Compact dot used inline after sidebar links and card titles. */
export function TargetDot({ title }: { title: string }) {
  return (
    <span className="target-dot" title={title} aria-label={title}>
      S2
    </span>
  );
}
