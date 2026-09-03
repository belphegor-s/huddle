import { Button } from '@huddle/ui';
import { useEffect, useRef, useState } from 'react';

interface MessageEditorProps {
  initial: string;
  onSave(text: string): Promise<void>;
  onCancel(): void;
}

/**
 * Editing happens in place rather than in a dialog, so the message stays where
 * it was in the conversation and the surrounding context is still readable.
 */
export function MessageEditor({ initial, onSave, onCancel }: MessageEditorProps) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const element = field.current;
    if (!element) return;

    element.focus();
    // The caret goes to the end, not the start: an edit is usually an addition
    // or a fix at the end, never a rewrite from the first character.
    element.setSelectionRange(element.value.length, element.value.length);
    element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
  }, []);

  async function save() {
    const next = text.trim();
    if (next === '' || next === initial.trim()) {
      onCancel();
      return;
    }

    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-1 flex flex-col gap-2">
      <textarea
        ref={field}
        value={text}
        aria-label="Edit message"
        onChange={(event) => {
          setText(event.target.value);
          event.target.style.height = 'auto';
          event.target.style.height = `${Math.min(event.target.scrollHeight, 240)}px`;
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void save();
          }
        }}
        className="border-border bg-surface-sunken leading-message max-h-60 w-full resize-none overflow-y-auto rounded-lg border px-3 py-2 text-base"
      />

      <div className="flex items-center gap-2">
        <Button type="button" onClick={() => void save()} disabled={saving}>
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <span className="text-text-muted text-xs">Escape to cancel, Enter to save</span>
      </div>
    </div>
  );
}
