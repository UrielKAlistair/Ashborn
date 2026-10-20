import { useEffect, useState } from "react";
import { today } from "../shared/dates";

// Today's date, refreshed at midnight and on focus: the app can sit in the tray for days
export function useToday() {
  const [date, setDate] = useState(today);

  useEffect(() => {
    const refresh = () => setDate(today());
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timeout = window.setTimeout(refresh, nextMidnight.getTime() - now.getTime() + 1000);
    window.addEventListener("focus", refresh);

    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("focus", refresh);
    };
  }, [date]);

  return date;
}
