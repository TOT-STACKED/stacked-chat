import type { SensitiveStore } from '../modules/sensitive/store.js';
import type { TopicId } from '../modules/sensitive/topics.js';

/** In-memory sensitive-topic switches for tests and the local preview. `fail` makes every read throw (database down). */
export class FakeSensitiveStore implements SensitiveStore {
  off = new Map<string, Set<TopicId>>(); fail = false; reads = 0;
  async disabled(orgId: string) { this.reads++; if (this.fail) throw new Error('database down'); return [...(this.off.get(orgId) ?? [])]; }
  async set(orgId: string, topic: TopicId, enabled: boolean) {
    const s = this.off.get(orgId) ?? new Set<TopicId>();
    if (enabled) s.delete(topic); else s.add(topic);
    this.off.set(orgId, s);
  }
}
