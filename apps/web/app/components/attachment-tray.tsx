import { cx, Icon } from '@huddle/ui';
import type { PendingUpload } from '../lib/use-uploads';
import { formatSize } from '../lib/format';

interface AttachmentTrayProps {
  pending: PendingUpload[];
  onRemove(id: string): void;
}

/**
 * What is about to be sent, while it is still going up. The thumbnail comes
 * from a local object URL rather than from the bucket, so it appears the
 * instant a file is chosen instead of after the round trip.
 */
export function AttachmentTray({ pending, onRemove }: AttachmentTrayProps) {
  if (pending.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-2 pb-2">
      {pending.map((entry) => (
        <li
          key={entry.id}
          className={cx(
            'border-border bg-surface-raised relative flex items-center gap-2 overflow-hidden rounded-lg border py-1 pr-1 pl-2',
            entry.error && 'border-critical',
          )}
        >
          {entry.preview ? (
            <img src={entry.preview} alt="" className="size-8 rounded-md object-cover" />
          ) : (
            <span className="bg-surface-sunken text-text-muted grid size-8 place-items-center rounded-md">
              <Icon name="file" className="size-4" />
            </span>
          )}

          <span className="flex min-w-0 flex-col">
            <span className="max-w-40 truncate text-xs">{entry.name}</span>
            <span className={cx('text-2xs', entry.error ? 'text-critical' : 'text-text-muted')}>
              {entry.error ?? formatSize(entry.size)}
            </span>
          </span>

          <button
            type="button"
            aria-label={`Remove ${entry.name}`}
            onClick={() => onRemove(entry.id)}
            className="text-text-muted hover:text-text-primary hover:bg-surface-hover grid size-7 shrink-0 place-items-center rounded-md"
          >
            <Icon name="close" className="size-3.5" />
          </button>

          {/*
            A bar along the bottom edge rather than a spinner: it says how much
            is left, and it disappears by filling rather than by stopping.
          */}
          {entry.attachment === null && entry.error === null ? (
            <span
              aria-hidden
              className="bg-accent absolute bottom-0 left-0 h-0.5 transition-[width] duration-(--duration-quick)"
              style={{ width: `${Math.round(entry.progress * 100)}%` }}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
