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
      setNow: (step: import("./pages/home/trayNow").TrayNow) => void; // mirrors Now in the tray
      onNowDone: (listener: (id: string) => void) => () => void; // Done chosen in the tray; returns the unsubscribe
      newestBackup: () => Promise<number | null>; // when the newest backup was written (ms), or null
      writeBackup: (json: string) => Promise<void>;
    };
  }
}
