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
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = createTransport(smtpUrl);
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
