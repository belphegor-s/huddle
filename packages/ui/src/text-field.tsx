import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx.js';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  /** Rendered flush against the input, for things like a workspace domain. */
  suffix?: string;
}

export function TextField({ label, hint, error, suffix, className, id, ...props }: TextFieldProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const messageId = `${inputId}-message`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>

      <div
        className={cx(
          'bg-surface-raised flex items-center rounded-lg border transition-colors',
          'focus-within:border-accent',
          error ? 'border-critical' : 'border-border-strong',
        )}
      >
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? messageId : undefined}
          // The ring lives on the wrapper, so the input itself must not draw one.
          className={cx(
            'placeholder:text-text-muted min-h-11 w-full bg-transparent px-3 outline-none',
            className,
          )}
          {...props}
        />
        {suffix ? <span className="text-text-muted pr-3 text-sm">{suffix}</span> : null}
      </div>

      {error ? (
        <p id={messageId} className="text-critical text-sm">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="text-text-secondary text-sm">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
