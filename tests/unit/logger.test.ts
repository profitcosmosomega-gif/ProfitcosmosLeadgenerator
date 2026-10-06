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
});
