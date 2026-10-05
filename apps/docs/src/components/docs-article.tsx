import type { ReactNode } from "react";
import type { TocEntry } from "@/content/types";
import { OnThisPage } from "./on-this-page.js";

/**
 * Page body: prose column + the "On this page" rail (desktop-xl only,
 * hidden by CSS below 1280px).
 */
export function DocsArticle({
  headings,
  children,
}: {
  headings: readonly TocEntry[];
  children: ReactNode;
}) {
  return (
    <div className="docs-article">
      <div className="docs-prose">{children}</div>
      <OnThisPage headings={headings} />
    </div>
  );
}
