import { describe, expect, it } from 'vitest';
import { isPrivateAddress, RefusedError, safeFetch } from './safe-fetch.js';

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'no_refusal';
  } catch (error) {
    return error instanceof RefusedError ? error.kind : 'other_error';
  }
}

describe('address filtering', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['0.0.0.0', 'unspecified'],
    ['10.0.0.5', 'private class A'],
    ['172.16.4.4', 'private class B'],
    ['172.31.255.255', 'the top of private class B'],
    ['192.168.1.1', 'private class C'],
    ['169.254.169.254', 'link local, which is also cloud metadata'],
    ['100.64.1.1', 'carrier grade NAT'],
    ['192.0.0.1', 'IETF protocol assignments'],
    ['239.1.1.1', 'multicast'],
    ['::1', 'IPv6 loopback'],
    ['::', 'IPv6 unspecified'],
    ['fd00::1', 'IPv6 unique local'],
    ['fe80::1', 'IPv6 link local'],
    ['::ffff:127.0.0.1', 'an IPv4 loopback wearing an IPv6 hat'],
    ['not an address', 'anything unparseable'],
  ])('refuses %s (%s)', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    ['8.8.8.8', 'a public resolver'],
    ['1.1.1.1', 'another one'],
    ['172.32.0.1', 'just past private class B'],
    ['100.128.0.1', 'just past carrier grade NAT'],
    ['2606:4700::1111', 'a public IPv6 address'],
  ])('allows %s (%s)', (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

describe('fetching', () => {
  it('refuses a literal private address before it reaches DNS', async () => {
    expect(await refusal(safeFetch('http://127.0.0.1/', { maxBytes: 1000 }))).toBe(
      'private_address',
    );
    expect(
      await refusal(safeFetch('http://169.254.169.254/latest/meta-data/', { maxBytes: 1000 })),
    ).toBe('private_address');
  });

  it.each(['file:///etc/passwd', 'gopher://example.com/', 'ftp://example.com/'])(
    'refuses %s',
    async (url) => {
      expect(await refusal(safeFetch(url, { maxBytes: 1000 }))).toBe('bad_url');
    },
  );

  it('refuses something that is not a url at all', async () => {
    expect(await refusal(safeFetch('not a url', { maxBytes: 1000 }))).toBe('bad_url');
  });
});
