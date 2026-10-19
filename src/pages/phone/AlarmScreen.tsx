import { useEffect, useState } from "react";
import type { RingingAlarm } from "../../lib/alarms";
import { SITUPS_TO_STOP, STEPS_TO_STOP, situpCounter, stepCounter } from "../../lib/motion";

// Shown over everything while an alarm rings. A plain alarm stops with a button; a challenge
// alarm only once the accelerometer has counted enough steps or sit-ups.
export function AlarmScreen({ alarm, onStop }: { alarm: RingingAlarm; onStop: () => void }) {
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
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-8 bg-black px-6 text-center text-white">
      <p className="text-5xl font-light tracking-[0.1em]">{time}</p>
      <p className="text-lg text-white/85">{alarm.title}</p>

      {alarm.kind === "plain" ? (
        <button type="button" onClick={onStop} className="rounded-full border border-white/30 bg-white/10 px-10 py-4 text-sm uppercase tracking-[0.3em]">
          Stop
        </button>
      ) : (
        <div className="w-full max-w-xs">
          <p className="text-sm tracking-[0.14em] text-white/60">
            {alarm.kind === "walk" ? "Walk to stop the alarm" : "Hold the phone flat on your chest and do sit-ups"}
          </p>
          <p className="mt-4 text-4xl tabular-nums">
            {Math.min(count, target)} / {target}
          </p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-emerald-300/80 transition-[width]" style={{ width: `${(Math.min(count, target) / target) * 100}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
