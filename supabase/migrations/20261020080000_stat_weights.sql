-- A thread trains several stats with weights, {"INT": 0.2, "CHR": 0.1}, in place of one stat.
-- Each XP earned in the thread adds weight × XP to each of its stats; an empty map trains none.
-- One transaction, so a failure leaves the database as it was.

begin;

-- A map from stat key to a number ≥ 0
create function valid_stat_weights(weights jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(weights) <> 'object' then false else not exists (
    select 1 from jsonb_each(weights) w
    where w.key not in ('STR', 'DEX', 'INT', 'WIS', 'CHR', 'MND')
      or case when jsonb_typeof(w.value) = 'number' then (w.value)::numeric < 0 else true end
  ) end
$$;

alter table graph_nodes
  add column stat_weights jsonb not null default '{}' check (valid_stat_weights(stat_weights)); -- threads only

update graph_nodes set stat_weights = jsonb_build_object(stat, 1) where stat is not null;

drop view nodes_with_xp;
alter table graph_nodes drop column stat;

create view nodes_with_xp with (security_invoker = true) as
  select n.id, n.user_id, n.parent_id, n.title, n.stat_weights, n.active, n.created_at, n.completed_at,
    (select coalesce(sum(p.amount), 0) from progress_log p where p.node_id = n.id)::integer as logged_xp,
    n.x, n.y, n.width, n.height, n.color
  from graph_nodes n;

revoke all on nodes_with_xp from anon;
grant select, insert, update, delete on nodes_with_xp to authenticated;

commit;
