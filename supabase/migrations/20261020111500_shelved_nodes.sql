-- A shelved node stays on the graph, greyed, and nothing inside it is offered as ready until it is
-- unshelved. Any node can be shelved; what lies inside it is shelved with it, derived in the app.

alter table graph_nodes add column shelved boolean not null default false;

-- The same view with `shelved` added at the end, so it can be replaced in place and keeps its grants
create or replace view nodes_with_xp with (security_invoker = true) as
  select n.id, n.user_id, n.parent_id, n.title, n.stat_weights, n.active, n.created_at, n.completed_at,
    (select coalesce(sum(p.amount), 0) from progress_log p where p.node_id = n.id)::integer as logged_xp,
    n.x, n.y, n.width, n.height, n.color, n.shelved
  from graph_nodes n;
