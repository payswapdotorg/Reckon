import type { ReactNode } from "react";
import { DocsLink } from "./docs-link.js";

/**
 * Renders prose strings with a tiny inline convention (no markdown
 * runtime): `code`, **bold**, [label](/path-or-url).
 *
 * Pure presentational component — safe to use from both server and client
 * components.
 */

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g;
const LINK_FORM = /^\[([^\]]+)\]\(([^)]+)\)$/;

export function RichText({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      nodes.push(text.slice(cursor, index));
    }
    const raw = match[0];
    if (raw.startsWith("`")) {
      nodes.push(
        <code key={key++} className="rt-code">
          {raw.slice(1, -1)}
        </code>,
      );
    } else if (raw.startsWith("**")) {
      nodes.push(<strong key={key++}>{raw.slice(2, -2)}</strong>);
    } else {
      const link = LINK_FORM.exec(raw);
      if (link?.[1] !== undefined && link[2] !== undefined) {
        nodes.push(
          <DocsLink key={key++} href={link[2]}>
            {link[1]}
          </DocsLink>,
        );
      } else {
        nodes.push(raw);
      }
    }
    cursor = index + raw.length;
  }
  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }
  return <>{nodes}</>;
}
