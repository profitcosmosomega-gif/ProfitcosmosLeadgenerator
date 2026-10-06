import nodemailer from 'nodemailer';
import { describe, expect, it } from 'vitest';
import { ConsoleEmailProvider } from '@/providers/email/console';
import { SmtpEmailProvider } from '@/providers/email/smtp';

describe('email providers', () => {
  it('SMTP provider builds the message with the default sender', async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const provider = new SmtpEmailProvider(transport, 'Academy <no-reply@example.test>');

    const sent: string[] = [];
    const original = transport.sendMail.bind(transport);
    transport.sendMail = (async (mail: Parameters<typeof original>[0]) => {
      const info = await original(mail);
      sent.push(String(info.message));
      return info;
    }) as typeof transport.sendMail;

    const result = await provider.send({
      to: 'prospect@example.test',
      subject: 'Your consultation',
      text: 'See you soon',
    });

    expect(result.messageId).toBeTruthy();
    const message = JSON.parse(sent[0] ?? '{}');
    expect(message.from).toEqual({ address: 'no-reply@example.test', name: 'Academy' });
    expect(message.subject).toBe('Your consultation');
    expect(message.text).toBe('See you soon');
  });

  it('console provider returns a message id without sending', async () => {
    const result = await new ConsoleEmailProvider().send({
      to: 'prospect@example.test',
      subject: 'Hello',
      text: 'Hi',
    });
    expect(result.messageId).toMatch(/@console>$/);
  });
});
