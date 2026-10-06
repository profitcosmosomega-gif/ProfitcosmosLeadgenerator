import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { promptRegistry } from '@config/prompts/registry';
import {
  loadActivePrompt,
  parsePromptFile,
  PROMPTS_DIR,
  PromptNotApprovedError,
  readPromptFile,
} from '@/lib/prompts';

describe('prompt registry', () => {
  it('every registered prompt has a matching version file', async () => {
    for (const entry of promptRegistry) {
      const file = await readPromptFile(entry.id, entry.activeVersion);
      expect(file.meta.id).toBe(entry.id);
    }
  });

  it('Phase 1 prompts are stubs with TODO placeholders only', async () => {
    const dirs = (await readdir(PROMPTS_DIR, { withFileTypes: true })).filter((d) =>
      d.isDirectory(),
    );
    expect(dirs.length).toBeGreaterThan(0);
    for (const dir of dirs) {
      for (const name of await readdir(path.join(PROMPTS_DIR, dir.name))) {
        const { meta, body } = parsePromptFile(
          await readFile(path.join(PROMPTS_DIR, dir.name, name), 'utf8'),
        );
        expect(meta.status).toBe('stub');
        // Every section body is a single TODO placeholder line.
        const content = body
          .replace(/<!--[\s\S]*?-->/g, '')
          .split('\n')
          .filter((line) => line.trim() && !line.startsWith('## '));
        expect(content.every((line) => line.startsWith('TODO'))).toBe(true);
      }
    }
  });

  it('refuses to load prompts that are not approved', async () => {
    await expect(loadActivePrompt('qualification-agent')).rejects.toBeInstanceOf(
      PromptNotApprovedError,
    );
  });

  it('rejects unknown prompts', async () => {
    await expect(loadActivePrompt('does-not-exist')).rejects.toThrow('Unknown prompt');
  });
});
