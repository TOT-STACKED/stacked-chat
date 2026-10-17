/**
 * Sensitive topics: subjects Stacked Chat should not handle alone.
 *
 *  - "confirm": the assistant still answers (only from the company's own documents) and then tells the person to
 *    confirm with a manager. Used for allergens.
 *  - "manager": the assistant does not answer at all. It explains this needs a person and offers the
 *    "Ask my manager" button. Used for HR matters, incidents and legal matters.
 *
 * Detection is deliberately plain keyword matching, not another AI call: it is instant, free, predictable, and easy
 * to test. It looks at what the PERSON typed. Wording errs towards the safe side (a borderline question gets a person).
 */
export type TopicId = 'allergens' | 'hr' | 'incidents' | 'legal';
export type TopicMode = 'confirm' | 'manager';

export interface Topic {
  id: TopicId;
  label: string;
  mode: TopicMode;
  /** what managers see next to the switch */
  summary: string;
  patterns: RegExp[];
  /** the reply staff get when mode is "manager" */
  routedReply?: string;
}

export const CONFIRM_LINE = 'Always confirm with your manager or the kitchen before serving.';

export const TOPICS: Topic[] = [
  {
    id: 'incidents', mode: 'manager', label: 'Accidents, injuries and incidents',
    summary: 'Injuries, accidents, allergic reactions, food poisoning, violence, theft. The assistant does not answer; it points the person to a manager.',
    patterns: [
      /\b(?:accident|accidents|injur(?:y|ed|ies)|hurt myself|cut myself|burnt myself|burned myself|scalded|fainted|collapsed|seizure|unconscious|ambulance|riddor)\b/i,
      /\b(?:allergic reaction|anaphyla(?:xis|ctic)|food poisoning)\b/i,
      /\b(?:assault|assaulted|attacked|threatened|violent|violence|robbery|robbed|stolen|theft|break-?in)\b/i,
    ],
    routedReply: "This sounds like something your manager needs to know about. If anyone needs urgent help, get first aid or call 999 now. Then tap \"Ask my manager\" below so it is recorded and followed up.",
  },
  {
    id: 'hr', mode: 'manager', label: 'Discipline, grievances and HR matters',
    summary: 'Discipline, grievances, harassment, bullying, discrimination, dismissal, redundancy. The assistant does not answer; it points the person to a manager.',
    patterns: [
      /\b(?:disciplinary|grievance|grievances|harass(?:ed|ment|ing)?|bullied|bullying|discriminat\w*|whistle-?blow\w*)\b/i,
      /\b(?:unfair|constructive|wrongful) dismissal\b/i,
      /\b(?:got|get|been|being|am i|will i be) (?:fired|sacked|dismissed)\b/i,
      /\b(?:sacked|redundan(?:t|cy|cies)|tribunal|formal warning|written warning|final warning)\b/i,
      /\b(?:sexual(?:ly)?|inappropriate(?:ly)?) (?:harass\w*|assault\w*|touch\w*|comment\w*|behaviour|behavior)\b/i,
    ],
    routedReply: "That is a matter for your manager, and I am not the right place for it. I cannot advise on discipline, grievances or other HR issues. Tap \"Ask my manager\" below and they will be in touch with you directly.",
  },
  {
    id: 'legal', mode: 'manager', label: 'Legal matters, complaints and claims',
    summary: 'Legal advice, formal complaints, compensation, the police, inspectors. The assistant does not answer; it points the person to a manager.',
    patterns: [
      /\b(?:legal action|legal advice|legally (?:liable|responsible)|lawyer|solicitor|lawsuit|suing|sued|sue|compensation|insurance claim|negligen(?:t|ce)|liable|liability)\b/i,
      /\b(?:formal complaint|trading standards|environmental health officer|police)\b/i,
      /(?<!food\s)\bcourt\b/i,
    ],
    routedReply: "Questions about legal matters, formal complaints or claims need a manager. I cannot advise on them. Tap \"Ask my manager\" below and they will pick it up.",
  },
  {
    id: 'allergens', mode: 'confirm', label: 'Allergens and food safety',
    summary: 'Allergen and "free from" questions. The assistant answers only from your own documents, then tells the person to confirm with a manager or the kitchen before serving.',
    patterns: [
      /\b(?:allerg(?:en|ens|y|ies|ic)|intoleran(?:t|ce|ces)|coeliac|celiac|anaphyla(?:xis|ctic)|gluten)\b/i,
      /\b(?:nut|nuts|peanut|peanuts|sesame|shellfish|crustaceans?|molluscs?|lactose|sulphites?|sulfites?)\b/i,
      /\b(?:nut|dairy|gluten|egg|soy|soya|fish)[- ]free\b/i,
      /\b(?:free from|safe for (?:a|an|someone|somebody|customers?|guests?|vegans?|coeliacs?))\b/i,
    ],
  },
];

/** Which topic wins when a message matches several: the ones that need a person come first. */
const PRIORITY: TopicId[] = ['incidents', 'hr', 'legal', 'allergens'];
export const TOPIC_IDS: TopicId[] = TOPICS.map((t) => t.id);
export const isTopicId = (v: string): v is TopicId => (TOPIC_IDS as string[]).includes(v);
export const topicById = (id: TopicId): Topic => TOPICS.find((t) => t.id === id)!;

/** The first enabled topic this message touches, or null. */
export function detectSensitive(message: string, enabled: ReadonlySet<TopicId>): Topic | null {
  const text = message.normalize('NFKC');
  for (const id of PRIORITY) {
    if (!enabled.has(id)) continue;
    const t = topicById(id);
    if (t.patterns.some((p) => p.test(text))) return t;
  }
  return null;
}

/** Put the "confirm before serving" line in before any "Source:" line, unless the answer already says it. */
export function withConfirmLine(reply: string): string {
  if (/before serving|duty manager/i.test(reply)) return reply;
  const lines = reply.split('\n');
  const at = lines.findIndex((l) => /^\s*sources?:/i.test(l));
  if (at < 0) return `${reply}\n\n${CONFIRM_LINE}`;
  return [...lines.slice(0, at), CONFIRM_LINE, '', ...lines.slice(at)].join('\n').replace(/\n{3,}/g, '\n\n');
}
