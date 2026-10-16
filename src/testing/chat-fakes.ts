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
    const last0 = messages.at(-1)?.content ?? '';
    const rate = /\brate\s+([a-z0-9 .&-]{2,30})\??$/i.exec(last0.trim());
    if (rate) return `Great, rating ${rate[1]!.trim()} now.\n[NPS:${rate[1]!.trim().toLowerCase()}]`;
    const vendorNotes = system.split('STACKED VENDOR SUPPORT NOTES (maintained by Stacked; use for hospitality technology faults):\n')[1]?.split('\n\n---\n\n')[0];
    if (vendorNotes && /till|offline|printer|terminal|reader|not working|frozen/i.test(last0)) {
      const fix = /1\.\s*([^\n]{20,200})/.exec(vendorNotes)?.[1] ?? 'Restart the device and check the connection.';
      return `**Restart it and check the connection first.**\n1. ${fix.slice(0, 160)}\n2. If it still fails, use the vendor support link below.\n\nMid-service workaround: take cash or a backup reader while you sort it.`;
    }
    const kb = system.split('KNOWLEDGE BASE:\n')[1] ?? '';
    if (kb.startsWith('(Nothing')) return "I don't have that in your knowledge base yet. Ask your manager to add it and I'll be able to help the whole team next time.";
    const first = kb.split('\n\n---\n\n')[0] ?? '';
    const title = /^\[([^\]]+)\]/.exec(first)?.[1] ?? 'your handbook';
    const text = first.replace(/^\[[^\]]+\]\n/, '').trim();
    const last = messages.at(-1)?.content ?? '';
    return `Here is what **${title}** says about that:\n\n${text}\n\nAsked: "${last.slice(0, 60)}"\n\nSource: ${title}`;
  },
};
