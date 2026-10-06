import { getEnv } from '@/lib/env';
import { ConsoleEmailProvider } from './console';
import { createSmtpTransport, SmtpEmailProvider } from './smtp';
import type { EmailProvider } from './types';

export type { EmailMessage, EmailProvider, EmailSendResult } from './types';

export function createEmailProvider(): EmailProvider {
  const env = getEnv();
  if (env.EMAIL_PROVIDER === 'smtp') {
    return new SmtpEmailProvider(
      createSmtpTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        user: env.SMTP_USER,
        password: env.SMTP_PASSWORD,
      }),
      env.EMAIL_FROM,
    );
  }
  return new ConsoleEmailProvider();
}
