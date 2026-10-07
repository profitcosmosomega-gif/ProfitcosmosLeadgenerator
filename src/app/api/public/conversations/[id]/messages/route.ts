import { aiConfig } from '@config/ai';
import { getDb } from '@/db/client';
import { apiHandler, json, parseQuery, routeId } from '@/lib/api';
import { Errors } from '@/lib/errors';
import { assertAllowedOrigin, clientIp, preflight, readJsonBody, withCors } from '@/lib/public-api';
import { sharedLimiter } from '@/lib/rate-limit';
import { assistantAvailable, defaultAgentDeps } from '@/modules/agent/pipeline';
import { requestAgentTurn } from '@/modules/agent/queue';
import {
  bearerToken,
  listMessagesQuery,
  sendMessageInput,
} from '@/modules/conversations/public-schema';
import {
  addLeadMessage,
  findConversationByToken,
  hasUnhandledMessages,
  listPublicMessages,
} from '@/modules/conversations/service';
import { getDefaultOrganization } from '@/modules/organizations/service';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8_192;
const noStore = { 'cache-control': 'no-store' };

function limit(name: string, key: string, perMinute: number) {
  if (!sharedLimiter(name, perMinute).take(key)) throw Errors.rateLimited();
}

async function load(req: Request, route: { params: Promise<Record<string, string | string[]>> }) {
  assertAllowedOrigin(req);
  limit('public-chat-ip', clientIp(req), aiConfig.publicChatMessagesPerMinute * 6);
  const conversationId = await routeId(route);
  const db = getDb();
  const organization = await getDefaultOrganization(db);
  const conversation = await findConversationByToken(
    db,
    organization.id,
    conversationId,
    bearerToken(req),
  );
  return { db, conversation };
}

/** The lead sends a message. It is stored, then the worker is asked to answer it. */
const send = apiHandler(async (req, { requestId }, route) => {
  const { db, conversation } = await load(req, route);
  limit('public-chat-conversation', conversation.id, aiConfig.publicChatMessagesPerMinute);
  const input = sendMessageInput.parse(await readJsonBody(req, MAX_BODY_BYTES));
  const message = await addLeadMessage(db, { conversation, text: input.text, requestId });
  await requestAgentTurn({
    organizationId: conversation.organizationId,
    conversationId: conversation.id,
  });
  return json({ id: message.id, createdAt: message.createdAt }, { status: 201, headers: noStore });
});

/** The chat page polls this for new messages and whether a reply is on its way. */
const list = apiHandler(async (req, _ctx, route) => {
  const { db, conversation } = await load(req, route);
  const { after } = parseQuery(req, listMessagesQuery);
  const [messages, available, pending] = await Promise.all([
    listPublicMessages(db, conversation, after),
    assistantAvailable(db, defaultAgentDeps(), conversation),
    hasUnhandledMessages(db, conversation.id),
  ]);
  return json(
    {
      messages,
      open: conversation.status === 'active',
      assistantAvailable: available,
      awaitingReply: available && pending,
    },
    { headers: noStore },
  );
});

type Route = { params: Promise<Record<string, string>> };

export async function POST(req: Request, route: Route) {
  return withCors(req, await send(req, route));
}

export async function GET(req: Request, route: Route) {
  return withCors(req, await list(req, route));
}

export async function OPTIONS(req: Request) {
  return preflight(req, 'GET, POST, OPTIONS', 'content-type, authorization');
}
