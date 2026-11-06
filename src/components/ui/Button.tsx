import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

export function Button({ variant = "primary", className = "", ...rest }: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";

  const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
    primary:
      "bg-accent text-zinc-950 hover:bg-emerald-400 focus-visible:outline-accent",
    secondary:
      "border border-zinc-700 bg-surface-elevated text-zinc-100 hover:border-zinc-500",
    ghost: "bg-transparent text-zinc-200 hover:bg-zinc-800",
    danger: "bg-red-600 text-white hover:bg-red-500 focus-visible:outline-red-400",
  };

  return <button className={`${base} ${variants[variant]} ${className}`} type="button" {...rest} />;
}
