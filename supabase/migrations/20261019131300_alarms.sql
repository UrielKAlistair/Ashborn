-- Times and alarms. A routine can happen at a time of day and ring an alarm then: a plain one,
-- or one that only stops after a physical challenge (walking, sit-ups). A deadline can ring an
-- alarm at a time on its due day. The phone app schedules these; the desktop only shows them.

alter table routines
  add column time time,
  add column alarm text not null default 'none' check (alarm in ('none', 'plain', 'walk', 'situps')),
  add constraint routine_alarm_needs_time check (alarm = 'none' or time is not null);

alter table deadlines
  add column alarm_time time;
