# Ashborn: the design and the engineering

Ashborn is a dashboard for the quests one is pursuing: things being learned or built. Its job is
to make the answer to "where do I begin?" one glance away when many quests are open, and to keep a
record of the ground covered that only ever grows.

## The problem

- Large goals ("learn convex optimisation", "build X") are not specific, measurable or time-bound,
  so they don't turn into action.
- Many open quests cost a lot of attention: it is hard to see what can be done now.
- Work is exploratory. Prerequisites are discovered by backtracking from an application (a
  generative-AI problem leads to convex optimisation, which leads to KKT, then weak duality, and so
  on). No syllabus fixes the set of subtasks in advance.

## The first version, and why it was dropped

The first commits (May 2026) are a gamified habit tracker: ticking a task paid XP into six D&D
stats and moved HP and FP bars, and status effects multiplied XP. It was archived in October:

- **No input path.** Nothing could create the tasks or the daily instances, so it could not be used.
- **No constraint on behaviour.** Points you award yourself, from a ledger you control, cost nothing
  to skip. A commitment device needs an outside party that enforces a cost.
- **The reward lands on the wrong side of the decision.** In temporal motivation theory (Steel
  2007), motivation ≈ (expectancy × value) / (1 + impulsiveness × delay). Points paid on completion
  arrive after the aversive moment, which is starting the task.
- **Arbitrary numbers.** The XP values and multipliers had no measured basis, and FP rested on the
  strength model of self-control, which failed a 36-lab preregistered test (Vohs et al. 2021,
  d = 0.06).
- **Micromanagement overhead.** Logging sleep and meals cost more than it returned.

## What the design rests on

| Idea | Evidence | Status |
|---|---|---|
| Monitoring progress on the goal itself improves attainment | Harkin et al. 2016: 138 RCTs, d = 0.40 | Measured (mostly health goals) |
| Learning goals beat outcome goals on novel, complex tasks | Seijts & Latham 2001, 2004, 2005 | Measured; mostly lab studies |
| Near subgoals beat distant ones | Bandura & Schunk 1981 | Measured (children, arithmetic) |
| Progress events mark good days | Amabile & Kramer 2011 (238 workers, ~12,000 diary entries) | Correlational |
| If-then plans help carry out intentions | Sheeran, Listrom & Gollwitzer 2024: 642 tests, d = 0.27–0.66 | Measured |
| Discovered work should not count as lost progress | Burn-up charts; Shape Up hill charts | Practice, not experiment |
| Projects plus next actions | GTD | Practice, not experiment |

The goal-gradient effect (effort rises as a goal nears) needs a fixed denominator, and exploratory
work has none. So no progress quantity in Ashborn is a fraction of planned work: every quantity is
a running total that only grows.

## The model

- **Quest**: a top-level node, something being learned or built.
- **Step**: a node inside a quest or another step, to any depth; done or not done.
- **Link** `from → to`: `from` must be done before `to`. Links join siblings only, so every box
  holds its own small DAG, and cycles are refused.
- **Ready** = not done, every prerequisite done, every step inside it done. *Now* lists the ready
  steps worth doing next, ranked by priority (set on a quest or a chain).
- **XP**: 10 per finished step or logged session. A quest's bar is the work done anywhere beneath it
  and upstream of it, and wraps every 100 XP. Each quest trains the six stats by weights; stat level
  L costs 100·L XP, so level grows like √XP.
- **Routines, deadlines, alarms, events and meals** sit beside the graph and pay no XP: they are
  obligations, not progress.

## Engineering

### One model, five clients

The rules (readiness, priority order, XP, the alarm schedule, the Kitchen's units) are pure
TypeScript in `src/shared/`. The same code runs in the web app, the Electron shell, the local MCP
server and the hosted connector (a Supabase Edge Function). The Android alarm service needs the
schedule while the app is closed, so it has a Java copy; the TypeScript unit tests write the cases
to a fixture file, and `npm run android:test` checks the Java against them.

### Offline-first sync

Every change is applied on screen at once and queued locally. The queue sends changes in order and
survives restarts and dropped connections. Realtime updates from other devices arrive meanwhile, and
a whole snapshot is re-read after a gap. The server stamps each field of a node when it changes, and
merges keep the newer field, so two devices editing the same step offline converge on the later
edit of each field, not the later write of the whole row. Merges keep every unchanged row as the
same object, so the memoised graph redraws only what changed. The e2e suite has tests for the
orderings that broke earlier versions: a change sent late, a re-read racing a queued change, a
server error in the middle of the queue.

### Layout

Each box's steps are laid out by `src/shared/layeredLayout.ts`, a Sugiyama-style layered layout:

1. **Layers.** A step sits one layer past its latest prerequisite (longest path). A step with no
   prerequisites is moved up to just before the earliest step it leads to, so its link stays short.
2. **Order.** Long links pass through a placeholder in each layer they cross. Steps start in
   priority order; barycentre sweeps, down then up, move each towards the mean position of its
   neighbours, keeping the order with the fewest crossings (priority breaks ties).
3. **Coordinates.** Each step sits level with the median of its prerequisites where the order and
   the gaps allow.

Unlinked groups stack in priority order, so high-priority work is at the top. Boxes are sized by
their contents and titles, and packed onto the canvas prerequisites first (`questPacking.ts`).
On the phone the same layout runs top to bottom.

This replaced ELK, a 1.6 MB Java-to-JavaScript layout engine run in a worker, with about 200 lines.
The trade was tested, not assumed: both engines ran behind an A/B switch on the same graph, and
screenshots on desktop and phone compared. The layouts matched except where ours centres a step
between its two prerequisites. Users can no longer drag cards: on a phone that was never usable,
and a layout that is always right makes it unnecessary.

### Alarms that cannot be ignored

On Android, alarms are scheduled natively (`AlarmManager`), ring over the lock screen, and obey the
ringer mode for plain alarms. A challenge alarm stops only once the accelerometer has counted
enough steps or sit-ups. Alarms join when they ring together, and changes reach the
phone at once through push messages. An agent can also *call* the user: a short ring with its own
sound, which only stops.

### Agents as users

The MCP server exposes 48 tools over the same API the app uses, signed in as the user, so the
database's row-level security bounds the agent exactly as it bounds the app. An agent can lay out a
whole nested plan with links in one call (`add_plan`), set priorities, add deadlines and alarms, and
ring the user's phone. Its changes show up live in every open app.

## Process

The project was built with AI coding agents (Claude Code) under a fixed method:

- **Choices are decisions.** Anything not forced by a constraint or a measurement is logged with its
  reasons; the log has over 300 entries, and later entries supersede earlier ones by number.
- **Build the options, then choose.** When a look or a behaviour has several reasonable options, all
  are built on a `trial/<topic>` branch with an A/B/C switch in the corner of the window, tried in
  the real app, and only the chosen option is merged. The `flow/a`, `flow/b` and `flow/c` branches
  in this repository are one such trial, of the daily flow.
- **Tests at both levels.** Playwright unit tests for `src/shared/` and end-to-end tests that drive
  the Electron app against a test account, including the sync races above.
- **Review before merge.** Each feature branch was reviewed for correctness before it was merged,
  and the review fixes are commits of their own.
