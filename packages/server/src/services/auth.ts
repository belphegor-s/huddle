import {
  err,
  hashToken,
  ok,
  randomToken,
  RATE_LIMITS,
  StoredMagicLink,
  StoredSession,
  ulid,
  type Result,
  type User,
} from '@huddle/core';
import { users } from '@huddle/db';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../context.js';

/**
 * Short enough that a leaked inbox is a narrow window, long enough to survive
 * someone reading the email on a different device.
 */
const MAGIC_LINK_TTL_SECONDS = 15 * 60;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * A session is rewritten at most once a day. Refreshing on every request
 * would turn a read into a write on the hot path for no security gain.
 */
const SESSION_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
const HOUR_SECONDS = 60 * 60;

const magicKey = (hash: string) => `magic:${hash}`;
const sessionKey = (hash: string) => `session:${hash}`;

export interface MagicLinkRequest {
  email: string;
  redirectTo: string | null;
  clientIp: string;
  /** Origin the link should point back to, so self hosted installs work. */
  appUrl: string;
}

export interface IssuedSession {
  sessionToken: string;
  user: User;
  redirectTo: string | null;
}

/**
 * Rate limited per address and per address family, because either one alone
 * is trivial to walk around: a single sender can spray many addresses, and a
 * single address can be targeted from many machines.
 */
export async function requestMagicLink(
  ctx: AppContext,
  input: MagicLinkRequest,
): Promise<Result<{ expiresAt: number }, 'rate_limited'>> {
  const perEmail = await ctx.kv.increment(`rl:magic:email:${input.email}`, HOUR_SECONDS);
  if (perEmail > RATE_LIMITS.magicLinkPerHourPerEmail) return err('rate_limited');

  const perIp = await ctx.kv.increment(`rl:magic:ip:${input.clientIp}`, HOUR_SECONDS);
  if (perIp > RATE_LIMITS.magicLinkPerHourPerIp) return err('rate_limited');

  const now = ctx.now();
  const token = randomToken();
  const payload: StoredMagicLink = {
    email: input.email,
    redirectTo: input.redirectTo,
    createdAt: now,
  };

  await ctx.kv.set(
    magicKey(await hashToken(token)),
    JSON.stringify(payload),
    MAGIC_LINK_TTL_SECONDS,
  );

  const link = `${input.appUrl.replace(/\/$/, '')}/auth/callback?token=${encodeURIComponent(token)}`;
  await ctx.mail.send({
    to: input.email,
    subject: 'Your huddle sign in link',
    text: signInText(link),
    html: signInHtml(link),
  });

  return ok({ expiresAt: now + MAGIC_LINK_TTL_SECONDS * 1000 });
}

/**
 * The token is deleted before the session is minted, so a link that is opened
 * twice, by a person and by a mail scanner, cannot produce two sessions.
 */
export async function verifyMagicLink(
  ctx: AppContext,
  token: string,
): Promise<Result<IssuedSession, 'invalid_token'>> {
  const key = magicKey(await hashToken(token));
  const raw = await ctx.kv.get(key);
  if (raw === null) return err('invalid_token');

  await ctx.kv.delete(key);

  const parsed = StoredMagicLink.safeParse(safeJson(raw));
  if (!parsed.success) return err('invalid_token');

  const user = await findOrCreateUser(ctx, parsed.data.email);
  const sessionToken = await createSession(ctx, user.id);

  return ok({ sessionToken, user, redirectTo: parsed.data.redirectTo });
}

export async function createSession(ctx: AppContext, userId: string): Promise<string> {
  const now = ctx.now();
  const token = randomToken();
  const payload: StoredSession = { userId, createdAt: now, lastSeenAt: now };

  await ctx.kv.set(
    sessionKey(await hashToken(token)),
    JSON.stringify(payload),
    SESSION_TTL_SECONDS,
  );

  return token;
}

export async function loadSession(ctx: AppContext, token: string): Promise<User | null> {
  const key = sessionKey(await hashToken(token));
  const raw = await ctx.kv.get(key);
  if (raw === null) return null;

  const parsed = StoredSession.safeParse(safeJson(raw));
  if (!parsed.success) {
    await ctx.kv.delete(key);
    return null;
  }

  const rows = await ctx.db.select().from(users).where(eq(users.id, parsed.data.userId)).limit(1);
  const user = rows[0];
  if (!user) {
    await ctx.kv.delete(key);
    return null;
  }

  const now = ctx.now();
  if (now - parsed.data.lastSeenAt > SESSION_REFRESH_AFTER_MS) {
    const refreshed: StoredSession = { ...parsed.data, lastSeenAt: now };
    await ctx.kv.set(key, JSON.stringify(refreshed), SESSION_TTL_SECONDS);
  }

  return user;
}

export async function signOut(ctx: AppContext, token: string): Promise<void> {
  await ctx.kv.delete(sessionKey(await hashToken(token)));
}

async function findOrCreateUser(ctx: AppContext, email: string): Promise<User> {
  const existing = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) return existing[0];

  const now = ctx.now();
  const user: User = {
    id: ulid(now),
    email,
    displayName: nameFromEmail(email),
    avatarUrl: null,
    timezone: null,
    createdAt: now,
  };

  // A second sign in from the same address can race here, so the winner is
  // whoever inserted first and the loser reads that row back.
  const inserted = await ctx.db.insert(users).values(user).onConflictDoNothing().returning();
  if (inserted[0]) return inserted[0];

  const raced = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
  const found = raced[0];
  if (!found) throw new Error('User vanished between insert and read');
  return found;
}

/** A first guess only. People rename themselves on the profile screen. */
function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  const words = local.split(/[._\-+]+/).filter(Boolean);
  const name = words.map((word) => word[0]?.toUpperCase() + word.slice(1)).join(' ');
  return name.slice(0, 80) || email.slice(0, 80);
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function signInText(link: string): string {
  return [
    'Sign in to huddle with this link:',
    '',
    link,
    '',
    'It works once and expires in 15 minutes.',
    'If you did not ask to sign in, ignore this email and nothing happens.',
  ].join('\n');
}

function signInHtml(link: string): string {
  return [
    '<p>Sign in to huddle with this link:</p>',
    `<p><a href="${link}">Sign in</a></p>`,
    '<p>It works once and expires in 15 minutes.</p>',
    '<p>If you did not ask to sign in, ignore this email and nothing happens.</p>',
  ].join('');
}
