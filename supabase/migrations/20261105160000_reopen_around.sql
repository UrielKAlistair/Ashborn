-- Reopens the done boxes around a step in one request, instead of one read per box up the chain:
-- a step opened or put inside done boxes reopens them, since a box is done only while everything in
-- it is. The walk goes up parent_id from `start` (the step's box) and stops below the quest, which is
-- never reopened. Each reopen is stamped `at`, so keep_latest lets a later tick of the box win.

create function reopen_around(start uuid, at timestamptz) returns setof nodes_with_xp
language plpgsql security invoker set search_path = public as $$
declare
  reopened uuid[];
begin
  with recursive chain(id, parent_id) as (
    select id, parent_id from graph_nodes where id = start
    union all
    select g.id, g.parent_id from graph_nodes g join chain c on g.id = c.parent_id
  ),
  done as (
    update graph_nodes g
    set completed_at = null, changed_at = g.changed_at || jsonb_build_object('completed_at', at)
    from chain c
    where g.id = c.id and c.parent_id is not null and g.completed_at is not null
    returning g.id
  )
  select array_agg(id) into reopened from done;

  -- A separate statement: the query of a WITH that updates sees the rows as they were before it
  return query select * from nodes_with_xp where id = any(reopened);
end $$;

revoke execute on function reopen_around from public, anon;
grant execute on function reopen_around to authenticated;
