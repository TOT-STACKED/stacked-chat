import type { Conversation } from '../modules/insights/analyze.js';
import type { InsightsStore } from '../modules/insights/store.js';

export class FakeInsightsStore implements InsightsStore {
  convs: Conversation[] = [];
  siteList: Array<{ id: string; org_id: string; name: string }> = [];
  members: Array<{ org_id: string; email: string; teams: string[] }> = [];
  private n = 1;

  addConversation(siteId: string, email: string | null, turns: Array<[string, string]>, when = new Date()): Conversation {
    const c: Conversation = { id: this.n++, venue_id: siteId, email, created_at: when.toISOString(), messages: turns.flatMap(([q, a]) => [{ role: 'user', content: q }, { role: 'assistant', content: a }]) };
    this.convs.push(c); return c;
  }
  async conversations(siteIds: string[], sinceIso: string) { return this.convs.filter((c) => c.venue_id && siteIds.includes(c.venue_id) && c.created_at >= sinceIso); }
  async sites(orgId: string) { return this.siteList.filter((s) => s.org_id === orgId).map(({ id, name }) => ({ id, name })); }
  async memberTeams(orgId: string) { return this.members.filter((m) => m.org_id === orgId).map(({ email, teams }) => ({ email, teams })); }
}
