-- The Kitchen: stock of bulk staples, recipes, and a meal plan over a default week.
-- Amounts are stored in base units (g, ml, count); stock on hand is the sum of its changes.
-- Cooking a meal deducts its recipes' tracked ingredients; uncooking deletes exactly those changes.
-- New tables only. One transaction, so a failure leaves the database as it was.

begin;

-- A bulk staple. `unit` is how it is shown (kg); `target` is in the unit's base (g).
create table stock_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  unit text not null check (unit in ('g', 'kg', 'ml', 'l', 'count')),
  target numeric not null default 0 check (target >= 0),
  created_at timestamptz not null default now()
);

create table recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  body text not null default '', -- free text for the reader, never parsed
  created_at timestamptz not null default now()
);

-- What a recipe deducts when a meal using it is cooked. `amount` is in the base unit of the
-- item's kind; `unit` is the unit it was written in, for showing it. A dropped stock item
-- leaves the ingredient untracked; `name` still says what it was.
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

-- Alarms a recipe sets when it is scheduled: `offset_minutes` from the meal's time, or from
-- another reminder of the same recipe (`anchor_id`)
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

-- A meal planned, cooked or cancelled on a date. A day nobody touched stores nothing and shows
-- the default week. Rows are never deleted.
create table meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null,
  slot text not null check (slot in ('breakfast', 'lunch', 'dinner')),
  description text not null default '',
  status text not null default 'planned' check (status in ('planned', 'cooked', 'cancelled')),
  created_at timestamptz not null default now(),
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
  unique (user_id, weekday, slot)
);

create table default_meal_recipes (
  default_meal_id uuid not null references default_meals on delete cascade,
  recipe_id uuid not null references recipes on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  primary key (default_meal_id, recipe_id)
);

-- One change to a stock item, in its base unit: a cooked meal (meal_id set), a restock or a
-- hand correction
create table stock_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  item_id uuid not null references stock_items on delete cascade,
  meal_id uuid references meals on delete cascade,
  amount numeric not null,
  created_at timestamptz not null default now()
);

create index recipe_ingredients_recipe on recipe_ingredients (recipe_id);
create index recipe_reminders_recipe on recipe_reminders (recipe_id);
create index stock_changes_item on stock_changes (item_id);
create index stock_changes_meal on stock_changes (meal_id);

-- Stock items with the amount on hand
create view stock_on_hand with (security_invoker = true) as
  select s.id, s.user_id, s.name, s.unit, s.target, s.created_at,
    coalesce((select sum(c.amount) from stock_changes c where c.item_id = s.id), 0) as on_hand
  from stock_items s;

-- Plans or cancels a meal: its description and recipes replace what the date had. A cooked meal
-- stays cooked when edited, and cannot be cancelled.
create function set_meal(meal_id uuid, meal_date date, meal_slot text, meal_description text, recipe_ids uuid[], meal_status text)
returns void language plpgsql security invoker set search_path = public as $$
declare
  target uuid;
  current_status text;
begin
  if meal_status not in ('planned', 'cancelled') then
    raise exception 'A meal is planned or cancelled here; cooking is cook_meal.';
  end if;
  select id, status into target, current_status from meals where date = meal_date and slot = meal_slot;
  if current_status = 'cooked' and meal_status = 'cancelled' then
    raise exception 'This meal was cooked; untick it before cancelling it.';
  end if;

  insert into meals (id, date, slot, description, status)
    values (meal_id, meal_date, meal_slot, meal_description, meal_status)
    on conflict (user_id, date, slot) do update
      set description = excluded.description,
          status = case when meals.status = 'cooked' then 'cooked' else excluded.status end
    returning id into target;

  delete from meal_recipes where meal_recipes.meal_id = target;
  insert into meal_recipes (meal_id, recipe_id) select target, unnest(recipe_ids);
end;
$$;

-- Marks a meal cooked and deducts its recipes' tracked ingredients. A date with no meal of its own
-- first copies the default week's (with its recipes). Cooking again replaces the earlier
-- deduction rather than adding to it. Returns the names of ingredients no longer tracked.
create function cook_meal(meal_id uuid, meal_date date, meal_slot text)
returns text[] language plpgsql security invoker set search_path = public as $$
declare
  target uuid;
  inserted boolean;
  untracked text[];
begin
  insert into meals (id, date, slot, description, status)
    select meal_id, meal_date, meal_slot, coalesce(d.description, ''), 'cooked'
    from (select 1) one
    left join default_meals d on d.weekday = to_char(meal_date, 'Dy') and d.slot = meal_slot
    on conflict (user_id, date, slot) do update set status = 'cooked'
    returning id, (xmax = 0) into target, inserted;

  if inserted then
    insert into meal_recipes (meal_id, recipe_id)
      select target, r.recipe_id
      from default_meal_recipes r join default_meals d on d.id = r.default_meal_id
      where d.weekday = to_char(meal_date, 'Dy') and d.slot = meal_slot;
  end if;

  delete from stock_changes where stock_changes.meal_id = target;
  insert into stock_changes (item_id, meal_id, amount)
    select i.item_id, target, -i.amount
    from meal_recipes m join recipe_ingredients i on i.recipe_id = m.recipe_id
    where m.meal_id = target and i.item_id is not null;

  select coalesce(array_agg(i.name order by i.name), '{}') into untracked
    from meal_recipes m join recipe_ingredients i on i.recipe_id = m.recipe_id
    where m.meal_id = target and i.item_id is null;
  return untracked;
end;
$$;

-- Unticks a cooked meal: deletes exactly the stock changes its cooking made
create function uncook_meal(meal_date date, meal_slot text)
returns void language plpgsql security invoker set search_path = public as $$
declare
  target uuid;
begin
  select id into target from meals where date = meal_date and slot = meal_slot and status = 'cooked';
  if target is null then return; end if;
  delete from stock_changes where meal_id = target;
  update meals set status = 'planned' where id = target;
end;
$$;

-- Sets what a weekday's slot shows by default
create function set_default_meal(meal_weekday text, meal_slot text, meal_description text, recipe_ids uuid[])
returns void language plpgsql security invoker set search_path = public as $$
declare
  target uuid;
begin
  insert into default_meals (weekday, slot, description)
    values (meal_weekday, meal_slot, meal_description)
    on conflict (user_id, weekday, slot) do update set description = excluded.description
    returning id into target;

  delete from default_meal_recipes where default_meal_id = target;
  insert into default_meal_recipes (default_meal_id, recipe_id) select target, unnest(recipe_ids);
end;
$$;

-- Writes a whole recipe: its text, ingredients and reminders replace what it had. Reminders may
-- anchor on each other in any order; the anchor check waits for the end of the transaction.
create function save_recipe(recipe jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare
  target uuid := (recipe->>'id')::uuid;
begin
  insert into recipes (id, title, body) values (target, recipe->>'title', coalesce(recipe->>'body', ''))
    on conflict (id) do update set title = excluded.title, body = excluded.body;

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

alter table stock_items enable row level security;
alter table recipes enable row level security;
alter table recipe_ingredients enable row level security;
alter table recipe_reminders enable row level security;
alter table meals enable row level security;
alter table meal_recipes enable row level security;
alter table default_meals enable row level security;
alter table default_meal_recipes enable row level security;
alter table stock_changes enable row level security;

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

revoke all on stock_items, recipes, recipe_ingredients, recipe_reminders, meals, meal_recipes,
  default_meals, default_meal_recipes, stock_changes, stock_on_hand from anon;
grant select, insert, update, delete on stock_items, recipes, recipe_ingredients, recipe_reminders,
  meals, meal_recipes, default_meals, default_meal_recipes, stock_changes to authenticated;
grant select on stock_on_hand to authenticated;
revoke execute on function set_meal, cook_meal, uncook_meal, set_default_meal, save_recipe from public, anon;
grant execute on function set_meal, cook_meal, uncook_meal, set_default_meal, save_recipe to authenticated;

alter publication supabase_realtime add table stock_items, recipes, recipe_ingredients,
  recipe_reminders, meals, meal_recipes, default_meals, default_meal_recipes, stock_changes;

commit;
