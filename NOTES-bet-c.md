## A step within a screen eases in from the side it went to

**Seen**: on the Alarms screen, Today › Tomorrow and Repeating › swapped the whole list in one frame;
so did the Calendar's week arrows on the desktop, Week ↔ Month on the phone, and Day before / Day after
in the Calendar's day pop-up. The rows of Today and Tomorrow look alike (same card, same time column),
so after a tap the only sign that the list changed was the 13 px title.

**Why it hurts**: a cut between two look-alike lists gives the eye nothing to tell it the tap took, or
which way it moved; it re-reads the rows to find out. These are the switches used daily on the two
screens the swarm was asked about.

**Change**: the list (not the header or the arrows) fades up and slides 8 px in from the side it was
stepped towards (Tomorrow and next week from the right, back from the left) over 160 ms, the page
entrance's duration and easing (`useStepEntrance` in `src/lib/usePageEntrance.ts`, which shares the
page entrance's animation). It animates the existing box with the Web Animations API: nothing remounts,
the layout box never moves (transform only), and reduced motion skips it. Opening the day pop-up doesn't
slide; only a step within it does. The scroll boxes these lists sit in hide horizontal overflow, so the
8 px offset never shows a horizontal scrollbar. 8 px is the gap beside the week arrows, so the sliding
week never covers the › under a quick second press.

Left as is: a pop-up opening (it is drawn over the page, nothing moves under it), and the arrival of
data (the Calendar and Alarms read the already-loaded snapshot; no loading jump was seen).

**Verified** (read-only playwright, NOSEED, scratchpad `betc/frames.mjs`): 40 ms after each click a
160 ms animation is running, and no scroll box has horizontal overflow, on phone (Tomorrow, Repeating,
Month) and laptop (Tomorrow, Next week, Day after); with `reducedMotion: "reduce"` no animation runs.
`tsc --noEmit` clean.

**Wrong if**: the slide reads as the list being dragged or as lag. If so, drop the 8 px and keep only the
fade, or cut it.

## A step ticked in Now shows its tick, then folds away

**Seen**: ticking a step in Now (Home's Today panel) removed its row in the same frame: the tick's
pop (`.tick-done`) was never seen, because the row it belongs to was gone, and the rows below jumped up
one row under the pointer.

**Why it hurts**: the user's one act of progress got no answer on screen but a jump; the eye has to
re-find its place in the list and check that the right step went.

**Change** (`src/pages/home/FocusCard.tsx`): the change is sent at once, as before; the ticked row is
drawn where it was, tick filled and title struck, for about 70 ms, then folds to nothing over 100 ms (170 ms
of animation, `LEAVE_MS` in `src/pages/home/leaving.tsx`; about 200 ms from the tap, measured), so the rows below close up instead of jumping. The leaving row is no longer a
button, so a second tap can't untick it; if the step comes back (undo, a refused change) the real row
replaces it. The D key goes through the same path. A ticked row that hasn't left the list within twice the fold's time (undone, refused, or past the folded rows) is forgotten, so a later removal from elsewhere (graph, delete) never draws a fold the user didn't make here. Reduced motion: removed at once, as before.
A tick pressed (keyboard, or a mouse click, which also focuses it) hands focus to the first control of the row now in its place (its tick, or a first-step row's +), rather than dropping it to the page; ticking the last row still drops focus to the page. Two rows ticked in quick succession fold in their own order. A deadline ticked in Today folds the same way (the same hook; its leaving row is the real row drawn inert, with its tick filled, so the height matches).

**Verified** (read-only playwright on the laptop "/", every non-GET to the database aborted, the one
PATCH listed as blocked): row heights in Now before [48,48,48], ~30 ms after the click [48*,48,48,48]
(* the leaving row, same height as the row it replaces), ~90 ms [21*,...], ~150 ms [48,48,48]; under
reduced motion it is [48,48,48] throughout. Frames `betc/tick-motion-*.png`. tsc clean. Unit tests
not run here: their config reads a `.env` this worktree doesn't have (none of them cover FocusCard).

**Wrong if**: ticking several steps in a row feels held up; then cut the hold and keep the fold.

Per-frame heights after the tick, blocked writes (ms from the click: heights, * leaving): Now
`35:48* 113:48* 146:37* 179:15* 213:0* 246:gone`; Deadlines `22:58* 93:58* 125:45* 159:18* 194:0* 226:gone`;
Deadlines under reduced motion: no leaving row in any frame. Script `betc/tick2.mjs`.
