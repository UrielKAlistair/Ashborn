import { useEffect } from "react";
import { exportAll } from "./backup";
import { db } from "./client";

// How old the newest backup may get, and how often that is checked: hourly, so a backup missed
// while the computer was off is made soon after it is on and online again
const BACKUP_EVERY_MS = 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000;

// The desktop app's nightly backup of every table, written by the main process
// (electron/main.ts) to ~/.local/share/ashborn/backups. Runs only in the desktop app, once signed in.
export function useBackupSchedule(userId: string | null | undefined) {
  useEffect(() => {
    const desktop = window.ashborn;
    if (!userId || !desktop) return;

    const check = async () => {
      try {
        const newest = await desktop.newestBackup();
        if (newest !== null && Date.now() - newest < BACKUP_EVERY_MS) return;
        await desktop.writeBackup(JSON.stringify({ madeAt: new Date().toISOString(), tables: await exportAll(db) }));
      } catch {
        // Offline or the read failed: the next hourly check tries again
      }
    };

    void check();
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [userId]);
}
