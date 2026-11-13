-- Library check-in: complete schema for a Supabase project of its own.
-- Nothing here refers to another app's tables. Run once on an empty project.
-- Data (students, blocklist, visits, staff PINs) is copied separately and never kept in Git,
-- because this repository is public.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- tables

-- Every student of every school that uses this library.
create table public.library_students (
  student_id text        primary key check (student_id ~ '^[0-9]{5}$'),
  title      text        not null default '',
  first_name text        not null default '',
  last_name  text        not null default '',
  full_name  text        not null,
  class_name text        not null,
  class_no   integer,
  school     text        not null,
  is_active  boolean     not null default true,
  created_at timestamptz not null default now()
);

create table public.library_blocklist (
  student_id text primary key,
  reason     text,
  added_by   text,
  until      date,
  created_at timestamptz default now()
);

create table public.library_visits (
  id         bigint generated always as identity primary key,
  student_id text,
  result     text check (result = any (array['allowed', 'blocked', 'not_found', 'repeat'])),
  created_at timestamptz default now()
);
create index library_visits_created_at   on public.library_visits (created_at);
create index library_visits_student_time on public.library_visits (student_id, created_at);

create table public.library_staff_pins (
  id           bigint generated always as identity primary key,
  display_name text        not null,
  pin_hash     text        not null,
  is_active    boolean     not null default true,
  created_at   timestamptz not null default now()
);

create table public.library_pin_attempts (
  id           bigint generated always as identity primary key,
  ip           text        not null,
  attempted_at timestamptz not null default now()
);
create index library_pin_attempts_ip_time on public.library_pin_attempts (ip, attempted_at desc);
create index library_pin_attempts_time    on public.library_pin_attempts (attempted_at desc);

create table public.library_pin_locks (
  key          text primary key,
  locked_until timestamptz not null
);

-- The functions below read students through this view, as they did in the shared project.
create view public.library_roster as
  select student_id, full_name, class_name, class_no, is_active from public.library_students;

-- No direct table access from the browser: everything goes through the functions below.
do $$
declare t text;
begin
  foreach t in array array['library_students', 'library_blocklist', 'library_visits',
                           'library_staff_pins', 'library_pin_attempts', 'library_pin_locks']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
revoke all on public.library_roster from anon, authenticated;

-- ---------------------------------------------------------------- staff PIN check

create function public._client_ip() returns text
language sql stable set search_path = ''
as $$
  select coalesce(
    nullif(trim(h ->> 'cf-connecting-ip'), ''),
    nullif(trim(split_part(h ->> 'x-forwarded-for', ',', 1)), ''),
    'unknown')
  from (select nullif(current_setting('request.headers', true), '')::json as h) s;
$$;

-- 5 wrong PINs from one IP in 10 minutes locks that IP for 15 minutes;
-- 30 wrong PINs overall in 10 minutes locks everyone for 15 minutes.
create function public._staff_auth(p_pin text) returns json
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
    select display_name into v_name from library_staff_pins
     where is_active and pin_hash = crypt(p_pin, pin_hash)
     limit 1;
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

-- ---------------------------------------------------------------- student check-in

create function public.check_in(p_id text) returns json
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

  select student_id, full_name, class_name into s from library_roster where student_id = p_id and is_active;
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

-- ---------------------------------------------------------------- staff: blocklist

create function public.staff_list(p_pin text) returns json
language plpgsql security definer set search_path = public, extensions
as $$
declare a json := _staff_auth(p_pin);
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  return json_build_object('ok', true, 'staff', a ->> 'staff', 'items',
    coalesce((select json_agg(x order by x.created_at desc) from (
      select b.student_id, st.full_name, st.class_name, b.reason, b.until, b.added_by, b.created_at,
             (b.until is null or b.until >= current_date) as active
      from library_blocklist b left join library_roster st on st.student_id = b.student_id
    ) x), '[]'::json));
end $$;

create function public.staff_block(p_pin text, p_id text, p_reason text, p_until date default null) returns json
language plpgsql security definer set search_path = public, extensions
as $$
declare a json := _staff_auth(p_pin); who text;
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  who := a ->> 'staff';
  if not exists (select 1 from library_roster where student_id = p_id and is_active) then
    return json_build_object('ok', false, 'error', 'ไม่พบรหัสนักเรียนนี้');
  end if;
  insert into library_blocklist (student_id, reason, added_by, until)
  values (p_id, p_reason, who, p_until)
  on conflict (student_id) do update
    set reason = excluded.reason, until = excluded.until, added_by = who, created_at = now();
  return json_build_object('ok', true);
end $$;

create function public.staff_unblock(p_pin text, p_id text) returns json
language plpgsql security definer set search_path = public, extensions
as $$
declare a json := _staff_auth(p_pin);
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  delete from library_blocklist where student_id = p_id;
  return json_build_object('ok', true);
end $$;

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
      from library_roster st left join library_blocklist b on b.student_id = st.student_id
      where st.is_active
    ) x), '[]'::json));
end $$;

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
    from library_roster where student_id = any(v_ids) and is_active;

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

-- ---------------------------------------------------------------- staff: visits & statistics

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
          from library_visits v left join library_roster st on st.student_id = v.student_id
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
          from library_visits v left join library_roster st on st.student_id = v.student_id
         where v.result = 'blocked' and v.created_at >= v_start and v.created_at < v_start + interval '1 day'
         group by v.student_id, st.full_name, st.class_name
      ) x), '[]'::json));
end $$;

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

create function public.staff_stats(p_pin text, p_days int default 30) returns json
language plpgsql security definer set search_path = public, extensions
as $$
declare
  a       json := _staff_auth(p_pin);
  c_tz    constant text := 'Asia/Bangkok';
  v_days  int  := least(greatest(coalesce(p_days, 30), 1), 365);
  v_today date := (now() at time zone c_tz)::date;
  v_from  date;
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  v_from := v_today - (v_days - 1);

  return (
    with v as (
      select lv.student_id, lv.result, (lv.created_at at time zone c_tz) as ts
        from library_visits lv
       where lv.created_at >= (v_from::timestamp at time zone c_tz)
    ),
    entered as (select * from v where result = 'allowed')
    select json_build_object(
      'ok', true, 'from', v_from, 'to', v_today,
      'summary', json_build_object(
        'today',     (select count(*) from entered where ts::date = v_today),
        'total',     (select count(*) from entered),
        'students',  (select count(distinct student_id) from entered),
        'blocked',   (select count(*) from v where result = 'blocked'),
        'not_found', (select count(*) from v where result = 'not_found')),
      'days', (
        select json_agg(json_build_object('day', g::date, 'count', coalesce(c.n, 0)) order by g)
          from generate_series(v_from::timestamp, v_today::timestamp, interval '1 day') g
          left join (select ts::date as dd, count(*) as n from entered group by 1) c on c.dd = g::date),
      'hours', (
        select coalesce(json_agg(json_build_object('hour', h, 'count', n) order by h), '[]'::json)
          from (select extract(hour from ts)::int as h, count(*) as n from entered group by 1) q),
      'levels', (
        select coalesce(json_agg(json_build_object('level', lvl, 'count', n, 'students', s, 'enrolled', e) order by lvl), '[]'::json)
          from (select split_part(st.class_name, '/', 1) as lvl,
                       count(o.student_id) as n,
                       count(distinct o.student_id) as s,
                       count(distinct st.student_id) as e
                  from library_roster st left join entered o on o.student_id = st.student_id
                 where st.is_active
                 group by 1) q)
    ));
end $$;

-- ---------------------------------------------------------------- who may call what

revoke all on function public._client_ip()      from public, anon, authenticated;
revoke all on function public._staff_auth(text) from public, anon, authenticated;

do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('check_in', 'staff_list', 'staff_block', 'staff_unblock', 'staff_students',
                         'staff_block_many', 'staff_unblock_many', 'staff_visits',
                         'staff_visits_clear', 'staff_stats')
  loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;
