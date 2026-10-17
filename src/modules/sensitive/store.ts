import type { Db } from '../../lib/supabase.js';
import { isTopicId, TOPICS, type Topic, type TopicId } from './topics.js';

/** Only switches an admin has changed are stored; anything else is ON. */
export interface SensitiveStore {
  /** the topics this organisation has explicitly switched off */
  disabled(orgId: string): Promise<TopicId[]>;
  set(orgId: string, topic: TopicId, enabled: boolean): Promise<void>;
}

const enc = encodeURIComponent;

export function createSupabaseSensitiveStore(db: Db): SensitiveStore {
  return {
    async disabled(orgId) {
      const r = await db.rest<Array<{ topic: string; enabled: boolean }>>(`/sensitive_topic_settings?org_id=eq.${enc(orgId)}&enabled=eq.false&select=topic&limit=50`);
      if (r.status >= 300) throw new Error(`sensitive store: read failed (${r.status})`);
      return (r.data ?? []).map((x) => x.topic).filter(isTopicId);
    },
    async set(orgId, topic, enabled) {
      const r = await db.rest('/sensitive_topic_settings?on_conflict=org_id,topic', {
        method: 'POST', headers: { Prefer: 'return=minimal,resolution=merge-duplicates' },
        body: { org_id: orgId, topic, enabled, updated_at: new Date().toISOString() },
      });
      if (r.status >= 300) throw new Error(`sensitive store: save failed (${r.status})`);
    },
  };
}

export interface TopicSetting { id: TopicId; label: string; mode: Topic['mode']; summary: string; enabled: boolean }

/**
 * What the chat and Settings use. Reads are cached for 30 seconds so asking a question stays one cheap lookup, and
 * every change clears that organisation's cache, so a switch takes effect straight away. If the database cannot be
 * read, everything counts as ON: the safe way round.
 */
export function createSensitiveSettings(store: SensitiveStore, opts: { now?: () => number; ttlMs?: number } = {}) {
  const now = opts.now ?? Date.now; const ttl = opts.ttlMs ?? 30_000;
  const cache = new Map<string, { at: number; off: Set<TopicId> }>();

  async function off(orgId: string): Promise<Set<TopicId>> {
    const hit = cache.get(orgId);
    if (hit && now() - hit.at < ttl) return hit.off;
    const set = new Set(await store.disabled(orgId));
    cache.set(orgId, { at: now(), off: set });
    return set;
  }
  return {
    /** the topics currently switched on for this organisation */
    async enabled(orgId: string): Promise<Set<TopicId>> {
      let disabled: Set<TopicId>;
      try { disabled = await off(orgId); } catch { disabled = new Set(); }
      return new Set(TOPICS.map((t) => t.id).filter((id) => !disabled.has(id)));
    },
    async list(orgId: string): Promise<TopicSetting[]> {
      const disabled = await off(orgId);
      return TOPICS.map((t) => ({ id: t.id, label: t.label, mode: t.mode, summary: t.summary, enabled: !disabled.has(t.id) }));
    },
    async set(orgId: string, topic: TopicId, enabled: boolean): Promise<void> {
      await store.set(orgId, topic, enabled);
      cache.delete(orgId);
    },
  };
}
export type SensitiveSettings = ReturnType<typeof createSensitiveSettings>;
