import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CURRENT_CONSENT_WORDING } from '@config/consent';
import * as messagesRoute from '@/app/api/public/conversations/[id]/messages/route';
import * as startRoute from '@/app/api/public/conversations/route';
import * as conversationRoute from '@/app/api/v1/conversations/[id]/route';
import * as pauseRoute from '@/app/api/v1/conversations/[id]/pause/route';
import * as resumeRoute from '@/app/api/v1/conversations/[id]/resume/route';
import * as resolveRoute from '@/app/api/v1/escalations/[id]/resolve/route';
import * as leadConversationsRoute from '@/app/api/v1/leads/[id]/conversations/route';
import * as leadRoute from '@/app/api/v1/leads/[id]/route';
import * as exportRoute from '@/app/api/v1/leads/[id]/export/route';
import * as leadsRoute from '@/app/api/v1/leads/route';
import { closeDb, getDb } from '@/db/client';
import { conversations, leads, messages } from '@/db/schema';
import { publicFormLimiter, resetSharedLimiters } from '@/lib/rate-limit';
import { setAgentTurnSender, type AgentTurnRequest } from '@/modules/agent/queue';
import { addToSuppressionList } from '@/modules/consents/service';
import { createEscalation } from '@/modules/conversations/service';
import { as, call, clearSessions } from '../helpers/http';
import { createOrg, createStaff, resetDb } from '../helpers/db';

let orgA: string;
let ip = 0;
const enqueued: AgentTurnRequest[] = [];

beforeAll(async () => {
  await resetDb();
  clearSessions();
  orgA = (await createOrg()).id;
  const orgB = (await createOrg('other-academy')).id;
  for (const role of ['viewer', 'sales', 'owner'] as const) await createStaff(role, orgA);
  await createStaff('owner', orgB, 'b-');
  setAgentTurnSender(async (request) => {
    enqueued.push(request);
  });
});
beforeEach(() => {
  publicFormLimiter().reset();
  resetSharedLimiters();
  enqueued.length = 0;
});
afterAll(async () => {
  setAgentTurnSender(null);
  await closeDb();
});

const preChat = (overrides: Record<string, unknown> = {}) => ({
  fullName: 'Chat Prospect',
  email: `chat${++ip}@example.test`,
  ageConfirmed18plus: true,
  consent: { wordingVersion: CURRENT_CONSENT_WORDING.version, marketingEmail: false },
  ...overrides,
});

function start(body: unknown, headers: Record<string, string> = {}) {
  return call(startRoute.POST, '/api/public/conversations', {
    method: 'POST',
    headers: { 'x-forwarded-for': `10.1.0.${++ip}`, ...headers },
    body,
  });
}

async function started(overrides: Record<string, unknown> = {}) {
  const res = await start(preChat(overrides));
  expect(res.status).toBe(201);
  return res.body.data as { conversationId: string; accessToken: string };
}

function send(id: string, token: string | null, body: unknown, ipAddr = `10.2.0.${++ip}`) {
  return call(messagesRoute.POST, `/api/public/conversations/${id}/messages`, {
    method: 'POST',
    params: { id },
    headers: {
      'x-forwarded-for': ipAddr,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body,
  });
}

function poll(id: string, token: string | null) {
  return call(messagesRoute.GET, `/api/public/conversations/${id}/messages`, {
    params: { id },
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}

describe('public chat API', () => {
  it('starts a conversation for an adult with a one-time token', async () => {
    const { conversationId, accessToken } = await started({ email: 'first@example.test' });
    expect(accessToken.length).toBeGreaterThan(30);
    const [conversation] = await getDb()
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    expect(conversation!.accessTokenHash).not.toContain(accessToken);
    const [lead] = await getDb().select().from(leads).where(eq(leads.id, conversation!.leadId));
    expect(lead).toMatchObject({ stage: 'NEW_LEAD', ageConfirmed18plus: true, source: null });
  });

  it('requires the 18+ confirmation and current consent wording', async () => {
    expect((await start(preChat({ ageConfirmed18plus: false }))).status).toBe(400);
    expect(
      (await start(preChat({ consent: { wordingVersion: 'old', marketingEmail: false } }))).status,
    ).toBe(400);
    expect((await start(preChat({ unknown: 'x' }))).status).toBe(400);
  });

  it('gives bots and suppressed contacts a neutral 202 and no conversation', async () => {
    expect((await start(preChat({ website: 'http://spam' }))).body).toEqual({
      data: { status: 'received' },
    });
    await addToSuppressionList(getDb(), orgA, { email: 'gone@example.test' }, 'test');
    const res = await start(preChat({ email: 'gone@example.test' }));
    expect(res.status).toBe(202);
    const rows = await getDb().select().from(leads).where(eq(leads.email, 'gone@example.test'));
    expect(rows).toHaveLength(0);
  });

  it('refuses other origins', async () => {
    expect((await start(preChat(), { origin: 'https://evil.example' })).status).toBe(403);
  });

  it('stores messages, applies NEW_LEAD → ENGAGED and asks the worker to answer', async () => {
    const { conversationId, accessToken } = await started();
    const res = await send(conversationId, accessToken, { text: '  Hello, I want to learn  ' });
    expect(res.status).toBe(201);
    expect(enqueued).toEqual([{ organizationId: orgA, conversationId }]);

    const listed = await poll(conversationId, accessToken);
    expect(listed.status).toBe(200);
    expect(listed.headers.get('cache-control')).toBe('no-store');
    expect(listed.body.data).toMatchObject({
      messages: [{ author: 'lead', text: 'Hello, I want to learn' }],
      open: true,
      // AI is off in tests: the page shows the "team will follow up" notice.
      assistantAvailable: false,
      awaitingReply: false,
    });
    const [conversation] = await getDb()
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    const [lead] = await getDb().select().from(leads).where(eq(leads.id, conversation!.leadId));
    expect(lead!.stage).toBe('ENGAGED');
  });

  it('hides blocked drafts from the prospect', async () => {
    const { conversationId, accessToken } = await started();
    await send(conversationId, accessToken, { text: 'Hi' });
    const [conversation] = await getDb()
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    await getDb()
      .insert(messages)
      .values([
        {
          organizationId: orgA,
          conversationId,
          leadId: conversation!.leadId,
          direction: 'out',
          author: 'ai',
          status: 'blocked',
          body: 'blocked draft',
        },
      ]);
    const listed = await poll(conversationId, accessToken);
    expect(JSON.stringify(listed.body)).not.toContain('blocked draft');
  });

  it('rejects wrong, missing or cross-conversation tokens with 404', async () => {
    const a = await started();
    const b = await started();
    expect((await send(a.conversationId, null, { text: 'x' })).status).toBe(404);
    expect((await send(a.conversationId, 'x'.repeat(43), { text: 'x' })).status).toBe(404);
    expect((await send(a.conversationId, b.accessToken, { text: 'x' })).status).toBe(404);
    expect((await poll(a.conversationId, b.accessToken)).status).toBe(404);
    expect((await poll('not-a-uuid', a.accessToken)).status).toBe(404);
    expect(enqueued).toHaveLength(0);
  });

  it('validates message size and rate-limits per conversation', async () => {
    const { conversationId, accessToken } = await started();
    expect((await send(conversationId, accessToken, { text: '' })).status).toBe(400);
    expect((await send(conversationId, accessToken, { text: 'x'.repeat(2001) })).status).toBe(400);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await send(conversationId, accessToken, { text: `m${i}` })).status);
    }
    expect(statuses.filter((s) => s === 201)).toHaveLength(8);
    expect(statuses.at(-1)).toBe(429);
  });

  it('refuses messages in a closed conversation', async () => {
    const { conversationId, accessToken } = await started();
    await getDb()
      .update(conversations)
      .set({ status: 'closed' })
      .where(eq(conversations.id, conversationId));
    expect((await send(conversationId, accessToken, { text: 'Hi' })).status).toBe(409);
  });
});

describe('staff conversation API', () => {
  async function chatWithFlag() {
    const { conversationId, accessToken } = await started();
    await send(conversationId, accessToken, { text: 'I need a human' });
    const [conversation] = await getDb()
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    const escalation = await createEscalation(getDb(), conversation!, {
      reason: 'human_requested',
      messageId: null,
      aiRunId: null,
      actor: { type: 'system' },
    });
    return { conversation: conversation!, escalation: escalation! };
  }

  it('viewers read conversations; detail never exposes the token hash', async () => {
    const { conversation } = await chatWithFlag();
    const viewer = await as('viewer@example.test');
    const list = await call(
      leadConversationsRoute.GET,
      `/api/v1/leads/${conversation.leadId}/conversations`,
      { params: { id: conversation.leadId }, headers: viewer },
    );
    expect(list.body.data).toMatchObject([
      { id: conversation.id, messageCount: 1, openEscalations: 1, aiPaused: true },
    ]);
    const detail = await call(conversationRoute.GET, `/api/v1/conversations/${conversation.id}`, {
      params: { id: conversation.id },
      headers: viewer,
    });
    expect(detail.status).toBe(200);
    expect(detail.body.data.messages[0]).toMatchObject({ author: 'lead', body: 'I need a human' });
    expect(detail.body.data.escalations[0]).toMatchObject({ reason: 'human_requested' });
    expect(JSON.stringify(detail.body)).not.toMatch(/accessTokenHash|processingUntil/);
  });

  it('lists leads with an open flag', async () => {
    const { conversation } = await chatWithFlag();
    const unflagged = await started();
    const [plain] = await getDb()
      .select()
      .from(conversations)
      .where(eq(conversations.id, unflagged.conversationId));
    const res = await call(leadsRoute.GET, '/api/v1/leads?escalation=open', {
      headers: await as('viewer@example.test'),
    });
    const ids = res.body.data.items.map((l: { id: string }) => l.id);
    expect(ids).toContain(conversation.leadId);
    expect(ids).not.toContain(plain!.leadId);
  });

  it('sales pause, resume and resolve; viewers cannot', async () => {
    const { conversation, escalation } = await chatWithFlag();
    const params = { id: conversation.id };
    const viewer = await as('viewer@example.test');
    const sales = await as('sales@example.test');
    expect(
      (await call(resumeRoute.POST, '/x', { method: 'POST', params, headers: viewer })).status,
    ).toBe(403);
    expect(
      (await call(resumeRoute.POST, '/x', { method: 'POST', params, headers: sales })).body.data,
    ).toEqual({ id: conversation.id, aiPaused: false });
    expect(
      (await call(pauseRoute.POST, '/x', { method: 'POST', params, headers: sales })).body.data,
    ).toEqual({ id: conversation.id, aiPaused: true });
    const resolved = await call(resolveRoute.POST, '/x', {
      method: 'POST',
      params: { id: escalation.id },
      headers: sales,
    });
    expect(resolved.body.data).toEqual({ id: escalation.id, status: 'resolved' });
  });

  it('hides other organizations conversations and flags (404)', async () => {
    const { conversation, escalation } = await chatWithFlag();
    const other = await as('b-owner@example.test');
    for (const [handler, id] of [
      [conversationRoute.GET, conversation.id],
      [leadConversationsRoute.GET, conversation.leadId],
    ] as const) {
      expect((await call(handler, '/x', { params: { id }, headers: other })).status).toBe(404);
    }
    for (const [handler, id] of [
      [pauseRoute.POST, conversation.id],
      [resumeRoute.POST, conversation.id],
      [resolveRoute.POST, escalation.id],
    ] as const) {
      expect(
        (await call(handler, '/x', { method: 'POST', params: { id }, headers: other })).status,
      ).toBe(404);
    }
  });

  it('exports conversations and erasure removes message text', async () => {
    const { conversation } = await chatWithFlag();
    const owner = await as('owner@example.test');
    const params = { id: conversation.leadId };
    const exported = await call(exportRoute.GET, '/x', { params, headers: owner });
    expect(JSON.stringify(exported.body.data.conversations)).toContain('I need a human');

    expect(
      (await call(leadRoute.DELETE, '/x', { method: 'DELETE', params, headers: owner })).status,
    ).toBe(200);
    const rows = await getDb()
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversation.id));
    expect(rows.every((m) => m.body === null)).toBe(true);
    const [closed] = await getDb()
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversation.id));
    expect(closed).toMatchObject({ status: 'closed', aiPaused: true });
  });
});
