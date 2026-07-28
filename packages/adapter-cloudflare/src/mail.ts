import type { Mailer, OutgoingEmail } from '@huddle/domain';

/**
 * Plain HTTP rather than an SDK, so the same class runs on Workers, Node, Bun
 * and Deno without a platform specific client.
 */
export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(email: OutgoingEmail): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
    });

    if (!response.ok) {
      // The body is small and bounded, so reading it here is safe.
      throw new Error(`Email send failed with ${response.status}: ${await response.text()}`);
    }
  }
}

/**
 * Development and self hosted installs without a mail provider. Prints the
 * link so a magic link login still works locally.
 */
export class ConsoleMailer implements Mailer {
  readonly sent: OutgoingEmail[] = [];

  async send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email);
    console.log(
      JSON.stringify({ level: 'info', event: 'email_not_sent', to: email.to, text: email.text }),
    );
  }
}
