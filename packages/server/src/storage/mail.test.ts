import { describe, expect, it } from 'vitest';
import { parseSmtpUrl } from './mail.js';

describe('parseSmtpUrl', () => {
  it('reads host, port and credentials', () => {
    expect(parseSmtpUrl('smtp://ada:hunter2@mail.example.com:2525')).toEqual({
      host: 'mail.example.com',
      port: 2525,
      secure: false,
      auth: { user: 'ada', pass: 'hunter2' },
    });
  });

  it('treats smtps as implicit TLS', () => {
    expect(parseSmtpUrl('smtps://mail.example.com')).toMatchObject({ port: 465, secure: true });
  });

  it('treats port 465 as implicit TLS whatever the scheme says', () => {
    // That port was only ever implicit TLS, and plenty of providers hand out
    // an smtp: URL pointing at it.
    expect(parseSmtpUrl('smtp://mail.example.com:465')).toMatchObject({ port: 465, secure: true });
  });

  it('starts in the clear on the submission port, so STARTTLS can upgrade it', () => {
    expect(parseSmtpUrl('smtp://mail.example.com')).toMatchObject({ port: 587, secure: false });
  });

  it('decodes a password with characters that had to be escaped', () => {
    // An at sign or a slash in a password is common, and leaving it encoded
    // fails authentication in a way that looks like a wrong password.
    const parsed = parseSmtpUrl('smtp://user%40example.com:p%40ss%2Fword@mail.example.com');

    expect(parsed.auth).toEqual({ user: 'user@example.com', pass: 'p@ss/word' });
  });

  it('sends no credentials when the URL carries none', () => {
    expect(parseSmtpUrl('smtp://relay.internal:25').auth).toBeUndefined();
  });
});
