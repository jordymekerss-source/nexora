"use client";

type Props = {
  label?: string;
  className?: string;
};

export function PrintButton({
  label = "Afdrukken / PDF",
  className = "inline-flex items-center justify-center rounded-md border border-surface-border bg-surface-elevated px-3 py-2 text-sm font-medium text-ink hover:border-zinc-500",
}: Props) {
  return (
    <button type="button" className={className} onClick={() => window.print()}>
      {label}
    </button>
  );
}
