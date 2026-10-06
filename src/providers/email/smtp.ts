import nodemailer, { type Transporter } from 'nodemailer';
import type { EmailMessage, EmailProvider, EmailSendResult } from './types';

/** SMTP email provider. Used with Mailpit in development; any SMTP relay in production. */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';

  constructor(
    private readonly transport: Transporter,
    private readonly defaultFrom: string,
  ) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const info = await this.transport.sendMail({
      from: message.from ?? this.defaultFrom,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      replyTo: message.replyTo,
      headers: message.headers,
    });
    return { messageId: info.messageId };
  }
}

export function createSmtpTransport(options: {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
}): Transporter {
  return nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure,
    auth: options.user ? { user: options.user, pass: options.password } : undefined,
  });
}
