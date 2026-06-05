-- ============================================================================
-- 0001_ledger.sql 되돌리기. 신규 테이블/뷰/컬럼만 제거 (기존 데이터 무영향).
-- ============================================================================
drop view if exists public.ledger_entry;

alter table if exists public.bank_transaction
  drop constraint if exists bank_transaction_matched_income_fk;

drop table if exists public.income            cascade;
drop table if exists public.bank_transaction  cascade;
drop table if exists public.bank_import_batch cascade;

-- receipt.source 제거 (기존 데이터엔 영향 없음, 컬럼만 삭제)
alter table public.receipt drop column if exists source;

-- helper 함수는 다른 곳에서 쓸 수 있으니 보존. 필요시 아래 주석 해제.
-- drop function if exists public.current_org_id();
-- drop function if exists public.is_admin();
