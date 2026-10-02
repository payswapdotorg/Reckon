/**
 * Button — reference §5: primary = solid green fill (#009768), white text,
 * 8px radius, compact padding, `+` icon prefix on create-actions (pass the
 * icon as a child); secondary = white/outline "ghost" with gray border.
 * Renders an anchor when `href` is set (Next Link keeps client-side nav).
 */
import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md";

export interface CommonButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export interface ButtonAsButtonProps extends CommonButtonProps, ButtonHTMLAttributes<HTMLButtonElement> {
  href?: undefined;
}

export interface ButtonAsLinkProps extends CommonButtonProps, AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
}

export type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps;

function classesFor({ variant = "secondary", size = "md", className }: CommonButtonProps): string {
  const variantClass =
    variant === "primary" ? styles.primary : variant === "ghost" ? styles.ghost : styles.secondary;
  const sizeClass = size === "sm" ? styles.small : styles.medium;
  return `${styles.button} ${variantClass} ${sizeClass}${className ? ` ${className}` : ""}`;
}

export function Button(props: ButtonProps) {
  const { leadingIcon, children, className, ...rest } = props;
  if (props.href !== undefined) {
    const { href, ...linkRest } = rest as ButtonAsLinkProps;
    return (
      <Link href={href} className={classesFor(props)} {...linkRest}>
        {leadingIcon}
        {children}
      </Link>
    );
  }
  const buttonRest = rest as ButtonAsButtonProps;
  return (
    <button type={buttonRest.type ?? "button"} className={classesFor(props)} {...buttonRest}>
      {leadingIcon}
      {children}
    </button>
  );
}
