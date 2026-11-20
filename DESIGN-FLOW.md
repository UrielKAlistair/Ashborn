# design/flow: design bets, for picking from

A branch of design ideas nobody asked for by name, kept off the main track. Each idea is its own
commit, so any one can be taken (`git cherry-pick <sha>`) or left. "Base:" commits only carry the
main track's work in progress and are not ideas.

The complaint they answer (2026-11-21): the app is overhead rather than a joy; the eye doesn't
flow; moving between pages isn't smooth. Each entry says what was seen, why it would cause that,
what changed, and what would show it wrong.

Run it: `cd ../Ashborn-design-flow && npm run electron:dev` (or `npx vite --port 1450` for the browser).
The e2e tests that open a section's menu by its button may need updating here (see 1).

## 1. A section's button goes straight to its last screen, and names the screen shown
- **Seen**: every section with several screens (Home, Calendar, Kitchen on the phone; Kitchen,
  Calendar on the desktop) opened a menu first, so To-do ↔ Graph or Calendar ↔ Alarms, used daily,
  took tap, read, tap. With the menu closed nothing named the screen: on Alarms the rail said
  CALENDAR; on the phone To-do, Graph and Character all said HOME.
- **Why it hurts**: two choices per move where one would do, and recall ("where is Alarms?")
  where recognition would do.
- **Change**: a button from another section goes straight to the screen last open in it during this
  run of the app (a new run starts each section on its first screen, so one visit to the Cookbook
  doesn't redirect Kitchen for good); the open section's button shows the shown screen's icon and
  name (TO-DO, ALARMS, STOCKS), so icon and label agree; pressing it again opens the menu, as before.
- **Wrong if**: you mostly want a section's first screen rather than the last one, or the changing
  label reads as the button moving.

## 2. (Withdrawn) Now first on Today
Reverted: design.md 304 is the user's order (Gone quiet first, as "a danger zone", then Deadlines,
then Now). A bet must not undo a user's decision.

## 3. Coming up today; descriptions in Now
- Coming up: what is on now and the next two times today, rings and events, at the top of Today.
- A step's description shows under it in Now, two lines at most, so an agent's "details in file X"
  is seen where the step is picked up.
- Not the "Up next" removed in design.md 201 (a second copy of the to-do's steps): this lists
  only timed rings and events.

## 4. Past days narrower in the desktop week
- **Seen**: at 1440 px the week's seven equal columns gave five past, mostly empty days over half
  the width, while today's titles wrapped a word a line.
- **Change**: a past day is half a future day's width, and its items one line each with an ellipsis.
- **Wrong if**: you look back over the week as much as ahead.

## 5. A quieter meal plan
- **Seen**: "Nothing planned" twelve times on the desktop plan; a dish named like its recipe said
  twice, as text and again as a chip right under it.
- **Why it hurts**: repeated filler is read every time and says nothing the empty dashed slot
  doesn't; the eye has to skip it to find the meals.
- **Change**: an empty slot is just its name and time in a dashed outline, and a press anywhere on
  it plans it; a dish whose name is its one recipe's shows once, as the recipe's link at title size.
- **Wrong if**: an empty slot without words reads as broken rather than free.

## 6. A new screen eases in
- **Seen**: changing screen was a hard cut; the whole window swapped in one frame.
- **Why it hurts**: with no motion the eye can't tell what changed and re-scans the whole window;
  a short entrance marks where the new content is and that the move happened.
- **Change**: the page area fades up and rises 4 px over 160 ms on a change of screen (not within a
  screen, e.g. opening a recipe); nothing remounts, so the phone's graph stays built. Off under
  reduced motion.
- **Wrong if**: it reads as lag. 160 ms is near the lower bound people notice as motion; if it feels
  slow, cut it rather than add more.

## 7. Today above the character on the desktop Home
- **Seen**: the right column opened with the character card (about 200 px of portrait and six stats),
  and Today began below it.
- **Why it hurts**: the eye lands top-right first on the panel's side; it landed on a status that
  changes a few times a week, not on what to do now. Today's top also didn't line up with the graph's.
- **Change**: Today first, level with the graph's toolbar; the character is pinned at the column's
  foot, as large as before, and Today scrolls between them.
- **Wrong if**: seeing the character first is what makes opening the app feel like the game.

## 8. (Withdrawn) Alarms gets a phone tab; Settings moves into Home's menu
Reverted: design.md 188 is the user's Settings tab on the phone.

## 9. The Cookbook and the Atlas open on their first entry
- **Seen**: on the desktop both opened with two thirds of the window an empty pane saying
  "Choose a recipe" / "Choose an entry".
- **Why it hurts**: the largest area on the screen held nothing, and one more press was needed
  before anything could be read.
- **Change**: the desktop shows the first recipe (alphabetically) or the first Atlas entry until
  another is chosen. Combined with 1, the Kitchen button returns to the recipe last read. The phone,
  which shows the list or a recipe, is unchanged.

## 10. Reset layout only once something is placed by hand
- **Seen**: the graph's toolbar always had three buttons, one of them Reset layout, which does
  nothing until a quest or step has been dragged.
- **Change**: the button appears once any node has a hand-placed position, and goes after a full reset.
- **Wrong if**: a button that comes and goes reads as unstable; then dim it instead.
