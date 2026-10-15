import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');

/** Minimal imitation of what Supabase provides around Postgres: roles, auth.users, auth.uid(). */
const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  -- minimal imitation of Supabase Storage's table, for the storage-policy migration
  create schema storage;
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;
  -- Supabase grants new public tables to these roles by default; migrations must lock down explicitly.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
}
export function migrationSql(file: string): string {
  return readFileSync(join(MIGRATIONS, file), 'utf8');
}

export async function newDb(upTo?: string): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  for (const f of migrationFiles()) {
    if (upTo && f > upTo) break;
    await db.exec(migrationSql(f));
  }
  return db;
}

/** Run `fn` as a Supabase role (anon / authenticated / service_role), optionally as a given user. */
export async function asRole<T>(db: PGlite, role: 'anon' | 'authenticated' | 'service_role', userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${userId ?? ''}', false); set role ${role};`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role;');
  }
}
