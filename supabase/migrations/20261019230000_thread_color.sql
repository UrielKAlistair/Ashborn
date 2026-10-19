-- The colour the user gives a thread, independent of the stat it trains. Null is white.

alter table graph_nodes
  add column color text check (color in ('red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'));

create or replace view nodes_with_xp with (security_invoker = true) as
  select n.id, n.user_id, n.parent_id, n.title, n.stat, n.active, n.created_at, n.completed_at,
    (select coalesce(sum(p.amount), 0) from progress_log p where p.node_id = n.id)::integer as logged_xp,
    n.x, n.y, n.width, n.height, n.color
  from graph_nodes n;
