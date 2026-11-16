import type { InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
};

export function Input({ id, label, hint, className = "", ...rest }: InputProps) {
  const inputId = id ?? rest.name;

  return (
    <label className="block space-y-1" htmlFor={inputId}>
      <span className="text-sm font-medium text-ink">{label}</span>
      <input
        id={inputId}
        className={`w-full rounded-md border border-surface-border bg-surface-elevated px-3 py-2 text-sm text-ink shadow-sm outline-none transition placeholder:text-ink0 focus:border-accent focus:ring-1 focus:ring-accent ${className}`}
        {...rest}
      />
      {hint !== undefined && hint.length > 0 ? (
        <span className="text-xs text-ink0">{hint}</span>
      ) : null}
    </label>
  );
}
