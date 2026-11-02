-- A deadline can belong to a quest or step; as it nears, it raises the priority of that chain.

alter table deadlines add column node_id uuid references graph_nodes on delete set null;
create index deadlines_node on deadlines (node_id);
