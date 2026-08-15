-- ============================================================================
-- 0006: settlement_publication — 결산 게시 (관리자가 게시하면 멤버 홈에 공지 노출).
-- ADDITIVE. 기존 테이블·데이터 무수정. Supabase SQL 에디터에서 실행.
-- 게시 시점 수치를 jsonb 스냅샷으로 고정 저장 — 이후 데이터가 바뀌어도 게시본 불변.
-- ============================================================================

create table if not exists public.settlement_publication (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  period_label text not null,
  date_from date,
  date_to date,
  income_total bigint not null,
  expense_total bigint not null,
  summary jsonb not null,
  published_by uuid references public.profile(id),
  published_at timestamptz not null default now(),
  is_active boolean not null default true
);

comment on table public.settlement_publication is
  '결산 게시 스냅샷. summary = { incomeGroups: [{label,count,amount}], expenseRows: [{category,amount}] }. 활성(is_active) 최신 1건이 멤버 홈 공지로 노출.';

create index if not exists settlement_publication_org_idx
  on public.settlement_publication (org_id, is_active, published_at desc);

alter table public.settlement_publication enable row level security;

drop policy if exists sp_select on public.settlement_publication;
create policy sp_select on public.settlement_publication for select
  using (org_id = public.current_org_id());
drop policy if exists sp_write on public.settlement_publication;
create policy sp_write on public.settlement_publication for all
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());

grant select, insert, update, delete on public.settlement_publication to authenticated;

-- ============================================================================
-- 끝. 검증: select count(*) from public.settlement_publication;  → 0 (게시 전).
