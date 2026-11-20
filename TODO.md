# Ashborn to-do

Ashborn is meant to be an app anyone can download and set up easily: a clean to-do tracker
that shows your tasks as a graph, with the RPG layer as a motivator on top. Deadlines and
routines feed into the same picture of what to do now.

Only open work is listed here. What is built, and why it is built that way, is in
`docs/design.md`.

## Now: daily use, in this order

- [ ] Check the evening's phone changes of 2026-11-08 after installing (`research/daily-use/phone-checks.md`,
      last section): recipe tabs and struck steps, Back on a recipe, vibration on vibrate and silent, a ring
      stopping by itself after 5 minutes with a "Missed" notice, a challenge alarm sounding on silent for 15.
- [ ] Decide the challenge alarm's emergency stop (design 295): a way out when the challenge can't be done
      where it rings, discouraged enough not to become the everyday stop.
- [ ] Install the release build again (`npm run android:install`) and check it is fast enough to
      keep. The first install was uninstalled for being slow; that is probably fixed.
- [ ] Try it on the phone, in one sitting: `research/daily-use/phone-checks.md`. Allow the
      permissions; find why an alarm showed only as a notification (the ringing screen exists:
      time, title, Stop, Snooze on plain alarms, the walk or sit-up count; Android 14+ shows it
      only once "full screen notifications" is allowed, and never over an unlocked phone in use);
      ring one alarm of each kind; tune the walk and sit-up thresholds (decision 36); and, with
      the phone app closed, change a meal on the desktop and see its alarm move within the hour
      (decision 96).
- [ ] Alarms on the Xiaomi phone (reported 2026-11-02):
      - No ringing screen, on the lock screen or on opening the phone; only a notification to
        dismiss. The user has granted "display over other apps" and lock-screen permissions
        several times. Check `canUseFullScreenIntent()` (`AlarmPlugin.java:89`): on Android 14+
        "full screen notifications" is a separate grant. HyperOS/MIUI also wants "Show on lock
        screen" and "Open new windows while running in the background" under Other permissions.
        Android never shows a full-screen intent over an unlocked phone in use: tapping the
        notification should open the ringing screen, and doesn't seem to. Log what the phone
        reports (`adb logcat`, the permission states) before changing code. Settings' "Notifications allowed" now reads whether the app's
        notifications are switched on, not only the permission (design 275): look at it again first. Settings now flags an Alarms
        channel below high importance ("Alarm notifications pop up", design 249). Also check the
        "Alarms" channel's own toggles (Settings > Apps > Ashborn > Notifications > Alarms):
        HyperOS turns "Floating notifications" and "Lock screen notifications" off by default for
        a new channel, which on its own would leave only a quiet notification in the shade
        (inferred from HyperOS's known defaults, not checked on this phone).
- [ ] Decide: the Alarms screen's Today lists rings before midnight, so a quick alarm set at 23:45 "in 30 min"
      shows nowhere on that screen (only on the Calendar). Run Today to the day-start hour (04:00) instead,
      as routines count their day?
- [ ] Try sync across real devices: change something on the phone offline and the same thing on
      the desktop, and see the later change kept.
- [ ] Check the AppImage starts at login: run `scripts/install-appimage.sh`, log out and in,
      and see the tray icon (GNOME needs the AppIndicator extension for it).

## Redesign follow-ups (from peer-c's reviews, 2026-11-03)

- [ ] The re-read after reconnecting waits for an undocumented Realtime message (D6); live-gap.spec catches a
      change in it.

## Security review

- [ ] Electron 45 (design 252): the upgrade is kept in `research/branches-2026-11-06.bundle`
      (`try/electron-45`). Build it, check the tray, Ctrl+Alt+Space and the window controls under native
      Wayland, and merge if they hold; Electron 37 is out of support.

## Agent access

- [ ] The hosted connector (design 98) carries the overnight fixes (design 234, 238) only once deployed:
      `npm run connector:deploy`. Until then its `overview` lists shelved quests as "Hidden quests", and
      `update_quest` still offers `shown`, which now does nothing (design 55).
- [ ] Drop `graph_nodes.active` (and from `nodes_with_xp`) once the phone, the desktop app and the hosted
      connector run a build from after 2026-11-09 (design 55). Until then an old build's "Hide quest" sets
      a flag the new builds ignore. `reopen_around` returns `nodes_with_xp` rows, so it is dropped and
      remade with the view (design 296).

## Atlas

- [ ] Rewrite the Atlas. I write all of its content by hand, with no AI-generated text; Claude
      may suggest the broad headings and structure.

## Looks (later)

- [ ] The light graph's yellow (P2) on parchment: the tile is the pigment laid partly transparent over a
      paper that is itself pale yellow-brown, so it barely shifts the hue and reads as dirty paper; its rim,
      browned toward the ink, turns olive. Try A an ochre that differs from the paper by darkness, B another
      hue for P2 on paper only, C a multiply blend (pigment only darkens the paper). Design 310.

## Later

- [ ] Stat presets: named weight sets a quest can load. Only once weights have been used for a
      while.
- [ ] A record of what was eaten each day, which could feed calorie tracking. The `meals` rows
      already hold the plan and whether each meal was cooked.
