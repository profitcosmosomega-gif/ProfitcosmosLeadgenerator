import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { REDACT_PATHS } from '@/lib/logger';

describe('log redaction', () => {
  it('removes personal data keys from log lines', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const log = pino({ redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } }, stream);
    log.info(
      { email: 'jane@example.com', lead: { phone: '+442079460958', email: 'x@y.z' } },
      'test',
    );
    const output = lines.join('');
    expect(output).not.toContain('jane@example.com');
    expect(output).not.toContain('+442079460958');
    expect(output).toContain('[REDACTED]');
  });

  it('removes chat text, prompts and conversation tokens', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const log = pino({ redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } }, stream);
    log.info(
      {
        body: 'my secret message',
        req: { text: 'chat text', accessToken: 'tok-123', system: 'SYSTEM PROMPT' },
        tool: { input: { quote: 'quoted words' } },
        conversationId: 'c-1',
      },
      'test',
    );
    const output = lines.join('');
    for (const value of ['my secret message', 'chat text', 'tok-123', 'SYSTEM PROMPT', 'quoted']) {
      expect(output).not.toContain(value);
    }
    expect(output).toContain('c-1');
  });
});
