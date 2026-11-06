export {};

declare global {
  interface Window {
    ashborn?: {
      hideToTray: () => void;
      toggleMaximise: () => void;
      isMaximised: () => Promise<boolean>;
      onMaximisedChange: (listener: (maximised: boolean) => void) => () => void; // returns the unsubscribe
      quit: () => void;
      onCapture: (listener: () => void) => () => void; // the desktop-wide capture shortcut; returns the unsubscribe
      takeCaptureAtStart: () => Promise<boolean>; // launched with --capture: true once, for the first asker
      setNow: (step: import("./pages/home/nowMirror").MirroredNow) => void; // mirrors Now in the tray
      onNowDone: (listener: (id: string) => void) => () => void; // Done chosen in the tray; returns the unsubscribe
      onNowTimer: (listener: (id: string, start: boolean) => void) => () => void; // Start or Stop chosen in the tray; returns the unsubscribe
      newestBackup: () => Promise<number | null>; // when the newest backup was written (ms), or null
      writeBackup: (json: string) => Promise<void>;
      setUnsaved: (what: string | null) => void; // work not yet saved, which quitting asks about; null when none
      onSaveForQuit: (save: () => Promise<boolean>) => () => void; // Save chosen at quit; returns the unsubscribe
    };
  }
}
