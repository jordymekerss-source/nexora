import type { TextareaHTMLAttributes } from "react";

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string;
};

export function Textarea({ id, label, hint, className = "", ...rest }: TextareaProps) {
  const inputId = id ?? rest.name;

  return (
    <label className="block space-y-1" htmlFor={inputId}>
      <span className="text-sm font-medium text-zinc-200">{label}</span>
      <textarea
        id={inputId}
        className={`min-h-[96px] w-full rounded-md border border-zinc-700 bg-surface-elevated px-3 py-2 text-sm text-zinc-100 shadow-sm outline-none transition placeholder:text-zinc-500 focus:border-accent focus:ring-1 focus:ring-accent ${className}`}
        {...rest}
      />
      {hint !== undefined && hint.length > 0 ? (
        <span className="text-xs text-zinc-500">{hint}</span>
      ) : null}
    </label>
  );
}
