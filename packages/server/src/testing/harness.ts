import type { App } from '../app.js';
import { ConsoleMailer } from '../storage/mail.js';

const ORIGIN = 'http://localhost:3000';

/**
 * A signed in caller. Sign in runs the real magic link flow rather than
 * inserting a session row, so the tests exercise the path a person actually
 * takes and would notice if it broke.
 */
export class Client {
  private cookie: string | null = null;

  constructor(private readonly app: App) {}

  async signIn(email: string): Promise<void> {
    await this.post('/api/auth/magic-link', { email, redirectTo: null });

    const mailer = this.app.ctx.mail;
    if (!(mailer instanceof ConsoleMailer)) throw new Error('Expected the console mailer');

    const link = /https?:\/\/\S+/.exec(mailer.last()?.text ?? '')?.[0];
    if (!link) throw new Error('No sign in link was sent');

    const response = await this.app.api.fetch(new Request(link, { redirect: 'manual' }));
    const setCookie = response.headers.get('set-cookie');
    if (!setCookie) throw new Error('Sign in did not set a session');

    this.cookie = setCookie.split(';')[0] ?? null;
  }

  get(path: string): Promise<Response> {
    return this.send('GET', path);
  }

  post(path: string, body?: unknown): Promise<Response> {
    return this.send('POST', path, body);
  }

  patch(path: string, body: unknown): Promise<Response> {
    return this.send('PATCH', path, body);
  }

  delete(path: string): Promise<Response> {
    return this.send('DELETE', path);
  }

  async json<T>(path: string): Promise<T> {
    const response = await this.get(path);
    return (await response.json()) as T;
  }

  private async send(method: string, path: string, body?: unknown): Promise<Response> {
    return this.app.api.fetch(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers: {
          ...(this.cookie ? { cookie: this.cookie } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  }
}

export async function asJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
