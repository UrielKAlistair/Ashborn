-- Ashborn's data: the thread graph, level-ups, routines and deadlines. Every row belongs to
-- the user who created it, and row-level security keeps each user to their own rows.

create table graph_nodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  parent_id uuid references graph_nodes on delete cascade, -- null for a thread
  title text not null,
  stat text check (stat in ('STR', 'DEX', 'INT', 'WIS', 'CHR', 'MND')), -- threads only
  active boolean not null default true, -- threads only: shown on the dashboard
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- from_id is a prerequisite of to_id; both have the same parent
create table graph_edges (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  from_id uuid not null references graph_nodes on delete cascade,
  to_id uuid not null references graph_nodes on delete cascade,
  primary key (from_id, to_id)
);

-- One row per level-up
create table progress_log (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  node_id uuid not null references graph_nodes on delete cascade,
  amount integer not null,
  logged_at timestamptz not null default now()
);

create table routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  cue text not null default '',
  weekdays text[] not null, -- 'Mon' … 'Sun'
  created_at timestamptz not null default now()
);

create table routine_checks (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  routine_id uuid not null references routines on delete cascade,
  date date not null,
  primary key (routine_id, date)
);

create table deadlines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  due_date date not null,
  done_at timestamptz
);

create index graph_nodes_user on graph_nodes (user_id, created_at);
create index graph_nodes_parent on graph_nodes (parent_id);
create index graph_nodes_completed on graph_nodes (user_id, completed_at);
create index graph_edges_to on graph_edges (to_id);
create index progress_log_node on progress_log (node_id);
create index progress_log_time on progress_log (user_id, logged_at);
create index routine_checks_date on routine_checks (user_id, date);
create index deadlines_open on deadlines (user_id, due_date) where done_at is null;

alter table graph_nodes enable row level security;
alter table graph_edges enable row level security;
alter table progress_log enable row level security;
alter table routines enable row level security;
alter table routine_checks enable row level security;
alter table deadlines enable row level security;

create policy "own rows" on graph_nodes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on graph_edges for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on progress_log for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on routines for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on routine_checks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on deadlines for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Nodes with the XP logged on them by level-ups. The view is updatable (the XP column aside),
-- so the app reads and writes nodes through it and gets the XP back in one round trip.
create view nodes_with_xp with (security_invoker = true) as
  select n.id, n.user_id, n.parent_id, n.title, n.stat, n.active, n.created_at, n.completed_at,
    (select coalesce(sum(p.amount), 0) from progress_log p where p.node_id = n.id)::integer as logged_xp
  from graph_nodes n;

-- Links two siblings, refusing links across boxes and links that would close a loop
create function add_edge(source_id uuid, target_id uuid) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if (select parent_id from graph_nodes where id = source_id)
     is distinct from (select parent_id from graph_nodes where id = target_id) then
    raise exception 'Only nodes in the same box can be linked.';
  end if;

  if source_id = target_id or exists (
    with recursive downstream(id) as (
      select target_id
      union
      select e.to_id from graph_edges e join downstream d on e.from_id = d.id
    )
    select 1 from downstream where id = source_id
  ) then
    raise exception 'That link would make a loop.';
  end if;

  insert into graph_edges (from_id, to_id) values (source_id, target_id) on conflict do nothing;
end $$;

-- Deletes a node and returns its id and its steps' ids at every depth (the foreign keys
-- cascade the delete to all of them)
create function delete_node(target uuid) returns setof uuid
language sql security invoker set search_path = public as $$
  with recursive subtree(id) as (
    select target
    union all
    select g.id from graph_nodes g join subtree s on g.parent_id = s.id
  ),
  removed as (delete from graph_nodes where id = target)
  select id from subtree;
$$;

revoke all on graph_nodes, graph_edges, progress_log, routines, routine_checks, deadlines, nodes_with_xp from anon;
grant select, insert, update, delete
  on graph_nodes, graph_edges, progress_log, routines, routine_checks, deadlines, nodes_with_xp to authenticated;
revoke execute on function add_edge, delete_node from public, anon;
grant execute on function add_edge, delete_node to authenticated;

-- Changes stream to signed-in apps, so edits made elsewhere (another device, an agent) show live
alter publication supabase_realtime
  add table graph_nodes, graph_edges, progress_log, routines, routine_checks, deadlines;
