import { useId, type ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Props = ComponentProps<"input"> & {
  label: string;
  // Shown under the field in red; also marks the field invalid for screen readers
  error?: string;
  hint?: string;
};

export function Input({ label, error, hint, className, id, ...props }: Props) {
  const generated = useId();
  const inputId = id ?? generated;
  const noteId = `${inputId}-note`;
  const note = error ?? hint;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-text">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? noteId : undefined}
        className={cn(
          "h-12 border bg-white/5 px-4 text-base text-text transition-colors",
          "focus:border-live focus:outline-none",
          error ? "border-bad" : "border-line",
          className,
        )}
        {...props}
      />
      {note && (
        <p id={noteId} className={cn("text-sm", error ? "text-bad" : "text-muted")}>
          {note}
        </p>
      )}
    </div>
  );
}
