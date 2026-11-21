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
