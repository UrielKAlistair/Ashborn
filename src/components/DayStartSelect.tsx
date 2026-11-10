import type { Act } from "../pages/home/HomePage";

// The hour the user's day starts (user_settings.day_start_hour), 00:00 to 23:00: before it, ticks and
// routines count for the day before
export function DayStartSelect({ hour, act, className }: { hour: number; act: Act; className: string }) {
  return (
    <select value={hour} onChange={(event) => void act("updateSettings", { dayStartHour: Number(event.target.value) })} className={className}>
      {Array.from({ length: 24 }, (_, option) => (
        <option key={option} value={option}>
          {`${option}`.padStart(2, "0")}:00
        </option>
      ))}
    </select>
  );
}
