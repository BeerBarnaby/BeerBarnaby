-- Allow the 'repeat' result written by check_in for a second check-in on the same day.
alter table public.library_visits drop constraint library_visits_result_check;
alter table public.library_visits add constraint library_visits_result_check
  check (result = any (array['allowed', 'blocked', 'not_found', 'repeat']));
