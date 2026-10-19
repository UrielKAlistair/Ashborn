// Counts the physical challenges that stop an alarm, from accelerometer samples (m/s², gravity
// included, as DeviceMotionEvent.accelerationIncludingGravity gives them). The thresholds are
// first estimates, to be tuned on the phone.

export type MotionSample = { x: number; y: number; z: number; t: number }; // t in ms

export const STEPS_TO_STOP = 30;
export const SITUPS_TO_STOP = 15;

const GRAVITY = 9.81;
const STEP_HIGH = GRAVITY + 2.5; // a stride's impact pushes the magnitude above this…
const STEP_LOW = GRAVITY + 0.5; // …and it must fall back below this before the next one counts
const STEP_MIN_GAP_MS = 250; // faster than four steps a second is shaking, not walking

const SITUP_UP_DEGREES = 60; // phone on the chest: tilted this far from flat means sitting up…
const SITUP_DOWN_DEGREES = 25; // …and this close to flat means lying back down

// A step is a spike in the total acceleration; hysteresis and a minimum gap stop one stride
// counting twice
export function stepCounter() {
  let steps = 0;
  let armed = true;
  let lastStep = -Infinity;

  return (sample: MotionSample) => {
    const magnitude = Math.hypot(sample.x, sample.y, sample.z);
    if (armed && magnitude > STEP_HIGH && sample.t - lastStep >= STEP_MIN_GAP_MS) {
      steps++;
      armed = false;
      lastStep = sample.t;
    } else if (magnitude < STEP_LOW) {
      armed = true;
    }
    return steps;
  };
}

// With the phone held flat on the chest, gravity runs through the screen while lying down and
// tilts away from it on sitting up. A sit-up is up past one angle, then back down past another.
export function situpCounter() {
  let situps = 0;
  let up = false;

  return (sample: MotionSample) => {
    const magnitude = Math.hypot(sample.x, sample.y, sample.z);
    if (magnitude === 0) return situps;
    const tilt = (Math.acos(Math.min(1, Math.abs(sample.z) / magnitude)) * 180) / Math.PI;
    if (!up && tilt > SITUP_UP_DEGREES) up = true;
    else if (up && tilt < SITUP_DOWN_DEGREES) {
      up = false;
      situps++;
    }
    return situps;
  };
}
