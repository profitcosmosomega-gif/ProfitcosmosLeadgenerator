export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Overrides EMAIL_FROM. */
  from?: string;
  replyTo?: string;
  headers?: Record<string, string>;
}

export interface EmailSendResult {
  messageId: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}
