import { newId } from '@/lib/ids';
import { logger } from '@/lib/logger';
import type { EmailMessage, EmailProvider, EmailSendResult } from './types';

/** Logs instead of sending. Default when no SMTP server is configured. Never logs the recipient. */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const messageId = `<${newId()}@console>`;
    logger.info({ messageId, subject: message.subject }, 'email (console provider, not sent)');
    return { messageId };
  }
}
