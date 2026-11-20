// The app's "today", kept current while the app stays open for days.
import { useEffect, useState } from "react";
import { addDays, startOfDay, today } from "../shared/dates";

// Today's date, refreshed at midnight and on focus: the app can sit in the tray for days
export function useToday() {
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
  }, [date]);

  return date;
}
