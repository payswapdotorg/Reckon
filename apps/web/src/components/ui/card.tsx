/**
 * Card — reference §5: white surface, 12–16px radius, 1px solid var(--border),
 * generous internal padding, separation via borders and background contrast,
 * NOT shadows. The `degraded` tone implements the §7 honest-degradation
 * treatment (light red tint + soft red border) for data-unavailable states.
 */
import type { ComponentPropsWithoutRef, ElementType } from "react";
import styles from "./card.module.css";

export type CardTone = "default" | "degraded";
export type CardPadding = "none" | "default" | "generous";

export interface CardProps extends ComponentPropsWithoutRef<"section"> {
  tone?: CardTone;
  padding?: CardPadding;
}

function paddingClass(padding: CardPadding): string {
  if (padding === "none") return styles.paddingNone;
  if (padding === "generous") return styles.paddingGenerous;
  return styles.paddingDefault;
}

export function Card({ tone = "default", padding = "default", className, ...props }: CardProps) {
  const toneClass = tone === "degraded" ? ` ${styles.degraded}` : "";
  const classes = `${styles.card}${toneClass} ${paddingClass(padding)}${className ? ` ${className}` : ""}`;
  return <section className={classes.trim()} {...props} />;
}

export interface CardPartProps extends ComponentPropsWithoutRef<"div"> {
  as?: ElementType;
}

export function CardHeader({ className, ...props }: CardPartProps) {
  return <div className={`${styles.header}${className ? ` ${className}` : ""}`} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentPropsWithoutRef<"h3">) {
  return <h3 className={`${styles.title}${className ? ` ${className}` : ""}`} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentPropsWithoutRef<"p">) {
  return <p className={`${styles.description}${className ? ` ${className}` : ""}`} {...props} />;
}

export function CardContent({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={`${styles.content}${className ? ` ${className}` : ""}`} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={`${styles.footer}${className ? ` ${className}` : ""}`} {...props} />;
}
