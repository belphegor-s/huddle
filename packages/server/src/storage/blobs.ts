import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../config.js';

export interface UploadTicket {
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  key: string;
  expiresAt: number;
}

export interface BlobStore {
  createUploadTicket(input: {
    key: string;
    contentType: string;
    contentLength: number;
  }): Promise<UploadTicket>;
  createDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  head(key: string): Promise<{ size: number; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

const UPLOAD_TTL_SECONDS = 600;
const DOWNLOAD_TTL_SECONDS = 60 * 60;

/**
 * Bytes go straight from the browser to the bucket on a presigned URL and
 * never pass through this process. That keeps a 100MB upload off the app's
 * memory and CPU entirely, and works the same against MinIO, S3, R2, Backblaze
 * or Wasabi because all of them speak the same signed PUT.
 */
export class S3Blobs implements BlobStore {
  private readonly client: S3Client;

  constructor(private readonly config: Config['s3']) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint === '' ? undefined : config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async createUploadTicket(input: {
    key: string;
    contentType: string;
    contentLength: number;
  }): Promise<UploadTicket> {
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: UPLOAD_TTL_SECONDS,
    });

    return {
      uploadUrl,
      method: 'PUT',
      // Signed against these exact values, so the browser has to send them back.
      headers: {
        'content-type': input.contentType,
        'content-length': String(input.contentLength),
      },
      key: input.key,
      expiresAt: Date.now() + UPLOAD_TTL_SECONDS * 1000,
    };
  }

  async createDownloadUrl(key: string, expiresInSeconds = DOWNLOAD_TTL_SECONDS): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  async head(key: string): Promise<{ size: number; contentType: string } | null> {
    try {
      const object = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return {
        size: object.ContentLength ?? 0,
        contentType: object.ContentType ?? 'application/octet-stream',
      };
    } catch {
      // A missing object and a denied read are both "not there" to the caller.
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }
}

/** Used by the test suite, so the service tests need no bucket running. */
export class MemoryBlobs implements BlobStore {
  readonly objects = new Map<string, { size: number; contentType: string }>();

  async createUploadTicket(input: {
    key: string;
    contentType: string;
    contentLength: number;
  }): Promise<UploadTicket> {
    this.objects.set(input.key, { size: input.contentLength, contentType: input.contentType });
    return {
      uploadUrl: `memory://${input.key}`,
      method: 'PUT',
      headers: { 'content-type': input.contentType },
      key: input.key,
      expiresAt: Date.now() + UPLOAD_TTL_SECONDS * 1000,
    };
  }

  async createDownloadUrl(key: string): Promise<string> {
    return `memory://${key}`;
  }

  async head(key: string): Promise<{ size: number; contentType: string } | null> {
    return this.objects.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
