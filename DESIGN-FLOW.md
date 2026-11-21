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
  doesn't redirect Kitchen for good); the open section's button keeps its section's icon and is labelled
  with the shown screen's name (TO-DO, ALARMS, STOCKS); pressing it again opens the menu, as before.
  (It first took the screen's icon too; the Meal plan's calendar then stood beside the Calendar's.)
  A small ▲ (phone) or ▼ (desktop) after the open button's label marks that a second press opens its
  other screens (review 3: with the first press no longer opening the menu, nothing showed it was there).
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

## 4. (Withdrawn) Past days narrower in the desktop week
Tried at half and at 0.7 of a future day's width. At half, a past title showed as "Lect…" or
broke mid-word; at 0.7 past days barely narrowed and today's titles wrapped again. Late in the
week five of seven columns are past, so the room taken from each is too little to matter. If the
week's columns are to change, a window starting at yesterday would be the thing to try.

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
- **Change**: the desktop shows the recipe of the soonest meal still to cook (else the first
  alphabetically), or the first Atlas entry, until another is chosen. Shortcut: a meal that only the
  default week supplies isn't counted. Combined with 1, the Kitchen button returns to the recipe last read. The phone,
  which shows the list or a recipe, is unchanged.

## 10. Reset layout only once something is placed by hand
- **Seen**: the graph's toolbar always had three buttons, one of them Reset layout, which does
  nothing until a quest or step has been dragged.
- **Change**: the button appears once any node has a hand-placed position, and goes after a full reset.
- **Wrong if**: a button that comes and goes reads as unstable; then dim it instead.

## 11. The phone graph keeps only Fit
- **Seen**: the + and − zoom buttons sat over the cards at the graph's bottom left on the phone,
  where pinching already zooms.
- **Change**: the phone shows only Fit (pinching can't return to the overview in one move); the
  desktop keeps all three.
- **Wrong if**: one-handed use needs the buttons to zoom.

## 12. The phone's week opens on today
- **Seen**: by Saturday the phone's week list began with Monday's and Wednesday's finished
  lectures; today, the day the screen is opened for, was below the first screen of past events.
- **Why it hurts**: the first thing read is what is over; the eye scrolls past it every time.
- **Change**: this week's past days that held something are named in one line under the week's
  title ("Earlier Mon 16 Wed 18"), each opening its day, as the "Free" line does for empty ones;
  today's heading follows. Also the narrow desktop's list, which is the same list.
- **Wrong if**: looking back over the week's past events is a common use of this list.

## 13. (Withdrawn) The phone's meal plan shows the days either side
Tried at 88% of the strip: the ~20 px slivers showed clipped letters of the next day's title and read
as a rendering fault, not as days; the bet's own "wrong if". A swipe cue would need its own shape
(dots, or the neighbour's name in the header).

## 14. The phone's meal-plan card names the days either side (flow/a df6242a, d749852, e43a69d)
- **Seen**: the phone showed one day's card, and nothing showed that the strip swipes to other days.
  The slivers of 13 read as a rendering fault.
- **Why it hurts**: an affordance nobody can see is one nobody uses.
- **Change**: the card's header reads "‹ Yesterday  Today 11-21  Tomorrow ›". The neighbours' names
  sit in quiet text either side of the day's name, and each is a press that swipes the strip one card.
  There is none past the strip's ends. A press steps from its own card (a repeat lands one on), and
  focus follows to the new card. Still one day per card, swiped, opening on today (design.md 133).
- **Wrong if**: the names read as tabs or a title rather than "more this way", or the header feels
  crowded. If so, try a dot row under the card next.

## 15. A meal slot's time under its name in the desktop's day columns (flow/a df6242a)
- **Seen**: in the five narrow columns, "Breakfast 8:00 AM" wrapped its time to a second line while
  Lunch and Dinner didn't (Dinner did too once a tick sat beside it).
- **Why it hurts**: three slots of one kind laid out two ways look like an error.
- **Change**: on the desktop the time always takes its own line; the phone keeps it on the same
  line. About 16 px per slot, where the columns have room to spare.
- **Wrong if**: a day's meals then overflow the column on a small laptop.

## 16. The desktop week's event titles take the card's full width (flow/a 8e25999, ffd1f96)
- **Seen**: the clock, bell or tick took a column beside the title, so titles broke mid-word
  ("Lecture: Statistic / s"), and an alarm's title ran to seven lines.
- **Why it hurts**: a split word is read twice, and tall cards push the day's later events down.
- **Change**: the title spans the card, and the mark (or a deadline's tick) starts the detail line,
  beside the time. A press anywhere on the card still opens it. The phone's rows are unchanged.
- **Wrong if**: the mark on the second line is missed when telling alarms from events, or a
  deadline's tick under its title is missed as the way to finish it.

## 17. A denser Today (flow/b 84764c4)
- **Seen**: a one-line deadline took a 76 px pitch on the phone (66 px on the laptop), and its date
  line repeated "2026-11-23" beside the "2d" pill. Now began at y = 436 on the phone, and Routines was
  below the fold (on the laptop, under the pinned character).
- **Why it hurts**: Today is read for what to do next, and the eye crosses tall, mostly empty rows
  to reach Now.
- **Change**: dates read "Mon 23 Nov" (the calendar's `dayLabel`). The quest picker keeps its 32 px
  touch area but takes only its line. Rows have 6 px padding and sit 4 px apart. The order (304) and
  the picker (202) are kept. Deadline pitch is now 53 px on both. Now's top moved 436 → 370 (phone)
  and 390 → 356 (laptop), and the first routine shows on both.
- **Wrong if**: the picker catches taps meant for the next row, or the rows read as cramped. If so,
  restore the padding first.

## 18. (Withdrawn) Tighter gaps on the Alarms day view (flow/b)
Gaps alone (328 fixes the padding, the clock and its column) took the card pitch only from 96 to
92 px, about 0.2 of a card per screen. The text column, ~125 px wide, is what wraps; widening it
touches 328, so it is the user's call.

## 19. A staple's card on the phone at the height of its contents (flow/b 42e8868)
- **Seen**: Edit's 44 px touch height set the name line's height, so a staple took a 96 px pitch,
  with the gauge far below its name.
- **Why it hurts**: the name, amount and gauge read as one unit only when they sit together, and the
  gap halves how many staples fit.
- **Change**: Edit keeps its 44 px tap area but takes only its line. Pitch 96 → 76 px.
- **Wrong if**: Edit's tap area, now reaching over the gauge, catches stray taps.

## 20. The phone graph's Fit moves into its toolbar (flow/b 3129b73, c7e1756)
- **Seen**: Fit (bet 11) floated at the canvas's bottom left, over a step's tick in the opening view.
- **Why it hurts**: the phone graph is read by scrolling, so whatever passes that corner is covered,
  and a tap meant for a tick can hit Fit.
- **Change**: on the phone, Fit is a pill after Quests in the top toolbar, and "+ New quest" narrows
  from 208 to 144 px to make room (c7e1756: at 360 px wide Fit ran past the edge). The desktop is unchanged.
- **Wrong if**: Fit is wanted under the thumb, or the narrower field cuts what is typed.

## 21. A step within a screen eases in from the side it went to (flow/c 64e3e1a)
- **Seen**: Alarms' Today › Tomorrow › Repeating, the Calendar's week arrows, the phone's Week ↔
  Month, and the day pop-up's day before and after all swapped look-alike lists in one frame.
- **Why it hurts**: the eye can't tell the tap took, or which way it moved, and re-reads the rows.
- **Change**: the list (not its header) fades up and slides 8 px in from the side stepped towards,
  over 160 ms with the page entrance's easing (`useStepEntrance`). It is transform-only, nothing
  remounts, and it is off under reduced motion.
- **Wrong if**: the slide reads as dragging or lag. If so, keep only the fade, or cut it.

## 22. A ticked step or deadline in Today shows its tick, then folds away (flow/c 3336f5c to b14f930)
- **Seen**: ticking a step in Now or a deadline removed its row in the same frame. The tick's pop was
  never seen, and the rows below jumped up under the pointer.
- **Why it hurts**: the one act of progress got no answer on screen except a jump.
- **Change**: the change is sent at once. The row stays inert, tick filled, then folds, about 200 ms
  in all (`src/pages/home/leaving.tsx`). Undo or a refused change brings the real row back. A tick
  pressed from the keyboard moves focus to the next row's first control. Off under reduced motion.
- **Wrong if**: ticking several in a row feels held up. If so, cut the hold and keep the fold.
  Open: in a folded Now the next row pops in while the ticked one folds; ticking the last row drops focus to the page.

## 23. The laptop Alarms' + beside the column, not over the last row (flow/b fb6482b, 8fbf39f)
- **Seen**: at 1440x900 the round + sat over the last visible row's switch (Stretch's, wholly hidden).
- **Change**: from 900 px wide up, outside the phone layout, the + sits 80 px right of the column, in
  the empty margin. Narrow windows and the phone keep it inside (a phone held sideways included).
- **Wrong if**: the + is then too far from the list to be found.

## 24. Coming up's times in the routines' face (design/flow 21863de)
- **Seen**: Coming up set its times in Silkscreen, the pixel face, while the routines' times below sat in the mono face; two clocks in one panel, in two faces.
- **Change**: the mono face at 11.5 px, as the routines use. Silkscreen stays for the Alarms' clocks and the NOW line.
