-- The user's time zone (an IANA name such as Asia/Kolkata), written by their devices. The hosted
-- agent server runs in UTC and reads dates and clock times in it. Null until a device has written it.

alter table user_settings
  add column time_zone text check (time_zone is null or length(time_zone) between 1 and 64);
