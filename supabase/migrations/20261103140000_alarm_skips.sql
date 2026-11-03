-- One ring of an alarm skipped: an alarm's, a routine's, a deadline's or a meal reminder's, on one
-- day, named by the schedule's key for that ring (`alarm:<id>@<date>`, `routine:<id>@<date>`, ...).
-- A row with `skipped`, stamped, like a routine's tick, so the later choice wins across devices.
-- `date` is the ring's day, so old rows are left unread.
create table alarm_skips (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  key text not null,
  date date not null,
  skipped boolean not null default true,
  changed_at jsonb not null default '{}',
  primary key (user_id, key)
);

create index alarm_skips_date on alarm_skips (user_id, date);
create trigger keep_latest before update on alarm_skips for each row execute function keep_latest();
create trigger clamp_stamps before insert on alarm_skips for each row execute function clamp_stamps();

alter table alarm_skips enable row level security;
create policy "own rows" on alarm_skips for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on alarm_skips from anon;
grant select, insert, update, delete on alarm_skips to authenticated;

alter publication supabase_realtime add table alarm_skips;
