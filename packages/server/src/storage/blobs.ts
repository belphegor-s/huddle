import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
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
  /** False when no bucket is configured, so callers can refuse politely. */
  readonly configured: boolean;
  createUploadTicket(input: {
    key: string;
    contentType: string;
    contentLength: number;
  }): Promise<UploadTicket>;
  createDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  head(key: string): Promise<{ size: number; contentType: string } | null>;
  delete(key: string): Promise<void>;
  /**
   * Writes bytes the server itself produced. Uploads never use this: they are
   * signed and go straight from the browser to the bucket.
   */
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
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
  readonly configured = true;
  private readonly client: S3Client;

  constructor(private readonly config: Config['s3']) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint === '' ? undefined : config.endpoint,
      forcePathStyle: config.forcePathStyle,
      /*
       * A bucket in a region other than the configured one answers 301 with
       * the region it actually lives in. Following that is the difference
       * between "uploads are broken" and "the region setting was a guess", and
       * getting the region right is the single most common thing a self hoster
       * gets wrong.
       */
      followRegionRedirects: true,
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

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.byteLength,
      }),
    );
  }
}

/** Used by the test suite, so the service tests need no bucket running. */
export class MemoryBlobs implements BlobStore {
  readonly configured = true;
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

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { size: body.byteLength, contentType });
  }
}

/**
 * A deployment with no bucket. Uploads say so plainly instead of failing deep
 * inside an S3 client with a message about credentials.
 */
export const noBlobs: BlobStore = {
  configured: false,
  async createUploadTicket() {
    throw new Error('No object storage is configured');
  },
  async createDownloadUrl() {
    throw new Error('No object storage is configured');
  },
  async head() {
    return null;
  },
  async delete() {
    // Nothing was ever stored.
  },
  async put() {
    throw new Error('No object storage is configured');
  },
};

/**
 * Builds the store, and asks the bucket which region it is actually in.
 *
 * The region is the single thing a self hoster most often gets wrong, and it
 * fails in a way that looks like nothing: server side calls follow the
 * redirect and work, while presigned URLs keep 301ing, because a signature is
 * bound to the region it was made for and cannot follow anything. One request
 * at boot removes the whole class of problem.
 */
export async function createBlobStore(config: Config['s3']): Promise<BlobStore> {
  if (config.accessKeyId === '' || config.secretAccessKey === '' || config.bucket === '') {
    return noBlobs;
  }

  return new S3Blobs({ ...config, region: await resolveRegion(config) });
}

async function resolveRegion(config: Config['s3']): Promise<string> {
  // A custom gateway has its own region conventions, and several ignore the
  // value entirely. Only AWS is corrected.
  if (config.endpoint !== '') return config.region;

  try {
    const probe = new S3Client({
      region: config.region,
      followRegionRedirects: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });

    const response = await probe.send(new HeadBucketCommand({ Bucket: config.bucket }));
    const actual = response.BucketRegion ?? '';

    if (actual !== '' && actual !== config.region) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 's3_region_corrected',
          configured: config.region,
          actual,
          bucket: config.bucket,
        }),
      );
      return actual;
    }
  } catch {
    // Unreachable at boot is not fatal. The bucket may simply be starting.
  }

  return config.region;
}
