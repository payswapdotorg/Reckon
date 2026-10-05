/**
 * Footer — the four-surface IA (survey §1: Product · Docs · Pricing ·
 * Dashboard) as placeholder links, plus product / developer / company
 * columns and the contract version chip.
 */
import { LogoMark } from "@/components/marketing/icons";
import {
  footerColumns,
  footerMeta,
  footerSurfaces,
} from "@/lib/marketing-content";

function placeholderProps(placeholder?: boolean): Record<string, string> {
  return placeholder ? { "aria-label": "Placeholder — ships in an upcoming release" } : {};
}

export function SiteFooter() {
  return (
    <footer className="rk-footer">
      <div className="rk-container">
        <div className="rk-footer-surfaces" aria-label="Reckon surfaces">
          {footerSurfaces.map((surface, index) => (
            <span key={surface.label} className="rk-footer-surface-item">
              {index > 0 ? (
                <span className="rk-footer-surface-sep" aria-hidden="true">
                  ·
                </span>
              ) : null}
              <a className="rk-footer-surface-link" href={surface.href} {...placeholderProps(surface.placeholder)}>
                {surface.label}
              </a>
            </span>
          ))}
        </div>

        <div className="rk-footer-grid">
          <div className="rk-footer-brand">
            <a className="rk-brand rk-brand-footer" href="#main" aria-label="Reckon — back to top of content">
              <LogoMark size={24} className="rk-brand-mark" />
              <span className="rk-brand-name">reckon</span>
            </a>
            <p className="rk-footer-brand-line">{footerMeta.brandLine}</p>
          </div>

          {footerColumns.map((column) => (
            <nav className="rk-footer-col" aria-label={column.heading} key={column.heading}>
              <h3 className="rk-footer-col-heading">{column.heading}</h3>
              <ul>
                {column.links.map((link) => (
                  <li key={link.label}>
                    <a className="rk-footer-link" href={link.href} {...placeholderProps(link.placeholder)}>
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="rk-footer-bottom">
          <p className="rk-footer-copy">{footerMeta.copyright}</p>
          <span className="rk-footer-chip">{footerMeta.contractChip}</span>
        </div>
      </div>
    </footer>
  );
}
