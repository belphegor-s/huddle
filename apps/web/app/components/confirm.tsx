import { Button } from '@huddle/ui';
import { useCallback, useState, type ReactNode } from 'react';
import { Dialog } from './dialog';

export interface ConfirmRequest {
  title: string;
  /** What will happen, in the words somebody needs before agreeing to it. */
  body: ReactNode;
  /** The verb, not "OK". Somebody skimming should still know what they pressed. */
  action: string;
  run(): void | Promise<void>;
}

/**
 * Asks before anything destructive.
 *
 * The confirming button is the danger variant and the cancel is the plain one,
 * so the safe choice is the one the eye lands on and the one the keyboard
 * reaches first. Nothing here has an "are you sure" in it: the title says what
 * will happen and the button says what it will do.
 */
export function useConfirm(): {
  confirm(request: ConfirmRequest): void;
  dialog: ReactNode;
} {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = useCallback((next: ConfirmRequest) => {
    setRequest(next);
  }, []);

  const close = useCallback(() => {
    setRequest(null);
    setBusy(false);
  }, []);

  const dialog =
    request === null ? null : (
      <Dialog title={request.title} onClose={close}>
        <div className="text-text-secondary text-sm">{request.body}</div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            autoFocus={false}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void (async () => {
                try {
                  await request.run();
                } finally {
                  close();
                }
              })();
            }}
          >
            {busy ? 'Working' : request.action}
          </Button>
        </div>
      </Dialog>
    );

  return { confirm, dialog };
}
