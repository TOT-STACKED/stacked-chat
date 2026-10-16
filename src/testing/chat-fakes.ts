import type { ChatModel, ChatTurn } from '../modules/chat/model.js';
import type { ConversationRow, ConversationStore, StoredMessage } from '../modules/chat/store.js';

export class FakeConversationStore implements ConversationStore {
  rows: ConversationRow[] = []; private n = 1;
  async create(c: { email: string; venue_id: string; messages: StoredMessage[] }) {
    const row: ConversationRow = { id: this.n++, email: c.email.toLowerCase(), venue_id: c.venue_id, messages: c.messages, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    this.rows.push(row); return row.id;
  }
  async save(id: number, messages: StoredMessage[]) { const r = this.rows.find((x) => x.id === id)!; r.messages = messages; r.updated_at = new Date().toISOString(); }
  async get(id: number) { return structuredClone(this.rows.find((r) => r.id === id) ?? null); }
  async listMine(email: string, siteId: string) { return structuredClone(this.rows.filter((r) => r.email === email.toLowerCase() && r.venue_id === siteId).reverse()); }
}

/** LOCAL PREVIEW ONLY: no AI. Replies with the best-matching passage from the knowledge it was given, or says it has nothing. */
export const previewChatModel: ChatModel = {
  async complete({ system, messages }: { system: string; messages: ChatTurn[] }) {
    await new Promise((r) => setTimeout(r, 700));
    const kb = system.split('KNOWLEDGE BASE:\n')[1] ?? '';
    if (kb.startsWith('(Nothing')) return "I don't have that in your knowledge base yet. Ask your manager to add it and I'll be able to help the whole team next time.";
    const first = kb.split('\n\n---\n\n')[0] ?? '';
    const title = /^\[([^\]]+)\]/.exec(first)?.[1] ?? 'your handbook';
    const text = first.replace(/^\[[^\]]+\]\n/, '').trim();
    const last = messages.at(-1)?.content ?? '';
    return `Here is what **${title}** says about that:\n\n${text}\n\nAsked: "${last.slice(0, 60)}"\n\nSource: ${title}`;
  },
};
