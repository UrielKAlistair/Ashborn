-- When a node last had a level-up, so "gone quiet" can tell a quest worked on only by level-ups from
-- one left alone. Added at the end of the view, so what reads it now is unaffected.

create or replace view nodes_with_xp with (security_invoker = true) as
  select n.id, n.user_id, n.parent_id, n.title, n.stat_weights, n.active, n.created_at, n.completed_at,
    (select coalesce(sum(p.amount), 0) from progress_log p where p.node_id = n.id)::integer as logged_xp,
    n.x, n.y, n.color, n.shelved, n.priority, n.changed_at,
    (select max(p.logged_at) from progress_log p where p.node_id = n.id) as last_logged_at
  from graph_nodes n;
