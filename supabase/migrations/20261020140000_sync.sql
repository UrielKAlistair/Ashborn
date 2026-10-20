-- Two devices editing offline: per field, the change made later wins, judged by when it was made
-- (stamped by the device) rather than when it reached the server. Stock hand edits become readings
-- (the amount on hand); cooking stays an event. One transaction.

begin;

-- Per-field stamps: column name → when that column's value was last set
alter table graph_nodes add column changed_at jsonb not null default '{}';
alter table routines add column changed_at jsonb not null default '{}';
alter table deadlines add column changed_at jsonb not null default '{}';
alter table alarms add column changed_at jsonb not null default '{}';
alter table stock_items add column changed_at jsonb not null default '{}';
alter table recipes add column changed_at jsonb not null default '{}';
alter table meals add column changed_at jsonb not null default '{}';
alter table default_meals add column changed_at jsonb not null default '{}';

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

create trigger keep_latest before update on graph_nodes for each row execute function keep_latest();
create trigger keep_latest before update on routines for each row execute function keep_latest();
create trigger keep_latest before update on deadlines for each row execute function keep_latest();
create trigger keep_latest before update on alarms for each row execute function keep_latest();
create trigger keep_latest before update on stock_items for each row execute function keep_latest();

-- A level-up's id is made by the device, so sending it twice records it once
alter table progress_log add column event_id uuid unique;

-- The app reads and writes nodes through this view, so it carries the stamps too
create or replace view nodes_with_xp with (security_invoker = true) as
  select n.id, n.user_id, n.parent_id, n.title, n.stat_weights, n.active, n.created_at, n.completed_at,
    (select coalesce(sum(p.amount), 0) from progress_log p where p.node_id = n.id)::integer as logged_xp,
    n.x, n.y, n.width, n.height, n.color, n.shelved, n.changed_at
  from graph_nodes n;

-- Stock: a reading is the amount on hand when counted; a meal event is what cooking took. On hand
-- is the latest reading plus the meal events made after it. Hand edits made so far become one
-- reading per item, equal to today's amount; meal events stay, made when they were recorded.
alter table stock_changes add column kind text not null default 'meal' check (kind in ('reading', 'meal'));
alter table stock_changes add column made_at timestamptz not null default now();
update stock_changes set made_at = created_at;

create temporary table on_hand_now on commit drop as
  select c.item_id, s.user_id, sum(c.amount) as amount from stock_changes c join stock_items s on s.id = c.item_id group by c.item_id, s.user_id;
delete from stock_changes where meal_id is null;
insert into stock_changes (user_id, item_id, amount, kind, made_at)
  select user_id, item_id, amount, 'reading', now() from on_hand_now;
alter table stock_changes add constraint meal_events_have_meals check ((kind = 'meal') = (meal_id is not null));
create index stock_changes_readings on stock_changes (item_id, made_at) where kind = 'reading';

create or replace view stock_on_hand with (security_invoker = true) as
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
-- default meal, a recipe) has one stamp, and an older change of it does nothing
drop function set_meal(uuid, date, text, text, uuid[], text);
drop function cook_meal(uuid, date, text);
drop function uncook_meal(date, text);
drop function set_default_meal(text, text, text, uuid[]);
drop function save_recipe(jsonb);

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

-- Writes a whole recipe: its text, ingredients and reminders replace what it had. An edit of a
-- recipe deleted meanwhile is refused (a delete wins); only a new recipe is created.
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

revoke execute on function set_meal, cook_meal, uncook_meal, set_default_meal, save_recipe from public, anon;
grant execute on function set_meal, cook_meal, uncook_meal, set_default_meal, save_recipe to authenticated;

commit;
