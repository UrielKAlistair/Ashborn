-- The stamp and weight helpers are called by the triggers and check constraints on the user's
-- rows, so only signed-in users need them; without a session nothing can call them.

revoke execute on function is_later, with_stamp, valid_stat_weights, keep_latest, clamp_stamps from public, anon;
grant execute on function is_later, with_stamp, valid_stat_weights, keep_latest, clamp_stamps to authenticated;
