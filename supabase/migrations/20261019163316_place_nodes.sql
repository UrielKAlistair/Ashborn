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

revoke execute on function place_nodes from public, anon;
grant execute on function place_nodes to authenticated;
