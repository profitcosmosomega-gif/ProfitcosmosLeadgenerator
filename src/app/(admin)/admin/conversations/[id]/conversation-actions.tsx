'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, ErrorText } from '@/components/ui';
import { apiFetch, errorMessage } from '@/lib/client/api-client';

function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function run(path: string) {
    setPending(true);
    setError(null);
    const res = await apiFetch(path, { method: 'POST' });
    setPending(false);
    if (!res.ok) return setError(errorMessage(res.error));
    router.refresh();
  }
  return { error, pending, run };
}

export function PauseToggle({
  conversationId,
  paused,
}: {
  conversationId: string;
  paused: boolean;
}) {
  const { error, pending, run } = useAction();
  return (
    <span className="flex items-center gap-2">
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          run(`/api/v1/conversations/${conversationId}/${paused ? 'resume' : 'pause'}`)
        }
      >
        {paused ? 'Resume AI' : 'Pause AI'}
      </Button>
      <ErrorText message={error} />
    </span>
  );
}

export function ResolveButton({ escalationId }: { escalationId: string }) {
  const { error, pending, run } = useAction();
  return (
    <div className="mt-1">
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => run(`/api/v1/escalations/${escalationId}/resolve`)}
      >
        Mark handled
      </Button>
      <ErrorText message={error} />
    </div>
  );
}
