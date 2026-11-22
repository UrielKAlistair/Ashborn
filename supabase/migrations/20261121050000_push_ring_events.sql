-- push_ring_due_soon as the schedule now reads it: events (kind 'none') don't ring, and days run midnight
-- to midnight, so a routine or a deadline's alarm rings on its own calendar date.

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
    from days, public.alarms a where a.user_id = uid and a.enabled and a.kind <> 'none' and a.time is not null
  )
  select exists (
    select 1 from recurring
    where ring_at between now() and now() + horizon and to_char(day, 'Dy') = any (weekdays)
  ) or exists (
    select 1 from public.alarms a
    where a.user_id = uid and a.enabled and a.kind <> 'none' and a.at between now() and now() + horizon
  ) or exists (
    select 1 from public.deadlines d, zone
    where d.user_id = uid and d.done_at is null and d.alarm_time is not null
      and (d.due_date + d.alarm_time) at time zone zone.tz between now() and now() + horizon
  )
$$;

revoke all on function push_ring_due_soon(uuid, interval) from public, anon, authenticated;
grant execute on function push_ring_due_soon(uuid, interval) to service_role;
