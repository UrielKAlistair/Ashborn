import { useEffect, useRef } from "react";
import { exportAll } from "./backup";
import { db } from "./client";
import { isConnectionError } from "./offline";

// How old the newest backup may get, and how often that is checked: hourly, so a backup missed
// while the computer was off is made soon after it is on and online again
const BACKUP_EVERY_MS = 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000;
// Begins the notice of a failed backup
export const BACKUP_NOT_MADE = "Backup not made: ";

// The desktop app's nightly backup of every table, written by the main process
// (electron/main.ts) to ~/.local/share/ashborn/backups. Runs only in the desktop app, once signed in.
// `onFailed` hears of a failure other than a lost connection, which would otherwise recur unseen.
export function useBackupSchedule(userId: string | null | undefined, onFailed: (message: string) => void) {
  const latestOnFailed = useRef(onFailed);
  latestOnFailed.current = onFailed;
  useEffect(() => {
    const desktop = window.ashborn;
    if (!userId || !desktop) return;

    const check = async () => {
      try {
        const newest = await desktop.newestBackup();
        if (newest !== null && Date.now() - newest < BACKUP_EVERY_MS) return;
        await desktop.writeBackup(JSON.stringify({ madeAt: new Date().toISOString(), tables: await exportAll(db) }));
      } catch (error) {
        // Either way the next hourly check tries again
        if (!isConnectionError(error)) latestOnFailed.current(BACKUP_NOT_MADE + (error as Error).message);
      }
    };

    void check();
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [userId]);
}
