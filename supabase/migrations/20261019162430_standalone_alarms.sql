-- Alarms of their own, apart from routines and deadlines: a one-off at a moment (a nap, a
-- reminder in an hour), or a recurring time on chosen weekdays (waking up at 6). Each can be
-- switched off without deleting it.

create table alarms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  label text not null default '',
  kind text not null default 'plain' check (kind in ('plain', 'walk', 'situps')),
  at timestamptz, -- a one-off
  time time, -- a recurring alarm's time of day…
  weekdays text[] not null default '{}', -- …on these days ('Mon' … 'Sun')
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  constraint alarm_once_or_recurring check (
    (at is not null and time is null and cardinality(weekdays) = 0)
    or (at is null and time is not null and cardinality(weekdays) > 0)
  )
);

create index alarms_user on alarms (user_id, created_at);

alter table alarms enable row level security;
create policy "own rows" on alarms for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on alarms from anon;
grant select, insert, update, delete on alarms to authenticated;

alter publication supabase_realtime add table alarms;
