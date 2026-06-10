-- ============================================================================
-- 0003: 수입 집계 제외 플래그(income.excluded) — 중복 수입을 비파괴로 합계에서 제외.
-- ADDITIVE. 기존 행은 모두 excluded=false(집계 반영). Supabase SQL 에디터에서 실행.
-- ============================================================================

alter table public.income
  add column if not exists excluded boolean not null default false;

comment on column public.income.excluded is
  '집계 제외(중복 등). true면 수입 합계에서 빼고 회색/취소선 표시. 비파괴·되돌리기 가능.';
