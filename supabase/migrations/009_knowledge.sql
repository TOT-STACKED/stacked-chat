-- 009_knowledge: a catalogue over the existing knowledge content, so managers can see, target and
-- publish it. Additive and safe to re-run; nothing about how the chat reads content changes.
--   * documents / videos / images stay where they are (the chat keeps reading them)
--   * knowledge_items adds: a title, a status (draft/published) and an audience (company or one site)
--   * a DRAFT is kept only here (body/url), never in the tables the chat reads, so a draft can
--     never be answered from. Publishing copies it into those tables; unpublishing removes it.
-- Existing content is adopted into the catalogue automatically the first time Manage lists it.

begin;

create table if not exists public.knowledge_items (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations(id) on delete cascade,
  kind          text not null check (kind in ('document', 'video', 'image')),
  title         text not null,
  status        text not null default 'published' check (status in ('draft', 'published')),
  site_id       uuid references public.venues(id) on delete cascade,   -- null = the whole company
  body          text,                                                   -- documents: the text
  url           text,                                                   -- videos / images: where it lives
  description   text,
  doc_filename  text,                                                   -- the name the chat knows a published document by
  video_id      bigint,                                                 -- set while a video is published
  image_id      uuid,                                                   -- set while an image is published
  source        text not null default 'manager' check (source in ('manager', 'ai_draft', 'imported')),
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  published_at  timestamptz
);

create index if not exists knowledge_items_org_idx on public.knowledge_items (org_id, status);
create unique index if not exists knowledge_items_doc_uq   on public.knowledge_items (org_id, doc_filename) where doc_filename is not null;
create unique index if not exists knowledge_items_video_uq on public.knowledge_items (org_id, video_id)    where video_id is not null;
create unique index if not exists knowledge_items_image_uq on public.knowledge_items (org_id, image_id)    where image_id is not null;

alter table public.knowledge_items enable row level security;
revoke all on public.knowledge_items from anon, authenticated;

commit;
