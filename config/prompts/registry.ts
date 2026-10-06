/**
 * Registry of versioned prompts. Each entry points at `config/prompts/<id>/v<version>.md`.
 * In Phase 1 every prompt is a stub with TODO placeholders and no production text.
 */
export interface PromptRegistryEntry {
  id: string;
  /** Version currently selected for use. */
  activeVersion: string;
}

export const promptRegistry: readonly PromptRegistryEntry[] = [
  { id: 'qualification-agent', activeVersion: '0.1.0' },
  { id: 'output-guardrail', activeVersion: '0.1.0' },
  { id: 'conversation-summary', activeVersion: '0.1.0' },
  { id: 'handoff-brief-summary', activeVersion: '0.1.0' },
];
