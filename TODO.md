# Ashborn to-do

Ashborn is meant to be an app anyone can download and set up easily: a clean to-do tracker
that shows your tasks as a graph, with the RPG layer as a motivator on top. Deadlines and
routines feed into the same picture of what to do now.

Only open work is listed here. What is built, and why it is built that way, is in
`docs/design.md`.

## Next: try sync across real devices

- [ ] Change something on the phone offline and the same thing on the desktop, and see the
      later change kept.

## Phone

- [ ] Try it on the phone: allow the permissions, test each alarm kind, and tune the walk and
      sit-up thresholds (docs/design.md, decision 36).
- [ ] Refresh the phone's alarms in the background, so a meal or routine changed on the desktop
      rings correctly without opening the phone app. Options in
      `research/alarm-refresh/options.md`; three decisions open: a second, background sign-in
      on the phone; the schedule in embedded QuickJS (one source of truth, recommended) or ported
      to Java; hourly or another interval.

## Security review

- [ ] A thorough review of how the data is reached: the per-user access rules, the publishable
      key, the agent's saved session (`~/.config/ashborn/agent-session.json`), and the sign-in a
      hosted phone connector would need. Before the connector below.

## Release

- [ ] A signed release build of the Android app before anyone else installs it: the current one
      is a debug build, so anyone with ADB on the unlocked phone can read its session.

## Agent access

- [ ] Claude on the phone: host the MCP tools (for example as a Supabase Edge Function) with a
      sign-in, and add them as a custom connector in the Claude app.

## Desktop

- [ ] Check the AppImage starts at login: run `scripts/install-appimage.sh`, log out and in,
      and see the tray icon (GNOME needs the AppIndicator extension for it).

## Atlas

- [ ] Rewrite the Atlas. I write all of its content by hand, with no AI-generated text; Claude
      may suggest the broad headings and structure.

## Later

- [ ] Stat presets: named weight sets a thread can load. Only once weights have been used for a
      while.
- [ ] A record of what was eaten each day, which could feed calorie tracking. The `meals` rows
      already hold the plan and whether each meal was cooked.
