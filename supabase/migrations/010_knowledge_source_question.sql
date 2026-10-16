-- 010_knowledge_source_question: remember which question an AI-drafted knowledge item was written for,
-- so Insights can show "draft ready" and never draft the same question twice. Additive, safe to re-run.

begin;
alter table public.knowledge_items add column if not exists source_question text;
create unique index if not exists knowledge_items_source_question_uq
  on public.knowledge_items (org_id, source_question) where source_question is not null;
commit;
