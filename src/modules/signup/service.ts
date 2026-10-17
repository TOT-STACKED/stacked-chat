import type { Repo } from '../../lib/repo.js';
import type { CustomersService } from '../console/customers.js';

export interface SignupInput { company_name: string; venue_name?: string | null; owner_name: string; owner_email: string }

/**
 * An owner starts their own 30-day trial. It is exactly "Add customer" in the Console (company, first venue, owner,
 * trial, welcome email, Slack alert), except nobody at Stacked has to do it.
 *
 * An email address that already belongs to anyone ('exists') creates nothing and sends nothing: nobody can use a sign-up
 * to email an address that is already in the system, or end up with two companies on one address.
 */
export function createSignup(deps: { repo: Repo; customers: CustomersService }) {
  async function start(input: SignupInput): Promise<'created' | 'exists'> {
    const email = input.owner_email.trim().toLowerCase();
    if (await deps.repo.emailInUse(email)) return 'exists';
    await deps.customers.create('self-serve sign-up', {
      company_name: input.company_name, venue_name: input.venue_name ?? null, owner_email: email, owner_name: input.owner_name, start_trial: true, self_serve: true,
    });
    return 'created';
  }
  return { start };
}
export type Signup = ReturnType<typeof createSignup>;
