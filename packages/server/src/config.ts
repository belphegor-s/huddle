import { z } from 'zod';

/**
 * Every knob the server has, read once at boot and never from `process.env`
 * again. A missing required value fails the process immediately rather than
 * surfacing as a confusing error on the first request that needs it.
 */
const Env = z.object({
  DATABASE_URL: z.string().min(1),
  PUBLIC_URL: z.url().default('http://localhost:3000'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** Where the built client bundle lives. Empty means API only. */
  WEB_DIR: z.string().default(''),

  S3_ENDPOINT: z.string().default(''),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().default('huddle'),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  /** MinIO and most self hosted gateways need path style addressing. */
  S3_FORCE_PATH_STYLE: z.stringbool().default(true),

  SMTP_URL: z.string().default(''),
  EMAIL_FROM: z.string().default('huddle <no-reply@localhost>'),

  AI_BASE_URL: z.string().default(''),
  AI_API_KEY: z.string().default(''),
  AI_MODEL: z.string().default('gpt-4o-mini'),

  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
});

export interface Config {
  databaseUrl: string;
  publicUrl: string;
  port: number;
  webDir: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  };
  mail: { smtpUrl: string; from: string };
  ai: { baseUrl: string; apiKey: string; model: string };
  push: { publicKey: string; privateKey: string; subject: string };
}

export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  const env = Env.parse(source);

  return {
    databaseUrl: env.DATABASE_URL,
    publicUrl: env.PUBLIC_URL.replace(/\/$/, ''),
    port: env.PORT,
    webDir: env.WEB_DIR,
    s3: {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    },
    mail: { smtpUrl: env.SMTP_URL, from: env.EMAIL_FROM },
    ai: { baseUrl: env.AI_BASE_URL, apiKey: env.AI_API_KEY, model: env.AI_MODEL },
    push: {
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
      subject: env.PUBLIC_URL,
    },
  };
}
