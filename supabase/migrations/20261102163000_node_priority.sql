-- A node's priority: 1 is the most urgent, 4 the least, null is none.

alter table graph_nodes add column priority smallint check (priority between 1 and 4);

drop view nodes_with_xp;
create view nodes_with_xp with (security_invoker = true) as
  select n.id, n.user_id, n.parent_id, n.title, n.stat_weights, n.active, n.created_at, n.completed_at,
    (select coalesce(sum(p.amount), 0) from progress_log p where p.node_id = n.id)::integer as logged_xp,
    n.x, n.y, n.color, n.shelved, n.priority, n.changed_at
  from graph_nodes n;
revoke all on nodes_with_xp from anon;
grant select, insert, update, delete on nodes_with_xp to authenticated;
