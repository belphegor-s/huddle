import type { Attachment, MemberProfile } from '@huddle/core';
import { Button, cx, Icon } from '@huddle/ui';
import { useRef, useState } from 'react';
import { formatDuration } from '../lib/format';
import { VoiceRecorder } from '../lib/recorder';
import { findMentions } from '../lib/rich-text';
import { useUploads } from '../lib/use-uploads';
import { AttachmentTray } from './attachment-tray';

interface ComposerProps {
  workspaceId: string;
  members: MemberProfile[];
  placeholder: string;
  onSend(input: { text: string; mentions: string[]; attachments: Attachment[] }): Promise<void>;
  onTyping(): void;
}

export function Composer({ workspaceId, members, placeholder, onSend, onTyping }: ComposerProps) {
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const uploads = useUploads(workspaceId);

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const empty = text.trim() === '' && uploads.ready.length === 0;

  async function send() {
    const body = text.trim();
    if (empty || uploads.busy) return;

    setSending(true);
    setProblem(null);

    try {
      await onSend({
        text: body,
        mentions: findMentions(body, members),
        attachments: uploads.ready,
      });
      setText('');
      uploads.clear();
      resize();
    } catch {
      setProblem('That did not send. Check your connection and try again.');
    } finally {
      setSending(false);
      input.current?.focus();
    }
  }

  function resize() {
    const element = input.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }

  return (
    <div
      onDragOver={(event) => {
        // Only a file drag. Dragging selected text around should not arm this.
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
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

      <AttachmentTray pending={uploads.pending} onRemove={uploads.remove} />

      <div className="flex items-end gap-2">
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) void uploads.add(event.target.files);
            event.target.value = '';
          }}
        />

        <IconButton label="Attach a file" onClick={() => picker.current?.click()}>
          <Icon name="attach" />
        </IconButton>

        <textarea
          ref={input}
          value={text}
          rows={1}
          placeholder={placeholder}
          aria-label="Message"
          onChange={(event) => {
            setText(event.target.value);
            onTyping();
            resize();
          }}
          onPaste={(event) => {
            // A screenshot on the clipboard is the most common attachment
            // there is, and going through a file dialog for it is absurd.
            const files = [...event.clipboardData.files];
            if (files.length === 0) return;
            event.preventDefault();
            void uploads.add(files);
          }}
          onKeyDown={(event) => {
            // Enter sends, Shift and Enter makes a line. On a touch keyboard
            // Enter is a newline, because there is a send button right there.
            if (event.key === 'Enter' && !event.shiftKey && !isTouch()) {
              event.preventDefault();
              void send();
            }
          }}
          className="border-border bg-surface-sunken leading-message max-h-50 min-h-11 flex-1 resize-none overflow-y-auto rounded-xl border px-3 py-2.5 text-base"
        />

        {empty ? (
          <VoiceButton
            onRecorded={async (file, meta) => {
              await uploads.add([file], meta);
            }}
            onProblem={setProblem}
          />
        ) : (
          <Button
            type="button"
            onClick={() => void send()}
            disabled={sending || uploads.busy}
            aria-label={uploads.busy ? 'Waiting for attachments' : 'Send'}
            className="size-11 px-0"
          >
            <Icon name="send" />
          </Button>
        )}
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

      <IconButton
        label="Stop and attach"
        onClick={() => void finish()}
        className="bg-accent text-on-accent border-accent"
      >
        <Icon name="stop" />
      </IconButton>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick(): void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cx(
        'border-border bg-surface-raised hover:bg-surface-hover grid size-11 shrink-0 place-items-center rounded-xl border transition-colors',
        className,
      )}
    >
      {children}
    </button>
  );
}

function isTouch(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}
