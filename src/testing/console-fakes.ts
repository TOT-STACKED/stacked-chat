import type { Conversation } from '../modules/insights/analyze.js';
import type { NpsScore } from '../modules/console/intel.js';
import type { ConsoleStore, MemberLite, OrgRow, SiteRow, UsageLite } from '../modules/console/store.js';

export class FakeConsoleStore implements ConsoleStore {
  orgRows: OrgRow[] = []; siteRows: SiteRow[] = []; memberRows: MemberLite[] = []; usageRows: UsageLite[] = []; convRows: Conversation[] = []; npsRows: NpsScore[] = [];
  async orgs() { return structuredClone(this.orgRows); }
  async sites() { return structuredClone(this.siteRows); }
  async members() { return structuredClone(this.memberRows); }
  async usage() { return structuredClone(this.usageRows); }
  async conversations(since: string) { return structuredClone(this.convRows.filter((c) => c.created_at >= since)); }
  async nps(since: string) { return structuredClone(this.npsRows.filter((n) => n.created_at >= since)); }
}
