import type { HTMLAttributes } from "react";

export function Card({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-nx border border-surface-border bg-surface-elevated p-6 shadow-nx ${className}`}
      {...rest}
    />
  );
}
