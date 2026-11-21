## A denser Today: deadline rows at one line's weight

- **Seen**: a one-line deadline took a 76 px pitch on the phone (66 px on the laptop) for a title and a
  date line: the row's 8 px padding, 8 px between rows, and the quest picker's 32 px touch height
  standing in the layout. The date line repeated the ISO date ("2026-11-23") the pill already says as
  "2d". On the phone Now began at y = 436 of 844 and Routines was below the fold; on the laptop
  Routines' rows were hidden behind the pinned character.
- **Why it hurts**: Today is read for what to do next; the eye crosses three tall, mostly empty
  deadline rows and a date in a format read digit by digit before reaching Now.
- **Change** (`src/pages/home/TodayPanel.tsx`): the date line and the panel's heading read
  "Mon 23 Nov" (the calendar's `dayLabel`); the quest picker keeps its 32 px touch area but takes only
  its line (`pointer-coarse:-my-2`, as decision 145 does for the tick); row padding 8 → 6 px and rows
  8 → 4 px apart (deadlines, routines, the Ready list). Order (304) and the "No quest" picker (202) kept.
  Measured from the screenshots (phone 390×844, laptop 1440×900): deadline pitch 76 → 53 px (phone),
  66 → 53 px (laptop); Now's top 436 → 370 px on the phone, 390 → 356 px on the laptop; the
  first routine now shows on both.
- **Wrong if**: the picker, now overlapping the row's padding, catches taps meant for the next row's
  tick on the phone, or the rows read as cramped; then put the row padding back first.

## (Withdrawn) Tighter gaps on the Alarms day view

- **Seen**: on the phone about four ring cards fit below the deadlines; one-line cards take a 96 px
  pitch, cards whose title or detail wraps to a third line 114 px. The text column is ~125 px wide,
  squeezed between the 128 px clock column and the switch, so ordinary titles ("Leave for the 11:59
  train") and details ("Event · 2:00 PM – 4:00 PM · 2h") wrap.
- **Tried**: gaps only, since 328 (user's) set the cards' padding, the 30 px clock and the 128 px column:
  columns 16 → 12 px apart, title → detail 4 → 2 px, cards 10 → 8 px apart.
- **Measured** (phone 390×844, from screenshots): pitch 96 → 92 px and 114 → 110 px; nothing stopped
  wrapping; the fifth card's top moved from y = 735 to 714. About 0.2 of a card more per screen: not a
  change anyone would notice, so reverted.
- **What would work**: more width for the text (the clock column or the switch), or shorter details;
  each touches 328, so it is the user's call.

## A staple's card on the phone at the height of its contents

- **Seen**: on the phone each staple card took a 96 px pitch (72 px on the laptop): Edit's 44 px touch
  height set the name line's height, 44 px for 18 px of text, so the gauge sat far below its name.
- **Why it hurts**: the name, amount and gauge read as one unit only when they sit together; the gap
  also halves how many staples fit before scrolling (5 of them fill 530 px).
- **Change** (`src/pages/kitchen/StockPanel.tsx`): Edit keeps its 44 px tap area but takes only its line
  (`phone:-my-2.5`, as the Today panel's quest picker). Phone pitch 96 → 76 px (from screenshots).
- **Wrong if**: Edit's tap area, which now reaches over the top of the gauge (not pressable), catches
  taps meant elsewhere.

## The phone graph's Fit moves into its toolbar

- **Seen**: the phone's one graph control, Fit (bet 11), floated at the canvas's bottom left; in the
  opening view it sat on the tick of the step "Week 1 graded assignment" (Fit at x ~45, the tick at ~60).
- **Why it hurts**: the phone graph is read by scrolling, so whatever passes that corner is covered,
  and a tap meant for a tick there can hit Fit instead.
- **Change** (`src/pages/home/QuestGraph.tsx`): on the phone Fit is a "Fit" pill after Quests in the top
  toolbar (same fit, still named "Fit View"), and "+ New quest" narrows from 208 to 144 px to make room (the row then fits a 360 px phone);
  toolbar pills keep to one line. The desktop's controls are unchanged. Shot: nothing sits under a
  control in the opening view.
- **Wrong if**: Fit is wanted under the thumb at the bottom, or the narrower New quest field cuts
  what is typed.

## The Alarms screen's + beside its column on a wide window

- **Seen**: on the laptop (1440×900) the round + sat at the bottom right inside the 576 px column, on top
  of the last visible row's switch: Stretch's switch was hidden entirely in the opening view, so which
  rings are on could not be read and that switch could not be pressed until the list scrolled.
- **Why it hurts**: the switches' column is what the eye runs down on this screen; a hole in it reads as
  a ring with no switch.
- **Change** (`src/pages/AlarmsPage.tsx`): from a 900 px window up, the + sits 80 px right of the column's
  edge, in the empty margin (the same height); narrower windows and the phone layout keep it inside,
  whatever its width (a phone on its side is 915 px wide; measured there, the + stays on screen). Also on
  Repeating, which shares the button.
- **Wrong if**: the + reads as belonging to nothing out in the margin.
