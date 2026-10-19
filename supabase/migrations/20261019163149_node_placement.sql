-- Where the user has put a node on the desktop canvas and how big they have made it. Position is
-- relative to the node's box (to the canvas for a thread). Null means laid out automatically.

alter table graph_nodes
  add column x double precision,
  add column y double precision,
  add column width double precision,
  add column height double precision;

create or replace view nodes_with_xp with (security_invoker = true) as
  select n.id, n.user_id, n.parent_id, n.title, n.stat, n.active, n.created_at, n.completed_at,
    (select coalesce(sum(p.amount), 0) from progress_log p where p.node_id = n.id)::integer as logged_xp,
    n.x, n.y, n.width, n.height
  from graph_nodes n;
