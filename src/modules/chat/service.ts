import { ApiHttpError, badRequest, notFound } from '../../lib/errors.js';
import { GAP_PHRASES } from '../insights/analyze.js';
import type { ItemRow } from '../knowledge/store.js';
import { PROFILES, TECH_CATEGORIES } from '../vendors/index.js';
import { pickProfiles, supportLink, takeNpsTag, vendorAnswerToRatingQuestion, vendorFromPerson } from '../vendors/detect.js';
import { checkNps, type NpsMirror, type NpsStore } from './nps.js';
import { buildSystemPrompt } from './prompt.js';
import type { ChatModel, ChatTurn } from './model.js';
import { asItem, type WorkContext } from './work.js';
import { wantsTeam } from './team.js';
import { imagesBehind, pickMedia, retrievePassages, visibleTo, wantsVideo } from './retrieve.js';
import type { ConversationStore, StoredMessage } from './store.js';
import { detectSensitive, TOPIC_IDS, withConfirmLine, type TopicId, type TopicMode } from '../sensitive/topics.js';

/** words that mean the person themselves is asking to rate or review something */
const RATE_INTENT = /\b(rate|rating|rated|review|reviews|nps)\b/i;

/** Questions about the person's own training. Only these get their course list added to the prompt. */
export const TRAINING_INTENT = /\b(training|trainings|course|courses|quiz|quizzes|sign[- ]?off|signed off|refresher|certificate|e-?learning)\b/i;
const dayText = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
export interface TrainingStatus { title: string; status: 'todo' | 'done' | 'renew'; completed_at: string | null; expires_at: string | null }
export const trainingLine = (c: TrainingStatus) => `${c.title}: ${c.status === 'done' ? `done on ${dayText(c.completed_at!)}${c.expires_at ? `, refresh by ${dayText(c.expires_at)}` : ''}` : c.status === 'renew' ? `time for a refresher (last done ${dayText(c.completed_at!)})` : 'not done yet'}`;

/** The lines for the prompt: each course with its status, or a plain statement that nothing is assigned yet. */
async function trainingNotesFor(load: (who: Who) => Promise<TrainingStatus[]>, who: Who): Promise<string[]> {
  const list = await load(who).catch(() => null);
  if (list === null) return [];
  return list.length ? list.map(trainingLine) : ['No courses have been set up for them yet. Their manager can add some in Manage, under Training.'];
}

/** Questions about what the person has to do: today's checklists, updates to read, training to take. Only these get that list added to the prompt. */
/** Not needed to decide whether to look (the chat always knows) but used to say "nothing waiting" when they ask and there is nothing. */
export const WORK_INTENT = /\b(to do|todo|to-do|tasks?|checklists?|check lists?|opening|closing|open up|close up|updates?|announcements?|news|outstanding|overdue|what (?:do|should|have|am|is|are)\b.{0,40}\b(?:today|now|first|next|left|on)|what'?s (?:on|left|next)|anything (?:for me|i need|i should|to do)|my (?:day|shift|jobs?|list))\b/i;

export interface ChatDeps {
  /** counts one AI call against today's allowance, or refuses it (a 429 the person can read) */
  budget?: (orgId: string, units: number) => Promise<void>;
  /** this person's work (checklists, updates, training) as short lines, plus pages the chat can search and quote */
  work?: (who: Who) => Promise<WorkContext>;
  /** for managers: how their people are getting on with training, updates and checklists, as short lines */
  team?: (who: { orgId: string; manages: NonNullable<Who['manages']> }) => Promise<string[]>;
  /** this person's courses and sign-offs, for questions about their training */
  training?: (who: Who) => Promise<TrainingStatus[]>;
  /** all knowledge items for an organisation (the service filters what this person may see) */
  items: (orgId: string) => Promise<ItemRow[]>;
  conversations: ConversationStore;
  model: ChatModel | null;
  /** turns private storage links into time-limited ones */
  signUrls?: (urls: string[]) => Promise<Array<string | null>>;
  /** called once per answered question (fair-use metering). Must never throw. */
  onAnswered?: (siteId: string) => void;
  /** where vendor ratings are saved, and the best-effort copy to the partner portal */
  nps?: NpsStore | null;
  mirrorNps?: NpsMirror | null;
  /** the sensitive topics switched ON for an organisation. If it fails, every topic counts as on (the safe way round). */
  sensitive?: (orgId: string) => Promise<ReadonlySet<TopicId>>;
}

export interface Who {
  email: string; name: string | null; orgId: string; orgName: string; siteId: string; siteName: string; teamIds: string[]; botName: string | null;
  /** the systems this venue has recorded (EPOS, payments...), if any */
  techStack?: Record<string, string> | null;
  /** the venues this person manages (set only for managers), so they can ask how their team is getting on */
  manages?: { all: boolean; siteIds: string[] };
}
export interface Answer {
  reply: string; conversation_id: number; unanswered: boolean;
  sources: Array<{ id: string; title: string }>;
  videos: Array<{ id: string; title: string; url: string; type: string }>;
  images: Array<{ id: string; title: string; url: string }>;
  /** a vendor support page worth showing (only for technology help) */
  support: { vendor: string; url: string } | null;
  /** a vendor the person may want to rate; forced = they asked to */
  nps: { vendor: string; forced: boolean } | null;
  /** set when the question touched a sensitive topic: "manager" = not answered, a person must; "confirm" = answered, confirm with a manager */
  sensitive: { topic: TopicId; label: string; mode: TopicMode } | null;
}

export const MAX_MESSAGE = 2000;
const MAX_STORED = 100;
const HISTORY_TURNS = 12;

/** Tidy the model's reply for display: no raw links (they are not clickable and can mislead), no stray tags. */
export function cleanReply(raw: string): string {
  return raw
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1').replace(/https?:\/\/[^\s)>\]]+/g, '')
    .replace(/\[(?:ESCALATE|NPS:[^\]]*)\]/gi, '')
    .replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
/** Only documents the answer actually cites ("Source: <title>"), never merely ones that were searched. */
export function citedSources(reply: string, passages: Array<{ item_id: string; title: string }>): Array<{ id: string; title: string }> {
  const cited = [...reply.matchAll(/^\s*Sources?:\s*(.+)$/gim)].map((m) => m[1]!.toLowerCase()).join(' | ');
  if (!cited) return [];
  return [...new Map(passages.filter((p) => cited.includes(p.title.toLowerCase())).map((p) => [p.item_id, { id: p.item_id, title: p.title }])).values()];
}
export const isUnanswered = (reply: string) => { const l = reply.toLowerCase(); return GAP_PHRASES.some((p) => l.includes(p)); };

export function createChat(deps: ChatDeps) {
  async function loadHistory(who: Who, id: number | undefined): Promise<StoredMessage[]> {
    if (id === undefined) return [];
    const c = await deps.conversations.get(id);
    // someone else's conversation, or another venue's: indistinguishable from "not found"
    if (!c || (c.email ?? '').toLowerCase() !== who.email.toLowerCase() || c.venue_id !== who.siteId) throw notFound('Conversation not found');
    return Array.isArray(c.messages) ? c.messages : [];
  }

  async function ask(who: Who, input: { message: string; conversation_id?: number; shown_media?: string[] }): Promise<Answer> {
    const message = input.message.trim();
    if (!message) throw badRequest('Type a question first');
    if (message.length > MAX_MESSAGE) throw badRequest(`That message is too long (the limit is ${MAX_MESSAGE} characters)`);

    const stored = await loadHistory(who, input.conversation_id);
    const history = stored.slice(-HISTORY_TURNS);

    // Sensitive topics (HR, incidents, legal, allergens). Looked at before anything else, and only what the person typed.
    const on = await deps.sensitive?.(who.orgId).catch(() => null) ?? new Set<TopicId>(TOPIC_IDS);
    const topic = detectSensitive(message, on);
    if (topic?.mode === 'manager') {
      // Not answered by the AI at all: no model call, and it does not count as an AI question. A person picks it up.
      const reply = topic.routedReply!;
      const saved: StoredMessage[] = [...stored, { role: 'user' as const, content: message }, { role: 'assistant' as const, content: reply }].slice(-MAX_STORED);
      let id = input.conversation_id;
      if (id === undefined) id = await deps.conversations.create({ email: who.email, name: who.name, venue: who.siteName, venue_id: who.siteId, messages: saved });
      else await deps.conversations.save(id, saved);
      return { reply, conversation_id: id, unanswered: false, sources: [], videos: [], images: [], support: null, nps: null, sensitive: { topic: topic.id, label: topic.label, mode: topic.mode } };
    }

    if (!deps.model) throw new ApiHttpError(503, 'assistant_unavailable', 'The assistant is not switched on yet');
    const visible = (await deps.items(who.orgId)).filter((i) => visibleTo(i, who));

    // a short follow-up ("and on Sundays?") makes sense only with the previous question, so search with both
    const lastQuestion = [...stored].reverse().find((m) => m.role === 'user')?.content ?? '';
    // Updates, checklists and courses are searched like documents. A failing source just means no extra pages.
    const work = deps.work ? await deps.work(who).catch(() => null) : null;
    const workPages = (work?.docs ?? []).map((d) => asItem(who.orgId, d));
    const searchable = [...visible.filter((i) => i.kind === 'document' || i.kind === 'image'), ...workPages];
    const passages = retrievePassages(searchable, `${message} ${message.split(/\s+/).length < 6 ? lastQuestion : ''}`);
    // Pictures and videos are shown when asked for, or once when this question is about them. Not again on every follow-up:
    // the page tells us what it has already shown in this chat, and asking for one again always works.
    const shown = new Set(input.shown_media ?? []);
    const picked = pickMedia(visible, message);
    const ownPassages = retrievePassages(searchable, message); // this message only, not the one before it
    const behind = imagesBehind(visible, ownPassages).filter((i) => !shown.has(i.id) && !picked.images.some((p) => p.id === i.id));
    const media = {
      videos: wantsVideo(message) ? picked.videos : picked.videos.filter((v) => !shown.has(v.id)),
      images: [...picked.images, ...behind].slice(0, 1),
    };

    // Managers asking about their people ("who has not done fire training?") get their team's progress, built only for that question.
    const teamNotes = deps.team && who.manages && wantsTeam(message) ? await deps.team({ orgId: who.orgId, manages: who.manages }).catch(() => []) : undefined;
    const system = buildSystemPrompt({
      botName: who.botName || 'Stacked Chat', orgName: who.orgName, siteName: who.siteName, personName: who.name,
      trainingNotes: deps.training && TRAINING_INTENT.test(message) ? await trainingNotesFor(deps.training, who) : undefined,
      teamNotes,
      workNotes: work ? (work.notes.length ? work.notes : WORK_INTENT.test(message) ? ['Nothing is waiting for them: no checklists are set up for their venue, no unread updates and no training to take.'] : []) : undefined,
      passages, hasVideo: media.videos.length > 0, videoNotes: media.videos.map((v) => (v.description ? `${v.title}: ${v.description}` : v.title)), hasImage: media.images.length > 0,
      vendorNotes: pickProfiles(message, history.map((m) => ({ role: m.role, content: m.content })), who.techStack ?? null).map((k) => PROFILES[k]!),
      techStack: who.techStack ?? null, techCategories: TECH_CATEGORIES,
    });
    const turns: ChatTurn[] = [...stored.slice(-HISTORY_TURNS).map((m) => ({ role: m.role, content: m.content })), { role: 'user' as const, content: message }];
    // the API needs the conversation to start with the person
    while (turns.length > 1 && turns[0]!.role !== 'user') turns.shift();

    await deps.budget?.(who.orgId, 1);
    const raw = await deps.model.complete({ system, messages: turns });
    if (!raw) throw new ApiHttpError(503, 'assistant_unavailable', 'The assistant could not answer just now. Please try again in a moment.');
    const tagged = takeNpsTag(raw);
    const cleaned = cleanReply(tagged.reply) || (tagged.vendor ? `Great, rating ${tagged.vendor} now.` : 'Sorry, I could not put an answer together. Please try again.');
    // allergens: the answer stands, followed by the reminder to confirm with a person
    const reply = topic?.mode === 'confirm' ? withConfirmLine(cleaned) : cleaned;
    const unanswered = isUnanswered(reply);

    const toSave: StoredMessage[] = [...stored, { role: 'user' as const, content: message }, { role: 'assistant' as const, content: reply }].slice(-MAX_STORED);
    let conversation_id = input.conversation_id;
    if (conversation_id === undefined) conversation_id = await deps.conversations.create({ email: who.email, name: who.name, venue: who.siteName, venue_id: who.siteId, messages: toSave });
    else await deps.conversations.save(conversation_id, toSave);
    try { deps.onAnswered?.(who.siteId); } catch { /* metering never blocks an answer */ }

    // sources only make sense when there was an answer. A matching video or photo stays even when no document answered it:
    // the assistant was told it is attached and says so, so dropping it would leave the person looking for something missing
    const used = unanswered ? [] : citedSources(reply, passages);
    const withMedia = media;
    const urls = [...withMedia.videos, ...withMedia.images].map((i) => i.url ?? '');
    const signed = deps.signUrls && urls.length ? await deps.signUrls(urls).catch(() => urls) : urls;
    const pick = (list: ItemRow[], offset: number) => list.map((i, n) => ({ id: i.id, title: i.title, url: signed[offset + n] ?? i.url ?? '' })).filter((x) => x.url);
    const vids = pick(withMedia.videos, 0).map((v) => ({ ...v, type: /youtu/.test(v.url) ? 'youtube' : 'video' }));
    // ratings: only ever from what the PERSON said, or the assistant's explicit tag (never a vendor mentioned in passing)
    const turnsBefore = history.map((m) => ({ role: m.role, content: m.content }));
    // the assistant's tag only counts when the person's own message is about rating or reviewing; it must not drift into later turns
    const asked = (tagged.vendor && RATE_INTENT.test(message) ? tagged.vendor : null) ?? vendorAnswerToRatingQuestion(message, turnsBefore);
    const mentioned = asked ? null : vendorFromPerson(message, []); // only a product named in THIS message, not one from earlier turns
    const nps = asked ? { vendor: asked, forced: true } : mentioned ? { vendor: mentioned, forced: false } : null;
    return {
      reply, conversation_id, unanswered, sources: used, videos: vids, images: pick(withMedia.images, withMedia.videos.length), support: supportLink(message, who.techStack ?? null), nps,
      sensitive: topic ? { topic: topic.id, label: topic.label, mode: topic.mode } : null,
    };
  }

  async function list(email: string, siteId: string) {
    return (await deps.conversations.listMine(email, siteId, 30)).map((c) => {
      const msgs = Array.isArray(c.messages) ? c.messages : [];
      const first = msgs.find((m) => m.role === 'user')?.content ?? 'New chat';
      return { id: c.id, title: first.length > 80 ? first.slice(0, 77) + '…' : first, updated_at: c.updated_at ?? c.created_at, messages: msgs.length };
    });
  }

  async function open(email: string, siteId: string, id: number) {
    const c = await deps.conversations.get(id);
    if (!c || (c.email ?? '').toLowerCase() !== email.toLowerCase() || c.venue_id !== siteId) throw notFound('Conversation not found');
    return { id: c.id, messages: Array.isArray(c.messages) ? c.messages : [] };
  }

  /** Save a vendor rating (and copy it to the partner portal, best effort). */
  async function rate(who: Who, input: { vendor: string; score: number; comment?: string | null }): Promise<void> {
    if (!deps.nps) throw new ApiHttpError(503, 'ratings_unavailable', 'Ratings are not switched on yet');
    const c = checkNps(input);
    const row = { ...c, venue_id: who.siteId, venue: who.siteName, respondent: who.name };
    await deps.nps.save(row);
    void deps.mirrorNps?.(row).catch(() => undefined);
  }

  return { ask, list, open, rate };
}
export type Chat = ReturnType<typeof createChat>;
