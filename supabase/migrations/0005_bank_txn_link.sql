-- ============================================================================
-- 0005: bank_txn_link — 출금 1건 ↔ 영수증 N건 묶음 구성 저장 (결산 계정 분리용).
-- ADDITIVE. 기존 테이블·데이터 무수정. Supabase SQL 에디터에서 실행.
-- 재대사(reconcileOrg)가 채운다: 배포 후 관리자 화면 "영수증 재대사" 1회 클릭으로 백필.
-- ============================================================================

create table if not exists public.bank_txn_link (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  bank_transaction_id uuid not null references public.bank_transaction(id) on delete cascade,
  receipt_id uuid not null references public.receipt(id) on delete cascade,
  amount bigint not null,
  created_at timestamptz not null default now(),
  unique (bank_transaction_id, receipt_id)
);

comment on table public.bank_txn_link is
  '출금 1건에 묶여 정산된 영수증 구성. amount = 매칭 시점의 영수증 금액. 재대사 시 전량 갱신.';

-- (bank_transaction_id, receipt_id) unique 제약이 bank_transaction_id 선두 인덱스를 겸한다.
create index if not exists bank_txn_link_org_idx on public.bank_txn_link (org_id);

alter table public.bank_txn_link enable row level security;

drop policy if exists btl_select on public.bank_txn_link;
create policy btl_select on public.bank_txn_link for select
  using (org_id = public.current_org_id());
drop policy if exists btl_write on public.bank_txn_link;
create policy btl_write on public.bank_txn_link for all
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());

grant select, insert, update, delete on public.bank_txn_link to authenticated;

-- ============================================================================
-- 끝. 검증: select count(*) from public.bank_txn_link;  → 0 (재대사 후 링크 수 > 매칭 출금 수).
