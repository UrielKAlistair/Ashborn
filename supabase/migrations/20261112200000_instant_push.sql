-- Instant alarm sync: every change to the rows the phone's alarm schedule is built from asks the
-- `push` Edge Function to send the user's phones an FCM data message, so the phone refreshes its
-- alarms within seconds instead of at its next 15-minute wake. Calls (alarms with sound 'call') are
-- rung by an agent that needs the user (MCP tool call_user).
--
-- The trigger reads the function's address and shared secret from Vault (`push_url`,
-- `push_secret`), set once by hand; without them it does nothing.

create extension if not exists pg_net with schema extensions;

-- A phone's FCM registration token, written by the phone's background session
create table push_devices (
  token text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  updated_at timestamptz not null default now()
);

create index push_devices_user on push_devices (user_id);

alter table push_devices enable row level security;
create policy "own rows" on push_devices for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on push_devices from anon;
grant select, insert, update, delete on push_devices to authenticated;

-- The sound an alarm rings with: 'call' is an agent calling the user (its tune once, obeys the ringer)
alter table alarms
  add column sound text not null default 'default' check (sound in ('default', 'call'));

-- The latest push asked for, per user: the Edge Function sends a normal push only if no later one
-- was asked for while it waited (a trailing debounce)
create table push_requests (
  user_id uuid primary key references auth.users on delete cascade,
  asked_at timestamptz not null
);

alter table push_requests enable row level security;
revoke all on push_requests from anon, authenticated;

-- The calls already pushed: each call's high message goes once, so FCM sees one high per ring
create table call_pushes (
  alarm_id uuid primary key references alarms on delete cascade,
  pushed_at timestamptz not null default now()
);

alter table call_pushes enable row level security;
revoke all on call_pushes from anon, authenticated;
grant select, insert on call_pushes to service_role;

-- Asks for a push to the writing user's phones. Statement-level, so a statement touching many rows
-- asks once. pg_net sends the request after the transaction commits, so the function reads the
-- committed rows. Writes with no signed-in user (service role, migrations) ask nothing.
create function request_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  push_url text;
  push_secret text;
begin
  if uid is null then return null; end if;
  select decrypted_secret into push_url from vault.decrypted_secrets where name = 'push_url';
  select decrypted_secret into push_secret from vault.decrypted_secrets where name = 'push_secret';
  if push_url is null or push_secret is null then return null; end if;
  perform net.http_post(
    url := push_url,
    body := jsonb_build_object('user_id', uid, 'table', tg_table_name),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', push_secret),
    timeout_milliseconds := 5000
  );
  return null;
end $$;

revoke all on function request_push() from public, anon, authenticated;

-- The rows AlarmRefreshWorker.read builds the schedule from
do $$
declare t text;
begin
  foreach t in array array['alarms', 'routines', 'routine_checks', 'deadlines', 'alarm_skips', 'user_settings',
                           'recipes', 'recipe_reminders', 'default_meals', 'default_meal_recipes', 'meals', 'meal_recipes'] loop
    execute format('create trigger request_push after insert or update or delete on public.%I for each statement execute function request_push()', t);
  end loop;
end $$;

-- Whether one of the user's own alarms, routine alarms or deadline alarms rings within `horizon`,
-- which makes the push high priority. An over-approximation of the phone's schedule: skips, ticks and
-- meal reminders are not read, so it may say yes for a ring that won't happen (a high push with no
-- ring after it, which FCM may count against the app). It reads the user's zone, as UTC until a
-- device has written one, so only then can it miss a ring that will happen.
create function push_ring_due_soon(uid uuid, horizon interval) returns boolean
language sql stable security definer set search_path = '' as $$
  with zone as (
    select coalesce(s.time_zone, 'UTC') as tz, coalesce(s.day_start_hour, 4) as day_start
    from (select 1) one left join public.user_settings s on s.user_id = uid
  ),
  -- Yesterday, today and tomorrow, as calendar dates in the user's zone
  days as (
    select (now() at time zone zone.tz)::date + k as day, zone.tz, zone.day_start
    from zone, generate_series(-1, 1) k
  ),
  -- Recurring rings at a time on a weekday. A routine's weekday is of the app's day, which starts at
  -- day_start (a 02:00 ring on Monday's day rings on Tuesday's calendar date); an alarm keeps the calendar.
  recurring as (
    select (days.day + r.time) at time zone days.tz as ring_at, r.weekdays,
      case when r.time < make_time(days.day_start, 0, 0) then days.day - 1 else days.day end as weekday_of
    from days, public.routines r where r.user_id = uid and r.alarm <> 'none' and r.time is not null
    union all
    select (days.day + a.time) at time zone days.tz, a.weekdays, days.day
    from days, public.alarms a where a.user_id = uid and a.enabled and a.time is not null
  )
  select exists (
    select 1 from recurring
    where ring_at between now() and now() + horizon and to_char(weekday_of, 'Dy') = any (weekdays)
  ) or exists (
    select 1 from public.alarms a
    where a.user_id = uid and a.enabled and a.at between now() and now() + horizon
  ) or exists (
    select 1 from public.deadlines d, zone
    where d.user_id = uid and d.done_at is null and d.alarm_time is not null
      and ((d.due_date + case when d.alarm_time < make_time(zone.day_start, 0, 0) then 1 else 0 end) + d.alarm_time)
          at time zone zone.tz between now() and now() + horizon
  )
$$;

revoke all on function push_ring_due_soon(uuid, interval) from public, anon, authenticated;
grant execute on function push_ring_due_soon(uuid, interval) to service_role;
grant select, insert, update, delete on push_requests to service_role;
grant select, delete on push_devices to service_role;
