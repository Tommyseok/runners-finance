-- ============================================================================
-- 0004: 수입 항목 확장 — 수련회비·QT도서비 추가 (60,000=수련회비, 10,000=QT도서비 관례)
-- ADDITIVE(제약 확장). Supabase SQL 에디터에서 실행.
-- ============================================================================

alter table public.income drop constraint if exists income_category_check;
alter table public.income add constraint income_category_check
  check (category in ('헌금','회비','수련회비','QT도서비','전도금','지원금','잡수입','기타'));
