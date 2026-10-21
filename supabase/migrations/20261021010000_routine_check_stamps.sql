-- Routine ticks keep the change made later, like every other field: a tick is a row with `checked`,
-- stamped and kept by keep_latest, instead of a row that is inserted or deleted. Existing ticks
-- become checked rows with no stamp, so any stamped change replaces them.

alter table routine_checks add column checked boolean not null default true;
alter table routine_checks add column changed_at jsonb not null default '{}';

create trigger keep_latest before update on routine_checks for each row execute function keep_latest();

-- A day's first tick is an insert, which keep_latest does not see: clamp its stamps to now there,
-- so a device clock running fast cannot lock the tick
create function clamp_stamps() returns trigger
language plpgsql set search_path = public as $$
begin
  NEW.changed_at := coalesce(
    (select jsonb_object_agg(key, least((value #>> '{}')::timestamptz, now())) from jsonb_each(NEW.changed_at)),
    '{}'
  );
  return NEW;
end;
$$;

create trigger clamp_stamps before insert on routine_checks for each row execute function clamp_stamps();
