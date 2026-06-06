-- ============================================================================
-- 0002: 영수증 고유번호(receipt_no) — org별 순번. PDF·원장·엑셀 교차참조용.
-- ADDITIVE. 기존 34건은 created_at 순으로 백필. Supabase SQL 에디터에서 실행.
-- ============================================================================

-- 1. 컬럼 추가
alter table public.receipt add column if not exists receipt_no integer;

-- 2. 기존 행 백필 (org별 created_at 순서대로 1,2,3…)
with numbered as (
  select
    id,
    row_number() over (partition by org_id order by created_at, id) as rn
  from public.receipt
  where receipt_no is null
)
update public.receipt r
set receipt_no = n.rn
from numbered n
where r.id = n.id;

-- 3. org별 유니크
create unique index if not exists receipt_org_no_uniq
  on public.receipt(org_id, receipt_no);

-- 4. 신규 insert 시 자동 부여 (receipt_no 가 비어있으면 org 내 max+1)
create or replace function public.set_receipt_no()
returns trigger
language plpgsql
as $$
begin
  if NEW.receipt_no is null then
    select coalesce(max(receipt_no), 0) + 1
    into NEW.receipt_no
    from public.receipt
    where org_id = NEW.org_id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_set_receipt_no on public.receipt;
create trigger trg_set_receipt_no
  before insert on public.receipt
  for each row execute function public.set_receipt_no();

-- 검증: select org_id, count(*), min(receipt_no), max(receipt_no) from receipt group by org_id;
-- ============================================================================
