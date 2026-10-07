import type { PgBoss } from 'pg-boss';
import { getEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { createBoss } from '@/lib/queue';

export const AGENT_TURN_JOB = 'agent.turn';

export interface AgentTurnRequest {
  organizationId: string;
  conversationId: string;
}

type Sender = (request: AgentTurnRequest) => Promise<void>;

let boss: Promise<PgBoss> | null = null;
let override: Sender | null = null;

/** Send-only queue client for the web process: no maintenance, no schedules, no migrations. */
async function senderBoss(): Promise<PgBoss> {
  boss ??= (async () => {
    const instance = createBoss(getEnv().DATABASE_URL, { sendOnly: true });
    await instance.start();
    // Same options as the worker so whichever process creates the queue first gets them.
    await instance.createQueue(AGENT_TURN_JOB, { retryLimit: 5, retryBackoff: true });
    return instance;
  })().catch((error: unknown) => {
    boss = null;
    throw error;
  });
  return boss;
}

/**
 * Ask the worker to answer a conversation. A failure is logged, not thrown: the message is
 * already stored as unhandled and the next message or a staff action picks it up.
 */
export async function requestAgentTurn(request: AgentTurnRequest): Promise<void> {
  try {
    if (override) return await override(request);
    const instance = await senderBoss();
    await instance.send(AGENT_TURN_JOB, { ...request });
  } catch (err) {
    logger.error({ err, conversationId: request.conversationId }, 'agent turn enqueue failed');
  }
}

/** Test hook: replace the queue with a function (null restores it). */
export function setAgentTurnSender(sender: Sender | null): void {
  override = sender;
}
