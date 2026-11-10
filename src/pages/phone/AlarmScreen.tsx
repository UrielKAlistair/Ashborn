import { useEffect, useRef, useState } from "react";
import type { RingingAlarm } from "../../lib/alarms";
import { clockOf } from "../../shared/dates";
import { SITUPS_TO_STOP, STEPS_TO_STOP, situpCounter, stepCounter } from "../../lib/motion";

// How long the motion sensor may stay silent before Stop is offered: a phone without one, or a
// WebView that sends nothing, must not leave an alarm that can never be stopped
const SENSOR_WAIT_MS = 10_000;

// Shown over everything while an alarm rings. A plain alarm stops or snoozes with a button; a
// challenge alarm stops only once the accelerometer has counted enough steps or sit-ups.
export function AlarmScreen({ alarm, onStop, onSnooze }: { alarm: RingingAlarm; onStop: () => void; onSnooze: () => void }) {
  const time = clockOf(new Date(alarm.at));

  return (
    <div className="fixed inset-0 z-[100] flex flex-col overflow-y-auto bg-canvas px-6 py-8 text-center text-ink">
      <div className="my-auto flex flex-col items-center gap-8">
        <p className="font-mono text-6xl tabular-nums text-ink/95">{time}</p>
        <p className="font-display text-lg font-semibold text-ink/85">{alarm.title}</p>

        {alarm.kind === "plain" ? (
          <div className="flex flex-col items-center gap-4">
            <button type="button" onClick={onStop} className="min-w-48 rounded-xl bg-ember px-10 py-4 text-base font-semibold text-canvas active:brightness-110">
              Stop
            </button>
            <button type="button" onClick={onSnooze} className="min-h-11 rounded-lg px-8 py-3 text-[13px] text-ink/65 active:bg-ink/8">
              Snooze 10 min
            </button>
          </div>
        ) : (
          // A ring that changes (another took its place, or a harder stop joined) starts a fresh count
          <Challenge key={`${alarm.key}:${alarm.kind}`} kind={alarm.kind} onStop={onStop} />
        )}
      </div>
    </div>
  );
}

// Counts steps or sit-ups and stops the ring once, at the target
function Challenge({ kind, onStop }: { kind: "walk" | "situps"; onStop: () => void }) {
  const target = kind === "walk" ? STEPS_TO_STOP : SITUPS_TO_STOP;
  const [count, setCount] = useState(0);
  const [sensed, setSensed] = useState<boolean | null>(null);
  const stopped = useRef(false);

  useEffect(() => {
    const counter = kind === "walk" ? stepCounter() : situpCounter();
    // Stop is offered whenever the sensor has been silent for SENSOR_WAIT_MS, at the start or later
    let lastMotion = performance.now();
    const silent = window.setInterval(() => performance.now() - lastMotion >= SENSOR_WAIT_MS && setSensed(false), 1000);
    const onMotion = (event: DeviceMotionEvent) => {
      const a = event.accelerationIncludingGravity;
      if (a?.x == null || a.y == null || a.z == null) return;
      lastMotion = performance.now();
      setSensed(true);
      setCount(counter({ x: a.x, y: a.y, z: a.z, t: event.timeStamp }));
    };
    window.addEventListener("devicemotion", onMotion);
    return () => {
      window.removeEventListener("devicemotion", onMotion);
      window.clearInterval(silent);
    };
  }, [kind]);

  useEffect(() => {
    if (count < target || stopped.current) return;
    stopped.current = true;
    onStop();
  }, [count, target, onStop]);

  return (
    <div className="w-full max-w-xs">
      <p className="text-sm leading-relaxed text-ink/65">{kind === "walk" ? "Walk to stop the alarm" : "Hold the phone flat on your chest and do sit-ups"}</p>
      <p className="mt-4 font-mono text-4xl tabular-nums text-ink/90">
        {Math.min(count, target)} / {target}
      </p>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-ink/10">
        <div className="h-full rounded-full bg-ember transition-[width]" style={{ width: `${(Math.min(count, target) / target) * 100}%` }} />
      </div>
      {sensed === false || count >= target ? (
        <div className="mt-6 flex flex-col items-center gap-3">
          {count >= target ? null : <p className="text-[12.5px] text-ink/60">The motion sensor isn't answering.</p>}
          <button type="button" onClick={onStop} className="min-h-11 rounded-xl bg-ember px-8 py-3 font-semibold text-canvas active:brightness-110">
            Stop
          </button>
        </div>
      ) : null}
    </div>
  );
}
