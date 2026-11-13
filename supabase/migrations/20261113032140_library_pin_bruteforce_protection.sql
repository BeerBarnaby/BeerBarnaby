-- Migration: library_pin_bruteforce_protection
-- Brute-force protection for the library staff PIN.
-- Policy: 5 wrong PINs from one IP within 10 minutes -> that IP is locked for 15 minutes.
--         30 wrong PINs overall within 10 minutes   -> every caller is locked for 15 minutes.
-- Touches only library_* objects; students / staff_users are read, never altered.


create table public.library_pin_attempts (
  id           bigint generated always as identity primary key,
  ip           text        not null,
  attempted_at timestamptz not null default now()
);
create index library_pin_attempts_ip_time on public.library_pin_attempts (ip, attempted_at desc);
create index library_pin_attempts_time    on public.library_pin_attempts (attempted_at desc);

create table public.library_pin_locks (
  key          text primary key,          -- 'ip:<address>' or 'global'
  locked_until timestamptz not null
);

alter table public.library_pin_attempts enable row level security;
alter table public.library_pin_locks    enable row level security;
revoke all on public.library_pin_attempts, public.library_pin_locks from anon, authenticated;

-- Caller address as seen by the API gateway. cf-connecting-ip is set by the edge and
-- cannot be supplied by the caller; the first x-forwarded-for entry is only a fallback.
create function public._client_ip() returns text
language sql stable set search_path = ''
as $$
  select coalesce(
    nullif(trim(h ->> 'cf-connecting-ip'), ''),
    nullif(trim(split_part(h ->> 'x-forwarded-for', ',', 1)), ''),
    'unknown')
  from (select nullif(current_setting('request.headers', true), '')::json as h) s;
$$;

-- Returns {"ok":true,"staff":name} or {"ok":false,"error":text[,"locked":true,"retry_after":seconds]}.
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
  -- one attempt at a time per address, so parallel requests cannot outrun the counter
  perform pg_advisory_xact_lock(hashtext('library_pin:' || v_ip));
  v_now := clock_timestamp();

  select max(locked_until) into v_until
    from library_pin_locks
   where key in (v_key, 'global') and locked_until > v_now;

  if v_until is null then
    select display_name into v_name
      from staff_users
     where is_active and access_code_hash = crypt(p_pin, access_code_hash)
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

revoke all on function public._client_ip()      from public, anon, authenticated;
revoke all on function public._staff_auth(text) from public, anon, authenticated;

-- Staff RPCs: same signatures and JSON shape, now authenticated through _staff_auth.
create or replace function public.staff_list(p_pin text) returns json
language plpgsql security definer set search_path = public, extensions
as $$
declare a json := _staff_auth(p_pin);
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  return json_build_object('ok', true, 'staff', a ->> 'staff', 'items',
    coalesce((select json_agg(x order by x.created_at desc) from (
      select b.student_id, st.full_name, b.reason, b.until, b.added_by, b.created_at
      from library_blocklist b left join students st on st.student_id = b.student_id
    ) x), '[]'::json));
end $$;

create or replace function public.staff_block(p_pin text, p_id text, p_reason text, p_until date default null) returns json
language plpgsql security definer set search_path = public, extensions
as $$
declare a json := _staff_auth(p_pin); who text;
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  who := a ->> 'staff';
  if not exists (select 1 from students where student_id = p_id and is_active) then
    return json_build_object('ok', false, 'error', 'ไม่พบรหัสนักเรียนนี้');
  end if;
  insert into library_blocklist (student_id, reason, added_by, until)
  values (p_id, p_reason, who, p_until)
  on conflict (student_id) do update
    set reason = excluded.reason, until = excluded.until, added_by = who, created_at = now();
  return json_build_object('ok', true);
end $$;

create or replace function public.staff_unblock(p_pin text, p_id text) returns json
language plpgsql security definer set search_path = public, extensions
as $$
declare a json := _staff_auth(p_pin);
begin
  if not (a ->> 'ok')::boolean then return a; end if;
  delete from library_blocklist where student_id = p_id;
  return json_build_object('ok', true);
end $$;

