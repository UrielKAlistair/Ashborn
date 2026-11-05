-- A quest's colour is its priority's (design 182), so the stored colour goes. Also locks down
-- rls_auto_enable, the dashboard's event trigger that turns row rules on for new tables: it runs as
-- an event trigger, so nobody needs to execute it, and by default everyone could.

drop view nodes_with_xp;
create view nodes_with_xp with (security_invoker = true) as
  select n.id, n.user_id, n.parent_id, n.title, n.stat_weights, n.active, n.created_at, n.completed_at,
    (select coalesce(sum(p.amount), 0) from progress_log p where p.node_id = n.id)::integer as logged_xp,
    n.x, n.y, n.shelved, n.priority, n.changed_at,
    (select max(p.logged_at) from progress_log p where p.node_id = n.id) as last_logged_at
  from graph_nodes n;
revoke all on nodes_with_xp from anon;
grant select, insert, update, delete on nodes_with_xp to authenticated;

-- keep_latest would put back the stamp this removes
alter table graph_nodes disable trigger keep_latest;
update graph_nodes set changed_at = changed_at - 'color' where changed_at ? 'color';
alter table graph_nodes enable trigger keep_latest;

alter table graph_nodes drop column color;

revoke execute on function rls_auto_enable from public, anon, authenticated;
