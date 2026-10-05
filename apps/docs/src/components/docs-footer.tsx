import { DocsLink } from "./docs-link.js";

/**
 * Docs footer. The shell keeps it pinned to the bottom of the viewport on
 * short pages (flex column + margin-top:auto) and pushed down naturally
 * on long pages.
 */
export function DocsFooter() {
  return (
    <footer className="docs-footer">
      <div className="footer-inner">
        <p className="footer-copy">
          © 2026 Reckon · Provider-neutral recommendation, experience planning and
          scheduling infrastructure.
        </p>
        <nav className="footer-links" aria-label="Footer">
          <DocsLink href="/get-started/quickstart">Quickstart</DocsLink>
          <DocsLink href="/api-reference/authentication">API reference</DocsLink>
          <DocsLink href="/webhooks">Webhooks</DocsLink>
          <DocsLink href="/sdks">SDKs</DocsLink>
          <DocsLink href="/changelog">Changelog</DocsLink>
        </nav>
      </div>
    </footer>
  );
}
