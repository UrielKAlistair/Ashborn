-- An alarm can mark a time on the schedule without ringing (kind 'none': a test from 11 to 1, a lecture),
-- and any alarm can say how long what it marks lasts (minutes; null for a moment).

do $$
declare
  kind_check text;
begin
  select conname into kind_check from pg_constraint
  where conrelid = 'alarms'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%';
  execute format('alter table alarms drop constraint %I', kind_check);
end $$;

alter table alarms add constraint alarms_kind_check check (kind in ('none', 'plain', 'walk', 'situps'));
alter table alarms add column minutes integer check (minutes > 0 and minutes <= 1440);
