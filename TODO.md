# Ashborn to-do

Ashborn is meant to be an app anyone can download and set up easily: a clean to-do tracker
that shows your tasks as a graph, with the RPG layer as a motivator on top. Deadlines and
routines feed into the same picture of what to do now.

## Core (next)

- [ ] Stat presets: a thread can train several stats with weights. Categories carry preset
      weight distributions, so a thread loads a preset instead of setting weights by hand.
      Comes after the core functionality is settled.

## Sync across devices

- [x] Move the database to Supabase so the same data is reachable from every device; the
      local app is only the UI.
- [x] Offline: the app shows the last data it saw, read-only.
- The user base is just me for now; this is not about going public.

## Mobile

- [x] A phone app (Android only): the same app and data (Supabase), packaged natively with
      Capacitor so the UI ships inside it and nothing is hosted. A different face from the
      desktop: no graph; the to-do list (Up next) and the schedules (routines, deadlines,
      meals) instead. The Cookbook and Treasury work as on the desktop.
- [x] Works offline: keeps its data on the phone and syncs with Supabase when connected.
- [x] Alarms (phone only): proper alarms, not calendar notifications, for scheduled routines
      (meal prep) and deadlines on their due day. Most are ordinary alarms. The Cookbook's
      meal and prep alarms come with the Cookbook.
- [x] Dismissal challenges for chosen alarms, so they cannot be dismissed casually; for
      wake-up alarms, a physical challenge read from the accelerometer (walk around, sit-ups),
      so the app can also be the everyday wake-up alarm.
- [x] An Alarms tab: quick alarms, one-offs, recurring alarms with a challenge, and the
      schedule's routine and deadline alarms.
- [x] The homepage's night look and hex territories; dragging and resizing nodes on the
      desktop, kept in Supabase and shown on the phone.
- [ ] Try it on the phone: install, allow the permissions, test each alarm kind, and tune the
      walk and sit-up thresholds (docs/design.md, decision 36).
- [ ] Refresh the phone's alarms in the background (for example daily), so a routine changed
      on the desktop reaches the phone without opening the app.

## Atlas

- [ ] Rewrite the Atlas. I write all of its content by hand, with no AI-generated text; Claude
      may suggest the broad headings and structure.

## Cookbook (placeholder page and icon exist)

- [ ] A recipe book: each recipe has its ingredients and a full list of steps.
- [ ] Prep reminders tied to a recipe, set a given time before the meal (soaking 8–10 hours
      ahead, and so on). Every planned meal gets at least a reminder at the start of the day.
- [ ] A meal schedule: meals (lunch, dinner, …) at set times, mostly from the recipe book but
      allowing meals that are not in it.
- [ ] A weekly template that recurs automatically and queues its prep tasks and reminders into
      the to-do and routine lists. Individual meals can be swapped.

## Treasury (placeholder page and icon exist)

- [ ] An expenditure tracker: daily and monthly spending, sorted by category.

## Agent access

- [x] Let an agent edit the graph from high-level instructions ("I'm learning deep learning,
      these are roughly the ideas, plan it for me"): expose the app's operations as an MCP
      server, or plain API endpoints, rather than building voice or AI features into the app.
- [x] Operations: add tasks and subtasks, mark them done, make and remove links, and so on.
      The editing UI stays the main way in for anyone who wants direct control.
