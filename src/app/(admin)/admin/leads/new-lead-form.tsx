'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, Card, ErrorText, Field, inputClass } from '@/components/ui';
import { apiFetch, errorMessage } from '@/lib/client/api-client';

export function NewLeadForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '').trim() || undefined;
    setPending(true);
    setError(null);
    const res = await apiFetch<{ id: string }>('/api/v1/leads', {
      method: 'POST',
      body: {
        fullName: value('fullName'),
        email: value('email'),
        phone: value('phone'),
        source: value('source'),
      },
    });
    setPending(false);
    if (!res.ok || !res.data) return setError(errorMessage(res.error));
    router.push(`/admin/leads/${res.data.id}`);
  }

  return (
    <Card title="Add a lead">
      <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-5 sm:items-end">
        <Field label="Name">
          <input name="fullName" className={inputClass} />
        </Field>
        <Field label="Email">
          <input name="email" type="email" className={inputClass} />
        </Field>
        <Field label="Phone (international)">
          <input name="phone" placeholder="+44 20 7946 0958" className={inputClass} />
        </Field>
        <Field label="Source">
          <input name="source" placeholder="e.g. referral" className={inputClass} />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add lead'}
        </Button>
      </form>
      <div className="mt-2">
        <ErrorText message={error} />
      </div>
    </Card>
  );
}
