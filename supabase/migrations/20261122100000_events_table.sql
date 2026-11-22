-- Events get a table of their own: a time on the schedule (a test from 2 to 4, a lecture every
-- Tuesday) with an optional length and details. The phone never reads it, so an event can't ring by
-- mistake. An event that rings at its start owns one alarm (alarms.event_id), which a trigger keeps
-- in step with it; the phone rings that alarm like any other.

create table events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null default '',
  details text not null default '' check (char_length(details) <= 4000), -- where, who, notes
  at timestamptz, -- a one-off's start
  time time, -- a repeating event's start…
  weekdays text[] not null default '{}', -- …on these days ('Mon' … 'Sun')
  minutes integer check (minutes > 0 and minutes <= 1440), -- how long it lasts; null for a moment
  rings text check (rings in ('plain', 'walk', 'situps')), -- an alarm at its start, and how it stops; null for none
  created_at timestamptz not null default now(),
  changed_at jsonb not null default '{}',
  constraint event_once_or_recurring check (
    (at is not null and time is null and cardinality(weekdays) = 0)
    or (at is null and time is not null and cardinality(weekdays) > 0)
  )
);

create index events_user on events (user_id, created_at);
create trigger keep_latest before update on events for each row execute function keep_latest();

alter table events enable row level security;
create policy "own rows" on events for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on events from anon;
grant select, insert, update, delete on events to authenticated;

alter publication supabase_realtime add table events;

-- The alarm at an event's start; deleted with its event
alter table alarms add column event_id uuid unique references events on delete cascade;

-- Keeps an event's start alarm as the event says: made when it rings, removed when it stops ringing,
-- and moved, renamed or changed in kind with it. Rewritten only when something differs, so an edit to
-- the details alone doesn't push the phone.
create function sync_event_alarm() returns trigger
language plpgsql set search_path = public as $$
begin
  if NEW.rings is null then
    delete from alarms where event_id = NEW.id;
  else
    insert into alarms (user_id, event_id, label, kind, at, time, weekdays)
    values (NEW.user_id, NEW.id, NEW.title, NEW.rings, NEW.at, NEW.time, NEW.weekdays)
    on conflict (event_id) do update
      set label = excluded.label, kind = excluded.kind, at = excluded.at, time = excluded.time, weekdays = excluded.weekdays, enabled = true
      where (alarms.label, alarms.kind, alarms.at, alarms.time, alarms.weekdays, alarms.enabled)
        is distinct from (excluded.label, excluded.kind, excluded.at, excluded.time, excluded.weekdays, true);
  end if;
  return null;
end $$;

create trigger sync_event_alarm after insert or update on events for each row execute function sync_event_alarm();

-- The events kept as alarms so far (kind 'none', or any alarm given a length) move across. One that
-- rang keeps ringing at its start, through its new alarm; one switched off no longer rings.
insert into events (user_id, title, at, time, weekdays, minutes, rings, created_at)
select user_id, label, at, time, weekdays, minutes, case when kind = 'none' or not enabled then null else kind end, created_at
from alarms where event_id is null and (kind = 'none' or minutes is not null);

delete from alarms where event_id is null and (kind = 'none' or minutes is not null);

alter table alarms drop column minutes;
alter table alarms drop constraint alarms_kind_check;
alter table alarms add constraint alarms_kind_check check (kind in ('plain', 'walk', 'situps'));

-- push_ring_due_soon as before, without the kind 'none' it no longer needs to pass over

-- Whether one of the user's own alarms, routine alarms or deadline alarms rings within `horizon`,
-- which makes the push high priority. An over-approximation of the phone's schedule: skips, ticks and
-- meal reminders are not read, so it may say yes for a ring that won't happen (a high push with no
-- ring after it, which FCM may count against the app). It reads the user's zone, as UTC until a
-- device has written one, so only then can it miss a ring that will happen.
create or replace function push_ring_due_soon(uid uuid, horizon interval) returns boolean
language sql stable security definer set search_path = '' as $$
  with zone as (
    select coalesce(s.time_zone, 'UTC') as tz
    from (select 1) one left join public.user_settings s on s.user_id = uid
  ),
  -- Yesterday, today and tomorrow, as calendar dates in the user's zone
  days as (
    select (now() at time zone zone.tz)::date + k as day, zone.tz
    from zone, generate_series(-1, 1) k
  ),
  -- Recurring rings at a time on a weekday
  recurring as (
    select (days.day + r.time) at time zone days.tz as ring_at, r.weekdays, days.day
    from days, public.routines r where r.user_id = uid and r.alarm <> 'none' and r.time is not null
    union all
    select (days.day + a.time) at time zone days.tz, a.weekdays, days.day
    from days, public.alarms a where a.user_id = uid and a.enabled and a.time is not null
  )
  select exists (
    select 1 from recurring
    where ring_at between now() and now() + horizon and to_char(day, 'Dy') = any (weekdays)
  ) or exists (
    select 1 from public.alarms a
    where a.user_id = uid and a.enabled and a.at between now() and now() + horizon
  ) or exists (
    select 1 from public.deadlines d, zone
    where d.user_id = uid and d.done_at is null and d.alarm_time is not null
      and (d.due_date + d.alarm_time) at time zone zone.tz between now() and now() + horizon
  )
$$;

revoke all on function push_ring_due_soon(uuid, interval) from public, anon, authenticated;
grant execute on function push_ring_due_soon(uuid, interval) to service_role;
