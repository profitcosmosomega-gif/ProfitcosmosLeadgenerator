/**
 * Fixed chat texts shown to prospects without going through the AI.
 *
 * ⚠️ PLACEHOLDER pending owner and legal approval (business questions 2 and 13). Stored with
 * `approved: false`; the wording version is recorded on every message that uses it.
 * Nothing here may promise results or give advice.
 */
export const chatCopy = {
  version: '0.1.0',
  approved: false,
  /** Sent instead of an AI reply that failed its checks twice, or when the AI call failed. */
  fallbackReply:
    "Thanks for your message. I can't answer that here, so a member of our team will follow up with you.",
  /** Shown by the chat page while the assistant is not answering (switched off or handed over). */
  unavailableNotice: 'Thanks for your message. A member of our team will get back to you.',
  /** Shown above the chat. */
  aiDisclosure: 'You are chatting with an AI assistant. A member of our team can follow up.',
} as const;
