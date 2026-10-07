import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { promptRegistry } from '@config/prompts/registry';

export const PROMPTS_DIR = path.resolve(process.cwd(), 'config', 'prompts');

export const promptMetaSchema = z.object({
  id: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  status: z.enum(['stub', 'draft', 'approved', 'retired']),
  model_slot: z.enum(['conversation', 'extraction']),
  purpose: z.string().min(1),
  owner: z.string().min(1),
  approved_by: z.string().nullable(),
  approved_at: z.string().nullable(),
});

export type PromptMeta = z.infer<typeof promptMetaSchema>;

export interface PromptFile {
  meta: PromptMeta;
  body: string;
}

export class PromptNotApprovedError extends Error {
  constructor(id: string, version: string, status: string) {
    super(`Prompt ${id}@${version} has status "${status}" and cannot be used`);
    this.name = 'PromptNotApprovedError';
  }
}

export function promptPath(id: string, version: string): string {
  return path.join(PROMPTS_DIR, id, `v${version}.md`);
}

/** Parse the simple `key: value` front matter used by prompt files. */
export function parsePromptFile(source: string): PromptFile {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(source);
  if (!match) throw new Error('Prompt file is missing front matter');
  const [, header = '', body = ''] = match;
  const raw: Record<string, string | null> = {};
  for (const line of header.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const value = line.slice(idx + 1).trim();
    raw[line.slice(0, idx).trim()] = value === 'null' ? null : value;
  }
  return { meta: promptMetaSchema.parse(raw), body };
}

export async function readPromptFile(id: string, version: string): Promise<PromptFile> {
  const file = parsePromptFile(await readFile(promptPath(id, version), 'utf8'));
  if (file.meta.id !== id || file.meta.version !== version) {
    throw new Error(`Prompt file ${id}@${version} has mismatched front matter`);
  }
  return file;
}

/**
 * Load the active version of a prompt. Throws unless the prompt is approved.
 *
 * `allowDraft` lets the automated tests and scripted evaluations exercise a `draft` prompt
 * before the owner approves it. It only works when NODE_ENV is "test"; anywhere else it throws,
 * so production code can never serve an unapproved prompt.
 */
export async function loadActivePrompt(
  id: string,
  options: { allowDraft?: boolean } = {},
): Promise<PromptFile> {
  if (options.allowDraft && process.env.NODE_ENV !== 'test') {
    throw new Error('Draft prompts can only be loaded by the test suite');
  }
  const entry = promptRegistry.find((p) => p.id === id);
  if (!entry) throw new Error(`Unknown prompt "${id}"`);
  const file = await readPromptFile(id, entry.activeVersion);
  if (options.allowDraft && file.meta.status === 'draft') return file;
  if (file.meta.status !== 'approved' || !file.meta.approved_by || !file.meta.approved_at) {
    throw new PromptNotApprovedError(id, entry.activeVersion, file.meta.status);
  }
  return file;
}
