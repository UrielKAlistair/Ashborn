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
