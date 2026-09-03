import { lookup as dnsLookup } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

export type FetchRefusal =
  | 'bad_url'
  | 'private_address'
  | 'too_many_redirects'
  | 'too_large'
  | 'timeout'
  | 'unreachable'
  | 'bad_status';

export class RefusedError extends Error {
  readonly kind: FetchRefusal;

  constructor(kind: FetchRefusal) {
    super(kind);
    this.kind = kind;
  }
}

export interface SafeResponse {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
}

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 5_000;

/**
 * Blocked address space. Everything here is either the machine itself, the
 * network it sits on, or a metadata endpoint, and a link preview must not be
 * a way to reach any of them.
 */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateV4(address);
  if (version === 6) return isPrivateV6(address);
  return true;
}

function isPrivateV4(address: string): boolean {
  const parts = address.split('.').map(Number);
  const [a = 0, b = 0] = parts;
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;

  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link local, and cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier grade NAT
  if (a === 192 && b === 0) return true;
  if (a >= 224) return true; // multicast and reserved

  return false;
}

function isPrivateV6(address: string): boolean {
  const value = address.toLowerCase().split('%')[0] ?? '';
  if (value === '::' || value === '::1') return true;
  if (value.startsWith('fe80') || value.startsWith('fc') || value.startsWith('fd')) return true;

  // An IPv4 mapped address is still that IPv4 address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped?.[1]) return isPrivateV4(mapped[1]);

  return false;
}

/**
 * Resolution and connection use the same address.
 *
 * Validating a hostname and then letting the socket resolve it again leaves a
 * window where the second answer is a private address, which is the whole
 * point of a DNS rebinding attack. Passing this as the connection's own lookup
 * closes that window: what was checked is what gets dialled.
 */
function guardedLookup(
  hostname: string,
  options: unknown,
  callback: (error: Error | null, address: string, family: number) => void,
): void {
  dnsLookup(hostname, { all: true }, (error, addresses) => {
    if (error) {
      callback(new RefusedError('unreachable'), '', 0);
      return;
    }

    const allowed = addresses.find((entry) => !isPrivateAddress(entry.address));
    if (!allowed) {
      callback(new RefusedError('private_address'), '', 0);
      return;
    }

    callback(null, allowed.address, allowed.family);
  });
}

/**
 * Fetches a URL that a person supplied, which means it is hostile until
 * proven otherwise: no private addresses, a redirect budget, a byte cap that
 * stops reading rather than trusting content-length, and a hard timeout.
 */
export async function safeFetch(
  target: string,
  options: { maxBytes: number; accept?: string; redirectsLeft?: number },
): Promise<SafeResponse> {
  const url = parseUrl(target);
  const redirectsLeft = options.redirectsLeft ?? MAX_REDIRECTS;

  // A literal private address never even reaches DNS.
  if (isIP(url.hostname) !== 0 && isPrivateAddress(url.hostname)) {
    throw new RefusedError('private_address');
  }

  const response = await once(url, options.maxBytes, options.accept);

  if (response.status >= 300 && response.status < 400 && response.location !== null) {
    if (redirectsLeft <= 0) throw new RefusedError('too_many_redirects');

    // Every hop is re-validated. A public URL redirecting inward is the
    // oldest trick there is.
    return safeFetch(new URL(response.location, url).toString(), {
      ...options,
      redirectsLeft: redirectsLeft - 1,
    });
  }

  if (response.status < 200 || response.status >= 300) throw new RefusedError('bad_status');

  return {
    url: url.toString(),
    status: response.status,
    contentType: response.contentType,
    body: response.body,
  };
}

function parseUrl(target: string): URL {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new RefusedError('bad_url');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new RefusedError('bad_url');
  return url;
}

interface RawResponse {
  status: number;
  contentType: string;
  location: string | null;
  body: Buffer;
}

function once(url: URL, maxBytes: number, accept?: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;

    const request = send(
      url,
      {
        method: 'GET',
        lookup: guardedLookup,
        timeout: TIMEOUT_MS,
        headers: {
          // Named honestly. A server that does not want to be unfurled can
          // then say so, and an operator can see what reached them.
          'user-agent': 'huddle-link-preview/1.0 (+https://github.com/huddle)',
          accept: accept ?? 'text/html,application/xhtml+xml',
          'accept-encoding': 'identity',
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;

        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            // Stop reading rather than trusting a content-length header.
            response.destroy();
            reject(new RefusedError('too_large'));
            return;
          }
          chunks.push(chunk);
        });

        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            contentType: (response.headers['content-type'] ?? '').split(';')[0]?.trim() ?? '',
            location: response.headers.location ?? null,
            body: Buffer.concat(chunks),
          }),
        );

        response.on('error', () => reject(new RefusedError('unreachable')));
      },
    );

    request.on('timeout', () => {
      request.destroy();
      reject(new RefusedError('timeout'));
    });

    request.on('error', (error: unknown) =>
      reject(error instanceof RefusedError ? error : new RefusedError('unreachable')),
    );

    request.end();
  });
}
