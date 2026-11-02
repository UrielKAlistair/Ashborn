-- The user's settings, one row per user, synced to every device. day_start_hour is when "today"
-- turns into the next day (routine ticks, the meal plan, today's progress, folding finished
-- boxes); alarms keep clock times. A missing row reads as the defaults.

create table user_settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  day_start_hour smallint not null default 4 check (day_start_hour between 0 and 23),
  changed_at jsonb not null default '{}'
);

create trigger keep_latest before update on user_settings for each row execute function keep_latest();
create trigger clamp_stamps before insert on user_settings for each row execute function clamp_stamps();

alter table user_settings enable row level security;
create policy "own rows" on user_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on user_settings from anon;
grant select, insert, update, delete on user_settings to authenticated;

alter publication supabase_realtime add table user_settings;
