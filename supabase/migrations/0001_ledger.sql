-- ============================================================================
-- Iteration 1: 통장 기반 종합 입출금 원장 + 잔액
-- ADDITIVE migration — 기존 데이터 무손실. Supabase SQL 에디터에서 실행.
-- 되돌리기: supabase/migrations/0001_ledger_rollback.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. RLS helper functions (org-scoped). SECURITY DEFINER → profile RLS 재귀 방지.
--    이미 있으면 안전하게 교체.
-- ----------------------------------------------------------------------------
create or replace function public.current_org_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select org_id from public.profile where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select role = 'admin' from public.profile where id = auth.uid()), false)
$$;

grant execute on function public.current_org_id() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ----------------------------------------------------------------------------
-- 1. receipt.source — 'web'(기존 영수증 플로우) | 'manual'(회계 직접입력, 차후)
--    기존 34건은 자동으로 'web'. 무손실.
-- ----------------------------------------------------------------------------
alter table public.receipt
  add column if not exists source text not null default 'web'
  check (source in ('web', 'manual'));

-- ----------------------------------------------------------------------------
-- 2. bank_import_batch — 월별 통장 .xls 업로드 단위
-- ----------------------------------------------------------------------------
create table if not exists public.bank_import_batch (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organization(id) on delete cascade,
  bank_account_id uuid not null references public.bank_account(id) on delete cascade,
  period          text,                       -- 'YYYY-MM' (조회기간 시작월 기준)
  file_name       text,
  query_from      date,
  query_to        date,
  opening_balance bigint,
  closing_balance bigint,
  withdraw_total  bigint not null default 0,
  deposit_total   bigint not null default 0,
  row_count       integer not null default 0,
  imported_by     uuid references public.profile(id),
  imported_at     timestamptz not null default now()
);

create index if not exists bank_import_batch_org_idx on public.bank_import_batch(org_id);

-- ----------------------------------------------------------------------------
-- 3. bank_transaction — 원장의 척추. 입금/출금 모든 거래.
--    dedupe_key + unique → 같은 달 재업로드해도 중복 안 쌓임(멱등).
-- ----------------------------------------------------------------------------
create table if not exists public.bank_transaction (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organization(id) on delete cascade,
  bank_account_id   uuid not null references public.bank_account(id) on delete cascade,
  import_batch_id   uuid references public.bank_import_batch(id) on delete set null,
  txn_no            integer,                  -- 통장 No
  txn_at            timestamptz not null,     -- 거래일시
  counterparty      text,                     -- 보낸분/받는분
  withdraw          bigint not null default 0,
  deposit           bigint not null default 0,
  balance           bigint,                   -- 통장 잔액(은행 계산값 = 진실)
  memo              text,
  method            text,                     -- 적요(체크카드/스마트출금/이체…)
  branch            text,                     -- 처리점
  kind              text not null default 'unknown'
                      check (kind in ('expense','income','wash','transfer','unknown')),
  match_status      text not null default 'na'
                      check (match_status in ('matched','unmatched','na')),
  matched_receipt_id uuid references public.receipt(id) on delete set null,
  matched_income_id  uuid,                    -- fk income (income 생성 후 추가)
  locked            boolean not null default false,   -- 수동수정 보호(자동대사 덮어쓰기 금지)
  dedupe_key        text not null,            -- date|withdraw|deposit|balance|counterparty 해시
  created_at        timestamptz not null default now(),
  unique (bank_account_id, dedupe_key)
);

create index if not exists bank_transaction_org_idx     on public.bank_transaction(org_id);
create index if not exists bank_transaction_account_idx on public.bank_transaction(bank_account_id);
create index if not exists bank_transaction_date_idx    on public.bank_transaction(txn_at);
create index if not exists bank_transaction_match_idx   on public.bank_transaction(matched_receipt_id);

-- ----------------------------------------------------------------------------
-- 4. income — 수입. 통장 입금에서 자동(source='bank') + 회계 수동(source='manual')
-- ----------------------------------------------------------------------------
create table if not exists public.income (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organization(id) on delete cascade,
  income_date         date not null,
  amount              bigint not null,
  category            text not null default '기타'
                        check (category in ('헌금','회비','전도금','지원금','잡수입','기타')),
  source              text not null default 'manual' check (source in ('bank','manual')),
  deposit_to_bank_id  uuid references public.bank_account(id) on delete set null,
  bank_transaction_id uuid references public.bank_transaction(id) on delete set null,
  memo                text,
  created_by          uuid references public.profile(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists income_org_idx  on public.income(org_id);
create index if not exists income_date_idx  on public.income(income_date);

-- bank_transaction.matched_income_id → income FK (income 생성 후 연결)
do $$ begin
  alter table public.bank_transaction
    add constraint bank_transaction_matched_income_fk
    foreign key (matched_income_id) references public.income(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 5. ledger_entry VIEW — 통합 원장(입금=수입 / 출금=지출), security_invoker로 RLS 상속
-- ----------------------------------------------------------------------------
create or replace view public.ledger_entry
with (security_invoker = true) as
select
  bt.id,
  bt.org_id,
  bt.bank_account_id,
  bt.txn_at,
  (bt.txn_at at time zone 'Asia/Seoul')::date as txn_date,
  case when bt.deposit > 0 then 'income' else 'expense' end as direction,
  bt.deposit,
  bt.withdraw,
  bt.balance,
  bt.counterparty,
  bt.memo,
  bt.method,
  bt.kind,
  bt.match_status,
  bt.matched_receipt_id,
  bt.matched_income_id
from public.bank_transaction bt;

-- ----------------------------------------------------------------------------
-- 6. RLS — 같은 org 멤버는 SELECT, 쓰기는 admin만
-- ----------------------------------------------------------------------------
alter table public.bank_import_batch enable row level security;
alter table public.bank_transaction  enable row level security;
alter table public.income            enable row level security;

-- bank_import_batch
drop policy if exists bib_select on public.bank_import_batch;
create policy bib_select on public.bank_import_batch for select
  using (org_id = public.current_org_id());
drop policy if exists bib_write on public.bank_import_batch;
create policy bib_write on public.bank_import_batch for all
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());

-- bank_transaction
drop policy if exists bt_select on public.bank_transaction;
create policy bt_select on public.bank_transaction for select
  using (org_id = public.current_org_id());
drop policy if exists bt_write on public.bank_transaction;
create policy bt_write on public.bank_transaction for all
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());

-- income
drop policy if exists income_select on public.income;
create policy income_select on public.income for select
  using (org_id = public.current_org_id());
drop policy if exists income_write on public.income;
create policy income_write on public.income for all
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());

grant select on public.ledger_entry to authenticated;
grant select, insert, update, delete on public.bank_import_batch to authenticated;
grant select, insert, update, delete on public.bank_transaction  to authenticated;
grant select, insert, update, delete on public.income            to authenticated;

-- ============================================================================
-- 끝. 검증: select count(*) from receipt;  → 34건 그대로여야 함.
-- ============================================================================
