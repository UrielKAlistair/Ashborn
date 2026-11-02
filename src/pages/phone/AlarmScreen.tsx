import { useEffect, useState } from "react";
import type { RingingAlarm } from "../../lib/alarms";
import { SITUPS_TO_STOP, STEPS_TO_STOP, situpCounter, stepCounter } from "../../lib/motion";

// Shown over everything while an alarm rings. A plain alarm stops or snoozes with a button; a
// challenge alarm stops only once the accelerometer has counted enough steps or sit-ups.
export function AlarmScreen({ alarm, onStop, onSnooze }: { alarm: RingingAlarm; onStop: () => void; onSnooze: () => void }) {
  const target = alarm.kind === "walk" ? STEPS_TO_STOP : alarm.kind === "situps" ? SITUPS_TO_STOP : 0;
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (alarm.kind === "plain") return;
    const counter = alarm.kind === "walk" ? stepCounter() : situpCounter();
    const onMotion = (event: DeviceMotionEvent) => {
      const a = event.accelerationIncludingGravity;
      if (a?.x != null && a.y != null && a.z != null) setCount(counter({ x: a.x, y: a.y, z: a.z, t: event.timeStamp }));
    };
    window.addEventListener("devicemotion", onMotion);
    return () => window.removeEventListener("devicemotion", onMotion);
  }, [alarm.key, alarm.kind]);

  useEffect(() => {
    if (target > 0 && count >= target) onStop();
  }, [count, target, onStop]);

  const time = new Date(alarm.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-8 bg-canvas px-6 text-center text-ink">
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
        <div className="w-full max-w-xs">
          <p className="text-sm leading-relaxed text-ink/65">
            {alarm.kind === "walk" ? "Walk to stop the alarm" : "Hold the phone flat on your chest and do sit-ups"}
          </p>
          <p className="mt-4 font-mono text-4xl tabular-nums text-ink/90">
            {Math.min(count, target)} / {target}
          </p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-ink/10">
            <div className="h-full rounded-full bg-ember transition-[width]" style={{ width: `${(Math.min(count, target) / target) * 100}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
