import type { ComponentProps } from 'react';

export const inputClass =
  'w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none';

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const styles = {
    primary: 'bg-brand text-brand-foreground',
    secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
    danger: 'bg-red-600 text-white',
  }[variant];
  return (
    <button
      className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-60 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="text-sm text-red-600">
      {message}
    </p>
  ) : null;
}

export function StageBadge({ stage }: { stage: string }) {
  const tone =
    stage === 'LOST'
      ? 'bg-slate-200 text-slate-600'
      : stage === 'ENROLLED'
        ? 'bg-green-100 text-green-800'
        : stage === 'NURTURE'
          ? 'bg-amber-100 text-amber-800'
          : 'bg-indigo-100 text-indigo-800';
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${tone}`}>
      {stage.replaceAll('_', ' ')}
    </span>
  );
}

export function formatDate(value: Date | string): string {
  return new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}
