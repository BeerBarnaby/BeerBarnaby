-- Usage statistics for the staff dashboard, computed from library_visits in Thai local time.
-- Touches only library_* objects; students is read, never altered.

create index if not exists library_visits_created_at on public.library_visits (created_at);

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
                  from students st left join entered o on o.student_id = st.student_id
                 where st.is_active
                 group by 1) q)
    ));
end $$;

revoke all on function public.staff_stats(text, int) from public;
grant execute on function public.staff_stats(text, int) to anon, authenticated;
