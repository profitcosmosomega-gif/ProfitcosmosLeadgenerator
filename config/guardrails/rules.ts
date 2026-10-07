/*
 * Deterministic guardrail rules (Phase 3), English and French. Versioned: changing a pattern
 * means bumping `version` and re-running the evaluation suite.
 *
 * Output rules block a drafted AI reply. They target positive claims ("guaranteed profits"),
 * not honest disclaimers ("results are never guaranteed"). A false positive only costs a
 * regeneration or a safe fallback, so they lean strict.
 *
 * Input rules look at the lead's message before any model call.
 */

export interface GuardrailRule {
  code: string;
  description: string;
  patterns: readonly RegExp[];
  /**
   * Ignore a match that is negated in the same sentence ("results are never guaranteed").
   * `before`: a negation word just before the match; `before_and_match`: also inside it.
   */
  negatable?: 'before' | 'before_and_match';
}

export const OUTPUT_RULES_VERSION = '1.0.0';

export const outputRules: readonly GuardrailRule[] = [
  {
    code: 'guarantee',
    description: 'Guaranteed profits, returns, income or results',
    negatable: 'before_and_match',
    patterns: [
      /\bguarantee[sd]?\s+(?:you\s+)?(?:\w+\s+){0,2}(?:profits?|returns?|income|results?|gains?|earnings?|money|success)\b/i,
      /\b(?:profits?|returns?|income|results?|gains?|earnings?|success)\s+(?:is|are)\s+guaranteed\b/i,
      /\b(?:profits?|rendements?|revenus?|résultats?|gains?|succès)\s+(?:\w+\s+){0,2}garanti(?:e|s|es)?\b/i,
      /\bgarantit?\s+(?:des?\s+|les?\s+|un\s+)?(?:profits?|rendements?|revenus?|résultats?|gains?|succès)\b/i,
    ],
  },
  {
    code: 'risk_free',
    description: 'Risk-free or cannot-lose claims',
    negatable: 'before',
    patterns: [
      /\brisk[-\s]?free\b/i,
      /\b(?:no|zero|without)\s+risk\b(?![-\s]?free)/i,
      /\bcan(?:'|’)?t\s+lose\b|\bcannot\s+lose\b/i,
      /\bsans\s+(?:aucun\s+)?risques?\b/i,
      /\b(?:aucun|zéro)\s+risque\b/i,
      /\bne\s+pouvez\s+pas\s+perdre\b/i,
    ],
  },
  {
    code: 'earnings_claim',
    description: 'Promises of earnings, wealth or financial freedom',
    negatable: 'before',
    patterns: [
      /\byou(?:'|’)?(?:ll| will| can| could| are going to)\s+(?:easily\s+)?(?:make|earn|double|triple|grow|multiply)\b/i,
      /\b(?:financial\s+(?:freedom|independence)|get\s+rich|passive\s+income|replace\s+your\s+(?:salary|income))\b/i,
      /\bvous\s+(?:allez|pourrez|pouvez|gagnerez|ferez)\s+(?:\w+\s+){0,2}(?:gagner|doubler|tripler|multiplier|vous\s+enrichir)\b/i,
      /\b(?:liberté|indépendance)\s+financière\b|\bdevenir\s+riche\b|\brevenus?\s+passifs?\b/i,
    ],
  },
  {
    code: 'money_figure',
    description: 'Amounts of money, prices, returns or percentages',
    patterns: [
      /[$€£¥]\s?\d/,
      /\d[\d,.\s]*\s?(?:%|percent|pour\s?cent|\$|€|£|usd|eur|gbp|dollars?|euros?|pounds?)(?![a-z])/i,
      /\b\d+(?:[.,]\d+)?\s?k\s?(?:\/|per|a|par)\s?(?:month|week|day|year|mois|semaine|jour|an)\b/i,
    ],
  },
  {
    code: 'trade_instruction',
    description: 'Telling the prospect what or when to trade',
    negatable: 'before',
    patterns: [
      /\b(?:you\s+should|i(?:'|’)?d\s+(?:recommend|suggest)|i\s+(?:recommend|suggest)|my\s+advice\s+is\s+to)\s+(?:\w+\s+){0,2}(?:buy|sell|short|go\s+long|invest|trade|open\s+a\s+position)\b/i,
      /\b(?:buy|sell)\s+(?:now|today|signal|at\s+\d)/i,
      /\b(?:stop[-\s]?loss|take[-\s]?profit|entry\s+(?:point|price))\s+(?:at|of|around)\s+\d/i,
      /\b(?:achetez|vendez|investissez)\b/i,
      /\bje\s+vous\s+(?:conseille|recommande|suggère)\s+d(?:'|’|e\s+)(?:acheter|vendre|investir|trader|shorter)\b/i,
    ],
  },
  {
    code: 'human_claim',
    description: 'Claiming to be a person',
    negatable: 'before',
    patterns: [
      /\b(?:i\s+am|i(?:'|’)m)\s+(?:a\s+)?(?:real\s+)?(?:human|person)\b/i,
      /\b(?:i\s+am|i(?:'|’)m)\s+not\s+an?\s+(?:ai|bot|robot|assistant)\b/i,
      /\bje\s+suis\s+(?:un\s+|une\s+)?(?:vraie?\s+)?(?:humain|humaine|personne)\b/i,
      /\bje\s+ne\s+suis\s+pas\s+(?:une?\s+)?(?:ia|robot|bot|intelligence\s+artificielle)\b/i,
    ],
  },
];

export const INPUT_RULES_VERSION = '1.0.0';

/** The lead says they are under 18: the AI stops and staff are flagged before any model call. */
export const underageRule: GuardrailRule = {
  code: 'possible_underage',
  description: 'Lead states an age under 18',
  patterns: [
    /\b(?:1[0-7]|[1-9])\s*(?:years?\s+old|yrs?\s+old|y\/o|yo)\b/i,
    /\b(?:i\s+am|i(?:'|’)m|im)\s+(?:only\s+)?(?:1[0-7])\b(?!\s*(?:minutes?|mins?|hours?|%|k\b|\$|years?\s+(?:of|in|trading)))/i,
    /\b(?:i\s+am|i(?:'|’)m|im)\s+(?:under|not)\s+18\b|\bunder\s+(?:the\s+age\s+of\s+)?18\b/i,
    /\b(?:i\s+am|i(?:'|’)m|im)\s+(?:still\s+)?a\s+minor\b/i,
    /\bj(?:'|’)?\s?ai\s+(?:seulement\s+)?(?:1[0-7]|[1-9])\s+ans\b(?!\s+d)/i,
    /\bmoins\s+de\s+18\s+ans\b|\bje\s+suis\s+(?:encore\s+)?mineure?\b/i,
  ],
};

/** Common prompt-injection phrasings. Only recorded as a flag; the guardrails stop any effect. */
export const injectionRule: GuardrailRule = {
  code: 'injection_suspected',
  description: 'Message tries to change or reveal the assistant instructions',
  patterns: [
    /\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+)?(?:the\s+|your\s+)?(?:previous|prior|above|earlier)?\s*(?:instructions|rules|prompts?)\b/i,
    /\b(?:system|developer)\s+(?:prompt|message|instructions)\b/i,
    /\byou\s+are\s+now\b|\bact\s+as\b|\bjailbreak\b|\bDAN\b|\bdeveloper\s+mode\b/i,
    /\b(?:reveal|print|show|repeat)\s+(?:me\s+)?(?:your|the)\s+(?:instructions|prompt|rules|configuration)\b/i,
    /\bignore[rz]?\s+(?:toutes\s+)?(?:les\s+|tes\s+|vos\s+)?(?:instructions|consignes|règles)\b/i,
    /\b(?:montre|affiche|révèle|répète)[sz]?\s+(?:moi\s+)?(?:tes|vos|les)\s+(?:instructions|consignes|règles)\b/i,
    /<\/?(?:system|instructions?|assistant)>/i,
  ],
};

const NEGATION =
  /\b(?:not|never|no|cannot|can(?:'|’)t|won(?:'|’)t|don(?:'|’)t|doesn(?:'|’)t|isn(?:'|’)t|aren(?:'|’)t|nobody|no\s+one|nothing|ne|n(?:'|’)|pas|jamais|aucun|aucune|personne\s+ne)\b/i;

/** Text from the start of the sentence containing `index` up to `index`. */
function sentenceBefore(text: string, index: number): string {
  const before = text.slice(Math.max(0, index - 80), index);
  const cut = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'));
  return cut === -1 ? before : before.slice(cut + 1);
}

/** True if any pattern of the rule matches `text` in a way that is not negated. */
export function matchRule(rule: GuardrailRule, text: string): boolean {
  for (const pattern of rule.patterns) {
    const global = new RegExp(
      pattern.source,
      pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
    );
    for (const match of text.matchAll(global)) {
      if (!rule.negatable) return true;
      const before = sentenceBefore(text, match.index);
      const scope = rule.negatable === 'before_and_match' ? `${before} ${match[0]}` : before;
      if (!NEGATION.test(scope)) return true;
    }
  }
  return false;
}
