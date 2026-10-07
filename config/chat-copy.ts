/**
 * Fixed chat texts shown to prospects without going through the AI, in English and French
 * (Canada first, business question 1). Wording follows the founder's answers of 2026-10-07
 * (questions 2 and 13).
 *
 * ⚠️ NOT APPROVED. Stored with `approved: false` until the owner approves it together with the
 * prompts (docs/prompt-approval.md); the AI does not run while it is unapproved. This is not
 * final legal wording: approval does not replace legal review. The version is recorded on every
 * message that uses it. Nothing here may promise results or give advice.
 */
export const chatCopy = {
  version: '0.2.0',
  approved: false,
  assistantName: 'ProfitCosmos Omega AI Assistant',
  /** Sent instead of an AI reply that failed its checks twice, or when the AI call failed. */
  fallbackReply:
    "Thanks for your message. I can't answer that here, so a member of our team will follow up with you.\n\n" +
    'Merci pour votre message. Je ne peux pas répondre à cela ici; un membre de notre équipe fera le suivi avec vous.',
  /** Shown by the chat page while the assistant is not answering (switched off or handed over). */
  unavailableNotice:
    'Thanks for your message. A member of our team will get back to you. / ' +
    'Merci pour votre message. Un membre de notre équipe vous répondra.',
  /** Shown above the chat. */
  aiDisclosure:
    'You are chatting with the ProfitCosmos Omega AI Assistant, an AI. It shares educational information, not personalized financial advice. Trading involves risk and results are not guaranteed. / ' +
    "Vous discutez avec ProfitCosmos Omega AI Assistant, une intelligence artificielle. Il fournit de l'information éducative, et non des conseils financiers personnalisés. Le trading comporte des risques et les résultats ne sont pas garantis.",
} as const;
