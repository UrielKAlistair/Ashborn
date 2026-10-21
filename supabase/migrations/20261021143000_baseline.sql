-- Ashborn's data: the thread graph, level-ups, routines, deadlines, alarms and the Kitchen. Every
-- row belongs to the user who created it, and row-level security keeps each user to their own rows.
-- Two devices may edit offline: per field, the change made later wins, judged by the stamp the
-- device put on it (`changed_at`, column name → when it was set) rather than by arrival.

-- Stamps --------------------------------------------------------------------------------------

-- Whether a change stamped `at` may replace what was stamped under `key`. A stamp from a clock
-- running fast counts as now, so it cannot lock the field.
create function is_later(stored jsonb, key text, at timestamptz) returns boolean
language sql stable set search_path = '' as $$
  select stored->>key is null or (stored->>key)::timestamptz < least(at, now())
$$;

create function with_stamp(stored jsonb, key text, at timestamptz) returns jsonb
language sql stable set search_path = '' as $$
  select stored || jsonb_build_object(key, least(at, now()))
$$;

-- For each column an update changes: keep the old value if the incoming stamp is not later than
-- the stored one, else record the new stamp. A column changed without a stamp (an SQL function
-- such as move_node) is stamped now.
create function keep_latest() returns trigger
language plpgsql set search_path = public as $$
declare
  incoming jsonb := case when NEW.changed_at is distinct from OLD.changed_at then NEW.changed_at else '{}' end;
  old_row jsonb := to_jsonb(OLD);
  result jsonb := to_jsonb(NEW);
  stamps jsonb := OLD.changed_at;
  field text;
  at timestamptz;
begin
  for field in select jsonb_object_keys(result) loop
    continue when field in ('id', 'user_id', 'created_at', 'changed_at') or result->field is not distinct from old_row->field;
    at := coalesce((incoming->>field)::timestamptz, now());
    if is_later(stamps, field, at) then
      stamps := with_stamp(stamps, field, at);
    else
      result := jsonb_set(result, array[field], old_row->field);
    end if;
  end loop;
  NEW := jsonb_populate_record(NEW, result);
  NEW.changed_at := stamps;
  return NEW;
end;
$$;

-- An insert, which keep_latest does not see, has its stamps clamped to now, so a device clock
-- running fast cannot lock the row
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

-- The thread graph ----------------------------------------------------------------------------

-- A map from stat key to a number ≥ 0
create function valid_stat_weights(weights jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(weights) <> 'object' then false else not exists (
    select 1 from jsonb_each(weights) w
    where w.key not in ('STR', 'DEX', 'INT', 'WIS', 'CHR', 'MND')
      or case when jsonb_typeof(w.value) = 'number' then (w.value)::numeric < 0 else true end
  ) end
$$;

-- A thread (no parent) or a step inside a thread or another step. A thread trains stats with
-- weights, {"INT": 0.2, "CHR": 0.1}: each XP earned in it adds weight × XP to each stat. A shelved
-- node stays on the graph, greyed, and nothing inside it is offered as ready. Position and size are
-- where the user put it on the desktop canvas, relative to its box; null is laid out automatically.
create table graph_nodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  parent_id uuid references graph_nodes on delete cascade, -- null for a thread
  title text not null,
  stat_weights jsonb not null default '{}' check (valid_stat_weights(stat_weights)), -- threads only
  active boolean not null default true, -- threads only: shown on the dashboard
  color text check (color in ('red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink')), -- threads only; null is white
  shelved boolean not null default false,
  x double precision,
  y double precision,
  width double precision,
  height double precision,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  changed_at jsonb not null default '{}'
);

-- from_id is a prerequisite of to_id; both have the same parent
create table graph_edges (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  from_id uuid not null references graph_nodes on delete cascade,
  to_id uuid not null references graph_nodes on delete cascade,
  primary key (from_id, to_id)
);

-- One row per level-up. Its event_id is made by the device, so sending it twice records it once.
create table progress_log (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  node_id uuid not null references graph_nodes on delete cascade,
  amount integer not null,
  logged_at timestamptz not null default now(),
  event_id uuid unique
);

create index graph_nodes_user on graph_nodes (user_id, created_at);
create index graph_nodes_parent on graph_nodes (parent_id);
create index graph_nodes_completed on graph_nodes (user_id, completed_at);
create index graph_edges_to on graph_edges (to_id);
create index progress_log_node on progress_log (node_id);
create index progress_log_time on progress_log (user_id, logged_at);

create trigger keep_latest before update on graph_nodes for each row execute function keep_latest();

-- Nodes with the XP logged on them by level-ups. The view is updatable (the XP column aside), so the
-- app reads and writes nodes through it and gets the XP back in one round trip.
create view nodes_with_xp with (security_invoker = true) as
  select n.id, n.user_id, n.parent_id, n.title, n.stat_weights, n.active, n.created_at, n.completed_at,
    (select coalesce(sum(p.amount), 0) from progress_log p where p.node_id = n.id)::integer as logged_xp,
    n.x, n.y, n.width, n.height, n.color, n.shelved, n.changed_at
  from graph_nodes n;

-- Links two siblings, refusing links across boxes and links that would close a loop
create function add_edge(source_id uuid, target_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if (select parent_id from graph_nodes where id = source_id)
     is distinct from (select parent_id from graph_nodes where id = target_id) then
    raise exception 'Only nodes in the same box can be linked.';
  end if;

  if source_id = target_id or exists (
    with recursive downstream(id) as (
      select target_id
      union
      select e.to_id from graph_edges e join downstream d on e.from_id = d.id
    )
    select 1 from downstream where id = source_id
  ) then
    raise exception 'That link would make a loop.';
  end if;

  insert into graph_edges (from_id, to_id) values (source_id, target_id) on conflict do nothing;
end $$;

-- Deletes a node and returns its id and its steps' ids at every depth (the foreign keys cascade
-- the delete to all of them)
create function delete_node(target uuid) returns setof uuid
language sql security invoker set search_path = public as $$
  with recursive subtree(id) as (
    select target
    union all
    select g.id from graph_nodes g join subtree s on g.parent_id = s.id
  ),
  removed as (delete from graph_nodes where id = target)
  select id from subtree;
$$;

-- Moves a node into another box (or makes it a thread when new_parent is null). Links only join
-- siblings, so the node's links are removed and returned. A node cannot move inside itself.
create function move_node(target uuid, new_parent uuid) returns table (from_id uuid, to_id uuid)
language plpgsql security invoker set search_path = public as $$
begin
  if new_parent is not null and exists (
    with recursive subtree(id) as (
      select target
      union all
      select g.id from graph_nodes g join subtree s on g.parent_id = s.id
    )
    select 1 from subtree where id = new_parent
  ) then
    raise exception 'A node cannot move inside itself.';
  end if;

  return query
    delete from graph_edges e where e.from_id = target or e.to_id = target
    returning e.from_id, e.to_id;
  update graph_nodes set parent_id = new_parent where id = target;
end $$;

-- Places several nodes in one request: each gets a position, and a size when one is given.
-- Dropping a dragged node pins its siblings where they are too, so they do not jump.
create function place_nodes(places jsonb) returns setof uuid
language sql security invoker set search_path = public as $$
  update graph_nodes g
  set x = p.x, y = p.y, width = coalesce(p.width, g.width), height = coalesce(p.height, g.height)
  from jsonb_to_recordset(places) as p(id uuid, x double precision, y double precision, width double precision, height double precision)
  where g.id = p.id
  returning g.id;
$$;

-- Routines, deadlines and alarms --------------------------------------------------------------

-- A recurring obligation on chosen weekdays. It can happen at a time of day and ring an alarm then:
-- a plain one, or one that only stops after a physical challenge (walking, sit-ups).
create table routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  cue text not null default '',
  weekdays text[] not null, -- 'Mon' … 'Sun'
  time time,
  alarm text not null default 'none' check (alarm in ('none', 'plain', 'walk', 'situps')),
  created_at timestamptz not null default now(),
  changed_at jsonb not null default '{}',
  constraint routine_alarm_needs_time check (alarm = 'none' or time is not null)
);

-- A routine's tick for a day: a row with `checked`, stamped, rather than a row inserted or deleted
create table routine_checks (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  routine_id uuid not null references routines on delete cascade,
  date date not null,
  checked boolean not null default true,
  changed_at jsonb not null default '{}',
  primary key (routine_id, date)
);

-- A dated obligation, which can ring an alarm at a time on its due day
create table deadlines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  due_date date not null,
  alarm_time time,
  done_at timestamptz,
  changed_at jsonb not null default '{}'
);

-- An alarm of its own: a one-off at a moment (a nap), or a recurring time on chosen weekdays
-- (waking up at 6). Each can be switched off without deleting it.
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
  changed_at jsonb not null default '{}',
  constraint alarm_once_or_recurring check (
    (at is not null and time is null and cardinality(weekdays) = 0)
    or (at is null and time is not null and cardinality(weekdays) > 0)
  )
);

create index routine_checks_date on routine_checks (user_id, date);
create index deadlines_open on deadlines (user_id, due_date) where done_at is null;
create index alarms_user on alarms (user_id, created_at);

create trigger keep_latest before update on routines for each row execute function keep_latest();
create trigger keep_latest before update on routine_checks for each row execute function keep_latest();
create trigger clamp_stamps before insert on routine_checks for each row execute function clamp_stamps();
create trigger keep_latest before update on deadlines for each row execute function keep_latest();
create trigger keep_latest before update on alarms for each row execute function keep_latest();

-- The Kitchen ---------------------------------------------------------------------------------
-- Stock of bulk staples, recipes, and a meal plan over a default week. Amounts are in base units
-- (g, ml, count).

-- A bulk staple. `unit` is how it is shown (kg); `target` is in the unit's base (g).
create table stock_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  unit text not null check (unit in ('g', 'kg', 'ml', 'l', 'count')),
  target numeric not null default 0 check (target >= 0),
  created_at timestamptz not null default now(),
  changed_at jsonb not null default '{}'
);

create table recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  body text not null default '', -- free text for the reader, never parsed
  created_at timestamptz not null default now(),
  changed_at jsonb not null default '{}'
);

-- What a recipe deducts when a meal using it is cooked. `amount` is in the base unit of the item's
-- kind; `unit` is the unit it was written in, for showing it. A dropped stock item leaves the
-- ingredient untracked; `name` still says what it was.
create table recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  recipe_id uuid not null references recipes on delete cascade,
  item_id uuid references stock_items on delete set null,
  name text not null,
  amount numeric not null check (amount > 0),
  unit text not null check (unit in ('g', 'kg', 'ml', 'l', 'count')),
  position integer not null default 0
);

-- Alarms a recipe sets when it is scheduled: `offset_minutes` from the meal's time, or from another
-- reminder of the same recipe (`anchor_id`)
create table recipe_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  recipe_id uuid not null references recipes on delete cascade,
  label text not null,
  offset_minutes integer not null,
  anchor_id uuid,
  position integer not null default 0,
  unique (recipe_id, id),
  foreign key (recipe_id, anchor_id) references recipe_reminders (recipe_id, id)
    on delete set null (anchor_id) deferrable initially deferred
);

-- A meal planned, cooked or cancelled on a date. A day nobody touched stores nothing and shows the
-- default week. Rows are never deleted.
create table meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null,
  slot text not null check (slot in ('breakfast', 'lunch', 'dinner')),
  description text not null default '',
  status text not null default 'planned' check (status in ('planned', 'cooked', 'cancelled')),
  created_at timestamptz not null default now(),
  changed_at jsonb not null default '{}',
  unique (user_id, date, slot)
);

create table meal_recipes (
  meal_id uuid not null references meals on delete cascade,
  recipe_id uuid not null references recipes on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  primary key (meal_id, recipe_id)
);

-- What a weekday's slot shows when that date has no meal of its own
create table default_meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  weekday text not null check (weekday in ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')),
  slot text not null check (slot in ('breakfast', 'lunch', 'dinner')),
  description text not null default '',
  changed_at jsonb not null default '{}',
  unique (user_id, weekday, slot)
);

create table default_meal_recipes (
  default_meal_id uuid not null references default_meals on delete cascade,
  recipe_id uuid not null references recipes on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  primary key (default_meal_id, recipe_id)
);

-- A stock reading (the amount on hand when counted) or a meal event (what cooking took). On hand is
-- the latest reading plus the meal events made after it.
create table stock_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  item_id uuid not null references stock_items on delete cascade,
  meal_id uuid references meals on delete cascade,
  amount numeric not null,
  kind text not null default 'meal' check (kind in ('reading', 'meal')),
  made_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint meal_events_have_meals check ((kind = 'meal') = (meal_id is not null))
);

create index recipe_ingredients_recipe on recipe_ingredients (recipe_id);
create index recipe_reminders_recipe on recipe_reminders (recipe_id);
create index stock_changes_item on stock_changes (item_id);
create index stock_changes_meal on stock_changes (meal_id);
create index stock_changes_readings on stock_changes (item_id, made_at) where kind = 'reading';

create trigger keep_latest before update on stock_items for each row execute function keep_latest();

-- Stock items with the amount on hand and when it was last counted
create view stock_on_hand with (security_invoker = true) as
  select s.id, s.user_id, s.name, s.unit, s.target, s.created_at,
    coalesce(r.amount, 0) + coalesce((
      select sum(c.amount) from stock_changes c
      where c.item_id = s.id and c.kind = 'meal' and (r.made_at is null or c.made_at > r.made_at)
    ), 0) as on_hand,
    s.changed_at, r.made_at as read_at
  from stock_items s
  left join lateral (
    select c.amount, c.made_at from stock_changes c
    where c.item_id = s.id and c.kind = 'reading' order by c.made_at desc limit 1
  ) r on true;

-- The Kitchen's functions take the stamp of the change; each object (a meal's plan, its cooking, a
-- default meal, a recipe) has one stamp, and an older change of it does nothing.

-- Plans or cancels a meal: its description and recipes replace what the date had. A cooked meal
-- stays cooked when edited, and cannot be cancelled.
create function set_meal(meal_id uuid, meal_date date, meal_slot text, meal_description text, recipe_ids uuid[], meal_status text, changed timestamptz)
returns void language plpgsql security invoker set search_path = public as $$
declare
  target uuid;
  current_status text;
  stamps jsonb;
begin
  if meal_status not in ('planned', 'cancelled') then
    raise exception 'A meal is planned or cancelled here; cooking is cook_meal.';
  end if;
  select id, status, changed_at into target, current_status, stamps from meals where date = meal_date and slot = meal_slot;
  if target is not null and not is_later(stamps, 'meal', changed) then return; end if;
  if current_status = 'cooked' and meal_status = 'cancelled' then
    raise exception 'This meal was cooked; untick it before cancelling it.';
  end if;

  insert into meals (id, date, slot, description, status, changed_at)
    values (meal_id, meal_date, meal_slot, meal_description, meal_status, with_stamp('{}', 'meal', changed))
    on conflict (user_id, date, slot) do update
      set description = excluded.description,
          status = case when meals.status = 'cooked' then 'cooked' else excluded.status end,
          changed_at = with_stamp(meals.changed_at, 'meal', changed)
    returning id into target;

  delete from meal_recipes where meal_recipes.meal_id = target;
  insert into meal_recipes (meal_id, recipe_id) select target, unnest(recipe_ids);
end;
$$;

-- Marks a meal cooked and records what its recipes' tracked ingredients took from stock. A date
-- with no meal of its own first copies the default week's. Cooking again replaces the earlier
-- events. Cooking and unticking share one stamp, apart from the plan's, so re-planning a meal never
-- undoes its cooking. Returns the names of ingredients no longer tracked.
create function cook_meal(meal_id uuid, meal_date date, meal_slot text, changed timestamptz)
returns text[] language plpgsql security invoker set search_path = public as $$
declare
  target uuid;
  stamps jsonb;
  inserted boolean;
  untracked text[];
begin
  select id, changed_at into target, stamps from meals where date = meal_date and slot = meal_slot;
  if target is not null and not is_later(stamps, 'cooked', changed) then return '{}'; end if;

  insert into meals (id, date, slot, description, status, changed_at)
    select meal_id, meal_date, meal_slot, coalesce(d.description, ''), 'cooked', with_stamp('{}', 'cooked', changed)
    from (select 1) one
    left join default_meals d on d.weekday = to_char(meal_date, 'Dy') and d.slot = meal_slot
    on conflict (user_id, date, slot) do update
      set status = 'cooked', changed_at = with_stamp(meals.changed_at, 'cooked', changed)
    returning id, (xmax = 0) into target, inserted;

  if inserted then
    insert into meal_recipes (meal_id, recipe_id)
      select target, r.recipe_id
      from default_meal_recipes r join default_meals d on d.id = r.default_meal_id
      where d.weekday = to_char(meal_date, 'Dy') and d.slot = meal_slot;
  end if;

  delete from stock_changes where stock_changes.meal_id = target;
  insert into stock_changes (item_id, meal_id, amount, kind, made_at)
    select i.item_id, target, -i.amount, 'meal', least(changed, now())
    from meal_recipes m join recipe_ingredients i on i.recipe_id = m.recipe_id
    where m.meal_id = target and i.item_id is not null;

  select coalesce(array_agg(i.name order by i.name), '{}') into untracked
    from meal_recipes m join recipe_ingredients i on i.recipe_id = m.recipe_id
    where m.meal_id = target and i.item_id is null;
  return untracked;
end;
$$;

-- Unticks a cooked meal: deletes exactly the events its cooking recorded
create function uncook_meal(meal_date date, meal_slot text, changed timestamptz)
returns void language plpgsql security invoker set search_path = public as $$
declare
  target uuid;
  stamps jsonb;
begin
  select id, changed_at into target, stamps from meals where date = meal_date and slot = meal_slot and status = 'cooked';
  if target is null or not is_later(stamps, 'cooked', changed) then return; end if;
  delete from stock_changes where meal_id = target;
  update meals set status = 'planned', changed_at = with_stamp(changed_at, 'cooked', changed) where id = target;
end;
$$;

-- Sets what a weekday's slot shows by default
create function set_default_meal(meal_weekday text, meal_slot text, meal_description text, recipe_ids uuid[], changed timestamptz)
returns void language plpgsql security invoker set search_path = public as $$
declare
  target uuid;
  stamps jsonb;
begin
  select id, changed_at into target, stamps from default_meals where weekday = meal_weekday and slot = meal_slot;
  if target is not null and not is_later(stamps, 'default', changed) then return; end if;

  insert into default_meals (weekday, slot, description, changed_at)
    values (meal_weekday, meal_slot, meal_description, with_stamp('{}', 'default', changed))
    on conflict (user_id, weekday, slot) do update
      set description = excluded.description, changed_at = with_stamp(default_meals.changed_at, 'default', changed)
    returning id into target;

  delete from default_meal_recipes where default_meal_id = target;
  insert into default_meal_recipes (default_meal_id, recipe_id) select target, unnest(recipe_ids);
end;
$$;

-- Writes a whole recipe: its text, ingredients and reminders replace what it had. Reminders may
-- anchor on each other in any order; the anchor check waits for the end of the transaction. An edit
-- of a recipe deleted meanwhile is refused (a delete wins); only a new recipe is created.
create function save_recipe(recipe jsonb, is_new boolean, changed timestamptz)
returns void language plpgsql security invoker set search_path = public as $$
declare
  target uuid := (recipe->>'id')::uuid;
  stamps jsonb;
  found_it boolean;
begin
  select true, changed_at into found_it, stamps from recipes where id = target;
  if found_it is null and not is_new then
    raise exception '% was deleted on another device', coalesce(recipe->>'title', 'This recipe');
  end if;
  if found_it and not is_later(stamps, 'recipe', changed) then return; end if;

  insert into recipes (id, title, body, changed_at)
    values (target, recipe->>'title', coalesce(recipe->>'body', ''), with_stamp('{}', 'recipe', changed))
    on conflict (id) do update
      set title = excluded.title, body = excluded.body, changed_at = with_stamp(recipes.changed_at, 'recipe', changed);

  delete from recipe_ingredients where recipe_id = target;
  insert into recipe_ingredients (id, recipe_id, item_id, name, amount, unit, position)
    select (i->>'id')::uuid, target, (i->>'item_id')::uuid, i->>'name', (i->>'amount')::numeric, i->>'unit', n - 1
    from jsonb_array_elements(coalesce(recipe->'ingredients', '[]')) with ordinality as e(i, n);

  delete from recipe_reminders where recipe_id = target;
  insert into recipe_reminders (id, recipe_id, label, offset_minutes, anchor_id, position)
    select (r->>'id')::uuid, target, r->>'label', (r->>'offset_minutes')::integer, (r->>'anchor_id')::uuid, n - 1
    from jsonb_array_elements(coalesce(recipe->'reminders', '[]')) with ordinality as e(r, n);
end;
$$;

-- Access ----------------------------------------------------------------------------------------

alter table graph_nodes enable row level security;
alter table graph_edges enable row level security;
alter table progress_log enable row level security;
alter table routines enable row level security;
alter table routine_checks enable row level security;
alter table deadlines enable row level security;
alter table alarms enable row level security;
alter table stock_items enable row level security;
alter table recipes enable row level security;
alter table recipe_ingredients enable row level security;
alter table recipe_reminders enable row level security;
alter table meals enable row level security;
alter table meal_recipes enable row level security;
alter table default_meals enable row level security;
alter table default_meal_recipes enable row level security;
alter table stock_changes enable row level security;

create policy "own rows" on graph_nodes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on graph_edges for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on progress_log for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on routines for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on routine_checks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on deadlines for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on alarms for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on stock_items for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on recipes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on recipe_ingredients for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on recipe_reminders for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on meals for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on meal_recipes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on default_meals for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on default_meal_recipes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on stock_changes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on graph_nodes, graph_edges, progress_log, routines, routine_checks, deadlines, alarms,
  stock_items, recipes, recipe_ingredients, recipe_reminders, meals, meal_recipes, default_meals,
  default_meal_recipes, stock_changes, nodes_with_xp, stock_on_hand from anon;
grant select, insert, update, delete on graph_nodes, graph_edges, progress_log, routines,
  routine_checks, deadlines, alarms, stock_items, recipes, recipe_ingredients, recipe_reminders,
  meals, meal_recipes, default_meals, default_meal_recipes, stock_changes, nodes_with_xp to authenticated;
grant select on stock_on_hand to authenticated;
revoke execute on function add_edge, delete_node, move_node, place_nodes, set_meal, cook_meal,
  uncook_meal, set_default_meal, save_recipe from public, anon;
grant execute on function add_edge, delete_node, move_node, place_nodes, set_meal, cook_meal,
  uncook_meal, set_default_meal, save_recipe to authenticated;

-- Changes stream to signed-in apps, so edits made elsewhere (another device, an agent) show live
alter publication supabase_realtime add table graph_nodes, graph_edges, progress_log, routines,
  routine_checks, deadlines, alarms, stock_items, recipes, recipe_ingredients, recipe_reminders,
  meals, meal_recipes, default_meals, default_meal_recipes, stock_changes;
