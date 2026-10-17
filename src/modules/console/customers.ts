import { randomBytes } from 'node:crypto';
import { ApiHttpError, conflict } from '../../lib/errors.js';
import { inviteEmail, welcomeEmail, type Mailer, type SendResult } from '../../lib/email.js';
import type { Repo } from '../../lib/repo.js';
import type { Notify } from '../../lib/slack.js';
import type { Billing } from '../billing/service.js';

export interface NewCustomer { company_name: string; venue_name?: string | null; owner_email: string; owner_name?: string | null; start_trial: boolean;
  /** the owner signed themselves up (they get a welcome email, not an invitation from "the Stacked team") */ self_serve?: boolean }
export interface CustomerCreated {
  org_id: string; site_id: string; member_id: string;
  invite: SendResult;
  /** started: the 30-day trial is running. skipped: not asked for. not_available: billing is not switched on. failed: try again from the customer's Billing page. */
  trial: 'started' | 'skipped' | 'not_available' | 'failed';
}

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'company';

/** Stacked staff add a customer: the company, its first venue and its owner, who is invited by email (and the trial started). */
export function createCustomers(deps: { repo: Repo; mailer?: Mailer; publicUrl: string; notify?: Notify | null; billing?: Billing | null }) {
  async function create(staffEmail: string, c: NewCustomer): Promise<CustomerCreated> {
    const { repo } = deps;
    let org; let attempt = 0;
    for (;;) {
      try { org = await repo.createOrg({ name: c.company_name, slug: `${slugify(c.company_name)}-${randomBytes(2).toString('hex')}` }); break; }
      catch (e) { if (!(e instanceof ApiHttpError && e.statusCode === 409) || ++attempt >= 4) throw e instanceof ApiHttpError && e.statusCode === 409 ? conflict('Could not create a unique company, please try again') : e; }
    }
    const venueName = c.venue_name?.trim() || c.company_name;
    const site = await repo.createSite({ org_id: org.id, name: venueName, slug: `${slugify(venueName)}-${randomBytes(2).toString('hex')}` });
    const owner = await repo.createMember({ org_id: org.id, site_id: null, email: c.owner_email, display_name: c.owner_name?.trim() || null, role: 'owner', status: 'invited' });

    const url = deps.publicUrl.replace(/\/$/, '') + '/manage/';
    const invite: SendResult = deps.mailer
      ? await deps.mailer.send(c.self_serve
        ? welcomeEmail({ to: owner.email, name: c.owner_name, orgName: org.name, url })
        : inviteEmail({ to: owner.email, orgName: org.name, siteName: null, inviter: 'The Stacked team', role: 'owner', url }))
      : 'skipped';

    let trial: CustomerCreated['trial'] = 'skipped';
    if (c.start_trial) {
      if (!deps.billing) trial = 'not_available';
      else { try { await deps.billing.startOrAddCard(org.id, { interval: 'month', email: owner.email }); trial = 'started'; } catch { trial = 'failed'; } }
    }

    await deps.notify?.(`${c.self_serve ? '🎉 *New self-serve sign-up:*' : '🎉 *New customer:*'} ${org.name}\n*Owner:* ${owner.email}\n*First venue:* ${site.name}\n*${c.self_serve ? 'Source' : 'Added by'}:* ${staffEmail.toLowerCase()}${trial === 'started' ? '\n*Trial:* 30 days started' : ''}`);
    return { org_id: org.id, site_id: site.id, member_id: owner.id, invite, trial };
  }
  return { create };
}
export type CustomersService = ReturnType<typeof createCustomers>;
