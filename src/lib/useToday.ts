import { useEffect, useState } from "react";
import { addDays, startOfDay, today } from "../shared/dates";

// Today's date, refreshed when the next day starts, on focus, and when the day-start hour changes:
// the app can sit in the tray for days
// (today() reads the hour itself; dayStartHour is here so a change refreshes the date)
export function useToday(dayStartHour: number) {
  const [date, setDate] = useState(today);

  useEffect(() => {
    const refresh = () => setDate(today());
    refresh();
    const timeout = window.setTimeout(refresh, startOfDay(addDays(date, 1)).getTime() - Date.now() + 1000);
    window.addEventListener("focus", refresh);

    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("focus", refresh);
    };
  }, [date, dayStartHour]);

  return date;
}
