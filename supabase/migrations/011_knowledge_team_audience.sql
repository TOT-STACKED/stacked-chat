-- 011_knowledge_team_audience: knowledge can now be aimed at a team (the chat knows who is asking).
-- Audience becomes: whole company (site_id and team_id null), one site (site_id), or one team (team_id;
-- site_id then mirrors the team's site, or stays null for a company-wide team). Additive, safe to re-run.

begin;
alter table public.knowledge_items add column if not exists team_id uuid references public.teams(id) on delete cascade;
create index if not exists knowledge_items_team_idx on public.knowledge_items (team_id) where team_id is not null;
commit;
