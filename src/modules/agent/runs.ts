import { and, eq, gte, ne, sql } from 'drizzle-orm';
import { llmPricing } from '@config/ai';
import type { DbExecutor } from '@/db/client';
import { aiRuns, type AiRun, type NewAiRun } from '@/db/schema';
import { newId } from '@/lib/ids';
import type { LlmUsage } from '@/providers/llm/types';

/**
 * Cost of one call in millionths of a US dollar, or null when the model's price is unknown.
 * Never estimated: an unknown price stays unknown.
 */
/** Price for a model id or its dated variant (`<alias>-YYYYMMDD`). */
export function priceFor(model: string) {
  return llmPricing[model] ?? llmPricing[model.replace(/-\d{8}$/, '')] ?? null;
}

export function costMicroUsd(model: string | null | undefined, usage: LlmUsage): number | null {
  if (!model) return null;
  const price = priceFor(model);
  if (!price) return null;
  const micro =
    usage.inputTokens * price.input +
    usage.outputTokens * price.output +
    (usage.cacheReadTokens ?? 0) * price.cacheRead +
    (usage.cacheWriteTokens ?? 0) * price.cacheWrite;
  // price is $ per million tokens, so tokens × price is already micro-dollars.
  if (!Number.isFinite(micro) || micro < 0) throw new Error('Invalid AI cost computation');
  return Math.round(micro);
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 2 ** 31;

/** Token counts and cost for an `ai_runs` row. Throws on malformed usage (fail closed). */
export function accountUsage(model: string | null | undefined, usage: LlmUsage) {
  const counts = {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
  };
  if (!Object.values(counts).every(isCount)) throw new Error('Invalid AI usage counts');
  return { ...counts, costMicroUsd: costMicroUsd(model, usage) };
}

export type AiRunInput = Omit<NewAiRun, 'id' | 'createdAt'> & { id?: string };

/**
 * Record one LLM call (or a skipped turn). Written before anything is sent to the lead, so a
 * failure here stops the turn (fail closed). Stores metadata only — no prompt or reply text.
 */
export async function recordAiRun(db: DbExecutor, input: AiRunInput): Promise<AiRun> {
  const [run] = await db
    .insert(aiRuns)
    .values({ ...input, id: input.id ?? newId() })
    .returning();
  return run!;
}

/** AI turns (model calls for replies) for a lead since a time; skipped turns don't count. */
export async function countLeadTurnsSince(
  db: DbExecutor,
  organizationId: string,
  leadId: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiRuns)
    .where(
      and(
        eq(aiRuns.organizationId, organizationId),
        eq(aiRuns.leadId, leadId),
        eq(aiRuns.purpose, 'turn'),
        ne(aiRuns.status, 'skipped'),
        gte(aiRuns.createdAt, since),
      ),
    );
  return row?.count ?? 0;
}

/** Input + output tokens the organisation spent since a time (all AI calls). */
export async function organizationTokensSince(
  db: DbExecutor,
  organizationId: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${aiRuns.inputTokens} + ${aiRuns.outputTokens} + ${aiRuns.cacheReadTokens} + ${aiRuns.cacheWriteTokens}), 0)::int`,
    })
    .from(aiRuns)
    .where(and(eq(aiRuns.organizationId, organizationId), gte(aiRuns.createdAt, since)));
  return row?.total ?? 0;
}

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Recorded AI cost of the organisation since a time, in micro-dollars (unknown costs excluded). */
export async function organizationCostSince(
  db: DbExecutor,
  organizationId: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${aiRuns.costMicroUsd}), 0)::bigint` })
    .from(aiRuns)
    .where(and(eq(aiRuns.organizationId, organizationId), gte(aiRuns.createdAt, since)));
  return Number(row?.total ?? 0);
}

export function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
