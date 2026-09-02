import type { Attachment } from '@huddle/core';
import { VoiceNote } from './voice-note';

export function Attachments({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) return null;

  return (
    <ul className="mt-2 flex flex-col gap-2">
      {attachments.map((attachment) => (
        <li key={attachment.id} className="max-w-md">
          {render(attachment)}
        </li>
      ))}
    </ul>
  );
}

function render(attachment: Attachment) {
  if (attachment.kind === 'image') {
    return (
      <a href={attachment.url} target="_blank" rel="noreferrer">
        <img
          src={attachment.url}
          alt={attachment.name}
          width={attachment.width ?? undefined}
          height={attachment.height ?? undefined}
          loading="lazy"
          // The intrinsic size comes from the upload, so the list does not
          // reflow when an image finishes loading.
          className="border-border max-h-80 w-auto rounded-lg border object-cover"
        />
      </a>
    );
  }

  if (attachment.kind === 'audio') return <VoiceNote attachment={attachment} />;

  if (attachment.kind === 'video') {
    return (
      <video
        src={attachment.url}
        controls
        preload="metadata"
        className="border-border max-h-80 rounded-lg border"
      />
    );
  }

  return (
    <a
      href={attachment.url}
      className="border-border bg-surface-raised flex min-h-11 items-center gap-3 rounded-lg border px-3 text-sm no-underline"
    >
      <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
      <span className="text-text-muted text-xs">{formatSize(attachment.size)}</span>
    </a>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
