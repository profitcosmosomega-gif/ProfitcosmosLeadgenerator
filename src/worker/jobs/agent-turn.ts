import { z } from 'zod';
import { getDb } from '@/db/client';
import { defaultAgentDeps, runAgentTurns } from '@/modules/agent/pipeline';
import { AGENT_TURN_JOB } from '@/modules/agent/queue';
import { defineJob } from './types';

/**
 * Answers a conversation's unhandled lead messages. Another worker already holding the
 * conversation makes the job fail and retry, so a message that arrived meanwhile is not missed.
 */
export const agentTurnJob = defineJob({
  name: AGENT_TURN_JOB,
  schema: z.object({ organizationId: z.uuid(), conversationId: z.uuid() }),
  retryLimit: 5,
  handler: async (data, { log }) => {
    const result = await runAgentTurns(getDb(), defaultAgentDeps(), data);
    if (result.status === 'busy') throw new Error('conversation busy');
    for (const turn of result.turns) {
      log.info({ conversationId: data.conversationId, ...turn }, 'agent turn');
    }
  },
});
