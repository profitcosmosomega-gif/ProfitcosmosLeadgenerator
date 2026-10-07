import { describe, expect, it } from 'vitest';
import type { LeadQualification, Message } from '@/db/schema';
import { accountUsage, costMicroUsd } from '@/modules/agent/runs';
import {
  emptyEffects,
  executeTool,
  leadContextSnapshot,
  locateQuote,
  type ToolContext,
} from '@/modules/agent/tools';

const message = (id: string, body: string, author: Message['author'] = 'lead') =>
  ({ id, body, author }) as Message;

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    leadMessages: [message('m1', 'Hello'), message('m2', 'I’m   a Beginner, keen on “forex”.')],
    triggerMessageId: 'm2',
    qualification: null,
    conversationMessageIds: new Set(['m1', 'm2']),
    contactKnown: { fullName: false, phone: false, country: false, timezone: false },
    ...overrides,
  };
}

describe('locateQuote', () => {
  it('finds quotes ignoring case, spacing and typographic quotes, newest message first', () => {
    const msgs = context().leadMessages;
    const found = locateQuote(msgs, 'i\'m a beginner, keen on "forex"');
    expect(found).toEqual({ messageId: 'm2', start: 0, end: msgs[1]!.body!.length - 1 });
    expect(locateQuote(msgs, 'expert trader')).toBeNull();
    expect(locateQuote([message('a1', 'I am a beginner', 'ai')], 'I am a beginner')).toBeNull();
  });
});

describe('executeTool', () => {
  it('records qualification with evidence offsets', () => {
    const effects = emptyEffects();
    const outcome = executeTool(
      'record_qualification',
      { fields: { experienceLevel: 'beginner' }, quote: 'a beginner' },
      context(),
      effects,
    );
    expect(outcome.record).toEqual({ name: 'record_qualification', outcome: 'accepted' });
    expect(effects.qualification).toEqual({ experienceLevel: 'beginner' });
    expect(effects.qualificationEvidence.experienceLevel).toMatchObject({ messageId: 'm2' });
  });

  it('protects staff, form, import and unsourced values but replaces earlier AI values', () => {
    for (const source of ['staff', 'form', 'import', 'chat', undefined] as const) {
      const qualification = {
        experienceLevel: 'experienced',
        evidence: source ? { experienceLevel: { source, at: '2026-01-01' } } : {},
      } as unknown as LeadQualification;
      const effects = emptyEffects();
      const outcome = executeTool(
        'record_qualification',
        { fields: { experienceLevel: 'beginner' }, quote: 'a beginner' },
        context({ qualification }),
        effects,
      );
      expect(outcome.record.code).toBe('already_known');
      expect(effects.qualification).toEqual({});
    }
    const fromAi = {
      experienceLevel: 'experienced',
      evidence: { experienceLevel: { source: 'ai', at: '2026-01-01' } },
    } as unknown as LeadQualification;
    const effects = emptyEffects();
    executeTool(
      'record_qualification',
      { fields: { experienceLevel: 'beginner' }, quote: 'a beginner' },
      context({ qualification: fromAi }),
      effects,
    );
    expect(effects.qualification).toEqual({ experienceLevel: 'beginner' });
  });

  it('validates inputs strictly', () => {
    const cases: [string, unknown][] = [
      ['record_qualification', { fields: {}, quote: 'a beginner' }],
      ['record_qualification', { fields: { experienceLevel: 'pro' }, quote: 'a beginner' }],
      ['record_qualification', { fields: { goals: [] }, quote: 'a beginner' }],
      ['update_contact', { phone: '12', quote: 'Hello' }],
      ['update_contact', { timezone: 'Mars/Base', quote: 'Hello' }],
      ['request_human', { reason: 'bored' }],
      ['get_lead_context', { leadId: 'someone-else' }],
    ];
    for (const [name, input] of cases) {
      expect(executeTool(name, input, context(), emptyEffects()).record.outcome).toBe('invalid');
    }
    expect(executeTool('delete_lead', {}, context(), emptyEffects()).record.outcome).toBe(
      'unknown_tool',
    );
  });

  it('never fills contact details that are already known', () => {
    const effects = emptyEffects();
    const outcome = executeTool(
      'update_contact',
      { country: 'gb', timezone: 'Europe/London', quote: 'Hello' },
      context({ contactKnown: { fullName: false, phone: false, country: true, timezone: false } }),
      effects,
    );
    expect(outcome.record.outcome).toBe('accepted');
    expect(effects.contact).toEqual({ timezone: 'Europe/London' });
  });

  it('request_human records each reason once', () => {
    const effects = emptyEffects();
    executeTool('request_human', { reason: 'cannot_confirm' }, context(), effects);
    executeTool('request_human', { reason: 'cannot_confirm' }, context(), effects);
    expect(effects.escalations).toEqual([{ reason: 'cannot_confirm', messageId: 'm2' }]);
  });

  it('context snapshot withholds values known from other sources', () => {
    const qualification = {
      goals: ['pay off debt'],
      experienceLevel: 'beginner',
      evidence: {
        goals: { source: 'form', at: '2026-01-01' },
        experienceLevel: { source: 'ai', at: '2026-01-01', messageId: 'm1' },
      },
    } as unknown as LeadQualification;
    const snapshot = leadContextSnapshot(context({ qualification }), emptyEffects());
    expect(snapshot.knownElsewhere).toEqual(['goals']);
    expect(snapshot.collected).toEqual({ experienceLevel: 'beginner' });
    expect(JSON.stringify(snapshot)).not.toContain('pay off debt');
  });
});

describe('cost accounting', () => {
  it('prices known models and leaves unknown ones null', () => {
    expect(costMicroUsd('claude-opus-5-5', { inputTokens: 1000, outputTokens: 100 })).toBe(
      1000 * 4 + 100 * 20,
    );
    expect(costMicroUsd('mystery-model', { inputTokens: 10, outputTokens: 10 })).toBeNull();
  });
  it('rejects malformed usage', () => {
    expect(() => accountUsage('claude-opus-5-5', { inputTokens: -1, outputTokens: 0 })).toThrow();
    expect(() => accountUsage('claude-opus-5-5', { inputTokens: 1.5, outputTokens: 0 })).toThrow();
  });
});
