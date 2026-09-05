import type { Attachment, MemberProfile } from '@huddle/core';
import { Button, cx, Icon } from '@huddle/ui';
import { useRef, useState } from 'react';
import { continueList, insideFence } from '../lib/composing';
import { formatDuration } from '../lib/format';
import { VoiceRecorder } from '../lib/recorder';
import { findMentions } from '../lib/rich-text';
import { useMentions } from '../lib/use-mentions';
import { useUploads } from '../lib/use-uploads';
import { AttachmentMenu } from './attachment-menu';
import { MarkdownInput } from './markdown-input';
import { AttachmentTray } from './attachment-tray';
import { ComposerPreview } from './composer-preview';
import { MentionPicker } from './mention-picker';

/** The marks worth a shortcut. The rest are quicker to type than to reach for. */
const SHORTCUTS: Record<string, { before: string; after: string }> = {
  b: { before: '**', after: '**' },
  i: { before: '_', after: '_' },
  e: { before: '`', after: '`' },
};

/** Shift makes the block form of the same mark. */
const BLOCK_SHORTCUTS: Record<string, { before: string; after: string }> = {
  e: { before: '```\n', after: '\n```' },
  x: { before: '~~', after: '~~' },
};

/** Roughly eight lines, after which the field scrolls instead of growing. */
const MAX_COMPOSER_PX = 200;

interface ComposerProps {
  workspaceId: string;
  members: MemberProfile[];
  placeholder: string;
  /** False when the deployment has no bucket. Attaching would only fail. */
  canAttach: boolean;
  onSend(input: { text: string; mentions: string[]; attachments: Attachment[] }): Promise<void>;
  onTyping(): void;
}

export function Composer({
  workspaceId,
  members,
  placeholder,
  canAttach,
  onSend,
  onTyping,
}: ComposerProps) {
  const input = useRef<HTMLTextAreaElement>(null);
  const uploads = useUploads(workspaceId);
  const mentions = useMentions(members);

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const hasText = text.trim() !== '';
  // Anything in the tray counts, including a file still going up and one that
  // failed. Swapping the send button away mid upload leaves someone holding an
  // attachment with no way to send it and no way to tell what went wrong.
  const composing = hasText || uploads.pending.length > 0;
  const sendable = hasText || uploads.ready.length > 0;

  /**
   * Wraps the selection, or opens an empty pair and puts the caret inside it,
   * which is what every editor does and what fingers already expect.
   */
  function applyWrap({ before, after }: { before: string; after: string }) {
    const element = input.current;
    if (!element) return;

    const from = element.selectionStart;
    const to = element.selectionEnd;
    const selected = text.slice(from, to);

    setText(`${text.slice(0, from)}${before}${selected}${after}${text.slice(to)}`);

    requestAnimationFrame(() => {
      element.focus();
      const caret = from + before.length + selected.length;
      element.setSelectionRange(caret, caret);
    });
  }

  async function send() {
    const body = text.trim();
    if (!sendable || uploads.busy) return;

    setSending(true);
    setProblem(null);

    try {
      await onSend({
        text: body,
        mentions: findMentions(body, members),
        attachments: uploads.ready,
      });
      setText('');
      mentions.close();
      uploads.clear();
    } catch {
      setProblem('That did not send. Check your connection and try again.');
    } finally {
      setSending(false);
      input.current?.focus();
    }
  }

  return (
    <div
      onDragOver={(event) => {
        // Only a file drag. Dragging selected text around should not arm this.
        if (!canAttach || !event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={(event) => {
        if (!canAttach || !event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDragging(false);
        void uploads.add(event.dataTransfer.files);
      }}
      className={cx(
        'border-border bg-surface relative border-t px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:px-5',
        dragging && 'bg-accent-soft',
      )}
    >
      {dragging ? (
        <div className="border-accent text-accent pointer-events-none absolute inset-2 grid place-items-center rounded-xl border-2 border-dashed text-sm font-medium">
          Drop to attach
        </div>
      ) : null}

      {problem ? (
        <p role="alert" className="text-critical pb-2 text-xs">
          {problem}
        </p>
      ) : null}

      {mentions.open ? (
        <MentionPicker
          matches={mentions.matches}
          active={mentions.active}
          onPick={(member) => {
            const chosen = mentions.choose(text, member);
            if (!chosen) return;
            setText(chosen.value);
            requestAnimationFrame(() => {
              input.current?.focus();
              input.current?.setSelectionRange(chosen.caret, chosen.caret);
            });
          }}
        />
      ) : null}

      <ComposerPreview workspaceId={workspaceId} text={text} />

      <AttachmentTray pending={uploads.pending} onRemove={uploads.remove} />

      <div className="flex items-end gap-2">
        {canAttach ? <AttachmentMenu onFiles={(files) => void uploads.add(files)} /> : null}

        <MarkdownInput
          inputRef={input}
          value={text}
          placeholder={placeholder}
          maxHeight={MAX_COMPOSER_PX}
          onChange={(event) => {
            setText(event.target.value);
            mentions.update(event.target.value, event.target.selectionStart);
            onTyping();
          }}
          onBlur={mentions.close}
          onSelect={(event) => {
            // Moving the caret out of a token closes the picker, which typing
            // alone would not catch.
            const field = event.currentTarget;
            mentions.update(field.value, field.selectionStart);
          }}
          onPaste={(event) => {
            // A screenshot on the clipboard is the most common attachment
            // there is, and going through a file dialog for it is absurd.
            if (!canAttach) return;
            const files = [...event.clipboardData.files];
            if (files.length === 0) return;
            event.preventDefault();
            void uploads.add(files);
          }}
          onKeyDown={(event) => {
            if (event.metaKey || event.ctrlKey) {
              const key = event.key.toLowerCase();
              const wrap = event.shiftKey ? BLOCK_SHORTCUTS[key] : SHORTCUTS[key];
              if (wrap) {
                event.preventDefault();
                applyWrap(wrap);
                return;
              }
            }

            // While the picker is open the arrow keys and Enter belong to it.
            if (mentions.open) {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                mentions.move(event.key === 'ArrowDown' ? 1 : -1);
                return;
              }

              if (event.key === 'Enter' || event.key === 'Tab') {
                const chosen = mentions.choose(text);
                if (chosen) {
                  event.preventDefault();
                  setText(chosen.value);
                  requestAnimationFrame(() => {
                    input.current?.setSelectionRange(chosen.caret, chosen.caret);
                  });
                  return;
                }
              }

              if (event.key === 'Escape') {
                event.preventDefault();
                mentions.close();
                return;
              }
            }

            if (event.key === 'Enter') {
              const element = event.currentTarget;
              const caret = element.selectionStart;

              // Inside an open fence Enter is always a newline. Someone
              // halfway through pasting a stack trace has an unterminated
              // block by definition, and sending on the first line would cut
              // the message in half.
              const newline = event.shiftKey || isTouch() || insideFence(text, caret);

              if (newline && caret === element.selectionEnd) {
                const carried = continueList(text, caret);
                if (carried) {
                  event.preventDefault();
                  setText(carried.value);
                  requestAnimationFrame(() => {
                    element.setSelectionRange(carried.caret, carried.caret);
                  });
                  return;
                }
              }

              // Enter sends, Shift and Enter makes a line. On a touch keyboard
              // Enter is a newline, because there is a send button right there.
              if (!newline) {
                event.preventDefault();
                void send();
              }
            }
          }}
        />

        {composing ? (
          <Button
            type="button"
            onClick={() => void send()}
            disabled={uploads.busy || sending || !sendable}
            aria-label="Send"
            title={uploads.busy ? 'Waiting for the attachments to finish' : 'Send'}
            className="size-11 px-0"
          >
            <Icon name="send" />
          </Button>
        ) : canAttach ? (
          <VoiceButton
            onRecorded={async (file, meta) => {
              await uploads.add([file], meta);
            }}
            onProblem={setProblem}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Hold to record is a phone gesture and a mouse cannot do it comfortably, so
 * this is press to start and press to stop, with the elapsed time visible and
 * a way out that is not sending.
 */
function VoiceButton({
  onRecorded,
  onProblem,
}: {
  onRecorded(file: File, meta: { durationMs: number; peaks: number[] }): Promise<void>;
  onProblem(message: string): void;
}) {
  const recorder = useRef<VoiceRecorder | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  function stopTicking() {
    if (ticker.current !== null) clearInterval(ticker.current);
    ticker.current = null;
    setElapsed(null);
  }

  async function start() {
    try {
      const active = new VoiceRecorder();
      await active.start();
      recorder.current = active;

      const startedAt = Date.now();
      setElapsed(0);
      ticker.current = setInterval(() => setElapsed(Date.now() - startedAt), 200);
    } catch {
      onProblem('Microphone access was refused.');
      stopTicking();
    }
  }

  async function finish() {
    const active = recorder.current;
    recorder.current = null;
    stopTicking();
    if (!active) return;

    const result = await active.stop();
    if (!result) return;

    await onRecorded(result.file, { durationMs: result.durationMs, peaks: result.peaks });
  }

  function cancel() {
    recorder.current?.cancel();
    recorder.current = null;
    stopTicking();
  }

  if (elapsed === null) {
    return (
      <IconButton label="Record a voice note" onClick={() => void start()}>
        <Icon name="mic" />
      </IconButton>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <IconButton label="Discard recording" onClick={cancel}>
        <Icon name="trash" />
      </IconButton>

      <span
        aria-live="polite"
        className="text-critical flex min-h-11 items-center gap-2 font-mono text-sm"
      >
        <span aria-hidden className="bg-critical size-2 animate-pulse rounded-full" />
        {formatDuration(elapsed)}
      </span>

      <IconButton label="Stop and attach" tone="accent" onClick={() => void finish()}>
        <Icon name="stop" />
      </IconButton>
    </div>
  );
}

/**
 * The tone is a choice, not a layer. Passing `bg-accent` in on top of the base
 * classes left two backgrounds in the list, and which one won came down to the
 * order Tailwind happened to emit them in: the stop control ended up a white
 * glyph on the near white surface, invisible, so a recording could not be
 * stopped.
 */
function IconButton({
  label,
  onClick,
  tone = 'default',
  children,
}: {
  label: string;
  onClick(): void;
  tone?: 'default' | 'accent';
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cx(
        'grid size-11 shrink-0 place-items-center rounded-xl border transition-colors',
        tone === 'accent'
          ? 'bg-accent text-on-accent border-accent hover:brightness-110'
          : 'border-border bg-surface-raised hover:bg-surface-hover',
      )}
    >
      {children}
    </button>
  );
}

function isTouch(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}
