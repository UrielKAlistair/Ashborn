-- What the push function needs beyond 20261112200000. It holds no access to the user's tables, so it
-- reads the calls due through a function, as it reads whether a ring is due soon; and it unclaims a
-- call that no phone was sent, so the next push tries it again.

-- The user's calls (alarms with sound 'call', switched on) set from `stale` ago to `horizon` ahead
create function push_due_calls(uid uuid, stale interval, horizon interval)
returns table (id uuid, at timestamptz, label text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.at, a.label from public.alarms a
  where a.user_id = uid and a.sound = 'call' and a.enabled and a.at between now() - stale and now() + horizon
$$;

revoke all on function push_due_calls(uuid, interval, interval) from public, anon, authenticated;
grant execute on function push_due_calls(uuid, interval, interval) to service_role;
grant delete on call_pushes to service_role;
