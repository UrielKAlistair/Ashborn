-- Two gaps in "the change made later wins":
-- 1. A change that sets a field to the value it already has now records its stamp, when later.
--    Before, the stamp stayed old, so an older offline change replayed afterwards could win.
-- 2. Moves and placements carry the moment they were made (`at`), as every other write does,
--    instead of being stamped when they reach the server. A move that loses leaves the node's
--    links alone too.

create or replace function keep_latest() returns trigger
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
    continue when field in ('id', 'user_id', 'created_at', 'changed_at');
    if result->field is not distinct from old_row->field then
      -- The same value, set again later: the later setting is the one that stands
      at := (incoming->>field)::timestamptz;
      if at is not null and is_later(stamps, field, at) then
        stamps := with_stamp(stamps, field, at);
      end if;
      continue;
    end if;
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

drop function move_node(uuid, uuid);
drop function place_nodes(jsonb);

-- Moves a node into another box (or out to be a quest), dropping its links, which cannot cross
-- boxes. A move older than the node's last move changes nothing.
create function move_node(target uuid, new_parent uuid, at timestamptz default now()) returns table (from_id uuid, to_id uuid)
language plpgsql security invoker set search_path = public as $$
begin
  -- A move older than the node's last one loses quietly, before anything else is judged
  if not exists (select 1 from graph_nodes where id = target and is_later(changed_at, 'parent_id', at)) then
    return;
  end if;
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
  update graph_nodes set parent_id = new_parent, changed_at = changed_at || jsonb_build_object('parent_id', at) where id = target;
end $$;

-- Places several nodes in one request. Dropping a dragged node pins its siblings where they are
-- too, so they do not jump.
create function place_nodes(places jsonb, at timestamptz default now()) returns setof uuid
language sql security invoker set search_path = public as $$
  update graph_nodes g
  set x = p.x, y = p.y, changed_at = g.changed_at || jsonb_build_object('x', at, 'y', at)
  from jsonb_to_recordset(places) as p(id uuid, x double precision, y double precision)
  where g.id = p.id
  returning g.id;
$$;

revoke execute on function move_node, place_nodes from public, anon;
grant execute on function move_node, place_nodes to authenticated;
