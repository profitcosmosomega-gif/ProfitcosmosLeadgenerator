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

  it('no prompt is approved; only Phase 3 drafts carry text, older versions stay stubs', async () => {
    const dirs = (await readdir(PROMPTS_DIR, { withFileTypes: true })).filter((d) =>
      d.isDirectory(),
    );
    expect(dirs.length).toBeGreaterThan(0);
    for (const dir of dirs) {
      for (const name of await readdir(path.join(PROMPTS_DIR, dir.name))) {
        const { meta, body } = parsePromptFile(
          await readFile(path.join(PROMPTS_DIR, dir.name, name), 'utf8'),
        );
        // Production prompt approval has not been granted (owner gate).
        expect(meta.status).not.toBe('approved');
        expect(meta.approved_by).toBeNull();
        if (meta.version.startsWith('0.')) {
          expect(meta.status).toBe('stub');
          // Every section body is a single TODO placeholder line.
          const content = body
            .replace(/<!--[\s\S]*?-->/g, '')
            .split('\n')
            .filter((line) => line.trim() && !line.startsWith('## '));
          expect(content.every((line) => line.startsWith('TODO'))).toBe(true);
        } else {
          expect(meta.status).toBe('draft');
        }
      }
    }
  });

  it('refuses to load prompts that are not approved', async () => {
    await expect(loadActivePrompt('qualification-agent')).rejects.toBeInstanceOf(
      PromptNotApprovedError,
    );
  });

  it('refuses drafts unless explicitly allowed in the test environment', async () => {
    await expect(loadActivePrompt('output-guardrail')).rejects.toBeInstanceOf(
      PromptNotApprovedError,
    );
    const draft = await loadActivePrompt('qualification-agent', { allowDraft: true });
    expect(draft.meta.status).toBe('draft');
    // Stubs are never served, even when drafts are allowed.
    await expect(
      loadActivePrompt('conversation-summary', { allowDraft: true }),
    ).rejects.toBeInstanceOf(PromptNotApprovedError);
  });

  it('allowDraft throws outside the test environment', async () => {
    const previous = process.env.NODE_ENV;
    try {
      Object.assign(process.env, { NODE_ENV: 'production' });
      await expect(loadActivePrompt('qualification-agent', { allowDraft: true })).rejects.toThrow(
        'test suite',
      );
    } finally {
      Object.assign(process.env, { NODE_ENV: previous });
    }
  });

  it('rejects unknown prompts', async () => {
    await expect(loadActivePrompt('does-not-exist')).rejects.toThrow('Unknown prompt');
  });
});
