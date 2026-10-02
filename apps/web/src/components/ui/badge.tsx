/**
 * Badge — reference §5: pill-shaped, light-gray, monospaced tags
 * (e.g. the env indicator `ENV: LOCAL`). Uppercase rendering is opt-in
 * because sentence case is the default casing everywhere else (§4).
 */
import type { ComponentPropsWithoutRef } from "react";
import styles from "./badge.module.css";

export interface BadgeProps extends ComponentPropsWithoutRef<"span"> {
  uppercase?: boolean;
}

export function Badge({ uppercase = false, className, ...props }: BadgeProps) {
  const classes = `${styles.badge}${uppercase ? ` ${styles.uppercase}` : ""}${
    className ? ` ${className}` : ""
  }`;
  return <span className={classes.trim()} {...props} />;
}
