-- Students from another school who share this library, kept in a library-only table so the
-- shared students table (used by another app) is not touched. Their names are loaded outside
-- version control (this repository is public).
-- library_roster = both schools; every library function now reads it instead of students.

create table public.library_students (
  student_id text        primary key check (student_id ~ '^[0-9]{5}$'),
  title      text        not null default '',
  first_name text        not null,
  last_name  text        not null,
  full_name  text        not null,
  class_name text        not null,
  class_no   integer,
  school     text        not null,
  is_active  boolean     not null default true,
  created_at timestamptz not null default now()
);
alter table public.library_students enable row level security;
revoke all on public.library_students from anon, authenticated;

-- On an id clash the shared students table wins.
create view public.library_roster as
  select student_id, full_name, class_name, class_no, is_active from public.students
  union all
  select ls.student_id, ls.full_name, ls.class_name, ls.class_no, ls.is_active
    from public.library_students ls
   where not exists (select 1 from public.students s where s.student_id = ls.student_id);
revoke all on public.library_roster from anon, authenticated;

-- Point each library function at library_roster: rewrite only "from students" / "join students".
do $$
declare
  f   regprocedure;
  def text;
  new text;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('check_in', 'staff_block', 'staff_block_many', 'staff_list',
                         'staff_students', 'staff_stats', 'staff_visits')
  loop
    def := pg_get_functiondef(f);
    new := regexp_replace(def, '\m(from|join)(\s+)students\M', '\1\2library_roster', 'g');
    if new = def then
      raise exception 'no students reference found in %', f;
    end if;
    execute new;
  end loop;
end $$;
