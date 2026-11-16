import type { TextareaHTMLAttributes } from "react";

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string;
};

export function Textarea({ id, label, hint, className = "", ...rest }: TextareaProps) {
  const inputId = id ?? rest.name;

  return (
    <label className="block space-y-1" htmlFor={inputId}>
      <span className="text-sm font-medium text-ink">{label}</span>
      <textarea
        id={inputId}
        className={`min-h-[96px] w-full rounded-md border border-surface-border bg-surface-elevated px-3 py-2 text-sm text-ink shadow-sm outline-none transition placeholder:text-ink-muted focus:border-accent focus:ring-1 focus:ring-accent ${className}`}
        {...rest}
      />
      {hint !== undefined && hint.length > 0 ? (
        <span className="text-xs text-ink-muted">{hint}</span>
      ) : null}
    </label>
  );
}
