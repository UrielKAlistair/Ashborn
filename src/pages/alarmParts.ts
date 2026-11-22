import { SITUPS_TO_STOP, STEPS_TO_STOP } from "../lib/motion";
import type { Alarm } from "../shared/types";

// What the Alarms screen and the Calendar's alarm form share: how each kind of alarm stops, and the
// style of a form field

export const kindLabels: Record<Alarm["kind"], string> = {
  plain: "Plain",
  walk: `Walk ${STEPS_TO_STOP} steps`,
  situps: `${SITUPS_TO_STOP} sit-ups`,
};

export const field =
  "rounded-lg border border-ink/10 bg-canvas/60 px-3 py-1.5 text-[13px] text-ink/90 placeholder:text-ink/35 focus:border-ember/60 focus:outline-none phone:min-h-11";
