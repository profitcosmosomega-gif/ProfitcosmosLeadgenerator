import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { Card, StageBadge, formatDate } from '@/components/ui';
import { getDb } from '@/db/client';
import { requirePageUser } from '@/lib/admin-session';
import { AppError } from '@/lib/errors';
import { hasRole } from '@/lib/rbac';
import { listLeadConversations } from '@/modules/conversations/service';
import { getLeadDetail, getTimeline } from '@/modules/leads/service';
import { listStaff } from '@/modules/staff/service';
import {
  ConsentForm,
  DataRequests,
  LeadEditForm,
  MergeForm,
  NoteForm,
  StageControl,
} from './lead-actions';

export const metadata = { title: 'Lead · ProfitCosmos Omega' };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const db = getDb();
  let detail: Awaited<ReturnType<typeof getLeadDetail>>;
  try {
    detail = await getLeadDetail(db, user.organizationId, id);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  const [timeline, staff, chats] = await Promise.all([
    getTimeline(db, user.organizationId, id),
    listStaff(db, user.organizationId),
    listLeadConversations(db, user.organizationId, id),
  ]);
  const { lead, qualification } = detail;
  const canEdit = hasRole(user.role, 'sales') && !lead.erasedAt && !lead.mergedIntoLeadId;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/leads" className="text-sm text-slate-500">
          ← Leads
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">
            {lead.erasedAt ? '(erased)' : lead.fullName || '(no name)'}
          </h1>
          <StageBadge stage={lead.stage} />
          {lead.outcomeReason ? (
            <span className="text-sm text-slate-500">Reason: {lead.outcomeReason}</span>
          ) : null}
        </div>
        {lead.erasedAt ? (
          <p className="mt-2 text-sm text-amber-700">
            Personal data was erased on {formatDate(lead.erasedAt)}. Anonymous history is kept.
          </p>
        ) : null}
        {lead.mergedIntoLeadId ? (
          <p className="mt-2 text-sm text-amber-700">
            Merged into{' '}
            <Link className="text-brand" href={`/admin/leads/${lead.mergedIntoLeadId}`}>
              another lead
            </Link>
            .
          </p>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Contact and qualification">
            <LeadEditForm
              leadId={lead.id}
              canEdit={canEdit}
              staff={staff}
              initial={{
                fullName: lead.fullName ?? '',
                email: lead.email ?? '',
                phone: lead.phone ?? '',
                country: lead.country ?? '',
                ownerUserId: lead.ownerUserId ?? '',
                experienceLevel: qualification?.experienceLevel ?? 'unknown',
                marketsOfInterest: qualification?.marketsOfInterest.join(', ') ?? '',
                mainDifficulties: qualification?.mainDifficulties.join(', ') ?? '',
                goals: qualification?.goals.join(', ') ?? '',
                desiredStart: qualification?.desiredStart ?? 'unknown',
                mentorshipInterest: qualification?.mentorshipInterest ?? 'unknown',
                previousTraining: qualification?.previousTraining ?? '',
                reasonForTraining: qualification?.reasonForTraining ?? '',
              }}
            />
          </Card>

          <Card title="Conversations">
            {chats.length === 0 ? (
              <p className="text-sm text-slate-500">No conversations.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {chats.map((chat) => (
                  <li key={chat.id} className="flex flex-wrap items-center gap-x-3">
                    <Link
                      className="font-medium text-brand"
                      href={`/admin/conversations/${chat.id}`}
                    >
                      {chat.channel} chat · {formatDate(chat.createdAt)}
                    </Link>
                    <span className="text-slate-500">
                      {chat.messageCount} messages · {chat.status}
                      {chat.aiPaused ? ' · AI paused' : ''}
                    </span>
                    {chat.openEscalations > 0 ? (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        needs a human
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Timeline">
            <ol className="space-y-2 text-sm">
              {timeline.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-wrap gap-x-3 border-b border-slate-100 pb-2 last:border-0"
                >
                  <span className="w-40 shrink-0 text-slate-500">
                    {formatDate(event.occurredAt)}
                  </span>
                  <span className="font-medium">{event.type}</span>
                  <span className="text-slate-500">
                    {event.actorName ?? (event.actorType === 'lead' ? 'prospect' : event.actorType)}
                  </span>
                  <span className="text-slate-500">{describePayload(event.payload)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Stage">
            {canEdit ? (
              <StageControl
                leadId={lead.id}
                allowed={[...detail.allowedNextStages]}
                reasonRequiredFor={[...detail.reasonRequiredFor]}
              />
            ) : (
              <p className="text-sm text-slate-500">Read-only.</p>
            )}
          </Card>

          <Card title="Notes">
            {canEdit ? <NoteForm leadId={lead.id} /> : null}
            <ul className="mt-3 space-y-3 text-sm">
              {detail.notes.map((note) => (
                <li key={note.id}>
                  <p className="whitespace-pre-wrap">{note.body}</p>
                  <p className="text-xs text-slate-500">
                    {note.authorName ?? 'Unknown'} · {formatDate(note.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Consent">
            <ul className="space-y-1 text-sm">
              {detail.consents.length === 0 ? (
                <li className="text-slate-500">No consent recorded.</li>
              ) : (
                detail.consents.map((c) => (
                  <li key={c.id}>
                    {c.channel} · {c.purpose}:{' '}
                    <span className={c.status === 'granted' ? 'text-green-700' : 'text-red-700'}>
                      {c.status}
                    </span>{' '}
                    <span className="text-slate-500">
                      ({c.source}, {formatDate(c.createdAt)})
                    </span>
                  </li>
                ))
              )}
            </ul>
            {canEdit ? <ConsentForm leadId={lead.id} /> : null}
          </Card>

          <Card title="Attribution">
            <ul className="space-y-2 text-sm">
              {detail.touchpoints.length === 0 ? (
                <li className="text-slate-500">No touchpoints.</li>
              ) : (
                detail.touchpoints.map((t) => (
                  <li key={t.id}>
                    <span className="font-medium">{t.source ?? t.channel}</span>
                    {t.medium ? ` / ${t.medium}` : ''}
                    {t.campaign ? ` / ${t.campaign}` : ''}
                    {t.id === lead.firstTouchId ? ' · first touch' : ''}
                    {t.id === lead.lastTouchId ? ' · last touch' : ''}
                    <div className="text-xs text-slate-500">
                      {formatDate(t.occurredAt)}
                      {t.landingPage ? ` · ${t.landingPage}` : ''}
                    </div>
                  </li>
                ))
              )}
            </ul>
          </Card>

          {hasRole(user.role, 'admin') ? (
            <Card title="Data requests">
              <DataRequests
                leadId={lead.id}
                canErase={hasRole(user.role, 'owner') && !lead.erasedAt}
              />
              {canEdit ? <MergeForm targetLeadId={lead.id} /> : null}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function describePayload(payload: Record<string, unknown>): string {
  if (typeof payload.from === 'string' && typeof payload.to === 'string') {
    return `${payload.from} → ${payload.to}`;
  }
  if (Array.isArray(payload.fields) && payload.fields.length > 0) {
    return payload.fields.join(', ');
  }
  if (typeof payload.channel === 'string' && typeof payload.status === 'string') {
    return `${payload.channel} ${payload.purpose ?? ''} ${payload.status}`;
  }
  return '';
}
