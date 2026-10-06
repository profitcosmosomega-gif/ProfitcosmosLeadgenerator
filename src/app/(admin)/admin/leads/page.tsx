import Link from 'next/link';
import { ALL_STAGES } from '@config/pipeline';
import { StageBadge, formatDate, inputClass } from '@/components/ui';
import { getDb } from '@/db/client';
import { requirePageUser } from '@/lib/admin-session';
import { hasRole } from '@/lib/rbac';
import { listLeadsQuery } from '@/modules/leads/schemas';
import { listLeads } from '@/modules/leads/service';
import { NewLeadForm } from './new-lead-form';

export const metadata = { title: 'Leads · ProfitCosmos Omega' };

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePageUser();
  const raw = await searchParams;
  const params = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => typeof v === 'string' && v !== ''),
  );
  const parsed = listLeadsQuery.safeParse(params);
  const query = parsed.success ? parsed.data : listLeadsQuery.parse({});
  const { items, total, limit, offset } = await listLeads(getDb(), user.organizationId, query);

  const pageHref = (newOffset: number) =>
    `/admin/leads?${new URLSearchParams({ ...(params as Record<string, string>), offset: String(newOffset) })}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Leads</h1>
        <span className="text-sm text-slate-500">{total} total</span>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <input
          name="q"
          defaultValue={query.q ?? ''}
          placeholder="Search name, email or phone"
          className={`${inputClass} max-w-xs`}
        />
        <select
          name="stage"
          defaultValue={query.stage ?? ''}
          className={`${inputClass} max-w-[14rem]`}
        >
          <option value="">All stages</option>
          {ALL_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {stage.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
        <input
          name="source"
          defaultValue={query.source ?? ''}
          placeholder="Source"
          className={`${inputClass} max-w-[10rem]`}
        />
        <button className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm">
          Filter
        </button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Contact</th>
              <th className="px-4 py-2">Stage</th>
              <th className="px-4 py-2">Source</th>
              <th className="px-4 py-2">Owner</th>
              <th className="px-4 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No leads found.
                </td>
              </tr>
            ) : (
              items.map((lead) => (
                <tr
                  key={lead.id}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                >
                  <td className="px-4 py-2">
                    <Link href={`/admin/leads/${lead.id}`} className="font-medium text-brand">
                      {lead.fullName || '(no name)'}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-slate-600">{lead.email ?? lead.phone}</td>
                  <td className="px-4 py-2">
                    <StageBadge stage={lead.stage} />
                  </td>
                  <td className="px-4 py-2 text-slate-600">{lead.source ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-600">{lead.ownerName ?? 'Unassigned'}</td>
                  <td className="px-4 py-2 text-slate-600">{formatDate(lead.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between text-sm">
        {offset > 0 ? (
          <Link href={pageHref(Math.max(0, offset - limit))}>← Previous</Link>
        ) : (
          <span />
        )}
        {offset + limit < total ? <Link href={pageHref(offset + limit)}>Next →</Link> : <span />}
      </div>

      {hasRole(user.role, 'sales') ? <NewLeadForm /> : null}
    </div>
  );
}
