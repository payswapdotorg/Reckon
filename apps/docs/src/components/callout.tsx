import { RichText } from "./rich-text.js";

/**
 * Callout box. Variants: note (brand green), warning (amber), status
 * (neutral — used for target-contract / current-implementation notes).
 */

export type CalloutVariant = "note" | "warning" | "status";

const TITLES: Record<CalloutVariant, string> = {
  note: "Note",
  warning: "Warning",
  status: "Status",
};

const ICONS: Record<CalloutVariant, string> = {
  note: "ℹ",
  warning: "▲",
  status: "◦",
};

export function Callout({
  variant,
  title,
  body,
}: {
  variant: CalloutVariant;
  title?: string;
  body: readonly string[];
}) {
  const heading = title ?? TITLES[variant];
  return (
    <aside className={`callout callout-${variant}`}>
      <p className="callout-title">
        <span className="callout-icon" aria-hidden="true">
          {ICONS[variant]}
        </span>
        {heading}
      </p>
      <div className="callout-body">
        {body.map((paragraph, index) => (
          <p key={index}>
            <RichText text={paragraph} />
          </p>
        ))}
      </div>
    </aside>
  );
}
