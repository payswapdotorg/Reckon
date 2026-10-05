import { StatusBadge, type StatusVariant } from "./status-badge.js";

/**
 * Page hero: section eyebrow, h1, lede, and (optionally) the honest
 * status badge for target-contract surfaces.
 */
export function PageHeader({
  eyebrow,
  title,
  lede,
  status,
}: {
  eyebrow: string;
  title: string;
  lede: string;
  status?: { variant: StatusVariant; label: string };
}) {
  return (
    <header className="page-header">
      <p className="page-eyebrow">{eyebrow}</p>
      <h1 className="page-title">{title}</h1>
      <p className="page-lede">{lede}</p>
      {status !== undefined && <StatusBadge variant={status.variant} label={status.label} />}
    </header>
  );
}
