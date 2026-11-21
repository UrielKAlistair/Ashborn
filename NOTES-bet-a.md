# bet-a notes

## The phone's meal-plan card names the days either side
- **Seen**: the phone showed one day's card and nothing said the strip swipes to other days; the
  earlier try with neighbours peeking as slivers read as a rendering fault (DESIGN-FLOW 13).
- **Why it hurts**: an affordance nobody can see is one nobody uses; tomorrow's plan was only found
  by accident.
- **Change**: the card's header reads "‹ Yesterday  Today 11-21  Tomorrow ›": the neighbours' names
  in quiet text either side of the day's own name, each a press that swipes the strip one card
  (smoothly). None past the strip's ends. Still one day per card, swiped, opening on today
  (design.md 133). The desktop's columns are unchanged. After review (d749852, e43a69d): a
  neighbour's press stays inside the header; a press steps from its own card, so a second press
  mid-scroll lands one card on; focus moves to the new card's neighbour, so it stays on screen.
- **Wrong if**: the names read as tabs or as a title rather than as "there is more this way", or
  the header feels crowded; then a dot row under the card is the next thing to try.

## A slot's time sits under its name in the desktop's day columns
- **Seen**: in the five narrow columns "Breakfast 8:00 AM" wrapped its time to a second line while
  Lunch and Dinner didn't (and Dinner did once a tick sat beside it).
- **Why it hurts**: three slots of one kind laid out two ways look like an error and break the
  column's rhythm.
- **Change**: on the desktop the time always takes its own line under the slot's name; the phone,
  with room, keeps it on the same line. Costs about 16 px per slot, where the columns have room to spare.
- **Wrong if**: the taller slots push a day's meals past the column's height on a small laptop.

## The desktop week's event titles take the card's full width
- **Seen**: in the seven week columns a card's clock, bell or tick took a 22 px column beside the
  title, so titles broke mid-word ("Lecture: Statistic / s") and an alarm's title ran to seven lines.
- **Why it hurts**: a word split across lines is read twice; tall narrow cards push the day's later
  events down the column.
- **Change** (`calendarViews.tsx`, EventCard): the title spans the card; the mark (or a deadline's
  tick) starts the detail line, beside the time. A press anywhere on the card opens it, as before;
  the title stays the button for the keyboard. "Statistics" now fits whole; "Portal check: confirm
  the test slot and venue" went from 7 lines to 6 plus its time line. The phone's rows are unchanged.
- **Wrong if**: the mark on the second line is missed when scanning for alarms versus events; the
  card's coloured edge still says the kind. Or if a deadline's tick, now on the detail line under its
  title, is missed as the way to finish one.
