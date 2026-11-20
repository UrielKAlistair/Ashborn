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
- **Change**: a button from another section goes straight to the screen last open in it (kept on the
  device); the open section's button is labelled with the screen shown (TO-DO, ALARMS, STOCKS);
  pressing it again opens the menu, as before.
- **Wrong if**: you mostly want a section's first screen rather than the last one, or the changing
  label reads as the button moving.

## 2. Now first on Today
- **Seen**: on the desktop's Today panel and the phone's To-do, Now (what to do next) sat below gone
  quiet quests and every deadline, about two thirds of the way down the desktop panel.
- **Why it hurts**: the panel's first question is "what do I do now"; the answer was below the
  fold of attention, after items you check rather than act on.
- **Change**: order is Up next (today's times), Now, deadlines, gone quiet, unprioritised, routines.
- **Wrong if**: your first look each day is really "what is due", not "what do I do".

## 3. Up next on Today; descriptions in Now
- Up next: what is on now and the next two times today, rings and events, at the top of Today.
- A step's description shows under it in Now, two lines at most, so an agent's "details in file X"
  is seen where the step is picked up.

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
