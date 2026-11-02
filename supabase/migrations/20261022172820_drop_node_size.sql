-- Nodes are no longer resized by hand: a box is as big as its content, so the stored size goes.

drop view nodes_with_xp;
create view nodes_with_xp with (security_invoker = true) as
  select n.id, n.user_id, n.parent_id, n.title, n.stat_weights, n.active, n.created_at, n.completed_at,
    (select coalesce(sum(p.amount), 0) from progress_log p where p.node_id = n.id)::integer as logged_xp,
    n.x, n.y, n.color, n.shelved, n.changed_at
  from graph_nodes n;
revoke all on nodes_with_xp from anon;
grant select, insert, update, delete on nodes_with_xp to authenticated;

-- Places several nodes in one request. Dropping a dragged node pins its siblings where they are
-- too, so they do not jump.
create or replace function place_nodes(places jsonb) returns setof uuid
language sql security invoker set search_path = public as $$
  update graph_nodes g
  set x = p.x, y = p.y
  from jsonb_to_recordset(places) as p(id uuid, x double precision, y double precision)
  where g.id = p.id
  returning g.id;
$$;

-- keep_latest would put back the stamps this removes
alter table graph_nodes disable trigger keep_latest;
update graph_nodes set changed_at = changed_at - 'width' - 'height' where changed_at ?| array['width', 'height'];
alter table graph_nodes enable trigger keep_latest;

alter table graph_nodes drop column width, drop column height;
