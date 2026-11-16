import type { SelectHTMLAttributes } from "react";

type Option = { value: string; label: string };

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  options: readonly Option[];
  hint?: string;
};

export function Select({ id, label, options, hint, className = "", ...rest }: SelectProps) {
  const selectId = id ?? rest.name;

  return (
    <label className="block space-y-1" htmlFor={selectId}>
      <span className="text-sm font-medium text-ink">{label}</span>
      <select
        id={selectId}
        className={`w-full rounded-md border border-surface-border bg-surface-elevated px-3 py-2 text-sm text-ink shadow-sm outline-none transition focus:border-accent focus:ring-1 focus:ring-accent ${className}`}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint !== undefined && hint.length > 0 ? (
        <span className="text-xs text-ink-muted">{hint}</span>
      ) : null}
    </label>
  );
}
