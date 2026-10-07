import type { Metadata } from 'next';
import { chatCopy } from '@config/chat-copy';
import { CURRENT_CONSENT_WORDING } from '@config/consent';
import { ChatClient } from './chat-client';

export const metadata: Metadata = { title: 'Chat' };

/** Public chat page (Phase 3). Fixed texts come from config so they can be reviewed. */
export default function ChatPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold text-slate-800">ProfitCosmos Omega Academy</h1>
      <ChatClient
        copy={{
          aiDisclosure: chatCopy.aiDisclosure,
          unavailableNotice: chatCopy.unavailableNotice,
        }}
        consent={{
          wordingVersion: CURRENT_CONSENT_WORDING.version,
          marketingEmail: CURRENT_CONSENT_WORDING.marketingEmail,
        }}
      />
    </main>
  );
}
