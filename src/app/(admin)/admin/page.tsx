import Link from 'next/link';

export default function AdminHome() {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h1 className="text-lg font-semibold">Admin</h1>
      <p className="mt-2 text-sm text-slate-600">
        The lead database and CRM are live. AI conversations, scoring, booking and handoffs arrive
        in later phases.
      </p>
      <Link href="/admin/leads" className="mt-4 inline-block text-sm font-medium text-brand">
        Go to leads →
      </Link>
    </section>
  );
}
