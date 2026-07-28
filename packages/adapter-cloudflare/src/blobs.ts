import type { BlobStore, UploadTicket } from '@huddle/domain';

/**
 * Uploads stream through the Worker into R2 rather than using presigned S3
 * URLs.
 *
 * Presigning would need SigV4 and an S3 access key, which is another secret to
 * manage and another thing to get wrong. Streaming through the Worker keeps
 * the R2 binding as the only credential, and because the body is piped rather
 * than buffered, a 100MB file still costs almost no memory. R2 has no egress
 * fee, so this stays free.
 */
export class R2BlobStore implements BlobStore {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly publicBaseUrl: string,
  ) {}

  async createUploadTicket(input: {
    key: string;
    contentType: string;
    contentLength: number;
  }): Promise<UploadTicket> {
    return {
      uploadUrl: `${this.publicBaseUrl}/api/blobs/${encodeURIComponent(input.key)}`,
      method: 'PUT',
      headers: {
        'content-type': input.contentType,
        'content-length': String(input.contentLength),
      },
      key: input.key,
      expiresAt: Date.now() + 600_000,
    };
  }

  async createDownloadUrl(key: string): Promise<string> {
    return `${this.publicBaseUrl}/api/blobs/${encodeURIComponent(key)}`;
  }

  async head(key: string): Promise<{ size: number; contentType: string } | null> {
    const object = await this.bucket.head(key);
    if (!object) return null;
    return {
      size: object.size,
      contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
    };
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }

  /** Called by the upload route. Streams straight to R2, never buffers. */
  async put(key: string, body: ReadableStream, contentType: string): Promise<void> {
    await this.bucket.put(key, body, { httpMetadata: { contentType } });
  }

  async getObject(key: string): Promise<R2ObjectBody | null> {
    return this.bucket.get(key);
  }
}
