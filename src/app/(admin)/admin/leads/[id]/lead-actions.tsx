'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, ErrorText, Field, inputClass } from '@/components/ui';
import { apiFetch, errorMessage } from '@/lib/client/api-client';

function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function run(path: string, method: string, body?: unknown): Promise<boolean> {
    setPending(true);
    setError(null);
    const res = await apiFetch(path, { method, body });
    setPending(false);
    if (!res.ok) {
      setError(errorMessage(res.error));
      return false;
    }
    router.refresh();
    return true;
  }
  return { error, pending, run };
}

const list = (value: string) =>
  value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

type EditValues = Record<
  | 'fullName'
  | 'email'
  | 'phone'
  | 'country'
  | 'ownerUserId'
  | 'experienceLevel'
  | 'marketsOfInterest'
  | 'mainDifficulties'
  | 'goals'
  | 'desiredStart'
  | 'mentorshipInterest'
  | 'previousTraining'
  | 'reasonForTraining',
  string
>;

export function LeadEditForm({
  leadId,
  initial,
  staff,
  canEdit,
}: {
  leadId: string;
  initial: EditValues;
  staff: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const { error, pending, run } = useAction();
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = Object.fromEntries(new FormData(event.currentTarget)) as EditValues;
    setSaved(false);
    const ok = await run(`/api/v1/leads/${leadId}`, 'PATCH', {
      fullName: orNull(f.fullName),
      email: orNull(f.email),
      phone: orNull(f.phone),
      country: orNull(f.country),
      ownerUserId: orNull(f.ownerUserId),
      qualification: {
        experienceLevel: f.experienceLevel,
        marketsOfInterest: list(f.marketsOfInterest),
        mainDifficulties: list(f.mainDifficulties),
        goals: list(f.goals),
        desiredStart: f.desiredStart,
        mentorshipInterest: f.mentorshipInterest,
        previousTraining: f.previousTraining,
        reasonForTraining: f.reasonForTraining,
      },
    });
    setSaved(ok);
  }

  const text = (name: keyof EditValues, label: string, placeholder?: string) => (
    <Field label={label}>
      <input
        name={name}
        defaultValue={initial[name]}
        placeholder={placeholder}
        disabled={!canEdit}
        className={inputClass}
      />
    </Field>
  );
  const select = (name: keyof EditValues, label: string, options: string[]) => (
    <Field label={label}>
      <select name={name} defaultValue={initial[name]} disabled={!canEdit} className={inputClass}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {text('fullName', 'Name')}
        {text('email', 'Email')}
        {text('phone', 'Phone', '+44 20 7946 0958')}
        {text('country', 'Country (ISO code)', 'GB')}
        <Field label="Owner">
          <select
            name="ownerUserId"
            defaultValue={initial.ownerUserId}
            disabled={!canEdit}
            className={inputClass}
          >
            <option value="">Unassigned</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        {select('experienceLevel', 'Experience', [
          'unknown',
          'beginner',
          'intermediate',
          'experienced',
        ])}
        {text('marketsOfInterest', 'Markets (comma-separated)', 'forex, indices')}
        {text('mainDifficulties', 'Main difficulties (comma-separated)')}
        {text('goals', 'Goals (comma-separated)')}
        {select('desiredStart', 'Desired start', ['unknown', 'now', '30d', '90d', 'later'])}
        {select('mentorshipInterest', 'Mentorship interest', ['unknown', 'yes', 'maybe', 'no'])}
        {text('previousTraining', 'Previous training')}
      </div>
      <Field label="Reason for seeking training">
        <textarea
          name="reasonForTraining"
          defaultValue={initial.reasonForTraining}
          disabled={!canEdit}
          rows={2}
          className={inputClass}
        />
      </Field>
      {canEdit ? (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
          {saved ? <span className="text-sm text-green-700">Saved</span> : null}
        </div>
      ) : null}
      <ErrorText message={error} />
    </form>
  );
}

export function StageControl({
  leadId,
  allowed,
  reasonRequiredFor,
}: {
  leadId: string;
  allowed: string[];
  reasonRequiredFor: string[];
}) {
  const { error, pending, run } = useAction();
  const [to, setTo] = useState(allowed[0] ?? '');
  if (allowed.length === 0) return <p className="text-sm text-slate-500">This is a final stage.</p>;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
    await run(`/api/v1/leads/${leadId}/transition`, 'POST', { to, reason: reason || undefined });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="Move to">
        <select value={to} onChange={(e) => setTo(e.target.value)} className={inputClass}>
          {allowed.map((stage) => (
            <option key={stage} value={stage}>
              {stage.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      </Field>
      <Field label={reasonRequiredFor.includes(to) ? 'Reason (required)' : 'Reason (optional)'}>
        <input name="reason" required={reasonRequiredFor.includes(to)} className={inputClass} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? 'Moving…' : 'Change stage'}
      </Button>
      <ErrorText message={error} />
    </form>
  );
}

export function NoteForm({ leadId }: { leadId: string }) {
  const { error, pending, run } = useAction();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = String(new FormData(form).get('body') ?? '').trim();
    if (await run(`/api/v1/leads/${leadId}/notes`, 'POST', { body })) form.reset();
  }
  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <textarea name="body" required rows={2} placeholder="Add a note" className={inputClass} />
      <Button type="submit" variant="secondary" disabled={pending}>
        Add note
      </Button>
      <ErrorText message={error} />
    </form>
  );
}

export function ConsentForm({ leadId }: { leadId: string }) {
  const { error, pending, run } = useAction();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    await run(`/api/v1/leads/${leadId}/consents`, 'POST', {
      channel: f.channel,
      purpose: f.purpose,
      status: f.status,
      note: f.note || undefined,
    });
  }
  return (
    <form onSubmit={onSubmit} className="mt-3 grid grid-cols-3 gap-2">
      <select name="channel" className={inputClass}>
        {['email', 'sms', 'whatsapp', 'phone'].map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      <select name="purpose" className={inputClass}>
        <option>marketing</option>
        <option>transactional</option>
      </select>
      <select name="status" className={inputClass}>
        <option>granted</option>
        <option>revoked</option>
      </select>
      <input
        name="note"
        placeholder="How it was given (optional)"
        className={`${inputClass} col-span-3`}
      />
      <Button type="submit" variant="secondary" disabled={pending} className="col-span-3">
        Record consent
      </Button>
      <div className="col-span-3">
        <ErrorText message={error} />
      </div>
    </form>
  );
}

export function DataRequests({ leadId, canErase }: { leadId: string; canErase: boolean }) {
  const { error, pending, run } = useAction();
  return (
    <div className="space-y-3 text-sm">
      <a href={`/api/v1/leads/${leadId}/export`} className="block text-brand">
        Export all data (JSON)
      </a>
      {canErase ? (
        <Button
          variant="danger"
          disabled={pending}
          onClick={async () => {
            if (window.confirm('Erase this lead’s personal data? This cannot be undone.')) {
              await run(`/api/v1/leads/${leadId}`, 'DELETE');
            }
          }}
        >
          Erase personal data
        </Button>
      ) : null}
      <ErrorText message={error} />
    </div>
  );
}

export function MergeForm({ targetLeadId }: { targetLeadId: string }) {
  const { error, pending, run } = useAction();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sourceLeadId = String(new FormData(event.currentTarget).get('sourceLeadId') ?? '').trim();
    if (!window.confirm('Merge that lead into this one? The other lead becomes read-only.')) return;
    await run('/api/v1/leads/merge', 'POST', { targetLeadId, sourceLeadId });
  }
  return (
    <form onSubmit={onSubmit} className="space-y-2 border-t border-slate-100 pt-3 text-sm">
      <Field label="Merge a duplicate into this lead (duplicate’s lead ID)">
        <input name="sourceLeadId" required className={inputClass} />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        Merge
      </Button>
      <ErrorText message={error} />
    </form>
  );
}
