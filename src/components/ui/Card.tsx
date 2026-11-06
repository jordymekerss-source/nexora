import type { HTMLAttributes } from "react";

export function Card({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-lg border border-zinc-800 bg-surface-elevated/80 p-6 shadow-sm backdrop-blur ${className}`}
      {...rest}
    />
  );
}
