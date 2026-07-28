const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_CHARS = 10;
const RANDOM_BYTES = 10;
const RANDOM_CHARS = 16;

function encodeTime(ms: number): string {
  let out = '';
  let value = ms;
  for (let i = TIME_CHARS - 1; i >= 0; i--) {
    out = CROCKFORD[value % 32] + out;
    value = Math.floor(value / 32);
  }
  return out;
}

// 10 random bytes are 80 bits, which packs exactly into 16 base32 characters.
function encodeRandom(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(RANDOM_BYTES));
  let bits = 0;
  let bitCount = 0;
  let out = '';
  for (const byte of bytes) {
    bits = (bits << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      out += CROCKFORD[(bits >>> bitCount) & 31];
      bits &= (1 << bitCount) - 1;
    }
  }
  return out.padEnd(RANDOM_CHARS, CROCKFORD[0]);
}

/**
 * ULID: 48 bit timestamp then 80 bits of randomness, Crockford base32.
 * Lexicographically sortable by creation time, safe to generate on the client
 * for optimistic sends. Ordering within a channel comes from the server `seq`,
 * not from this, so a monotonic counter is deliberately not used.
 */
export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}

export function ulidTime(id: string): number {
  let ms = 0;
  for (let i = 0; i < TIME_CHARS; i++) {
    const index = CROCKFORD.indexOf(id[i] ?? '');
    if (index === -1) throw new Error(`Invalid ULID: ${id}`);
    ms = ms * 32 + index;
  }
  return ms;
}

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isUlid(value: string): boolean {
  return ULID_PATTERN.test(value);
}
