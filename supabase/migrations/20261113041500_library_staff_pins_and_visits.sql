-- 1) Library-only staff PINs, so the library can have its own teacher code without touching
--    staff_users (shared with another app). _staff_auth accepts either source.
--    PINs are added outside version control (this repository is public):
--      insert into library_staff_pins (display_name, pin_hash)
--      values ('ครูห้องสมุด', extensions.crypt('<PIN>', extensions.gen_salt('bf')));
-- 2) staff_visits: who checked in on a given day, plus blocked attempts.
-- Touches only library_* objects; students / staff_users are read, never altered.

create table public.library_staff_pins (
  id           bigint generated always as identity primary key,
  display_name text        not null,
  pin_hash     text        not null,
  is_active    boolean     not null default true,
  created_at   timestamptz not null default now()
);
alter table public.library_staff_pins enable row level security;
revoke all on public.library_staff_pins from anon, authenticated;

create or replace function public._staff_auth(p_pin text) returns json
language plpgsql security definer set search_path = public, extensions
as $$
declare
  c_max_ip     constant int      := 5;
  c_max_global constant int      := 30;
  c_window     constant interval := '10 minutes';
  c_lock       constant interval := '15 minutes';
  v_ip    text := _client_ip();
  v_key   text := 'ip:' || v_ip;
  v_now   timestamptz;
  v_until timestamptz;
  v_name  text;
begin
  perform pg_advisory_xact_lock(hashtext('library_pin:' || v_ip));
  v_now := clock_timestamp();

  select max(locked_until) into v_until
    from library_pin_locks
   where key in (v_key, 'global') and locked_until > v_now;

  if v_until is null then
    select x.display_name into v_name from (
      select display_name from library_staff_pins
       where is_active and pin_hash = crypt(p_pin, pin_hash)
      union all
      select display_name from staff_users
       where is_active and access_code_hash = crypt(p_pin, access_code_hash)
    ) x limit 1;
    if v_name is not null then
      return json_build_object('ok', true, 'staff', v_name);
    end if;

    insert into library_pin_attempts (ip, attempted_at) values (v_ip, v_now);
    delete from library_pin_attempts where attempted_at < v_now - interval '1 day';

    if (select count(*) from library_pin_attempts
         where ip = v_ip and attempted_at > v_now - c_window) >= c_max_ip then
      insert into library_pin_locks (key, locked_until) values (v_key, v_now + c_lock)
      on conflict (key) do update set locked_until = excluded.locked_until;
      v_until := v_now + c_lock;
    end if;
    if (select count(*) from library_pin_attempts
         where attempted_at > v_now - c_window) >= c_max_global then
      insert into library_pin_locks (key, locked_until) values ('global', v_now + c_lock)
      on conflict (key) do update set locked_until = excluded.locked_until;
      v_until := v_now + c_lock;
    end if;

    if v_until is null then
      return json_build_object('ok', false, 'error', 'PIN ไม่ถูกต้อง');
    end if;
  end if;

  return json_build_object(
    'ok', false,
    'locked', true,
    'retry_after', ceil(extract(epoch from v_until - v_now))::int,
    'error', format('ใส่ PIN ผิดหลายครั้ง กรุณารอ %s นาทีแล้วลองใหม่',
                    ceil(extract(epoch from v_until - v_now) / 60)::int));
end $$;
revoke all on function public._staff_auth(text) from public, anon, authenticated;

create function public.staff_visits(p_pin text, p_day date default null) returns json
language plpgsql security definer set search_path = public, extensions
as $$
declare
  a       json := _staff_auth(p_pin);
  c_tz    constant text := 'Asia/Bangkok';
  v_day   date;
  v_start timestamptz;
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  v_day   := coalesce(p_day, (now() at time zone c_tz)::date);
  v_start := v_day::timestamp at time zone c_tz;

  return json_build_object('ok', true, 'day', v_day,
    'items', coalesce((
      select json_agg(x order by x.at desc) from (
        select v.student_id, st.full_name, st.class_name, st.class_no,
               min(v.created_at) as at,
               to_char(min(v.created_at) at time zone c_tz, 'HH24:MI') as time
          from library_visits v left join students st on st.student_id = v.student_id
         where v.result = 'allowed' and v.created_at >= v_start and v.created_at < v_start + interval '1 day'
         group by v.student_id, st.full_name, st.class_name, st.class_no
      ) x), '[]'::json),
    'blocked', coalesce((
      select json_agg(x order by x.at desc) from (
        select v.student_id, st.full_name, st.class_name,
               max(v.created_at) as at,
               to_char(max(v.created_at) at time zone c_tz, 'HH24:MI') as time,
               count(*) as tries,
               (select b.reason from library_blocklist b where b.student_id = v.student_id) as reason
          from library_visits v left join students st on st.student_id = v.student_id
         where v.result = 'blocked' and v.created_at >= v_start and v.created_at < v_start + interval '1 day'
         group by v.student_id, st.full_name, st.class_name
      ) x), '[]'::json));
end $$;
revoke all on function public.staff_visits(text, date) from public;
grant execute on function public.staff_visits(text, date) to anon, authenticated;
