import { LIMITS, type Attachment } from '@huddle/core';
import { api } from './api';

/**
 * Two steps on purpose: the server records the file and hands back a signed
 * URL, then the bytes go straight to the bucket. Nothing large ever passes
 * through the app process.
 */
export async function upload(
  workspaceId: string,
  file: File,
  extra: { durationMs?: number | null; peaks?: number[] | null } = {},
): Promise<Attachment> {
  if (file.size > LIMITS.fileBytesMax) throw new Error('too_large');

  const dimensions = file.type.startsWith('image/') ? await measure(file) : null;

  const ticket = await api.requestUpload(workspaceId, {
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    durationMs: extra.durationMs ?? null,
    peaks: extra.peaks ?? null,
  });

  const response = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    headers: ticket.headers,
    body: file,
  });

  if (!response.ok) throw new Error('upload_failed');
  return ticket.attachment;
}

/**
 * Read before upload so the message carries the intrinsic size, which is what
 * stops the message list reflowing when an image finishes loading later.
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
