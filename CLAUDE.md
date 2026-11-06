# Ashborn: how to work in this repo

## Trying design alternatives (A/B/C)
When a look or behaviour has several reasonable options, build them all for the user to try rather
than describing them:
- On a branch of its own, `trial/<topic>`, in a worktree beside the main folder
  (`../Ashborn-trial-<topic>`), never on `main`.
- One switch in the bottom-left corner of the window, labelled A, B, C, flips between the options live,
  remembered across reloads. It exists only on the trial branch.
- Give the user the command to run the trial build and the label of each option.
- The user picks one; only that option, without the switch, is merged to `main`. Log the choice in
  `docs/design.md`.
