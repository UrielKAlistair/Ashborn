-- Steps inserted together get distinct creation times, in the order given: now() is fixed for a whole
-- transaction, and steps tied on it have no order of their own. Rows already made are left as they are.

alter table graph_nodes alter column created_at set default clock_timestamp();
