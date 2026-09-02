import type { Attachment, MemberProfile } from '@huddle/core';
import { Button, cx } from '@huddle/ui';
import { useRef, useState } from 'react';
import { VoiceRecorder, type Recording } from '../lib/recorder';
import { findMentions } from '../lib/rich-text';
import { upload } from '../lib/uploads';

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
  const recorder = useRef<VoiceRecorder | null>(null);

  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function send() {
    const body = text.trim();
    if (body === '' && attachments.length === 0) return;

    setBusy(true);
    setProblem(null);

    try {
      await onSend({ text: body, mentions: findMentions(body, members), attachments });
      setText('');
      setAttachments([]);
      resize();
    } catch {
      setProblem('That did not send. Check your connection and try again.');
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }

  function resize() {
    const element = input.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }

  async function attach(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);

    try {
      const added = await Promise.all([...files].map((file) => upload(workspaceId, file)));
      setAttachments((current) => [...current, ...added]);
    } catch {
      setProblem('That file could not be uploaded.');
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = '';
    }
  }

  async function startRecording() {
    try {
      recorder.current = new VoiceRecorder();
      await recorder.current.start();
      setRecording(true);
    } catch {
      setProblem('Microphone access was refused.');
    }
  }

  async function finishRecording() {
    const active = recorder.current;
    recorder.current = null;
    setRecording(false);
    if (!active) return;

    const result: Recording | null = await active.stop();
    if (!result) return;

    setBusy(true);
    try {
      const attachment = await upload(workspaceId, result.file, {
        durationMs: result.durationMs,
        peaks: result.peaks,
      });
      await onSend({ text: '', mentions: [], attachments: [attachment] });
    } catch {
      setProblem('The voice note could not be sent.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-border bg-surface border-t px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:px-5">
      {problem ? (
        <p role="alert" className="text-text-secondary pb-2 text-xs">
          {problem}
        </p>
      ) : null}

      {attachments.length > 0 ? (
        <ul className="flex flex-wrap gap-2 pb-2">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="border-border bg-surface-raised flex items-center gap-2 rounded-lg border px-2 py-1 text-xs"
            >
              <span className="max-w-40 truncate">{attachment.name}</span>
              <button
                type="button"
                aria-label={`Remove ${attachment.name}`}
                onClick={() =>
                  setAttachments((current) => current.filter((other) => other.id !== attachment.id))
                }
                className="text-text-muted hover:text-text-primary"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-end gap-2">
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(event) => void attach(event.target.files)}
        />

        <IconButton label="Attach a file" onClick={() => picker.current?.click()}>
          +
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
          onKeyDown={(event) => {
            // Enter sends, Shift and Enter makes a line. On a touch keyboard
            // Enter is a newline, because there is a send button right there.
            if (event.key === 'Enter' && !event.shiftKey && !isTouch()) {
              event.preventDefault();
              void send();
            }
          }}
          className="border-border bg-surface-sunken leading-message max-h-50 min-h-11 flex-1 resize-none rounded-xl border px-3 py-2.5 text-base"
        />

        {text.trim() === '' && attachments.length === 0 ? (
          <IconButton
            label={recording ? 'Stop recording' : 'Record a voice note'}
            onClick={() => void (recording ? finishRecording() : startRecording())}
            className={cx(recording && 'bg-accent text-on-accent')}
          >
            {recording ? '■' : '🎙'}
          </IconButton>
        ) : (
          <Button type="button" onClick={() => void send()} disabled={busy}>
            Send
          </Button>
        )}
      </div>
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
        'border-border bg-surface-raised hover:bg-surface-hover grid size-11 shrink-0 place-items-center rounded-xl border text-base',
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
