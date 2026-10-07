import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { Card, formatDate } from '@/components/ui';
import { getDb } from '@/db/client';
import { requirePageUser } from '@/lib/admin-session';
import { AppError } from '@/lib/errors';
import { hasRole } from '@/lib/rbac';
import { getConversationDetail } from '@/modules/conversations/service';
import { PauseToggle, ResolveButton } from './conversation-actions';

export const metadata = { title: 'Conversation · ProfitCosmos Omega' };

const REASON_LABELS: Record<string, string> = {
  human_requested: 'Asked for a person',
  cannot_confirm: 'Question the assistant cannot confirm',
  sensitive_topic: 'Sensitive topic',
  possible_underage: 'May be under 18',
  abusive: 'Abusive messages',
  guardrail_failure: 'Reply blocked by the checks',
  ai_error: 'Assistant error',
  limit_reached: 'Usage limit reached',
};

const usd = (micro: number | null) => (micro === null ? '—' : `$${(micro / 1e6).toFixed(4)}`);

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  let detail: Awaited<ReturnType<typeof getConversationDetail>>;
  try {
    detail = await getConversationDetail(getDb(), user.organizationId, id);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
  const { conversation, messages, aiRuns, escalations } = detail;
  const canAct = hasRole(user.role, 'sales');

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/admin/leads/${conversation.leadId}`} className="text-sm text-slate-500">
          ← Lead
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">
            {conversation.channel} chat · {formatDate(conversation.createdAt)}
          </h1>
          <span className="text-sm text-slate-500">
            {conversation.status}
            {conversation.aiPaused ? ' · AI paused' : ' · AI on'}
          </span>
          {canAct && conversation.status === 'active' ? (
            <PauseToggle conversationId={conversation.id} paused={conversation.aiPaused} />
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Transcript">
            <ol className="space-y-3 text-sm">
              {messages.map((m) => (
                <li
                  key={m.id}
                  className={`rounded-md border px-3 py-2 ${
                    m.status === 'blocked'
                      ? 'border-red-200 bg-red-50'
                      : m.author === 'lead'
                        ? 'border-slate-200 bg-white'
                        : 'border-indigo-100 bg-indigo-50'
                  }`}
                >
                  <div className="mb-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
                    <span className="font-medium">
                      {m.author === 'lead'
                        ? 'Prospect'
                        : m.author === 'ai'
                          ? 'Assistant'
                          : 'System'}
                    </span>
                    <span>{formatDate(m.createdAt)}</span>
                    {m.status === 'blocked' ? <span>blocked, not sent</span> : null}
                    {m.guardrail?.fallback ? <span>fixed fallback reply</span> : null}
                    {m.guardrail && m.guardrail.failures.length > 0 ? (
                      <span>checks: {m.guardrail.failures.join(', ')}</span>
                    ) : null}
                    {m.promptId ? (
                      <span>
                        {m.promptId}@{m.promptVersion}
                      </span>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap">
                    {m.body ??
                      (m.status === 'blocked'
                        ? '(not stored: possible disclosure of internal instructions)'
                        : '(erased)')}
                  </p>
                </li>
              ))}
            </ol>
          </Card>

          <Card title="AI runs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-1 pr-3">Time</th>
                    <th className="py-1 pr-3">Purpose</th>
                    <th className="py-1 pr-3">Status</th>
                    <th className="py-1 pr-3">Model / prompt</th>
                    <th className="py-1 pr-3">Tokens in/out</th>
                    <th className="py-1 pr-3">Cost</th>
                    <th className="py-1 pr-3">Tools / flags</th>
                  </tr>
                </thead>
                <tbody>
                  {aiRuns.map((run) => (
                    <tr key={run.id} className="border-t border-slate-100 align-top">
                      <td className="py-1 pr-3">{formatDate(run.createdAt)}</td>
                      <td className="py-1 pr-3">{run.purpose}</td>
                      <td className="py-1 pr-3">
                        {run.status}
                        {run.reason ? ` (${run.reason})` : ''}
                        {run.errorCode ? ` [${run.errorCode}]` : ''}
                      </td>
                      <td className="py-1 pr-3">
                        {run.model ?? '—'}
                        {run.promptId ? ` · ${run.promptId}@${run.promptVersion}` : ''}
                      </td>
                      <td className="py-1 pr-3">
                        {run.inputTokens}/{run.outputTokens}
                      </td>
                      <td className="py-1 pr-3">{usd(run.costMicroUsd)}</td>
                      <td className="py-1 pr-3">
                        {[...run.toolCalls.map((t) => `${t.name}:${t.outcome}`), ...run.flags].join(
                          ', ',
                        ) || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Needs a human">
            {escalations.length === 0 ? (
              <p className="text-sm text-slate-500">No flags.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {escalations.map((e) => (
                  <li key={e.id}>
                    <p className="font-medium">{REASON_LABELS[e.reason] ?? e.reason}</p>
                    <p className="text-xs text-slate-500">
                      {formatDate(e.createdAt)} ·{' '}
                      {e.status === 'open'
                        ? 'open'
                        : `resolved by ${e.resolvedByName ?? 'staff'}${
                            e.resolvedAt ? ` on ${formatDate(e.resolvedAt)}` : ''
                          }`}
                    </p>
                    {canAct && e.status === 'open' ? <ResolveButton escalationId={e.id} /> : null}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-slate-500">
              Resolving a flag does not switch the assistant back on; use “Resume AI”.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
