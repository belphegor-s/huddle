import { LIMITS, type Attachment } from '@huddle/core';
import { api } from './api';

export type UploadFailure = 'too_large' | 'rate_limited' | 'refused' | 'network';

export class UploadError extends Error {
  readonly kind: UploadFailure;

  constructor(kind: UploadFailure) {
    super(kind);
    this.kind = kind;
  }
}

export interface UploadOptions {
  onProgress?(fraction: number): void;
  signal?: AbortSignal;
  durationMs?: number | null;
  peaks?: number[] | null;
}

/**
 * Two steps on purpose: the server records the file and signs a URL, then the
 * bytes go straight to the bucket. Nothing large passes through the app.
 */
export async function upload(
  workspaceId: string,
  file: File,
  options: UploadOptions = {},
): Promise<Attachment> {
  if (file.size > LIMITS.fileBytesMax) throw new UploadError('too_large');

  const dimensions = file.type.startsWith('image/') ? await measure(file) : null;

  const ticket = await api
    .requestUpload(workspaceId, {
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      durationMs: options.durationMs ?? null,
      peaks: options.peaks ?? null,
    })
    .catch((error: unknown) => {
      throw new UploadError(reasonFor(error));
    });

  await put(ticket.uploadUrl, ticket.headers, file, options);
  return ticket.attachment;
}

/**
 * XHR rather than fetch, for one reason: upload progress. `fetch` still cannot
 * report how much of a request body has gone, and a 40MB video with no bar is
 * indistinguishable from a hung one.
 */
function put(
  url: string,
  headers: Record<string, string>,
  file: File,
  options: UploadOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url, true);

    for (const [name, value] of Object.entries(headers)) {
      // The browser sets content-length itself and forbids setting it here.
      if (name.toLowerCase() === 'content-length') continue;
      request.setRequestHeader(name, value);
    }

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded / event.total);
    });

    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        options.onProgress?.(1);
        resolve();
      } else {
        reject(new UploadError('refused'));
      }
    });

    request.addEventListener('error', () => reject(new UploadError('network')));
    request.addEventListener('abort', () => reject(new UploadError('network')));

    options.signal?.addEventListener('abort', () => request.abort(), { once: true });
    request.send(file);
  });
}

function reasonFor(error: unknown): UploadFailure {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'too_large') return 'too_large';
  if (code === 'rate_limited') return 'rate_limited';
  return 'refused';
}

/**
 * Read before upload so the message carries the intrinsic size. That is what
 * lets the message list reserve the right box and never reflow when an image
 * finishes loading.
 */
async function measure(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

export const UPLOAD_MESSAGES: Record<UploadFailure, string> = {
  too_large: `Files have to be under ${Math.round(LIMITS.fileBytesMax / (1024 * 1024))}MB.`,
  rate_limited: 'Too many uploads at once. Give it a minute.',
  refused: 'The upload was refused. Check the storage settings.',
  network: 'The upload did not finish. Check your connection.',
};
