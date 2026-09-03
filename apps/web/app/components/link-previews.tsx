import type { LinkPreview } from '@huddle/core';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useWorkspace } from '../lib/workspace';

/** Bare http and https URLs, stopped before trailing sentence punctuation. */
const URL_PATTERN = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]/g;

/** One card. Five links in a message should not turn into five cards. */
const PREVIEW_LIMIT = 1;

export function LinkPreviews({ text }: { text: string }) {
  const { workspace } = useWorkspace();
  const [previews, setPreviews] = useState<LinkPreview[]>([]);

  useEffect(() => {
    const links = [...new Set(text.match(URL_PATTERN) ?? [])].slice(0, PREVIEW_LIMIT);
    if (links.length === 0) {
      setPreviews([]);
      return;
    }

    let cancelled = false;

    void Promise.all(links.map((link) => api.unfurl(workspace.id, link).catch(() => null))).then(
      (found) => {
        if (cancelled) return;
        setPreviews(found.filter((preview): preview is LinkPreview => preview !== null));
      },
    );

    return () => {
      cancelled = true;
    };
  }, [text, workspace.id]);

  if (previews.length === 0) return null;

  return (
    <ul className="mt-2 flex flex-col gap-2">
      {previews.map((preview) => (
        <li key={preview.url}>
          <a
            href={preview.url}
            target="_blank"
            rel="noreferrer noopener"
            className="border-border bg-surface-raised hover:bg-surface-hover flex max-w-md overflow-hidden rounded-lg border no-underline transition-colors"
          >
            {/* The accent edge is what makes a card read as quoted rather than as chrome. */}
            <span aria-hidden className="bg-border-strong w-1 shrink-0" />

            <span className="flex min-w-0 flex-1 gap-3 p-3">
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-text-muted text-2xs truncate">{preview.siteName}</span>
                <span className="text-text-primary line-clamp-2 text-sm font-semibold">
                  {preview.title}
                </span>
                {preview.description ? (
                  <span className="text-text-secondary line-clamp-2 text-xs">
                    {preview.description}
                  </span>
                ) : null}
              </span>

              {preview.imageUrl ? (
                <img
                  // Served from this deployment. The original host is never
                  // contacted by the browser.
                  src={preview.imageUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="border-border size-16 shrink-0 rounded-md border object-cover"
                />
              ) : null}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
