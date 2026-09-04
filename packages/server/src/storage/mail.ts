import { createTransport, type Transporter } from 'nodemailer';
import type { Config } from '../config.js';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(email: OutgoingEmail): Promise<void>;
}

/**
 * SMTP rather than a provider API, because every mail service on earth speaks
 * it and an air gapped install can point at a relay on the same network.
 */
export interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string };
}

/**
 * Handed to nodemailer as options rather than as a string.
 *
 * Given the URL it parses it with `url.parse`, which Node deprecated because
 * its behaviour is not standardised and its parsing bugs have had security
 * consequences. The WHATWG parser is the one to use, and doing it here means
 * the deprecated path is never reached.
 *
 * smtps: means TLS from the first byte. smtp: on 465 means the same thing in
 * practice, because that port was only ever implicit TLS. Everything else
 * starts in the clear and upgrades with STARTTLS, which nodemailer does on
 * its own when secure is false.
 */
export function parseSmtpUrl(value: string): SmtpOptions {
  const url = new URL(value);
  const secure = url.protocol === 'smtps:' || url.port === '465';
  const port = url.port === '' ? (secure ? 465 : 587) : Number(url.port);

  const options: SmtpOptions = { host: url.hostname, port, secure };

  // Credentials arrive percent encoded, and a password with an @ or a slash in
  // it is common enough that decoding is not optional.
  if (url.username !== '') {
    options.auth = {
      user: decodeURIComponent(url.username),
      pass: decodeURIComponent(url.password),
    };
  }

  return options;
}

export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = createTransport(parseSmtpUrl(smtpUrl));
  }

  async send(email: OutgoingEmail): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  }
}

/**
 * The default when no SMTP URL is set. Printing the link keeps magic link
 * sign in working on a laptop with no mail server, which is what a first run
 * needs.
 */
export class ConsoleMailer implements Mailer {
  readonly sent: OutgoingEmail[] = [];

  async send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email);
    console.log(
      JSON.stringify({ level: 'info', event: 'email_not_sent', to: email.to, text: email.text }),
    );
  }

  last(): OutgoingEmail | undefined {
    return this.sent.at(-1);
  }
}

export function createMailer(config: Config['mail']): Mailer {
  return config.smtpUrl === '' ? new ConsoleMailer() : new SmtpMailer(config.smtpUrl, config.from);
}
