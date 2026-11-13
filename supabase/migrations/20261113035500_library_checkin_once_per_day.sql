-- One counted check-in per student per day (Thai local time).
-- A repeat on the same day returns status 'already' with the first check-in time and is
-- logged as result 'repeat', which the statistics do not count.
-- Touches only library_* objects; students is read, never altered.

create index if not exists library_visits_student_time on public.library_visits (student_id, created_at);

create or replace function public.check_in(p_id text) returns json
language plpgsql security definer set search_path = public, extensions
as $$
declare
  c_tz  constant text := 'Asia/Bangkok';
  s     record;
  b     library_blocklist;
  v_day timestamptz := ((now() at time zone c_tz)::date)::timestamp at time zone c_tz;
  v_first timestamptz;
begin
  if p_id is null or p_id !~ '^[0-9]{5}$' then
    return json_build_object('status', 'not_found');
  end if;

  select student_id, full_name, class_name into s from students where student_id = p_id and is_active;
  if not found then
    insert into library_visits (student_id, result) values (p_id, 'not_found');
    return json_build_object('status', 'not_found');
  end if;

  select * into b from library_blocklist
   where student_id = p_id and (until is null or until >= (now() at time zone c_tz)::date);
  if found then
    insert into library_visits (student_id, result) values (p_id, 'blocked');
    return json_build_object('status', 'blocked', 'name', s.full_name, 'reason', b.reason, 'until', b.until);
  end if;

  -- two taps at the same moment must not both count
  perform pg_advisory_xact_lock(hashtext('library_checkin:' || p_id));

  select min(created_at) into v_first from library_visits
   where student_id = p_id and result = 'allowed' and created_at >= v_day;
  if v_first is not null then
    insert into library_visits (student_id, result) values (p_id, 'repeat');
    return json_build_object('status', 'already', 'name', s.full_name, 'class', s.class_name,
                             'first_at', to_char(v_first at time zone c_tz, 'HH24:MI'));
  end if;

  insert into library_visits (student_id, result) values (p_id, 'allowed');
  return json_build_object('status', 'allowed', 'name', s.full_name, 'class', s.class_name);
end $$;
