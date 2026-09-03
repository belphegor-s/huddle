import { Icon } from '@huddle/ui';
import { useEffect, useState } from 'react';
import { ApiError } from '../lib/api';

interface AssistantPanelProps {
  title: string;
  run(): Promise<{ text: string }>;
  onClose(): void;
}

const FALLBACK = 'The model did not answer. Try again in a moment.';

const PROBLEMS: Record<string, string> = {
  unavailable: FALLBACK,
  rate_limited: 'That is a lot of summaries. Try again shortly.',
  nothing_to_read: 'There is nothing here to summarise yet.',
};

/**
 * Reads as a note about the conversation rather than as a message in it: it is
 * dashed, unsendable and dismissible, because a summary that looked like a
 * message would eventually be quoted as if someone had said it.
 */
export function AssistantPanel({ title, run, onClose }: AssistantPanelProps) {
  const [text, setText] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void run()
      .then((answer) => {
        if (!cancelled) setText(answer.text);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const code = error instanceof ApiError ? error.code : 'unavailable';
        setProblem(PROBLEMS[code] ?? FALLBACK);
      });

    return () => {
      cancelled = true;
    };
    // Runs once per open. `run` closes over the ids it needs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="border-accent/40 bg-accent-soft/40 mx-3 mb-2 flex flex-col gap-2 rounded-xl border border-dashed p-3 md:mx-5">
      <header className="flex items-center gap-2">
        <Icon name="sparkle" className="text-accent size-4" />
        <h2 className="flex-1 text-sm font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="text-text-muted hover:text-text-primary grid size-7 place-items-center rounded-md"
        >
          <Icon name="close" className="size-3.5" />
        </button>
      </header>

      {problem ? (
        <p className="text-text-secondary text-sm">{problem}</p>
      ) : text === null ? (
        <p className="text-text-muted animate-pulse text-sm">Reading the conversation</p>
      ) : (
        <div className="leading-message flex flex-col gap-1 text-sm">
          {text.split('\n').map((line, index) => (
            <p key={index}>{line}</p>
          ))}
        </div>
      )}

      <p className="text-text-muted text-2xs">
        Written by the model this instance is configured with. It read these messages to do it.
      </p>
    </section>
  );
}
