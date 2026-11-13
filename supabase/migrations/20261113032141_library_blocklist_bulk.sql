-- Migration: library_blocklist_bulk
-- Lets staff tick several students and block / unblock them with one shared reason.
-- Requires 01_library_pin_bruteforce_protection (uses _staff_auth).
-- Touches only library_* objects; students is read, never altered.


-- Roster for the picker: every active student plus their current block, if any.
create function public.staff_students(p_pin text) returns json
language plpgsql security definer set search_path = public, extensions
as $$
declare a json := _staff_auth(p_pin);
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  return json_build_object('ok', true, 'items',
    coalesce((select json_agg(x order by x.class_name, x.class_no, x.student_id) from (
      select st.student_id, st.full_name, st.class_name, st.class_no,
             (b.student_id is not null and (b.until is null or b.until >= current_date)) as blocked,
             b.reason, b.until
      from students st left join library_blocklist b on b.student_id = st.student_id
      where st.is_active
    ) x), '[]'::json));
end $$;

-- Block many students with one reason. Unknown / inactive ids are skipped and reported.
create function public.staff_block_many(p_pin text, p_ids text[], p_reason text, p_until date default null) returns json
language plpgsql security definer set search_path = public, extensions
as $$
declare a json := _staff_auth(p_pin); who text; v_ids text[]; v_ok text[];
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  who := a ->> 'staff';
  select coalesce(array_agg(distinct i), '{}') into v_ids from unnest(p_ids) i where i is not null;
  if cardinality(v_ids) = 0 then
    return json_build_object('ok', false, 'error', 'ยังไม่ได้เลือกนักเรียน');
  end if;
  if cardinality(v_ids) > 1000 then
    return json_build_object('ok', false, 'error', 'เลือกได้ไม่เกิน 1000 คนต่อครั้ง');
  end if;
  select coalesce(array_agg(student_id), '{}') into v_ok
    from students where student_id = any(v_ids) and is_active;

  insert into library_blocklist (student_id, reason, added_by, until)
  select i, p_reason, who, p_until from unnest(v_ok) i
  on conflict (student_id) do update
    set reason = excluded.reason, until = excluded.until, added_by = who, created_at = now();

  return json_build_object('ok', true, 'count', cardinality(v_ok),
    'not_found', (select coalesce(json_agg(i), '[]'::json) from unnest(v_ids) i where i <> all(v_ok)));
end $$;

create function public.staff_unblock_many(p_pin text, p_ids text[]) returns json
language plpgsql security definer set search_path = public, extensions
as $$
declare a json := _staff_auth(p_pin); n int;
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  delete from library_blocklist where student_id = any(p_ids);
  get diagnostics n = row_count;
  return json_build_object('ok', true, 'count', n);
end $$;

-- Blocklist view for staff: adds class_name and an "active" flag (false = expired block).
create or replace function public.staff_list(p_pin text) returns json
language plpgsql security definer set search_path = public, extensions
as $$
declare a json := _staff_auth(p_pin);
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  return json_build_object('ok', true, 'staff', a ->> 'staff', 'items',
    coalesce((select json_agg(x order by x.created_at desc) from (
      select b.student_id, st.full_name, st.class_name, b.reason, b.until, b.added_by, b.created_at,
             (b.until is null or b.until >= current_date) as active
      from library_blocklist b left join students st on st.student_id = b.student_id
    ) x), '[]'::json));
end $$;

revoke all on function public.staff_students(text)                      from public;
revoke all on function public.staff_block_many(text, text[], text, date) from public;
revoke all on function public.staff_unblock_many(text, text[])           from public;
grant execute on function public.staff_students(text)                      to anon, authenticated;
grant execute on function public.staff_block_many(text, text[], text, date) to anon, authenticated;
grant execute on function public.staff_unblock_many(text, text[])           to anon, authenticated;

