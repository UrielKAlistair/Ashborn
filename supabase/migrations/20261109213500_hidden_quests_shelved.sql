-- Hiding a quest and shelving it become one state, `shelved` (design 55): a quest hidden from the graph
-- is shelved instead. `active` stays, always true, until the installed apps and the hosted connector
-- no longer read it; dropping it is in TODO.md. Through keep_latest, so both fields are stamped now.

update graph_nodes set shelved = true, active = true where not active;
