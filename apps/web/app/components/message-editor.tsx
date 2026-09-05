import { Button } from '@huddle/ui';
import { useEffect, useRef, useState } from 'react';
import { continueList, insideFence } from '../lib/composing';
import { MarkdownInput } from './markdown-input';

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
      <MarkdownInput
        value={text}
        maxHeight={240}
        label="Edit message"
        inputRef={field}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onCancel();
            return;
          }

          if (event.key !== 'Enter') return;

          const element = event.currentTarget;
          const caret = element.selectionStart;
          // Enter saves, except where it has to make a line: a message being
          // edited is as likely to hold a code block as one being written.
          const newline = event.shiftKey || insideFence(text, caret);

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

          if (!newline) {
            event.preventDefault();
            void save();
          }
        }}
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
