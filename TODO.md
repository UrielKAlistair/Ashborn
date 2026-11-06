# Ashborn to-do

Ashborn is meant to be an app anyone can download and set up easily: a clean to-do tracker
that shows your tasks as a graph, with the RPG layer as a motivator on top. Deadlines and
routines feed into the same picture of what to do now.

Only open work is listed here. What is built, and why it is built that way, is in
`docs/design.md`.

## Now: daily use, in this order

- [ ] Choose the hex look, the grounds and the phone's card menus on `trial/hex-look` (design 243;
      side by side in `research/hexlook/gallery/index.html`). Only the chosen options, without the
      switch, go to `main`. It supersedes `trial/light-graph` (228) for the graph.
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
        reports (`adb logcat`, the permission states) before changing code. Settings now flags an Alarms
        channel below high importance ("Alarm notifications pop up", design 249). Also check the
        "Alarms" channel's own toggles (Settings > Apps > Ashborn > Notifications > Alarms):
        HyperOS turns "Floating notifications" and "Lock screen notifications" off by default for
        a new channel, which on its own would leave only a quiet notification in the shade
        (inferred from HyperOS's known defaults, not checked on this phone).
- [ ] The desktop capture shortcut (Ctrl+Alt+Space, redesign branch) likely fires only while an X11
      window has focus: Electron 37 runs Ashborn under XWayland, where a global shortcut is an X11
      key grab. Tested 2026-11-03: neither XWayland nor native Wayland with `GlobalShortcutsPortal`
      made any call to GNOME's shortcuts portal (session bus watched). Dependable route, built and
      tested: GNOME Settings > Keyboard > Custom Shortcuts, Ctrl+Alt+Space, command
      `~/Applications/Ashborn.AppImage --capture` (a second launch hands the running app the flag).
      To do with the user: set that up and check it over Brave; then the in-app grab can go.
- [ ] Try sync across real devices: change something on the phone offline and the same thing on
      the desktop, and see the later change kept.
- [ ] Check the AppImage starts at login: run `scripts/install-appimage.sh`, log out and in,
      and see the tray icon (GNOME needs the AppIndicator extension for it).

## Redesign follow-ups (from peer-c's reviews, 2026-11-03)

- [ ] Decide: should a step's priority also flow forward to the steps it unlocks? Today it covers only what
      leads to it, so Ready puts the chips on the quest for chains (decision in docs/design.md).
- [ ] The phone's quiet "Time's up" (D4, built as design 231) is untested on a phone: run a time box with the
      app closed and see the notice.
- [ ] The timer and the put-off counts are per device, not synced (D5): fine unless it bothers in use.
- [ ] The re-read after reconnecting waits for an undocumented Realtime message (D6); live-gap.spec catches a
      change in it.

## Security review

- [ ] Try Electron 45 (`try/electron-45`, design 252): its AppImage is in `../Ashborn-try-electron/release/`.
      Check the tray, Ctrl+Alt+Space and the window controls under native Wayland; merge if they hold.

- [ ] Sign-ups are still open on the server (`disable_signup: false`, read again 2026-11-06 08:10): commit
      086c67e removed sign-up from the app's screen only, so anyone with the publishable key can create
      an account. Row-level security keeps them out of the user's data, but close it in the Supabase
      dashboard: Authentication > Sign In / Providers > "Allow new users to sign up" off.

- [ ] A thorough review of how the data is reached: the per-user access rules, the publishable
      key, the agent's saved session (`~/.config/ashborn/agent-session.json`), and the sign-in a
      hosted phone connector would need. Before the connector below.

## Agent access

- [ ] The hosted connector (design 98) carries the overnight fixes (design 234, 238) only once deployed:
      `npm run connector:deploy`.

## Atlas

- [ ] Rewrite the Atlas. I write all of its content by hand, with no AI-generated text; Claude
      may suggest the broad headings and structure.

## Later

- [ ] Stat presets: named weight sets a quest can load. Only once weights have been used for a
      while.
- [ ] A record of what was eaten each day, which could feed calorie tracking. The `meals` rows
      already hold the plan and whether each meal was cooked.
