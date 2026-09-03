import {
  err,
  LIMITS,
  ok,
  RATE_LIMITS,
  ulid,
  type Attachment,
  type CreateUploadInput,
  type Result,
  type UploadTicket,
} from '@huddle/core';
import { files } from '@huddle/db';
import { and, eq } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { requireMember, type AccessError } from './access.js';

export type UploadError = AccessError | 'too_large' | 'rate_limited' | 'not_found' | 'unavailable';

const MINUTE_SECONDS = 60;

/**
 * The row is written before the bytes exist. An upload the browser abandons
 * leaves a row pointing at nothing, which the attachment never references
 * because the client only sends the message after the PUT succeeds.
 */
export async function requestUpload(
  ctx: AppContext,
  input: { workspaceId: string; userId: string } & CreateUploadInput,
): Promise<Result<UploadTicket, UploadError>> {
  const member = await requireMember(ctx.db, {
    workspaceId: input.workspaceId,
    userId: input.userId,
  });
  if (!member.ok) return err(member.error);
  if (!ctx.blobs.configured) return err('unavailable');

  if (input.size > LIMITS.fileBytesMax) return err('too_large');

  const uploads = await ctx.kv.increment(`rl:upload:${input.userId}`, MINUTE_SECONDS);
  if (uploads > RATE_LIMITS.uploadsPerMinute) return err('rate_limited');

  const now = ctx.now();
  const id = ulid(now);
  const key = `${input.workspaceId}/${id}/${sanitize(input.name)}`;

  await ctx.db.insert(files).values({
    id,
    workspaceId: input.workspaceId,
    uploaderId: input.userId,
    storageKey: key,
    name: input.name,
    mimeType: input.mimeType,
    size: input.size,
    width: input.width,
    height: input.height,
    durationMs: input.durationMs,
    peaks: input.peaks,
    createdAt: now,
  });

  const ticket = await ctx.blobs.createUploadTicket({
    key,
    contentType: input.mimeType,
    contentLength: input.size,
  });

  return ok({
    uploadUrl: ticket.uploadUrl,
    method: 'PUT',
    headers: ticket.headers,
    expiresAt: ticket.expiresAt,
    attachment: {
      id,
      kind: kindOf(input.mimeType),
      name: input.name,
      mimeType: input.mimeType,
      size: input.size,
      url: `/api/files/${id}`,
      width: input.width,
      height: input.height,
      durationMs: input.durationMs,
      peaks: input.peaks,
    } satisfies Attachment,
  });
}

/**
 * Answers with a short lived signed URL rather than proxying the bytes, so a
 * 100MB video never occupies the app process.
 */
export async function resolveDownload(
  ctx: AppContext,
  input: { fileId: string; userId: string },
): Promise<Result<string, UploadError>> {
  const rows = await ctx.db.select().from(files).where(eq(files.id, input.fileId)).limit(1);

  const file = rows[0];
  if (!file) return err('not_found');

  const member = await requireMember(ctx.db, {
    workspaceId: file.workspaceId,
    userId: input.userId,
  });
  if (!member.ok) return err('not_found');

  return ok(await ctx.blobs.createDownloadUrl(file.storageKey));
}

export async function deleteFile(
  ctx: AppContext,
  input: { fileId: string; userId: string },
): Promise<Result<null, UploadError>> {
  const rows = await ctx.db.select().from(files).where(eq(files.id, input.fileId)).limit(1);

  const file = rows[0];
  if (!file) return err('not_found');

  const member = await requireMember(ctx.db, {
    workspaceId: file.workspaceId,
    userId: input.userId,
  });
  if (!member.ok) return err('not_found');
  if (file.uploaderId !== input.userId && member.value.role === 'member') return err('forbidden');

  await ctx.blobs.delete(file.storageKey);
  await ctx.db
    .delete(files)
    .where(and(eq(files.id, input.fileId), eq(files.workspaceId, file.workspaceId)));

  return ok(null);
}

function kindOf(mimeType: string): Attachment['kind'] {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}

/** The key is never parsed back, so this only has to be safe, not reversible. */
function sanitize(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').slice(0, 100);
}
