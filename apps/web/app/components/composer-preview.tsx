import type { LinkPreview } from '@huddle/core';
import { Icon } from '@huddle/ui';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/** The same rule the renderer uses, so what is shown is what will be sent. */
const URL_PATTERN = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]/g;
const SETTLE_MS = 500;

/**
 * Shows the card a link will produce, before the message is sent.
 *
 * It reads the same endpoint the message will, so the result is already cached
 * by the time anyone presses send, and a link that turns out to have no preview
 * says nothing here rather than promising one.
 */
export function ComposerPreview({ workspaceId, text }: { workspaceId: string; text: string }) {
  const [preview, setPreview] = useState<LinkPreview | null>(null);

  useEffect(() => {
    const link = text.match(URL_PATTERN)?.[0];
    if (link === undefined) {
      setPreview(null);
      return;
    }

    let cancelled = false;

    // Debounced, so a link is not fetched again on every keystroke that
    // follows it.
    const timer = setTimeout(() => {
      void api
        .unfurl(workspaceId, link)
        .then((found) => {
          if (!cancelled) setPreview(found);
        })
        .catch(() => {
          if (!cancelled) setPreview(null);
        });
    }, SETTLE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text, workspaceId]);

  if (!preview) return null;

  return (
    <div className="border-border bg-surface-raised mb-2 flex max-w-md items-start gap-3 overflow-hidden rounded-lg border">
      <span aria-hidden className="bg-accent/60 w-1 shrink-0 self-stretch" />

      <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-2">
        <span className="text-text-muted text-2xs flex items-center gap-1">
          <Icon name="link" className="size-3" />
          {preview.siteName}
        </span>
        <span className="text-text-primary line-clamp-1 text-sm font-semibold">
          {preview.title}
        </span>
      </span>

      {preview.imageUrl ? (
        <img
          src={preview.imageUrl}
          alt=""
          className="border-border my-2 mr-2 size-11 shrink-0 rounded-md border object-cover"
        />
      ) : null}
    </div>
  );
}
