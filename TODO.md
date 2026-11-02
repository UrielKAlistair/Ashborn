# Ashborn to-do

Ashborn is meant to be an app anyone can download and set up easily: a clean to-do tracker
that shows your tasks as a graph, with the RPG layer as a motivator on top. Deadlines and
routines feed into the same picture of what to do now.

Only open work is listed here. What is built, and why it is built that way, is in
`docs/design.md`.

## Now: daily use, in this order

- [ ] Install the release build again (`npm run android:install`) and check it is fast enough to
      keep. The first install was uninstalled for being slow; that is probably fixed.
- [ ] Try it on the phone, in one sitting: `research/daily-use/phone-checks.md`. Allow the
      permissions; find why an alarm showed only as a notification (the ringing screen exists:
      time, title, Stop, Snooze on plain alarms, the walk or sit-up count; Android 14+ shows it
      only once "full screen notifications" is allowed, and never over an unlocked phone in use);
      ring one alarm of each kind; tune the walk and sit-up thresholds (decision 36); and, with
      the phone app closed, change a meal on the desktop and see its alarm move within the hour
      (decision 96).
- [ ] Try sync across real devices: change something on the phone offline and the same thing on
      the desktop, and see the later change kept.
- [ ] Check the AppImage starts at login: run `scripts/install-appimage.sh`, log out and in,
      and see the tray icon (GNOME needs the AppIndicator extension for it).

## Security review

- [ ] A thorough review of how the data is reached: the per-user access rules, the publishable
      key, the agent's saved session (`~/.config/ashborn/agent-session.json`), and the sign-in a
      hosted phone connector would need. Before the connector below.

## Agent access

- [ ] Claude on the phone: host the MCP tools (for example as a Supabase Edge Function) with a
      sign-in, and add them as a custom connector in the Claude app.

## Atlas

- [ ] Rewrite the Atlas. I write all of its content by hand, with no AI-generated text; Claude
      may suggest the broad headings and structure.

## Later

- [ ] Stat presets: named weight sets a quest can load. Only once weights have been used for a
      while.
- [ ] A record of what was eaten each day, which could feed calorie tracking. The `meals` rows
      already hold the plan and whether each meal was cooked.
