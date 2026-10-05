import type { ReactNode } from "react";
import { RichText } from "./rich-text.js";

/**
 * Small prose helpers rendered through the RichText inline convention
 * (`code`, **bold**, [label](href)).
 */

/** Plain paragraph. */
export function P({ text }: { text: string }) {
  return (
    <p>
      <RichText text={text} />
    </p>
  );
}

/** Lede paragraph under h1s. */
export function Lede({ text }: { text: string }) {
  return (
    <p className="docs-lede">
      <RichText text={text} />
    </p>
  );
}

/** Bulleted list. */
export function Bullets({ items }: { items: readonly string[] }) {
  return (
    <ul className="docs-bullets">
      {items.map((item, index) => (
        <li key={index}>
          <RichText text={item} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Section heading with a copyable anchor. `id` doubles as the "On this
 * page" TOC target, which is why headings are declared in the typed page
 * content and rendered through this component.
 */
export function SectionHeading({
  id,
  level,
  children,
}: {
  id: string;
  level: 2 | 3;
  children: string;
}) {
  const Tag = level === 2 ? "h2" : "h3";
  const className = level === 2 ? "docs-h2" : "docs-h3";
  return (
    <Tag id={id} className={className}>
      {children}
      <a
        href={`#${id}`}
        className="docs-anchor"
        aria-label={`Link to this section: ${children}`}
      >
        #
      </a>
    </Tag>
  );
}

/** Small container for arbitrary prose fragments. */
export function Prose({ children }: { children: ReactNode }) {
  return <div className="docs-prose-body">{children}</div>;
}
