// What the page finds on window: the desktop shell's bridge (electron/preload.cts), present only in the
// desktop app, and the phone's Back hook (MainActivity.java asks window.ashbornBack first).
export {};

declare global {
  interface Window {
    // Called by the phone's Back button (MainActivity); true when the page went back itself, so the app stays open
    ashbornBack?: () => boolean;
    ashborn?: {
      hideToTray: () => void;
      toggleMaximise: () => void;
      isMaximised: () => Promise<boolean>;
      onMaximisedChange: (listener: (maximised: boolean) => void) => () => void; // returns the unsubscribe
      quit: () => void;
      onCapture: (listener: () => void) => () => void; // the desktop-wide capture shortcut; returns the unsubscribe
      takeCaptureAtStart: () => Promise<boolean>; // launched with --capture: true once, for the first asker
      setNow: (step: import("./pages/home/nowMirror").MirroredNow) => void; // mirrors Now in the tray
      newestBackup: () => Promise<number | null>; // when the newest backup was written (ms), or null
      writeBackup: (json: string) => Promise<void>;
      setUnsaved: (what: string | null) => void; // work not yet saved, which quitting asks about; null when none
      onSaveForQuit: (save: () => Promise<boolean>) => () => void; // Save chosen at quit; returns the unsubscribe
    };
  }
}
