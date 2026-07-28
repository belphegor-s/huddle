export interface UploadTicket {
  /** Where the client PUTs the bytes. Presigned on R2 and S3, a local route otherwise. */
  uploadUrl: string;
  method: 'PUT' | 'POST';
  headers: Record<string, string>;
  /** Storage key the caller records once the upload succeeds. */
  key: string;
  expiresAt: number;
}

export interface BlobStore {
  /**
   * Uploads go straight from the browser to storage. Bytes never pass through
   * the app, which keeps Worker CPU time and egress at zero.
   */
  createUploadTicket(input: {
    key: string;
    contentType: string;
    contentLength: number;
  }): Promise<UploadTicket>;

  /** Signed read URL. Attachments are never public. */
  createDownloadUrl(key: string, expiresInSeconds: number): Promise<string>;

  head(key: string): Promise<{ size: number; contentType: string } | null>;

  delete(key: string): Promise<void>;
}
