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

/**
 * Always-escalate topics (founder answer to business question 14). A lead message matching one of
 * these flags the conversation for the team and pauses the AI before any model call, so the AI
 * never tries to resolve them. The prompt asks the model to hand over too; this is the backstop.
 * Leans broad: a false positive only hands a conversation to a person.
 */
export interface EscalationTopicRule extends GuardrailRule {
  reason: 'human_requested' | 'sensitive_topic';
}

export const ESCALATION_TOPICS_VERSION = '1.0.0';

export const escalationTopicRules: readonly EscalationTopicRule[] = [
  {
    code: 'human_request',
    reason: 'human_requested',
    description: 'Asks to talk to a person',
    patterns: [
      /\b(?:talk|speak|chat)\s+(?:to|with)\s+(?:a\s+|an\s+|someone|somebody|a\s+real|your)?\s*(?:real\s+)?(?:human|person|agent|advisor|adviser|representative|someone|somebody|team|staff|people)\b/i,
      /\b(?:real|actual)\s+(?:human|person)\b/i,
      /\bparler\s+(?:à|a|avec)\s+(?:un\s+|une\s+|votre\s+|l(?:'|’))?(?:vrai(?:e)?\s+)?(?:humain|personne|conseill(?:er|ère)|agent|équipe|représentant(?:e)?|quelqu(?:'|’)un)\b/i,
      /\b(?:vrai(?:e)?\s+)(?:humain|personne)\b/i,
    ],
  },
  {
    code: 'refund_cancellation',
    reason: 'sensitive_topic',
    description: 'Refunds or cancellations',
    patterns: [
      /\brefund(?:s|ed|ing)?\b|\bmoney\s+back\b|\bcancel(?:l?ation|l?ed|l?ing|s)?\b|\bunsubscribe\b/i,
      /\brembours\w*|\bannul(?:er|ation|ée|é)|\brésili\w*|\bdésabonn\w*/i,
    ],
  },
  {
    code: 'payment',
    reason: 'sensitive_topic',
    description: 'Payments, financing, discounts or promotions',
    patterns: [
      /\bpayments?\b|\bpay(?:ing)?\s+(?:for|in|by|with|monthly)\b|\bhow\s+(?:do|can)\s+i\s+pay\b|\bfinanc(?:ing|e\s+plan)\b|\binstall?ments?\b|\bcredit\s+card\b|\binvoice\b|\bcharged\b/i,
      /\bdiscounts?\b|\bpromo(?:tions?|\s+codes?)?\b|\bcoupons?\b/i,
      /\bpaiements?\b|\bpayer\b|\bfinancement\b|\bversements?\b|\bcarte\s+de\s+crédit\b|\bfacture\b/i,
      /\brabais\b|\bréductions?\b|\bcode\s+promo\b|\bpromotions?\b|\bcoupons?\b/i,
    ],
  },
  {
    code: 'complaint_dispute',
    reason: 'sensitive_topic',
    description: 'Complaints or disputes',
    patterns: [
      /\bcomplain(?:t|ts|ing|ed)?\b|\bdisputes?\b|\bchargebacks?\b/i,
      /\bplaintes?\b|\bme\s+plaindre\b|\blitiges?\b|\bcontest(?:er|ation)\b/i,
    ],
  },
  {
    code: 'legal_tax',
    reason: 'sensitive_topic',
    description: 'Legal, regulatory or tax questions',
    patterns: [
      /\blegal(?:ly)?\b|\blawyers?\b|\blaw\s*suits?\b|\bsue\b|\bregulat\w*|\blicen[cs]ed\b|\btax(?:es|ed)?\b|\bIIROC\b|\bCIRO\b|\bAMF\b|\bCRA\b/i,
      /\blégal(?:e|ement)?\b|\bjuridique\b|\bavocat(?:e)?\b|\bpoursuit\w*|\brèglement\w*|\bréglementa\w*|\bimpôts?\b|\bfiscal\w*|\btaxes?\b/i,
    ],
  },
  {
    code: 'personal_advice',
    reason: 'sensitive_topic',
    description: 'Personalized trading or investment advice, or their own financial situation',
    patterns: [
      /\bshould\s+i\s+(?:\w+\s+){0,2}(?:buy|sell|short|invest|trade|go\s+long|go\s+short|hold|withdraw)\b/i,
      /\bwhat\s+(?:should|would)\s+(?:i|you)\s+(?:buy|sell|invest\s+in|trade)\b|\bwhich\s+\w+\s+should\s+i\s+(?:buy|sell|trade|invest)\b/i,
      /\bmy\s+(?:portfolio|brokerage|trading\s+account|savings|debts?|loans?|mortgage|rrsp|tfsa|retirement\s+(?:fund|savings))\b/i,
      /\b(?:dois|devrais)[-\s]je\s+(?:\w+\s+){0,2}(?:acheter|vendre|investir|trader|shorter|garder)\b/i,
      /\bmon\s+(?:portefeuille|compte\s+de\s+courtage|épargne|reer|celi|prêt|hypothèque)\b|\bmes\s+(?:dettes|placements|économies)\b/i,
    ],
  },
  {
    code: 'privacy',
    reason: 'sensitive_topic',
    description: 'Privacy or data-deletion requests',
    patterns: [
      /\bprivacy\b|\bpersonal\s+(?:data|information)\b|\b(?:delete|erase|remove)\s+(?:my|all\s+my)\s+(?:data|information|details|account)\b/i,
      /\bconfidentialité\b|\bvie\s+privée\b|\bdonnées\s+personnelles\b|\b(?:supprimer|effacer)\s+(?:mes|toutes\s+mes)\s+(?:données|informations|renseignements)\b|\bloi\s+25\b/i,
    ],
  },
  {
    code: 'security',
    reason: 'sensitive_topic',
    description: 'Security concerns',
    patterns: [
      /\bhack(?:ed|er|ing)?\b|\bscam(?:med|mer)?\b|\bfraud\w*|\bphishing\b|\bsuspicious\b|\bstolen\b|\bidentity\s+theft\b/i,
      /\bpirat(?:ée|é|age)|\barnaque\w*|\bfraude\w*|\bhameçonnage\b|\bsuspect\w*|\bvol(?:ée|é)(?![a-z])/i,
    ],
  },
];

const NEGATION =
  /\b(?:not|never|no(?!\s*[,.!])|cannot|can(?:'|’)t|won(?:'|’)t|don(?:'|’)t|doesn(?:'|’)t|isn(?:'|’)t|aren(?:'|’)t|nobody|no\s+one|nothing|ne|n(?:'|’)|pas|jamais|aucun|aucune|personne\s+ne)\b/i;

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
