-- A step's or quest's description: free text, such as where its details are kept ("see notes/x.md").
alter table graph_nodes add column description text not null default '' check (char_length(description) <= 4000);

create or replace view nodes_with_xp with (security_invoker = true) as
  select n.id, n.user_id, n.parent_id, n.title, n.stat_weights, n.active, n.created_at, n.completed_at,
    (select coalesce(sum(p.amount), 0) from progress_log p where p.node_id = n.id)::integer as logged_xp,
    n.x, n.y, n.shelved, n.priority, n.changed_at,
    (select max(p.logged_at) from progress_log p where p.node_id = n.id) as last_logged_at,
    n.description
  from graph_nodes n;
