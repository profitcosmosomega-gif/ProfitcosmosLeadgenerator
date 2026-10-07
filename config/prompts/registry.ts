/**
 * Registry of versioned prompts. Each entry points at `config/prompts/<id>/v<version>.md`.
 * Phase 3 selects the 1.0.0 drafts of the qualification agent and output guardrail; they are
 * served only once the owner approves them. The other prompts are still stubs.
 */
export interface PromptRegistryEntry {
  id: string;
  /** Version currently selected for use. */
  activeVersion: string;
}

export const promptRegistry: readonly PromptRegistryEntry[] = [
  { id: 'qualification-agent', activeVersion: '1.0.0' },
  { id: 'output-guardrail', activeVersion: '1.0.0' },
  { id: 'conversation-summary', activeVersion: '0.1.0' },
  { id: 'handoff-brief-summary', activeVersion: '0.1.0' },
];
