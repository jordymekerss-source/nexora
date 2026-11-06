"use client";

type Props = {
  label?: string;
  className?: string;
};

export function PrintButton({
  label = "Afdrukken / PDF",
  className = "inline-flex items-center justify-center rounded-md border border-zinc-700 bg-surface-elevated px-3 py-2 text-sm font-medium text-zinc-100 hover:border-zinc-500",
}: Props) {
  return (
    <button type="button" className={className} onClick={() => window.print()}>
      {label}
    </button>
  );
}
