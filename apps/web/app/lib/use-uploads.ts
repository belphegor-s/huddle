import type { Attachment } from '@huddle/core';
import { useCallback, useRef, useState } from 'react';
import { upload, UploadError, UPLOAD_MESSAGES } from './uploads';

export interface PendingUpload {
  id: string;
  name: string;
  size: number;
  /** A local object URL while it uploads, so the thumbnail is instant. */
  preview: string | null;
  progress: number;
  attachment: Attachment | null;
  error: string | null;
}

export interface UploadTray {
  pending: PendingUpload[];
  /** Only the ones that finished. What a message can actually carry. */
  ready: Attachment[];
  busy: boolean;
  add(files: Iterable<File>, extra?: { durationMs?: number; peaks?: number[] }): Promise<void>;
  remove(id: string): void;
  clear(): void;
}

/**
 * Uploads start the moment a file is chosen, not when the message is sent, so
 * by the time someone finishes typing the bytes are usually already there.
 * Each file succeeds or fails on its own: one refused file does not throw away
 * the other four.
 */
export function useUploads(workspaceId: string): UploadTray {
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const controllers = useRef(new Map<string, AbortController>());

  const patch = useCallback((id: string, change: Partial<PendingUpload>) => {
    setPending((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...change } : entry)),
    );
  }, []);

  const add = useCallback<UploadTray['add']>(
    async (files, extra) => {
      const started = [...files].map((file) => ({
        file,
        entry: {
          id: `${Date.now()}-${file.name}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          size: file.size,
          preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
          progress: 0,
          attachment: null,
          error: null,
        } satisfies PendingUpload,
      }));

      if (started.length === 0) return;
      setPending((current) => [...current, ...started.map(({ entry }) => entry)]);

      await Promise.all(
        started.map(async ({ file, entry }) => {
          const controller = new AbortController();
          controllers.current.set(entry.id, controller);

          try {
            const attachment = await upload(workspaceId, file, {
              signal: controller.signal,
              durationMs: extra?.durationMs ?? null,
              peaks: extra?.peaks ?? null,
              onProgress: (fraction) => patch(entry.id, { progress: fraction }),
            });
            patch(entry.id, { attachment, progress: 1 });
          } catch (error) {
            const kind = error instanceof UploadError ? error.kind : 'refused';
            patch(entry.id, { error: UPLOAD_MESSAGES[kind] });
          } finally {
            controllers.current.delete(entry.id);
          }
        }),
      );
    },
    [patch, workspaceId],
  );

  const remove = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);

    setPending((current) => {
      const going = current.find((entry) => entry.id === id);
      if (going?.preview) URL.revokeObjectURL(going.preview);
      return current.filter((entry) => entry.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    for (const controller of controllers.current.values()) controller.abort();
    controllers.current.clear();

    setPending((current) => {
      for (const entry of current) {
        if (entry.preview) URL.revokeObjectURL(entry.preview);
      }
      return [];
    });
  }, []);

  return {
    pending,
    ready: pending.flatMap((entry) => (entry.attachment ? [entry.attachment] : [])),
    // A send has to wait for the bytes, but not for a file that already failed.
    busy: pending.some((entry) => entry.attachment === null && entry.error === null),
    add,
    remove,
    clear,
  };
}
