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

revoke execute on function move_node from public, anon;
grant execute on function move_node to authenticated;
