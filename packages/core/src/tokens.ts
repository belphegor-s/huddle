/**
 * Secret tokens for magic links, sessions and invites.
 *
 * A token is generated once, handed to exactly one person, and never stored
 * in the clear. Only its SHA-256 hash is written down, so a leaked database
 * or KV dump cannot be replayed as a login. WebCrypto is used directly rather
 * than a library because it is present on Workers, Node 22 and every browser.
 */

const TOKEN_BYTES = 32;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 256 bits of randomness, URL safe, so it can sit in an email link unescaped. */
export function randomToken(byteLength: number = TOKEN_BYTES): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Tokens are looked up by hash, so a wrong token simply misses. This exists
 * for the cases where two secrets are compared directly and an early exit
 * would leak their common prefix through timing.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
