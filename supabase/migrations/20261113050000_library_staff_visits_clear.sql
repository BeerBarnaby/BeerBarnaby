-- Let staff remove check-ins for one day: either chosen students (a mistaken check-in) or the
-- whole day (p_ids null). Removes every library_visits row of that day for those students,
-- whatever the result, so the day can be checked in afresh. Touches only library_visits.

create function public.staff_visits_clear(p_pin text, p_day date, p_ids text[] default null) returns json
language plpgsql security definer set search_path = public, extensions
as $$
declare
  a       json := _staff_auth(p_pin);
  c_tz    constant text := 'Asia/Bangkok';
  v_start timestamptz;
  n_rows  int;
  n_people int;
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  if p_day is null then
    return json_build_object('ok', false, 'error', 'ไม่ได้ระบุวันที่');
  end if;
  if p_ids is not null and cardinality(p_ids) = 0 then
    return json_build_object('ok', false, 'error', 'ยังไม่ได้เลือกนักเรียน');
  end if;
  v_start := p_day::timestamp at time zone c_tz;

  with d as (
    delete from library_visits
     where created_at >= v_start and created_at < v_start + interval '1 day'
       and (p_ids is null or student_id = any(p_ids))
    returning student_id, result
  )
  select count(*), count(distinct student_id) filter (where result = 'allowed') into n_rows, n_people from d;

  return json_build_object('ok', true, 'removed', n_rows, 'students', n_people);
end $$;
revoke all on function public.staff_visits_clear(text, date, text[]) from public;
grant execute on function public.staff_visits_clear(text, date, text[]) to anon, authenticated;
