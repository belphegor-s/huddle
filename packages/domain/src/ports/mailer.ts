export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(email: OutgoingEmail): Promise<void>;
}
