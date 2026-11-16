import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

export function Button({ variant = "primary", className = "", ...rest }: ButtonProps) {
  const base =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition nx-focus disabled:cursor-not-allowed disabled:opacity-50";

  const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
    primary: "bg-accent text-white hover:bg-accent-muted",
    secondary:
      "border border-surface-border bg-surface-elevated text-ink hover:border-accent/40 hover:bg-accent-soft/40",
    ghost: "bg-transparent text-ink-muted hover:bg-accent-soft/50 hover:text-ink",
    danger: "bg-[var(--nx-danger)] text-white hover:opacity-90 focus-visible:outline-[var(--nx-danger)]",
  };

  return <button className={`${base} ${variants[variant]} ${className}`} type="button" {...rest} />;
}
